export function rememberZhilianRun(profileId: number, runId: string) {
  try { sessionStorage.setItem(`zhilian:last-run:${profileId}`, runId) } catch { /* Storage may be disabled. */ }
}

export function lastZhilianRun(profileId: number): string {
  try { return sessionStorage.getItem(`zhilian:last-run:${profileId}`) || '' } catch { return '' }
}
