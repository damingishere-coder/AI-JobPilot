import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useBossAnalysisTasks } from "./useBossAnalysisTasks"

function response(queueSize: number) {
  return new Response(JSON.stringify({
    success: true,
    queueSize,
    pendingCount: queueSize,
    processingCount: 0,
    data: queueSize > 0 ? [{
      id: 9,
      profileId: 1,
      platform: "boss",
      jobKey: "job-9",
      jobRowId: 99,
      status: "PENDING",
      attemptCount: 0,
    }] : [],
  }), { status: 200, headers: { "Content-Type": "application/json" } })
}

describe("Boss AI任务轮询", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("页面可见且有未完成任务时每3秒刷新，队列清空后停止", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(1))
      .mockResolvedValueOnce(response(0))
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useBossAnalysisTasks())
    await vi.waitFor(() => expect(result.current.queueSize).toBe(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    await vi.waitFor(() => expect(result.current.queueSize).toBe(0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("platform=boss"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("页面隐藏时不启动定时轮询", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    const fetchMock = vi.fn().mockResolvedValue(response(1))
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useBossAnalysisTasks())
    await vi.waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("相同任务快照不会重复触发岗位列表刷新", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn().mockResolvedValue(response(1))
    vi.stubGlobal("fetch", fetchMock)

    const { result } = renderHook(() => useBossAnalysisTasks())
    await vi.waitFor(() => expect(result.current.queueSize).toBe(1))
    expect(result.current.pollRevision).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.pollRevision).toBe(0)
  })
})
