'use client'

import { useScanResult } from '@/lib/use-scan-result'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createSSEWithBackoff } from '@/lib/sse'
import { sendChromeBridgeMessage, subscribeChromeBridgeEvents } from '@/lib/chromeBridge'
import { API_BASE } from '@/lib/api'
import { BiSave, BiBriefcase, BiPlay, BiStop, BiLinkExternal, BiCodeAlt } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import Link from 'next/link'
import { rememberZhilianRun, lastZhilianRun } from '@/lib/zhilian-scan-context'
import { getZhilianPageStatus } from '@/lib/zhilian-page-status'
import PageHeader from '@/app/components/PageHeader'
import CurrentProfileBadge, { type CurrentProfile } from '@/app/components/CurrentProfileBadge'
import KeywordTagInput from '@/app/components/KeywordTagInput'
import { formatSetupMissingMessage, validateSetupForPlatform } from '@/lib/setupChecklist'
import { MAX_JOB_KEYWORDS, parseJobKeywords as normalizeKeywordTokens, serializeJobKeywords } from '@/lib/job-keywords'
import { normalizeScanProfileId, scanEventMatchesProfile } from '@/lib/scan-profile'
import FilterControls from './FilterControls'
import ScanResult, { readScanResult } from './ScanResult'
import {resetCityFilters, type ZhilianFilters, type FilterCatalog} from '@/lib/zhilian-filters'

interface ZhilianConfig {
  id?: number
  keywords?: string
  cityCode?: string
  salary?: string
  searchJobLimit?: number
  filters?: ZhilianFilters
}

interface Option { name: string; code: string }
interface ZhilianOptions { city: Option[]; salary: Option[] }
interface ProgressLog {
  id: number
  type: string
  message: string
  timestamp?: number
}

const DEFAULT_ZHILIAN_CITY_CODE = '489'
const DEFAULT_ZHILIAN_SALARY_CODE = '0000,9999999'
const OFFICIAL_ZHILIAN_SALARY_CODES = new Set([
  DEFAULT_ZHILIAN_SALARY_CODE,
  '0000,4000',
  '4001,6000',
  '6001,8000',
  '8001,10000',
  '10001,15000',
  '15001,25000',
  '25001,35000',
  '35001,50000',
  '50001,9999999',
])
const ZHILIAN_KEYWORD_REQUIRED_MESSAGE = '请至少填写一个搜索关键词'

const isTerminalScanPayload = (payload: Record<string, unknown>) => {
  const stage = String(payload.stage || '')
  const message = String(payload.message || '')
  const operation = String(payload.operation || '')
  return (operation === 'scan' && ['complete', 'stopped', 'error', 'blocked'].includes(stage))
    || message.includes('扫描完成')
    || message.includes('扫描已停止')
    || message.includes('扫描失败')
}

