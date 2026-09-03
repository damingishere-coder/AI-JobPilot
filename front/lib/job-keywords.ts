export const MAX_JOB_KEYWORDS = 8
export const RECOMMENDED_JOB_KEYWORD_COUNT = 3

export const parseJobKeywords = (value: unknown): string[] => {
  const keywords: string[] = []

  const append = (rawValue: unknown) => {
    if (Array.isArray(rawValue)) {
      rawValue.forEach(append)
      return
    }

    const raw = String(rawValue ?? '').trim()
    if (!raw) return
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          parsed.forEach(append)
          return
        }
      } catch {
        append(raw.slice(1, -1))
        return
      }
    }

    raw.split(/[,，;；\n\r]+/).forEach((item) => {
      const keyword = item.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '').trim()
      if (!keyword) return
      if (!keywords.some((existing) => existing.toLocaleLowerCase() === keyword.toLocaleLowerCase())) {
        keywords.push(keyword)
      }
    })
  }

  append(value)
  return keywords
}

export const serializeJobKeywords = (value: unknown): string => JSON.stringify(parseJobKeywords(value))

export const mergeJobKeywords = (
  current: unknown,
  incoming: unknown,
  max = MAX_JOB_KEYWORDS,
): { keywords: string[]; rejected: string[] } => {
  const existing = parseJobKeywords(current)
  const additions = parseJobKeywords(incoming)
    .filter((keyword) => !existing.some((item) => item.toLocaleLowerCase() === keyword.toLocaleLowerCase()))
  if (existing.length >= max) return { keywords: existing, rejected: additions }
  const available = max - existing.length
  return {
    keywords: existing.concat(additions.slice(0, available)),
    rejected: additions.slice(available),
  }
}
