import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {runInNewContext} from 'node:vm'
import {describe,it,expect} from 'vitest'
import {resetCityFilters,findFilterPath} from './zhilian-filters'
const root:Record<string,any>={}
for(const file of ['zhilian-filters.js','zhilian-scan-support.js'])runInNewContext(readFileSync(resolve(process.cwd(),'../chrome-extension',file),'utf8'),{window:root,URL,URLSearchParams})
const api=root.GetJobsZhilianFilters, support=root.GetJobsZhilianScanSupport
const raw=JSON.parse(readFileSync(resolve(process.cwd(),'../src/main/resources/zhilian/official-filters.json'),'utf8'))
const types:Record<string,string>={education:'educationType',experience:'workExpType',companyType:'companyType',financing:'financing',companySize:'companySize',workNature:'jobStatus',jobCategory:'jobType',industry:'industry',salary:'salaryType'}
const city=findFilterPath(raw.options.allCity,'765').at(-1)!
const options={...Object.fromEntries(Object.entries(types).map(([k,v])=>[k,raw.options[v]])),district:city.children,subway:raw.options.subway.find((n:any)=>n.code==='765').children}
const catalog={cityCode:'765',cityName:'深圳',version:raw.version,options}
const config={cityCode:'765',salary:'15001,25000',filters:{district:'2038',subwayLine:'201577',subwayStation:'201578',education:['4','5'],experience:['0103'],companyType:['5'],financing:['1'],companySize:['3'],workNature:['2'],jobCategory:'3000100040000',industry:['100080000']}}
// Sanitized DOM fixture of the official filter-select-box component. Hover only
// expands hierarchy columns; selecting or changing a filter is never simulated.
function page(config:any) {
  const spec=api.expected(config,catalog)
  document.body.innerHTML='<div class="filter-select-box filter-region-box"><span class="filter-select-box__label"></span></div>'
  document.querySelector('.filter-select-box__label')!.textContent=spec.region
  for(const group of spec.groups) {
    const box=document.createElement('div');box.className='filter-select-box'
    const label=document.createElement('span');label.className='filter-select-box__label';label.textContent=group.display;box.append(label)
    const render=(nodes:any[],depth:number)=>{
      Array.from(box.querySelectorAll('.filter-select-box__column')).slice(depth).forEach(n=>n.remove())
      const column=document.createElement('ul');column.className='filter-select-box__column'
      for(const node of nodes){
        const li=document.createElement('li');li.className='filter-select-box__item'
        if(group.codes.includes(node.code)||(!group.codes.length&&depth===0&&['不限','全部'].includes(node.name)))li.classList.add('filter-select-box__item--selected')
        const span=document.createElement('span');span.className='filter-select-box__item-text';span.textContent=node.name;li.append(span)
        li.addEventListener('mouseenter',()=>{if(node.children.length)render(node.children,depth+1)})
        column.append(li)
      }box.append(column)
    };render(group.nodes,0);document.body.append(box)
  }
}
describe('official Zhilian filters',()=>{
  it('uses verified official codes and includes all conditions in URL/signature',()=>{
    const url=support.buildSearchUrl('AI',config)
    const params=new URL(url).searchParams
    expect(params.get('re')).toBe('2038');expect(params.get('sc')).toBe('201578');expect(params.get('el')).toBe('4,5');expect(params.get('jt')).toBe('3000100040000');expect(params.get('in')).toBe('100080000')
    expect(support.matchesSearchUrl(url,'AI',config)).toBe(true)
    for(const key of Object.keys(config.filters)) {
      const next={...config,filters:{...config.filters,[key]:Array.isArray(config.filters[key as keyof typeof config.filters])?[]:''}}
      expect(support.matchesSearchUrl(url,'AI',next)).toBe(false)
      expect(support.normalizedSearchParamsForCursor(next)).not.toEqual(support.normalizedSearchParamsForCursor(config))
    }
  })
  it('verifies selected leaves across all official groups',async()=>{
    page(config);await expect(api.verify(document,config,catalog,{sleep:async()=>{}})).resolves.toMatchObject({verified:true})
  })
  it('blocks collection when URL retains a condition but the site ignores it',async()=>{
    page(config);document.querySelectorAll('.filter-select-box__item--selected').forEach(n=>n.classList.remove('filter-select-box__item--selected'))
    await expect(api.verify(document,config,catalog,{sleep:async()=>{}})).rejects.toThrow(/未选中/)
  })
  it('blocks missing dictionaries, foreign city stations, unknown and malformed filters',()=>{
    expect(()=>api.expected(config,{...catalog,cityCode:'530'})).toThrow(/城市/)
    expect(()=>api.expected({...config,filters:{subwayLine:'BAD',subwayStation:'201578'}},catalog)).toThrow(/地铁/)
    expect(()=>api.normalize({education:'4'})).toThrow(/数组/)
    expect(()=>api.normalize({invented:'123'})).toThrow(/不支持/)
    expect(()=>api.normalize({industry:['1','2','3','4','5','6']})).toThrow(/最多/)
  })
  it('preserves ordinary filters while resetting city dependent values and supports old config',async()=>{
    expect(resetCityFilters(config.filters)).toMatchObject({district:'',subwayLine:'',subwayStation:'',education:['4','5']})
    const legacy={cityCode:'765',salary:'0000,9999999'};page(legacy)
    await expect(api.verify(document,legacy,catalog)).resolves.toMatchObject({verified:true})
    expect(support.buildSearchUrl('AI',legacy)).toBe('https://www.zhaopin.com/jobs?jl=765&kw=AI')
  })
})
