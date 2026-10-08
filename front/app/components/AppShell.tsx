'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Menu, Moon, Sun, CircleHelp } from 'lucide-react'
import { useTheme } from 'next-themes'
import { MotionConfig } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { API_BASE } from '@/lib/api'
import { getChromeBridgeStatus } from '@/lib/chromeBridge'
import { confirmNavigation, rememberNavigation } from '@/lib/use-unsaved-changes'
import { useProfileScope } from './ProfileScope'
import ProfileSwitcher from './ProfileSwitcher'
import Sidebar from './Sidebar'
import ContentArea from './ContentArea'

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [backend, setBackend] = useState('检查中')
  const [extension, setExtension] = useState('检查中')
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()
  const scope = useProfileScope()
  const [scopeResolved, setScopeResolved] = useState(!scope || !scope.loading)
  const pathname = usePathname()
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { if (!scope?.loading) setScopeResolved(true) }, [scope?.loading])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1279px)')
    const mobileMedia = window.matchMedia('(max-width: 767px)')
    const resize = () => { setCollapsed(media.matches); setMobile(window.innerWidth < 768) }
    resize(); media.addEventListener('change', resize); mobileMedia.addEventListener('change', resize)
    return () => { media.removeEventListener('change', resize); mobileMedia.removeEventListener('change', resize) }
  }, [])
  useEffect(() => { rememberNavigation(); setOpen(false) }, [pathname])
  useEffect(() => {
    let disposed = false, busy = false
    let controller: AbortController | null = null
    async function check() {
      if (busy) return
      busy = true
      const attempt = new AbortController(); controller = attempt
      const timeout = window.setTimeout(() => attempt.abort(), 6000)
      try { await Promise.all([
        (async () => {
          try {
            const response = await fetch(`${API_BASE}/api/ready`, { signal: attempt.signal, cache: 'no-store' })
            const value = await response.json()
            if (!disposed) setBackend(response.ok && value.ready ? '正常' : '需检查')
          } catch { if (!disposed) setBackend('未连接') }
          finally { window.clearTimeout(timeout) }
        })(),
        (async () => {
          try {
            const value = await getChromeBridgeStatus()
            if (!disposed) setExtension(value.success ? '已连接' : '未连接')
          } catch { if (!disposed) setExtension('未连接') }
        })(),
      ]) } finally { busy = false }
    }
    void check()
    const interval = setInterval(() => { if (!document.hidden) void check() }, 30000)
    return () => { disposed = true; controller?.abort(); clearInterval(interval) }
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  return <MotionConfig reducedMotion="user"><div className={`workspace-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="workspace-skip-link" href="#workspace-content">跳到主要内容</a>
    <Sidebar open={open} mobile={mobile} collapsed={collapsed} onClose={() => setOpen(false)} onToggle={() => setCollapsed(value => !value)} />
    <div className="workspace-body" inert={mobile && open ? true : undefined}>
      <header className="workspace-topbar">
        <button type="button" className="workspace-menu-button" aria-label="打开导航" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={20} /></button>
        <ProfileSwitcher compact presentation="global" />
        <div className="workspace-system-status" aria-label="系统连接状态"><span data-ok={backend === '正常'}>后端：{backend}</span><span data-ok={extension === '已连接'}>扩展：{extension}</span></div>
        <Link className="workspace-icon-button" href="/settings" aria-label="连接与使用帮助" title="连接与使用帮助"><CircleHelp size={18} /></Link>
        <button type="button" className="workspace-icon-button" aria-label={mounted && theme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{mounted && theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </header>
      {scope?.error && <div role="alert" className="workspace-global-alert">{scope.error}{scope.conflicted && <><p>已暂停本页编辑和保存，避免将草稿写入其他档案。</p><button type="button" className="mt-2 rounded border border-current px-3 py-2" onClick={() => { if (confirmNavigation()) void scope.refresh(true).catch(() => {}) }}>放弃草稿并读取当前档案</button></>}</div>}
      {scope?.switching && <p role="status" className="workspace-global-alert">正在切换档案，暂时暂停页面编辑…</p>}
      {!scopeResolved ? <p role="status" className="workspace-global-alert">正在读取当前档案，稍后即可编辑…</p> : <div inert={scope?.conflicted || scope?.switching ? true : undefined} aria-hidden={scope?.conflicted ? true : undefined}><ContentArea key={`${pathname}:${scope?.current?.id || 'none'}`}>{children}</ContentArea></div>}
    </div>
  </div></MotionConfig>
}
