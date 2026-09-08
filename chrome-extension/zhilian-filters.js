(function(root) {
  const version = '2026-09-08-official-filters';
  if(root.GetJobsZhilianFilters?.version === version) return;
  const fields = [
    ['education','el','学历',true],['experience','we','经验',true],['companyType','ct','公司性质',true],
    ['financing','fs','融资阶段',true],['companySize','cs','公司人数',true],['workNature','et','工作性质',true],
    ['jobCategory','jt','职位类别',false],['industry','in','公司行业',true],
  ];
  const scalar = [['district','re'],['subwayLine','li'],['subwayStation','sc']];
  function normalize(input={}) {
    const result={}; const keys=new Set([...fields,...scalar].map(f=>f[0]));
    for(const key of Object.keys(input||{})) if(!keys.has(key)) throw new Error(`不支持的智联筛选：${key}`);
    for(const [key,,,multi] of [...scalar,...fields]) {
      const value=input?.[key];
      if(multi) {
        if(value!=null && (!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v.trim()))) throw new Error(`智联 ${key} 必须是官方代码数组`);
        result[key]=[...new Set(value||[])].sort();
      } else {
        if(value!=null && typeof value!=='string') throw new Error(`智联 ${key} 必须是单个官方代码`);
        result[key]=value||'';
      }
    }
    if(result.industry.length>5) throw new Error('公司行业最多选择 5 项');
    return result;
  }
  function query(filters={}) {
    const data=normalize(filters); const result={};
    for(const [key,param] of [...scalar,...fields]) {
      const value=Array.isArray(data[key])?data[key].join(','):data[key];
      if(value)result[param]=value;
    }
    return result;
  }
  function matches(url,filters={}) {
    const actual=new URL(url).searchParams, expected=query(filters);
    return [...scalar,...fields].every(([key,param,,,])=>{
      const value=actual.get(param)||'';
      return value===(expected[param]||'');
    });
  }
  function pathTo(nodes,code,parents=[],leafOnly=false) {
    for(const node of nodes||[]) {
      const path=[...parents,node];
      if(node.code===code && (!leafOnly||!node.children?.length))return path;
      const found=pathTo(node.children,code,path,leafOnly);if(found.length)return found;
    }
    return [];
  }
  function expected(config,catalog) {
    if(!catalog?.version || String(catalog.cityCode)!==String(config.cityCode||'489')) throw new Error('官方筛选字典与城市不匹配');
    const filters=normalize(config.filters), options=catalog.options;
    const groups=[];
    if(options.subway?.length) {
      let codes=[];
      if(filters.subwayStation) {
        const line=options.subway.find(n=>n.code===filters.subwayLine);
        if(!line || !pathTo(line.children,filters.subwayStation,[],true).length)throw new Error('地铁线路或站点与城市不匹配');
        codes=[filters.subwayStation];
      } else if(filters.subwayLine)throw new Error('地铁线路缺少站点条件');
      groups.push({label:'地铁',codes,nodes:options.subway});
    } else if(filters.subwayLine||filters.subwayStation)throw new Error('该城市没有对应地铁选项');
    groups.push({label:'薪资',codes:config.salary && config.salary!=='0000,9999999'?[config.salary]:[],nodes:options.salary});
    for(const [key,,label,multi] of fields)groups.push({label,codes:multi?filters[key]:filters[key]?[filters[key]]:[],nodes:options[key]});
    for(const group of groups) {
      group.paths=group.codes.map(code=>{
        const path=pathTo(group.nodes,code,[],true);
        if(!path.length || (path.length===1 && ['不限','全部'].includes(path[0].name)))throw new Error(`${group.label}包含无效的官方选项：${code}`);
        return path;
      });
      group.display=group.codes.length>1?`${group.label}·${group.codes.length}`:group.codes.length?pathTo(group.nodes,group.codes[0])[0] && pathTo(group.nodes,group.codes[0]).at(-1).name:group.label;
    }
    let region=catalog.cityName;
    if(filters.district) {
      const path=pathTo(options.district,filters.district,[],true);
      if(!path.length)throw new Error('地区细分与城市不匹配');
      region=path.at(-1).name;
    }
    return {groups,region};
  }
  async function verify(document,config,catalog,{sleep,shouldStop}={}) {
    const spec=expected(config,catalog);
    const pause=sleep||(()=>Promise.resolve());
    const check=async()=>{if(await shouldStop?.())throw new Error('扫描所有权已变化或已停止');};
    await check();
    const boxes=Array.from(document.querySelectorAll('.filter-select-box'));
    const region=boxes.find(n=>n.classList.contains('filter-region-box'));
    if(region?.querySelector('.filter-select-box__label')?.textContent.trim()!==spec.region)throw new Error(`地区筛选未生效：期望 ${spec.region}`);
    const selects=boxes.filter(n=>n!==region);
    if(selects.length!==spec.groups.length)throw new Error('智联筛选组件结构变化，无法确认条件，已停止采集');
    for(let index=0;index<selects.length;index++) {
      await check();
      const box=selects[index], group=spec.groups[index];
      if(box.querySelector('.filter-select-box__label')?.textContent.trim()!==group.display)throw new Error(`${group.label}未生效：期望 ${group.display}`);
      if(!group.codes.length) {
        const selected=Array.from(box.querySelectorAll('.filter-select-box__item--selected .filter-select-box__item-text')).map(n=>n.textContent.trim());
        if(selected.length!==1 || !['不限','全部'].includes(selected[0]))throw new Error(`${group.label}不限状态无法确认`);
      }
      for(const path of group.paths) {
        for(let depth=0;depth<path.length;depth++) {
          await check();
          const column=box.querySelectorAll('.filter-select-box__column')[depth];
          const node=Array.from(column?.querySelectorAll('.filter-select-box__item')||[]).find(n=>n.querySelector('.filter-select-box__item-text')?.textContent.trim()===path[depth].name);
          if(!node)throw new Error(`${group.label}选项未找到：${path[depth].name}`);
          if(depth<path.length-1) {node.dispatchEvent(new document.defaultView.MouseEvent('mouseenter',{bubbles:false}));await pause(80);}
          else if(!node.classList.contains('filter-select-box__item--selected'))throw new Error(`${group.label}未选中：${path[depth].name}`);
        }
      }
    }
    return {verified:true,version:catalog.version};
  }
  root.GetJobsZhilianFilters={version,fields,normalize,query,matches,pathTo,expected,verify};
})(typeof window==='undefined'?globalThis:window);
