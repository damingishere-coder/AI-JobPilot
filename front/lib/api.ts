export const DEFAULT_API_BASE = ""

export const API_BASE = process.env.API_BASE_URL ?? DEFAULT_API_BASE

let localActionTokenPromise: Promise<string> | null = null

export type ApiEnvelope<T> = {
  success?: boolean
  data?: T
  message?: string
}

const fallbackForStatus = (response: Response, fallback: string) => {
  if (response.status >= 500) {
    return `后端服务暂不可用（HTTP ${response.status}），请稍后重试`
  }
  if (response.status === 404) {
    return "接口暂不可用，请重启后端服务后再试"
  }
  return fallback
}

/**
 * API 可能经过 Next.js 代理；后端不可用时代理会返回纯文本而不是 JSON。
 * 先读取文本再尝试解析，避免把 “Internal Server Error” 暴露成 JSON 语法错误。
 */
export const readApiResponse = async <T>(
  response: Response,
  fallback: string,
): Promise<ApiEnvelope<T>> => {
  const raw = await response.text()
  let result: ApiEnvelope<T> | null = null

  if (raw.trim()) {
    try {
      result = JSON.parse(raw) as ApiEnvelope<T>
    } catch {
      result = null
    }
  }

  if (!response.ok || result?.success === false) {
    throw new Error(result?.message || fallbackForStatus(response, fallback))
  }
  if (!result) {
    throw new Error(fallback)
  }
  return result
}

export const friendlyApiError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) {
    return fallback
  }
  const message = error.message.trim()
  if (
    error instanceof TypeError
    || /failed to fetch|networkerror|load failed|fetch failed/i.test(message)
  ) {
    return "无法连接后端服务，请确认程序已经正常启动后再试"
  }
  return message || fallback
}

const loadLocalActionToken = async (forceRefresh = false) => {
  if (forceRefresh) localActionTokenPromise = null
  if (!localActionTokenPromise) {
    localActionTokenPromise = (async () => {
      const response = await fetch(`${API_BASE}/api/local-auth/action-token`, { cache: "no-store" })
      const result = await readApiResponse<{ token: string }>(response, "获取本地操作令牌失败")
      const token = result.data?.token?.trim()
      if (!token) throw new Error("后端未返回本地操作令牌")
      return token
    })().catch((error) => {
      localActionTokenPromise = null
      throw error
    })
  }
  return localActionTokenPromise
}

/**
 * 仅用于会修改本机数据的接口。后端重启会让旧令牌失效，401 时自动刷新一次。
 */
export const localActionFetch = async (input: string, init: RequestInit = {}) => {
  const execute = async (forceRefresh = false) => {
    const token = await loadLocalActionToken(forceRefresh)
    const headers = new Headers(init.headers)
    headers.set("X-Local-Action-Token", token)
    return fetch(input, { ...init, headers })
  }

  let response = await execute()
  if (response.status === 401) response = await execute(true)
  return response
}
