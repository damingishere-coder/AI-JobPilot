'use client'

import { useRef, useState } from 'react'
import { BiMessageDetail, BiRefresh, BiSave } from 'react-icons/bi'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import ProfileSwitcher, { type Profile } from '@/app/components/ProfileSwitcher'
import { API_BASE, friendlyApiError, localActionFetch, readApiResponse } from '@/lib/api'

type QqTargetType = 'PRIVATE' | 'GROUP'

type CommunicationProfile = {
  expectedSalary: string
  workLocation: string
  availability: string
  interviewAvailability: string
  contactPreference: string
  tone: string
  forbiddenClaims: string
}

type HrAssistantSettings = {
  profileId: number
  communicationProfile: CommunicationProfile
  qqEnabled: boolean
  napcatWsUrl: string
  qqTargetType: QqTargetType
  qqTargetMasked: string
  qqOperatorMasked: string
  qqOperatorConfigured: boolean
  napcatTokenConfigured: boolean
  retentionDays: number
  fullAutoLocked: boolean
}

type SettingsForm = {
  communicationProfile: CommunicationProfile
  qqEnabled: boolean
  napcatWsUrl: string
  napcatToken: string
  qqTargetType: QqTargetType
  qqTarget: string
  qqOperator: string
  clearOperator: boolean
}

const emptyForm = (): SettingsForm => ({
  communicationProfile: {
    expectedSalary: '',
    workLocation: '',
    availability: '',
    interviewAvailability: '',
    contactPreference: '',
    tone: '简洁、礼貌、积极',
    forbiddenClaims: '不得编造经历或承诺未知事实',
  },
  qqEnabled: false,
  napcatWsUrl: 'ws://127.0.0.1:3001',
  napcatToken: '',
  qqTargetType: 'PRIVATE',
  qqTarget: '',
  qqOperator: '',
  clearOperator: false,
})

