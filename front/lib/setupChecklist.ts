import { API_BASE } from "@/lib/api"
import { getChromeBridgeStatus, sendChromeBridgeMessage } from "@/lib/chromeBridge"

export type SetupCheckKey =
  | "backend"
  | "chromeBridge"
  | "aiConfig"
  | "resume"
  | "bossLogin"
  | "zhilianLogin"

export type SetupCheckState = "ok" | "warning" | "error"

export type SetupCheckItem = {
  key: SetupCheckKey
  title: string
  state: SetupCheckState
  done: boolean
  detail: string
  actionLabel: string
  href: string
}

export type SetupChecklistResult = {
  items: SetupCheckItem[]
  ready: boolean
  missing: SetupCheckItem[]
}

export type ValidateSetupOptions = {
  requirePlatformLogin?: boolean
}

type AiConfigResponse = {
  success?: boolean
  data?: {
    introduce?: string | null
    prompt?: string | null
  } | null
}

type ResumeResponse = {
  success?: boolean
  data?: {
    resumeText?: string | null
    sourceFilename?: string | null
    parseStatus?: string | null
  } | null
}

type LoginStatusResponse = {
  success?: boolean
  isLoggedIn?: boolean
  searchReady?: boolean
  chromePageReady?: boolean
  hasLoginPrompt?: boolean
  hasSecurityPrompt?: boolean
  pageState?: string
  message?: string
  failureReason?: string
}

function item(
  key: SetupCheckKey,
  title: string,
  done: boolean,
  detail: string,
  actionLabel: string,
  href: string,
  failed = false
): SetupCheckItem {
  return {
    key,
    title,
    done,
    detail,
    actionLabel,
    href,
    state: done ? "ok" : failed ? "error" : "warning",
  }
}

async function fetchJson<T>(url: string, timeoutMs = 4000): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as T
  } finally {
    window.clearTimeout(timeout)
  }
}

async function checkBackend(): Promise<SetupCheckItem> {
  try {
    const data = await fetchJson<{ status?: string; state?: string; service?: string }>(`${API_BASE}/api/health`, 3000)
    const status = String(data.status || data.state || "").toUpperCase()
    const done = status === "HEALTHY" || status === "UP"
    return item("backend", "后端连接", done, done ? "本地后端服务运行正常" : "后端健康检查返回异常", "环境配置", "/env-config", !done)
  } catch {
    return item("backend", "后端连接", false, `未检测到 ${API_BASE} 后端服务`, "环境配置", "/env-config", true)
  }
}

async function checkChromeBridge(): Promise<SetupCheckItem> {
  try {
    const status = await getChromeBridgeStatus()
    return item(
      "chromeBridge",
      "Chrome扩展连接",
      !!status.success,
      status.success ? `扩展已连接${status.version ? `，版本 ${status.version}` : ""}` : status.message || "Chrome扩展未响应",
      "刷新检查",
      "/",
      !status.success
    )
  } catch {
    return item("chromeBridge", "Chrome扩展连接", false, "Chrome扩展未响应，请加载 chrome-extension 目录", "刷新检查", "/", true)
  }
}

async function checkAiConfig(): Promise<SetupCheckItem> {
  try {
    const data = await fetchJson<AiConfigResponse>(`${API_BASE}/api/ai/config`)
    const introduce = data.data?.introduce?.trim()
    const prompt = data.data?.prompt?.trim()
    const done = !!data.success && !!introduce && !!prompt
    return item("aiConfig", "AI模型配置", done, done ? "已保存 AI 分析配置" : "请先生成或保存 AI 分析配置", "去配置", "/ai-config")
  } catch {
    return item("aiConfig", "AI模型配置", false, "AI 配置接口暂不可用", "去配置", "/ai-config", true)
  }
}

