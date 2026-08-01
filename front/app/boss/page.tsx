'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createSSEWithBackoff } from '@/lib/sse'
import { getChromeBridgeStatus, sendChromeBridgeMessage, subscribeChromeBridgeEvents, type ChromeBridgeResponse } from '@/lib/chromeBridge'
import { API_BASE } from '@/lib/api'
import { createPortal } from 'react-dom'
import { BiBriefcase, BiSave, BiSearch, BiMoney, BiBuilding, BiBarChart, BiTrash, BiPlus, BiPlay, BiStop, BiLogOut, BiLinkExternal } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import PageHeader from '@/app/components/PageHeader'
import AnalysisContent from '@/app/boss/analysis/AnalysisContent'
import CurrentProfileBadge, { type CurrentProfile } from '@/app/components/CurrentProfileBadge'
import { formatSetupMissingMessage, validateSetupForPlatform } from '@/lib/setupChecklist'

interface BossConfig {
  id?: number
  debugger?: number
  waitTime?: number
  keywords?: string
  cityCode?: string
  industry?: string
  jobType?: string
  searchJobLimit?: number
  experience?: string
  degree?: string
  salary?: string
  scale?: string
  stage?: string
  sayHi?: string
  enableAi?: number
  sendImgResume?: number
  filterDeadHr?: number
  autoDeliver?: number
  deadStatus?: string
}

interface BossOption {
  id: number
  type: string
  name: string
  code: string
  // 可选的排序字段（来自后端/数据库），用于前端排序显示
  sort_order?: number
  sortOrder?: number
}

interface BossOptions {
  city: BossOption[]
  industry: BossOption[]
  experience: BossOption[]
  jobType: BossOption[]
  salary: BossOption[]
  degree: BossOption[]
  scale: BossOption[]
  stage: BossOption[]
}

interface BlacklistItem {
  id: number
  value: string
  type: string
}

type DialogKind = 'save' | 'platform'
type BossStep = 'config' | 'scan' | 'confirm'

const UNLIMITED_OPTION_CODE = '0'

const normalizeUnlimitedSelection = (list: string[]): string[] => {
  if (!list || list.length <= 1) return list || []
  return list.includes(UNLIMITED_OPTION_CODE)
    ? list.filter((code) => code !== UNLIMITED_OPTION_CODE)
    : list
}

interface ProgressLog {
  id: number
  type: string
  message: string
  timestamp?: number
}

interface BossDiagnosticsResponse extends ChromeBridgeResponse {
  currentUrl?: string
  title?: string
  isLoginPage?: boolean
  isSecurityPage?: boolean
  detailLinkCount?: number
  selectorCounts?: Record<string, number>
  firstCardText?: string
  diagnosticType?: string
  impact?: string
  suggestion?: string
}

interface BossCurrentPageCollectResponse extends BossDiagnosticsResponse {
  runId?: string
  candidateCount?: number
  parsedCount?: number
  skippedCount?: number
  saved?: number
  listCollected?: number
  missingFieldCounts?: Record<string, number>
  failures?: Array<{
    index?: number
    reason?: string
    missingFields?: string[]
    title?: string
    company?: string
  }>
  backend?: {
    saved?: number
    listCollected?: number
    collectionWarnings?: Array<Record<string, unknown>>
  }
}

interface BossApiPocResponse extends BossDiagnosticsResponse {
  runId?: string
  apiCode?: number | null
  apiMessage?: string
  httpStatus?: number
  candidateCount?: number
  missingSalaryCount?: number
  fallbackUsed?: boolean
  collectorSource?: string
  saved?: number
  listCollected?: number
}

const BOSS_DELIVERY_STEPS: Array<{ key: BossStep; title: string; description: string }> = [
  { key: 'config', title: '配置条件', description: '关键词与筛选条件' },
  { key: 'scan', title: '扫描岗位', description: '实时日志与采集进度' },
  { key: 'confirm', title: '确认投递', description: '待确认岗位处理' },
]

const SEARCH_JOB_LIMIT_PRESETS = [10, 20, 30, 50, 100, 200]
const SEARCH_JOB_LIMIT_CUSTOM_VALUE = 'custom'

const isTerminalScanPayload = (payload: Record<string, unknown>) => {
  const stage = String(payload.stage || '')
  const message = String(payload.message || '')
  const operation = String(payload.operation || '')
  if (operation === 'scan' && stage === 'blocked' && (payload.paused || payload.resumable)) return false
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
    || message.includes('采集信息不足')
}

