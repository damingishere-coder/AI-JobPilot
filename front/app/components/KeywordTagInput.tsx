'use client'

import { useMemo, useState } from 'react'
import { BiPlus, BiX } from 'react-icons/bi'
import { Input } from '@/components/ui/input'
import { MAX_JOB_KEYWORDS, mergeJobKeywords, parseJobKeywords } from '@/lib/job-keywords'

type KeywordTagInputProps = {
  value: string[]
  onChange: (keywords: string[]) => void
  recommendations?: string[]
  disabled?: boolean
  max?: number
}

export default function KeywordTagInput({
  value,
  onChange,
  recommendations = [],
  disabled = false,
  max = MAX_JOB_KEYWORDS,
}: KeywordTagInputProps) {
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const normalizedValue = useMemo(() => parseJobKeywords(value), [value])
  const isOverLimit = normalizedValue.length > max
  const isAtLimit = normalizedValue.length >= max
  const availableRecommendations = parseJobKeywords(recommendations).filter(
    (keyword) => !normalizedValue.some((selected) => selected.toLocaleLowerCase() === keyword.toLocaleLowerCase()),
  )

  const add = (raw: unknown) => {
    if (disabled) return
    const result = mergeJobKeywords(normalizedValue, raw, max)
    if (result.keywords.length !== normalizedValue.length) onChange(result.keywords)
    setMessage(result.rejected.length ? `最多选择 ${max} 个，未加入：${result.rejected.join('、')}` : '')
    setDraft('')
  }

  const remove = (keyword: string) => {
    if (disabled) return
    onChange(normalizedValue.filter((item) => item !== keyword))
    setMessage('')
  }

  return (
    <div className="space-y-2">
      <div className={`min-h-11 rounded-lg border bg-background p-2 ${isOverLimit ? 'border-destructive' : 'border-input'}`}>
        <div className="flex flex-wrap items-center gap-2">
          {normalizedValue.map((keyword) => (
            <span key={keyword.toLocaleLowerCase()} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
              {keyword}
              <button
                type="button"
                aria-label={`删除关键词 ${keyword}`}
                className="rounded-full p-0.5 hover:bg-primary/15 disabled:opacity-50"
                onClick={() => remove(keyword)}
                disabled={disabled}
              >
                <BiX />
              </button>
            </span>
          ))}
          <div className="flex min-w-48 flex-1 items-center gap-1">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add(draft)
                }
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text')
                if (/[,，;；\n\r]/.test(pasted)) {
                  event.preventDefault()
                  add(pasted)
                }
              }}
              placeholder={isAtLimit ? `最多 ${max} 个` : '输入后按回车，可粘贴多个'}
              className="h-8 border-0 px-1 shadow-none focus-visible:ring-0"
              disabled={disabled || isAtLimit}
              aria-label="新增岗位关键词"
            />
            <button
              type="button"
              aria-label="添加岗位关键词"
              className="rounded-md p-1.5 text-primary hover:bg-primary/10 disabled:opacity-40"
              onClick={() => add(draft)}
              disabled={disabled || isAtLimit || !draft.trim()}
            >
              <BiPlus />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={isOverLimit ? 'text-destructive' : 'text-muted-foreground'}>
          {isOverLimit ? `历史配置有 ${normalizedValue.length} 个，请删减到 ${max} 个以内` : '建议选择 3–5 个最贴近目标岗位的关键词'}
        </span>
        <span className={isOverLimit ? 'font-semibold text-destructive' : 'text-muted-foreground'}>{normalizedValue.length}/{max}</span>
      </div>

      {availableRecommendations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">简历 AI 推荐（点击后加入）</p>
          <div className="flex flex-wrap gap-2">
            {availableRecommendations.map((keyword) => (
              <button
                key={keyword.toLocaleLowerCase()}
                type="button"
                className="rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
                onClick={() => add(keyword)}
                disabled={disabled || isAtLimit}
              >
                <BiPlus className="mr-1 inline" />{keyword}
              </button>
            ))}
          </div>
        </div>
      )}
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  )
}
