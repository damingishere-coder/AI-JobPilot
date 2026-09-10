import { describe, expect, it } from 'vitest'
import { normalizeScanProfileId, scanEventMatchesProfile } from './scan-profile'

describe('scan profile binding', () => {
  it('normalizes only positive integer profile ids', () => {
    expect(normalizeScanProfileId('4')).toBe(4)
    expect(normalizeScanProfileId(0)).toBeNull()
    expect(normalizeScanProfileId('invalid')).toBeNull()
  })

  it('rejects events from another profile and untagged extension events', () => {
    expect(scanEventMatchesProfile({ profileId: 4 }, 4, true)).toBe(true)
    expect(scanEventMatchesProfile({ profileId: 2 }, 4, true)).toBe(false)
    expect(scanEventMatchesProfile({}, 4, true)).toBe(false)
  })

  it('allows untagged non-scan events when explicitly requested', () => {
    expect(scanEventMatchesProfile({}, 4)).toBe(true)
  })
})
