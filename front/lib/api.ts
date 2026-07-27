export const DEFAULT_API_BASE = ""

export const API_BASE = process.env.API_BASE_URL ?? DEFAULT_API_BASE

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
