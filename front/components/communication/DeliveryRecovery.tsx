"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { API_BASE, localActionFetch } from "@/lib/api"
import { REQUIRED_BACKGROUND_VERSION, sendChromeBridgeMessage } from "@/lib/chromeBridge"
import { Button } from "@/components/ui/button"

type Row = {
  request_key: string; profile_id: number; job_row_id: number; state: string
  evidence: string; message: string; company_name: string; job_name: string; greeting_snapshot: string
}

export function DeliveryRecovery({ platform }: { platform: "boss" | "zhilian" }) {
  const [date, setDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  })
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState("")
  const stop = useRef(false)
  const busy = useRef(false)
  const load = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/delivery-attempts/recovery?platform=${platform}&date=${date}`, { cache: "no-store" })
    if (!response.ok) throw new Error("投递恢复记录读取失败，请刷新页面")
    const data = await response.json() as Row[]
    if (!Array.isArray(data)) throw new Error("恢复记录格式不正确，请确认后端已更新")
    setRows(data)
    return data
  }, [date, platform])
  useEffect(() => { void load().catch(e => setStatus(String(e.message))) }, [load])
  useEffect(() => () => { stop.current = true }, [])

  async function resume() {
    if (busy.current) return
    busy.current = true; stop.current = false; setRunning(true)
    let confirmed = 0, held = 0, failed = 0
    try {
      const bridge = await sendChromeBridgeMessage({ type: "GET_JOBS_EXTENSION_PING" }, 3000)
      if (!bridge.success || bridge.version !== REQUIRED_BACKGROUND_VERSION) {
        throw new Error("请在 Chrome 扩展管理中重新加载“投递牛马 Chrome Bridge”，再刷新工作台后继续。")
      }
      const targets = (await load()).filter(row => row.state !== "CONFIRMED")
      for (let index = 0; index < targets.length && !stop.current; index++) {
        const row = targets[index]
        setStatus(`后台处理 ${index + 1}/${targets.length}：${row.job_name} · ${row.company_name}。已确认 ${confirmed}，待核对 ${held}，失败 ${failed}`)
        const prepared = await localActionFetch(`${API_BASE}/api/delivery-attempts/${row.request_key}/resume`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: row.profile_id })
        })
        const data = await prepared.json()
        if (!prepared.ok || !data.success) throw new Error(data.message || "无法恢复该投递记录")
        if (stop.current) break
        const result = await sendChromeBridgeMessage({ type: `${platform === "boss" ? "BOSS" : "ZHILIAN"}_DELIVER_ONE`,
          platform, task: data.task }, 90000)
        if (result.outcome === "CONFIRMED" && result.persisted === true) confirmed++
        else if (result.outcome === "FAILED") failed++
        else held++
        if (result.haltBatch || result.persisted !== true
          || (result.outcome === "UNKNOWN" && !data.task.reconciliationOnly)) {
          throw new Error(`已暂停：${result.message || "结果待确认"}。当前岗位不会自动重发，其余记录保留。`)
        }
      }
      setStatus(`${stop.current ? "已暂停" : "本轮结束"}：已确认 ${confirmed}，仍待核对 ${held}，失败 ${failed}。已完成岗位不会重复发送。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "恢复中断，进度已保留")
    } finally {
      busy.current = false; setRunning(false)
      await load().catch(() => {})
    }
  }

  const pending = rows.filter(row => row.state !== "CONFIRMED")
  return <section className="rounded-xl border bg-card p-4 space-y-3" aria-label="投递中断恢复">
    <div className="flex flex-wrap items-center gap-3">
      <strong>投递中断恢复</strong>
      <input type="date" aria-label="投递日期" value={date} disabled={running} onChange={event => setDate(event.target.value)} className="rounded border bg-background px-2 py-1" />
      <span className="text-sm text-muted-foreground">当天已请求 {rows.length} 个 · 已确认 {rows.length - pending.length} 个 · 待处理 {pending.length} 个</span>
      <Button variant="outline" disabled={running} onClick={() => void load().catch(e => setStatus(e.message))}>刷新恢复记录</Button>
      <Button disabled={running || !pending.length} onClick={() => void resume()}>核对并续投这批</Button>
      {running && <Button variant="outline" onClick={() => { stop.current = true; setStatus("将在当前岗位结束后暂停，已保存的记录会保留。") }}>暂停续投</Button>}
    </div>
    <p className="text-sm text-muted-foreground">使用独立后台标签页，不切换你的当前页面。沿用原来确认的话术；已投递自动跳过，结果不明只核对不重发。保持本工作台打开，遇到登录失效或平台限制会暂停。</p>
    {status && <p role="status" className="text-sm whitespace-pre-wrap">{status}</p>}
    {!!pending.length && <details><summary className="cursor-pointer text-sm">查看本批待处理岗位及原话术（{pending.length}）</summary>
      <div className="max-h-80 overflow-auto mt-2 space-y-2">{pending.map(row => <article key={row.request_key} className="border-b pb-2 text-sm">
        <p>{row.job_row_id} · {row.job_name} · {row.company_name} · {row.state === "FAILED" ? "可续投" : "先核对"}</p>
        <p className="text-muted-foreground">{row.greeting_snapshot}</p>
        <p className="text-muted-foreground">{row.message}</p>
      </article>)}</div>
    </details>}
  </section>
}
