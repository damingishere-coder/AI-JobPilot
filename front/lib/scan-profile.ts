export function normalizeScanProfileId(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function scanEventMatchesProfile(
  payload: Record<string, unknown> | null | undefined,
  currentProfileId: unknown,
  requireTaggedEvent = false,
): boolean {
  const current = normalizeScanProfileId(currentProfileId)
  if (!current || !payload) return false
  const eventProfile = normalizeScanProfileId(payload.profileId)
  if (!eventProfile) return !requireTaggedEvent
  return eventProfile === current
}
