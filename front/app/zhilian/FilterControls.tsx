'use client'
import {useState} from 'react'
import {Select} from '@/components/ui/select'
import {MULTI_FILTERS, findFilterPath, type FilterNode, type FilterCatalog, type ZhilianFilters} from '@/lib/zhilian-filters'

function Hierarchy({label,nodes,values,onChange,multiple=false,disabled=false}: {
  label:string; nodes:FilterNode[]; values:string[]; onChange:(values:string[])=>void; multiple?:boolean; disabled?:boolean
}) {
  const [path,setPath]=useState<FilterNode[]>(()=>values.length ? findFilterPath(nodes,values[values.length-1]) : [])
  const columns=[nodes,...path.filter(n=>n.children.length).map(n=>n.children)]
  return <div className="space-y-2"><p className="text-sm font-medium">{label}{multiple?'（最多 5 项）':''}</p>
    <div className="flex flex-wrap gap-2">{columns.map((column,level)=><div className="min-w-40 flex-1" key={level}>
      <Select aria-label={`${label}第${level+1}级`} disabled={disabled || !nodes.length}
        value={path[level]?.code || ''} onChange={event=>{
          if(!event.target.value){setPath([]);onChange([]);return}
          const node=column.find(n=>n.code===event.target.value);if(!node)return
          const next=[...path.slice(0,level),node];setPath(next)
          if(!node.children.length){
            if(level===0 && ['不限','全部'].includes(node.name))onChange([])
            else onChange(multiple ? values.includes(node.code)?values.filter(v=>v!==node.code):values.length<5?[...values,node.code]:values : [node.code])
          }
        }}>
        <option value="">{level===0?'不限':'请选择下一级'}</option>
        {column.filter(n=>n.code && !(level===0 && ['不限','全部'].includes(n.name))).map(node=><option value={node.code} key={`${node.code}-${node.name}`}>{node.name}</option>)}
      </Select>
    </div>)}</div>
    <div className="flex flex-wrap gap-2">{values.map(code=>{
      const names=findFilterPath(nodes,code).map(n=>n.name).join(' / ') || `未识别条件 ${code}`
      return <button type="button" disabled={disabled} className="rounded-lg bg-blue-50 px-2 py-1 text-sm text-blue-700" key={code} onClick={()=>{const next=values.filter(v=>v!==code);setPath(next.length?findFilterPath(nodes,next[next.length-1]):[]);onChange(next)}}>{names} ×</button>
    })}</div>
    {!nodes.length && <p className="text-xs text-muted-foreground">该城市暂无对应选项</p>}
  </div>
}

export default function FilterControls({catalog,filters={},onChange,disabled}: {catalog:FilterCatalog;filters:ZhilianFilters;onChange:(value:ZhilianFilters)=>void;disabled:boolean}) {
  const option=catalog.options
  const multi=(key:typeof MULTI_FILTERS[number][0],label:string)=><fieldset key={key} className="space-y-2"><legend className="text-sm font-medium">{label}（可多选）</legend>
    <div className="flex flex-wrap gap-2">
      <label className="rounded-lg border px-3 py-2 text-sm"><input type="checkbox" disabled={disabled} checked={!filters[key]?.length} onChange={()=>onChange({...filters,[key]:[]})}/> 不限</label>
      {(option[key]||[]).filter(n=>!['不限','全部'].includes(n.name)).map(n=><label key={n.code} className="rounded-lg border px-3 py-2 text-sm">
        <input type="checkbox" disabled={disabled} checked={filters[key]?.includes(n.code)||false} onChange={e=>onChange({...filters,[key]:e.target.checked?[...(filters[key]||[]),n.code]:(filters[key]||[]).filter(v=>v!==n.code)})}/> {n.name}
      </label>)}
    </div>
  </fieldset>
  return <div className="col-span-full space-y-5">
    <div className="grid gap-5 md:grid-cols-2">{MULTI_FILTERS.slice(0,2).map(([k,label])=>multi(k,label))}</div>
    <details open className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">更多筛选</summary>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <Hierarchy label="地区细分" nodes={option.district||[]} values={filters.district?[filters.district]:[]} disabled={disabled}
          onChange={v=>onChange({...filters,district:v[0]||'',subwayLine:'',subwayStation:''})}/>
        <Hierarchy label="地铁线路 / 站点" nodes={option.subway||[]} values={filters.subwayStation?[filters.subwayStation]:[]} disabled={disabled}
          onChange={v=>{const path=findFilterPath(option.subway||[],v[0]||'');onChange({...filters,subwayLine:path.length?path[0].code:'',subwayStation:v[0]||''})}}/>
        {MULTI_FILTERS.slice(2).map(([k,label])=>multi(k,label))}
        <Hierarchy label="职位类别" nodes={option.jobCategory||[]} values={filters.jobCategory?[filters.jobCategory]:[]} disabled={disabled} onChange={v=>onChange({...filters,jobCategory:v[0]||''})}/>
        <Hierarchy label="公司行业" nodes={option.industry||[]} values={filters.industry||[]} multiple disabled={disabled} onChange={v=>onChange({...filters,industry:v})}/>
      </div>
    </details>
    <p className="text-xs text-muted-foreground">选项来源：<a href={catalog.source} target="_blank" rel="noreferrer" className="underline">智联招聘官方字典</a> · 核验版本 {catalog.version}</p>
  </div>
}
