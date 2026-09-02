import { describe, expect, it } from 'vitest'

import { readApiResponse } from './api'

describe('readApiResponse', () => {
  it('拒绝 HTML 200 响应', async () => {
    const response = new Response('<html>SPA fallback</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(readApiResponse(response, '接口响应无效')).rejects.toThrow('接口响应无效')
  })

  it('拒绝缺少 success:true 的 JSON', async () => {
    const response = new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(readApiResponse(response, '接口响应无效')).rejects.toThrow('接口响应无效')
  })

  it('接受明确成功的 JSON', async () => {
    const response = new Response(JSON.stringify({ success: true, data: { id: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
    await expect(readApiResponse<{ id: number }>(response, '接口响应无效'))
      .resolves.toMatchObject({ success: true, data: { id: 1 } })
  })
})
