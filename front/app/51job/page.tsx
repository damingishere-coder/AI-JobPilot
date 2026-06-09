'use client'

import { useState, useEffect } from 'react'
import { API_BASE } from '@/lib/api'
import { createSSEWithBackoff } from '@/lib/sse'
import { BiLogOut, BiSave, BiBriefcase, BiPlay, BiStop } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import PageHeader from '@/app/components/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import AnalysisContent from '@/app/51job/analysis/AnalysisContent'

interface Job51Config {
  id?: number
  keywords?: string
  jobArea?: string
  salary?: string
}

interface Job51Option { name: string; code: string }
interface Job51Options { jobArea: Job51Option[]; salary: Job51Option[] }

export default function Job51Page() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isDelivering, setIsDelivering] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(true)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null)
  const [showLogoutResultDialog, setShowLogoutResultDialog] = useState(false)
  const [logoutResult, setLogoutResult] = useState<{ success: boolean; message: string } | null>(null)

  const [config, setConfig] = useState<Job51Config>({ keywords: '', jobArea: '', salary: '' })
  const [options, setOptions] = useState<Job51Options>({ jobArea: [], salary: [] })
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [isCustomArea, setIsCustomArea] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const [cookieSavedAfterLogin, setCookieSavedAfterLogin] = useState(false)

  useEffect(() => {
    if (!backendAvailable) {
      setCheckingLogin(false)
      return
    }
    console.log('[51job] useEffect 开始执行')
    console.log('[51job] window:', typeof window)
    console.log('[51job] EventSource:', typeof EventSource)

    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      console.warn('[51job] EventSource 不可用，无法连接SSE')
      setCheckingLogin(false)
      return
    }

    const client = createSSEWithBackoff(`${API_BASE}/api/jobs/login-status/stream`, {
      onOpen: () => {
        console.log('[51job SSE] ✅ 连接已打开')
      },
      onError: (e, attempt, delay) => {
        console.warn(`[51job SSE] 连接错误，准备第${attempt}次重连，延迟 ${delay}ms`, e)
        setCheckingLogin(false)
      },
      listeners: [
        {
          name: 'connected',
          handler: (event) => {
            console.log('[51job SSE] ✅ 收到 connected 事件:', event.data)
            try {
              const data = JSON.parse(event.data)
              setIsLoggedIn(data.job51LoggedIn || false)
              if (data.job51LoggedIn && !cookieSavedAfterLogin) {
                fetch(`${API_BASE}/api/cookie/save?platform=51job`, { method: 'POST' }).catch(() => {})
                setCookieSavedAfterLogin(true)
              }
              setCheckingLogin(false)
            } catch (error) {
              console.error('[51job SSE] ❌ 解析连接消息失败:', error)
            }
          },
        },
        {
          name: 'login-status',
          handler: (event) => {
            try {
              const data = JSON.parse(event.data)
              if (data.platform === '51job') {
                setIsLoggedIn(data.isLoggedIn)
                if (data.isLoggedIn && !cookieSavedAfterLogin) {
                  fetch(`${API_BASE}/api/cookie/save?platform=51job`, { method: 'POST' }).catch(() => {})
                  setCookieSavedAfterLogin(true)
                }
                setCheckingLogin(false)
              }
            } catch (error) {
              console.error('[51job SSE] ❌ 解析登录状态消息失败:', error)
            }
          },
        },
        {
          name: 'ping',
          handler: () => {
            // 心跳事件，无需处理，可以用于调试：console.debug('[51job SSE] ♥ ping')
          },
        },
      ],
    })

    return () => {
      console.log('[51job SSE] 🔌 关闭SSE连接')
      client.close()
    }
  }, [backendAvailable])

  // 解析/序列化关键词（与猎聘保持一致）
  const parseKeywordsFromDb = (raw?: string): string => {
    if (!raw) return ''
    const t = raw.trim()
    if (t.startsWith('[') && t.endsWith(']')) {
      try {
        const arr = JSON.parse(t)
        if (Array.isArray(arr)) return arr.filter(Boolean).join(', ')
      } catch (e) {
        console.warn('[51job] 解析关键词JSON失败，使用原值:', e)
      }
    }
    return t.replace(/，/g, ',')
  }

  const serializeKeywordsForDb = (display?: string): string => {
    const raw = (display || '').trim()
    if (!raw) return '[]'
    const norm = raw.replace(/，/g, ',')
    const tokens = norm
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return JSON.stringify(tokens)
  }

  // 解析后端存储的列表字符串，返回第一个元素（用于单选）
  const parseSingleTokenFromDb = (raw?: string): string => {
    if (!raw) return ''
    const t = raw.trim()
    if (t.startsWith('[') && t.endsWith(']')) {
      try {
        const arr = JSON.parse(t)
        if (Array.isArray(arr) && arr.length > 0) {
          return String(arr[0] ?? '').trim()
        }
      } catch (_) {
        // ignore, fall through
      }
    }
    // 非 JSON 数组时，按逗号拆分，取第一个
    const parts = t.replace(/，/g, ',').split(',').map((s) => s.trim()).filter(Boolean)
    return parts[0] || ''
  }

  const fetchAllData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/51job/config`)
      if (!res.ok) {
        console.warn(`[51job] 获取配置失败: ${res.status}`)
        setConfig({ keywords: '', jobArea: '', salary: '' })
        setOptions({ jobArea: [], salary: [] })
        return
      }
      const data = await res.json()
      if (data.config || data.options) {
        const opts: Job51Options = data.options || { jobArea: [], salary: [] }
        const conf: Job51Config = data.config || { keywords: '', jobArea: '', salary: '' }

        // 关键词标准化（展示用）
        const normalizedKeywords = parseKeywordsFromDb(conf.keywords)

        // 从服务端字段提取第一个 token，然后映射到 code
        const rawArea = parseSingleTokenFromDb(conf.jobArea)
        const rawSalary = parseSingleTokenFromDb(conf.salary)

        const areaList = opts.jobArea || []
        const salaryList = opts.salary || []

        const matchArea = areaList.find((o) => o.code === rawArea || o.name === rawArea)
        const matchSalary = salaryList.find((o) => o.code === rawSalary || o.name === rawSalary)

        const areaCode = matchArea?.code || (areaList.find((o) => o.name === '不限')?.code || areaList.find((o) => o.code === '0')?.code || '')
        const salaryCode = matchSalary?.code || (salaryList.find((o) => o.name === '不限')?.code || salaryList.find((o) => o.code === '0')?.code || '')

        setOptions(opts)
        setConfig({ ...conf, keywords: normalizedKeywords, jobArea: areaCode, salary: salaryCode })
        setIsCustomArea(false)
      }
    } catch (e) {
      console.warn('[51job] 获取配置异常（可能后端未启动）:', e)
    } finally {
      setLoadingConfig(false)
    }
  }

  // 后端可用性探测：成功则加载配置，否则停止加载并禁用SSE
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/51job/config`, { method: 'GET' })
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
  }, [])

  const handleStartDelivery = async () => {
    try {
      setIsDelivering(true)
      const response = await fetch(`${API_BASE}/api/51job/start`, { method: 'POST' })
      const data = await response.json()
      if (!data.success) {
        console.warn('[51job] 启动失败：', data.message)
        setIsDelivering(false)
      }
    } catch (error) {
      console.error('[51job] 启动投递失败：', error)
      setIsDelivering(false)
    }
  }

  const handleStopDelivery = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/51job/stop`, { method: 'POST' })
      const data = await response.json()
      if (data.success) setIsDelivering(false)
    } catch (error) {}
  }

  const triggerLogout = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/51job/logout`, { method: 'POST' })
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
      const response = await fetch(`${API_BASE}/api/cookie/save?platform=51job`, { method: 'POST' })
      const data = await response.json()
      setSaveResult({ success: data.success, message: data.success ? '配置保存成功。' : data.message })
      setShowSaveDialog(true)
    } catch (error) {
      setSaveResult({ success: false, message: '配置保存失败：网络或服务异常。' })
      setShowSaveDialog(true)
    }
  }

  const handleSaveConfig = async () => {
    try {
      // 将 jobArea / salary 统一为“中文名”的括号列表字符串，满足后端保存中文的要求
      const toBracketListString = (v?: string, type?: 'jobArea' | 'salary') => {
        const t = (v || '').trim()
        if (!t) return '[]'
        if (type === 'jobArea') {
          // 城市允许手动输入，若下拉匹配不到则直接保存输入值
          const match = (options.jobArea || []).find((o) => o.code === t || o.name === t)
          const name = match?.name || t
          return `["${name.replace(/"/g, '\\"')}"]`
        }
        if (type === 'salary') {
          // 薪资仅允许下拉单选，必须映射为中文名
          const match = (options.salary || []).find((o) => o.code === t || o.name === t)
          const name = match?.name || ''
          return name ? `["${name.replace(/"/g, '\\"')}"]` : '[]'
        }
        return `["${t.replace(/"/g, '\\"')}"]`
      }
      const payload = {
        ...config,
        keywords: serializeKeywordsForDb(config.keywords),
        jobArea: toBracketListString(config.jobArea, 'jobArea'),
        salary: toBracketListString(config.salary, 'salary'),
      }
      const response = await fetch(`${API_BASE}/api/51job/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (response.ok) {
        // 保存配置成功后，同步保存 Cookie（按你的要求加到保存按钮）
        try {
          await fetch(`${API_BASE}/api/cookie/save?platform=51job`, { method: 'POST' })
        } catch (e) {
          console.warn('[51job] 保存 Cookie 失败:', e)
        }
        await fetchAllData()
        setSaveResult({ success: true, message: '保存成功，配置与Cookie已更新。' })
      } else {
        setSaveResult({ success: false, message: '保存失败：后端返回异常状态。' })
      }
      setShowSaveDialog(true)
    } catch (error) {
      console.error('[51job] 保存配置失败:', error)
      setSaveResult({ success: false, message: '保存失败：网络或服务异常。' })
      setShowSaveDialog(true)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BiBriefcase className="text-2xl" />}
        title="51job配置"
        subtitle="配置51job平台的求职参数"
        iconClass="text-white"
        accentBgClass="bg-blue-500"
        actions={
          <div className="flex items-center gap-2">
            {checkingLogin ? (
              <Button size="sm" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 text-slate-500 cursor-not-allowed shadow-sm">
                <BiPlay className="mr-1" /> 检查登录中...
              </Button>
            ) : !isLoggedIn ? (
              <Button size="sm" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 text-slate-500 cursor-not-allowed shadow-sm">
                <BiPlay className="mr-1" /> 请先登录51job
              </Button>
            ) : isDelivering ? (
              <Button onClick={handleStopDelivery} size="sm" className="app-button-danger px-4">
                <BiStop className="mr-1" /> 停止投递
              </Button>
            ) : (
              <Button onClick={handleStartDelivery} size="sm" className="app-button-success px-4">
                <BiPlay className="mr-1" /> 开始投递
              </Button>
            )}
            <Button onClick={() => setShowLogoutDialog(true)} size="sm" className="app-button-danger px-4">
              <BiLogOut className="mr-1" /> 退出登录
            </Button>
            <Button onClick={handleSaveConfig} size="sm" className="app-button-primary px-4">
              <BiSave className="mr-1" /> 保存配置
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="config" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="config">平台配置</TabsTrigger>
          <TabsTrigger value="analytics">投递分析</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6 mt-6">
          {/* 平台说明 */}
          <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BiBriefcase className="text-primary" />
                51job 平台说明
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">请在浏览器标签页中登录 51job 平台，登录成功后系统会自动检测登录状态。</p>
                <p className="text-sm text-muted-foreground">登录成功后，点击“开始投递”按钮启动自动投递任务。</p>
                <p className="text-sm text-muted-foreground">点击“保存配置”按钮可手动保存当前登录相关信息到数据库。</p>
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
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>城市区域</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomArea(!isCustomArea)
                          if (!isCustomArea) setConfig((c) => ({ ...c, jobArea: '' }))
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        {isCustomArea ? '从列表选择' : '手动输入'}
                      </button>
                    </div>
                    {isCustomArea ? (
                      <Input
                        placeholder="请输入城市码，例如：410"
                        value={config.jobArea || ''}
                        onChange={(e) => setConfig((c) => ({ ...c, jobArea: e.target.value }))}
                      />
                    ) : (
                      <Select
                        value={config.jobArea || ''}
                        onChange={(e) => setConfig((c) => ({ ...c, jobArea: e.target.value }))}
                        placeholder="请选择城市"
                      >
                        <option value="">请选择城市</option>
                        {options.jobArea.map((o) => (
                          <option key={o.code} value={o.code}>{o.name}</option>
                        ))}
                      </Select>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {isCustomArea ? '手动输入城市码（例如：410代表北京）' : '从列表选择城市，或点击"手动输入"自定义'}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>薪资范围</Label>
                    <Select
                      value={config.salary || ''}
                      onChange={(e) => setConfig((c) => ({ ...c, salary: e.target.value }))}
                      placeholder="请选择薪资"
                    >
                      {options.salary.map((o) => (
                        <option key={o.code} value={o.code}>{o.name}</option>
                      ))}
                    </Select>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6 mt-6">
          <AnalysisContent />
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

      {/* 保存Cookie结果弹框 */}
      {showSaveDialog && saveResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Card className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[92%] max-w-sm border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BiSave className={saveResult.success ? 'text-green-500' : 'text-red-500'} />
                {saveResult.success ? '保存成功' : '保存失败'}
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
