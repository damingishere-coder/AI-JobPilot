import { afterEach, expect, it, vi } from 'vitest'
import { localActionFetch } from './api'
import { registerScan, ScanRequestError, scanStartFailed, scanStartIsUnconfirmed, verifyScanStart } from './scan-runs'

vi.mock('./api', () => ({ API_BASE: '', localActionFetch: vi.fn() }))
afterEach(() => vi.clearAllMocks())

it('preserves the real business code when the backend uses REQUEST_REJECTED', async () => {
  vi.mocked(localActionFetch).mockResolvedValue(new Response(JSON.stringify({errorCode:'REQUEST_REJECTED',message:'PLATFORM_SCAN_ALREADY_ACTIVE'}), {status:409}))
  const failure = await registerScan('zhilian',4,'new-run').catch(e => e)
  expect(failure).toBeInstanceOf(ScanRequestError)
  expect(failure).toMatchObject({code:'PLATFORM_SCAN_ALREADY_ACTIVE',status:409,serverMessage:'PLATFORM_SCAN_ALREADY_ACTIVE'})
  expect(failure.message).toContain('已有任务')
})

it('requires an accepted receipt matching run, profile and executor', () => {
  const receipt = {success:true,startAccepted:true,runId:'boss-test',profileId:4,scanOwnerToken:'owner-test'}
  expect(verifyScanStart(receipt,'boss-test',4).success).toBe(true)
  for (const invalid of [{...receipt,runId:'boss-other'},{...receipt,profileId:3},{...receipt,scanOwnerToken:''},{success:true}]) {
    expect(verifyScanStart(invalid,'boss-test',4)).toMatchObject({success:false,errorCode:'SCAN_START_UNCONFIRMED',startUnconfirmed:true})
  }
})

it('new and missing error codes remain uncertain unless no dispatch is explicitly confirmed', () => {
  expect(scanStartIsUnconfirmed({success:false,errorCode:'NEW_ERROR'})).toBe(true)
  expect(scanStartIsUnconfirmed({success:false})).toBe(true)
  expect(scanStartIsUnconfirmed({success:false,errorCode:'CONTENT_SCRIPT_NOT_READY',startNotDispatched:true})).toBe(false)
})

it('records uncertain starts as BLOCKED and confirmed rejection as FAILED with detail', async () => {
  vi.mocked(localActionFetch).mockImplementation(async () => new Response('{}'))
  await scanStartFailed('boss',4,'boss-test','BRIDGE_EMPTY_RESPONSE',true,'empty response')
  await scanStartFailed('boss',4,'boss-test','CONTENT_SCRIPT_NOT_READY',false,'page not ready')
  const events = vi.mocked(localActionFetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)).events[0])
  expect(events[0]).toMatchObject({state:'BLOCKED',errorCode:'BRIDGE_EMPTY_RESPONSE',message:'empty response'})
  expect(events[1]).toMatchObject({state:'FAILED',errorCode:'CONTENT_SCRIPT_NOT_READY',message:'page not ready'})
})
