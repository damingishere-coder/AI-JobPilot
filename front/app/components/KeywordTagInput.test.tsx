import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import KeywordTagInput from './KeywordTagInput'

describe('KeywordTagInput', () => {
  it('推荐词只有点击后才加入', () => {
    const onChange = vi.fn()
    render(<KeywordTagInput value={['Java']} recommendations={['AI产品经理']} onChange={onChange} />)

    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /AI产品经理/ }))
    expect(onChange).toHaveBeenCalledWith(['Java', 'AI产品经理'])
  })

  it('支持回车、粘贴和删除标签', () => {
    const onChange = vi.fn()
    const { rerender } = render(<KeywordTagInput value={[]} onChange={onChange} />)
    const input = screen.getByLabelText('新增岗位关键词')
    fireEvent.change(input, { target: { value: 'Java 后端' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['Java 后端'])

    rerender(<KeywordTagInput value={['Java 后端']} onChange={onChange} />)
    fireEvent.paste(screen.getByLabelText('新增岗位关键词'), {
      clipboardData: { getData: () => 'AI产品经理，大模型产品' },
    })
    expect(onChange).toHaveBeenLastCalledWith(['Java 后端', 'AI产品经理', '大模型产品'])

    rerender(<KeywordTagInput value={['Java 后端', 'AI产品经理']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '删除关键词 Java 后端' }))
    expect(onChange).toHaveBeenLastCalledWith(['AI产品经理'])
  })

  it('历史数据超过八个时保留全部并禁止新增', () => {
    const legacy = Array.from({ length: 10 }, (_, index) => `岗位${index + 1}`)
    render(<KeywordTagInput value={legacy} onChange={vi.fn()} />)

    expect(screen.getByText('10/8')).toBeInTheDocument()
    expect(screen.getByText(/请删减到 8 个以内/)).toBeInTheDocument()
    expect(screen.getByLabelText('新增岗位关键词')).toBeDisabled()
  })
})
