import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { runInNewContext as runScriptInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const identity = require('../../chrome-extension/boss-hr-identity.js')
const support = require('../../chrome-extension/boss-hr-support.js')

function runInNewContext(code: string, context: Record<string, unknown>) {
  return runScriptInNewContext(code, { crypto: { randomUUID }, ...context })
}

function addCard(id = '101', source = 0, name = '王女士') {
  const wrapper = document.createElement('div')
  wrapper.className = 'friend-content-warp'
  wrapper.innerHTML = `<div class="friend-content"><span class="notice-badge">2</span><span class="name-box"><span class="name-text">${name}</span><span>测试公司</span></span><span class="last-msg-text">方便聊聊吗？</span></div>`
  const props = { friendId: id, friendSource: source, uniqueId: `${id}-${source}`, name, brandName: '测试公司' }
  Object.assign(wrapper, { __vue__: { $el: wrapper, $props: { source: props } } })
  document.querySelector('.user-list')!.append(wrapper)
  return { wrapper, card: wrapper.firstElementChild!, props }
}

function bindMessages() {
  document.querySelectorAll('.im-list > .message-item').forEach((row, index) => {
    const mid = `synthetic-${index}`
    row.setAttribute('data-mid', mid)
    Object.assign(row, { __vue__: { $el: row, $props: { message: { mid, messageType: row.getAttribute('data-fixture-type') || 'text' } } } })
  })
}

// This fixture follows the observed DOM and the public v5535 rendering code.
// It contains no real HR identifiers, message history or account data.
describe('BOSS virtual-list identity adapter', () => {
  beforeEach(() => {
    sessionStorage.clear()
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
    bindMessages()
    const messages = support.readMessages(document)
    expect(messages).toHaveLength(3)
    expect(messages.map((message: { from: string }) => message.from)).toEqual(['对方', '本人', '对方'])
    expect(support.latestInbound(messages).text).toBe('好的，明天方便面试吗？')
  })

  it('uses message type rather than avatars, quoted images or inline emoji', () => {
    document.querySelector('.im-list')!.innerHTML = `
      <li class="message-item item-friend"><div class="message-content"><div class="figure"><img src="avatar.png"></div><div class="text"><div class="quote-message"><img src="quote.png">旧引用</div><p><span class="text-content">明天方便吗<br><img alt="[微笑]" src="emoji.png"></span></p></div></div></li>
      <li class="message-item item-friend" data-fixture-type="image"><div class="message-content"><div class="figure"><img src="avatar.png"></div><div class="text item-image"><img src="photo.png"></div></div></li>
      <li class="message-item item-friend" data-fixture-type="sound"><div class="message-content"><div class="text">语音</div></div></li>
      <li class="message-item item-friend" data-fixture-type="resume"><div class="message-content"><div class="text">附件.pdf</div></div></li>
      <li class="message-item item-friend" data-fixture-type="video"><div class="text">视频</div></li>
      <li class="message-item item-friend" data-fixture-type="future-card"><div class="text">新卡片</div></li>`
    bindMessages()
    const messages = support.readMessages(document)
    expect(messages.map((message: { type: string }) => message.type)).toEqual(['文本', '图片', '语音', '附件', '视频', '其他'])
    expect(messages[0].text).toBe('明天方便吗 [微笑]')
    expect(messages[1].text).toBe('')
  })

  it('clears stale message metadata and does not guess text when a row is recycled', () => {
    document.querySelector('.im-list')!.innerHTML = '<li class="message-item item-friend"><div class="text">消息</div></li>'
    bindMessages()
    const row = document.querySelector('.message-item')!
    expect(support.readMessages(document)[0].type).toBe('文本')
    row.setAttribute('data-mid', 'recycled-message')
    expect(support.readMessages(document)[0].type).toBe('未知类型')
    Object.assign(row, { __vue__: undefined })
    expect(support.readMessages(document)[0].type).toBe('未知类型')
  })

  it('never captures recommendation-card logos or contact avatars as HR media', () => {
    document.querySelector('.im-list')!.innerHTML = `
      <li class="message-item item-friend" data-fixture-type="frame"><div class="message-content"><div class="recommend-card"><img src="https://example.invalid/logo.png"><img src="https://example.invalid/person.png"><img src="https://example.invalid/person2.png"></div></div></li>
      <li class="message-item item-friend"><div class="message-content"><div class="text"><p><span class="text-content">不好意思，不太合适哦</span></p></div></div></li>`
    bindMessages()
    const messages = support.readMessages(document)
    expect(messages).toHaveLength(2)
    expect(messages[0].type).toBe('其他')
    expect(messages[0].media).toHaveLength(1)
    expect(messages[0].media[0]).toMatchObject({ sourceUrl: '', readStatus: 'UNAVAILABLE' })
    expect(messages[1].text).toBe('不好意思，不太合适哦')
    expect(messages[1].media).toEqual([])
    expect(JSON.stringify(messages)).not.toContain('example.invalid')
  })

  it('captures only the verified media type and preserves a real HR image', () => {
    document.querySelector('.im-list')!.innerHTML = `
      <li class="message-item item-friend" data-fixture-type="image"><div class="message-content"><div class="figure"><img src="avatar.png"></div><div class="quote-message"><img src="quote.png"></div><div class="text item-image"><img src="photo.png"></div><a href="unrelated-link.html">查看</a></div></li>
      <li class="message-item item-friend" data-fixture-type="resume"><div class="message-content"><img src="file-icon.png"><a href="attachment.pdf" download="附件.pdf">附件.pdf</a></div></li>`
    bindMessages()
    const messages = support.readMessages(document)
    expect(messages[0].media).toHaveLength(1)
    expect(messages[0].media[0].sourceUrl).toContain('photo.png')
    expect(messages[1].media).toHaveLength(1)
    expect(messages[1].media[0].sourceUrl).toContain('attachment.pdf')
    expect(JSON.stringify(messages)).not.toMatch(/avatar\.png|quote\.png|file-icon\.png|unrelated-link\.html/)
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
      bindMessages()
    })
    type Result = { success: boolean; captures: Array<{ session: { uid: string }; messages: Array<{ text: string }> }> }
    let listener!: (message: object, sender: object, respond: (result: Result) => void) => unknown
    const writes: string[] = []
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window, document, location: { pathname: '/web/geek/chat' },
      GetJobsBossHrSupport: support, Event, getComputedStyle, sessionStorage,
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
      source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SCAN_V2', deadlineAt: Date.now() + 30_000,
      scanId: 'synthetic-scan', watchSessionId: 'synthetic-watch', outbox: [],
    }, {}, resolve))
    expect(writes).toEqual(['101-0'])
    expect(result.success).toBe(true)
    expect(result.captures).toHaveLength(1)
    expect(result.captures[0].session.uid).toBe('101-0')
    expect(result.captures[0].messages[0].text).toBe('明天方便面试吗？')
  })

  it('reads already-read conversations sequentially, persists each result and stops on an unknown submission', async () => {
    const a = addCard('101')
    const b = addCard('102')
    const c = addCard('103')
    const pane = document.querySelector('.chat-conversation')!
    const order: string[] = []
    for (const entry of [a, b, c]) {
      entry.card.querySelector('.notice-badge')!.remove()
      entry.card.addEventListener('click', () => {
        order.push(`open:${entry.props.uniqueId}`)
        document.querySelectorAll('.friend-content').forEach(card => card.classList.remove('selected'))
        entry.card.classList.add('selected')
        Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: entry.props } })
        pane.querySelector('.im-list')!.innerHTML = '<li class="message-item item-friend"><span class="text">方便聊聊吗？</span></li>'
        bindMessages()
      })
    }
    let listener!: (message: object, sender: object, respond: (result: { success: boolean }) => void) => unknown
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window: { top: window, self: window, addEventListener: () => {} }, document, location: { pathname: '/web/geek/chat' },
      GetJobsBossHrSupport: support, Event, getComputedStyle, sessionStorage,
      setTimeout: (callback: () => void) => setTimeout(callback, 0),
      chrome: { runtime: {
        onMessage: { addListener: (value: typeof listener) => { listener = value } },
        sendMessage: (message: { type: string; capture: { uid?: string; session?: { uid: string }; messages?: Array<{ type: string }> } }, respond: (result: object) => void) => {
          const uid = message.capture.uid || message.capture.session!.uid
          order.push(`${message.type === 'BOSS_HR_OUTBOX_PUT' ? 'put' : 'save'}:${uid}`)
          if (message.type === 'BOSS_HR_CAPTURE_RESULT') expect(message.capture.messages![0].type).toBe('文本')
          respond({ success: !(message.type === 'BOSS_HR_CAPTURE_RESULT' && uid === '102-0'), message: '结果未知' })
        },
      } },
    })
    const result = await new Promise<{ success: boolean }>(resolve => listener({
      source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SCAN_V2', deadlineAt: Date.now() + 30_000,
      scanId: 'full-scan', watchSessionId: 'watch', scanAll: true, streamResults: true, outbox: [],
    }, {}, resolve))
    expect(result.success).toBe(false)
    expect(order).toEqual(['put:101-0', 'open:101-0', 'save:101-0', 'put:102-0', 'open:102-0', 'save:102-0'])
  })
  it.each(['confirmed', 'unknown', 'already-answered', 'resume-confirmed', 'resume-unknown'])('sends at a capture boundary and reports %s without re-entering the scan lock', async (outcome) => {
    const { card, props } = addCard()
    const pane = document.querySelector('.chat-conversation')!
    card.insertAdjacentHTML('beforeend', '<time>今天</time>')
    pane.insertAdjacentHTML('beforeend', '<div class="history-tip">沟通从这里开始</div><span>测试公司</span><textarea id="chat-input"></textarea><button>发送</button>')
    const nativeResume = outcome.startsWith('resume-')
    if (nativeResume) pane.querySelector('button')!.textContent = '发简历'
    let opened = false
    card.addEventListener('click', () => {
      card.classList.add('selected')
      Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: props } })
      if (!opened) pane.querySelector('.im-list')!.innerHTML = '<li class="message-item item-friend"><span class="text">方便聊聊吗？</span></li>'
      opened = true
      bindMessages()
    })
    let clicks = 0
    pane.querySelector('button')!.addEventListener('click', () => {
      clicks++
      if (outcome === 'confirmed' || outcome === 'resume-confirmed') {
        pane.querySelector('.im-list')!.insertAdjacentHTML('beforeend', nativeResume ? '<li class="message-item item-myself" data-fixture-type="resume"><span class="file">我的简历.pdf</span></li>' : '<li class="message-item item-myself"><span class="text">您好！</span></li>')
        bindMessages()
      }
    })
    let listener!: (message: object, sender: object, reply: (result: { success: boolean }) => void) => void
    const reports: Record<string, unknown>[] = []
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window: { top: window, self: window, addEventListener: () => {} }, document, location: { pathname: '/web/geek/chat' },
      GetJobsBossHrSupport: support, Event, InputEvent, HTMLTextAreaElement, HTMLInputElement, getComputedStyle, sessionStorage,
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      chrome: { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn } },
        sendMessage: (message: { type: string; operation?: string; body: Record<string, unknown>; capture: { contextComplete: boolean; messages: unknown[] } }, reply: (result: object) => void) => {
          if (message.type === 'BOSS_HR_CAPTURE_RESULT') {
            expect(message.capture.contextComplete).toBe(true)
            if (outcome === 'already-answered') {
              pane.querySelector('.im-list')!.insertAdjacentHTML('beforeend', '<li class="message-item item-myself"><span class="text">我已回复</span></li>')
              bindMessages()
            }
            reply({ success: true, tabId: 7, command: { commandId: 'test', actionType: nativeResume ? 'RESUME_NATIVE' : 'TEXT', leaseToken: 'lease', uid: '101-0', hrName: '王女士', companyName: '测试公司', jobName: '', draft: '您好！', policyVersion: 0, deadlineAt: Date.now() + 30000, expectedInboundRound: message.capture.messages, expectedLatestInbound: message.capture.messages.at(-1) } })
          } else if (message.operation === 'hr-boundary-result') { reports.push(message.body); reply({ success: true }) }
          else reply({ success: true })
        },
      } },
    })
    const result = await new Promise<{ success: boolean }>(resolve => listener({ source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SCAN_V2', scanId: 'boundary', watchSessionId: 'watch', deadlineAt: Date.now() + 30000, scanAll: true, streamResults: true }, {}, resolve))
    expect(result.success).toBe(true)
    expect(clicks).toBe(outcome === 'already-answered' ? 0 : 1)
    expect(reports).toHaveLength(1)
    expect(reports[0].outcome).toBe(outcome.endsWith('confirmed') ? 'SENT' : outcome.endsWith('unknown') ? 'RESULT_UNKNOWN' : 'STALE')
  })

  it.each(['loading', 'empty-shell'])('does not report a completed trial for a %s chat page', async (state) => {
    if (state === 'loading') document.body.innerHTML = '<p>加载中，请稍候</p>'
    let listener!: (message: object, sender: object, reply: (result: {success:boolean;errorCode:string})=>void)=>void
    let writes = 0
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'),'utf8'), {
      window:{top:window,self:window,addEventListener:()=>{}},document,location:{pathname:'/web/geek/chat'},
      GetJobsBossHrSupport:support,Event,getComputedStyle,sessionStorage,
      setTimeout:(fn:()=>void)=>setTimeout(fn,0),
      chrome:{runtime:{onMessage:{addListener:(fn:typeof listener)=>{listener=fn}},sendMessage:(m:{operation?:string},reply:(r:object)=>void)=>{
        if(m.operation==='hr-review-guard') reply({success:true,data:{data:{watchActive:true}}}); else writes++
      }}}
    })
    const result=await new Promise<{success:boolean;errorCode:string}>(resolve=>listener({source:'GET_JOBS_BACKGROUND',type:'BOSS_HR_SCAN_V2',scanAll:true,reviewLimit:3,streamResults:true,scanId:'trial',watchSessionId:'watch',deadlineAt:Date.now()+30000}, {}, resolve))
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('HR_LIST_NOT_READY')
    expect(writes).toBe(0)
  })

  it('trial finds three pending replies, skips answered/closed chats, and pauses on manual takeover', async () => {
    const entries = ['101','102','103','104','105','106'].map(id => addCard(id))
    const pane = document.querySelector('.chat-conversation')!
    const saved: string[] = []
    const listeners: Record<string,(event:{isTrusted:boolean;composedPath:()=>object[]})=>void> = {}
    let stops=0
    for (const [index, entry] of entries.entries()) entry.card.addEventListener('click', () => {
      document.querySelectorAll('.friend-content').forEach(card => card.classList.remove('selected'))
      entry.card.classList.add('selected')
      Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: entry.props } })
      pane.querySelector('.im-list')!.innerHTML = `<li class="message-item ${index===0?'item-myself':'item-friend'}"><span class="text">方便聊聊吗？</span></li>`
      bindMessages()
    })
    let listener!: (message: object, sender: object, respond: (result: {success:boolean;scannedCount:number})=>void)=>void
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'),'utf8'), {
      window:{top:window,self:window,addEventListener:(type:string,handler:typeof listeners[string])=>{listeners[type]=handler}},document,location:{pathname:'/web/geek/chat'},
      GetJobsBossHrSupport:support,Event,getComputedStyle,sessionStorage,
      setTimeout:(fn:()=>void)=>setTimeout(fn,0),
      chrome:{runtime:{onMessage:{addListener:(fn:typeof listener)=>{listener=fn}},sendMessage:(m:{type:string;operation?:string;capture:{session:{uid:string}}},reply:(r:object)=>void)=>{
        if(m.operation==='hr-review-guard') {reply({success:true,data:{data:{watchActive:true}}});return}
        if(m.operation==='hr-stop') {stops++;reply({success:true});return}
        if(m.type==='BOSS_HR_CAPTURE_RESULT') saved.push(m.capture.session.uid)
        if(m.type==='BOSS_LOCAL_API') throw new Error('Trial attempted a send')
        reply({success:true,reviewCount:saved.filter(uid=>uid!=='103-0').length,command:{commandId:'must-not-run'}})
      }}}
    })
    const result=await new Promise<{success:boolean;scannedCount:number}>(resolve=>listener({source:'GET_JOBS_BACKGROUND',type:'BOSS_HR_SCAN_V2',scanAll:true,reviewLimit:3,streamResults:true,scanId:'trial',watchSessionId:'watch',deadlineAt:Date.now()+30000}, {}, resolve))
    expect(result.success).toBe(true)
    expect(saved).toEqual(['102-0','103-0','104-0','105-0'])
    expect(result.scannedCount).toBe(3)
    await Promise.resolve()
    listeners.pointerdown({isTrusted:true,composedPath:()=>[]})
    expect(stops).toBe(1)
    const send = await new Promise<object>(resolve=>listener({source:'GET_JOBS_BACKGROUND',type:'BOSS_HR_SEND_V2',command:{deadlineAt:Date.now()+30000}}, {}, resolve))
    expect(send).toMatchObject({outcome:'FAILED_SAFE'})
  })

  it('rechecks the review connection before any conversation click after a page reload', async () => {
    const entry = addCard()
    const clicked = vi.fn()
    entry.card.addEventListener('click', clicked)
    let guards = 0
    let listener!: (message: object, sender: object, reply: (result: object) => void) => void
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window: { top: window, self: window, addEventListener: () => {} }, document,
      location: { pathname: '/web/geek/chat' }, GetJobsBossHrSupport: support, sessionStorage,
      chrome: { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn } },
        sendMessage: (message: { operation: string }, reply: (result: object) => void) => {
          expect(message.operation).toBe('hr-review-guard'); guards++
          reply({ success: true, data: { data: { watchActive: false } } })
        },
      } },
    })
    const result = await new Promise<object>(resolve => listener({ source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SEND_V2',
      command: { commandId: 'review', uid: '101-0', draft: '您好', reviewOnly: true, deadlineAt: Date.now() + 30000 },
    }, {}, resolve))
    expect(result).toMatchObject({ outcome: 'FAILED_SAFE' })
    expect(guards).toBe(1)
    expect(clicked).not.toHaveBeenCalled()
  })

  it.each(['reviewed', 'unreviewed', 'missing-round', 'no-self-boundary', 'new-inbound', 'hidden-gap', 'changed-company', 'missing-company', 'changed-company-before-click'])('handles a reviewed short conversation without inventing history completeness: %s', async (mode) => {
    const { card, props } = addCard()
    const pane = document.querySelector('.chat-conversation')!
    pane.insertAdjacentHTML('beforeend', '<textarea id="chat-input"></textarea><button>发送</button>')
    const list = pane.querySelector('.im-list')!
    list.innerHTML = `${mode === 'no-self-boundary' ? '' : '<li class="message-item item-myself"><span class="text">您好，想了解岗位。</span></li>'}<li class="message-item item-friend"><span class="text">你好</span></li><li class="message-item item-friend"><span class="text">方便聊聊职责吗？</span></li>`
    bindMessages()
    const expectedRound = support.readMessages(document).filter((message: { from: string }) => message.from === '对方')
    if (mode === 'changed-company-before-click') pane.querySelector('textarea')!.addEventListener('input', () => {
      props.brandName = '另一家公司'
      card.querySelector('.name-box > span:nth-child(2)')!.textContent = props.brandName
    })
    card.addEventListener('click', () => {
      card.classList.add('selected')
      Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: props } })
      if (mode === 'changed-company' || mode === 'missing-company') {
        props.brandName = mode === 'changed-company' ? '另一家公司' : ''
        card.querySelector('.name-box > span:nth-child(2)')!.textContent = props.brandName
      }
      if (mode === 'new-inbound') {
        list.insertAdjacentHTML('beforeend', '<li class="message-item item-friend"><span class="text">还有一个问题</span></li>')
        bindMessages()
      }
      if (mode === 'hidden-gap') {
        Object.defineProperty(list.querySelector('.item-friend')!, 'getBoundingClientRect', {
          value: () => ({ width: 0, height: 0 }),
        })
      }
    })
    let clicks = 0
    pane.querySelector('button')!.addEventListener('click', () => {
      clicks++
      list.insertAdjacentHTML('beforeend', '<li class="message-item item-myself"><span class="text">您好！</span></li>')
      bindMessages()
    })
    let listener!: (message: object, sender: object, reply: (result: object) => void) => void
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window: { top: window, self: window, addEventListener: () => {} }, document,
      location: { pathname: '/web/geek/chat' }, GetJobsBossHrSupport: support, sessionStorage,
      Event, InputEvent, HTMLTextAreaElement, HTMLInputElement, getComputedStyle,
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      chrome: { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn } },
        sendMessage: (_message: object, reply: (result: object) => void) => reply({ success: true, data: { data: { watchActive: true } } }),
      } },
    })
    const result = await new Promise<object>(resolve => listener({ source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SEND_V2',
      command: { commandId: 'review-short', uid: '101-0', hrName: '王女士', companyName: '测试公司',
        draft: '您好！', reviewOnly: mode !== 'unreviewed', deadlineAt: Date.now() + 30000,
        expectedInboundRound: mode === 'missing-round' ? undefined : expectedRound, expectedLatestInbound: expectedRound.at(-1) },
    }, {}, resolve))
    expect(result).toMatchObject({ outcome: mode === 'reviewed' ? 'SENT' : 'STALE' })
    expect(clicks).toBe(mode === 'reviewed' ? 1 : 0)
    if (mode === 'changed-company' || mode === 'missing-company') {
      expect(result).toMatchObject({ evidence: '2026-09-30-hr-background-v1: 发送前身份不符：公司' })
    }
  })

  it.each(['delayed', 'not-selected', 'empty-messages', 'changing-messages', 'changed-during-read'])('waits for the actual selected conversation: %s', async (mode) => {
    const pane = document.querySelector('.chat-conversation')!
    if (mode === 'changed-during-read') {
      Object.defineProperties(pane.querySelector('.chat-message')!, { scrollHeight: { value: 900 }, clientHeight: { value: 100 } })
    }
    document.body.insertAdjacentHTML('afterbegin', '<button class="filter-all">全部</button>')
    let phase = 'initial'
    let elapsed = 0
    let filterClicks = 0
    let entry: ReturnType<typeof addCard> | undefined
    const captured: Array<{ session: { uid: string }; messages: Array<{ text: string }> }> = []
    document.querySelector('.filter-all')!.addEventListener('click', () => {
      filterClicks++
      document.querySelector('.user-list')!.replaceChildren()
      phase = 'list'
      elapsed = 0
    })
    const advance = (ms: number) => {
      elapsed += ms
      if (phase === 'list' && elapsed >= 4000) {
        entry = addCard()
        phase = 'listed'
        entry.card.addEventListener('click', () => { phase = 'conversation'; elapsed = 0 })
      }
      if (phase !== 'conversation' || !entry) return
      const readyAt = mode === 'changing-messages' ? 3000 : 4000
      if (elapsed < readyAt || mode === 'not-selected') return
      entry.card.classList.add('selected')
      Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: entry.props } })
      if (mode !== 'empty-messages') {
        pane.querySelector('.im-list')!.innerHTML = `<li class="message-item item-friend"><span class="text">${mode === 'changing-messages' && elapsed < 3250 ? '正在替换的旧正文' : '完整的新消息'}</span></li>`
        bindMessages()
      }
      if (mode === 'changed-during-read' && elapsed >= 4500) {
        entry.card.classList.remove('selected')
        Object.assign(pane, { __vue__: undefined })
        pane.querySelector('.im-list')!.replaceChildren()
      }
    }
    let listener!: (message: object, sender: object, reply: (result: { success: boolean; errorCode?: string }) => void) => void
    runInNewContext(readFileSync(require.resolve('../../chrome-extension/boss-hr-bridge.js'), 'utf8'), {
      window: { top: window, self: window, addEventListener: () => {} }, document, location: { pathname: '/web/geek/chat' },
      GetJobsBossHrSupport: support, Event, getComputedStyle, sessionStorage,
      setTimeout: (fn: () => void, ms: number) => setTimeout(() => { advance(ms); fn() }, 0),
      chrome: { runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn } },
        sendMessage: (message: { type: string; operation?:string; capture: typeof captured[number] }, reply: (result: object) => void) => {
          if(message.operation==='hr-review-guard') {reply({success:true,data:{data:{watchActive:true}}});return}
          if (message.type === 'BOSS_HR_CAPTURE_RESULT') captured.push(message.capture)
          reply({ success: true, reviewCount:captured.length })
        },
      } },
    })
    const result = await new Promise<{ success: boolean; errorCode?: string }>(resolve => listener({
      source: 'GET_JOBS_BACKGROUND', type: 'BOSS_HR_SCAN_V2', scanAll: true, reviewLimit: 3,
      streamResults: true, scanId: 'loading', watchSessionId: 'watch', deadlineAt: Date.now() + 30000,
    }, {}, resolve))
    expect(filterClicks).toBe(1)
    if (mode === 'not-selected' || mode === 'empty-messages' || mode === 'changed-during-read') {
      const errorCode = mode === 'changed-during-read' ? 'BOSS_CHAT_CHANGED_DURING_READ' : mode === 'not-selected' ? 'BOSS_CHAT_NOT_SELECTED' : 'BOSS_CHAT_MESSAGES_MISSING'
      expect(result).toMatchObject({ success: false, errorCode })
      expect(captured).toHaveLength(0)
    } else {
      expect(result.success).toBe(true)
      expect(captured).toHaveLength(1)
      expect(captured[0].session.uid).toBe('101-0')
      expect(captured[0].messages[0].text).toBe('完整的新消息')
    }
  })

})