export default function HrAssistantSettingsCard() {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<SettingsForm>(emptyForm)
  const [savedTargetType, setSavedTargetType] = useState<QqTargetType>('PRIVATE')
  const [targetMasked, setTargetMasked] = useState('')
  const [operatorMasked, setOperatorMasked] = useState('')
  const [operatorConfigured, setOperatorConfigured] = useState(false)
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState('')
  const [loadError, setLoadError] = useState('')
  const loadSequence = useRef(0)

  const applySettings = (settings: HrAssistantSettings) => {
    const targetType = settings.qqTargetType === 'GROUP' ? 'GROUP' : 'PRIVATE'
    const profile = settings.communicationProfile || emptyForm().communicationProfile
    setForm({
      communicationProfile: {
        expectedSalary: profile.expectedSalary || '',
        workLocation: profile.workLocation || '',
        availability: profile.availability || '',
        interviewAvailability: profile.interviewAvailability || '',
        contactPreference: profile.contactPreference || '',
        tone: profile.tone || '简洁、礼貌、积极',
        forbiddenClaims: profile.forbiddenClaims || '不得编造经历或承诺未知事实',
      },
      qqEnabled: settings.qqEnabled === true,
      napcatWsUrl: settings.napcatWsUrl || 'ws://127.0.0.1:3001',
      napcatToken: '',
      qqTargetType: targetType,
      qqTarget: '',
      qqOperator: '',
      clearOperator: false,
    })
    setSavedTargetType(targetType)
    setTargetMasked(settings.qqTargetMasked || '')
    setOperatorMasked(settings.qqOperatorMasked || '')
    setOperatorConfigured(settings.qqOperatorConfigured === true)
    setTokenConfigured(settings.napcatTokenConfigured === true)
    setDirty(false)
  }

  const loadSettings = async (profile: Profile) => {
    const sequence = ++loadSequence.current
    setCurrentProfile(profile)
    setForm(emptyForm())
    setTargetMasked('')
    setOperatorMasked('')
    setOperatorConfigured(false)
    setTokenConfigured(false)
    setDirty(false)
    setLoading(true)
    setLoadError('')
    setStatus('')
    try {
      const response = await fetch(`${API_BASE}/api/hr-assistant/settings`, { cache: 'no-store' })
      const result = await readApiResponse<HrAssistantSettings>(response, 'BOSS HR 设置加载失败')
      if (sequence !== loadSequence.current || !result.data) return
      if (Number(result.data.profileId) !== Number(profile.id)) {
        throw new Error('当前档案已变化，请重新加载后再编辑')
      }
      applySettings(result.data)
    } catch (error) {
      if (sequence === loadSequence.current) {
        setLoadError(friendlyApiError(error, 'BOSS HR 设置加载失败'))
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }

  const updateCommunication = (key: keyof CommunicationProfile, value: string) => {
    setForm((current) => ({
      ...current,
      communicationProfile: { ...current.communicationProfile, [key]: value },
    }))
    setDirty(true)
  }

  const updateForm = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const beforeProfileSwitch = () => {
    if (!dirty) return true
    return window.confirm('当前 BOSS HR 设置尚未保存，切换档案会丢失这些修改。确定继续吗？')
  }

  const saveSettings = async () => {
    if (!currentProfile || loading || saving) return
    if (form.qqEnabled && !form.napcatToken.trim() && !tokenConfigured) {
      setStatus('启用 QQ 通知前请填写 NapCat Token。')
      return
    }
    if (form.qqEnabled && !form.qqTarget.trim() && (!targetMasked || form.qqTargetType !== savedTargetType)) {
      setStatus(form.qqTargetType === 'GROUP' ? '启用群通知前请填写目标群号。' : '启用私人 QQ 通知前请填写目标 QQ。')
      return
    }

    setSaving(true)
    setStatus('')
    try {
      const response = await localActionFetch(`${API_BASE}/api/hr-assistant/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedProfileId: currentProfile.id,
          communicationProfile: form.communicationProfile,
          qqEnabled: form.qqEnabled,
          napcatWsUrl: form.napcatWsUrl.trim(),
          napcatToken: form.napcatToken.trim(),
          qqTargetType: form.qqTargetType,
          qqTarget: form.qqTarget.trim(),
          qqOperator: form.qqTargetType === 'GROUP'
            ? form.qqOperator.trim() || (form.clearOperator ? '' : null)
            : null,
          retentionDays: 30,
        }),
      })
      const result = await readApiResponse<HrAssistantSettings>(response, 'BOSS HR 设置保存失败')
      if (!result.data || Number(result.data.profileId) !== Number(currentProfile.id)) {
        throw new Error('保存后的档案与当前档案不一致，请重新加载')
      }
      applySettings(result.data)
      setStatus('BOSS HR 设置已加密保存。')
    } catch (error) {
      setStatus(friendlyApiError(error, 'BOSS HR 设置保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const targetChanged = form.qqTargetType !== savedTargetType
  const targetPlaceholder = targetChanged
    ? '切换通知方式后必须填写新的目标'
    : targetMasked ? `已配置：${targetMasked}；留空不修改` : form.qqTargetType === 'GROUP' ? '请输入目标群号' : '请输入目标 QQ'

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-6 duration-700">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BiMessageDetail className="text-primary" />
          BOSS HR 值守与 QQ 通知
        </CardTitle>
        <CardDescription>按人物档案保存沟通资料和 NapCat 通知设置；BOSS 页面仅保留值守与待确认回复。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ProfileSwitcher
          compact
          disabled={loading || saving}
          beforeSwitch={beforeProfileSwitch}
          onProfileChange={(profile) => {
            if (!profile) {
              loadSequence.current += 1
              setCurrentProfile(null)
              setForm(emptyForm())
              setDirty(false)
              setLoadError('请先创建人物档案。')
              return
            }
            void loadSettings(profile)
          }}
        />

        {loadError ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>{loadError}</span>
            {currentProfile ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => void loadSettings(currentProfile)} disabled={loading}>
                <BiRefresh className="mr-1" />重新加载
              </Button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">正在加载当前档案的 BOSS HR 设置…</p>
        ) : null}

        {currentProfile && !loadError && !loading ? (
          <>
            <div>
              <h3 className="mb-3 text-sm font-semibold">沟通资料</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="期望薪资" id="hrExpectedSalary" value={form.communicationProfile.expectedSalary} onChange={(value) => updateCommunication('expectedSalary', value)} />
                <Field label="工作地点" id="hrWorkLocation" value={form.communicationProfile.workLocation} onChange={(value) => updateCommunication('workLocation', value)} />
                <Field label="到岗时间" id="hrAvailability" value={form.communicationProfile.availability} onChange={(value) => updateCommunication('availability', value)} />
                <Field label="可面试时间" id="hrInterviewAvailability" value={form.communicationProfile.interviewAvailability} onChange={(value) => updateCommunication('interviewAvailability', value)} />
                <Field label="联系方式偏好" id="hrContactPreference" value={form.communicationProfile.contactPreference} onChange={(value) => updateCommunication('contactPreference', value)} />
                <Field label="回复语气" id="hrTone" value={form.communicationProfile.tone} onChange={(value) => updateCommunication('tone', value)} />
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="hrForbiddenClaims">禁止承诺或编造</Label>
                  <Textarea id="hrForbiddenClaims" value={form.communicationProfile.forbiddenClaims} onChange={(event) => updateCommunication('forbiddenClaims', event.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">NapCat 与 QQ 通知</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="hrNapcatWsUrl">NapCat WebSocket</Label>
                  <Input id="hrNapcatWsUrl" value={form.napcatWsUrl} onChange={(event) => updateForm('napcatWsUrl', event.target.value)} placeholder="ws://127.0.0.1:3001" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hrQqTargetType">QQ 通知方式</Label>
                  <select
                    id="hrQqTargetType"
                    value={form.qqTargetType}
                    onChange={(event) => updateForm('qqTargetType', event.target.value as QqTargetType)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="PRIVATE">私人 QQ</option>
                    <option value="GROUP">指定群聊</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hrQqTarget">{form.qqTargetType === 'GROUP' ? '目标群号' : '目标私人 QQ'}</Label>
                  <Input id="hrQqTarget" inputMode="numeric" value={form.qqTarget} onChange={(event) => updateForm('qqTarget', event.target.value)} placeholder={targetPlaceholder} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hrNapcatToken">NapCat Token</Label>
                  <Input id="hrNapcatToken" type="password" value={form.napcatToken} onChange={(event) => updateForm('napcatToken', event.target.value)} placeholder={tokenConfigured ? '已配置；留空不修改' : '请输入 NapCat 中设置的 Token'} />
                </div>
                {form.qqTargetType === 'GROUP' ? (
                  <div className="space-y-2">
                    <Label htmlFor="hrQqOperator">群内操作人 QQ（可选）</Label>
                    <Input id="hrQqOperator" inputMode="numeric" value={form.qqOperator} onChange={(event) => updateForm('qqOperator', event.target.value)} placeholder={operatorConfigured ? `已配置：${operatorMasked}；留空不修改` : '不填则群聊仅接收通知'} />
                  </div>
                ) : null}
              </div>
              {form.qqTargetType === 'GROUP' && operatorConfigured ? (
                <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={form.clearOperator} onChange={(event) => updateForm('clearOperator', event.target.checked)} />
                  清除已配置的群内操作人，改为仅通知
                </label>
              ) : null}
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.qqEnabled} onChange={(event) => updateForm('qqEnabled', event.target.checked)} />
                仅将高价值 HR 消息通知到上述 QQ 目标
              </label>
              <p className="mt-2 text-xs text-muted-foreground">Token、目标 QQ/群号和操作人 QQ 使用本机加密存储，页面不会读取或回显原值。全自动回复始终锁定。</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span role="status" aria-live="polite" className="text-sm text-muted-foreground">{loading ? '正在加载…' : status}</span>
              <Button type="button" onClick={() => void saveSettings()} disabled={loading || saving || !dirty} className="app-button-primary">
                <BiSave className="mr-1" />{saving ? '保存中…' : '保存 BOSS HR 设置'}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Field({ label, id, value, onChange }: { label: string; id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
