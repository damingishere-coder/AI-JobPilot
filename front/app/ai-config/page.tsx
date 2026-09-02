'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BiSave, BiBrain, BiInfoCircle, BiRefresh, BiUpload } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import PageHeader from '@/app/components/PageHeader'
import ProfileSwitcher, { type Profile } from '@/app/components/ProfileSwitcher'
import { API_BASE, type ApiEnvelope, friendlyApiError, readApiResponse } from '@/lib/api'

const MAX_RESUME_FILE_SIZE = 30 * 1024 * 1024

const ANALYSIS_LOGIC_TEXT = `1. 平台配置页先决定怎么找岗位：关键词、城市、薪资、学历、经验、行业、公司规模等。
2. 自动任务按这些条件进入招聘平台搜索岗位，并读取公司、岗位名、薪资、地点、经验、学历、公司信息和岗位描述。
3. AI 会把你的简历内容和岗位信息放在一起分析，返回 score、decision、summary、strengths、risks、greeting。
4. 分数达到当前档案设置的投递分数线后，岗位进入“待确认”列表；分数线可在 Boss 投递分析页的“岗位数据”区域设置。
5. 只有你在分析页确认后，系统才会执行实际投递，并优先使用 AI 返回的 greeting。`

type AiConfig = {
  introduce: string
  prompt: string
}

type ResumeMeta = {
  sourceFilename?: string
  parseStatus?: string
  parseMessage?: string
}

type PriorityCompany = {
  companyName?: string
}

type SavedResume = {
  resumeText?: string
  sourceFilename?: string
  parseStatus?: string
  parseMessage?: string
}

type ProfileAwareResponse<T> = ApiEnvelope<T> & {
  currentProfile?: Profile | null
  hasProfile?: boolean
}

type BossConfigResponse = ProfileAwareResponse<never> & {
  config?: {
    enableAi?: unknown
    sayHi?: string
  }
}

type GeneratedAiConfig = {
  introduce?: string
  prompt?: string
  sayHi?: string
}

type ResumeParsePreview = {
  text: string
  localText: string
  sourceFilename: string
  method: string
  qualityScore: number
  warnings: string[]
}

type SaveOptions = {
  nextAiConfig?: AiConfig
  nextResumeText?: string
  nextSayHi?: string
  skipResume?: boolean
  showAlert?: boolean
}

