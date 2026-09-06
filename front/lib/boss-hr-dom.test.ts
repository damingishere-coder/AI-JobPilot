import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const identity = require('../../chrome-extension/boss-hr-identity.js')
const support = require('../../chrome-extension/boss-hr-support.js')

function addCard(id = '101', source = 0, name = '王女士') {
  const wrapper = document.createElement('div')
  wrapper.className = 'friend-content-warp'
  wrapper.innerHTML = `<div class="friend-content"><span class="notice-badge">2</span><span class="name-box"><span class="name-text">${name}</span><span>测试公司</span></span><span class="last-msg-text">方便聊聊吗？</span></div>`
  const props = { friendId: id, friendSource: source, uniqueId: `${id}-${source}`, name, brandName: '测试公司' }
  Object.assign(wrapper, { __vue__: { $el: wrapper, $props: { source: props } } })
  document.querySelector('.user-list')!.append(wrapper)
  return { wrapper, card: wrapper.firstElementChild!, props }
}

// This fixture follows the observed DOM and the public v5535 rendering code.
// It contains no real HR identifiers, message history or account data.
describe('BOSS virtual-list identity adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div class="user-list"></div><div class="chat-conversation"><div class="user-info"><span class="name-text">王女士</span></div><div class="chat-message"><ul class="im-list"></ul></div></div>'
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect)
    identity.install(document)
  })

  it('recognizes a DOM-only card with no legacy UID and separates same-name HRs and sources', () => {
    const a = addCard('101', 0)
    const b = addCard('102', 0)
    const c = addCard('101', 1)
    expect(support.chatItems(document)).toEqual([a.card, b.card, c.card])
    expect(support.itemSnapshot(a.card)).toMatchObject({ uid: '101-0', unreadCount: 2, hrName: '王女士', companyName: '测试公司' })
    expect(support.findByUid(document, '101-1').unique).toBe(c.card)
  })

  it('clears recycled metadata when props disappear and never falls back to name or HTML UID', () => {
    const a = addCard()
    expect(support.itemSnapshot(a.card).uid).toBe('101-0')
    Object.assign(a.wrapper, { __vue__: undefined })
    a.card.setAttribute('data-friend-id', 'old-id')
    expect(support.itemSnapshot(a.card).uid).toBe('')
  })

  it('rebinds reused virtual nodes only to internally consistent IDs', () => {
    const a = addCard()
    support.chatItems(document)
    a.props.friendId = '202'
    expect(support.itemSnapshot(a.card).uid).toBe('')
    a.props.uniqueId = '202-0'
    expect(support.itemSnapshot(a.card).uid).toBe('202-0')
    expect(support.findByUid(document, '101-0').unique).toBeNull()
  })

  it('rejects stale component props and duplicate identities', () => {
    const a = addCard()
    a.props.name = '别的人'
    expect(support.itemSnapshot(a.card).uid).toBe('')
    a.props.name = '王女士'
    addCard()
    expect(support.findByUid(document, '101-0').matches).toHaveLength(2)
    expect(support.findByUid(document, '101-0').unique).toBeNull()
  })

  it('reads selected identity rather than echoing the expected target', () => {
    const a = addCard('101')
    const b = addCard('102')
    b.card.classList.add('selected')
    const pane = document.querySelector('.chat-conversation')!
    Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: b.props } })
    expect(support.currentSession(document, { uid: '101-0' }).uid).toBe('102-0')
    Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: a.props } })
    expect(support.currentSession(document, { uid: '101-0' }).uid).toBe('')
    Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: b.props } })
    a.card.classList.add('selected')
    expect(support.currentSession(document, { uid: '101-0' }).uid).toBe('')
  })

  it('reads messages in DOM order without duplicating the history container or nested bubbles', () => {
    document.querySelector('.im-list')!.innerHTML = '<li class="message-item item-friend"><span class="text">请问何时到岗？</span></li><li class="message-item item-myself"><span class="text">两周内。</span></li><li class="message-item item-system">系统提示</li><li class="message-item item-friend"><div class="item-friend"><span class="text">好的，明天方便面试吗？</span></div></li>'
    const messages = support.readMessages(document)
    expect(messages).toHaveLength(3)
    expect(messages.map((message: { from: string }) => message.from)).toEqual(['对方', '本人', '对方'])
    expect(support.latestInbound(messages).text).toBe('好的，明天方便面试吗？')
  })

  it('rejects malformed, synthetic and numerically unsafe identity fields', () => {
    for (const source of [
      { friendId: 0, friendSource: 0, uniqueId: '0-0' },
      { friendId: '101', friendSource: 0, uniqueId: '王女士' },
      { friendId: '101', friendSource: -1, uniqueId: '101--1' },
      { friendId: Number.MAX_SAFE_INTEGER + 1, friendSource: 0, uniqueId: `${Number.MAX_SAFE_INTEGER + 1}-0` },
    ]) expect(identity.sourceUid(source)).toBe('')
  })

  it('captures a current-layout unread conversation only after persisting its stable Outbox identity', async () => {
    const { card, props } = addCard()
    const pane = document.querySelector('.chat-conversation')!
    let opened = false
    card.addEventListener('click', () => {
      opened = true
      card.classList.add('selected')
      Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: props } })
      pane.querySelector('.im-list')!.innerHTML = '<li class="message-item item-friend"><span class="text">明天方便面试吗？</span></li>'
    })
    type Result = { success: boolean; captures: Array<{ session: { uid: string }; messages: Array<{ text: string }> }> }
    let listener!: (message: object, sender: object, respond: (result: Result) => void) => unknown
    const writes: string[] = []
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window, document, location: { pathname: '/web/geek/chat' },
      GetJobsBossHrSupport: support, Event, getComputedStyle,
      setTimeout: (callback: () => void) => setTimeout(callback, 0),
      chrome: { runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: (message: { type: string; capture: { uid: string } }, respond: (result: object) => void) => {
          expect(opened).toBe(false)
          expect(message.type).toBe('BOSS_HR_OUTBOX_PUT')
          writes.push(message.capture.uid)
          respond({ success: true })
        },
      } },
    })
    const result = await new Promise<Result>(resolve => listener({
      source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SCAN', deadlineAt: Date.now() + 30_000,
      scanId: 'synthetic-scan', watchSessionId: 'synthetic-watch', outbox: [],
    }, {}, resolve))
    expect(writes).toEqual(['101-0'])
    expect(result.success).toBe(true)
    expect(result.captures).toHaveLength(1)
    expect(result.captures[0].session.uid).toBe('101-0')
    expect(result.captures[0].messages[0].text).toBe('明天方便面试吗？')
  })
})
