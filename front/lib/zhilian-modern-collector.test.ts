import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Job = { id: string; title: string; company: string; description: string; url: string; detailVerified: boolean }
type Collector = {
  readCard(card: Element): Partial<Job>
  readDetail(document: Document, card: Element, expectedId?: string): Job | null
  selectAndRead(document: Document, card: Element, hooks: { expectedId?: string; sleep: () => Promise<void>; shouldStop: () => Promise<boolean> }): Promise<Job | null>
}
const scope: Record<string, unknown> = {}
for (const file of ['zhilian-scan-support.js', 'zhilian-modern-collector.js']) {
  runInNewContext(readFileSync(resolve(process.cwd(), '../chrome-extension', file), 'utf8'), { window: scope, URL, URLSearchParams })
}
const collector = scope.GetJobsZhilianModernCollector as Collector
const description = '岗位职责：负责产品需求分析、运营推广和数据跟踪。任职要求：熟悉人工智能产品并具备项目交付经验。'

// Sanitized fixture follows the live /jobs split layout: cards deliberately
// have no job link; the currently selected detail exposes its canonical URL.
function addCard(title = 'AI产品运营', company = '招聘服务公司') {
  const card = document.createElement('div')
  card.className = 'job-card'
  card.innerHTML = `<div class="job-card__title-clamp"><span aria-label="${title}">${title}</span></div><span class="job-card__salary">8000-12000元</span><div class="job-card__skill-tags">本科 3-5年</div><a class="job-card__company-name">${company}</a><div class="job-card__location">北京 海淀</div>`
  document.querySelector('.job-list-panel')!.append(card)
  return card
}
function showDetail(card: Element, id = 'CC100J200', content = description) {
  document.querySelectorAll('.job-card').forEach(c => c.classList.remove('job-card--active'))
  card.classList.add('job-card--active')
  document.querySelector('.job-split-layout__right')!.innerHTML = `<h1><span class="job-detail-summary__title-text">${collector.readCard(card).title}</span><span class="job-detail-summary__salary">8000-12000元</span></h1><span class="job-detail-summary__tag">北京·海淀区</span><span class="job-detail-summary__tag">3-5年</span><span class="job-detail-summary__tag">本科</span><a class="company-name">客户公司：某客户</a><div class="job-description__content">${content}</div><div class="company-intro">不应混入的公司介绍</div><a href="https://www.zhaopin.com/jobdetail/${id}.htm">查看更多信息</a>`
}

