import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

it('explains manual review and AI failure without enabling an empty draft or rendering markup', async () => {
  const attach = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element) {
    return attach.call(this, { mode: 'open' })
  })
  const proposals = [
    { id: 1, classification: 'NEEDS_USER', highValue: true, riskTags: ['NON_TEXT_MESSAGE'], summary: 'HR 发送了非文本消息，需要人工查看。', missingFacts: ['请人工查看 图片'], draft: '', status: 'REVIEW_REQUIRED' },
    { id: 2, classification: 'NEEDS_USER', highValue: true, riskTags: ['AI_FAILURE'], summary: 'AI 草稿生成失败，需要人工填写回复。', missingFacts: ['<img src=x onerror=alert(1)>'], draft: '', status: 'REVIEW_REQUIRED' },
    { id: 3, classification: 'REJECTION', highValue: false, riskTags: [], summary: '对方暂不考虑。', draft: '', status: 'REVIEW_REQUIRED' },
  ]
  const operations: string[] = []
  runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-assistant.js'), 'utf8'), {
    document, location: { pathname: '/web/geek/chat' },
    window: { top: window, self: window, setInterval: vi.fn() },
    chrome: { runtime: { sendMessage: (message: { operation: string }, respond: (value: object) => void) => {
      operations.push(message.operation)
      respond({ success: true, data: { success: true, data: message.operation === 'hr-status' ? { watching: false } : proposals } })
    } } },
  })
  const root = document.getElementById('getjobs-boss-hr-assistant')!.shadowRoot!
  await vi.waitFor(() => expect(root.querySelectorAll('.card')).toHaveLength(3))
  expect(Array.from(root.querySelectorAll('.tag')).map(node => node.textContent)).toEqual(['需人工查看', '草稿生成失败', '婉拒 / 无需回复'])
  expect(root.textContent).toContain('需要处理：请人工查看 图片')
  expect(root.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(root.querySelector('img')).toBeNull()
  expect(Array.from(root.querySelectorAll<HTMLButtonElement>('.card .primary')).every(node => node.disabled)).toBe(true)
  expect(operations).toEqual(['hr-status', 'hr-proposals'])
})
