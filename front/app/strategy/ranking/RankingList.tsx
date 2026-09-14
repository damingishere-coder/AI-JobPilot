'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { preferenceFields, signalLabels, type RankingResult } from '@/lib/ranking'

export default function RankingList({ result, preview }: { result: RankingResult; preview: boolean }) {
  const [page, setPage] = useState(1)
  return <section className="space-y-4" aria-label="三维推荐列表">
    <h2 className="text-lg font-semibold">{preview ? '草稿预览，尚未保存' : result.strategyOrder ? '已启用策略推荐顺序' : '历史综合分排序'} · {result.items.length} 个候选机会</h2>
    <p className="text-sm text-muted-foreground">{result.strategyOrder ? '先看明确硬约束，再按 Fit 每 5 分一组；组内按偏好和反馈信号辅助排序。' : '按既有综合分降序。'}不自动重算 AI，也不创建投递请求；未决或已确认投递、已归档和不感兴趣的机会不进入本推荐列表。</p>
    <p className="text-xs text-muted-foreground">规则 {result.ruleVersion} · 偏好 v{result.preferenceVersion} · 反馈来源 {result.snapshotId ? `快照 #${result.snapshotId}` : '暂无快照'}{result.feedbackState === 'STALE_DATA' ? '（已过期，不参与排序）' : ''}。反馈组至少 20 个有效样本且观察覆盖达到 50% 才参与，信号仍是低置信度描述。</p>
    {result.items.slice((page - 1) * 20, page * 20).map(item => <article key={item.id} className="space-y-3 rounded-xl border bg-card p-5">
      <div><Link href={`/opportunities?id=${item.id}`} className="font-semibold underline">#{item.position} {item.jobName || '岗位标题未知'}</Link><p className="mt-1 text-sm text-muted-foreground">{item.companyName || '公司未知'} · {item.platform} · 旧顺序 #{item.oldPosition}</p></div>
      <div className="grid gap-3 md:grid-cols-3">
        <div><h3 className="font-medium">Fit 能力匹配</h3><p>{item.fit.score === null ? `历史综合分 ${item.legacyScore ?? '未知'}` : `${item.fit.score} 分`}</p><p className="text-xs text-muted-foreground">{item.fit.version === 'LEGACY_COMPOSITE' ? '旧记录缺少校验后维度，未伪造新 Fit' : `${item.fit.version} · ${item.fit.unknownDimensions} 个维度待核实`}</p>{item.fit.hardConflict && <p className="text-xs text-amber-700">AI 已核验硬冲突，需人工复核</p>}</div>
        <div><h3 className="font-medium">Preference 用户偏好</h3><p>{item.preference.score === null ? '尚不能评分' : `${item.preference.score} 分（仅已知项）`}</p><p className="text-xs text-muted-foreground">已知 {item.preference.known}/{item.preference.configured} 项 · {item.preference.hardTier === 2 ? '存在明确硬约束冲突' : item.preference.hardTier === 1 ? '硬约束待核实' : '未发现明确硬约束冲突'}</p></div>
        <div><h3 className="font-medium">Opportunity 反馈信号</h3><p>{signalLabels[item.signal.label] || '待核实'}</p><p className="text-xs text-muted-foreground">{item.signal.samples ? `参与组最少 ${item.signal.samples} 个有效样本` : '不参与排序加成'}，不是个人面试概率</p></div>
      </div>
      <details><summary className="cursor-pointer text-sm">查看排序依据</summary><ul className="mt-2 list-inside list-disc text-sm">{item.preference.fields.map(field => <li key={field.key}>{preferenceFields[field.key]}{field.hard ? '（硬约束）' : ''}：{({ MATCH: '符合', CONFLICT: '冲突', UNKNOWN: '待核实' } as Record<string, string>)[field.status]} · {field.reason}</li>)}{item.signal.basis.map(reason => <li key={reason}>{reason}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">分析记录 {item.analysisId ? `#${item.analysisId}` : '未知'}；同一匹配分组内才使用反馈，保留所有候选供你选择。前往机会详情查看 JD 和原平台确认入口。</p></details>
    </article>)}
    {result.items.length === 0 && <p className="rounded border p-5 text-muted-foreground">目前没有符合此范围的候选，可先发现岗位或查看全部机会。</p>}
    <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => setPage(v => v - 1)}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={page * 20 >= result.items.length} onClick={() => setPage(v => v + 1)}>下一页</Button></div>
  </section>
}
