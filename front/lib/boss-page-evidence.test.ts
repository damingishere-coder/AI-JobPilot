import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const root = resolve(process.cwd(), '../chrome-extension')
function harness(html: string, href = 'https://www.zhipin.com/job_detail/fixture001.html') {
  const doc = document.implementation.createHTMLDocument('synthetic')
  doc.body.innerHTML = html
  Object.defineProperty(doc, 'readyState', { value: 'complete' })
  const scope: Record<string, any> = {}
  for (const f of ['boss-scan-support.js', 'boss-page-evidence.js']) runInNewContext(readFileSync(resolve(root, f), 'utf8'), { window: scope, URL })
  // Layout is supplied only as a prerequisite; real layout belongs to browser regression.
  const visible = (node: Element) => !node.closest('[hidden],[style*="display:none"],[style*="display: none"]')
  const observe = () => scope.GetJobsBossPageEvidence.observe({ document: doc, href, support: scope.GetJobsBossScanSupport, visible })
  return { doc, api: scope.GetJobsBossPageEvidence, observe }
}
it('does not promote a chat surface or existing contact into a new application', () => {
  const { api } = harness('')
  expect(api.evaluateEvidence({ beforeCount: 0, afterCount: 0 })).toMatchObject({ outcome: 'UNKNOWN' })
  expect(api.evaluateEvidence({ alreadyContacted: true, actionStarted: false })).toMatchObject({ outcome: 'CONFIRMED', effect: 'ALREADY_CONTACTED', newApplication: false })
  expect(api.evaluateEvidence({ alreadyContacted: true, actionStarted: true })).toMatchObject({ outcome: 'UNKNOWN' })
  expect(api.evaluateEvidence({ beforeCount: 1, afterCount: 1 })).toMatchObject({ outcome: 'UNKNOWN' })
  expect(api.evaluateEvidence({ beforeCount: 1, afterCount: 2 })).toMatchObject({ outcome: 'CONFIRMED', effect: 'GREETING_SENT', newApplication: true })
})
it('keeps verification and login ahead of success evidence', () => {
  const { api, observe } = harness('<div class="job-banner">岗位</div><div role="dialog">请完成安全验证</div><button>继续沟通</button>')
  const state = observe()
  expect(state).toMatchObject({ pageType: 'JOB_DETAIL', blocker: 'VERIFICATION_REQUIRED', jobKey: 'fixture001' })
  expect(api.evaluateEvidence({ beforeCount: 0, afterCount: 1, state })).toMatchObject({ outcome: 'UNKNOWN' })
  expect(harness('<div class="login-dialog">请先登录</div>').observe().blocker).toBe('LOGIN_REQUIRED')
})
it('separates fixed positive-quota reminders, exhaustion and hidden dialogs', () => {
  const h = harness('<div class="dialog-wrap" style="position:fixed"><div class="dialog-title"><h3>温馨提示</h3></div><div class="dialog-con">您今天已与120位BOSS沟通，还剩30次沟通机会哦</div></div>')
  expect(h.observe()).toMatchObject({ blocker: 'NONE', platformState: 'QUOTA_REMINDER' })
  h.doc.querySelector('.dialog-con')!.textContent = '您今天已与150位BOSS沟通，还剩0次沟通机会哦'
  expect(h.observe().blocker).toBe('QUOTA_LIMIT')
  h.doc.querySelector('.dialog-wrap')!.setAttribute('style', 'display:none')
  expect(h.observe().blocker).toBe('NONE')
})
it('uses external structure fixtures without recording body, URL queries or messages', () => {
  const html = readFileSync(resolve(root, 'tests/fixtures/boss/detail/full.html'), 'utf8')
  const state = harness(html, 'https://www.zhipin.com/job_detail/fixture001.html?token=SECRET').observe()
  expect(state).toMatchObject({ pageType: 'JOB_DETAIL', blocker: 'NONE', version: 'boss-page-evidence/1' })
  expect(JSON.stringify(state)).not.toMatch(/SECRET|岗位职责|示例科技公司/)
  expect(harness('<p>微信扫码分享</p><div class="job-banner">普通职位</div>').observe().blocker).toBe('NONE')
})
