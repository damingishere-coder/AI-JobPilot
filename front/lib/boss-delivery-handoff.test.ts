import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const identity = require('../../chrome-extension/boss-hr-identity.js')
const source = readFileSync('../chrome-extension/boss-content.js', 'utf8')
const start = source.indexOf('  function chatMatchesDelivery(task) {')
const end = source.indexOf('  async function continueGreetingOnChatPage(', start)

function fixture() {
  document.body.innerHTML = '<div class="user-list"><div class="friend-content-warp"><div class="friend-content selected"><div class="name-box"><span class="name-text">测试HR</span><span>测试公司</span></div></div></div></div><div class="chat-conversation"></div>'
  const wrapper = document.querySelector('.friend-content-warp')!
  const pane = document.querySelector('.chat-conversation')!
  const props = { friendId: '101', friendSource: 0, uniqueId: '101-0', name: '测试HR', brandName: '测试公司', encryptJobId: 'target-job' }
  const selected = { ...props }
  Object.assign(wrapper, { __vue__: { $el: wrapper, $props: { source: props } } })
  Object.assign(pane, { __vue__: { $el: pane, selectedFriend$: selected } })
  const match = runInNewContext(source.slice(start, end) + '; chatMatchesDelivery', {
    document, CustomEvent, window: { location: { href: 'https://www.zhipin.com/web/geek/chat' } },
    isCurrentContentInstance: () => true, isBossChatPage: () => true,
    extractBossId: (url: string) => new URL(url).pathname.split('/').pop()!.replace('.html', ''),
    isVisibleChatInput: (el: HTMLElement) => !el.hidden,
  })
  return { props, selected, pane, match: () => match({ url: 'https://www.zhipin.com/job_detail/target-job.html' }) }
}

beforeEach(() => { document.addEventListener('getjobs:hr:refresh-identities', () => identity.sync(document), { once: true }) })

it('binds the new chat page to both the selected recruiter and exact encrypted job ID', () => {
  expect(fixture().match()).toBe(true)
})
it('rejects a different job with the same recruiter', () => {
  const h = fixture(); h.selected.encryptJobId = 'other-job'
  expect(h.match()).toBe(false)
})
it('rejects virtual-list reuse and an unbound conversation', () => {
  const h = fixture(); h.selected.friendId = '202'; h.selected.uniqueId = '202-0'
  expect(h.match()).toBe(false)
})
it('does not send while the conversation is loading', () => {
  const h = fixture(); h.pane.innerHTML = '<div class="pre-loading">加载中</div>'
  expect(h.match()).toBe(false)
})
