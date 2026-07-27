'use client'

import { useEffect, useState } from 'react'
import { BiSave, BiBrain, BiInfoCircle, BiUpload } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import PageHeader from '@/app/components/PageHeader'
import ProfileSwitcher, { type Profile } from '@/app/components/ProfileSwitcher'
import { API_BASE } from '@/lib/api'

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

type SaveOptions = {
  nextAiConfig?: AiConfig
  nextResumeText?: string
  nextResumeFile?: File | null
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
  const [enableAi, setEnableAi] = useState<number>(0)
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [hasProfile, setHasProfile] = useState(false)

  useEffect(() => {
    reloadCurrentData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markDirty = () => {
    setHasUnsavedChanges(true)
    setStatusMessage('')
  }

  const parseEnableAi = (raw: unknown) => {
    const val = String(raw ?? '').trim().toLowerCase()
    return val === '1' || val === 'true' || val === 'on' ? 1 : Number(raw) === 1 ? 1 : 0
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }

  const reloadCurrentData = async () => {
    await Promise.all([fetchAiConfig(), fetchBossConfig(), fetchResume(), fetchPriorityCompanies()])
    setHasUnsavedChanges(false)
    setResumeDirty(false)
    setResumeFile(null)
  }

  const fetchAiConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ai/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      const result = await response.json()
      if (result.success && result.data) {
        setAiConfig({
          introduce: result.data.introduce || '',
          prompt: result.data.prompt || '',
        })
      } else {
        setAiConfig({ introduce: '', prompt: '' })
      }
      setCurrentProfile(result.currentProfile || null)
      setHasProfile(Boolean(result.hasProfile || result.currentProfile))
    } catch (error) {
      console.error('加载AI配置失败:', error)
      setAiConfig({ introduce: '', prompt: '' })
    }
  }

  const fetchResume = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ai/resume`)
      const result = await response.json()
      if (result.success && result.data) {
        setResumeText(result.data.resumeText || '')
        setResumeMeta({
          sourceFilename: result.data.sourceFilename,
          parseStatus: result.data.parseStatus,
          parseMessage: result.data.parseMessage,
        })
      } else {
        setResumeText('')
        setResumeMeta(null)
      }
      setCurrentProfile(result.currentProfile || null)
      setHasProfile(Boolean(result.hasProfile || result.currentProfile))
    } catch (error) {
      console.error('加载简历失败:', error)
      setResumeText('')
      setResumeMeta(null)
    }
  }

  const fetchPriorityCompanies = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/ai/companies/priority`)
      const result = await response.json()
      if (result.success && Array.isArray(result.data)) {
        setPriorityCompanies(result.data.map((it: PriorityCompany) => it.companyName).filter(Boolean).join('\n'))
      } else {
        setPriorityCompanies('')
      }
      setCurrentProfile(result.currentProfile || null)
      setHasProfile(Boolean(result.hasProfile || result.currentProfile))
    } catch (error) {
      console.error('加载优先公司失败:', error)
      setPriorityCompanies('')
    }
  }

  const fetchBossConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/boss/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      const result = await response.json()
      setEnableAi(parseEnableAi(result?.config?.enableAi))
      setSayHi(result?.config?.sayHi || '')
      setCurrentProfile(result?.currentProfile || null)
      setHasProfile(Boolean(result?.hasProfile || result?.currentProfile))
    } catch (e) {
      console.error('加载Boss AI配置失败:', e)
    }
  }

  const parseJsonResponse = async (response: Response, fallback: string) => {
    try {
      const result = await response.json()
      if (!response.ok || result?.success === false) {
        throw new Error(result?.message || fallback)
      }
      return result
    } catch (error) {
      if (error instanceof Error) throw error
      throw new Error(fallback)
    }
  }

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
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      setStatusMessage('AI开关已保存')
    } catch (e) {
      console.error('更新enable_ai失败:', e)
      setEnableAi((prev) => (prev ? 0 : 1))
      alert('切换失败，请检查后端服务连接')
    }
  }

  const saveAiConfig = async (configToSave: AiConfig) => {
    const response = await fetch(`${API_BASE}/api/ai/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configToSave),
    })
    const result = await parseJsonResponse(response, 'AI配置保存失败')
    return result.data
  }

  const saveResume = async (fileToSave: File | null, textToSave: string): Promise<SavedResume> => {
    if (fileToSave && fileToSave.size > MAX_RESUME_FILE_SIZE) {
      throw new Error(`文件过大：${formatFileSize(fileToSave.size)}，请压缩到30MB以内后再上传`)
    }

    const resumeForm = new FormData()
    if (fileToSave) {
      resumeForm.append('file', fileToSave)
    } else {
      resumeForm.append('resumeText', textToSave)
    }

    const response = await fetch(`${API_BASE}/api/ai/resume`, {
      method: 'POST',
      body: resumeForm,
    })
    const result = await parseJsonResponse(response, '简历保存失败')
    if (result.data) {
      setResumeText(result.data.resumeText || textToSave)
      setResumeMeta({
        sourceFilename: result.data.sourceFilename,
        parseStatus: result.data.parseStatus,
        parseMessage: result.data.parseMessage,
      })
    }
    setResumeFile(null)
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
    const result = await parseJsonResponse(response, '优先公司保存失败')
    return result.data
  }

  const saveBossGreeting = async (nextSayHi: string) => {
    const response = await fetch(`${API_BASE}/api/boss/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sayHi: nextSayHi, enableAi }),
    })
    if (!response.ok) throw new Error('Boss默认打招呼语保存失败')
    return response.json()
  }

  const saveEverything = async ({
    nextAiConfig = aiConfig,
    nextResumeText = resumeText,
    nextResumeFile = resumeFile,
    nextSayHi = sayHi,
    skipResume = false,
    showAlert = true,
  }: SaveOptions = {}) => {
    await saveAiConfig(nextAiConfig)
    if (!skipResume && (nextResumeFile || resumeDirty)) {
      await saveResume(nextResumeFile, nextResumeText)
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
    setLoading(true)
    try {
      await saveEverything()
    } catch (error) {
      console.error('保存AI配置失败:', error)
      alert(error instanceof Error ? error.message : '保存失败，请检查服务器连接！')
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
      const savedResume = resumeFile || resumeDirty
        ? await saveResume(resumeFile, resumeText)
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
      const result = await parseJsonResponse(response, 'AI配置生成失败')

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
        nextResumeFile: null,
        nextSayHi,
        skipResume: true,
        showAlert: false,
      })
      setStatusMessage('已提交简历并生成AI配置')
      alert('已提交简历，并生成打招呼话术和AI配置！')
    } catch (error) {
      console.error('提交简历并生成AI配置失败:', error)
      alert(error instanceof Error ? error.message : '提交简历并生成AI配置失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleResumeFileChange = (file: File | null) => {
    if (file && file.size > MAX_RESUME_FILE_SIZE) {
      setResumeFile(null)
      alert(`文件过大：${formatFileSize(file.size)}，请压缩到30MB以内后再上传`)
      return
    }
    setResumeFile(file)
    setResumeDirty(true)
    markDirty()
  }

  const isBusy = loading || generating
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

      <ProfileSwitcher
        beforeSwitch={beforeProfileSwitch}
        onProfileChange={(profile) => {
          setCurrentProfile(profile)
          setHasProfile(true)
          reloadCurrentData()
        }}
      />

      {!hasProfile ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          请先在上方新建档案；没有档案时，下方简历、AI配置、平台参数和投递分析都不会写入。
        </div>
      ) : currentProfile ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          当前正在编辑：{currentProfile.name}
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
            <CardDescription>支持 PDF、TXT、PNG、JPG、JPEG、WEBP，单个文件不超过30MB</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="resume-file">上传简历文件</Label>
                <input
                  id="resume-file"
                  type="file"
                  accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => handleResumeFileChange(e.target.files?.[0] || null)}
                  disabled={!hasProfile || isBusy}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:text-white"
                />
                <p className="text-xs text-muted-foreground">
                  {resumeFile
                    ? `待提交文件：${resumeFile.name}（${formatFileSize(resumeFile.size)}）`
                    : '也可以直接在下面粘贴简历文本'}
                </p>
                <p className="text-xs text-muted-foreground">
                  文本型 PDF 可直接解析；扫描版 PDF 可能无法提取文字，请粘贴文本或上传图片简历。
                </p>
                {resumeMeta?.sourceFilename ? (
                  <p className="text-xs text-muted-foreground">
                    最近文件：{resumeMeta.sourceFilename}；状态：{resumeMeta.parseStatus || '-'}；{resumeMeta.parseMessage || ''}
                  </p>
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
                  placeholder="上传 PDF/图片后会在这里显示解析结果；也可以直接粘贴完整简历文本"
                  className="min-h-[240px] resize-y"
                />
              </div>

              <Button
                onClick={handleSubmitResumeAndGenerate}
                className="app-button-success px-5"
                type="button"
                disabled={!hasProfile || isBusy}
              >
                <BiBrain className="mr-1" /> {generating ? '提交并生成中...' : '提交简历并生成AI配置'}
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
