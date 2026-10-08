'use client'
import type { ReactNode } from 'react'
export default function PageHeader({ icon, title, subtitle, actions, headingLevel = 1 }: { icon: ReactNode; title: string; subtitle?: string; iconClass?: string; accentBgClass?: string; actions?: ReactNode; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h1'
  return <header className={`workspace-page-header ${headingLevel === 2 ? 'workspace-section-header' : ''}`}><div className="workspace-page-heading"><span className="workspace-page-icon" aria-hidden="true">{icon}</span><div><Heading>{title}</Heading>{subtitle && <p>{subtitle}</p>}</div></div>{actions && <div className="workspace-page-actions">{actions}</div>}</header>
}
