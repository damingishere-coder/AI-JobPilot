"use client"
import { ReactNode } from 'react'
import { motion } from 'framer-motion'

export default function PageHeader({
  icon,
  title,
  subtitle,
  iconClass = 'text-primary',
  accentBgClass = 'bg-primary/10 dark:bg-primary/20',
  actions,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  iconClass?: string
  accentBgClass?: string
  actions?: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mb-5"
    >
      <div className="flex min-h-[104px] items-center gap-5 rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_42px_rgba(15,23,42,0.055)] backdrop-blur-xl dark:border-white/10 dark:bg-blacksection/70 dark:shadow-none">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${accentBgClass} shadow-[0_12px_24px_rgba(37,99,235,0.12)]`}
        >
          <span className={`${iconClass} text-2xl`}>{icon}</span>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="flex-1"
        >
          <h1 className="text-2xl font-bold tracking-normal text-slate-950 dark:text-white">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 text-sm text-slate-500 dark:text-manatee">
              {subtitle}
            </p>
          )}
        </motion.div>
        {actions && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.3 }}
            className="ml-auto flex flex-wrap items-center justify-end gap-2"
          >
            {actions}
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
