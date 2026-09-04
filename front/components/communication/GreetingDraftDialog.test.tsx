import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GreetingDraftDialog, type GreetingJob } from './GreetingDraftDialog'

function renderBossGreeting(source: GreetingJob['greetingSource']) {
  const finalGreeting = source === 'AI_GREETING'
    ? '贵岗位需要数据分析能力，我有增长分析项目经验，希望进一步沟通。'
    : '您好，我有相关项目经验，希望进一步沟通。'
  render(
    <GreetingDraftDialog
      open
      platform="boss"
      job={{
        id: 7,
        companyName: '示例公司',
        jobName: '产品经理',
        aiGreeting: source === 'AI_GREETING' ? finalGreeting : '',
        greetingDraft: '',
        greetingSource: source,
        finalGreeting,
      }}
      confirmMode
      submitting={false}
      onClose={vi.fn()}
      onSaved={vi.fn(async () => {})}
      onConfirm={vi.fn(async () => {})}
    />,
  )
}

describe('Boss greeting source labels', () => {
  it('把有效 AI 话术标为岗位 JD 定制', async () => {
    renderBossGreeting('AI_GREETING')
    expect(await screen.findByText(/当前来源：岗位 JD 定制/)).toBeInTheDocument()
    expect(screen.getByText(/人工编辑稿 → 岗位 JD 定制 → AI 失败兜底/)).toBeInTheDocument()
  })

  it('把档案默认话术明确标为 AI 失败兜底', async () => {
    renderBossGreeting('PROFILE_DEFAULT')
    expect(await screen.findByText(/当前来源：AI 失败兜底（档案默认）/)).toBeInTheDocument()
  })
})