export default function ZhilianPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isDelivering, setIsDelivering] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(true)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [backendAvailable, setBackendAvailable] = useState(true)
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([])
  const [chromeBridgeReady, setChromeBridgeReady] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  const [openClawReady, setOpenClawReady] = useState(false)
  const [openClawRunning, setOpenClawRunning] = useState(false)
  const [openClawMessage, setOpenClawMessage] = useState('')
  const [latestRunId, setLatestRunId] = useState('')
  const [loginMessage, setLoginMessage] = useState('正在检查 Chrome 中的智联页面…')
  const [isStarting, setIsStarting] = useState(false)
  const startingRef = useRef(false)
  const checkingRef = useRef(false)
  const profileRef = useRef<number | null>(null)
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(null)
  const [hasProfile, setHasProfile] = useState(false)
  const [runProgress, setRunProgress] = useState<Record<string, number>>({})
  const [submissionProgress, setSubmissionProgress] = useState<Record<string, number>>({})
  const [scanResult, setScanResult] = useScanResult('zhilian', currentProfile?.id)
  const scanRunRef = useRef('')
  const acceptRun = useCallback((runId: unknown) => {
    if (typeof runId !== 'string' || !runId) return !scanRunRef.current
    const current = scanRunRef.current
    if (current && current !== runId) {
      const incomingTime = Number(runId.match(/^zhilian-(\d+)$/)?.[1] || 0)
      const currentTime = Number(current.match(/^zhilian-(\d+)$/)?.[1] || 0)
      if (!incomingTime || !currentTime || incomingTime <= currentTime) return false
    }
    scanRunRef.current = runId
    return true
  }, [])

  useEffect(() => { scanRunRef.current = '' }, [currentProfile?.id])

  useEffect(() => {
    setRunProgress({}); setSubmissionProgress({})
    if (!currentProfile?.id || !latestRunId) return
    let cancelled = false
    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/zhilian/scan/progress?profileId=${currentProfile.id}&runId=${encodeURIComponent(latestRunId)}`)
        if (response.ok) { const data = await response.json(); if (!cancelled) setRunProgress(data) }
      } catch { /* Keep last confirmed counts while disconnected. */ }
    }
    void refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [currentProfile?.id, latestRunId])

  useEffect(() => {
    if (currentProfile?.id && latestRunId) rememberZhilianRun(currentProfile.id, latestRunId)
  }, [currentProfile?.id, latestRunId])

  const [config, setConfig] = useState<ZhilianConfig>({ keywords: '', cityCode: DEFAULT_ZHILIAN_CITY_CODE, salary: DEFAULT_ZHILIAN_SALARY_CODE, searchJobLimit: 20 })
  const [recommendedKeywords, setRecommendedKeywords] = useState<string[]>([])
  const [searchJobLimitInput, setSearchJobLimitInput] = useState('20')
  const [options, setOptions] = useState<ZhilianOptions>({ city: [], salary: [] })
  const [configWarnings, setConfigWarnings] = useState<Record<string, string>>({})
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [filterCatalog,setFilterCatalog]=useState<FilterCatalog|null>(null)
  const [filterError,setFilterError]=useState('')
  useEffect(()=>{
    let cancelled=false
    setFilterCatalog(null);setFilterError('')
    fetch(`${API_BASE}/api/zhilian/config/options/filters?cityCode=${encodeURIComponent(config.cityCode||DEFAULT_ZHILIAN_CITY_CODE)}`)
      .then(async response=>{if(!response.ok)throw new Error('官方筛选选项加载失败，请检查服务后重试');return response.json()})
      .then(data=>{
        if(!data.version || !data.options || String(data.cityCode)!==String(config.cityCode||DEFAULT_ZHILIAN_CITY_CODE))throw new Error('官方筛选选项响应不完整，请检查服务版本')
        if(!cancelled)setFilterCatalog(data)
      })
      .catch(error=>{if(!cancelled)setFilterError(error.message)})
    return ()=>{cancelled=true}
  },[config.cityCode])

  const normalizeSearchJobLimit = (value?: number | string): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 1) return 20
    return Math.min(Math.floor(parsed), 200)
  }

  const commitSearchJobLimit = (value?: number | string): number => {
    const limit = normalizeSearchJobLimit(value ?? searchJobLimitInput)
    setSearchJobLimitInput(String(limit))
    setConfig((prev) => ({ ...prev, searchJobLimit: limit }))
    return limit
  }

  const normalizeCityCodeForSelect = (raw: unknown, cityOptions: Option[]): string => {
    const value = String(raw || '').trim()
    if (!value || value === '0' || value === '不限') return DEFAULT_ZHILIAN_CITY_CODE
    if (cityOptions.some((option) => option.code === value)) return value
    const byName = cityOptions.find((option) => option.name === value)
    if (byName) return byName.code
    if (!cityOptions.length && /^\d+$/.test(value)) return value
    return DEFAULT_ZHILIAN_CITY_CODE
  }

  const normalizeSalaryCodeForSelect = (raw: unknown, salaryOptions: Option[]): string => {
    const value = String(raw || '').trim()
    if (!value || value === '0' || value === '不限') return DEFAULT_ZHILIAN_SALARY_CODE
    if (salaryOptions.some((option) => option.code === value)) return value
    const byName = salaryOptions.find((option) => option.name === value)
    if (byName) return byName.code
    if (!salaryOptions.length && OFFICIAL_ZHILIAN_SALARY_CODES.has(value)) return value
    return DEFAULT_ZHILIAN_SALARY_CODE
  }

  const isLegacyZhilianValue = (raw: unknown): boolean => {
    const value = String(raw || '').trim()
    return Boolean(value && value !== '0' && value !== '不限')
  }

  const appendProgressLog = useCallback((entry: Omit<ProgressLog, 'id'>) => {
    const timestamp = entry.timestamp || Date.now()
    setProgressLogs((prev) => [
      { ...entry, timestamp, id: timestamp + Math.random() },
      ...prev,
    ].slice(0, 80))
  }, [])

  const syncZhilianScanStatus = useCallback(async (silent = false, keepStopping = false) => {
    const profileId = normalizeScanProfileId(currentProfile?.id)
    if (!profileId) return
    try {
      const status = await sendChromeBridgeMessage({
        type: 'ZHILIAN_SCAN_STATUS',
        platform: 'zhilian',
        profileId,
      }, 2000)
      if (profileRef.current !== profileId) return
      if (status.profileId !== undefined && normalizeScanProfileId(status.profileId) !== profileId) return
      if (!acceptRun(status.runId)) return
      if (normalizeScanProfileId(status.profileId) === profileId) {
        const result = readScanResult(status)
        if (result) { setScanResult(result); setLatestRunId(result.runId) }
      }
      const running = Boolean(status.isRunning || status.hasStoredTask)
      if (running) {
        setIsDelivering(true)
        setIsStopping(keepStopping)
        const runId = typeof status.runId === 'string' && status.runId.trim() ? status.runId.trim() : null
        if (runId) { setActiveRunId(runId); setLatestRunId(runId) }
        if (!silent) {
          appendProgressLog({
            type: 'info',
            message: String(status.message || '检测到智联招聘扫描仍在运行，已恢复停止按钮。'),
            timestamp: typeof status.updatedAt === 'number' ? status.updatedAt : Date.now(),
          })
        }
        return
      }
      if (status.success) {
        setIsDelivering(false)
        setIsStopping(false)
        setActiveRunId(null)
      }
    } catch {
      // 扩展未连接或平台页未打开时，保持当前前端状态。
    }
  }, [appendProgressLog, currentProfile?.id, acceptRun, setScanResult])

  useEffect(() => {
    void checkChromeBridge()
    void syncZhilianScanStatus(true)
  }, [syncZhilianScanStatus])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchAllData()
        void checkChromeBridge()
        syncZhilianScanStatus(true)
      }
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncZhilianScanStatus])

  useEffect(() => {
    const timer = window.setInterval(() => {
      checkChromeBridge()
      syncZhilianScanStatus(true)
    }, 3000)

    return () => window.clearInterval(timer)
  }, [syncZhilianScanStatus])

  useEffect(() => {
    return subscribeChromeBridgeEvents((event) => {
      const payload = event.payload
      if (!payload || payload.platform !== 'zhilian') return
      if (!scanEventMatchesProfile(payload, currentProfile?.id, true)) return
      if ((payload.operation === 'scan' || Array.isArray(payload.keywordResults)) && !acceptRun(payload.runId)) return
      const result = readScanResult(payload)
      if (result) setScanResult(result)
      if (typeof payload.submissionConfirmed === 'number') setSubmissionProgress({ confirmed: payload.submissionConfirmed, pending: Number(payload.submissionPending || 0) })

      appendProgressLog({
        type: payload.type || 'info',
        message: payload.message || '',
        timestamp: payload.timestamp,
      })

      if (typeof payload.runId === 'string') setLatestRunId(payload.runId)
      if (isTerminalScanPayload(payload)) {
        setIsDelivering(false)
        setIsStopping(false)
        setActiveRunId(null)
      }
    })
  }, [appendProgressLog, currentProfile?.id, acceptRun, setScanResult])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      appendProgressLog({ type: 'warning', message: '当前浏览器不支持实时日志，无法连接智联招聘进度流。' })
      return
    }

    const client = createSSEWithBackoff(`${API_BASE}/api/zhilian/stream`, {
      onOpen: () => appendProgressLog({ type: 'info', message: '智联招聘运行日志已连接。' }),
      onError: (_e, attempt, delay) => {
        appendProgressLog({ type: 'warning', message: `智联招聘运行日志连接中断，${Math.round(delay / 1000)}秒后第${attempt}次重连。` })
      },
      listeners: [
        {
          name: 'connected',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              appendProgressLog({ type: 'info', message: data.message || '已连接到智联招聘扫描进度。' })
            } catch {
              appendProgressLog({ type: 'info', message: '已连接到智联招聘扫描进度。' })
            }
          },
        },
        {
          name: 'progress',
          handler: (event) => {
            try {
              const raw = JSON.parse(event.data)
              const data = typeof raw === 'string' ? JSON.parse(raw) : raw
              if (!scanEventMatchesProfile(data, currentProfile?.id, true)) return
              if ((data.operation === 'scan' || Array.isArray(data.keywordResults)) && !acceptRun(data.runId)) return
              const result = readScanResult(data)
              if (result) setScanResult(result)
              if (typeof data.submissionConfirmed === 'number') setSubmissionProgress({ confirmed: data.submissionConfirmed, pending: Number(data.submissionPending || 0) })
              appendProgressLog({
                type: data.type || 'info',
                message: data.message || '',
                timestamp: data.timestamp,
              })
              if (typeof data.runId === 'string') setLatestRunId(data.runId)
              if (isTerminalScanPayload(data)) {
                setIsDelivering(false)
                setIsStopping(false)
                setActiveRunId(null)
              }
            } catch (error) {
              console.warn('[智联] 解析进度消息失败:', error)
            }
          },
        },
        { name: 'ping', handler: () => {} },
      ],
    })

    return () => client.close()
  }, [appendProgressLog, currentProfile?.id, acceptRun, setScanResult])

  // 统一兼容中英文逗号、JSON数组、换行和多余空白。
  const parseKeywordsFromDb = (raw?: string): string => {
    return serializeJobKeywords(normalizeKeywordTokens(raw))
  }

  const fetchAllData = async () => {
    setLoadingConfig(true)
    try {
      const [res, recommendationResponse] = await Promise.all([
        fetch(`${API_BASE}/api/zhilian/config`),
        fetch(`${API_BASE}/api/ai/job-keywords`).catch(() => null),
      ])
      const data = await res.json()
      if (recommendationResponse?.ok) {
        const recommendationEnvelope = await recommendationResponse.json() as { data?: { keywords?: string[] } }
        setRecommendedKeywords(normalizeKeywordTokens(recommendationEnvelope.data?.keywords))
      } else {
        setRecommendedKeywords([])
      }
      const nextOptions: ZhilianOptions = {
        city: Array.isArray(data.options?.city) ? data.options.city : [],
        salary: Array.isArray(data.options?.salary) ? data.options.salary : [],
      }
      const nextWarnings: Record<string, string> = { ...(data.warnings || {}) }
      const nextProfileId = normalizeScanProfileId(data.currentProfile?.id)
      if (profileRef.current !== nextProfileId) {
        profileRef.current = nextProfileId
        setLatestRunId(nextProfileId ? lastZhilianRun(nextProfileId) : '')
        setActiveRunId(null)
        setIsDelivering(false)
        setIsStopping(false)
        setProgressLogs([])
      }
      setCurrentProfile(data.currentProfile || null)
      setHasProfile(Boolean(data.hasProfile || data.currentProfile))
      setOptions(nextOptions)
      if (data.config) {
        const normalized = { ...data.config }
        normalized.keywords = parseKeywordsFromDb(data.config.keywords)
        normalized.searchJobLimit = normalizeSearchJobLimit(data.config.searchJobLimit)
        normalized.cityCode = normalizeCityCodeForSelect(data.config.cityCode, nextOptions.city)
        normalized.salary = normalizeSalaryCodeForSelect(data.config.salary, nextOptions.salary)
        if (isLegacyZhilianValue(data.config.cityCode) && normalized.cityCode !== String(data.config.cityCode || '').trim()) {
          nextWarnings.city ||= '已将旧版城市值改为智联官方城市参数，请确认后保存。'
        }
        if (isLegacyZhilianValue(data.config.salary) && normalized.salary !== String(data.config.salary || '').trim()) {
          nextWarnings.salary ||= '已将旧版自定义薪资改为智联官方薪资区间，请重新选择后保存。'
        }
        setSearchJobLimitInput(String(normalized.searchJobLimit))
        setConfig(normalized)
      }
      setConfigWarnings(nextWarnings)
    } catch (e) {
      console.error('[智联] 获取配置失败:', e)
    } finally {
      setLoadingConfig(false)
    }
  }

  useEffect(() => { fetchAllData() }, [])

  const checkChromeBridge = async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      const status = await getZhilianPageStatus()
      setChromeBridgeReady(status.connected)
      setIsLoggedIn(status.ready)
      setLoginMessage(status.message)
    } finally {
      checkingRef.current = false
      setCheckingLogin(false)
    }
  }

  const checkOpenClawStatus = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/zhilian/openclaw/status`)
      const data = await response.json()
      const ready = !!data.success
      setOpenClawReady(ready)
      setOpenClawMessage(data.message || (ready ? 'OpenClaw实验通路可用。' : 'OpenClaw实验通路不可用。'))
      appendProgressLog({
        type: ready ? 'success' : 'warning',
        message: data.message || (ready ? 'OpenClaw实验通路可用。' : 'OpenClaw实验通路不可用。'),
      })
    } catch {
      setOpenClawReady(false)
      setOpenClawMessage('OpenClaw实验通路不可用，请确认 openclaw CLI 和 browser 插件已安装。')
      appendProgressLog({ type: 'warning', message: 'OpenClaw实验通路不可用，请确认 openclaw CLI 和 browser 插件已安装。' })
    }
  }

  // 探测后端可用性（与 51job 保持一致风格）
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/zhilian/config`, { method: 'GET' })
        const ok = !!res && res.ok
        setBackendAvailable(ok)
        if (ok) {
          await fetchAllData()
        } else {
          setLoadingConfig(false)
        }
      } catch (e) {
        setBackendAvailable(false)
        setLoadingConfig(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleStartDelivery = async (resumeIncomplete = false) => {
    if (startingRef.current || isDelivering) return
    startingRef.current = true
    setIsStarting(true)
    try {
      const keywords = normalizeKeywordTokens(config.keywords)
      if (!keywords.length) {
        appendProgressLog({ type: 'error', message: ZHILIAN_KEYWORD_REQUIRED_MESSAGE })
        alert(ZHILIAN_KEYWORD_REQUIRED_MESSAGE)
        return
      }
      if (keywords.length > MAX_JOB_KEYWORDS) {
        const message = `岗位关键词最多选择 ${MAX_JOB_KEYWORDS} 个，请先删减后再开始扫描。`
        appendProgressLog({ type: 'error', message })
        alert(message)
        return
      }
      if (!hasProfile) {
        appendProgressLog({ type: 'error', message: '请先在简历配置页新建档案。' })
        alert('请先在简历配置页新建档案。')
        return
      }
      const profileId = normalizeScanProfileId(currentProfile?.id)
      if (!profileId) {
        appendProgressLog({ type: 'error', message: '当前档案 ID 无效，请刷新档案后重试。' })
        return
      }
      const setup = await validateSetupForPlatform('zhilian', { openPlatformPageIfMissing: true })
      if (!setup.ready) {
        const message = formatSetupMissingMessage('智联招聘', setup.missing)
        appendProgressLog({ type: 'error', message })
        alert(message)
        return
      }
      if (profileRef.current !== profileId) return
      const runId = resumeIncomplete && scanResult?.runId ? scanResult.runId : `zhilian-${Date.now()}`
      if (!filterCatalog || filterError) { appendProgressLog({type:'error',message:filterError || '官方筛选选项尚未加载，请稍后重试'}); return }
      setActiveRunId(runId)
      scanRunRef.current = runId
      setLatestRunId(runId)
      setScanResult(null)
      setIsStopping(false)
      setIsDelivering(true)
      appendProgressLog({ type: 'info', message: '已发送智联招聘 Chrome扫描请求：扫描会持续采集，AI 在后台分析，结果稍后进入待确认列表。' })
      const searchJobLimit = commitSearchJobLimit()
      const data = await sendChromeBridgeMessage({
        type: 'ZHILIAN_SCAN_START',
        resumeIncomplete,
        platform: 'zhilian',
        profileId,
        runId,
        config: {
          ...config,
          keywords,
          searchJobLimit,
        },
      })
      if (data.success) {
        appendProgressLog({ type: 'info', message: data.message || '智联招聘 Chrome扫描任务已启动，等待Chrome页面采集岗位。' })
      } else {
        appendProgressLog({ type: 'error', message: data.message || '智联招聘扫描启动失败。' })
        setIsDelivering(false)
        setIsStopping(false)
        setActiveRunId(null)
      }
    } catch (error) {
      appendProgressLog({ type: 'error', message: '智联招聘扫描启动失败：网络或服务异常。' })
      setIsDelivering(false)
      setIsStopping(false)
      setActiveRunId(null)
    } finally {
      startingRef.current = false
      setIsStarting(false)
    }
  }

  const handleStopDelivery = async () => {
    if (isStopping) return
    setIsStopping(true)
    try {
      const runId = activeRunId
      const profileId = normalizeScanProfileId(currentProfile?.id)
      if (!profileId) throw new Error('当前档案 ID 无效')
      await fetch(`${API_BASE}/api/zhilian/chrome/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, profileId }),
      }).catch(() => null)
      const data = await sendChromeBridgeMessage({ type: 'ZHILIAN_SCAN_STOP', platform: 'zhilian', runId, profileId }, 1500)
      if (data.success) {
        appendProgressLog({ type: 'warning', message: data.message || '智联招聘扫描停止请求已处理。' })
        await syncZhilianScanStatus(true, true)
      } else {
        appendProgressLog({ type: 'warning', message: data.message || '已发送后端停止请求，正在等待 Chrome 页面停止。' })
        setIsDelivering(true)
      }
    } catch (error) {
      appendProgressLog({ type: 'warning', message: '已发送后端停止请求，正在等待 Chrome 页面停止。' })
      setIsDelivering(true)
    } finally {
      window.setTimeout(() => {
        syncZhilianScanStatus(true, true)
      }, 1200)
      window.setTimeout(() => {
        setIsStopping(false)
      }, 5000)
    }
  }

  const handleOpenClawProbe = async () => {
    if (!hasProfile) {
      appendProgressLog({ type: 'error', message: '请先在简历配置页新建档案。' })
      return
    }
    if (openClawRunning) return
    setOpenClawRunning(true)
    appendProgressLog({ type: 'info', message: 'OpenClaw智联实验采集已启动：只读取页面并提交现有AI分析入库接口，不会真实申请职位。' })
    try {
      const searchJobLimit = commitSearchJobLimit()
      const probeResponse = await fetch(`${API_BASE}/api/zhilian/openclaw/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: 'user',
          detailLimit: 5,
          config: { ...config, searchJobLimit },
        }),
      })
      const probeData = await probeResponse.json()
      if (!probeResponse.ok || !probeData.success) {
        appendProgressLog({ type: 'error', message: probeData.message || 'OpenClaw智联实验采集失败。' })
        return
      }

      const jobs = Array.isArray(probeData.jobs) ? probeData.jobs : []
      appendProgressLog({ type: 'info', message: `OpenClaw智联实验采集到 ${jobs.length} 个岗位，正在复用现有AI分析入库接口。` })
      if (jobs.length === 0) {
        appendProgressLog({ type: 'warning', message: 'OpenClaw智联实验采集未返回岗位，请检查智联登录态、搜索页或安全验证。' })
        return
      }

      const submitResponse = await fetch(`${API_BASE}/api/zhilian/chrome/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: `zhilian-openclaw-${Date.now()}`,
          keyword: probeData.keyword || normalizeKeywordTokens(config.keywords)[0] || '',
          autoDeliver: false,
          jobs,
        }),
      })
      const submitData = await submitResponse.json()
      if (!submitResponse.ok || !submitData.success) {
        appendProgressLog({ type: 'error', message: submitData.message || 'OpenClaw智联岗位提交失败。' })
        return
      }
      appendProgressLog({
        type: 'success',
        message: `OpenClaw智联实验提交完成：采集 ${submitData.received ?? jobs.length} 个，入库 ${submitData.saved ?? 0} 个，入队 ${submitData.queued ?? 0} 个。`,
      })
    } catch {
      appendProgressLog({ type: 'error', message: 'OpenClaw智联实验采集失败：网络、服务或CLI异常。' })
    } finally {
      setOpenClawRunning(false)
    }
  }

  const handleOpenPlatform = async () => {
    setCheckingLogin(true)
    await checkChromeBridge()
  }

  const handleSaveConfig = async () => {
    const keywords = normalizeKeywordTokens(config.keywords)
    if (!keywords.length) {
      setSaveResult({ success: false, message: ZHILIAN_KEYWORD_REQUIRED_MESSAGE })
      setShowSaveDialog(true)
      return
    }
    if (keywords.length > MAX_JOB_KEYWORDS) {
      setSaveResult({ success: false, message: `岗位关键词最多选择 ${MAX_JOB_KEYWORDS} 个，请先删减后再保存。` })
      setShowSaveDialog(true)
      return
    }
    if (!hasProfile) {
      setSaveResult({ success: false, message: '请先在简历配置页新建档案。' })
      setShowSaveDialog(true)
      return
    }
    try {
      const searchJobLimit = commitSearchJobLimit()
      const cityCode = normalizeCityCodeForSelect(config.cityCode, options.city)
      const salary = normalizeSalaryCodeForSelect(config.salary, options.salary)
      if (!options.city.some((option) => option.code === cityCode)) {
        setSaveResult({ success: false, message: '城市选项还没有加载完成，请刷新页面后再保存。' })
        setShowSaveDialog(true)
        return
      }
      if (!options.salary.some((option) => option.code === salary)) {
        setSaveResult({ success: false, message: '薪资选项还没有加载完成，请刷新页面后再保存。' })
        setShowSaveDialog(true)
        return
      }
      const payload = {
        ...config,
        cityCode,
        salary,
        keywords: serializeJobKeywords(keywords),
        searchJobLimit,
      }
      setConfig((current) => ({ ...current, cityCode, salary, searchJobLimit }))
      const response = await fetch(`${API_BASE}/api/zhilian/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        await fetchAllData()
        setSaveResult({ success: true, message: '保存成功，配置已更新。' })
      } else {
        setSaveResult({ success: false, message: '保存失败：后端返回异常状态。' })
      }
      setShowSaveDialog(true)
    } catch (error) {
      console.error('[智联] 保存配置失败:', error)
      setSaveResult({ success: false, message: '保存失败：网络或服务异常。' })
      setShowSaveDialog(true)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BiBriefcase className="text-2xl" />}
        title="智联招聘配置"
        subtitle="配置智联招聘平台的求职参数"
        iconClass="text-white"
        accentBgClass="bg-purple-500"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={handleOpenPlatform} size="sm" className="app-button-soft px-4">
              <BiLinkExternal className="mr-1" /> 检查智联状态
            </Button>
            {checkingLogin ? (
              <Button size="sm" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 text-slate-500 cursor-not-allowed shadow-sm">
                <BiPlay className="mr-1" /> 检查页面中...
              </Button>
            ) : !chromeBridgeReady ? (
              <Button size="sm" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 text-slate-500 cursor-not-allowed shadow-sm">
                <BiPlay className="mr-1" /> 扩展未连接
              </Button>
	            ) : isDelivering ? (
	              <Button onClick={handleStopDelivery} size="sm" disabled={isStopping} className="app-button-danger px-4 disabled:opacity-70">
	                <BiStop className="mr-1" /> {isStopping ? '停止中...' : '停止扫描'}
	              </Button>
	            ) : (
	              <Button onClick={() => { void handleStartDelivery() }} size="sm" disabled={isStarting || !hasProfile || normalizeKeywordTokens(config.keywords).length > MAX_JOB_KEYWORDS} className="app-button-success px-4">
	                <BiPlay className="mr-1" /> {isStarting ? '启动中...' : '开始扫描'}
	              </Button>
	            )}
            <Button asChild size="sm" variant="outline"><a href="https://www.zhaopin.com/" target="_blank" rel="noreferrer">打开智联 / 管理登录</a></Button>
            <Button onClick={handleSaveConfig} size="sm" disabled={!hasProfile || normalizeKeywordTokens(config.keywords).length > MAX_JOB_KEYWORDS} className="app-button-primary px-4">
              <BiSave className="mr-1" /> 保存配置
            </Button>
          </div>
        }
      />

      <CurrentProfileBadge profile={currentProfile} onRefresh={fetchAllData} />
      {!backendAvailable && <p role="alert" className="text-sm text-red-700">后端连接不可用，请检查服务后刷新页面。</p>}

      {!hasProfile ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          未新建档案时不能保存智联配置或扫描岗位。请到“简历配置”新建/切换档案。
        </div>
      ) : null}

	      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <p role="status" className={isLoggedIn ? 'text-sm text-emerald-700' : 'text-sm text-amber-700'}>{loginMessage}</p>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/zhilian/analysis">智联分析</Link></Button>
          {latestRunId && currentProfile && <Button asChild><Link href={`/zhilian/analysis?profileId=${currentProfile.id}&scanRunId=${encodeURIComponent(latestRunId)}`}>查看本次扫描结果</Link></Button>}
        </div>
      </div>
      <div className="space-y-6">
          <ProgressLogCard
            logs={progressLogs}
            isRunning={isDelivering}
            isStopping={isStopping}
            onStop={handleStopDelivery}
            onClear={() => setProgressLogs([])}
            summary={<>
              {latestRunId && <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground" aria-live="polite">
                <span>已入库 {runProgress.collected || 0} 个岗位 · 入队 {runProgress.enqueued || 0} 个</span>
                <span>AI 分析：完成 {runProgress.completed || 0} · 执行 {runProgress.running || 0} · 等待 {runProgress.pending || 0} · 失败 {runProgress.failed || 0} · 待核对 {runProgress.unknown || 0}</span>
                {submissionProgress.confirmed !== undefined && <span>当前关键词确认 {submissionProgress.confirmed} 个 · 待提交 {submissionProgress.pending} 个</span>}
              </div>}
              {scanResult && scanResult.keywordResults.length > 0 && <details className="text-sm">
                <summary className="cursor-pointer py-2 text-muted-foreground">查看关键词采集明细</summary>
                <ScanResult result={scanResult} busy={isDelivering || isStarting} />
              </details>}
              {scanResult && !isDelivering && scanResult.keywordResults.some(item => !['complete', 'exhausted'].includes(item.outcome)) && <Button size="sm" variant="outline" disabled={isStarting} onClick={() => { void handleStartDelivery(true) }}>继续未完成关键词</Button>}
            </>}
          />

	          <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BiBriefcase className="text-primary" />
                智联招聘平台说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">请先在你自己的 Chrome 里登录智联招聘，并加载本项目 chrome-extension 目录。</p>
	                <p className="text-sm text-muted-foreground">点击“开始扫描”会让 Chrome 扩展使用当前 Chrome 登录态搜索、持续采集岗位；AI 会在后台分析，结果稍后进入待确认列表。</p>
                <p className="text-sm text-muted-foreground">真实申请只会在投递分析页由你点击确认后触发。</p>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BiCodeAlt className="text-primary" />
                OpenClaw实验通路
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  当前状态：{openClawReady ? 'OpenClaw可用' : '未验证'}。{openClawMessage || '点击检查后会尝试读取 OpenClaw browser 插件状态。'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={checkOpenClawStatus} size="sm" variant="outline" className="rounded-lg px-4">
                    <BiLinkExternal className="mr-1" /> 检查OpenClaw
                  </Button>
                  <Button
                    onClick={handleOpenClawProbe}
                    size="sm"
                    disabled={!hasProfile || openClawRunning}
                    className="app-button-soft px-4"
                  >
                    <BiCodeAlt className="mr-1" /> {openClawRunning ? '实验采集中...' : 'OpenClaw实验采集'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">实验采集会走后台AI分析链路，不会直接申请智联岗位。</p>
              </div>
            </CardContent>
          </Card>

          {/* 配置表单 */}
          <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BiBriefcase className="text-primary" />
                配置参数
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingConfig ? (
                <p className="text-sm text-muted-foreground">配置加载中...</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>搜索关键词</Label>
                    <KeywordTagInput
                      value={normalizeKeywordTokens(config.keywords)}
                      onChange={(keywords) => setConfig((current) => ({ ...current, keywords: serializeJobKeywords(keywords) }))}
                      recommendations={recommendedKeywords}
                      disabled={!hasProfile}
                    />
                    {!normalizeKeywordTokens(config.keywords).length && (
                      <p className="text-sm text-destructive">{ZHILIAN_KEYWORD_REQUIRED_MESSAGE}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>城市</Label>
                    <Select
                      value={config.cityCode || DEFAULT_ZHILIAN_CITY_CODE}
                      onChange={(e) => setConfig((c) => ({ ...c, cityCode: e.target.value, filters:resetCityFilters(c.filters) }))}
                      placeholder="请选择城市"
                      disabled={!hasProfile}
                    >
                      {options.city.map((o) => (
                        <option key={o.code} value={o.code}>{o.name}</option>
                      ))}
                    </Select>
                    {configWarnings.city && (
                      <p className="text-xs text-amber-600 dark:text-amber-300">{configWarnings.city}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>每关键词后台 AI 分析岗位数</Label>
                    <Select
                      value={searchJobLimitInput}
                      onChange={(e) => commitSearchJobLimit(e.target.value)}
                      disabled={!hasProfile}
                    >
                      {Number(searchJobLimitInput) % 5 !== 0 && (
                        <option value={searchJobLimitInput}>{searchJobLimitInput}（已保存）</option>
                      )}
                      {Array.from({ length: 40 }, (_, index) => (index + 1) * 5).map((limit) => (
                        <option key={limit} value={String(limit)}>{limit}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>薪资范围</Label>
                    <Select
                      value={config.salary || DEFAULT_ZHILIAN_SALARY_CODE}
                      onChange={(e) => setConfig((c) => ({ ...c, salary: e.target.value }))}
                      placeholder="请选择薪资范围"
                      disabled={!hasProfile}
                    >
                      {options.salary.map((o) => (
                        <option key={o.code} value={o.code}>{o.name}</option>
                      ))}
                    </Select>
                    {configWarnings.salary && (
                      <p className="text-xs text-amber-600 dark:text-amber-300">{configWarnings.salary}</p>
                    )}
                  </div>
                  {filterError && <p role="alert" className="col-span-full text-destructive">{filterError}</p>}
                  {filterCatalog && <FilterControls key={filterCatalog.cityCode} catalog={filterCatalog} filters={config.filters||{}} disabled={!hasProfile} onChange={filters=>setConfig(c=>({...c,filters}))}/>}
                </div>
              )}
            </CardContent>
          </Card>
      </div>

      {/* 操作结果弹框 */}
      {showSaveDialog && saveResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Card className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BiSave className={saveResult.success ? 'text-green-500' : 'text-red-500'} />
                {saveResult.success ? '操作成功' : '操作失败'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{saveResult.message}</p>
              <Button onClick={() => setShowSaveDialog(false)} className={`rounded-full px-4 ${saveResult.success ? 'bg-green-500' : 'bg-red-500'} text-white`}>知道了</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function ProgressLogCard({
  logs,
  isRunning,
  isStopping,
  onStop,
  onClear,
  summary,
}: {
  logs: ProgressLog[]
  isRunning: boolean
  isStopping: boolean
  onStop: () => void
  onClear: () => void
  summary: React.ReactNode
}) {
  const badgeClass = (type: string) => {
    if (type === 'success') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    if (type === 'error') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    if (type === 'warning') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
  }

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return ''
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
  }

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BiBriefcase className="text-primary" />
            采集日志
          </CardTitle>
          <p className="text-sm text-muted-foreground">扫描进度、采集结果和错误信息集中显示</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs ${isRunning ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {isStopping ? '停止中' : isRunning ? '扫描中' : '空闲'}
          </span>
          {isRunning && (
            <Button onClick={onStop} size="sm" variant="destructive" disabled={isStopping} className="rounded-lg px-3">
              <BiStop className="mr-1" /> {isStopping ? '停止中...' : '停止'}
            </Button>
          )}
          <Button onClick={onClear} size="sm" variant="ghost" className="rounded-lg px-3">清空</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary}
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">点击“开始扫描”后，这里会显示搜索、后台AI队列、待确认和错误信息。</p>
        ) : (
          <div className="max-h-[32rem] space-y-2 overflow-auto rounded-lg border border-white/20 bg-white/40 p-3 dark:bg-neutral-900/40">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 rounded-md bg-white/70 px-3 py-2 text-sm shadow-sm dark:bg-neutral-900/70">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${badgeClass(log.type)}`}>{log.type}</span>
                <span className="min-w-0 flex-1 break-words text-foreground">{log.message}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatTime(log.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
