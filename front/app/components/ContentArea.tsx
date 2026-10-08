'use client'
import type { ReactNode } from 'react'
export default function ContentArea({ children }: { children: ReactNode }) {
  return <main id="workspace-content" tabIndex={-1} className="workspace-content">{children}</main>
}
