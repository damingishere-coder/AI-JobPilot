import { fireEvent, render, screen } from '@testing-library/react'
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
  it('使用最终预览而非旧人工长稿，并把网址和空格计入100字限制', async () => {
    const onConfirm = vi.fn()
    const finalGreeting = '您好，个人作品集：https://toudiniuma.cn/'
    render(<GreetingDraftDialog open platform="boss" job={{
      id: 8, aiGreeting: '', greetingDraft: '旧稿'.repeat(100), greetingSource: 'USER_EDITED', finalGreeting,
    }} confirmMode submitting={false} onClose={vi.fn()} onSaved={vi.fn()} onConfirm={onConfirm} />)
    const input = await screen.findByRole('textbox')
    expect(input).toHaveValue(finalGreeting)
    expect(screen.getByText(`${Array.from(finalGreeting).length}/100`)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '字'.repeat(101) } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText(/整条话术含网址、标点和空格不能超过100个字符/)).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

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
