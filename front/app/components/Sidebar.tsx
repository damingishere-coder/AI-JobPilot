'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BiEnvelope, BiBriefcase, BiSearch, BiTask, BiUserCircle, BiBrain, BiMoon, BiSun, BiChevronDown } from 'react-icons/bi'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'

export default function Sidebar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // 健康检查状态：up / degraded / down / unknown
  const [health, setHealth] = useState<'up' | 'degraded' | 'down' | 'unknown'>('unknown')
  const checkingRef = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    const check = async () => {
      if (checkingRef.current) return
      checkingRef.current = true
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:8888'

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        // 先尝试自定义健康接口
        let res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal })
        if (res.status === 404) {
          // 回退到 Spring Boot Actuator
          res = await fetch(`${baseUrl}/actuator/health`, { signal: controller.signal })
        }
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = await res.json()
        const statusRaw = (data.status || data.state || '').toString().toUpperCase()
        if (statusRaw === 'UP' || statusRaw === 'HEALTHY') {
          setHealth('up')
        } else if (statusRaw === 'DEGRADED' || statusRaw === 'WARN') {
          setHealth('degraded')
        } else {
          setHealth('down')
        }
      } catch {
        setHealth('unknown')
      } finally {
        clearTimeout(timeout)
        checkingRef.current = false
      }
    }

    // 首次检查 + 轮询
    check()
    interval = setInterval(check, 30000)
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [])

  const envGroup = [
    { href: '/env-config', icon: BiEnvelope, label: '环境配置', color: 'text-blue-500' },
    { href: '/ai-config', icon: BiBrain, label: '简历配置', color: 'text-violet-500' },
  ]

  const platformGroup = [
    { href: '/boss', icon: BiBriefcase, label: 'Boss直聘', color: 'text-blue-500' },
    { href: '/zhilian', icon: BiUserCircle, label: '智联招聘', color: 'text-cyan-500' },
  ]

  const unsupportedPlatformGroup = [
    { href: '/liepin', icon: BiSearch, label: '猎聘' },
    { href: '/51job', icon: BiTask, label: '51job' },
  ]

  return (
    <motion.aside
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed left-0 top-0 z-50 h-full w-64 border-r border-slate-200/80 bg-white/86 shadow-[16px_0_50px_rgba(15,23,42,0.035)] backdrop-blur-xl dark:border-strokedark dark:bg-blacksection/92"
    >
      {/* 侧边栏头部 */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="p-5"
      >
        <div className="mb-4 flex items-center gap-3">
          <Image src="/toudi-niuma.svg" alt="投递牛马" width={44} height={44} className="h-11 w-11" priority />
          <div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">投递牛马</h1>
            <p className="text-sm text-slate-500 dark:text-manatee">配置管理中心</p>
          </div>
        </div>

        {/* 状态指示器（动态健康检查） */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white/70 px-3 py-2 text-sm text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-manatee">
          <div
            className={`w-2 h-2 rounded-full animate-pulse ${
              health === 'up'
                ? 'bg-green-400'
                : health === 'degraded'
                ? 'bg-yellow-400'
                : health === 'down'
                ? 'bg-red-500'
                : 'bg-gray-400'
            }`}
          ></div>
          <span>
            {health === 'up'
              ? '系统运行正常'
              : health === 'degraded'
              ? '服务降级'
              : health === 'down'
              ? '服务异常'
              : '未连接'}
          </span>
        </div>

        {/* 主题切换器 */}
        {mounted && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="mt-3 flex w-full items-center justify-start gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-600 transition-colors duration-200 hover:bg-blue-50 hover:text-blue-600 dark:text-manatee dark:hover:bg-white/5"
          >
            {theme === 'dark' ? (
              <>
                <BiSun className="text-lg" />
                <span className="text-sm">切换到浅色</span>
              </>
            ) : (
              <>
                <BiMoon className="text-lg" />
                <span className="text-sm">切换到深色</span>
              </>
            )}
          </motion.button>
        )}
      </motion.div>

      {/* 导航菜单 */}
      <nav className="h-[calc(100vh-178px)] space-y-4 overflow-y-auto px-4 pb-4">
        {/* 环境配置分组 */}
        <div>
          <div className="px-2 py-2 text-xs font-medium tracking-normal text-slate-400 dark:text-waterloo">环境配置</div>
          <div className="space-y-2">
            {envGroup.map((item, index) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <motion.div
                  key={item.href}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.1 * index + 0.3, duration: 0.3 }}
                >
                  <Link
                    href={item.href}
                    className={`
                      group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200
                      ${isActive
                        ? 'bg-blue-50 text-blue-600 shadow-sm dark:bg-blue-500/15 dark:text-blue-200'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-manatee dark:hover:bg-white/5'
                      }
                    `}
                  >
                    <Icon className={`text-xl ${isActive ? 'text-blue-600 dark:text-blue-200' : item.color} transition-transform group-hover:scale-105`} />
                    <span className="font-medium">{item.label}</span>
                    {isActive && (
                      <div className="ml-auto">
                        <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                      </div>
                    )}
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </div>

        {/* 平台配置分组 */}
        <div>
          <div className="px-2 py-2 text-xs font-medium tracking-normal text-slate-400 dark:text-waterloo">平台配置</div>
          <div className="space-y-2">
            {platformGroup.map((item, index) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <motion.div
                  key={item.href}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.1 * index + 0.5, duration: 0.3 }}
                >
                  <Link
                    href={item.href}
                    className={`
                      group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200
                      ${isActive
                        ? 'bg-blue-50 text-blue-600 shadow-sm dark:bg-blue-500/15 dark:text-blue-200'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-manatee dark:hover:bg-white/5'
                      }
                    `}
                  >
                    <Icon className={`text-xl ${isActive ? 'text-blue-600 dark:text-blue-200' : item.color} transition-transform group-hover:scale-105`} />
                    <span className="font-medium">{item.label}</span>
                    {isActive && (
                      <div className="ml-auto">
                        <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                      </div>
                    )}
                  </Link>
                </motion.div>
              )
            })}
            {unsupportedPlatformGroup.map((item, index) => {
              const Icon = item.icon
              return (
                <motion.div
                  key={item.href}
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.1 * (platformGroup.length + index) + 0.5, duration: 0.3 }}
                >
                  <div
                    aria-disabled="true"
                    title={`${item.label}暂未适配`}
                    className="
                      group flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5
                      text-slate-400 grayscale dark:text-waterloo/70
                    "
                  >
                    <Icon className="text-xl text-slate-400 dark:text-waterloo/70" />
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-auto rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/5 dark:text-waterloo">
                      未适配
                    </span>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </nav>

      {/* 底部信息 */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        className="absolute bottom-0 left-0 right-0 border-t border-slate-200/80 p-4 dark:border-strokedark"
      >
        {/* 版本信息 */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-900 text-sm font-semibold text-white shadow-sm">牛</div>
          <p className="text-xs text-slate-500 dark:text-waterloo">v1.0.0</p>
          <BiChevronDown className="ml-auto text-slate-400" />
        </div>
      </motion.div>
    </motion.aside>
  )
}
