import { describe, expect, it } from 'vitest'

import { MAX_JOB_KEYWORDS, mergeJobKeywords, parseJobKeywords, serializeJobKeywords } from './job-keywords'

describe('job keywords', () => {
  it('兼容 JSON、中文分隔符并忽略大小写去重', () => {
    expect(parseJobKeywords('["Java 后端","AI产品经理","java 后端"]')).toEqual(['Java 后端', 'AI产品经理'])
    expect(parseJobKeywords('Java 后端，AI产品经理；大模型产品\nRAG产品')).toEqual([
      'Java 后端', 'AI产品经理', '大模型产品', 'RAG产品',
    ])
  })

  it('新保存值使用 JSON 数组', () => {
    expect(serializeJobKeywords('Java，Java，AI产品经理')).toBe('["Java","AI产品经理"]')
  })

  it('最多加入八个且不会截断已有超限历史数据', () => {
    const existing = Array.from({ length: MAX_JOB_KEYWORDS }, (_, index) => `岗位${index + 1}`)
    expect(mergeJobKeywords(existing, '岗位9')).toEqual({ keywords: existing, rejected: ['岗位9'] })

    const legacy = existing.concat('岗位9', '岗位10')
    expect(mergeJobKeywords(legacy, '岗位11')).toEqual({ keywords: legacy, rejected: ['岗位11'] })
  })
})
