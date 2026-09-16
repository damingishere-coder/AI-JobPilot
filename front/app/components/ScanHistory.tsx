'use client'
import { useEffect, useRef, useState } from 'react'
import { scanCommand, scanUrl, type ScanPlatform } from '@/lib/scan-runs'

type Command = {id:string;kind:string;status:string;error_code:string}
type Run = {created_at?:number;stop_reason?:string;errorMessage?:string;run_id:string;state:string;desired?:string;keyword?:string;stage?:string;accepted:number;error_code?:string;
  backgroundConnected?:boolean;pageConnected?:boolean;page_seen_at?:number;extension_version?:string;content_version?:string;
  historyComplete:boolean;keywordReceipts?:{keyword:string;accepted:number}[];counters?:Record<string,number>;commands?:Command[];analysis?:{status:string;count:number}[]}
type Event = {id:number;created_at:number;kind:string;payload:Record<string,unknown>}
const states:Record<string,string>={STARTING:'正在启动',RUNNING:'扫描中',PAUSED:'已暂停',BLOCKED:'已阻塞',COMPLETE:'扫描完成',PARTIAL:'部分完成',FAILED:'失败',STOPPED:'已停止',LEGACY:'未记录完整过程'}
const errors:Record<string,string>={BACKEND_UNAVAILABLE:'后端连接中断',LOG_QUEUE_FULL:'日志缓冲已满',SCAN_TAB_CLOSED:'扫描页面已关闭',FILTER_NOT_APPLIED:'官网筛选未生效',EXTENSION_RELOAD_REQUIRED:'扩展需要重新加载',START_FAILED:'启动结果未确认',SETUP_NOT_READY:'启动前检查未通过',CHECKPOINT_MISSING:'恢复断点不存在',UNRECOGNIZED_LAYOUT:'未识别岗位页面结构',SCAN_STORAGE_FAILED:'扩展本地记录保存失败'}
const time=(v?:number)=>v?new Date(v).toLocaleString():'尚未联系'
export default function ScanHistory({platform,profileId}:{platform:ScanPlatform;profileId?:number}) {
  const [runs,setRuns]=useState<Run[]>([]),[selected,setSelected]=useState(''),[events,setEvents]=useState<Event[]>([])
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[errorsOnly,setErrorsOnly]=useState(false)
  const cursor=useRef(0)
  const current=runs.find(r=>r.run_id===selected)||runs[0]
  useEffect(()=>{setSelected('');setRuns([]);setEvents([]);cursor.current=0},[platform,profileId])
  useEffect(()=>{
    if(!profileId)return
    let stopped=false,timer:ReturnType<typeof setTimeout>
    async function poll(){
      try {
        const response=await fetch(scanUrl(platform,profileId!),{cache:'no-store'})
        if(!response.ok)throw new Error('暂时无法读取后端扫描记录；当前显示的是上次结果。')
        const data:unknown=await response.json();if(!Array.isArray(data))throw new Error('后端扫描记录接口版本不兼容。');if(!stopped){setRuns(data);setError('')}
      }catch(e){if(!stopped)setError(e instanceof Error?e.message:'读取失败')}
      if(!stopped)timer=setTimeout(poll,document.hidden?15000:3000)
    }
    void poll();return()=>{stopped=true;clearTimeout(timer)}
  },[platform,profileId])
  const runId=current?.run_id,managed=current?.historyComplete
  useEffect(()=>{
    setEvents([]);cursor.current=0
    if(!profileId||!runId||!managed)return
    let stopped=false,timer:ReturnType<typeof setTimeout>
    async function poll(){
      try {
        const r=await fetch(`${scanUrl(platform,profileId!,runId,'/events')}&after=${cursor.current}`,{cache:'no-store'})
        if(!r.ok)throw new Error('日志读取失败')
        const list:Event[]=await r.json()
        if(!stopped&&list.length){cursor.current=list[list.length-1].id;setEvents(prev=>[...prev,...list].slice(-1000))}
      }catch{ /* Main state query reports connectivity failures. */ }
      if(!stopped)timer=setTimeout(poll,document.hidden?15000:3000)
    }
    void poll();return()=>{stopped=true;clearTimeout(timer)}
  },[platform,profileId,runId,managed])
  async function control(kind:'PAUSE'|'RESUME'|'STOP') {
    if(!profileId||!current)return
    setBusy(true);setError('')
    try{const updated=await scanCommand(platform,profileId,current.run_id,kind);setRuns(prev=>prev.map(r=>r.run_id===current.run_id?updated:r))}
    catch(e){setError(e instanceof Error?e.message:'指令提交失败')}
    finally{setBusy(false)}
  }
  async function exportDiagnostics(){
    if(!profileId||!current)return
    try{
      const response=await fetch(scanUrl(platform,profileId,current.run_id,'/diagnostics'))
      if(!response.ok)throw new Error('诊断导出失败')
      const data=await response.json(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}))
      const link=document.createElement('a');link.href=url;link.download=`${platform}-${current.run_id}-diagnostics.json`;link.click();URL.revokeObjectURL(url)
    }catch(e){setError(e instanceof Error?e.message:'导出失败')}
  }
  const keywordResults=([...events].reverse().find(e=>Array.isArray(e.payload.keywordResults))?.payload.keywordResults||[]) as {keyword:string;duplicates:number;detailFailures:number;stopReason:string}[]
  const terminal=current&&['COMPLETE','PARTIAL','FAILED','STOPPED'].includes(current.state)
  return <section className="rounded-xl border p-4 space-y-3" aria-label="扫描记录">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">扫描记录</h2>
      <select aria-label="选择扫描记录" value={current?.run_id||''} onChange={e=>setSelected(e.target.value)} className="max-w-full rounded border bg-background p-2">
        {runs.map(r=><option key={r.run_id} value={r.run_id}>{r.run_id} · {states[r.state]||r.state}</option>)}
      </select></div>
    {error&&<p role="alert" className="text-amber-700">{error}</p>}
    {!current?<p className="text-sm text-muted-foreground">暂无扫描记录。</p>:<>
      <p><strong>{states[current.state]||current.state}</strong> · 新增入队 <strong>{current.accepted}</strong> 个</p>
      {current.historyComplete?<>
        {!terminal&&!current.pageConnected&&<p className="text-amber-700">状态待核实：扫描页未联系，以上为最后已知状态。</p>}
        <p className="text-sm">开始时间：{time(current.created_at)} · 关键词：{current.keyword||'尚未开始'} · 阶段：{current.stage} · 最后联系：{time(current.page_seen_at)}</p>
        <p className="text-sm">{current.backgroundConnected?'扩展后台在线':'扩展后台未联系'} · 扩展 {current.extension_version||'未报告'} / 页面脚本 {current.content_version||'未报告'}</p>
        {current.error_code&&<p className="text-red-700">{errors[current.error_code]||current.errorMessage||current.error_code}（{current.error_code}）</p>}
        {current.stop_reason&&<p className="text-sm">停止原因：{current.stop_reason}</p>}
        {(!current.extension_version||!current.content_version)&&<p className="text-sm text-amber-700">尚未确认新扫描协议，请重新加载 1.8.16 或更新版本的扩展与招聘页面。</p>}
        <div className="flex flex-wrap gap-2">
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={busy||terminal||current.desired==='STOPPED'} onClick={()=>control('PAUSE')}>暂停</button>
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={busy||!current.pageConnected||!['PAUSED','BLOCKED'].includes(current.state)||current.desired==='STOPPED'} onClick={()=>control('RESUME')}>继续</button>
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={busy||terminal||current.desired==='STOPPED'} onClick={()=>control('STOP')}>停止本轮</button>
          <button className="rounded border px-3 py-1" onClick={exportDiagnostics}>导出诊断</button>
          <button className="rounded border px-3 py-1" onClick={()=>navigator.clipboard.writeText(`${platform} ${current.run_id}；${states[current.state]}；新增入队 ${current.accepted}；${current.error_code||'无已记录错误'}；最后联系 ${time(current.page_seen_at)}`).catch(()=>setError('复制失败，请使用导出诊断'))}>复制摘要</button>
        </div>
        {current.commands?.slice(0,3).map(c=><p key={c.id} className="text-sm">{({PAUSE:'暂停',RESUME:'继续',STOP:'停止'})[c.kind]||c.kind}：{({PENDING:'请求已保存，等待扩展执行',ACKNOWLEDGED:'扩展已确认执行',FAILED:'执行失败',SUPERSEDED:'已被后续指令替代'})[c.status]||c.status}{c.error_code?`（${c.error_code}）`:''}</p>)}
        <p className="text-sm text-muted-foreground">暂停扫描不停止已入队的 AI 分析。{current.analysis?.map(a=>`${a.status} ${a.count}`).join(' · ')}</p>
        <details><summary className="cursor-pointer">过程与错误记录</summary>
          <p className="text-sm">读取 {current.counters?.read||0} · 重复 {current.counters?.duplicates||0} · 详情失败 {current.counters?.detailFailures||0} · 提交失败 {current.counters?.submissionFailures||0}</p>
          {current.keywordReceipts?.map(k=><p key={k.keyword}>{k.keyword}：新增入队 {k.accepted} 个</p>)}
          {keywordResults.map(k=><p key={k.keyword}>{k.keyword}：跳过重复 {k.duplicates}，详情失败 {k.detailFailures}，结束原因 {k.stopReason||'仍在进行'}</p>)}
          <label><input type="checkbox" checked={errorsOnly} onChange={e=>setErrorsOnly(e.target.checked)}/> 只看错误</label>
          <ol className="max-h-80 overflow-auto text-sm space-y-1">{events.filter(e=>!errorsOnly||e.kind==='error'||e.kind==='startFailure').map(e=><li key={e.id}>{time(Number(e.payload.observedAt)||e.created_at)} · {String(e.payload.keyword||'')} · {String(e.payload.stage||e.kind)} {String(e.payload.errorCode||'')}</li>)}</ol>
        </details>
      </>:<p className="text-sm text-muted-foreground">历史任务未记录完整过程，仅展示已核实的入库回执。</p>}
    </>}
  </section>
}
