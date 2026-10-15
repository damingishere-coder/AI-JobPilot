"use client"
import { usePathname } from 'next/navigation'
import { ReactNode, useMemo } from 'react'
import { motion } from 'framer-motion'

export default function ContentArea({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  const accentClass = useMemo(() => {
    switch (pathname) {
      case '/boss':
      case '/boss/analysis':
        return 'accent-teal'
      case '/liepin':
      case '/liepin/analysis':
        return 'accent-orange'
      case '/51job':
      case '/51job/analysis':
        return 'accent-amber'
      case '/zhilian':
      case '/zhilian/analysis':
        return 'accent-sky'
      default:
        return ''
    }
  }, [pathname])

  return (
    <main className={`ml-64 min-h-screen w-[calc(100%_-_16rem)] min-w-0 overflow-x-hidden border-l border-slate-200/70 bg-background dark:border-white/10 dark:bg-blacksection content-bg ${accentClass}`}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="w-full min-w-0 max-w-none px-6 py-6"
      >
        {children}
      </motion.div>
    </main>
  )
}
