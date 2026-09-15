import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const root = resolve(process.cwd(), '../chrome-extension')
const source = (name: string) => readFileSync(resolve(root, name), 'utf8')
type Bundle = { html: string; platform: string; pageType: string; rootCount: number; provenance: { kind: string }; reviewRequired: boolean; warnings: string[] }
type Exporter = { capture(doc: Document, href: string, type: string): Bundle }
function exporter() {
  const scope: { GetJobsFixtureExporter?: Exporter } = {}
  runInNewContext(source('fixture-export.js'), { window: scope, URL })
  return scope.GetJobsFixtureExporter!
}
function doc(html: string) {
  const d = document.implementation.createHTMLDocument('test')
  d.body.innerHTML = html
  return d
}
describe('user-triggered structural redaction', () => {
  it('exports BOSS collector-supported split containers without retaining unknown class names or private text', () => {
    const input = doc('<div class="new-job-list PRIVATE_CONTAINER"><div class="job-card-wrapper" data-jobid="PRIVATE_ID"><span class="job-name">PRIVATE_TITLE</span><span class="company-name">PRIVATE_COMPANY</span><span class="salary">30-50K</span></div></div><div class="job-detail"><div class="job-detail-header"><span class="job-name">PRIVATE_TITLE</span></div><div class="job-sec-text">PRIVATE_JD</div><div class="boss-info">PRIVATE_HR</div></div>')
    const list = exporter().capture(input, 'https://www.zhipin.com/web/geek/jobs', 'SEARCH')
    expect(doc(list.html).querySelector('.job-card-wrapper')).not.toBeNull()
    expect(list.warnings).not.toContain('MISSING_JOB_CARDS')
    const detail = exporter().capture(input, 'https://www.zhipin.com/web/geek/jobs', 'JOB_DETAIL')
    expect(doc(detail.html).querySelector('.job-sec-text')?.textContent).toContain('岗位职责：负责示例产品')
    expect(detail.warnings).not.toContain('MISSING_DESCRIPTION')
    expect(JSON.stringify([list, detail])).not.toMatch(/PRIVATE|new-job-list/)
  })
  it('marks the user-exported header-only detail as incomplete rather than treating header text as JD', () => {
    const input = doc(readFileSync(resolve(root, 'tests/fixtures/boss/detail/redacted-header-only-20260915.html'), 'utf8'))
    const bundle = exporter().capture(input, 'https://www.zhipin.com/web/geek/jobs', 'JOB_DETAIL')
    expect(bundle.warnings).toContain('MISSING_DESCRIPTION')
    expect(bundle.warnings).toContain('MISSING_COMPANY')
    expect(bundle.html).not.toContain('岗位职责：')
  })
  it.each(['boss', 'zhilian'])('discards arbitrary private text and attributes on %s', platform => {
    const d = doc(`<div class="${platform === 'boss' ? 'job-list-box' : 'job-list-panel'} PRIVATE_CLASS"><div data-token="PRIVATE_TOKEN" title="PRIVATE_TITLE" id="PRIVATE_ID" style="background:url(https://example.invalid/PRIVATE_STYLE)">PRIVATE_FREE_TEXT<a href="https://example.invalid/?key=PRIVATE_URL">PRIVATE_CONTACT</a><span aria-label="PRIVATE_LABEL">PRIVATE_NAME 13800138000 private@example.invalid</span><script>PRIVATE_SCRIPT</script><style>PRIVATE_CSS</style><form><input value="PRIVATE_PASSWORD"></form><div contenteditable>PRIVATE_EDITOR</div><div class="item-myself">PRIVATE_CHAT</div><div class="message-list">PRIVATE_MESSAGE</div><img src="https://example.invalid/PRIVATE_IMAGE"></div></div>`)
    const before = d.body.innerHTML
    Object.defineProperty(d, 'cookie', { get() { throw new Error('Cookie read forbidden') } })
    const bundle = exporter().capture(d, platform === 'boss' ? 'https://www.zhipin.com/web/geek/jobs?token=PRIVATE_QUERY#PRIVATE_HASH' : 'https://www.zhaopin.com/jobs?token=PRIVATE_QUERY', 'SEARCH')
    expect(JSON.stringify(bundle)).not.toMatch(/PRIVATE|13800138000|private@example|https:\/\/example/)
    expect(bundle.html).not.toMatch(/script|input|contenteditable|data-token|background|src=/)
    expect(bundle.provenance.kind).toBe('structural-redacted')
    expect(bundle.reviewRequired).toBe(true)
    expect(d.body.innerHTML).toBe(before)
  })
  it('keeps one identity mapping for repeated list and detail links, stripping query and fragment', () => {
    const d = doc('<div class="job-list-panel"><div class="job-card" data-job-id="SECRETID"><a href="https://www.zhaopin.com/jobdetail/SECRETID.htm?token=SECRET_TOKEN#secret">岗位</a></div></div><div class="job-split-layout__right"><a href="/jobdetail/SECRETID.htm">详情</a></div>')
    const bundle = exporter().capture(d, 'https://www.zhaopin.com/jobs', 'SEARCH')
    const output = doc(bundle.html)
    expect(output.querySelector('.job-card')?.getAttribute('data-job-id')).toBe('fixture001')
    expect([...output.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['https://www.zhaopin.com/jobdetail/fixture001.htm', 'https://www.zhaopin.com/jobdetail/fixture001.htm'])
    expect(JSON.stringify(bundle)).not.toContain('SECRET')
  })
  it('preserves duplicate titles without merging distinct jobs or companies', () => {
    const d = doc('<ul class="job-list-box"><li class="job-card-box" data-jobid="a"><span class="job-name">私人岗位A</span><span class="company-name">私人公司A</span></li><li class="job-card-box" data-jobid="b"><span class="job-name">私人岗位A</span><span class="company-name">私人公司B</span></li></ul>')
    const output = doc(exporter().capture(d, 'https://www.zhipin.com/web/geek/jobs', 'SEARCH').html)
    expect(new Set([...output.querySelectorAll('.job-name')].map(n => n.textContent)).size).toBe(1)
    expect(new Set([...output.querySelectorAll('.company-name')].map(n => n.textContent)).size).toBe(2)
    expect(new Set([...output.querySelectorAll('li')].map(n => n.getAttribute('data-jobid'))).size).toBe(2)
  })
  it('preserves fixed/hidden states and exact supported status labels without retaining unknown text', () => {
    const bundle = exporter().capture(doc('<div class="dialog" style="position:fixed">今日还可沟通9次<button>我知道了</button><div class="modal" style="display:none">投递成功</div><span>PRIVATE_BLOCK</span></div>'), 'https://www.zhipin.com/job_detail/a.html', 'BLOCKER')
    const d = doc(bundle.html)
    expect(bundle.rootCount).toBe(1)
    expect((d.querySelector('.dialog') as HTMLElement).style.position).toBe('fixed')
    expect((d.querySelector('.modal') as HTMLElement).style.display).toBe('none')
    expect(d.body.textContent).toContain('今日还可沟通3次')
    expect(d.body.textContent).not.toContain('PRIVATE')
  })
  it.each(['https://example.invalid', 'http://www.zhipin.com', 'https://zhipin.com.example.invalid', 'https://www.zhipin.com/web/geek/chat'])('refuses unsupported/sensitive page %s', href => {
    expect(() => exporter().capture(doc('<div class="job-list-box">private</div>'), href, 'SEARCH')).toThrow()
  })
  it('never falls back to full body when roots are absent or sample type is invalid', () => {
    expect(() => exporter().capture(doc('<main>PRIVATE_BODY</main>'), 'https://www.zhipin.com/', 'SEARCH')).toThrow(/白名单/)
    expect(() => exporter().capture(doc(''), 'https://www.zhipin.com/', 'CHAT')).toThrow()
  })
  it('fails without a partial export when traversal exceeds its limit', () => {
    const d = doc(`<ul class="job-list-box">${'<li>x</li>'.repeat(2600)}</ul>`)
    expect(() => exporter().capture(d, 'https://www.zhipin.com/', 'SEARCH')).toThrow(/结构过大/)
  })
  it.each(['boss', 'zhilian'])('replays redacted %s detail through the real parser without source data', platform => {
    const file = platform === 'boss' ? 'boss/detail/full.html' : 'zhilian/detail/split.html'
    const input = doc(readFileSync(resolve(root, 'tests/fixtures', file), 'utf8'))
    const href = platform === 'boss' ? 'https://www.zhipin.com/job_detail/a.html' : 'https://www.zhaopin.com/jobs'
    const redacted = doc(exporter().capture(input, href, 'JOB_DETAIL').html)
    const scope: Record<string, any> = {}
    const files = platform === 'boss' ? ['boss-selectors.js', 'boss-detail-collector.js'] : ['zhilian-scan-support.js', 'zhilian-modern-collector.js']
    for (const file of files) runInNewContext(source(file), { window: scope, URL })
    const result = platform === 'boss' ? scope.GetJobsBossDetailCollector.parseDetail(redacted, {}, scope.GetJobsBossSelectors.DETAIL_FIELD_SELECTORS, href)
      : scope.GetJobsZhilianModernCollector.readDetail(redacted, redacted.querySelector('.job-card'), 'fixture001')
    expect(result).toMatchObject({ title: '示例产品运营001', company: '示例科技公司001' })
    expect(result.description).toContain('岗位职责：负责示例产品')
    expect(result.description).not.toContain('公司介绍')
  })
})

function popup(url = 'https://www.zhipin.com/web/geek/jobs') {
  const d = doc(source('fixture-popup.html'))
  const blob = vi.fn(() => 'blob:synthetic'), click = vi.fn()
  const originalCreate = d.createElement.bind(d)
  vi.spyOn(d, 'createElement').mockImplementation(((tag: string) => {
    const element = originalCreate(tag)
    if (tag === 'a') element.click = click
    return element
  }) as typeof d.createElement)
  const bundle = { html: '<div>脱敏文本</div>', platform: 'boss', pageType: 'SEARCH', rootCount: 1 }
  const query = vi.fn(async () => [{ id: 1, url }])
  const executeScript = vi.fn(async () => [{ result: { ok: true, bundle } }])
  const scope = { document: d, chrome: { tabs: { query }, scripting: { executeScript } }, URL: Object.assign(class extends URL {}, { createObjectURL: blob, revokeObjectURL: vi.fn() }), Blob, setTimeout: (fn: () => void) => fn(), window: {} }
  runInNewContext(source('fixture-export.js'), scope)
  runInNewContext(source('fixture-popup.js'), scope)
  const button = (id: string) => d.getElementById(id) as HTMLButtonElement
  return { d, query, executeScript, blob, click, button }
}
describe('fixture popup confirmation boundary', () => {
  it('shows a safe, specific root-missing diagnostic without leaking page error text', async () => {
    const h = popup()
    h.executeScript.mockResolvedValueOnce([] as any).mockResolvedValueOnce([{ result: { ok: false, errorCode: 'NO_STRUCTURE', message: 'PRIVATE_ERROR_URL' } }] as any)
    h.button('capture').click()
    await vi.waitFor(() => expect(h.button('capture').disabled).toBe(false))
    expect(h.d.getElementById('status')?.textContent).toContain('未找到')
    expect(h.d.getElementById('status')?.textContent).not.toContain('PRIVATE')
    expect(h.button('download').disabled).toBe(true)
  })
  it('keeps partial samples review-gated and displays missing-JD warning', async () => {
    const h = popup()
    h.executeScript.mockResolvedValueOnce([] as any).mockResolvedValueOnce([{ result: { ok: true, bundle: { platform: 'boss', pageType: 'SEARCH', html: '<div></div>', rootCount: 1, warnings: ['MISSING_DESCRIPTION'] } } }] as any)
    h.button('capture').click()
    await vi.waitFor(() => expect(h.button('reviewed').disabled).toBe(false))
    expect(h.d.getElementById('status')?.textContent).toContain('缺少职位描述')
    expect(h.button('download').disabled).toBe(true)
  })
  it('does nothing on open; capture previews and explicit review gates download', async () => {
    const h = popup()
    expect(h.query).not.toHaveBeenCalled()
    expect(h.executeScript).not.toHaveBeenCalled()
    h.button('download').click(); expect(h.blob).not.toHaveBeenCalled()
    h.button('capture').click()
    await vi.waitFor(() => expect(h.button('reviewed').disabled).toBe(false))
    expect(h.executeScript).toHaveBeenCalledTimes(2)
    expect(h.blob).not.toHaveBeenCalled()
    expect(h.button('download').disabled).toBe(true)
    const reviewed = h.d.getElementById('reviewed') as HTMLInputElement
    reviewed.checked = true; reviewed.dispatchEvent(new Event('change'))
    h.button('download').click()
    expect(h.blob).toHaveBeenCalledTimes(1); expect(h.click).toHaveBeenCalledTimes(1)
    h.button('clear').click()
    expect(h.button('download').disabled).toBe(true)
    expect((h.d.getElementById('preview') as HTMLTextAreaElement).value).toBe('')
  })
  it('does not inject into unsupported domains', async () => {
    const h = popup('https://example.invalid'); h.button('capture').click()
    await vi.waitFor(() => expect(h.button('capture').disabled).toBe(false))
    expect(h.executeScript).not.toHaveBeenCalled(); expect(h.blob).not.toHaveBeenCalled()
  })
  it('clearing an in-flight capture cannot restore an old preview or confirmation', async () => {
    const h = popup(); let release!: (value: unknown[]) => void
    h.executeScript.mockImplementationOnce(() => new Promise(resolve => { release = resolve as typeof release }))
    h.button('capture').click()
    await vi.waitFor(() => expect(h.executeScript).toHaveBeenCalledTimes(1))
    h.button('clear').click(); release([])
    await vi.waitFor(() => expect(h.button('capture').disabled).toBe(false))
    expect(h.executeScript).toHaveBeenCalledTimes(1)
    expect(h.button('reviewed').disabled).toBe(true)
    expect((h.d.getElementById('preview') as HTMLTextAreaElement).value).toBe('')
  })
})
