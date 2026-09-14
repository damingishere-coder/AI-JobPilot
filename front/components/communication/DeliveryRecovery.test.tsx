import { afterEach, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { DeliveryRecovery } from "./DeliveryRecovery"
import { localActionFetch } from "@/lib/api"
import { REQUIRED_BACKGROUND_VERSION, sendChromeBridgeMessage } from "@/lib/chromeBridge"

vi.mock("@/lib/api", () => ({ API_BASE: "", localActionFetch: vi.fn() }))
vi.mock("@/lib/chromeBridge", () => ({ REQUIRED_BACKGROUND_VERSION: "test-version", sendChromeBridgeMessage: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })
const row = (id: number, state: string) => ({request_key:`key-${id}`, profile_id:4,job_row_id:id,state,
  company_name:"公司",job_name:`岗位${id}`,greeting_snapshot:"原确认话术",message:""})

it("skips confirmed rows and stops before the next send after an uncertain result", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async()=>[row(1,"CONFIRMED"),row(2,"FAILED"),row(3,"FAILED")]}))
  vi.mocked(localActionFetch).mockResolvedValue({ok:true,json:async()=>({success:true,task:{id:2,reconciliationOnly:false}})} as Response)
  vi.mocked(sendChromeBridgeMessage).mockResolvedValueOnce({success:true,version:REQUIRED_BACKGROUND_VERSION})
    .mockResolvedValueOnce({success:false,outcome:"UNKNOWN",persisted:true,message:"发送结果不明确"})
  render(<DeliveryRecovery platform="boss" />)
  await waitFor(()=>expect(screen.getByText("核对并续投这批")).toBeEnabled())
  fireEvent.click(screen.getByText("核对并续投这批"))
  await screen.findByText(/已暂停：发送结果不明确/)
  expect(localActionFetch).toHaveBeenCalledTimes(1)
  expect(vi.mocked(localActionFetch).mock.calls[0][0]).toContain("key-2/resume")
  expect(sendChromeBridgeMessage).toHaveBeenCalledTimes(2)
})

it("blocks an old extension before creating any new delivery attempt", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>[row(2,"FAILED")]}))
  vi.mocked(sendChromeBridgeMessage).mockResolvedValue({success:true,version:"old"})
  render(<DeliveryRecovery platform="zhilian" />)
  await waitFor(()=>expect(screen.getByText("核对并续投这批")).toBeEnabled())
  fireEvent.click(screen.getByText("核对并续投这批"))
  await screen.findByText(/请在 Chrome 扩展管理中重新加载/)
  expect(localActionFetch).not.toHaveBeenCalled()
})