export default function AiConfigPage() {
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    introduce: '',
    prompt: '',
  })
  const [resumeText, setResumeText] = useState('')
  const [resumeMeta, setResumeMeta] = useState<ResumeMeta | null>(null)
  const [priorityCompanies, setPriorityCompanies] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeDirty, setResumeDirty] = useState(false)
  const [sayHi, setSayHi] = useState('')

  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [enableAi, setEnableAi] = useState<number>(0)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [hasProfile, setHasProfile] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSnapshotReady, setProfileSnapshotReady] = useState(false)
  const [backendReady, setBackendReady] = useState(false)
  const [checkingBackend, setCheckingBackend] = useState(true)
  const [readinessError, setReadinessError] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [resumePreview, setResumePreview] = useState<ResumeParsePreview | null>(null)
  const profileLoadSequenceRef = useRef(0)
  const profileLoadAbortRef = useRef<AbortController | null>(null)
  const selectedProfileRef = useRef<Profile | null>(null)
  const readinessAbortRef = useRef<AbortController | null>(null)
  const resumeRecognitionSequenceRef = useRef(0)

  const waitForBackendReady = useCallback(async () => {
    readinessAbortRef.current?.abort()
    const controller = new AbortController()
    readinessAbortRef.current = controller
    setCheckingBackend(true)
    setReadinessError('')
    setBackendReady(false)
    let lastError = '后端服务未就绪'
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const attemptController = new AbortController()
        const abortAttempt = () => attemptController.abort()
        controller.signal.addEventListener('abort', abortAttempt, { once: true })
        const timeoutId = window.setTimeout(() => attemptController.abort(), 1500)
        try {
          const response = await fetch(`${API_BASE}/api/ready`, { cache: 'no-store', signal: attemptController.signal })
          const contentType = response.headers.get('content-type')?.toLowerCase() || ''
          const body = contentType.includes('application/json')
            ? await response.json() as { ready?: boolean; status?: string }
            : null
          if (response.ok && body?.ready === true) {
            setBackendReady(true)
            return
          }
          lastError = body?.status ? `后端尚未就绪：${body.status}` : `后端尚未就绪（HTTP ${response.status}）`
        } catch (error) {
          if (controller.signal.aborted) return
          lastError = friendlyApiError(error, '无法连接后端服务')
        } finally {
          window.clearTimeout(timeoutId)
          controller.signal.removeEventListener('abort', abortAttempt)
        }
        if (attempt < 4) await new Promise((resolve) => window.setTimeout(resolve, 600))
      }
      setReadinessError(`${lastError}，已停止自动重试`)
    } finally {
      if (!controller.signal.aborted) setCheckingBackend(false)
    }
  }, [])

  useEffect(() => {
    void waitForBackendReady()
    return () => {
      profileLoadAbortRef.current?.abort()
      readinessAbortRef.current?.abort()
    }
  }, [waitForBackendReady])

  const markDirty = () => {
    setHasUnsavedChanges(true)
    setStatusMessage('')
  }

  const clearProfileSnapshot = () => {
    profileLoadAbortRef.current?.abort()
    profileLoadAbortRef.current = null
    profileLoadSequenceRef.current += 1
    selectedProfileRef.current = null
    setCurrentProfile(null)
    setHasProfile(false)
    setProfileLoading(false)
    setProfileSnapshotReady(true)
    setAiConfig({ introduce: '', prompt: '' })
    setEnableAi(0)
    setSayHi('')
    setResumeText('')
    setResumeMeta(null)
    setResumePreview(null)
    setPriorityCompanies('')
    setResumeFile(null)
    setResumeDirty(false)
    setHasUnsavedChanges(false)
    setStatusMessage('')
    setLoadError('')
  }

  const parseEnableAi = (raw: unknown) => {
    const val = String(raw ?? '').trim().toLowerCase()
    return val === '1' || val === 'true' || val === 'on' ? 1 : Number(raw) === 1 ? 1 : 0
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }

  const reloadCurrentData = async (expectedProfileId?: number, selectedProfile?: Profile) => {
    const targetProfile = selectedProfile || selectedProfileRef.current || currentProfile
    const targetProfileId = expectedProfileId ?? targetProfile?.id
    if (!targetProfileId) return
    if (selectedProfile) selectedProfileRef.current = selectedProfile
    const sequence = ++profileLoadSequenceRef.current
    profileLoadAbortRef.current?.abort()
    const controller = new AbortController()
    profileLoadAbortRef.current = controller
    setProfileLoading(true)
    setProfileSnapshotReady(false)
    setLoadError('')
    try {
      const [aiResponse, bossResponse, resumeResponse, companiesResponse] = await Promise.all([
        fetch(`${API_BASE}/api/ai/config`, { signal: controller.signal }),
        fetch(`${API_BASE}/api/boss/config`, { signal: controller.signal }),
        fetch(`${API_BASE}/api/ai/resume`, { signal: controller.signal }),
        fetch(`${API_BASE}/api/ai/companies/priority`, { signal: controller.signal }),
      ])
      const [aiResult, bossResult, resumeResult, companiesResult] = await Promise.all([
        readApiResponse<AiConfig>(aiResponse, 'AI配置加载失败') as Promise<ProfileAwareResponse<AiConfig>>,
        readApiResponse<never>(bossResponse, 'Boss配置加载失败') as Promise<BossConfigResponse>,
        readApiResponse<SavedResume>(resumeResponse, '简历加载失败') as Promise<ProfileAwareResponse<SavedResume>>,
        readApiResponse<PriorityCompany[]>(companiesResponse, '优先公司加载失败') as Promise<ProfileAwareResponse<PriorityCompany[]>>,
      ])
      const profileIds = [
        aiResult.currentProfile?.id,
        bossResult.currentProfile?.id,
        resumeResult.currentProfile?.id,
        companiesResult.currentProfile?.id,
      ]
      if (profileIds.some((profileId) => profileId !== targetProfileId)) {
        throw new Error('档案已切换，已丢弃不匹配的旧响应')
      }
      if (controller.signal.aborted || sequence !== profileLoadSequenceRef.current) return

      const resume = resumeResult.data || null
      setAiConfig(aiResult.data
        ? { introduce: aiResult.data.introduce || '', prompt: aiResult.data.prompt || '' }
        : { introduce: '', prompt: '' })
      setEnableAi(parseEnableAi(bossResult.config?.enableAi))
      setSayHi(bossResult.config?.sayHi || '')
      setResumeText(resume?.resumeText || '')
      setResumeMeta(resume ? {
        sourceFilename: resume.sourceFilename,
        parseStatus: resume.parseStatus,
        parseMessage: resume.parseMessage,
      } : null)
      setResumePreview(null)
      setPriorityCompanies(Array.isArray(companiesResult.data)
        ? companiesResult.data.map((it) => it.companyName).filter(Boolean).join('\n')
        : '')
      const committedProfile = selectedProfile || aiResult.currentProfile || null
      selectedProfileRef.current = committedProfile
      setCurrentProfile(committedProfile)
      setHasProfile(true)
      setProfileSnapshotReady(true)
      setHasUnsavedChanges(false)
      setResumeDirty(false)
      setResumeFile(null)
    } catch (error) {
      if (!controller.signal.aborted && sequence === profileLoadSequenceRef.current) {
        setLoadError(friendlyApiError(error, '档案快照加载失败'))
      }
    } finally {
      if (sequence === profileLoadSequenceRef.current) setProfileLoading(false)
    }
  }

  const parseJsonResponse = async <T,>(response: Response, fallback: string) =>
    readApiResponse<T>(response, fallback)

  const toggleEnableAi = async () => {
    if (!hasProfile) {
      alert('请先新建档案')
      return
    }
    try {
      const next = enableAi ? 0 : 1
      setEnableAi(next)
      const response = await fetch(`${API_BASE}/api/boss/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enableAi: next }),
      })
      await readApiResponse<unknown>(response, 'AI开关保存失败')
      setStatusMessage('AI开关已保存')
    } catch (error) {
      setEnableAi((prev) => (prev ? 0 : 1))
      alert(friendlyApiError(error, '切换失败，请检查后端服务连接'))
    }
  }

  const saveAiConfig = async (configToSave: AiConfig) => {
    const response = await fetch(`${API_BASE}/api/ai/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configToSave),
    })
    const result = await parseJsonResponse<AiConfig>(response, 'AI配置保存失败')
    return result.data
  }

  const saveResume = async (textToSave: string): Promise<SavedResume> => {
    if (!textToSave.trim()) throw new Error('简历内容不能为空')
    const previewUnedited = resumePreview?.text === textToSave
    const response = await fetch(`${API_BASE}/api/ai/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resumeText: textToSave,
        sourceFilename: resumePreview?.sourceFilename || resumeMeta?.sourceFilename || null,
        parseMethod: resumePreview?.method || 'manual',
        qualityScore: previewUnedited ? resumePreview?.qualityScore : undefined,
        warnings: resumePreview?.warnings || [],
      }),
    })
    const result = await parseJsonResponse<SavedResume>(response, '简历保存失败')
    if (result.data) {
      setResumeText(result.data.resumeText || textToSave)
      setResumeMeta({
        sourceFilename: result.data.sourceFilename,
        parseStatus: result.data.parseStatus,
        parseMessage: result.data.parseMessage,
      })
    }
    setResumeFile(null)
    setResumePreview(null)
    setResumeDirty(false)
    return result.data || { resumeText: textToSave }
  }

  const savePriorityCompanies = async (value: string) => {
    const companies = value
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((companyName) => ({ companyName, enabled: 1 }))

    const response = await fetch(`${API_BASE}/api/ai/companies/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(companies),
    })
    const result = await parseJsonResponse<PriorityCompany[]>(response, '优先公司保存失败')
    return result.data
  }

  const saveBossGreeting = async (nextSayHi: string) => {
    const response = await fetch(`${API_BASE}/api/boss/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sayHi: nextSayHi, enableAi }),
    })
    await readApiResponse<unknown>(response, 'Boss默认打招呼语保存失败')
  }

  const saveEverything = async ({
    nextAiConfig = aiConfig,
    nextResumeText = resumeText,
    nextSayHi = sayHi,
    skipResume = false,
    showAlert = true,
  }: SaveOptions = {}) => {
    await saveAiConfig(nextAiConfig)
    if (!skipResume && resumeDirty) {
      await saveResume(nextResumeText)
    }
    await saveBossGreeting(nextSayHi)
    await savePriorityCompanies(priorityCompanies)
    await reloadCurrentData()
    setStatusMessage('已保存')
    if (showAlert) {
      alert('打招呼话术、简历资料、优先公司已保存！')
    }
  }

  const handleSave = async () => {
    if (!hasProfile) {
      alert('请先新建档案')
      return
    }
    if (resumeFile && !resumePreview) {
      alert('请先等待文件识别完成，再确认保存')
      return
    }
    setLoading(true)
    try {
      await saveEverything()
    } catch (error) {
      alert(friendlyApiError(error, '保存失败，请检查服务器连接！'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitResumeAndGenerate = async () => {
    if (!hasProfile) {
      alert('请先新建档案')
      return
    }
    setGenerating(true)
    try {
      if (resumeFile && !resumePreview) {
        throw new Error('请先完成文件识别并核对预览')
      }
      const savedResume = resumeDirty
        ? await saveResume(resumeText)
        : { resumeText }
      const latestResumeText = savedResume?.resumeText || resumeText
      if (!latestResumeText.trim()) {
        throw new Error('简历内容为空，请先上传或粘贴简历内容')
      }

      const response = await fetch(`${API_BASE}/api/ai/resume/generate-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: latestResumeText }),
      })
      const result = await parseJsonResponse<GeneratedAiConfig>(response, 'AI配置生成失败')

      const nextSayHi = result.data?.sayHi || ''
      const nextAiConfig = {
        introduce: result.data?.introduce || '',
        prompt: result.data?.prompt || aiConfig.prompt,
      }

      setAiConfig(nextAiConfig)
      setSayHi(nextSayHi)

      await saveEverything({
        nextAiConfig,
        nextResumeText: latestResumeText,
        nextSayHi,
        skipResume: true,
        showAlert: false,
      })
      setStatusMessage('已提交简历并生成AI配置')
      alert('已提交简历，并生成打招呼话术和AI配置！')
    } catch (error) {
      alert(friendlyApiError(error, '提交简历并生成AI配置失败'))
    } finally {
      setGenerating(false)
    }
  }

  const recognizeResumeFile = async (file: File, mode: 'local' | 'ai_review') => {
    const sequence = ++resumeRecognitionSequenceRef.current
    setRecognizing(true)
    setStatusMessage('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('mode', mode)
      const response = await fetch(`${API_BASE}/api/ai/resume/parse`, { method: 'POST', body: form })
      const result = await readApiResponse<ResumeParsePreview>(response, '简历识别失败')
      if (sequence !== resumeRecognitionSequenceRef.current || !result.data) return
      setResumePreview(result.data)
      setResumeText(result.data.text || '')
      setResumeDirty(true)
      setHasUnsavedChanges(true)
      setStatusMessage(mode === 'ai_review' ? 'AI复核完成，待确认保存' : '本地识别完成，待核对保存')
    } catch (error) {
      if (sequence === resumeRecognitionSequenceRef.current) {
        alert(friendlyApiError(error, '简历识别失败'))
      }
    } finally {
      if (sequence === resumeRecognitionSequenceRef.current) setRecognizing(false)
    }
  }

  const handleResumeFileChange = (file: File | null) => {
    resumeRecognitionSequenceRef.current += 1
    if (file && file.size > MAX_RESUME_FILE_SIZE) {
      setResumeFile(null)
      alert(`文件过大：${formatFileSize(file.size)}，请压缩到30MB以内后再上传`)
      return
    }
    setResumeFile(file)
    setResumePreview(null)
    setResumeDirty(false)
    if (file) {
      setHasUnsavedChanges(true)
      void recognizeResumeFile(file, 'local')
    }
  }

  const handleAiReview = async () => {
    if (!resumeFile || recognizing || resumePreview?.method === 'ai-reviewed') return
    const confirmed = window.confirm('复核会把简历页面和本地识别结果发送给当前 AI Provider。系统只请求一次，不会自动切换 Provider 或重试未知结果。是否继续？')
    if (!confirmed) return
    await recognizeResumeFile(resumeFile, 'ai_review')
  }

  const isBusy = loading || generating || recognizing || profileLoading || (hasProfile && !profileSnapshotReady)
  const beforeProfileSwitch = () => {
    if (!hasUnsavedChanges && !resumeDirty && !resumeFile) return true
    return window.confirm('当前简历配置有未保存更改，切换档案会重新加载当前档案数据。确定继续吗？')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<BiBrain className="text-2xl" />}
        title="简历配置"
        subtitle="按人物档案保存简历、打招呼话术和岗位分析配置"
        iconClass="text-white"
        accentBgClass="bg-purple-500"
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasUnsavedChanges ? (
              <span className="rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                有未保存更改
              </span>
            ) : statusMessage ? (
              <span className="rounded-full border border-emerald-300/60 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {statusMessage}
              </span>
            ) : null}
            <Button
              onClick={handleSave}
              size="sm"
              className="app-button-primary px-4"
              type="button"
              disabled={!hasProfile || isBusy}
            >
              <BiSave className="mr-1" /> {loading ? '保存中...' : '保存配置'}
            </Button>
          </div>
        }
      />

      {backendReady ? (
        <ProfileSwitcher
          disabled={isBusy}
          beforeSwitch={beforeProfileSwitch}
          onProfileChange={(profile) => {
            if (!profile) {
              clearProfileSnapshot()
              return
            }
            setCurrentProfile(profile)
            setHasProfile(true)
            void reloadCurrentData(profile.id, profile)
          }}
        />
      ) : (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>{checkingBackend ? '正在等待后端就绪…' : readinessError || '后端服务未就绪'}</span>
          {!checkingBackend ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void waitForBackendReady()}>
              <BiRefresh className="mr-1" /> 手动重试
            </Button>
          ) : null}
        </div>
      )}

      {loadError ? (
        <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>{loadError}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => void reloadCurrentData()} disabled={profileLoading}>
            <BiRefresh className="mr-1" /> 重试加载
          </Button>
        </div>
      ) : null}

      {!hasProfile ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          请先在上方新建档案；没有档案时，下方简历、AI配置、平台参数和投递分析都不会写入。
        </div>
      ) : currentProfile ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          当前正在编辑：{currentProfile.name}
        </div>
      ) : null}

      {hasProfile && !profileSnapshotReady ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前档案已存在，但配置快照尚未完整加载；为防止空值覆盖，保存已禁用。
        </div>
      ) : null}

      {hasUnsavedChanges ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前页面有未保存更改，刷新页面前请点击右上角保存配置，或点击“提交简历并生成AI配置”。
        </div>
      ) : null}

      <div className="space-y-6">
        <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BiUpload className="text-primary" />
              提交简历
            </CardTitle>
            <CardDescription>支持 PDF、Word、TXT、PNG、JPG、JPEG、WEBP，单个文件不超过30MB</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="resume-file">上传简历文件</Label>
                <input
                  id="resume-file"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => handleResumeFileChange(e.target.files?.[0] || null)}
                  disabled={!hasProfile || isBusy}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:text-white"
                />
                <p className="text-xs text-muted-foreground">
                  {resumeFile
                    ? `${recognizing ? '正在识别' : '已选择'}：${resumeFile.name}（${formatFileSize(resumeFile.size)}）`
                    : '也可以直接在下面粘贴简历文本'}
                </p>
                <p className="text-xs text-muted-foreground">
                  文件会先在本机用 Docling + RapidOCR 识别，只生成预览；点击确认保存前不会覆盖已有简历。
                </p>
                {resumeMeta?.sourceFilename ? (
                  <p className="text-xs text-muted-foreground">
                    最近文件：{resumeMeta.sourceFilename}；状态：{resumeMeta.parseStatus || '-'}；{resumeMeta.parseMessage || ''}
                  </p>
                ) : null}
                {resumePreview ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 font-medium ${resumePreview.method === 'ai-reviewed' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {resumePreview.method === 'ai-reviewed' ? 'AI已复核' : '本地识别'}
                      </span>
                      <span className={`rounded-full px-2 py-1 font-medium ${resumePreview.qualityScore >= 85 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                        {resumePreview.qualityScore >= 85 ? '质量良好' : '低置信度'} {resumePreview.qualityScore}
                      </span>
                    </div>
                    {resumePreview.warnings.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-5">
                        {resumePreview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {resumeFile ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => void recognizeResumeFile(resumeFile, 'local')} disabled={recognizing}>
                      {recognizing ? '识别中…' : '重新本地识别'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleAiReview()}
                      disabled={recognizing || !resumePreview || resumePreview.method === 'ai-reviewed'}
                    >
                      {resumePreview?.method === 'ai-reviewed' ? '已完成AI复核' : '使用AI强制复核'}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="resume-text">简历文本</Label>
                <Textarea
                  id="resume-text"
                  value={resumeText}
                  onChange={(e) => {
                    setResumeText(e.target.value)
                    setResumeDirty(true)
                    markDirty()
                  }}
                  disabled={!hasProfile || isBusy}
                  placeholder="上传 PDF/图片/Word 后会在这里显示识别预览；也可以直接粘贴完整简历文本"
                  className="min-h-[240px] resize-y"
                />
              </div>

              <Button
                onClick={handleSubmitResumeAndGenerate}
                className="app-button-success px-5"
                type="button"
                disabled={!hasProfile || isBusy}
              >
                <BiBrain className="mr-1" /> {generating ? '保存并生成中...' : '确认保存并生成AI配置'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
          <CardHeader className="flex items-start gap-4">
            <div className="min-w-0 space-y-2">
              <CardTitle className="flex items-center gap-2">
                <BiBrain className="text-primary" />
                打招呼与AI分析配置
              </CardTitle>
              <CardDescription>用于自动投递时判断岗位是否匹配，并生成或兜底发送沟通话术</CardDescription>
            </div>
            <div>
              <button
                type="button"
                aria-label="AI启用开关"
                onClick={toggleEnableAi}
                disabled={!hasProfile || isBusy}
                className={`relative inline-flex h-7 w-14 rounded-full border border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,.25)] transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400/40 ${enableAi ? 'bg-emerald-500/80 hover:bg-emerald-500' : 'bg-white/10 hover:bg-white/15'}`}
              >
                <span
                  className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${enableAi ? 'translate-x-7' : 'translate-x-0'}`}
                />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="say-hi">打招呼话术</Label>
                <Textarea
                  id="say-hi"
                  value={sayHi}
                  onChange={(e) => {
                    setSayHi(e.target.value)
                    markDirty()
                  }}
                  disabled={!hasProfile || isBusy}
                  placeholder="您好，我对这个岗位很感兴趣，希望可以进一步沟通，谢谢！"
                  className="min-h-[120px] resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  AI关闭、AI返回为空或生成失败时，Boss投递会使用这段话术
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="analysis-logic">投递岗位分析逻辑</Label>
                <Textarea
                  id="analysis-logic"
                  value={ANALYSIS_LOGIC_TEXT}
                  readOnly
                  className="min-h-[190px] resize-y bg-muted/40"
                />
                <p className="text-xs text-muted-foreground">
                  这段逻辑由后端投递决策服务执行，为避免自动投递误判，当前仅展示不直接编辑
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="prompt">打招呼生成提示词模板</Label>
                <Textarea
                  id="prompt"
                  value={aiConfig.prompt}
                  onChange={(e) => {
                    setAiConfig({ ...aiConfig, prompt: e.target.value })
                    markDirty()
                  }}
                  disabled={!hasProfile || isBusy}
                  placeholder="用于生成Boss打招呼语，支持5个 %s 占位符"
                  className="min-h-[120px] resize-y"
                />
                <p className="text-xs text-muted-foreground">
                  该模板用于生成打招呼语；岗位是否投递由上面的分析逻辑决定
                </p>
              </div>

              <details className="rounded-lg border border-border/60 p-3">
                <summary className="cursor-pointer text-sm font-medium">查看AI提取的简历摘要</summary>
                <Textarea
                  value={aiConfig.introduce}
                  onChange={(e) => {
                    setAiConfig({ ...aiConfig, introduce: e.target.value })
                    markDirty()
                  }}
                  disabled={!hasProfile || isBusy}
                  placeholder="提交简历并生成AI配置后，这里会保存AI提取的个人技能和经历摘要"
                  className="mt-3 min-h-[120px] resize-y"
                />
              </details>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-in fade-in slide-in-from-bottom-5 duration-700">
          <CardHeader>
            <CardTitle>优先公司名单</CardTitle>
            <CardDescription>每行一个公司名；优先公司使用较低分数线，分数线在 Boss 投递分析页设置</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={priorityCompanies}
              onChange={(e) => {
                setPriorityCompanies(e.target.value)
                markDirty()
              }}
              disabled={!hasProfile || isBusy}
              placeholder={'OpenAI\n微软\n字节跳动'}
              className="min-h-[150px] resize-y"
            />
          </CardContent>
        </Card>

        <Card className="animate-in fade-in slide-in-from-bottom-6 border-primary/20 bg-primary/5 duration-700">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <BiInfoCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
              <div>
                <p className="mb-2 text-sm text-foreground">
                  <strong className="font-semibold">平台配置和简历匹配是怎么工作的：</strong>
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>平台配置页决定搜索条件，例如关键词、城市、薪资、学历、经验、行业和公司规模。</li>
                  <li>自动任务按这些条件在招聘平台搜索岗位，并提取岗位详情和公司信息。</li>
                  <li>提交简历后，AI会用“简历内容 + 岗位信息 + 优先公司阈值”进行匹配打分。</li>
                  <li>岗位达到设置的分数线后进入待确认，分数线可在 Boss 投递分析页的“岗位数据”区域修改。</li>
                  <li>你确认投递后，系统优先发送AI生成的 greeting；没有可用 greeting 时发送默认打招呼话术。</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
