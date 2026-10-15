import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OpportunitiesPage from './page'
import { opportunityApi } from '@/lib/opportunities'

vi.mock('@/lib/opportunities', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/opportunities')>(), opportunityApi: vi.fn() }))
vi.mock('@/app/components/ProfileSwitcher', async () => {
  const { useEffect } = await import('react')
  return { default: function FixtureProfile({ onProfileChange }: { onProfileChange: (p: { id: number }) => void }) {
    useEffect(() => onProfileChange({ id: 1 }), [onProfileChange]); return null
  } }
})
vi.mock('next/navigation', async () => {
  const { useEffect, useState } = await import('react')
  return { useSearchParams: function useFixtureSearchParams() {
    const [query, setQuery] = useState(window.location.search)
    useEffect(() => { const change = () => setQuery(window.location.search); window.addEventListener('popstate', change); return () => window.removeEventListener('popstate', change) }, [])
    return new URLSearchParams(query)
  } }
})
beforeEach(() => {
  window.history.replaceState(null, '', '/opportunities?bucket=UNKNOWN&page=2')
  const original = window.history.pushState.bind(window.history)
  vi.spyOn(window.history, 'pushState').mockImplementation((...args) => { original(...args); window.dispatchEvent(new PopStateEvent('popstate')) })
  vi.mocked(opportunityApi).mockResolvedValue({ items: [], total: 35, scopeLabel: '结果未知待对账' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks() })
it('loads the linked bucket and preserves its scope while paging and reloading', async () => {
  const first = render(<OpportunitiesPage />)
  await screen.findByText(/结果未知待对账 · 35/)
  expect(opportunityApi).toHaveBeenCalledWith(expect.stringContaining('page=2&bucket=UNKNOWN'), undefined, expect.any(AbortSignal))
  fireEvent.click(screen.getByText('上一页'))
  await waitFor(() => expect(opportunityApi).toHaveBeenCalledWith(expect.stringContaining('page=1&bucket=UNKNOWN'), undefined, expect.any(AbortSignal)))
  first.unmount(); render(<OpportunitiesPage />)
  await screen.findByText('第 1 页')
  expect(window.location.search).toContain('bucket=UNKNOWN')
})
it('clears the workbench bucket when switching to the archive view', async () => {
  render(<OpportunitiesPage />)
  await screen.findByText(/结果未知待对账 · 35/)
  fireEvent.click(screen.getByText('已归档'))
  await waitFor(() => expect(window.location.search).toContain('archived=true'))
  expect(window.location.search).not.toContain('bucket=')
  expect(window.location.search).not.toContain('page=2')
})
