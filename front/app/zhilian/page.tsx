'use client'

import { useState, useEffect, useCallback } from 'react'
import { createSSEWithBackoff } from '@/lib/sse'
import { getChromeBridgeStatus, sendChromeBridgeMessage, subscribeChromeBridgeEvents } from '@/lib/chromeBridge'
import { API_BASE } from '@/lib/api'
import { BiLogOut, BiSave, BiBriefcase, BiPlay, BiStop, BiLinkExternal, BiCodeAlt } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AnalysisContent from '@/app/zhilian/analysis/AnalysisContent'
import PageHeader from '@/app/components/PageHeader'
import CurrentProfileBadge, { type CurrentProfile } from '@/app/components/CurrentProfileBadge'
import { formatSetupMissingMessage, validateSetupForPlatform } from '@/lib/setupChecklist'

interface ZhilianConfig {
  id?: number
  keywords?: string
  cityCode?: string
  salary?: string
  searchJobLimit?: number
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

const normalizeKeywordTokens = (value: unknown): string[] => {
  const keywords: string[] = []

  const append = (rawValue: unknown) => {
    if (Array.isArray(rawValue)) {
      rawValue.forEach(append)
      return
    }

    const raw = String(rawValue ?? '').trim()
    if (!raw) return
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          parsed.forEach(append)
          return
        }
      } catch {
        append(raw.slice(1, -1))
        return
      }
    }

    raw.split(/[,，;；\n\r]+/).forEach((item) => {
      const keyword = item.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '').trim()
      if (!keyword) return
      if (!keywords.some((existing) => existing.toLocaleLowerCase() === keyword.toLocaleLowerCase())) {
        keywords.push(keyword)
      }
    })
  }

  append(value)
  return keywords
}

const isTerminalScanPayload = (payload: Record<string, unknown>) => {
  const stage = String(payload.stage || '')
  const message = String(payload.message || '')
  const operation = String(payload.operation || '')
  return (operation === 'scan' && ['complete', 'stopped', 'error', 'blocked'].includes(stage))
    || message.includes('扫描完成')
    || message.includes('扫描已停止')
    || message.includes('扫描失败')
}

const shouldRefreshAnalysisFromProgress = (payload: Record<string, unknown>) => {
  const stage = String(payload.stage || '')
  const message = String(payload.message || '')
  return ['submitted', 'complete'].includes(stage)
    || message.includes('已提交后台AI队列')
    || message.includes('待确认')
    || message.includes('跳过：')
    || message.includes('AI分析失败')
    || message.includes('恢复已有分析')
}

