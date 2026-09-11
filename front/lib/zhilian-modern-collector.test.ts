import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Job = { id: string; title: string; company: string; description: string; url: string; detailVerified: boolean }
type Hooks = { expectedId?: string; sleep: (ms: number) => Promise<void>; shouldStop: () => Promise<boolean>; deadline?: number }
type Collector = {
  readCard(card: Element): Partial<Job>
  readDetail(document: Document, card: Element, expectedId?: string): Job | null
  selectAndRead(document: Document, card: Element, hooks: Hooks): Promise<Job | null>
  selectAndReadResult(document: Document, card: Element, hooks: Hooks): Promise<{job: Job | null; reason: string; retries: number}>
}
const scope: Record<string, unknown> = {}
for (const file of ['zhilian-scan-support.js', 'zhilian-modern-collector.js']) {
  runInNewContext(readFileSync(resolve(process.cwd(), '../chrome-extension', file), 'utf8'), { window: scope, URL, URLSearchParams })
}
const continuousScope: Record<string, unknown> = {}
runInNewContext(readFileSync(resolve(process.cwd(), '../chrome-extension/continuous-scan-support.js'), 'utf8'), continuousScope)
const continuous = continuousScope.GetJobsContinuousScan as { applyReceipts: (state: unknown, items: unknown[], keyword: string, target: number) => unknown }
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

  it('scrolls each card into view and waits for a lazily rendered title before clicking', async () => {
    const card = addCard()
    card.querySelector('.job-card__title-clamp')!.innerHTML = ''
    const scroll = vi.fn()
    card.scrollIntoView = scroll
    const click = vi.fn(() => showDetail(card))
    card.querySelector('.job-card__title-clamp')!.addEventListener('click', click)
    let ticks = 0
    const result = await collector.selectAndReadResult(document, card, {
      shouldStop: async () => false,
      sleep: async () => { if (++ticks === 2) card.querySelector('.job-card__title-clamp')!.textContent = 'AI产品运营' }
    })
    expect(result.job?.title).toBe('AI产品运营')
    expect(scroll).toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('waits through a slow title render without repeatedly restarting scrolling', async () => {
    const card = addCard()
    card.querySelector('.job-card__title-clamp')!.innerHTML = ''
    card.scrollIntoView = vi.fn()
    let ticks = 0
    card.querySelector('.job-card__title-clamp')!.addEventListener('click', () => showDetail(card))
    const result = await collector.selectAndReadResult(document, card, {
      shouldStop: async () => false,
      sleep: async () => { if (++ticks === 15) card.querySelector('.job-card__title-clamp')!.textContent = 'AI产品运营' }
    })
    expect(result.job?.id).toBe('CC100J200')
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' })
  })

  it('reports a background render pause without clicking an empty title', async () => {
    const card = addCard()
    card.querySelector('.job-card__title-clamp')!.innerHTML = ''
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      const result = await collector.selectAndReadResult(document, card, { shouldStop: async () => false, sleep: async () => {} })
      expect(result).toMatchObject({ job: null, reason: 'PAGE_HIDDEN', retries: 0 })
    } finally { visibility.mockRestore() }
  })

  it('preserves candidates and pauses rather than counting an empty card as a failed JD', async () => {
    const card = addCard()
    card.querySelector('.job-card__title-clamp')!.innerHTML = ''
    const code = readFileSync(resolve(process.cwd(), '../chrome-extension/zhilian-content.js'), 'utf8')
    const source = code.slice(code.indexOf('  async function collectModernZhilianJobs('), code.indexOf('  async function collectJobsAcrossSearchPages('))
    const saved: Record<string, unknown>[] = [], states: Record<string, unknown>[] = []
    const retained = { id: 'KEPT', title: '已采集岗位', url: 'https://www.zhaopin.com/jobdetail/KEPT.htm', detailVerified: true }
    const collect = runInNewContext(`${source}\ncollectModernZhilianJobs`, {
      window: { GetJobsZhilianModernCollector: collector, GetJobsContinuousScan: continuous, GetJobsZhilianFilters: { verify: async () => {} } },
      document, Date, Set, WeakMap,
      normalizeCollectedJobs: (jobs: unknown) => jobs || [], storeScanTask: async (task: Record<string, unknown>) => saved.push(task),
      handleBlockingState: async () => null, buildPageBlockDiagnostics: () => ({}),
      waitForJobCards: async () => {}, hasStopRequested: async () => false,
      collectZhilianInitialStateJobs: () => [], filterZhilianDuplicateJobs: async () => ({ jobs: [], duplicateCount: 0 }),
      zhilianCollectionStopReason: () => '', isCurrentSearchPage: () => true,
      sleep: async () => {}, postProgress: () => {}, writeScanStatus: (state: Record<string, unknown>) => states.push(state)
    })
    const result = await collect({ modernKeyword: 'AI', collectedJobs: [retained], runId: 'run' }, { runId: 'run' }, 'AI', {}, 2, {}, 0)
    expect(result.paused).toBe(true)
    expect(saved.at(-1)).toMatchObject({ phase: 'collecting', collectedJobs: [retained], modernSeenIds: ['KEPT'], modernDetailFailures: 0 })
    expect(states.at(-1)).toMatchObject({ stage: 'blocked', resumable: true, isRunning: false })
  })

  it('reacquires a uniquely matching replaced node and retries exactly once', async () => {
    const card = addCard()
    const staleClick = vi.fn(() => {
      const replacement = card.cloneNode(true) as HTMLElement
      card.replaceWith(replacement)
      replacement.querySelector('.job-card__title-clamp')!.addEventListener('click', () => showDetail(replacement))
    })
    card.querySelector('.job-card__title-clamp')!.addEventListener('click', staleClick)
    const result = await collector.selectAndReadResult(document, card, { sleep: async () => {}, shouldStop: async () => false })
    expect(result.job?.id).toBe('CC100J200')
    expect(result.retries).toBe(1)
    expect(staleClick).toHaveBeenCalledTimes(1)
    expect(collector.readDetail(document, card)).toBeNull()
  })

  it('accepts salary and location that finish rendering after selection', async () => {
    const card = addCard()
    card.querySelector('.job-card__salary')!.textContent = ''
    card.querySelector('.job-card__location')!.textContent = ''
    card.querySelector('.job-card__title-clamp')!.addEventListener('click', () => {
      card.querySelector('.job-card__salary')!.textContent = '8000-12000元'
      card.querySelector('.job-card__location')!.textContent = '北京 海淀'
      showDetail(card)
    })
    expect((await collector.selectAndReadResult(document, card, {sleep: async () => {}, shouldStop: async () => false})).job?.id).toBe('CC100J200')
  })

  it('never rebinds a replaced card to a different job at the same list index', async () => {
    const card = addCard()
    card.querySelector('.job-card__title-clamp')!.addEventListener('click', () => {
      const other = addCard('其他岗位', '另一公司'); card.replaceWith(other); showDetail(other)
    })
    const result = await collector.selectAndReadResult(document, card, { sleep: async () => {}, shouldStop: async () => false })
    expect(result.job).toBeNull()
    expect(result.reason).toBe('CARD_DETACHED')
    expect(result.retries).toBe(1)
  })

  it('does not accept an old same-title panel on the second attempt after the card became active', async () => {
    const a = addCard(), b = addCard('AI产品运营', '另一招聘公司')
    showDetail(a)
    b.querySelector('.job-card__title-clamp')!.addEventListener('click', () => {
      a.classList.remove('job-card--active'); b.classList.add('job-card--active')
    })
    const result = await collector.selectAndReadResult(document, b, { sleep: async () => {}, shouldStop: async () => false })
    expect(result).toMatchObject({ job: null, reason: 'DETAIL_NOT_SWITCHED', retries: 1 })
  })

  it.each([
    ['IDENTITY_MISMATCH', 'CC100J999', description],
    ['BODY_INCOMPLETE', 'CC100J200', '加载中']
  ])('reports %s without retrying an invalid detail', async (reason, id, content) => {
    const card = addCard(); showDetail(card, id, content)
    const result = await collector.selectAndReadResult(document, card, { expectedId: 'CC100J200', sleep: async () => {}, shouldStop: async () => false })
    expect(result).toMatchObject({ job: null, reason, retries: 0 })
  })

  it('bounds title readiness retries and never clicks a blank title', async () => {
    const card = addCard(); card.querySelector('.job-card__title-clamp')!.innerHTML = ''
    const click = vi.fn(); card.querySelector('.job-card__title-clamp')!.addEventListener('click', click)
    const sleep = vi.fn(async () => {})
    expect(await collector.selectAndReadResult(document, card, { sleep, shouldStop: async () => false }))
      .toMatchObject({ job: null, reason: 'CARD_NOT_READY', retries: 1 })
    expect(sleep).toHaveBeenCalledTimes(40)
    expect(click).not.toHaveBeenCalled()
  })

  it('shares the keyword deadline across both attempts without accepting a late detail', async () => {
    const card = addCard(); showDetail(card)
    let now = 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    // The module VM has its own Date constructor; pass the shared clock explicitly.
    const local: Record<string, unknown> = { GetJobsZhilianScanSupport: scope.GetJobsZhilianScanSupport }
    runInNewContext(readFileSync(resolve(process.cwd(), '../chrome-extension/zhilian-modern-collector.js'), 'utf8'), { window: local, Date })
    const result = await (local.GetJobsZhilianModernCollector as Collector).selectAndReadResult(document, card, {
      deadline: 1250, sleep: async ms => { now += ms }, shouldStop: async () => false
    })
    expect(result).toMatchObject({ job: null, reason: 'KEYWORD_TIMEOUT', retries: 0 })
    expect(now).toBe(1250)
    clock.mockRestore()
  })

  it('checks cancellation again after rendering and does not click or accept a detail', async () => {
    const card = addCard(); showDetail(card)
    const click = vi.fn(); card.querySelector('.job-card__title-clamp')!.addEventListener('click', click)
    let checks = 0
    const result = await collector.selectAndReadResult(document, card, { sleep: async () => {}, shouldStop: async () => ++checks > 1 })
    expect(result.reason).toBe('STOPPED')
    expect(click).not.toHaveBeenCalled()
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
        GetJobsContinuousScan: continuous, localStorage, GetJobsZhilianFilters: {verify:async()=>({verified:true})},
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
    const onScroll = () => context.window.scrollBy()
    document.documentElement.addEventListener('wheel', onScroll)
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
    document.documentElement.removeEventListener('wheel', onScroll)
  })

  it('submits verified panel jobs once without navigating them to standalone details', async () => {
    const jobs = Array.from({ length: 20 }, (_, i) => ({ id: `CC100J${i}`, title: `岗位${i}`, url: `https://www.zhaopin.com/jobdetail/CC100J${i}.htm`, description, detailVerified: true }))
    const source = readFileSync(resolve(process.cwd(), '../chrome-extension/zhilian-content.js'), 'utf8')
    const functionSource = source.slice(source.indexOf('  async function runScanInternal('), source.indexOf('  function collectJobs('))
    const navigation = vi.fn()
    const submit = vi.fn(async (task: { detailIndex: number; continuousScan: unknown }) => {
      continuous.applyReceipts(task.continuousScan, jobs.map(job => ({jobKey: job.id, freshAccepted: true})), 'AI产品运营', 20)
      expect(task.detailIndex).toBe(20)
      return { totalSaved: 20, totalRead: 20, totalReceived: 20, totalInsufficient: 0 }
    })
    const context = {
      stopRequested: false, Date, document, localStorage, window: { GetJobsContinuousScan: continuous, localStorage, GetJobsZhilianFilters:{verify:async()=>({verified:true})}, location: { href: 'https://www.zhaopin.com/jobs?jl=489&kw=AI产品运营' } },
      requestZhilianLocalApi:async()=>({version:'2026-09-08'}),
      normalizeScanTask: (m: unknown) => m, scanKeywords: () => ['AI产品运营'], normalizeTaskIndex: () => 0,
      hasStopRequested: async () => false, markKeywordCursorCurrent: () => {}, buildSearchUrl: () => '', buildSearchNavigationKey: () => '',
      writeScanStatus: () => {}, isCurrentSearchPage: () => true, storeScanTask: async () => {}, postProgress: () => {},
      waitForPage: async () => {}, sleep: async () => {}, normalizeSearchJobLimit: () => 20,
      collectJobsAcrossSearchPages: async () => ({ jobs, candidateCount: 20, detailsComplete: true }),
      navigateToDetail: navigation, continueZhilianDetailScan: submit, advanceKeywordCursor: () => {}, clearStoredScanTask: () => {}
    }
    const run = runInNewContext(`${functionSource}\nrunScanInternal`, context)
    expect((await run({ config: {keywords: ['AI产品运营'], searchJobLimit: 20}, keywords: ['AI产品运营'], runId: 'test-run', currentIndex: 0 })).saved).toBe(20)
    expect(navigation).not.toHaveBeenCalled()
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('Zhilian keyword outcomes', () => {
  function runner(collections: Array<Record<string, unknown>>, storedTask?: Record<string, unknown>) {
    const source = readFileSync(resolve(process.cwd(), '../chrome-extension/zhilian-content.js'), 'utf8')
    const functionSource = source.slice(source.indexOf('  async function runScanInternal('), source.indexOf('  function collectJobs('))
    const checkpoints: Array<Record<string, unknown>> = []
    const events: Array<{ type: string; meta: Record<string, unknown> }> = []
    const keywords = ['关键词一', '关键词二', '关键词三'].slice(0, collections.length)
    const collect = vi.fn(async (_task, base) => {
      const data = collections[base.currentIndex]
      return { ...data, jobs: (data.jobs as Job[]).map(job => ({...job, id: `${job.id}-${base.currentIndex}`})) }
    })
    const submit = vi.fn(async (task) => {
      continuous.applyReceipts(task.continuousScan, task.jobs.map((job: Job) => ({jobKey: job.id, freshAccepted: true})), keywords[task.currentIndex], 1)
      return { totalSaved: task.totalSaved + task.jobs.length,
      totalRead: task.totalRead + task.jobs.length, totalReceived: task.totalReceived + task.jobs.length, totalInsufficient: 0 } })
    const context = {
      stopRequested: false, Date, document, localStorage,
      window: { GetJobsContinuousScan: continuous, localStorage, GetJobsZhilianFilters: { verify: async () => ({ verified: true }) }, location: { href: 'https://www.zhaopin.com/jobs' } },
      requestZhilianLocalApi: async () => ({}), normalizeScanTask: (m: unknown) => m,
      scanKeywords: () => keywords, normalizeTaskIndex: (index: number) => index || 0,
      hasStopRequested: async () => false, markKeywordCursorCurrent: () => {}, buildSearchUrl: () => '', buildSearchNavigationKey: () => '',
      writeScanStatus: vi.fn(), isCurrentSearchPage: () => true,
      storeScanTask: async (task: Record<string, unknown>) => { checkpoints.push(structuredClone(task)) },
      postProgress: (_task: unknown, type: string, _message: string, meta: Record<string, unknown>) => events.push({ type, meta }),
      waitForPage: async () => {}, sleep: async () => {}, humanPause: async () => {}, normalizeSearchJobLimit: () => 1,
      collectJobsAcrossSearchPages: collect, navigateToDetail: vi.fn(), continueZhilianDetailScan: submit,
      advanceKeywordCursor: () => {}, clearStoredScanTask: () => {}
    }
    const run = runInNewContext(`${functionSource}\nrunScanInternal`, context)
    return { run: () => run({ config: {keywords, searchJobLimit: 1}, keywords, runId: 'test-run', profileId: 4, currentIndex: 0, ...storedTask }), checkpoints, events, collect, submit, navigation: context.navigateToDetail }
  }

  const complete = { jobs: [{ id: 'CC100J200', title: '岗位', detailVerified: true }], detailsComplete: true, stopReason: 'target_reached' }
  const failed = { jobs: [], empty: true, detailsComplete: true, detailFailures: 4, historyDuplicateCount: 19, stopReason: 'timeout_safety_cap' }

  it('continues after an empty failed keyword, preserves counts, and finishes with a warning', async () => {
    const h = runner([complete, failed, complete])
    const result = await h.run()
    expect(h.collect).toHaveBeenCalledTimes(3)
    expect(h.submit).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ outcome: 'partial', saved: 2, totalRead: 2, totalReceived: 2 })
    expect(result.keywordResults.map((item: {outcome: string}) => item.outcome)).toEqual(['complete', 'partial', 'complete'])
    expect(result.keywordResults[1]).toMatchObject({ detailFailures: 4, historyDuplicates: 19, collected: 0 })
    expect(h.events.at(-1)).toMatchObject({ type: 'warning', meta: { stage: 'complete', outcome: 'partial' } })
    expect(h.checkpoints.at(-1)?.keywordResults).toHaveLength(3)
  })

  it('reports partial when every keyword hits the collection limit, without submitting empty jobs', async () => {
    const h = runner([failed, failed]); const result = await h.run()
    expect(result).toMatchObject({ success: true, outcome: 'partial', totalRead: 0 })
    expect(h.submit).not.toHaveBeenCalled()
    expect(h.events.at(-1)).toMatchObject({ type: 'warning', meta: { stage: 'complete' } })
  })

  it('distinguishes proven exhaustion from reaching the fresh target', async () => {
    const h = runner([
      { jobs: [], empty: true, stopReason: 'platform_exhausted' },
      { jobs: [], empty: true, stopReason: 'platform_exhausted', historyDuplicateCount: 20 }
    ])
    expect(await h.run()).toMatchObject({ outcome: 'exhausted', totalRead: 0 })
    expect(h.submit).not.toHaveBeenCalled()
    expect(h.events.at(-1)?.type).toBe('warning')
  })

  it('restores failed keyword outcomes from a navigation checkpoint without re-submitting prior keywords', async () => {
    const first = runner([complete, failed, complete]); await first.run()
    const checkpoint = first.checkpoints.find(task => task.currentIndex === 2 && task.phase === 'nextKeyword')!
    const resumed = runner([complete, failed, complete], checkpoint)
    expect(await resumed.run()).toMatchObject({ outcome: 'partial', totalRead: 2, saved: 2 })
    expect(resumed.collect).toHaveBeenCalledTimes(1)
    expect(resumed.submit).toHaveBeenCalledTimes(1)
  })

  it('does not call legacy candidate collection complete before detail navigation finishes', async () => {
    const h = runner([{...complete, detailsComplete: false}])
    h.submit.mockImplementation(async () => ({pendingNavigation: true, totalSaved: 0, totalRead: 0, totalReceived: 0, totalInsufficient: 0}))
    // Legacy details first navigate to the selected job; the mock lets that
    // navigation resolve so the saved detail checkpoint can be inspected.
    const sourceCheckpoint = h.checkpoints
    // This test runner normally avoids the standalone navigation path.
    // Stub its navigation below through the returned mock.
    h.navigation.mockResolvedValue({status: 'ready'})
    expect(await h.run()).toMatchObject({pendingNavigation: true})
    expect(sourceCheckpoint.at(-1)?.keywordResults).toEqual([expect.objectContaining({outcome: 'running', collected: 0})])
  })
})
