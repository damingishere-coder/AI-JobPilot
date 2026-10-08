'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Search, BriefcaseBusiness, MessagesSquare, CalendarDays, ChartNoAxesCombined, UserRound, Settings, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'

const primary = [
  { href: '/', label: '工作台', icon: LayoutDashboard },
  { href: '/discover', label: '岗位发现', icon: Search },
  { href: '/opportunities', label: '求职机会', icon: BriefcaseBusiness },
  { href: '/hr', label: 'HR 沟通', icon: MessagesSquare },
  { href: '/interviews', label: '面试', icon: CalendarDays },
  { href: '/strategy', label: '策略复盘', icon: ChartNoAxesCombined },
]
const secondary = [
  { href: '/profiles', label: '求职资料', icon: UserRound },
  { href: '/settings', label: '设置', icon: Settings },
]
export function activeWorkspace(pathname: string) {
  if (/^\/(boss|zhilian|liepin|51job)(\/|$)/.test(pathname)) return '/discover'
  if (pathname === '/ai-config') return '/profiles'
  if (pathname === '/env-config') return '/settings'
  if (pathname === '/strategy/ranking') return '/opportunities'
  return [...primary, ...secondary].find(item => item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`)))?.href || '/'
}
export default function Sidebar({ open = false, mobile = false, collapsed = false, onClose, onToggle }: { open?: boolean; mobile?: boolean; collapsed?: boolean; onClose?: () => void; onToggle?: () => void }) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open || !mobile) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLButtonElement>('.workspace-mobile-close')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button, summary') || [])].filter(item => item.getClientRects().length > 0)
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', trap); previous?.focus() }
  }, [open, mobile])
  const active = activeWorkspace(usePathname())
  const links = (items: typeof primary) => items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onClose} className={`workspace-nav-link ${active === href ? 'is-active' : ''}`} aria-current={active === href ? 'page' : undefined} title={label}>
    <Icon aria-hidden="true" size={19} /><span className="workspace-nav-label">{label}</span>
  </Link>)
  return <>
    {open && <button className="workspace-sidebar-backdrop" aria-label="关闭导航" onClick={onClose} />}
    <aside ref={panel} className={`workspace-sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`} aria-label="主导航" inert={mobile && !open ? true : undefined} role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open ? true : undefined}>
      <Link href="/" className="workspace-brand" aria-label="投递牛马工作台" onClick={onClose}><Image src="/toudi-niuma.svg" alt="" width={36} height={36} priority /><span className="workspace-nav-label"><strong>投递牛马</strong><small>让求职有条理</small></span></Link>
      <button type="button" className="workspace-mobile-close" onClick={onClose} aria-label="收起导航"><X size={20} /></button>
      <nav className="workspace-navigation">{links(primary)}</nav>
      <div className="workspace-sidebar-bottom">
        <nav aria-label="资料与设置">{links(secondary)}</nav>
        <details className="workspace-experiments workspace-nav-label"><summary>实验工具</summary><Link href="/liepin" onClick={onClose}>猎聘 · 只读采集</Link><Link href="/51job" onClick={onClose}>51job · 只读采集</Link></details>
        <button type="button" className="workspace-collapse" onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span className="workspace-nav-label">收起侧栏</span></button>
        <span className="workspace-version workspace-nav-label">本地求职工作台 · v1.5.0</span>
      </div>
    </aside>
  </>
}
