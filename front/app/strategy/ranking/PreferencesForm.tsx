'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { preferenceFields, type Preferences, type RankingSettings } from '@/lib/ranking'

export default function PreferencesForm({ settings, busy, onPreview, onSave, onDisable }: { settings: RankingSettings; busy: boolean; onPreview: (value: Preferences) => void; onSave: (value: Preferences) => void; onDisable: () => void }) {
  const [value, setValue] = useState(settings.preferences)
  const [text, setText] = useState({ roles: value.roles.join('，'), cities: value.cities.join('，'), scales: value.scales.join('，'), industries: value.industries.join('，') })
  const draft = (): Preferences => ({ ...value, ...Object.fromEntries(Object.entries(text).map(([key, raw]) => [key, raw.split(/[,，\n]/).map(v => v.trim()).filter(Boolean)])) })
  const hard = (key: string) => <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={value.hard.includes(key)} onChange={e => setValue(v => ({ ...v, hard: e.target.checked ? [...v.hard, key] : v.hard.filter(k => k !== key) }))} />作为硬约束</label>
  return <section className="space-y-4 rounded-xl border p-5" aria-label="求职偏好设置">
    <h2 className="text-lg font-semibold">明确你的偏好</h2><p className="text-sm text-muted-foreground">多项用逗号分隔，留空表示未设置。信息缺失显示待核实；硬约束优先影响推荐顺序，不会删除岗位。</p>
    <div className="grid gap-4 md:grid-cols-2">{([['roles', 'ROLE'], ['cities', 'CITY'], ['scales', 'SCALE'], ['industries', 'INDUSTRY']] as const).map(([key, field]) => <div key={key}><label>{preferenceFields[field]}<input maxLength={2000} value={text[key]} onChange={e => setText(v => ({ ...v, [key]: e.target.value }))} className="mt-1 block w-full rounded border bg-background p-2" /></label>{hard(field)}</div>)}
      <div><fieldset><legend>工作方式</legend>{Object.entries({ REMOTE: '远程', HYBRID: '混合', ONSITE: '现场' }).map(([key, label]) => <label key={key} className="mr-3 inline-flex gap-1"><input type="checkbox" checked={value.workModes.includes(key)} onChange={e => setValue(v => ({ ...v, workModes: e.target.checked ? [...v.workModes, key] : v.workModes.filter(k => k !== key) }))} />{label}</label>)}</fieldset>{hard('WORK_MODE')}<p className="mt-1 text-xs text-muted-foreground">当前采集没有可靠工作方式字段，会明确标为待核实。</p></div>
      <div className="space-y-2"><div className="flex gap-2"><label>最低月薪（K）<input type="number" min={0} max={200} value={value.minSalaryK ?? ''} onChange={e => setValue(v => ({ ...v, minSalaryK: e.target.value ? Number(e.target.value) : null }))} className="mt-1 block w-full rounded border bg-background p-2" /></label><label>最高月薪（K）<input type="number" min={0} max={200} value={value.maxSalaryK ?? ''} onChange={e => setValue(v => ({ ...v, maxSalaryK: e.target.value ? Number(e.target.value) : null }))} className="mt-1 block w-full rounded border bg-background p-2" /></label></div>{hard('SALARY')}</div>
    </div>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => onPreview(draft())}>预览草稿排序</Button><Button disabled={busy} onClick={() => onSave(draft())}>保存偏好并启用推荐排序</Button>{settings.enabled && <Button variant="outline" disabled={busy} onClick={onDisable}>关闭策略排序，恢复历史分排序</Button>}</div>
    <p className="text-xs text-muted-foreground">启用只影响本页推荐列表。既有搜索配置、已确认批次和投递范围保持原状态。</p>
  </section>
}