export default function BossPage() {
  const [config, setConfig] = useState<BossConfig>({
    keywords: '',
    cityCode: '',
    industry: '',
    jobType: '',
    experience: '',
    degree: '',
    salary: '',
    scale: '',
    stage: '',
    searchJobLimit: 20,
    filterDeadHr: 0,
    autoDeliver: 0,
  })
  // 关键词显示用（无括号无引号，逗号分隔）
  const [keywordsDisplay, setKeywordsDisplay] = useState<string>('')
  // 多选选中的代码集合（按括号列表保存）
  const [selectedIndustry, setSelectedIndustry] = useState<string[]>([])
  const [selectedExperience, setSelectedExperience] = useState<string[]>([])
  const [selectedDegree, setSelectedDegree] = useState<string[]>([])
  const [selectedScale, setSelectedScale] = useState<string[]>([])
  const [selectedStage, setSelectedStage] = useState<string[]>([])
  const [selectedSalary, setSelectedSalary] = useState<string[]>([])
  const [options, setOptions] = useState<BossOptions>({
    city: [],
    industry: [],
    experience: [],
    jobType: [],
    salary: [],
    degree: [],
    scale: [],
    stage: [],
  })
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([])
  const [newBlacklistKeyword, setNewBlacklistKeyword] = useState('')
  const [blacklistType, setBlacklistType] = useState('company') // 默认为公司
  const [loading, setLoading] = useState(true)
  const [bossLoginMessage, setBossLoginMessage] = useState('')
  const [isDelivering, setIsDelivering] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(true)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saveDialogKind, setSaveDialogKind] = useState<DialogKind>('save')
  const [showLogoutResultDialog, setShowLogoutResultDialog] = useState(false)
  const [logoutResult, setLogoutResult] = useState<{ success: boolean; message: string } | null>(null)
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([])
  const [chromeBridgeReady, setChromeBridgeReady] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [isStopping, setIsStopping] = useState(false)
  const [isScanPaused, setIsScanPaused] = useState(false)
  const [analysisRefreshSignal, setAnalysisRefreshSignal] = useState(0)
  const [analysisFocusRunId, setAnalysisFocusRunId] = useState('')
  const [searchJobLimitMode, setSearchJobLimitMode] = useState<'preset' | 'custom'>('preset')
  const [customSearchJobLimit, setCustomSearchJobLimit] = useState('20')
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(null)
  const [hasProfile, setHasProfile] = useState(false)
  const [activeStep, setActiveStep] = useState<BossStep>('config')
  const [hasScanResult, setHasScanResult] = useState(false)
  const [logSpotlight, setLogSpotlight] = useState(false)
  const [isDiagnosingBoss, setIsDiagnosingBoss] = useState(false)
  const [isCollectingCurrentPage, setIsCollectingCurrentPage] = useState(false)
  const [isRunningBossApiPoc, setIsRunningBossApiPoc] = useState(false)
  const logSectionRef = useRef<HTMLDivElement | null>(null)

  const normalizeSearchJobLimit = (value?: number | string): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 1) return 20
    return Math.min(Math.floor(parsed), 200)
  }

  const syncSearchJobLimitControls = (value?: number | string): number => {
    const limit = normalizeSearchJobLimit(value)
    setCustomSearchJobLimit(String(limit))
    setSearchJobLimitMode(SEARCH_JOB_LIMIT_PRESETS.includes(limit) ? 'preset' : 'custom')
    return limit
  }

  const commitSearchJobLimit = (value?: number | string): number => {
    const rawValue = value ?? (searchJobLimitMode === 'custom' ? customSearchJobLimit : config.searchJobLimit)
    const limit = syncSearchJobLimitControls(rawValue)
    setConfig((prev) => ({ ...prev, searchJobLimit: limit }))
    return limit
  }

  const appendProgressLog = useCallback((entry: Omit<ProgressLog, 'id'>) => {
    const timestamp = entry.timestamp || Date.now()
    setProgressLogs((prev) => [
      { ...entry, timestamp, id: timestamp + Math.random() },
      ...prev,
    ].slice(0, 80))
  }, [])

  const syncBossScanStatus = useCallback(async (silent = false) => {
    try {
      const status = await sendChromeBridgeMessage({
        type: 'BOSS_SCAN_STATUS',
        platform: 'boss',
      }, 2000)
      const paused = Boolean(status.paused || (status.stage === 'blocked' && status.resumable))
      const runId = typeof status.runId === 'string' && status.runId.trim() ? status.runId.trim() : null
      if (paused) {
        setIsDelivering(false)
        setIsStopping(false)
        setIsScanPaused(true)
        if (runId) setActiveRunId(runId)
        if (!silent) {
          appendProgressLog({
            type: 'warning',
            message: String(status.message || 'Boss扫描已暂停，处理登录或安全验证后可继续。'),
            timestamp: typeof status.updatedAt === 'number' ? status.updatedAt : Date.now(),
          })
        }
        return
      }
      const running = Boolean(status.isRunning || status.hasStoredTask)
      if (running) {
        setIsDelivering(true)
        setIsStopping(false)
        setIsScanPaused(false)
        if (runId) setActiveRunId(runId)
        if (!silent) {
          appendProgressLog({
            type: 'info',
            message: String(status.message || '检测到Boss扫描仍在运行，已恢复停止按钮。'),
            timestamp: typeof status.updatedAt === 'number' ? status.updatedAt : Date.now(),
          })
        }
        return
      }
      if (status.success) {
        setIsDelivering(false)
        setIsStopping(false)
        setIsScanPaused(false)
        setActiveRunId(null)
      }
    } catch {
      // 扩展未连接或平台页未打开时，保持当前前端状态。
    }
  }, [appendProgressLog])

  const focusLogSection = useCallback(() => {
    setActiveStep('scan')
    setLogSpotlight(true)
    window.setTimeout(() => {
      logSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    window.setTimeout(() => setLogSpotlight(false), 2200)
  }, [])

  const guideToConfirmStep = useCallback(() => {
    setAnalysisFocusRunId('')
    setHasScanResult(true)
    setAnalysisRefreshSignal((value) => value + 1)
  }, [])

  useEffect(() => {
    fetchAllData()
    checkChromeBridge()
    syncBossScanStatus(true)

    // 确保在客户端环境且 EventSource 可用
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      console.warn('EventSource 不可用，无法连接SSE')
      setCheckingLogin(false)
      return
    }

    const client = createSSEWithBackoff(`${API_BASE}/api/jobs/login-status/stream`, {
      onOpen: () => {
        console.log('[SSE] 连接已打开')
      },
      onError: (e, attempt, delay) => {
        console.warn(`[SSE] 连接错误，准备第${attempt}次重连，延迟 ${delay}ms`, e)
        setCheckingLogin(false)
      },
      listeners: [
        {
          name: 'connected',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              setCheckingLogin(false)
            } catch (error) {
              console.error('[SSE] 解析连接消息失败:', error)
            }
          },
        },
        {
          name: 'login-status',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              if (data.platform === 'boss') {
                setCheckingLogin(false)
              }
            } catch (error) {
              console.error('[SSE] 解析登录状态消息失败:', error)
            }
          },
        },
        { name: 'ping', handler: () => {} },
      ],
    })

    return () => {
      client.close()
    }
  }, [])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchAllData()
        setAnalysisRefreshSignal((value) => value + 1)
        syncBossScanStatus(true)
      }
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncBossScanStatus])

  useEffect(() => {
    const timer = window.setInterval(() => {
      checkChromeBridge()
      syncBossScanStatus(true)
    }, 3000)

    return () => window.clearInterval(timer)
  }, [syncBossScanStatus])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      appendProgressLog({ type: 'warning', message: '当前浏览器不支持实时日志，无法连接 Boss 进度流。' })
      return
    }

    const client = createSSEWithBackoff(`${API_BASE}/api/boss/stream`, {
      onOpen: () => appendProgressLog({ type: 'info', message: 'Boss 运行日志已连接。' }),
      onError: (_e, attempt, delay) => {
        appendProgressLog({ type: 'warning', message: `Boss 运行日志连接中断，${Math.round(delay / 1000)}秒后第${attempt}次重连。` })
      },
      listeners: [
        {
          name: 'connected',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              appendProgressLog({ type: 'info', message: data.message || '已连接到 Boss 扫描进度。' })
            } catch {
              appendProgressLog({ type: 'info', message: '已连接到 Boss 扫描进度。' })
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
              if (data.stage === 'blocked' && (data.paused || data.resumable)) {
                setIsDelivering(false)
                setIsStopping(false)
                setIsScanPaused(true)
                if (typeof data.runId === 'string' && data.runId.trim()) setActiveRunId(data.runId.trim())
              }
              if (shouldRefreshAnalysisFromProgress(data)) {
                guideToConfirmStep()
              }
              if (data.type === 'error') {
                setIsDelivering(false)
                setIsStopping(false)
                setIsScanPaused(false)
                setActiveRunId(null)
              }
            } catch (error) {
              console.warn('解析Boss进度消息失败:', error)
            }
          },
        },
        { name: 'ping', handler: () => {} },
      ],
    })

    return () => client.close()
  }, [appendProgressLog, guideToConfirmStep])

  useEffect(() => {
    return subscribeChromeBridgeEvents((event) => {
      const payload = event.payload
      if (!payload || payload.platform !== 'boss') return

      appendProgressLog({
        type: payload.type || 'info',
        message: payload.message || '',
        timestamp: payload.timestamp,
      })

      if (shouldRefreshAnalysisFromProgress(payload)) {
        guideToConfirmStep()
      }
      if (payload.stage === 'blocked' && (payload.paused || payload.resumable)) {
        setIsDelivering(false)
        setIsStopping(false)
        setIsScanPaused(true)
        if (typeof payload.runId === 'string' && payload.runId.trim()) setActiveRunId(payload.runId.trim())
      }
      if (isTerminalScanPayload(payload)) {
        setIsDelivering(false)
        setIsStopping(false)
        setIsScanPaused(false)
        setActiveRunId(null)
      }
    })
  }, [appendProgressLog, guideToConfirmStep])

  const checkChromeBridge = async () => {
    try {
      const status = await getChromeBridgeStatus()
      const ready = !!status.success
      setChromeBridgeReady(ready)
      setBossLoginMessage(
        ready
          ? `Chrome扩展已连接。只有点击“开始扫描”时才会控制Boss页面。版本：${status.version || '旧版/未知'}`
          : status.message || 'Chrome扩展未连接，请加载 投递牛马 Chrome Bridge。'
      )
    } catch {
      setChromeBridgeReady(false)
      setBossLoginMessage('Chrome扩展未连接，请加载 投递牛马 Chrome Bridge。')
    } finally {
      setCheckingLogin(false)
    }
  }

  const fetchAllData = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/boss/config`)
      const data = await response.json()

      console.log('Fetched data:', data)
      console.log('Blacklist:', data.blacklist)
      setCurrentProfile(data.currentProfile || null)
      setHasProfile(Boolean(data.hasProfile || data.currentProfile))

      if (data.config) {
        // 规范化城市编码：后端可能返回单值或括号列表，此处取第一个值用于下拉回显
        const normalizeCityCode = (raw?: string): string => {
          if (!raw) return ''
          const list = parseListString(raw)
          if (list.length > 0) return list[0]
          return raw
        }
        // 规范化职位类型：后端可能返回单值或括号列表，此处取第一个值用于下拉回显
        const normalizeJobType = (raw?: string): string => {
          if (!raw) return ''
          const list = parseListString(raw)
          if (list.length > 0) return list[0]
          return raw
        }
        const searchJobLimit = syncSearchJobLimitControls(data.config.searchJobLimit)
        setConfig({
          ...data.config,
          cityCode: normalizeCityCode(data.config.cityCode),
          jobType: normalizeJobType(data.config.jobType),
          searchJobLimit,
          autoDeliver: 0,
        })
        // 将后端存储的关键词（可能是 JSON 数组或括号列表）转为展示用逗号分隔文本
        const toDisplayKeywords = (raw?: string): string => {
          if (!raw) return ''
          const s = raw.trim()
          // 尝试作为 JSON 数组解析
          if (s.startsWith('[') && s.endsWith(']')) {
            try {
              const arr = JSON.parse(s)
              if (Array.isArray(arr)) {
                return arr.map((v) => String(v).trim()).filter((v) => v.length > 0).join(', ')
              }
            } catch (_) {
              // 非严格 JSON，如 [a,b]，走拆括号与逗号分隔
              const inner = s.slice(1, -1)
              return inner
                .split(',')
                .map((v) => v.trim().replace(/^"|"$/g, ''))
                .filter((v) => v.length > 0)
                .join(', ')
            }
          }
          // 普通文本：直接返回，去掉多余空格
          return s
        }
        setKeywordsDisplay(toDisplayKeywords(data.config.keywords))
        // 解析括号列表为数组
        setSelectedIndustry(parseListString(data.config.industry))
        setSelectedExperience(parseListString(data.config.experience))
        setSelectedDegree(parseListString(data.config.degree))
        setSelectedScale(parseListString(data.config.scale))
        setSelectedStage(parseListString(data.config.stage))
        setSelectedSalary(parseListString(data.config.salary))
      }
      if (data.options) {
        // 按 sort_order 或固定名称顺序排序；都没有时按名称兜底
        const CITY_ORDER = [
          // 顶层：全国 + 一线（北上广深）
          '全国','北京','上海','广州','深圳',
          // 准一线（图片顺序，从上到下）
          '杭州','成都','南京',
          '武汉','苏州','重庆','天津',
          '长沙','青岛','宁波','无锡',
          '西安','郑州','合肥','厦门','东莞',
          // 二线（图片顺序）
          '济南','福州','佛山','昆明','大连','沈阳','常州','哈尔滨','南昌','泉州',
          '南通','烟台','温州','贵阳','南宁','石家庄','长春','嘉兴','珠海','太原',
          '绍兴','金华','潍坊','徐州','惠州','台州','扬州','中山','乌鲁木齐','兰州',
          // 省会补充（图片底部出现的省会/直辖市）
          '海口','呼和浩特','银川'
        ]
        const orderMap = new Map<string, number>(CITY_ORDER.map((n, i) => [n, i + 1]))
        // 城市排序：仅在后端提供 sortOrder 时按其排序；否则保留后端返回顺序
        const cityList = data.options.city || []
        const cityHasOrder = cityList.some((o: BossOption) => o.sortOrder != null || o.sort_order != null)
        let sortedCity = cityHasOrder
          ? [...cityList]
              .map((o, idx) => ({ o, idx }))
              .sort((a, b) => {
                const ar = a.o.sortOrder ?? a.o.sort_order
                const br = b.o.sortOrder ?? b.o.sort_order
                if (ar == null && br == null) return a.idx - b.idx // 都无排序，保持原序
                if (ar == null) return 1 // 无排序的排在已排序之后，保持原序
                if (br == null) return -1
                if (ar !== br) return ar - br
                return a.idx - b.idx // 稳定排序
              })
              .map(({ o }) => o)
          : cityList

        // 兜底：如果后端未返回『不限』（code='0'），前端补充一个，确保可选
        const hasUnlimitedCity = sortedCity.some((c: BossOption) => c.code === '0' || c.name === '不限')
        if (!hasUnlimitedCity) {
          sortedCity = [{ id: -1, type: 'city', name: '不限', code: '0', sortOrder: 0 }, ...sortedCity]
        }

        // 行业排序：仅在后端提供 sortOrder 时按其排序；否则保留后端返回顺序
        const industryList = data.options.industry || []
        const industryHasOrder = industryList.some((o: BossOption) => o.sortOrder != null || o.sort_order != null)
        const sortedIndustry = industryHasOrder
          ? [...industryList]
              .map((o, idx) => ({ o, idx }))
              .sort((a, b) => {
                const ar = a.o.sortOrder ?? a.o.sort_order
                const br = b.o.sortOrder ?? b.o.sort_order
                if (ar == null && br == null) return a.idx - b.idx
                if (ar == null) return 1
                if (br == null) return -1
                if (ar !== br) return ar - br
                return a.idx - b.idx
              })
              .map(({ o }) => o)
          : industryList

        setOptions({
          ...data.options,
          city: sortedCity,
          industry: sortedIndustry,
        })

        // 将配置中的中文值映射为代码，用于UI显示与选择匹配
        const toCodes = (opts: BossOption[], items: string[]) => {
          const codeSet = new Set(opts.map(o => o.code))
          return items.map(it => {
            if (codeSet.has(it)) return it
            const byName = opts.find(o => o.name === it)
            return byName ? byName.code : it
          })
        }

        // 城市：若当前为中文名，转换为对应的 code 以在下拉中回显
        const currentCityRaw = data.config?.cityCode || ''
        const currentCityHead = (() => {
          const list = parseListString(currentCityRaw)
          return list.length > 0 ? list[0] : currentCityRaw
        })()
        const cityMatchByCode = sortedCity.find((c: BossOption) => c.code === currentCityHead)
        const cityMatchByName = sortedCity.find((c: BossOption) => c.name === currentCityHead)
        const normalizedCityCode = cityMatchByCode ? cityMatchByCode.code : (cityMatchByName ? cityMatchByName.code : '0')
        setConfig(prev => ({ ...prev, cityCode: normalizedCityCode }))

        // 职位类型：若当前为中文名，转换为对应的 code 以在下拉中回显
        const currentJobTypeRaw = data.config?.jobType || ''
        const currentJobTypeHead = (() => {
          const list = parseListString(currentJobTypeRaw)
          return list.length > 0 ? list[0] : currentJobTypeRaw
        })()
        const jobTypeMatchByCode = (data.options.jobType || []).find((t: BossOption) => t.code === currentJobTypeHead)
        const jobTypeMatchByName = (data.options.jobType || []).find((t: BossOption) => t.name === currentJobTypeHead)
        const normalizedJobType = jobTypeMatchByCode ? jobTypeMatchByCode.code : (jobTypeMatchByName ? jobTypeMatchByName.code : '')
        setConfig(prev => ({ ...prev, jobType: normalizedJobType }))

        // HR活跃过滤开关：后端为 0/1，前端直接回显为数字
        const normalizedFilterDeadHr = (data.config?.filterDeadHr ?? 0)
        const optionSearchJobLimit = syncSearchJobLimitControls(data.config?.searchJobLimit)
        setConfig(prev => ({
          ...prev,
          filterDeadHr: normalizedFilterDeadHr,
          autoDeliver: 0,
          searchJobLimit: optionSearchJobLimit,
        }))

        // 其它多选选项：将中文名称转换为代码以匹配 MultiSelect 的 selected
        setSelectedIndustry(toCodes(data.options.industry || [], parseListString(data.config?.industry)))
        setSelectedExperience(toCodes(data.options.experience || [], parseListString(data.config?.experience)))
        setSelectedDegree(toCodes(data.options.degree || [], parseListString(data.config?.degree)))
        setSelectedScale(toCodes(data.options.scale || [], parseListString(data.config?.scale)))
        setSelectedStage(toCodes(data.options.stage || [], parseListString(data.config?.stage)))
        setSelectedSalary(toCodes(data.options.salary || [], parseListString(data.config?.salary)))
      }
      if (data.blacklist) {
        // 兼容处理：将type为'boss'的旧数据视为'company'
        const normalizedBlacklist = data.blacklist.map((item: BlacklistItem) => ({
          ...item,
          type: item.type === 'boss' ? 'company' : item.type
        }))
        console.log('Normalized blacklist:', normalizedBlacklist)
        setBlacklist(normalizedBlacklist)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }

  // 工具：解析括号列表字符串为数组，如 "[a,b]" 或 "a,b"
  const parseListString = (raw?: string): string[] => {
    if (!raw) return []
    let s = raw.trim()
    if (s.startsWith('[') && s.endsWith(']')) {
      s = s.slice(1, -1)
    }
    if (!s) return []
    return s
      .split(',')
      .map(v => v.trim().replace(/^"|"$/g, ''))
      .filter(v => v.length > 0)
  }

  // 工具：将数组转为括号列表字符串
  const toBracketList = (list: string[]): string => {
    const normalized = normalizeUnlimitedSelection(list)
    if (!normalized || normalized.length === 0) return ''
    return `[${normalized.join(',')}]`
  }

  const handleSave = async (silent: boolean = false, overrides?: Partial<BossConfig>) => {
    if (!hasProfile) {
      setSaveDialogKind('save')
      setSaveResult({ success: false, message: '请先在简历配置页新建档案。' })
      setShowSaveDialog(true)
      return
    }
    try {
      const searchJobLimit = commitSearchJobLimit(overrides?.searchJobLimit)
      // 组装要保存的负载：多选使用括号列表
      const payload: BossConfig = {
        ...config,
        // 覆盖字段（用于失焦时使用当前控件值，避免异步状态滞后）
        ...(overrides || {}),
        // 关键词：前端发送逗号分隔的纯文本，后端统一组装为 JSON 列表
        keywords: keywordsDisplay,
        searchJobLimit,
        industry: toBracketList(selectedIndustry),
        experience: toBracketList(selectedExperience),
        degree: toBracketList(selectedDegree),
        scale: toBracketList(selectedScale),
        stage: toBracketList(selectedStage),
        salary: toBracketList(selectedSalary),
        // 扫描只生成待确认岗位，兼容字段固定保存为关闭。
        autoDeliver: 0,
      }
      const response = await fetch(`${API_BASE}/api/boss/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const savedConfig = await response.json().catch(() => null)
        if (savedConfig?.searchJobLimit != null) {
          const savedLimit = syncSearchJobLimitControls(savedConfig.searchJobLimit)
          setConfig((prev) => ({ ...prev, searchJobLimit: savedLimit }))
        }
        await fetchAllData()
        if (!silent) {
          setSaveDialogKind('save')
          setSaveResult({
            success: true,
            message: '保存成功。扫描与投递会使用 Chrome 扩展读取你当前 Chrome 的登录态。',
          })
          setShowSaveDialog(true)
        }
      } else {
        // 保存失败：不弹框，记录日志
        console.warn('保存失败：后端返回非 2xx 状态')
        if (!silent) {
          setSaveDialogKind('save')
          setSaveResult({ success: false, message: '保存失败：后端返回异常状态。' })
          setShowSaveDialog(true)
        }
      }
    } catch (error) {
      console.error('Failed to save config:', error)
      // 保存失败：不弹框
      if (!silent) {
        setSaveDialogKind('save')
        setSaveResult({ success: false, message: '保存失败：网络或服务异常。' })
        setShowSaveDialog(true)
      }
    }
  }

  const handleAddBlacklist = async () => {
    if (!newBlacklistKeyword.trim()) {
      // 输入为空：不弹框，直接返回
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/boss/config/blacklist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          value: newBlacklistKeyword,
          type: blacklistType, // 使用选中的类型
        }),
      })

      if (response.ok) {
        setNewBlacklistKeyword('')
        fetchAllData()
      } else {
        // 添加失败：不弹框
        console.warn('添加黑名单失败：后端返回非 2xx 状态')
      }
    } catch (error) {
      console.error('Failed to add blacklist:', error)
      // 添加失败：不弹框
    }
  }

  const handleDeleteBlacklist = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE}/api/boss/config/blacklist/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        fetchAllData()
      } else {
        // 删除失败：不弹框
        console.warn('删除黑名单失败：后端返回非 2xx 状态')
      }
    } catch (error) {
      console.error('Failed to delete blacklist:', error)
      // 删除失败：不弹框
    }
  }

  const handleStartDelivery = async () => {
    try {
      if (!hasProfile) {
        appendProgressLog({ type: 'error', message: '请先在简历配置页新建档案。' })
        alert('请先在简历配置页新建档案。')
        return
      }
      focusLogSection()
      const setup = await validateSetupForPlatform('boss', { requirePlatformLogin: false })
      if (!setup.ready) {
        const message = formatSetupMissingMessage('Boss', setup.missing)
        appendProgressLog({ type: 'error', message })
        alert(message)
        return
      }
      setIsDelivering(true)
      setIsStopping(false)
      setIsScanPaused(false)
      const runId = `boss-${Date.now()}`
      setActiveRunId(runId)
      appendProgressLog({ type: 'info', message: '已发送 Boss Chrome扫描请求：扫描会持续采集，AI 在后台分析，结果稍后进入待确认列表。' })
      const searchJobLimit = commitSearchJobLimit()
      const data = await sendChromeBridgeMessage({
        type: 'BOSS_SCAN_START',
        platform: 'boss',
        runId,
        config: {
          ...config,
          keywords: keywordsDisplay,
          industry: selectedIndustry,
          experience: selectedExperience,
          degree: selectedDegree,
          scale: selectedScale,
          stage: selectedStage,
          salary: selectedSalary,
          cityCode: config.cityCode,
          searchJobLimit,
          autoDeliver: 0,
        },
        autoDeliver: 0,
      })

      if (data.success) {
        setHasScanResult(false)
        if (typeof data.runId === 'string' && data.runId.trim()) setActiveRunId(data.runId.trim())
        appendProgressLog({ type: 'info', message: data.message || 'Boss Chrome扫描任务已启动，等待Chrome页面采集岗位。' })
      } else {
        console.warn('启动失败：', data.message)
        appendProgressLog({ type: 'error', message: data.message || 'Boss扫描启动失败。' })
        setIsDelivering(false)
        setIsStopping(false)
        setIsScanPaused(false)
        setActiveRunId(null)
      }
    } catch (error) {
      console.error('Failed to start delivery:', error)
      appendProgressLog({ type: 'error', message: 'Boss扫描启动失败：网络或服务异常。' })
      setIsDelivering(false)
      setIsStopping(false)
      setIsScanPaused(false)
      setActiveRunId(null)
    }
  }

  const handleDiagnoseCurrentBossPage = async () => {
    if (isDiagnosingBoss) return
    focusLogSection()
    setIsDiagnosingBoss(true)
    appendProgressLog({ type: 'info', message: '正在诊断当前已打开的 Boss 页面，不会跳转页面，也不会处理验证码。' })
    try {
      const data = await sendChromeBridgeMessage({
        type: 'BOSS_DEBUG_COLLECT',
        platform: 'boss',
      }, 8000) as BossDiagnosticsResponse

      appendProgressLog({
        type: data.success ? (data.isLoginPage || data.isSecurityPage ? 'warning' : 'success') : 'error',
        message: `${data.message || 'Boss页面诊断完成。'} currentUrl=${data.currentUrl || ''}；title=${data.title || ''}；isLoginPage=${Boolean(data.isLoginPage)}；isSecurityPage=${Boolean(data.isSecurityPage)}；detailLinkCount=${Number(data.detailLinkCount || 0)}；selectorCounts=${JSON.stringify(data.selectorCounts || {})}；firstCardText=${data.firstCardText || ''}`,
      })
      if (Number(data.detailLinkCount || 0) === 0) {
        appendProgressLog({
          type: 'warning',
          message: '当前页面未识别到岗位详情链接，可能是未进入搜索结果页、未登录、安全验证、页面结构变化或选择器失效。',
        })
      }
      if (data.isSecurityPage) {
        appendProgressLog({
          type: 'warning',
          message: '检测到Boss安全验证，请在Chrome中手动完成验证。本工具不会绕过验证码或安全验证。',
        })
      }
    } catch (error) {
      console.error('Failed to diagnose Boss page:', error)
      appendProgressLog({ type: 'error', message: 'Boss页面诊断失败：Chrome Bridge 通信异常。' })
    } finally {
      setIsDiagnosingBoss(false)
    }
  }

  const handleCollectCurrentBossPage = async () => {
    if (isCollectingCurrentPage) return
    if (isDelivering) {
      appendProgressLog({ type: 'warning', message: '完整扫描正在运行，请先停止扫描，再使用“采集当前 Boss 页面”。' })
      return
    }
    if (!hasProfile) {
      appendProgressLog({ type: 'error', message: '请先在简历配置页新建档案，后端需要用当前档案保存岗位。' })
      return
    }

    focusLogSection()
    setIsCollectingCurrentPage(true)
    appendProgressLog({
      type: 'info',
      message: '正在采集当前已打开的 Boss 搜索结果页：只读取页面已有岗位卡片，不自动跳转搜索 URL，不进入 AI 分析。',
    })
    try {
      const data = await sendChromeBridgeMessage({
        type: 'BOSS_COLLECT_CURRENT_PAGE',
        platform: 'boss',
        keyword: keywordsDisplay,
        runId: `boss-list-${Date.now()}`,
      }, 70000) as BossCurrentPageCollectResponse

      appendProgressLog({
        type: data.success ? 'success' : 'error',
        message: data.message || (data.success ? 'Boss当前页采集完成。' : 'Boss当前页采集失败。'),
      })

      if (!data.success || Number(data.parsedCount || 0) === 0) {
        appendProgressLog({
          type: 'error',
          message: `Boss当前页采集诊断：selectorCounts=${JSON.stringify(data.selectorCounts || {})}；currentUrl=${data.currentUrl || ''}；title=${data.title || ''}；detailLinkCount=${Number(data.detailLinkCount || 0)}；firstCardText=${data.firstCardText || ''}`,
        })
      }

      const missingCounts = Object.entries(data.missingFieldCounts || {}).filter(([, count]) => Number(count) > 0)
      const failureReasons = (data.failures || [])
        .slice(0, 8)
        .map((item) => `第${item.index || '?'}张：${item.reason || '未知原因'}`)
      if (missingCounts.length || failureReasons.length) {
        appendProgressLog({
          type: 'warning',
          message: `Boss当前页字段检查：missingFieldCounts=${JSON.stringify(Object.fromEntries(missingCounts))}；失败/缺失原因=${failureReasons.join('；') || '无'}`,
        })
      }

      if (Number(data.detailLinkCount || 0) === 0) {
        appendProgressLog({
          type: 'warning',
          message: '当前页面未识别到岗位详情链接，可能是未进入搜索结果页、未登录、安全验证、页面结构变化或选择器失效。',
        })
      }
      if (data.success && typeof data.runId === 'string' && Number(data.saved || data.listCollected || 0) > 0) {
        setAnalysisFocusRunId(data.runId)
        setHasScanResult(true)
        setAnalysisRefreshSignal((value) => value + 1)
        setActiveStep('confirm')
      }
    } catch (error) {
      console.error('Failed to collect current Boss page:', error)
      appendProgressLog({ type: 'error', message: 'Boss当前页采集失败：Chrome Bridge 或本地后端通信异常。' })
    } finally {
      setIsCollectingCurrentPage(false)
    }
  }

  const handleBossApiPoc = async () => {
    if (isRunningBossApiPoc) return
    if (isDelivering) {
      appendProgressLog({ type: 'warning', message: '完整扫描正在运行，请先停止扫描，再测试 Boss API POC。' })
      return
    }
    if (!hasProfile) {
      appendProgressLog({ type: 'error', message: '请先在简历配置页新建档案，后端需要用当前档案保存 POC 岗位。' })
      return
    }

    const keywords = Array.from(new Set(
      keywordsDisplay
        .split(/[,，;；\n\r]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ))
    if (keywords.length !== 1) {
      appendProgressLog({ type: 'error', message: 'Boss API POC 仅支持一个关键词，请把关键词配置改为恰好一个后再测试。' })
      return
    }
    const cityCode = String(config.cityCode || '').trim()
    if (!cityCode || cityCode === '0') {
      appendProgressLog({ type: 'error', message: 'Boss API POC 需要选择一个明确城市，不能使用“不限”。' })
      return
    }

    const pageSize = Math.min(10, normalizeSearchJobLimit(config.searchJobLimit))
    focusLogSection()
    setIsRunningBossApiPoc(true)
    appendProgressLog({
      type: 'info',
      message: `正在测试 Boss 搜索 API：关键词=${keywords[0]}，城市码=${cityCode}，第一页，pageSize=${pageSize}。不会自动翻页、重试风控、进入 AI 分析或投递。`,
    })
    try {
      const data = await sendChromeBridgeMessage({
        type: 'BOSS_API_POC_COLLECT',
        platform: 'boss',
        keyword: keywords[0],
        cityCode,
        page: 1,
        pageSize,
        runId: `boss-api-poc-${Date.now()}`,
        config: {
          jobType: config.jobType || '',
          industry: selectedIndustry,
          experience: selectedExperience,
          degree: selectedDegree,
          scale: selectedScale,
          stage: selectedStage,
          salary: selectedSalary,
        },
      }, 70000) as BossApiPocResponse

      appendProgressLog({
        type: data.success
          ? (data.diagnosticType === 'API_SUCCESS' ? 'success' : 'warning')
          : (data.diagnosticType === 'LOGIN_REQUIRED' || data.diagnosticType === 'SECURITY_VERIFICATION' || data.diagnosticType === 'API_CODE_37' ? 'warning' : 'error'),
        message: data.message || (data.success ? 'Boss API POC 完成。' : 'Boss API POC 失败。'),
      })
      appendProgressLog({
        type: data.success ? 'info' : 'warning',
        message: `Boss API POC 诊断：diagnosticType=${data.diagnosticType || '未知'}；apiCode=${data.apiCode ?? '无'}；httpStatus=${Number(data.httpStatus || 0)}；candidateCount=${Number(data.candidateCount || 0)}；missingSalaryCount=${Number(data.missingSalaryCount || 0)}；fallbackUsed=${Boolean(data.fallbackUsed)}；collectorSource=${data.collectorSource || 'none'}；saved=${Number(data.saved || 0)}；listCollected=${Number(data.listCollected || 0)}。`,
      })

      if (data.success && typeof data.runId === 'string' && Number(data.saved || data.listCollected || 0) > 0) {
        setAnalysisFocusRunId(data.runId)
        setHasScanResult(true)
        setAnalysisRefreshSignal((value) => value + 1)
        setActiveStep('confirm')
      }
    } catch (error) {
      console.error('Failed to run Boss API POC:', error)
      appendProgressLog({ type: 'error', message: 'Boss API POC 失败：Chrome Bridge 或本地后端通信异常。' })
    } finally {
      setIsRunningBossApiPoc(false)
    }
  }

  const handleStopDelivery = async () => {
    if (isStopping) return
    setIsStopping(true)
    try {
      const runId = activeRunId
      await fetch(`${API_BASE}/api/boss/chrome/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      }).catch(() => null)

      const data = await sendChromeBridgeMessage({ type: 'BOSS_SCAN_STOP', platform: 'boss', runId }, 1500)

      if (data.success) {
        appendProgressLog({ type: 'warning', message: data.message || 'Boss扫描停止请求已发送。' })
        setIsDelivering(false)
        setIsScanPaused(false)
        setActiveRunId(null)
      } else {
        // 停止失败：也要将状态设置为未投递（因为可能任务已经结束）
        console.warn('停止失败：', data.message)
        appendProgressLog({ type: 'warning', message: data.message || 'Boss扫描可能已经结束。' })
        setIsDelivering(false)
        setIsScanPaused(false)
        setActiveRunId(null)
      }
    } catch (error) {
      console.error('Failed to stop delivery:', error)
      // 停止失败：也要将状态设置为未投递
      appendProgressLog({ type: 'error', message: 'Boss扫描停止失败：网络或服务异常。' })
      setIsDelivering(false)
      setIsScanPaused(false)
      setActiveRunId(null)
    } finally {
      setIsStopping(false)
    }
  }

  const handleOpenPlatform = async () => {
    setSaveDialogKind('platform')
    setCheckingLogin(true)

    try {
      const data = await sendChromeBridgeMessage({ type: 'GET_JOBS_EXTENSION_PING' }, 1500)
      if (data.success) {
        setChromeBridgeReady(true)
        appendProgressLog({ type: 'success', message: `Chrome扩展已连接。本次检查不会打开或切换Boss页面。版本：${data.version || '旧版/未知'}` })
        setSaveResult({
          success: true,
          message: `Chrome扩展已连接。本次检查不会打开或切换Boss页面；需要扫描时请点击“开始扫描”。版本：${data.version || '旧版/未知'}`,
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
    } finally {
      setCheckingLogin(false)
    }
  }

  const triggerLogout = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/boss/logout`, { method: 'POST' })
      const data = await response.json()
      if (data.success) {
        setIsDelivering(false)
        console.info('已退出登录，数据库Cookie已置空')
        setLogoutResult({ success: true, message: '已退出登录，Cookie已清空。' })
        setShowLogoutResultDialog(true)
      } else {
        console.warn('退出登录失败：', data.message)
        setLogoutResult({ success: false, message: `退出登录失败：${data.message || '服务返回异常。'}` })
        setShowLogoutResultDialog(true)
      }
    } catch (error) {
      console.error('Failed to logout:', error)
      setLogoutResult({ success: false, message: '退出登录失败：网络或服务异常。' })
      setShowLogoutResultDialog(true)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-screen">加载中...</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BiBriefcase className="text-2xl" />}
        title="Boss直聘配置"
        subtitle="配置Boss直聘平台的求职参数"
        iconClass="text-white"
        accentBgClass="bg-teal-500"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleOpenPlatform} size="sm" className="app-button-soft px-4">
              <BiLinkExternal className="mr-1" /> 检查扩展连接
            </Button>
            <Button
              onClick={handleDiagnoseCurrentBossPage}
              size="sm"
              disabled={!chromeBridgeReady || isDiagnosingBoss}
              className="app-button-soft px-4 disabled:opacity-60"
            >
              <BiSearch className="mr-1" /> {isDiagnosingBoss ? '诊断中...' : '诊断当前 Boss 页面'}
            </Button>
            <Button
              onClick={handleCollectCurrentBossPage}
              size="sm"
              disabled={!chromeBridgeReady || !hasProfile || isDelivering || isCollectingCurrentPage || isRunningBossApiPoc}
              className="app-button-success px-4 disabled:opacity-60"
            >
              <BiBriefcase className="mr-1" /> {isCollectingCurrentPage ? '采集中...' : '采集当前 Boss 页面'}
            </Button>
            <Button
              onClick={handleBossApiPoc}
              size="sm"
              disabled={!chromeBridgeReady || !hasProfile || isDelivering || isCollectingCurrentPage || isRunningBossApiPoc}
              className="app-button-soft px-4 disabled:opacity-60"
            >
              <BiSearch className="mr-1" /> {isRunningBossApiPoc ? 'API POC 测试中...' : '测试 Boss API POC'}
            </Button>
            {checkingLogin ? (
              <Button size="sm" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 text-slate-500 cursor-not-allowed shadow-sm">
                <BiPlay className="mr-1" /> 检查登录中...
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
	                <BiPlay className="mr-1" /> {isScanPaused ? '继续扫描' : '开始扫描'}
	              </Button>
	            )}
            <Button onClick={() => setShowLogoutDialog(true)} size="sm" className="app-button-danger px-4">
              <BiLogOut className="mr-1" /> 退出登录
            </Button>
            <Button onClick={() => handleSave(false)} size="sm" disabled={!hasProfile} className="app-button-primary px-4">
              <BiSave className="mr-1" /> 保存配置
            </Button>
          </div>
        }
      />

      <CurrentProfileBadge profile={currentProfile} onRefresh={fetchAllData} />

      {!hasProfile ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          未新建档案时不能保存 Boss 配置或扫描岗位。请到“简历配置”新建/切换档案。
        </div>
      ) : null}

      <BossStepBar activeStep={activeStep} onChange={setActiveStep} hasScanResult={hasScanResult} isRunning={isDelivering && !isScanPaused} />

      {hasScanResult && activeStep !== 'confirm' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
          <span>扫描结果已更新，待确认岗位可以进入确认投递区处理。</span>
          <Button size="sm" onClick={() => setActiveStep('confirm')} className="app-button-primary px-4">
            <BiBriefcase className="mr-1" /> 进入确认投递
          </Button>
        </div>
      ) : null}

      {activeStep === 'config' ? (
        <div className="space-y-6">

	          {/* 平台说明 */}
	          <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BiBriefcase className="text-primary" />
                Boss直聘平台说明
              </CardTitle>
	              <CardDescription>登录与扫描操作提示</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
	                <p className="text-sm text-muted-foreground">当前状态：{chromeBridgeReady ? 'Chrome扩展已连接' : 'Chrome扩展未连接'}。{bossLoginMessage ? ` ${bossLoginMessage}` : ''}</p>
	                <p className="text-sm text-muted-foreground">“诊断当前 Boss 页面”和“采集当前 Boss 页面”只读取你已经打开的页面，不会自动跳转；当前页采集结果先按 LIST_COLLECTED 入库，不进入 AI 分析。</p>
	                <p className="text-sm text-muted-foreground">“测试 Boss API POC”只在你主动点击后请求一个关键词、一个城市的第一页，最多 10 条；不会自动翻页、处理验证码、进入 AI 分析或投递。</p>
	                <p className="text-sm text-muted-foreground">只有点击“开始扫描”才会打开或切换Boss页面并开始完整采集；完整扫描会持续采集，AI 在后台分析，结果稍后进入待确认列表。</p>
                <p className="text-sm text-muted-foreground">点击“保存配置”按钮可手动保存当前登录相关信息到数据库。</p>
              </div>
            </CardContent>
          </Card>

          {/* 搜索配置 */}
          <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BiSearch className="text-primary" />
                搜索配置
              </CardTitle>
              <CardDescription>设置职位搜索关键词和目标城市</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="keywords">搜索关键词</Label>
                  <Input
                    id="keywords"
                    value={keywordsDisplay}
                    onChange={(e) => setKeywordsDisplay(e.target.value)}
                    placeholder="例如：Java开发工程师"
                    disabled={!hasProfile}
                  />
                  <p className="text-xs text-muted-foreground">职位搜索的关键词</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">工作城市</Label>
                  <Select
                    id="city"
                    value={config.cityCode || ''}
                    onChange={(e) => setConfig({ ...config, cityCode: e.target.value })}
                    disabled={!hasProfile}
                  >
                    {options.city.map((city) => (
                      <option key={city.id} value={city.code}>
                        {city.name}
                      </option>
                    ))}
                </Select>
                <p className="text-xs text-muted-foreground">按 Boss 直聘城市筛选岗位</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobType">职位类型</Label>
                <Select
                  id="jobType"
                  value={config.jobType || ''}
                  onChange={(e) => setConfig({ ...config, jobType: e.target.value })}
                  disabled={!hasProfile}
                >
                  {options.jobType.map((type) => (
                    <option key={type.id} value={type.code}>
                      {type.name}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">职位性质，职位名称请在搜索关键词里填写</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="searchJobLimit">每关键词后台 AI 分析岗位数</Label>
                <Select
                  id="searchJobLimit"
                  value={searchJobLimitMode === 'custom' ? SEARCH_JOB_LIMIT_CUSTOM_VALUE : String(normalizeSearchJobLimit(config.searchJobLimit))}
                  disabled={!hasProfile}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === SEARCH_JOB_LIMIT_CUSTOM_VALUE) {
                      const currentLimit = normalizeSearchJobLimit(config.searchJobLimit)
                      setSearchJobLimitMode('custom')
                      setCustomSearchJobLimit(String(currentLimit))
                      return
                    }
                    const limit = normalizeSearchJobLimit(value)
                    setSearchJobLimitMode('preset')
                    setCustomSearchJobLimit(String(limit))
                    setConfig({ ...config, searchJobLimit: limit })
                  }}
                >
                  {SEARCH_JOB_LIMIT_PRESETS.map((limit) => (
                    <option key={limit} value={String(limit)}>{limit}</option>
                  ))}
                  <option value={SEARCH_JOB_LIMIT_CUSTOM_VALUE}>自定义</option>
                </Select>
                {searchJobLimitMode === 'custom' && (
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={customSearchJobLimit}
                    onChange={(e) => {
                      const rawValue = e.target.value
                      setCustomSearchJobLimit(rawValue)
                      const parsed = Number(rawValue)
                      if (Number.isFinite(parsed) && parsed >= 1) {
                        setConfig({ ...config, searchJobLimit: Math.min(Math.floor(parsed), 200) })
                      }
                    }}
                    onBlur={() => commitSearchJobLimit(customSearchJobLimit)}
                    placeholder="输入 1-200"
                    disabled={!hasProfile}
                  />
                )}
                <p className="text-xs text-muted-foreground">每个关键词最多进入AI打分的岗位数，范围 1-200。</p>
              </div>

              <div className="space-y-2">
                <Label>公司行业</Label>
                <MultiSelect
                  options={options.industry}
                  selected={selectedIndustry}
                  onChange={setSelectedIndustry}
                  placeholder="选择公司行业"
                  disabled={!hasProfile}
                  />
                  <p className="text-xs text-muted-foreground">可多选</p>
                </div>
              
              {/* HR活跃过滤开关 */}
              <div className="space-y-2">
                <Label htmlFor="filterDeadHr">HR活跃过滤</Label>
                <Select
                  id="filterDeadHr"
                  value={String(config.filterDeadHr ?? 0)}
                  onChange={(e) => setConfig({ ...config, filterDeadHr: Number(e.target.value) })}
                  disabled={!hasProfile}
                >
                  <option value="0">关闭</option>
                  <option value="1">开启</option>
                </Select>
                <p className="text-xs text-muted-foreground">开启后将过滤活跃状态包含“年”的HR，但仍保存数据。</p>
              </div>
              </div>
            </CardContent>
        </Card>

        {/* 薪资和经验 */}
        <Card className="animate-in fade-in slide-in-from-bottom-6 duration-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BiMoney className="text-primary" />
              薪资与经验要求
            </CardTitle>
            <CardDescription>设置薪资待遇和工作经验要求</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>薪资待遇</Label>
                <MultiSelect
                  options={options.salary}
                  selected={selectedSalary}
                  onChange={setSelectedSalary}
                  placeholder="选择薪资待遇"
                  disabled={!hasProfile}
                />
                <p className="text-xs text-muted-foreground">按 Boss 直聘薪资范围筛选，可多选</p>
              </div>
              <div className="space-y-2">
                <Label>工作经验</Label>
                <MultiSelect
                  options={options.experience}
                  selected={selectedExperience}
                  onChange={setSelectedExperience}
                  placeholder="选择工作经验"
                  disabled={!hasProfile}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 公司要求 */}
        <Card className="animate-in fade-in slide-in-from-bottom-7 duration-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BiBuilding className="text-primary" />
              公司要求
            </CardTitle>
            <CardDescription>设置目标公司的规模和融资阶段</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>学历要求</Label>
                <MultiSelect
                  options={options.degree}
                  selected={selectedDegree}
                  onChange={setSelectedDegree}
                  placeholder="选择学历要求"
                  disabled={!hasProfile}
                />
              </div>

              <div className="space-y-2">
                <Label>公司规模</Label>
                <MultiSelect
                  options={options.scale}
                  selected={selectedScale}
                  onChange={setSelectedScale}
                  placeholder="选择公司规模"
                  disabled={!hasProfile}
                />
              </div>

              <div className="space-y-2">
                <Label>融资阶段</Label>
                <MultiSelect
                  options={options.stage}
                  selected={selectedStage}
                  onChange={setSelectedStage}
                  placeholder="选择融资阶段"
                  disabled={!hasProfile}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 黑名单管理 */}
        <Card className="animate-in fade-in slide-in-from-bottom-8 duration-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BiSearch className="text-primary" />
              黑名单管理 ({blacklist.length} 条)
            </CardTitle>
            <CardDescription>添加或删除不想投递的公司、职位或HR</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* 添加黑名单 */}
              <div className="flex gap-2">
                <Select
                  value={blacklistType}
                  onChange={(e) => setBlacklistType(e.target.value)}
                  className="w-32"
                >
                  <option value="company">公司</option>
                  <option value="job">岗位</option>
                  <option value="recruiter">HR</option>
                </Select>
                <Input
                  value={newBlacklistKeyword}
                  onChange={(e) => setNewBlacklistKeyword(e.target.value)}
                  placeholder={`输入${blacklistType === 'company' ? '公司名称' : blacklistType === 'job' ? '岗位关键词' : 'HR职位'}关键词`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddBlacklist()
                    }
                  }}
                />
                <Button onClick={handleAddBlacklist} className="whitespace-nowrap">
                  <BiPlus />
                  添加
                </Button>
              </div>

              {/* 黑名单列表 - 按类型分组显示 */}
              <div className="space-y-6">
                {/* 公司黑名单 */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <BiBuilding className="text-orange-500" />
                    <span>公司黑名单 ({blacklist.filter(item => item.type === 'company').length})</span>
                  </h3>
                  <div className="space-y-2">
                    {blacklist.filter(item => item.type === 'company').length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground bg-muted/30 rounded-lg">
                        <p className="text-xs">暂无公司黑名单</p>
                      </div>
                    ) : (
                      blacklist.filter(item => item.type === 'company').map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800"
                        >
                          <span className="text-sm">{item.value}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteBlacklist(item.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <BiTrash />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 岗位黑名单 */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <BiBriefcase className="text-blue-500" />
                    <span>岗位黑名单 ({blacklist.filter(item => item.type === 'job').length})</span>
                  </h3>
                  <div className="space-y-2">
                    {blacklist.filter(item => item.type === 'job').length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground bg-muted/30 rounded-lg">
                        <p className="text-xs">暂无岗位黑名单</p>
                      </div>
                    ) : (
                      blacklist.filter(item => item.type === 'job').map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800"
                        >
                          <span className="text-sm">{item.value}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteBlacklist(item.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <BiTrash />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* HR黑名单 */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <BiSearch className="text-green-500" />
                    <span>HR黑名单 ({blacklist.filter(item => item.type === 'recruiter').length})</span>
                  </h3>
                  <div className="space-y-2">
                    {blacklist.filter(item => item.type === 'recruiter').length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground bg-muted/30 rounded-lg">
                        <p className="text-xs">暂无HR黑名单</p>
                      </div>
                    ) : (
                      blacklist.filter(item => item.type === 'recruiter').map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800"
                        >
                          <span className="text-sm">{item.value}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteBlacklist(item.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <BiTrash />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        
        </div>
      ) : null}

      {activeStep === 'scan' ? (
        <div ref={logSectionRef} className="scroll-mt-6 space-y-6">
          <ProgressLogCard
            logs={progressLogs}
            isRunning={isDelivering}
            isStopping={isStopping}
            isPaused={isScanPaused}
            spotlight={logSpotlight}
            onStop={handleStopDelivery}
            onClear={() => setProgressLogs([])}
          />

          {hasScanResult ? (
            <Card className="border-cyan-200 bg-cyan-50/70 dark:border-cyan-900/60 dark:bg-cyan-950/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BiBriefcase className="text-cyan-600" />
                  待确认列表已更新
                </CardTitle>
                <CardDescription>已生成或刷新待确认岗位，下一步可以统一确认、跳过或拉黑。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={() => setActiveStep('confirm')} className="app-button-primary px-4">
                  <BiBriefcase className="mr-1" /> 查看待确认岗位
                </Button>
                <Button variant="outline" onClick={() => setAnalysisRefreshSignal((value) => value + 1)} className="rounded-lg px-4">
                  <BiBarChart className="mr-1" /> 刷新结果
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeStep === 'confirm' ? (
        <div className="space-y-6">
          <AnalysisContent refreshSignal={analysisRefreshSignal} focusScanRunId={analysisFocusRunId} />
        </div>
      ) : null}

      {/* 统计卡片已移除 */}
      {/* 退出确认弹框 */}
      {showLogoutDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border border-gray-200 dark:border-neutral-800 animate-in fade-in zoom-in-95">
            <Card className="border-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BiLogOut className="text-red-500" />
                  确认退出登录
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-4">退出后将清除Cookie并切换为未登录状态。</p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setShowLogoutDialog(false)}
                    className="rounded-lg px-4"
                  >
                    取消
                  </Button>
                  <Button
                    onClick={async () => {
                      await triggerLogout()
                      setShowLogoutDialog(false)
                    }}
                    className="app-button-danger px-4"
                  >
                    确认退出
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 退出登录结果弹框 */}
      {showLogoutResultDialog && logoutResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border border-gray-200 dark:border-neutral-800 animate-in fade-in zoom-in-95">
            <Card className="border-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BiLogOut className={logoutResult.success ? 'text-green-500' : 'text-red-500'} />
                  {logoutResult.success ? '退出登录成功' : '退出登录失败'}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-4">{logoutResult.message}</p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setShowLogoutResultDialog(false)}
                    className={`rounded-lg px-4 ${logoutResult.success ? 'app-button-success' : 'app-button-danger'}`}
                  >
                    知道了
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 结果弹框 */}
      {showSaveDialog && saveResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border border-gray-200 dark:border-neutral-800 animate-in fade-in zoom-in-95">
            <Card className="border-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BiSave className={saveResult.success ? 'text-green-500' : 'text-red-500'} />
                  {saveDialogKind === 'platform'
                    ? (saveResult.success ? '打开成功' : '打开失败')
                    : (saveResult.success ? '保存成功' : '保存失败')}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground mb-4">{saveResult.message}</p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setShowSaveDialog(false)}
                    className={`rounded-lg px-4 ${saveResult.success ? 'app-button-success' : 'app-button-danger'}`}
                  >
                    知道了
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function BossStepBar({
  activeStep,
  onChange,
  hasScanResult,
  isRunning,
}: {
  activeStep: BossStep
  onChange: (step: BossStep) => void
  hasScanResult: boolean
  isRunning: boolean
}) {
  const activeIndex = BOSS_DELIVERY_STEPS.findIndex((step) => step.key === activeStep)

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {BOSS_DELIVERY_STEPS.map((step, index) => {
            const isActive = step.key === activeStep
            const isComplete = index < activeIndex || (step.key === 'scan' && hasScanResult)
            const canOpen = step.key !== 'confirm' || hasScanResult || activeStep === 'confirm'
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => canOpen && onChange(step.key)}
                disabled={!canOpen}
                className={`flex min-h-20 items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  isActive
                    ? 'border-teal-500 bg-teal-50 text-teal-900 shadow-sm dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-100'
                    : isComplete
                      ? 'border-cyan-200 bg-cyan-50/60 text-cyan-900 hover:border-cyan-300 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-neutral-900 dark:text-slate-200'
                } ${!canOpen ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  isActive
                    ? 'bg-teal-600 text-white'
                    : isComplete
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}>
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {step.title}
                    {step.key === 'scan' && isRunning ? (
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">扫描中</span>
                    ) : null}
                    {step.key === 'confirm' && hasScanResult ? (
                      <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200">可处理</span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{step.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function ProgressLogCard({
  logs,
  isRunning,
  isStopping,
  isPaused,
  spotlight = false,
  onStop,
  onClear,
}: {
  logs: ProgressLog[]
  isRunning: boolean
  isStopping: boolean
  isPaused: boolean
  spotlight?: boolean
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
    <Card className={`animate-in fade-in slide-in-from-bottom-5 duration-700 transition-all ${
      spotlight ? 'border-teal-400 shadow-[0_0_0_4px_rgba(20,184,166,0.18)]' : ''
    }`}>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BiBarChart className="text-primary" />
            运行日志
          </CardTitle>
          <CardDescription>Boss页面诊断、当前页采集、后台扫描进度和结果</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs ${isRunning ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' : isPaused ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
            {isStopping ? '停止中' : isPaused ? '已暂停' : isRunning ? '扫描中' : '空闲'}
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
          <p className="text-sm text-muted-foreground">点击“诊断当前 Boss 页面”“采集当前 Boss 页面”“测试 Boss API POC”或“开始扫描”后，这里会显示选择器命中、API诊断、采集结果、后台AI队列和错误信息。</p>
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

// 多选下拉组件（简单版），按代码选择并显示名称
function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  onClose,
  disabled = false,
}: {
  options: BossOption[]
  selected: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  onClose?: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })

  // 确保组件已挂载（解决 SSR 问题）
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  // 计算下拉框位置
  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      })
    }
  }, [])

  // 打开时计算位置
  useEffect(() => {
    if (open) {
      updatePosition()
      // 监听滚动和窗口大小变化，更新位置
      const handleUpdate = () => updatePosition()
      window.addEventListener('scroll', handleUpdate, true)
      window.addEventListener('resize', handleUpdate)
      return () => {
        window.removeEventListener('scroll', handleUpdate, true)
        window.removeEventListener('resize', handleUpdate)
      }
    }
  }, [open, updatePosition])

  // 点击组件外部或焦点移出时关闭下拉
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (!open) return
      const target = e.target as Node
      // 检查点击是否在按钮或下拉框内
      const clickedButton = wrapperRef.current?.contains(target)
      const clickedDropdown = dropdownRef.current?.contains(target)

      console.log('[MultiSelect] 外部点击检测', {
        clickedButton,
        clickedDropdown,
        targetElement: (target as HTMLElement)?.tagName,
        targetClass: (target as HTMLElement)?.className
      })

      if (!clickedButton && !clickedDropdown) {
        console.log('[MultiSelect] 检测到外部点击，关闭下拉框')
        setOpen(false)
        onClose?.()
      } else {
        console.log('[MultiSelect] 点击在组件内部，保持打开')
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        console.log('[MultiSelect] ESC 键关闭')
        setOpen(false)
        onClose?.()
      }
    }

    if (open) {
      console.log('[MultiSelect] 下拉框打开，注册监听器')
      // 使用 setTimeout 确保 DOM 已更新
      setTimeout(() => {
        document.addEventListener('mousedown', handleOutsideClick)
        document.addEventListener('keydown', handleEscape)
      }, 0)
    }

    return () => {
      if (open) {
        console.log('[MultiSelect] 移除监听器')
      }
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  const toggle = (code: string) => {
    if (disabled) return
    const currentSelected = normalizeUnlimitedSelection(selected)
    console.log('[MultiSelect] toggle 被调用', { code, currentSelected })
    if (currentSelected.includes(code)) {
      const newSelected = currentSelected.filter((c) => c !== code)
      console.log('[MultiSelect] 取消选择，新值:', newSelected)
      onChange(newSelected)
    } else {
      const newSelected = code === UNLIMITED_OPTION_CODE
        ? [UNLIMITED_OPTION_CODE]
        : [...currentSelected.filter((c) => c !== UNLIMITED_OPTION_CODE), code]
      console.log('[MultiSelect] 添加选择，新值:', newSelected)
      onChange(newSelected)
    }
  }

  const effectiveSelected = normalizeUnlimitedSelection(selected)
  const selectedNames = options
    .filter((o) => effectiveSelected.includes(o.code))
    .map((o) => o.name)

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (disabled) return; const next = !open; setOpen(next); if (!next) onClose?.() }}
        className="flex h-10 w-full items-center justify-between rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.25)] transition-all duration-200 hover:bg-white/15 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="truncate text-sm">
          {selectedNames.length > 0 ? selectedNames.join('，') : (placeholder || '请选择')}
        </span>
        <span className={`ml-2 text-xs text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && mounted && createPortal(
        <div
          ref={dropdownRef}
          className="dropdown-panel p-2"
          style={{
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
          }}
        >
          <div className="flex flex-col gap-2">
            {options.map((opt) => {
              const checked = effectiveSelected.includes(opt.code)
              return (
                <div
                  key={opt.id}
                  className={`group inline-flex items-center justify-between gap-3 rounded-full px-3 py-2 cursor-pointer transition-all border ${checked ? 'border-teal-300/60 bg-gradient-to-r from-teal-500/12 to-cyan-500/12 text-teal-900 dark:text-teal-200 shadow' : 'border-white/20 bg-white/8 text-foreground hover:bg-white/12'}`}
                  onClick={(e) => {
                    console.log('[MultiSelect] div 被点击', {
                      optionCode: opt.code,
                      optionName: opt.name,
                      currentChecked: checked
                    })
                    toggle(opt.code)
                  }}
                >
                  <span className="flex items-center gap-3">
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-md border border-white/30 bg-white/10 shadow-inner transition-all ${checked ? 'bg-teal-400/60 border-teal-300/80' : ''}`}></span>
                    <span className="text-sm truncate">{opt.name}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
