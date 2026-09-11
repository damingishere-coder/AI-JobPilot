import { afterEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_BACKGROUND_VERSION, sendChromeBridgeMessage } from './chromeBridge'

afterEach(() => vi.unstubAllGlobals())

function bridge(version: string, success = true) {
  const requests: string[] = []
  const listeners = new Set<(event: unknown) => void>()
  const fakeWindow = {
    location: { origin: 'http://127.0.0.1:6866' },
    setTimeout, clearTimeout,
    addEventListener: (_: string, handler: (event: unknown) => void) => listeners.add(handler),
    removeEventListener: (_: string, handler: (event: unknown) => void) => listeners.delete(handler),
    postMessage(message: { type: string; requestId: string }) {
      requests.push(message.type)
      queueMicrotask(() => listeners.forEach(handler => handler({
        source: fakeWindow, origin: fakeWindow.location.origin,
        data: { source: 'GET_JOBS_EXTENSION', requestId: message.requestId,
          response: message.type === 'GET_JOBS_EXTENSION_PING'
            ? { success, version, message: success ? '' : '扩展未连接' } : { success: true } },
      })))
    },
  }
  vi.stubGlobal('window', fakeWindow)
  return requests
}

describe('scan extension compatibility', () => {
  for (const type of ['BOSS_SCAN_START', 'ZHILIAN_SCAN_START']) {
    it(`${type} blocks old backgrounds before starting a scan`, async () => {
      const requests = bridge('2026-09-09-detail-scan')
      const response = await sendChromeBridgeMessage({ type, profileId: 4 })
      expect(response.success).toBe(false)
      expect(response.errorCode).toBe('EXTENSION_RELOAD_REQUIRED')
      expect(response.message).toContain('chrome://extensions')
      expect(response.message).toContain('2026-09-09-detail-scan')
      expect(requests).toEqual(['GET_JOBS_EXTENSION_PING'])
    })

    it(`${type} starts with a compatible reloaded extension`, async () => {
      const requests = bridge(REQUIRED_BACKGROUND_VERSION)
      expect((await sendChromeBridgeMessage({ type, profileId: 4 })).success).toBe(true)
      expect(requests).toEqual(['GET_JOBS_EXTENSION_PING', type])
    })
  }

  it('does not block stop requests behind an upgrade', async () => {
    const requests = bridge('old-version')
    expect((await sendChromeBridgeMessage({ type: 'BOSS_SCAN_STOP', profileId: 4 })).success).toBe(true)
    expect(requests).toEqual(['BOSS_SCAN_STOP'])
  })

  it('does not send scan requests through a disconnected bridge', async () => {
    const requests = bridge('', false)
    expect((await sendChromeBridgeMessage({ type: 'ZHILIAN_SCAN_START' })).success).toBe(false)
    expect(requests).toEqual(['GET_JOBS_EXTENSION_PING'])
  })
})
