(function(root) {
  const KEY = '__GET_JOBS_SCAN_OBSERVER_V1__';
  const LIMIT = 500;
  function code(value) { const s = String(value || ''); return /^[\w:-]{0,80}$/.test(s) ? s : 'UNCLASSIFIED_ERROR'; }
  function observation(p) {
    const stage=code(p.stage),errorCode=code(p.errorType || p.diagnosticType || p.errorCode || (p.type==='error'?'SCAN_STEP_ERROR':''));
    const state=stage==='complete'?(p.outcome==='partial'?'PARTIAL':'COMPLETE'):stage==='stopped'?'STOPPED':p.paused||stage==='blocked'||stage==='submitBatchFailed'?'BLOCKED':stage==='error'?'FAILED':'RUNNING';
    const counters={};
    for(const [dest,keys] of Object.entries({read:['totalRead','collected'],duplicates:['historyDuplicates'],detailFailures:['detailFailures'],submissionFailures:['submissionFailures'],keywordIndex:['keywordIndex'],keywordTotal:['keywordTotal'],httpStatus:['httpStatus']})) {
      const key=keys.find(k=>p[k]!==undefined);if(key)counters[dest]=Math.max(0,Number(p[key])||0);
    }
    const out={kind:errorCode?'error':'progress',state,counters};
    if(stage)out.stage=stage;
    if(errorCode)out.errorCode=errorCode;
    if(p.keyword!==undefined)out.keyword=String(p.keyword).slice(0,120);
    if(p.stopReason||p.outcome)out.stopReason=code(p.stopReason||p.outcome);
    if(Array.isArray(p.keywordResults))out.keywordResults=p.keywordResults.map(k=>({keyword:String(k.keyword||'').slice(0,120),read:Number(k.collected||0),duplicates:Number(k.historyDuplicates||0),detailFailures:Number(k.detailFailures||0),submissionFailures:Number(k.submissionFailures||0),stopReason:code(k.stopReason),outcome:code(k.outcome)}));
    return out;
  }

  function create({storage, request, version, uuid = () => crypto.randomUUID()}) {
    let queue = Promise.resolve();
    const serial = fn => { const work = queue.then(fn); queue = work.catch(()=>{}); return work; };
    const load = async () => (await storage.get(KEY))[KEY] || {};
    const save = runs => storage.set({[KEY]: runs});
    const key = t => `${t.platform}:${t.profileId}:${t.runId}`;
    function append(r, payload) {
      const item = observation(payload);
      // Coalesce identical progress snapshots; errors and terminal transitions remain durable.
      const signature=JSON.stringify(item);
      if (signature === r.signature && item.kind !== 'error') return;
      if (r.events.length >= LIMIT) { r.overflow=true; r.offline=true; return; }
      r.signature=signature;
      r.events.push({...item,eventId:uuid(),epoch:r.epoch,seq:++r.seq,observedAt:Date.now()});
    }
    async function flush(r, page, ack) {
      if(r.offline && !r.offlineReported && r.events.length<LIMIT) {
        append(r,{stage:'blocked',paused:true,errorCode:r.overflow?'LOG_QUEUE_FULL':'BACKEND_UNAVAILABLE'}); r.offlineReported=true;
      }
      const response=await request(`/api/scan-runs/${encodeURIComponent(r.runId)}/sync?platform=${r.platform}&profileId=${r.profileId}`, {
        operation:'runtime-scan-sync',method:'POST',requireActionToken:true,timeoutMs:5000,
        body:{epoch:r.epoch,pageAlive:!!page,extensionVersion:version,contentVersion:r.contentVersion,
          ack,events:r.events.slice(0,100)} });
      if(!response.success) { r.offline=true; return {success:false,errorCode:response.errorType || 'BACKEND_UNAVAILABLE'}; }
      const data=response.data, accepted=new Set(data.acceptedEventIds || []);
      r.events=r.events.filter(e=>!accepted.has(e.eventId));
      if(data.epoch!==r.epoch) {r.epoch=data.epoch;r.seq=0;}
      r.directive=data;
      if(ack?.ok && data.desired==='RUNNING') {r.offline=false;r.overflow=false;r.offlineReported=false;}
      return {...data,localPaused:!!r.offline};
    }
    return {
      attach: t => serial(async()=>{const runs=await load(), k=key(t);
        const old=runs[k];
        runs[k]={...(old || {epoch:1,seq:0,events:[]}),...t}; await save(runs);
      }),
      event: (t,p) => serial(async()=>{const runs=await load(),r=runs[key(t)];if(!r)return;
        if(r.instanceId && p.scanInstanceId && Number(String(p.scanInstanceId).split("-")[0])<Number(String(r.instanceId).split("-")[0]))return;
        append(r,p);await save(runs);
      }),
      sync: t => serial(async()=>{const runs=await load(),r=runs[key(t)];
        if(!r || r.ownerToken!==t.ownerToken || r.tabId!==t.tabId) return {success:false,errorCode:'SCAN_OWNER_MISMATCH'};
        if(r.instanceId && t.instanceId && Number(String(t.instanceId).split('-')[0])<Number(String(r.instanceId).split('-')[0])) return {success:false,errorCode:'STALE_SCAN_PAGE'};
        if(t.instanceId)r.instanceId=t.instanceId;
        if(t.fault)r.offline=true;
        r.contentVersion=t.contentVersion || r.contentVersion;
        // Write the ack into durable storage before sending; replay after worker restart is safe.
        if(t.ack) r.ack=t.ack;
        await save(runs);
        let result;
        try {result=await flush(r,true,r.ack);if(result.success && !result.commands?.some(c=>c.id===r.ack?.id)) delete r.ack;}
        catch(_) {r.offline=true;result={success:false,errorCode:'BACKEND_UNAVAILABLE'};}
        await save(runs);return result;
      }),
      tick: () => serial(async()=>{const runs=await load();
        for(const r of Object.values(runs)) {
          if(!r.events.length && ['COMPLETE','PARTIAL','FAILED','STOPPED'].includes(r.directive?.state)) continue;
          try {const result=await flush(r,false,r.ack);if(result.success && !result.commands?.some(c=>c.id===r.ack?.id))delete r.ack;} catch(_){r.offline=true;}
        } await save(runs);
      }),
      closed: tabId => serial(async()=>{const runs=await load();for(const r of Object.values(runs)) if(r.tabId===tabId && !['COMPLETE','PARTIAL','FAILED','STOPPED'].includes(r.directive?.state)) append(r,{stage:'blocked',paused:true,errorCode:'SCAN_TAB_CLOSED'});await save(runs);}),
    };
  }
  root.GetJobsScanObserver={create,observation};
  if(typeof module!=='undefined') module.exports=root.GetJobsScanObserver;
})(globalThis);
