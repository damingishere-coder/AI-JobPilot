import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeEach, expect, it, vi } from 'vitest'
import { readScanResult } from '@/app/zhilian/ScanResult'

const source = readFileSync(resolve(process.cwd(), '../chrome-extension/boss-content.js'), 'utf8')
function fn(name: string) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`))
  if (start < 0) throw new Error(name)
  const end = source.slice(start + 1).search(/\n  (?:async )?function /)
  return source.slice(start, end < 0 ? undefined : start + 1 + end)
}
const names = ['findJobDetailLink', 'jobCardRoot', 'isLikelyJobCardNode', 'collectJobNodes', 'findBossCardClickTarget', 'isBossUnsafeCardAction', 'isInvalidBossCandidateTitle', 'isBossNonJobNavigationTitle', 'attrText', 'textOf']
function harness() {
  const scope = runInNewContext(`${names.map(fn).join('\n')}\n({collectJobNodes, findBossCardClickTarget, findJobDetailLink, jobCardRoot})`, {
    document, window: { location: { origin: 'https://www.zhipin.com' } }, URL, SCAN_SUPPORT: {},
    JOB_CARD_SELECTORS: ['.job-card-box', '.job-card-body', '.job-list-box li', "a[href*='job_detail']"],
    compact: (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim(),
    unique: (items: unknown[]) => [...new Set(items)]
  })
  return scope as { collectJobNodes(): Element[]; findBossCardClickTarget(root: Element): Element | null; findJobDetailLink(root: Element, fallback: Element): Element | null; jobCardRoot(root: Element): Element }
}
beforeEach(() => { document.body.innerHTML = '' })
it('does not treat job_detail inside a navigation query as a job or click it', () => {
  document.body.innerHTML = '<div class="job-list-box"><li class="job-card-box"><a href="/web/geek/jobs?from=job_detail">职位搜索</a></li></div>'
  const h = harness(), node = document.querySelector('li')!
  expect(h.collectJobNodes()).toHaveLength(0)
  expect(h.findJobDetailLink(node, node)).toBeNull()
  expect(h.findBossCardClickTarget(node)).toBeNull()
})
it('rejects external and nested redirect destinations even if they contain a BOSS job URL', () => {
  document.body.innerHTML = '<div><a href="https://example.com/job_detail/a.html">产品经理</a><a href="/redirect?url=https://www.zhipin.com/job_detail/a.html">产品经理</a></div>'
  expect(harness().collectJobNodes()).toHaveLength(0)
})
it('keeps real cards separate and accepts their canonical job title link', () => {
  document.body.innerHTML = '<ul class="job-list-box"><li class="job-card-box"><a class="job-name" href="/job_detail/abc.html">产品经理</a><span class="company-name">甲公司</span></li><li class="job-card-box"><span class="job-name">运营</span><span class="company-name">乙公司</span></li></ul>'
  const h = harness(), cards = h.collectJobNodes()
  expect(cards).toHaveLength(2)
  expect(h.jobCardRoot(cards[1])).toBe(cards[1])
  expect(h.findBossCardClickTarget(cards[0])?.getAttribute('href')).toBe('/job_detail/abc.html')
})
it('does not fall back to company links, chat buttons or the whole card', () => {
  document.body.innerHTML = '<li class="job-card-box"><span class="job-name">运营</span><span class="company-name">甲公司</span><a href="/gongsi/abc.html">公司</a><button>立即沟通</button></li>'
  expect(harness().findBossCardClickTarget(document.querySelector('li')!)).toBeNull()
})
it('waits beyond empty containers until real cards finish loading', async () => {
  let ticks = 0
  const sleep = vi.fn(async () => { ticks++ })
  const wait = runInNewContext(`${fn('waitForJobCards')}\nwaitForJobCards`, {
    buildListDiagnostics: () => ({ resultContainers: 1, embeddedJobs: 0, hasBlockingState: false }),
    collectJobNodes: () => ticks >= 3 ? [{}] : [], isStopRequested: () => false, sleep
  })
  expect((await wait()).ready).toBe(true)
  expect(sleep).toHaveBeenCalledTimes(3)
})
it('times out on an empty loading shell rather than reporting ready', async () => {
  const wait = runInNewContext(`${fn('waitForJobCards')}\nwaitForJobCards`, {
    buildListDiagnostics: () => ({ resultContainers: 1, embeddedJobs: 0 }),
    collectJobNodes: () => [], isStopRequested: () => false, sleep: async () => {}
  })
  expect((await wait()).ready).toBe(false)
})
it('shows blocked scan results as paused even when the previous outcome was running', () => {
  expect(readScanResult({ runId: 'boss-1', outcome: 'running', stage: 'blocked', paused: true, keywordResults: [] })?.outcome).toBe('paused')
})

it('retains a linkless SPA title click without accepting navigation URLs', () => {
  document.body.innerHTML = '<li class="job-card-box"><a class="job-name" href="javascript:;">运营</a><span class="company-name">甲公司</span></li>'
  const title = document.querySelector('a')!
  Object.defineProperty(title, 'offsetParent', { value: document.body })
  expect(harness().findBossCardClickTarget(document.querySelector('li')!)).toBe(title)
  title.setAttribute('href', '/web/geek/jobs?query=')
  expect(harness().findBossCardClickTarget(document.querySelector('li')!)).toBeNull()
})
