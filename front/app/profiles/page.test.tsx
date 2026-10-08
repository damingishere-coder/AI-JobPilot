import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ProfilesPage from './page'

vi.mock('@/app/components/ProfileSwitcher', () => ({ default: ({ onProfileChange, management }: { onProfileChange: (profile: { id: number; name: string }) => void; management?: boolean }) => <button onClick={() => onProfileChange({ id: 1, name: '合成人物' })}>{management ? '管理人物档案' : '读取人物档案'}</button> }))
afterEach(() => vi.unstubAllGlobals())

it('manages profiles in one place and preserves resume edits while switching task sections', async () => {
  const writes: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method) writes.push(init)
    const data = url.includes('/api/boss/config') ? { config: { enableAi: 0, sayHi: '合成话术' } } : { data: url.includes('/resume') ? { resumeText: '合成简历' } : url.includes('/priority') ? [] : { introduce: '', prompt: '' } }
    return new Response(JSON.stringify(url.endsWith('/ready') ? { ready: true, status: 'UP' } : { success: true, hasProfile: true, currentProfile: { id: 1, name: '合成人物' }, ...data }), { headers: { 'Content-Type': 'application/json' } })
  }))
  render(<ProfilesPage />)
  fireEvent.click(await screen.findByRole('button', { name: '管理人物档案' }))
  fireEvent.change(await screen.findByDisplayValue('合成简历'), { target: { value: '尚未保存的简历修改' } })
  fireEvent.click(screen.getByRole('tab', { name: '投递话术' }))
  expect(screen.getByRole('tab', { name: '投递话术' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('tab', { name: '简历资料' }))
  expect(screen.getByLabelText('简历文本')).toHaveValue('尚未保存的简历修改')
  expect(writes).toHaveLength(0)
})
