'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { strategyDimensions, type StrategyMetric, type StrategySnapshot } from '@/lib/strategy'

function SampleLinks({ ids }: { ids: number[] }) {
  const [limit, setLimit] = useState(50)
  return <div className="space-y-2"><div className="flex flex-wrap gap-2">{ids.slice(0, limit).map(id => <Link key={id} className="text-xs underline" href={`/opportunities?id=${id}`}>机会 #{id}</Link>)}</div>{ids.length > limit && <Button variant="outline" onClick={() => setLimit(v => v + 50)}>再显示 50 个样本</Button>}</div>
}
function Metric({ title, value }: { title: string; value: StrategyMetric }) {
  return <section className="space-y-2 rounded border p-4"><h3 className="font-medium">{title}</h3>
    <p className="text-2xl font-semibold">{value.ratePercent === null ? '样本不足' : `${value.ratePercent}%`}</p>
    <p className="text-sm">已核对样本：{value.positive} / {value.observed} · 观察覆盖：{value.observed} / {value.mature}（{value.coveragePercent}%）</p>
    <p className="text-xs text-muted-foreground">{value.confidence === 'INSUFFICIENT_DATA' ? '有效样本不足 20，暂不比较转化率。' : '低置信度，仅描述已核对样本，不是个人获邀概率。'}</p>
    <details><summary className="cursor-pointer text-sm">核对分子、分母与未观察样本</summary><p className="mt-2 text-sm">已确认结果</p><SampleLinks ids={value.positiveIds} /><p className="mt-2 text-sm">已核对该观察期内无结果</p><SampleLinks ids={value.negativeIds} /><p className="mt-2 text-sm">未充分观察，不计为失败</p><SampleLinks ids={value.unobservedIds} /></details>
  </section>
}
export default function StrategyReport({ snapshot, busy, onDecide }: { snapshot: StrategySnapshot; busy: boolean; onDecide: (id: string, decision: string) => void }) {
  const [dimension, setDimension] = useState('KEYWORD')
  const analysis = snapshot.result.analysis
  return <section className="space-y-5" aria-label="策略统计快照">
    <p className="text-sm text-muted-foreground">快照 #{snapshot.id} · 截至 {new Date(snapshot.cutoff).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（上海时间）· 回看 {snapshot.window_days} 天 · {snapshot.rule_version} · 事件截止 #{snapshot.through_event_id}</p>
    <p>纳入 {analysis.applications} 个有明确投递时间与上下文的机会，按首次成功投递去重。</p>
    <div className="grid gap-4 md:grid-cols-2"><Metric title="投递后 14 天内 HR 回复" value={analysis.reply} /><Metric title="投递后 30 天内获得面试邀请" value={analysis.interview} /></div>
    <p className="text-sm text-muted-foreground">只有满 14 / 30 天的样本进入对应比较。未核对不等于没回复，时间不明的结果不猜测。面试轮次记录共 {snapshot.result.interviewRecords} 条，不能据此推断历史获邀日期；请在机会中确认真实邀请时间。</p>
    <div className="space-y-3"><h2 className="text-lg font-semibold">可审阅的策略建议</h2>
      {analysis.insights.length === 0 && <p className="rounded border p-4 text-muted-foreground">目前没有满足样本要求的比较结论。继续记录真实回复与核对截止时间，无需为得到建议而重新调用 AI。</p>}
      {analysis.insights.map(insight => <article key={insight.id} className="space-y-3 rounded border p-4"><p>{insight.text}</p><p className="text-xs text-muted-foreground">{strategyDimensions[insight.dimension]} · 低置信度 · 当前有效样本 {insight.samples}</p><div className="flex gap-2"><Button disabled={busy} onClick={() => onDecide(insight.id, 'ADOPTED')}>记为采用方向</Button><Button variant="outline" disabled={busy} onClick={() => onDecide(insight.id, 'IGNORED')}>暂不采用</Button></div>{snapshot.decisions[insight.id] && <p className="text-sm">当前审阅：{snapshot.decisions[insight.id].decision === 'ADOPTED' ? '采用方向' : '暂不采用'} · 已保留 {snapshot.decisions[insight.id].history.length} 次审阅记录</p>}</article>)}
      <p className="text-xs text-muted-foreground">审阅只保存你的选择，不会自动更改搜索、简历或创建投递请求。</p>
    </div>
    <label className="block">分组依据<select value={dimension} onChange={e => setDimension(e.target.value)} className="ml-3 rounded border bg-background p-2">{Object.entries(strategyDimensions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div className="space-y-3">{analysis.groups.filter(g => g.dimension === dimension).map(group => <details key={group.value} className="rounded border p-4"><summary className="cursor-pointer">{group.value} · {group.applications} 个机会 · 回复 {group.reply.positive}/{group.reply.observed} 个已核对样本</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><Metric title="回复统计" value={group.reply} /><Metric title="获邀统计" value={group.interview} /></div><p className="mt-3 text-sm">本组全部机会（含未成熟样本）</p><SampleLinks ids={group.opportunityIds} /></details>)}</div>
    <details><summary className="cursor-pointer">历史排除与统计限制</summary><ul className="mt-2 list-inside list-disc text-sm">{Object.entries(snapshot.result.exclusions).map(([reason, count]) => <li key={reason}>{reason}：{count} 次尝试（档案全部历史，非当前窗口）</li>)}</ul><p className="mt-2 text-sm text-muted-foreground">重复尝试、UNKNOWN、此前已联系、旧导入或未知输入不作为新成功投递。关键词仅使用投递前首次有效发现；薪资只识别明确 K 区间。历史 AI 分数仅用于对照，真实用户确认的结果才是反馈。主动投递与选择性核对会带来样本偏差。</p></details>
  </section>
}