describe('Zhilian modern split list', () => {
  beforeEach(() => { document.body.innerHTML = '<div class="job-list-panel"></div><div class="job-split-layout__right"></div>' })

  it('extracts core fields and exact JD from a linkless card, keeping the recruiter company', () => {
    const card = addCard()
    showDetail(card)
    expect(card.querySelector('a[href]')).toBeNull()
    expect(collector.readDetail(document, card, 'CC100J200')).toMatchObject({
      id: 'CC100J200', title: 'AI产品运营', company: '招聘服务公司', salary: '8000-12000元',
      location: '北京·海淀区', experience: '3-5年', degree: '本科', description, detailVerified: true
    })
  })

  it('rejects stale detail IDs, inactive cards and incomplete descriptions', () => {
    const a = addCard(), b = addCard('其他岗位')
    showDetail(a)
    expect(collector.readDetail(document, a, 'CC100J999')).toBeNull()
    expect(collector.readDetail(document, b)).toBeNull()
    showDetail(a, 'CC100J200', '加载中')
    expect(collector.readDetail(document, a)).toBeNull()
  })

  it('waits for changed identity and stable body when two cards share the same title', async () => {
    const a = addCard(), b = addCard()
    showDetail(a)
    let ticks = 0
    b.querySelector('.job-card__title-clamp')!.addEventListener('click', () => {
      a.classList.remove('job-card--active'); b.classList.add('job-card--active')
    })
    const job = await collector.selectAndRead(document, b, {
      expectedId: 'CC100J201', shouldStop: async () => false,
      sleep: async () => { if (++ticks === 3) showDetail(b, 'CC100J201') }
    })
    expect(job?.id).toBe('CC100J201')
    expect(ticks).toBeGreaterThanOrEqual(4)
  })

  it('times out rather than assigning an unchanged right panel to another card', async () => {
    const a = addCard(), b = addCard()
    showDetail(a)
    b.querySelector('.job-card__title-clamp')!.addEventListener('click', () => {
      a.classList.remove('job-card--active'); b.classList.add('job-card--active')
    })
    expect(await collector.selectAndRead(document, b, { expectedId: 'CC100J201', sleep: async () => {}, shouldStop: async () => false })).toBeNull()
  })

  it('rejects indistinguishable cards when there is no independently known job identity', async () => {
    const a = addCard(), b = addCard(); showDetail(b)
    expect(await collector.selectAndRead(document, a, { sleep: async () => {}, shouldStop: async () => false })).toBeNull()
    expect(await collector.selectAndRead(document, b, { sleep: async () => {}, shouldStop: async () => false })).toBeNull()
  })

  it('reads appended cards beyond the immutable first twenty without requiring their links', async () => {
    for (let i = 0; i < 20; i++) addCard(`初始岗位${i}`)
    const appended = addCard('滚动新增岗位')
    appended.querySelector('.job-card__title-clamp')!.addEventListener('click', () => showDetail(appended, 'CC100J221'))
    expect((await collector.selectAndRead(document, appended, { sleep: async () => {}, shouldStop: async () => false }))?.id).toBe('CC100J221')
  })

  it('honors cancellation without accepting the current detail', async () => {
    const card = addCard(); showDetail(card)
    expect(await collector.selectAndRead(document, card, { sleep: async () => {}, shouldStop: async () => true })).toBeNull()
  })

  it('continues after twenty historical duplicates and checkpoints a fresh appended job', async () => {
    const seeds = Array.from({ length: 20 }, (_, i) => {
      addCard(`初始岗位${i}`)
      return { id: `CC100J${i}`, title: `初始岗位${i}`, company: '招聘服务公司', salary: '8000-12000元' }
    })
    Element.prototype.scrollIntoView = vi.fn()
    const saved: Array<{ collectedJobs: Job[]; modernSeenIds: string[] }> = []
    const support = scope.GetJobsZhilianScanSupport as { deepCollectionStopReason: (state: unknown) => string }
    const code = readFileSync(resolve(process.cwd(), '../chrome-extension/zhilian-content.js'), 'utf8')
    const functionSource = code.slice(code.indexOf('  async function collectModernZhilianJobs('), code.indexOf('  async function collectJobsAcrossSearchPages('))
    const context = {
      window: {
        GetJobsZhilianModernCollector: collector, innerHeight: 800,
        scrollBy: () => {
          const card = addCard('滚动新增岗位')
          card.querySelector('.job-card__title-clamp')!.addEventListener('click', () => showDetail(card, 'CC100J221'))
        }
      }, document, Date, Set, WeakSet,
      normalizeCollectedJobs: (jobs: unknown) => jobs || [],
      storeScanTask: async (task: { collectedJobs: Job[]; modernSeenIds: string[] }) => { saved.push(structuredClone(task)) },
      handleBlockingState: async () => null, buildPageBlockDiagnostics: () => ({}),
      waitForJobCards: async () => {}, hasStopRequested: async () => false,
      collectZhilianInitialStateJobs: () => seeds,
      filterZhilianDuplicateJobs: async (jobs: Job[]) => ({ jobs: jobs.filter(j => j.id === 'CC100J221'), duplicateCount: jobs.filter(j => j.id !== 'CC100J221').length }),
      zhilianCollectionStopReason: support.deepCollectionStopReason,
      isCurrentSearchPage: () => true, sleep: async () => {}, postProgress: () => {}, collectionStopReasonLabel: (s: string) => s
    }
    const collect = runInNewContext(`${functionSource}\ncollectModernZhilianJobs`, context)
    const result = await collect({}, {}, 'AI产品运营', {}, 1, {}, 0)
    expect(result.detailsComplete).toBe(true)
    expect(result.jobs.map((j: Job) => j.id)).toEqual(['CC100J221'])
    expect(saved.at(-1)?.modernSeenIds).toHaveLength(21)
    expect(saved.at(-1)?.collectedJobs[0].description).toBe(description)

    // Resume uses stable IDs and already verified details; it does not click
    // another card or call AI while reconstructing the collection result.
    const resumed = await collect(saved.at(-1), {}, 'AI产品运营', {}, 1, {}, 0)
    expect(resumed.jobs).toHaveLength(1)
    expect(resumed.jobs[0].id).toBe('CC100J221')

    // If there are only historical duplicates, report an empty collection to
    // the runner instead of falling through to jobs[0].title.
    document.querySelector('.job-list-panel')!.lastElementChild!.remove()
    context.window.scrollBy = () => {}
    const duplicatesOnly = await collect({}, {}, 'AI产品运营', {}, 1, {}, 0)
    expect(duplicatesOnly.empty).toBe(true)
    expect(duplicatesOnly.jobs).toHaveLength(0)
  })

  it('submits verified panel jobs once without navigating them to standalone details', async () => {
    const jobs = Array.from({ length: 20 }, (_, i) => ({ id: `CC100J${i}`, title: `岗位${i}`, url: `https://www.zhaopin.com/jobdetail/CC100J${i}.htm`, description, detailVerified: true }))
    const source = readFileSync(resolve(process.cwd(), '../chrome-extension/zhilian-content.js'), 'utf8')
    const functionSource = source.slice(source.indexOf('  async function runScanInternal('), source.indexOf('  function collectJobs('))
    const navigation = vi.fn()
    const submit = vi.fn(async (task: { detailIndex: number }) => {
      expect(task.detailIndex).toBe(20)
      return { totalSaved: 20, totalRead: 20, totalReceived: 20, totalInsufficient: 0 }
    })
    const context = {
      stopRequested: false, Date, window: { location: { href: 'https://www.zhaopin.com/jobs?jl=489&kw=AI产品运营' } },
      normalizeScanTask: (m: unknown) => m, scanKeywords: () => ['AI产品运营'], normalizeTaskIndex: () => 0,
      hasStopRequested: async () => false, markKeywordCursorCurrent: () => {}, buildSearchUrl: () => '', buildSearchNavigationKey: () => '',
      writeScanStatus: () => {}, isCurrentSearchPage: () => true, storeScanTask: async () => {}, postProgress: () => {},
      waitForPage: async () => {}, sleep: async () => {}, normalizeSearchJobLimit: () => 20,
      collectJobsAcrossSearchPages: async () => ({ jobs, candidateCount: 20, detailsComplete: true }),
      navigateToDetail: navigation, continueZhilianDetailScan: submit, advanceKeywordCursor: () => {}, clearStoredScanTask: () => {}
    }
    const run = runInNewContext(`${functionSource}\nrunScanInternal`, context)
    expect((await run({ config: {}, runId: 'test-run', currentIndex: 0 })).saved).toBe(20)
    expect(navigation).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
