import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BossThresholdSettings } from "./BossThresholdSettings"

const jsonResponse = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Boss分数线历史岗位更新", () => {
  it("保存后展示历史提升数量并通知分析页刷新", async () => {
    const onApplied = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return Promise.resolve(jsonResponse({
          success: true,
          data: { applyThreshold: 75, priorityApplyThreshold: 65 },
        }))
      }
      return Promise.resolve(jsonResponse({
        success: true,
        data: {
          applyThreshold: 60,
          priorityApplyThreshold: 60,
          bossHistoricalPromotedCount: 58,
        },
      }))
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<BossThresholdSettings onApplied={onApplied} />)

    const applyInput = await screen.findByLabelText("普通公司最低分")
    fireEvent.change(applyInput, { target: { value: "60" } })
    fireEvent.click(screen.getByRole("button", { name: "保存分数线" }))

    expect(await screen.findByText(/58个历史岗位已改为“待确认”/)).toBeInTheDocument()
    expect(onApplied).toHaveBeenCalledTimes(1)
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === "POST")
    expect(postCall).toBeDefined()
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      applyThreshold: 60,
      priorityApplyThreshold: 60,
    })
  })

  it("数据已保存但列表刷新失败时给出准确提示", async () => {
    const onApplied = vi.fn().mockRejectedValue(new Error("refresh failed"))
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(jsonResponse({
      success: true,
      data: init?.method
        ? { applyThreshold: 60, priorityApplyThreshold: 50, bossHistoricalPromotedCount: 3 }
        : { applyThreshold: 60, priorityApplyThreshold: 50 },
    }))))
    render(<BossThresholdSettings onApplied={onApplied} />)

    await screen.findByDisplayValue("60")
    fireEvent.click(screen.getByRole("button", { name: "保存分数线" }))

    expect(await screen.findByText(/3个历史岗位已改为“待确认”/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/列表刷新失败/)).toBeInTheDocument())
  })
})
