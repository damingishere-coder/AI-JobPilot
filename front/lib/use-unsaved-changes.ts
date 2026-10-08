'use client'

import { useEffect, useId } from 'react'

const dirtySections = new Map<string, string>()
let installed = false
let acceptedUrl = ''
let acceptedState: unknown = null

export function hasUnsavedChanges() { return dirtySections.size > 0 }

export function confirmNavigation() {
  if (!hasUnsavedChanges()) return true
  return window.confirm('有尚未保存的修改。离开或切换后这些修改会丢失，确定继续吗？')
}

export function rememberNavigation() {
  if (typeof window === 'undefined') return
  acceptedUrl = window.location.href
  acceptedState = window.history.state
}

function installGuards() {
  if (installed || typeof window === 'undefined') return
  installed = true
  rememberNavigation()
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return
    event.preventDefault()
    event.returnValue = ''
  })
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
    const target = new URL(anchor.href, window.location.href)
    if (target.origin !== window.location.origin || target.href === window.location.href || (target.pathname === window.location.pathname && target.search === window.location.search)) return
    if (!confirmNavigation()) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
  window.addEventListener('popstate', event => {
    if (window.location.href === acceptedUrl) return
    if (!confirmNavigation()) {
      event.stopImmediatePropagation()
      window.history.pushState(acceptedState, '', acceptedUrl)
    } else rememberNavigation()
  }, true)
}

/** Drafts remain in the owning component; this registry only protects navigation. */
export function useUnsavedChanges(section: string, dirty: boolean) {
  const instance = useId()
  useEffect(() => {
    installGuards()
    const key = `${section}:${instance}`
    if (dirty) dirtySections.set(key, section)
    else dirtySections.delete(key)
    return () => { dirtySections.delete(key) }
  }, [section, instance, dirty])
  useEffect(() => { rememberNavigation() })
}