export default function ZhilianPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isDelivering, setIsDelivering] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(true)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showLogoutResultDialog, setShowLogoutResultDialog] = useState(false)
  const [logoutResult, setLogoutResult] = useState<{ success: boolean; message: string } | null>(null)
  const [backendAvailable, setBackendAvailable] = useState(true)
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([])
  const [chromeBridgeReady, setChromeBridgeReady] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  const [openClawReady, setOpenClawReady] = useState(false)
  const [openClawRunning, setOpenClawRunning] = useState(false)
  const [openClawMessage, setOpenClawMessage] = useState('')
  const [analysisRefreshSignal, setAnalysisRefreshSignal] = useState(0)
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(null)
  const [hasProfile, setHasProfile] = useState(false)

  const [config, setConfig] = useState<ZhilianConfig>({ keywords: '', cityCode: DEFAULT_ZHILIAN_CITY_CODE, salary: DEFAULT_ZHILIAN_SALARY_CODE, searchJobLimit: 20 })
  const [searchJobLimitInput, setSearchJobLimitInput] = useState('20')
  const [options, setOptions] = useState<ZhilianOptions>({ city: [], salary: [] })
  const [configWarnings, setConfigWarnings] = useState<Record<string, string>>({})
  const [loadingConfig, setLoadingConfig] = useState(true)

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
    try {
      const status = await sendChromeBridgeMessage({
        type: 'ZHILIAN_SCAN_STATUS',
        platform: 'zhilian',
      }, 2000)
      const running = Boolean(status.isRunning || status.hasStoredTask)
      if (running) {
        setIsDelivering(true)
        setIsStopping(keepStopping)
        const runId = typeof status.runId === 'string' && status.runId.trim() ? status.runId.trim() : null
        if (runId) setActiveRunId(runId)
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
  }, [appendProgressLog])

  useEffect(() => {
    checkChromeBridge()
    syncZhilianScanStatus(true)

    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      console.warn('[智联招聘] EventSource 不可用，无法连接SSE')
      setCheckingLogin(false)
      return
    }

    const client = createSSEWithBackoff(`${API_BASE}/api/jobs/login-status/stream`, {
      onOpen: () => console.log('[智联招聘 SSE] 连接已打开'),
      onError: (e, attempt, delay) => {
        console.warn(`[智联招聘 SSE] 连接错误，第${attempt}次重连，延迟 ${delay}ms`, e)
        setCheckingLogin(false)
      },
      listeners: [
        {
          name: 'connected',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              console.log('[智联招聘 SSE] connected事件数据:', data)
              console.log('[智联招聘 SSE] zhilianLoggedIn状态:', data.zhilianLoggedIn)
              setIsLoggedIn(data.zhilianLoggedIn || false)
              setCheckingLogin(false)
            } catch (error) {
              console.error('[智联招聘 SSE] 解析连接消息失败:', error)
            }
          },
        },
        {
          name: 'login-status',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              console.log('[智联招聘 SSE] login-status事件数据:', data)
              if (data.platform === 'zhilian') {
                console.log('[智联招聘 SSE] 智联登录状态变更:', data.isLoggedIn)
                setIsLoggedIn(data.isLoggedIn)
                setCheckingLogin(false)
              }
            } catch (error) {
              console.error('[智联招聘 SSE] 解析登录状态消息失败:', error)
            }
          },
        },
        { name: 'ping', handler: () => {} },
      ],
    })

    return () => client.close()
  }, [syncZhilianScanStatus])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchAllData()
        setAnalysisRefreshSignal((value) => value + 1)
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

      appendProgressLog({
        type: payload.type || 'info',
        message: payload.message || '',
        timestamp: payload.timestamp,
      })

      if (shouldRefreshAnalysisFromProgress(payload)) {
        setAnalysisRefreshSignal((value) => value + 1)
      }
      if (isTerminalScanPayload(payload)) {
        setIsDelivering(false)
        setIsStopping(false)
        setActiveRunId(null)
      }
    })
  }, [appendProgressLog])

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
              appendProgressLog({
                type: data.type || 'info',
                message: data.message || '',
                timestamp: data.timestamp,
              })
              if (shouldRefreshAnalysisFromProgress(data)) {
                setAnalysisRefreshSignal((value) => value + 1)
              }
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
  }, [appendProgressLog])

  // 统一兼容中英文逗号、JSON数组、换行和多余空白。
  const parseKeywordsFromDb = (raw?: string): string => {
    return normalizeKeywordTokens(raw).join(', ')
  }

  const serializeKeywordsForDb = (display?: unknown): string => {
    return JSON.stringify(normalizeKeywordTokens(display))
  }

  const fetchAllData = async () => {
    setLoadingConfig(true)
    try {
      const res = await fetch(`${API_BASE}/api/zhilian/config`)
      const data = await res.json()
      const nextOptions: ZhilianOptions = {
        city: Array.isArray(data.options?.city) ? data.options.city : [],
        salary: Array.isArray(data.options?.salary) ? data.options.salary : [],
      }
      const nextWarnings: Record<string, string> = { ...(data.warnings || {}) }
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
    try {
      const status = await getChromeBridgeStatus()
      const ready = !!status.success
      setChromeBridgeReady(ready)
      setIsLoggedIn(ready)
    } catch {
      setChromeBridgeReady(false)
      setIsLoggedIn(false)
    } finally {
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

  const handleStartDelivery = async () => {
    try {
      const keywords = normalizeKeywordTokens(config.keywords)
      if (!keywords.length) {
        appendProgressLog({ type: 'error', message: ZHILIAN_KEYWORD_REQUIRED_MESSAGE })
        alert(ZHILIAN_KEYWORD_REQUIRED_MESSAGE)
        return
      }
      if (!hasProfile) {
        appendProgressLog({ type: 'error', message: '请先在简历配置页新建档案。' })
        alert('请先在简历配置页新建档案。')
        return
      }
      const setup = await validateSetupForPlatform('zhilian')
      if (!setup.ready) {
        const message = formatSetupMissingMessage('智联招聘', setup.missing)
        appendProgressLog({ type: 'error', message })
        alert(message)
        return
      }
      const runId = `zhilian-${Date.now()}`
      setActiveRunId(runId)
      setIsStopping(false)
      setIsDelivering(true)
      appendProgressLog({ type: 'info', message: '已发送智联招聘 Chrome扫描请求：扫描会持续采集，AI 在后台分析，结果稍后进入待确认列表。' })
      const searchJobLimit = commitSearchJobLimit()
      const data = await sendChromeBridgeMessage({
        type: 'ZHILIAN_SCAN_START',
        platform: 'zhilian',
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
    }
  }

  const handleStopDelivery = async () => {
    if (isStopping) return
    setIsStopping(true)
    try {
      const runId = activeRunId
      await fetch(`${API_BASE}/api/zhilian/chrome/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(() => null)
      const data = await sendChromeBridgeMessage({ type: 'ZHILIAN_SCAN_STOP', platform: 'zhilian', runId }, 1500)
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
          keyword: probeData.keyword || config.keywords,
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
    try {
      const data = await sendChromeBridgeMessage({ type: 'GET_JOBS_EXTENSION_PING' }, 1500)
      if (data.success) {
        setChromeBridgeReady(true)
        setIsLoggedIn(true)
        appendProgressLog({ type: 'success', message: 'Chrome扩展已连接，可以使用当前Chrome登录态扫描智联招聘。' })
        setSaveResult({
          success: true,
          message: 'Chrome扩展已连接，可以开始扫描。',
        })
      } else {
        setChromeBridgeReady(false)
        setSaveResult({ success: false, message: data.message || 'Chrome扩展未连接，请加载 chrome-extension 目录。' })
      }
      setShowSaveDialog(true)
    } catch {
      setChromeBridgeReady(false)
      setSaveResult({ success: false, message: 'Chrome扩展未连接，请加载 chrome-extension 目录。' })
      setShowSaveDialog(true)
    }
  }

  const triggerLogout = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/zhilian/logout`, { method: 'POST' })
      const data = await response.json()
      setIsLoggedIn(false)
      setLogoutResult({ success: data.success, message: data.success ? '已退出登录，Cookie已清空。' : data.message })
      setShowLogoutResultDialog(true)
    } catch (error) {
      setLogoutResult({ success: false, message: '退出登录失败：网络或服务异常。' })
      setShowLogoutResultDialog(true)
    }
  }

  const handleSaveCookie = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/cookie/save?platform=zhilian`, { method: 'POST' })
      const data = await response.json()
      setSaveResult({ success: data.success, message: data.success ? '配置保存成功。' : data.message })
      setShowSaveDialog(true)
    } catch (error) {
      setSaveResult({ success: false, message: '配置保存失败：网络或服务异常。' })
      setShowSaveDialog(true)
    }
  }

  const handleSaveConfig = async () => {
    const keywords = normalizeKeywordTokens(config.keywords)
    if (!keywords.length) {
      setSaveResult({ success: false, message: ZHILIAN_KEYWORD_REQUIRED_MESSAGE })
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
        keywords: serializeKeywordsForDb(keywords),
        searchJobLimit,
      }
      setConfig((current) => ({ ...current, cityCode, salary, searchJobLimit }))
      const response = await fetch(`${API_BASE}/api/zhilian/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        try { await fetch(`${API_BASE}/api/cookie/save?platform=zhilian`, { method: 'POST' }) } catch {}
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
              <BiLinkExternal className="mr-1" /> 检查Chrome扩展
            </Button>
            {checkingLogin ? (
              <Button size="sm" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 text-slate-500 cursor-not-allowed shadow-sm">
                <BiPlay className="mr-1" /> 检查扩展中...
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
	              <Button onClick={handleStartDelivery} size="sm" disabled={!hasProfile} className="app-button-success px-4">
	                <BiPlay className="mr-1" /> 开始扫描
	              </Button>
	            )}
            <Button onClick={() => setShowLogoutDialog(true)} size="sm" className="app-button-danger px-4">
              <BiLogOut className="mr-1" /> 退出登录
            </Button>
            <Button onClick={handleSaveConfig} size="sm" disabled={!hasProfile} className="app-button-primary px-4">
              <BiSave className="mr-1" /> 保存配置
            </Button>
          </div>
        }
      />

      <CurrentProfileBadge profile={currentProfile} onRefresh={fetchAllData} />

      {!hasProfile ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          未新建档案时不能保存智联配置或扫描岗位。请到“简历配置”新建/切换档案。
        </div>
      ) : null}

	      <Tabs defaultValue="config" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="config">平台配置</TabsTrigger>
          <TabsTrigger value="analytics">投递分析</TabsTrigger>
        </TabsList>

	        <TabsContent value="config" className="space-y-6 mt-6">
	          <ProgressLogCard
              logs={progressLogs}
              isRunning={isDelivering}
              isStopping={isStopping}
              onStop={handleStopDelivery}
              onClear={() => setProgressLogs([])}
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
                    <Label>搜索关键词（逗号分隔）</Label>
                    <Input
                      placeholder="如：Java, 后端, Spring"
                      value={config.keywords || ''}
                      onChange={(e) => setConfig((c) => ({ ...c, keywords: e.target.value }))}
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
                      onChange={(e) => setConfig((c) => ({ ...c, cityCode: e.target.value }))}
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
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      step={1}
                      placeholder="20"
                      value={searchJobLimitInput}
                      onChange={(e) => {
                        const rawValue = e.target.value
                        setSearchJobLimitInput(rawValue)
                        const parsed = Number(rawValue)
                        if (Number.isFinite(parsed) && parsed >= 1) {
                          setConfig((c) => ({ ...c, searchJobLimit: Math.min(Math.floor(parsed), 200) }))
                        }
                      }}
                      onBlur={() => commitSearchJobLimit(searchJobLimitInput)}
                      disabled={!hasProfile}
                    />
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
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6 mt-6">
          <AnalysisContent refreshSignal={analysisRefreshSignal} />
        </TabsContent>
      </Tabs>

      {/* 退出确认弹框 */}
      {showLogoutDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BiLogOut className="text-red-500" /> 确认退出登录
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">退出后将清除Cookie并切换为未登录状态。</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowLogoutDialog(false)} className="rounded-lg px-4">取消</Button>
                <Button onClick={async () => { await triggerLogout(); setShowLogoutDialog(false) }} className="app-button-danger px-4">确认退出</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 退出登录结果弹框 */}
      {showLogoutResultDialog && logoutResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Card className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BiLogOut className={logoutResult.success ? 'text-green-500' : 'text-red-500'} />
                {logoutResult.success ? '退出登录成功' : '退出登录失败'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{logoutResult.message}</p>
              <Button onClick={() => setShowLogoutResultDialog(false)} className={`rounded-full px-4 ${logoutResult.success ? 'bg-green-500' : 'bg-red-500'} text-white`}>知道了</Button>
            </CardContent>
          </Card>
        </div>
      )}

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
}: {
  logs: ProgressLog[]
  isRunning: boolean
  isStopping: boolean
  onStop: () => void
  onClear: () => void
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
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BiBriefcase className="text-primary" />
            运行日志
          </CardTitle>
          <p className="text-sm text-muted-foreground">后台自动化浏览器的扫描进度和结果</p>
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
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">点击“开始扫描”后，这里会显示搜索、后台AI队列、待确认和错误信息。</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-auto rounded-lg border border-white/20 bg-white/40 p-3 dark:bg-neutral-900/40">
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