async function checkResume(): Promise<SetupCheckItem> {
  try {
    const data = await fetchJson<ResumeResponse>(`${API_BASE}/api/ai/resume`)
    const text = data.data?.resumeText?.trim()
    const done = !!data.success && !!text
    return item("resume", "简历是否已上传", done, done ? "已保存简历内容" : "请先上传或粘贴简历内容", "去上传", "/ai-config")
  } catch {
    return item("resume", "简历是否已上传", false, "简历接口暂不可用", "去上传", "/ai-config", true)
  }
}

async function checkLogin(platform: "boss" | "zhilian"): Promise<SetupCheckItem> {
  const title = platform === "boss" ? "Boss登录状态" : "智联登录状态"
  const href = platform === "boss" ? "/boss" : "/zhilian"

  if (platform === "boss") {
    try {
      const status = await sendChromeBridgeMessage<LoginStatusResponse>({ type: "BOSS_PAGE_STATUS", platform: "boss" }, 1800)
      const blocked = !!status.hasLoginPrompt || !!status.hasSecurityPrompt
      const done = !!status.success && !blocked
      const detail = blocked
        ? status.hasSecurityPrompt
          ? "Boss页面出现安全验证，请在Chrome中处理后再扫描"
          : status.hasLoginPrompt
            ? "Boss页面出现登录提示，请在Chrome中重新登录"
            : "Boss页面需要处理后再扫描"
        : status.chromePageReady || status.isLoggedIn
          ? status.message || "Chrome中的Boss页面可用，可以扫描或投递"
          : status.success
            ? "未检测到Boss阻塞状态，开始扫描时会使用Chrome登录态确认"
            : status.message || "Chrome扩展暂不可用，无法读取Boss登录状态"
      return item("bossLogin", title, done, detail, "去登录", href, false)
    } catch {
      return item("bossLogin", title, true, "Boss登录状态将在Chrome扫描启动时确认", "去登录", href)
    }
  }

  try {
    const data = await fetchJson<LoginStatusResponse>(`${API_BASE}/api/${platform}/login-status`, 5000)
    const done = !!data.isLoggedIn
    return item(
      "zhilianLogin",
      title,
      !!data.success && done,
      done
        ? "登录态可用，可以扫描"
        : data.failureReason || data.message || "请先完成平台登录",
      "去登录",
      href
    )
  } catch {
    return item("zhilianLogin", title, false, "登录状态接口暂不可用", "去登录", href, true)
  }
}

export async function loadSetupChecklist(): Promise<SetupChecklistResult> {
  const items = await Promise.all([
    checkBackend(),
    checkChromeBridge(),
    checkAiConfig(),
    checkResume(),
    checkLogin("boss"),
    checkLogin("zhilian"),
  ])
  const missing = items.filter((entry) => !entry.done)
  return { items, missing, ready: missing.length === 0 }
}

export async function validateSetupForPlatform(platform: "boss" | "zhilian", options: ValidateSetupOptions = {}): Promise<SetupChecklistResult> {
  const requirePlatformLogin = options.requirePlatformLogin ?? true
  const checkers: Array<Promise<SetupCheckItem>> = [
    checkBackend(),
    checkChromeBridge(),
    checkAiConfig(),
    checkResume(),
  ]
  if (requirePlatformLogin) {
    checkers.push(checkLogin(platform))
  }
  const items = await Promise.all(checkers)
  const requiredKeys: SetupCheckKey[] = ["backend", "chromeBridge", "aiConfig", "resume"]
  if (requirePlatformLogin) {
    requiredKeys.push(platform === "boss" ? "bossLogin" : "zhilianLogin")
  }
  const missing = items.filter((entry) => requiredKeys.includes(entry.key) && !entry.done)
  return { items, missing, ready: missing.length === 0 }
}

export function formatSetupMissingMessage(platformLabel: string, missing: SetupCheckItem[]) {
  if (!missing.length) return ""
  return `${platformLabel}开始扫描前请先完成：${missing.map((entry) => entry.title).join("、")}。`
}
