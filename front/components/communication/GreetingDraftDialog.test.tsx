import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GreetingDraftDialog, type GreetingJob } from './GreetingDraftDialog'
import { localActionFetch, readApiResponse } from '@/lib/api'

vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  localActionFetch: vi.fn(), readApiResponse: vi.fn(),
}))

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
  it('保留最终预览，正文单独计数，151字阻止保存和确认', async () => {
    const onConfirm = vi.fn()
    const portfolioSuffix = '个人作品集：https://toudiniuma.cn/'
    const finalGreeting = `您好，\n${portfolioSuffix}`
    render(<GreetingDraftDialog open platform="boss" job={{
      id: 8, aiGreeting: '', greetingDraft: '旧稿'.repeat(100), greetingSource: 'USER_EDITED', finalGreeting, portfolioSuffix,
    }} confirmMode submitting={false} onClose={vi.fn()} onSaved={vi.fn()} onConfirm={onConfirm} />)
    const input = await screen.findByRole('textbox')
    expect(input).toHaveValue('您好，')
    expect(screen.getByText('3/150')).toBeInTheDocument()
    expect(screen.getByText(portfolioSuffix)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '字'.repeat(151) } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText(/话术正文含标点和空格不能超过150个字符/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认并交给 Chrome' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('150字正文可以保存，复制和确认都包含同一份作品推荐', async () => {
    const portfolioSuffix = '个人作品集：https://toudiniuma.cn/'
    const body = '😀'.repeat(148) + ' ，'
    const finalGreeting = `${body}\n${portfolioSuffix}`
    const view: GreetingJob = { id:9, aiGreeting:'', greetingDraft:'', greetingSource:'AI_GREETING', finalGreeting, portfolioSuffix }
    const onConfirm = vi.fn(), writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {value:{writeText}, configurable:true})
    vi.mocked(readApiResponse).mockResolvedValue({success:true, data:view})
    render(<GreetingDraftDialog open platform="boss" job={view} confirmMode submitting={false}
      onClose={vi.fn()} onSaved={vi.fn()} onConfirm={onConfirm} />)
    expect(await screen.findByText('150/150')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'复制'}))
    expect(writeText).toHaveBeenCalledWith(finalGreeting)
    fireEvent.click(screen.getByRole('button', {name:'保存草稿'}))
    expect(localActionFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body:JSON.stringify({content:finalGreeting, expectedUpdatedAt:null}),
    }))
    await screen.findByRole('button', {name:'保存草稿'})
    fireEvent.click(screen.getByRole('button', {name:'确认并交给 Chrome'}))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({finalGreeting}))
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
