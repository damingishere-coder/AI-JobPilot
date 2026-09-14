import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const extension = resolve(process.cwd(), '../chrome-extension')
const fixtureRoot = resolve(extension, 'tests/fixtures')
type Fixture = { id: string; platform: string; file: string; provenance: { kind: string; reference: string; capturedAt: string | null }; expected: { jobs?: Record<string, unknown>[]; candidateCount?: number; detail?: Record<string, unknown>; rejectedExpectedId?: string; cardCount?: number; marker?: string } }
const fixtures: Fixture[] = JSON.parse(readFileSync(resolve(fixtureRoot, 'catalog.json'), 'utf8'))
function load(fixture: Fixture) {
  const doc = document.implementation.createHTMLDocument('offline fixture')
  doc.body.innerHTML = readFileSync(resolve(fixtureRoot, fixture.file), 'utf8')
  const scope: Record<string, any> = { location: { href: 'https://www.zhipin.com/job_detail/fixture001.html', origin: 'https://www.zhipin.com' }, getComputedStyle: (node: Element) => window.getComputedStyle(node) } // eslint-disable-line @typescript-eslint/no-explicit-any
  const files = fixture.platform === 'boss'
    ? ['boss-selectors.js', 'boss-scan-support.js', 'boss-search-collector.js', 'boss-detail-collector.js']
    : ['zhilian-scan-support.js', 'zhilian-modern-collector.js']
  for (const file of files) runInNewContext(readFileSync(resolve(extension, file), 'utf8'), { window: scope, document: doc, URL, URLSearchParams })
  // Only supplies the existing collector's visibility prerequisite. This is not a layout assertion.
  for (const node of doc.querySelectorAll('.job-card-box')) Object.defineProperty(node, 'offsetParent', { value: doc.body })
  return { doc, scope }
}
describe('versioned recruitment fixture baseline', () => {
  it('has unique identities and honest provenance', () => {
    expect(new Set(fixtures.map(f => f.id)).size).toBe(fixtures.length)
    for (const f of fixtures) {
      expect(f.provenance.kind).toBe('synthetic')
      expect(f.provenance.capturedAt).toBeNull()
      expect(f.provenance.reference).toBeTruthy()
      expect(f.file).toBe(`${f.id}.html`)
    }
  })
  it.each(fixtures)('$id', fixture => {
    const { doc, scope } = load(fixture), expected = fixture.expected
    if (expected.jobs) {
      const result = scope.GetJobsBossSearchCollector.collectVisibleJobs({ keyword: '运营' })
      expect(result.candidateCount).toBe(expected.candidateCount)
      expect(result.jobs).toHaveLength(expected.jobs.length)
      expected.jobs.forEach((job, index) => expect(result.jobs[index]).toMatchObject(job))
    }
    if (expected.detail) {
      const result = fixture.platform === 'boss' ? scope.GetJobsBossDetailCollector.collectCurrentDetail()
        : scope.GetJobsZhilianModernCollector.readDetail(doc, doc.querySelector('.job-card'), 'CC100J200')
      expect(result).toMatchObject(expected.detail)
    }
    if (expected.rejectedExpectedId) expect(scope.GetJobsZhilianModernCollector.readDetail(doc, doc.querySelector('.job-card'), expected.rejectedExpectedId)).toBeNull()
    if (expected.cardCount !== undefined) expect(doc.querySelectorAll('.job-card')).toHaveLength(expected.cardCount)
    if (expected.marker) expect(doc.body.textContent).toContain(expected.marker)
  })
})
