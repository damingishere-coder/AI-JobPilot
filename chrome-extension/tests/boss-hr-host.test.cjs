const test=require("node:test");
const assert=require("node:assert/strict");
const {create,PROTOCOL,KEY,ALARM}=require("../boss-hr-host.js");
const crypto=require("node:crypto").webcrypto;
const support=require("../boss-hr-support.js");
const URL_CHAT="https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1";
test("three unchanged list steps pause and preserve the queue without claiming baseline completion",async()=>{
  const h=harness({scan:()=>({success:true,targets:[{uid:"u1",captureId:"preview"}],hasMore:true,nextScrollTop:704})});
  await h.start();
  for(let i=0;i<3;i++)await h.host.tick();
  assert.equal(h.store[KEY].state,"BLOCKED");
  assert.equal(h.store[KEY].errorCode,"HR_LIST_SCROLL_STALLED");
  assert.equal(h.store[KEY].paused,true);
  assert.equal(h.store[KEY].cursor.queue[0].uid,"u1");
  assert.notEqual(h.store[KEY].baselineComplete,true);
  assert.equal(h.requests.some(item=>item.path.endsWith("/watch/captures")),false);
});
function harness(options={}) {
  const store=options.store || {},requests=[],updates=[],created=[],focused=[],alarms=[],messages=[];
  const tabs=options.tabs || [{id:99,windowId:8,url:"http://127.0.0.1:6866/env-config",active:true,status:"complete"}];
  const windows=options.windows || [{id:8,type:"normal",incognito:false}];
  let clock=1_000_000,pageTime=clock,session=null,sequence=0;
  const page={success:true,protocol:PROTOCOL,documentId:"document-1",accountIdentity:"geek:合成用户",accountName:"合成用户",accountRole:"GEEK",accountIdentityStable:false,
    safety:{safe:true},userPaused:false,operation:{active:false},...options.page};
  const chrome={storage:{local:{get:async key=>({[key]:store[key]}),set:async obj=>Object.assign(store,structuredClone(obj))}},
    alarms:{create:async(name,config)=>alarms.push({name,config}),clear:async name=>alarms.push({clear:name})},
    windows:{update:async(...args)=>focused.push(args),get:async id=>{const window=windows.find(item=>item.id===id);if(!window)throw Error("Invalid window ID");return {...window};},
      getAll:async()=>windows.map(item=>({...item}))},
    tabs:{query:async()=>tabs.map(tab=>({...tab})),get:async id=>{const tab=tabs.find(tab=>tab.id===id);if(!tab)throw Error("missing tab");return {...tab};},
      create:async config=>{if(!windows.some(item=>item.id===config.windowId))throw Error("Invalid window ID");created.push(config);const tab={id:7,windowId:8,status:"complete",autoDiscardable:true,...config};tabs.push(tab);return {...tab};},
      update:async(id,config)=>{updates.push({id,config});Object.assign(tabs.find(tab=>tab.id===id),config);},
      sendMessage:async(id,message)=>{messages.push(message);
        if(message.type==="BOSS_HR_HOST_PAGE_PING")return {...page,observedAt:++pageTime};
        if(message.type==="BOSS_HR_HOST_BIND" && message.explicitResume)page.userPaused=false;
        if(message.type==="BOSS_HR_HOST_SCAN_STEP")return options.scan?options.scan(message):message.cursor.stage==="LIST"?{success:true,targets:[{uid:"u1",captureId:"preview"}],hasMore:false,nextScrollTop:0}
          :{success:true,observedAt:++pageTime,capture:{captureId:"whole-round",unreadCount:1,session:{uid:"u1"},messages:[{from:"对方",type:"文本",text:"您好",messageId:"in-1"}],contextComplete:true}};
        return {success:true};}}};
  const response=data=>({success:true,httpStatus:200,data:{success:true,data}});
  const request=async(path,config)=>{requests.push({path,config});
    if(options.request){const override=await options.request(path,config);if(override)return override;}
    if(path.endsWith("/autopilot"))return response({enabled:true,paused:false,replyMode:"AUTO",authorizationValid:true,historyMode:"RECENT",historyDays:30});
    if(path.endsWith("/autopilot/guard"))return response({enabled:true,paused:false,authorizationValid:true,version:3,watchActive:Boolean(session?.watching)});
    if(path==="/api/hr-assistant/status")return response(session || {watching:false});
    if(path.endsWith("/watch/start")){session={watching:true,watchSessionId:"watch-"+(++sequence),hostGeneration:config.body.hostGeneration,pageDocumentId:config.body.pageDocumentId,profileId:config.body.expectedProfileId};return response(session);}
    if(path.endsWith("/watch/heartbeat")){assert.ok(config.body.pageObservedAt>requests.findLast(item=>item.path.endsWith("/watch/start")).config.body.pageObservedAt);return response({});}
    if(path.endsWith("/watch/legacy-anchors"))return response([]);
    if(path.endsWith("/send-commands/claim"))return response(null);
    if(path.endsWith("/watch/captures"))return response({accepted:true,captureId:config.body.captures[0].captureId});
    if(path.endsWith("/dispatch"))return response({dispatched:true});
    if(path.endsWith("/result"))return response({status:config.body.outcome==="SENT"?"SENT_CONFIRMED":"SEND_UNKNOWN"});
    if(/\/send-commands\/[^/]+\/status$/.test(path))return response({state:"UNKNOWN",leaseDeadlineEpochMs:1_000_100});
    if(path.endsWith("/autopilot/pause") || path.endsWith("/autopilot/resume") || path.endsWith("/watch/fault"))return response({});
    if(path.endsWith("/watch/stop")){session=null;return response({});}
    throw Error("unexpected request "+path);};
  const host=create({chrome,request,ensureContent:async()=>{},now:()=>clock,uuid:()=>"generation-"+(++sequence)});
  const sender={tab:{id:99,windowId:8,url:"http://127.0.0.1:6866/env-config"}};
  const start=()=>host.control({type:"BOSS_HR_HOST_START",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL,accountBindingConfirmed:true},sender);
  return {host,start,sender,store,page,tabs,requests,updates,created,focused,alarms,messages,setTime:value=>{clock=value;pageTime=value;},setSession:value=>{session=value;}};
}
test("one click creates one inactive tab and the page supplies a fresh heartbeat",async()=>{
  const h=harness();const result=await h.start();
  assert.equal(result.success,true);assert.equal(result.data.state,"RUNNING");
  assert.equal(h.created.length,1);assert.equal(h.created[0].active,false);assert.equal(h.created[0].windowId,8);
  assert.equal(h.focused.length,0);assert.ok(h.updates.every(item=>!("active" in item.config)));
  assert.equal(h.tabs.find(tab=>tab.id===99).active,true);
  assert.ok(h.alarms.some(item=>item.name===ALARM && item.config.periodInMinutes===.5));
  const start=h.requests.find(item=>item.path.endsWith("/watch/start"));
  const heartbeat=h.requests.find(item=>item.path.endsWith("/watch/heartbeat"));
  assert.ok(heartbeat.config.body.pageObservedAt>start.config.body.pageObservedAt);
  assert.equal(h.store[KEY].cursor.stage,"CAPTURE");
  await h.host.tick();
  assert.equal(h.requests.filter(item=>item.path.endsWith("/watch/captures")).length,1);
  assert.equal(h.store[KEY].operation,null);assert.equal(h.store[KEY].baselineComplete,true);
});
test("start requires a deliberate account confirmation before touching tabs",async()=>{
  const h=harness();const result=await h.host.control({type:"BOSS_HR_HOST_START",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},h.sender);
  assert.equal(result.errorCode,"ACCOUNT_CONFIRMATION_REQUIRED");assert.equal(h.created.length,0);
});
for(const state of ["frozen","discarded"]){
  test(state+" tab blocks without activation, creation, reload or claiming sends",async()=>{
    const h=harness({tabs:[{id:7,windowId:8,url:URL_CHAT,status:"complete",autoDiscardable:true,[state]:true}]});
    const result=await h.start();assert.equal(result.data.state,"BLOCKED");assert.match(result.data.errorCode,new RegExp(state.toUpperCase()));
    assert.equal(h.focused.length,0);assert.equal(h.created.length,0);assert.ok(h.updates.every(item=>!("active" in item.config)));
    assert.equal(h.requests.some(item=>item.path.endsWith("/send-commands/claim")),false);
  });
}
test("loading page retries with persisted intent, without sending",async()=>{
  const h=harness({tabs:[{id:7,windowId:8,url:URL_CHAT,status:"loading"}]});const result=await h.start();
  assert.equal(result.data.state,"RECOVERING");assert.equal(result.data.paused,false);assert.ok(result.data.retryAt>1_000_000);
  assert.equal(h.requests.some(item=>item.path.endsWith("/watch/start")),false);
});
test("pause and stop restore native autoDiscardable and do not resurrect on a new worker",async()=>{
  const h=harness();await h.start();await h.host.control({type:"BOSS_HR_HOST_PAUSE"},h.sender);
  assert.equal(h.store[KEY].paused,true);assert.equal(h.tabs.find(tab=>tab.id===7).autoDiscardable,true);
  const next=harness({store:h.store,tabs:h.tabs});await next.host.initialize();await next.host.tick();
  assert.equal(next.requests.length,0);
  await h.host.control({type:"BOSS_HR_HOST_STOP"},h.sender);assert.equal(h.store[KEY].intentEnabled,false);
});
test("cold worker and backend restart rebind the page, with the same generation and cursor",async()=>{
  const h=harness();await h.start();const generation=h.store[KEY].hostGeneration;
  const next=harness({store:h.store,tabs:h.tabs});await next.host.initialize();await next.host.tick();
  assert.equal(next.store[KEY].hostGeneration,generation);
  assert.equal(next.requests.filter(item=>item.path.endsWith("/watch/start")).length,1);
  assert.equal(next.requests.filter(item=>item.path.endsWith("/watch/captures")).length,1);
});
test("browser restart with only a display name requires confirmation rather than accepting a same-name account",async()=>{
  const h=harness();await h.start();const next=harness({store:h.store,tabs:h.tabs});
  await next.host.initialize(true);await next.host.tick();assert.equal(next.store[KEY].errorCode,"ACCOUNT_RECONFIRM_REQUIRED");
  const result=await next.host.control({type:"BOSS_HR_HOST_RESUME",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},next.sender);
  assert.equal(result.errorCode,"ACCOUNT_RECONFIRM_REQUIRED");
});
test("dispatched or claimed send after worker restart is never reclaimed or replayed",async()=>{
  for(const phase of ["CLAIMED","DISPATCHED"]){
    const h=harness();await h.start();await h.host.update({operation:{kind:"SEND",phase,commandId:"command-1",deadlineAt:1_000_100}});
    const next=harness({store:h.store,tabs:h.tabs});await next.host.initialize();next.setTime(1_200_000);await next.host.tick();
    assert.equal(next.store[KEY].errorCode,"SEND_RESULT_UNKNOWN");assert.equal(next.requests.filter(item=>!item.path.endsWith("/watch/fault")).length,0);
    assert.equal(next.messages.some(item=>item.type==="BOSS_HR_SEND_V2"),false);
  }
});
test("capture ack loss keeps the same cursor and retries reads without generating another command",async()=>{
  const h=harness({request:async path=>path.endsWith("/watch/captures")?{success:false,httpStatus:503,message:"offline"}:null});
  await h.start();await h.host.tick();assert.equal(h.store[KEY].state,"RECOVERING");
  assert.equal(h.store[KEY].cursor.queue[0].uid,"u1");assert.equal(h.store[KEY].operation,null);
});
test("old documents, foreign frames and generations cannot arm or report a send",async()=>{
  const h=harness();await h.start();const s=h.store[KEY];
  const msg={type:"BOSS_HR_HOST_DISPATCH",hostGeneration:s.hostGeneration,documentId:s.pageDocumentId,commandId:"c"};
  assert.equal((await h.host.content(msg,{tab:{id:7,url:URL_CHAT},frameId:1})).success,false);
  assert.equal((await h.host.content({...msg,documentId:"old"},{tab:{id:7,url:URL_CHAT}})).success,false);
  assert.equal((await h.host.content({...msg,hostGeneration:"old"},{tab:{id:7,url:URL_CHAT}})).success,false);
});
test("explicit view is the only host command that may focus Chrome",async()=>{
  const h=harness();await h.start();await h.host.control({type:"BOSS_HR_HOST_VIEW"},h.sender);
  assert.equal(h.focused.length,1);assert.equal(h.updates.filter(item=>item.config.active===true).length,1);
});
for(const action of ["STOP","PAUSE"]){
  test(action+" while an old tick awaits the backend cannot revive it",async()=>{
    let release,entered;
    const started=new Promise(resolve=>{entered=resolve;});
    const pending=new Promise(resolve=>{release=resolve;});
    const h=harness({request:async path=>{if(path.endsWith("/status")){entered();await pending;}return null;}});
    const work=h.start();await started;
    await h.host.control({type:"BOSS_HR_HOST_"+action},h.sender);release();await work;
    assert.equal(h.store[KEY].state,action==="STOP"?"STOPPED":"PAUSED");
    assert.equal(h.requests.some(item=>item.path.endsWith("/watch/start")),false);
    assert.equal(h.requests.some(item=>item.path.endsWith("/send-commands/claim")),false);
  });
}
test("cancelling an in-flight backend start stops its late accepted binding",async()=>{
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});const pending=new Promise(resolve=>{release=resolve;});
  const h=harness({request:async path=>{if(path.endsWith("/watch/start")){entered();await pending;}return null;}});
  const work=h.start();await started;await h.host.control({type:"BOSS_HR_HOST_STOP"},h.sender);release();await work;
  assert.equal(h.store[KEY].state,"STOPPED");assert.equal(h.requests.filter(item=>item.path.endsWith("/watch/stop")).length,1);
  assert.equal(h.requests.some(item=>item.path.endsWith("/send-commands/claim")),false);
});
test("source capture identity changes with a new identical preview and ignores history expansion",async()=>{
  const inbound={from:"对方",type:"文本",text:"您好",time:"今天",messageId:"hr-1",media:[]};
  const first=await support.sourceCaptureId("uid",[{from:"本人",type:"文本",text:"旧回复",messageId:"self-1"},inbound],"geek-id:1",crypto);
  const second=await support.sourceCaptureId("uid",[{...inbound,messageId:"hr-2"}],"geek-id:1",crypto);
  const expanded=await support.sourceCaptureId("uid",[{from:"对方",text:"更早历史"},{from:"本人",text:"旧回复",messageId:"self-1"},inbound],"geek-id:1",crypto);
  assert.notEqual(first,second);assert.equal(first,expanded);
});
test("QQ pause is persistent and explicit resume clears backend policy before restarting",async()=>{
  let paused=false;
  const h=harness({request:async(path)=>{
    if(path.endsWith("/autopilot/resume")){paused=false;return null;}
    if(path.endsWith("/autopilot"))return {success:true,httpStatus:200,data:{data:{enabled:true,paused,replyMode:"AUTO",authorizationValid:true,historyMode:"RECENT",historyDays:30}}};
    return null;
  }});
  await h.start();paused=true;await h.host.tick();
  assert.equal(h.store[KEY].paused,true);assert.equal(h.store[KEY].pauseOrigin,"REMOTE");
  const requests=h.requests.length;await h.host.tick();assert.equal(h.store[KEY].paused,true);
  assert.equal(h.requests.slice(requests).some(item=>item.path.endsWith("/send-commands/claim")),false);
  const resumed=await h.host.control({type:"BOSS_HR_HOST_RESUME",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},h.sender);
  assert.equal(resumed.success,true);assert.equal(h.store[KEY].paused,false);assert.equal(h.store[KEY].state,"RUNNING");
  assert.ok(h.requests.find(item=>item.path.endsWith("/autopilot/resume")).config.body.transport==="CHROME_BACKGROUND");
});
test("permanent capture rejection blocks with preserved cursor and one fault notification",async()=>{
  const h=harness({request:async path=>path.endsWith("/watch/captures")?{success:false,httpStatus:409,errorType:"CAPTURE_CONFLICT",message:"conflict"}:null});
  await h.start();await h.host.tick();assert.equal(h.store[KEY].state,"BLOCKED");assert.equal(h.store[KEY].cursor.queue[0].uid,"u1");
  assert.equal(h.requests.filter(item=>item.path.endsWith("/watch/fault")).length,1);
  const count=h.requests.length;await h.host.tick();assert.equal(h.requests.length,count);
});
test("a stopped backend makes the final send guard deny even with valid AUTO authorization",async()=>{
  const h=harness();await h.start();h.setSession({watching:false});const s=h.store[KEY];
  const result=await h.host.content({type:"BOSS_HR_HOST_GUARD",hostGeneration:s.hostGeneration,documentId:s.pageDocumentId,
    accountIdentity:s.accountIdentity,observedAt:1_000_050},{tab:{id:7,url:URL_CHAT}});
  assert.equal(result.success,false);assert.equal(result.watchActive,false);
  assert.equal(h.requests.findLast(item=>item.path.endsWith("/autopilot/guard")).config.body.watchSessionId,s.watchSessionId);
});
for(const receipt of ["SENT_CONFIRMED","SEND_UNKNOWN"]){
  test("late "+receipt+" after STOP records the result while preserving STOPPED",async()=>{
    const h=harness({request:async path=>path.endsWith("/result")?{success:true,httpStatus:200,data:{data:{status:receipt}}}:null});
    await h.start();const s=structuredClone(h.store[KEY]);
    await h.host.update({operation:{kind:"SEND",phase:"DISPATCHED",commandId:"command",leaseToken:"lease",watchSessionId:s.watchSessionId,deadlineAt:1_000_100}});
    await h.host.control({type:"BOSS_HR_HOST_STOP"},h.sender);
    const result=await h.host.content({type:"BOSS_HR_HOST_RESULT",hostGeneration:s.hostGeneration,documentId:s.pageDocumentId,commandId:"command",leaseToken:"lease",outcome:"SENT"},{tab:{id:7,url:URL_CHAT}});
    assert.equal(result.success,true);assert.equal(h.store[KEY].state,"STOPPED");assert.equal(h.store[KEY].intentEnabled,false);
    assert.equal(h.store[KEY].paused,false);assert.equal(h.store[KEY].operation,null);
    assert.equal(h.requests.findLast(item=>item.path.endsWith("/result")).config.body.watchSessionId,s.watchSessionId);
  });
}
test("backend downgrade of SENT blocks the active host rather than claiming successful delivery",async()=>{
  const h=harness({request:async path=>path.endsWith("/result")?{success:true,httpStatus:200,data:{data:{status:"SEND_UNKNOWN"}}}:null});
  await h.start();const s=h.store[KEY];await h.host.update({operation:{kind:"SEND",phase:"DISPATCHED",commandId:"c",leaseToken:"l",watchSessionId:s.watchSessionId,deadlineAt:1_000_100}});
  await h.host.content({type:"BOSS_HR_HOST_RESULT",hostGeneration:s.hostGeneration,documentId:s.pageDocumentId,commandId:"c",leaseToken:"l",outcome:"SENT"},{tab:{id:7,url:URL_CHAT}});
  assert.equal(h.store[KEY].state,"BLOCKED");assert.equal(h.store[KEY].paused,true);assert.equal(h.store[KEY].errorCode,"SEND_RESULT_UNKNOWN");
});
test("page reload safely stops its old binding before starting the new document",async()=>{
  const h=harness();await h.start();h.page.documentId="document-2";await h.host.changed(7,{status:"complete"},h.tabs.find(tab=>tab.id===7));
  const before=h.requests.length;await h.host.tick();const paths=h.requests.slice(before).map(item=>item.path);
  assert.ok(paths.findIndex(path=>path.endsWith("/watch/stop"))<paths.findIndex(path=>path.endsWith("/watch/start")));
  assert.equal(h.store[KEY].state,"RUNNING");assert.equal(h.store[KEY].pageDocumentId,"document-2");
});
for(const checkpoint of ["UNKNOWN","SENT","BLOCKED"]){
  test("explicit resume after "+checkpoint+" freezes only the old command and accepts its late report",async()=>{
    const h=harness({request:async path=>/\/send-commands\/c\/status$/.test(path)?{success:true,httpStatus:200,data:{data:{state:checkpoint}}}:null});
    await h.start();const old=structuredClone(h.store[KEY]);
    await h.host.update({operation:{kind:"SEND",phase:"DISPATCHED",commandId:"c",leaseToken:"old-lease",watchSessionId:old.watchSessionId,
      hostGeneration:old.hostGeneration,pageDocumentId:old.pageDocumentId,accountIdentity:old.accountIdentity,tabId:old.tabId,pageObservedAt:old.lastPageSeenAt,deadlineAt:1_000_100}});
    await h.host.control({type:"BOSS_HR_HOST_PAUSE"},h.sender);h.setTime(1_030_000);
    const resumed=await h.host.control({type:"BOSS_HR_HOST_RESUME",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},h.sender);
    assert.equal(resumed.success,true);assert.equal(h.store[KEY].state,"RUNNING");assert.equal(h.store[KEY].operation,null);
    assert.equal(h.store[KEY].retiredOperations[0].checkpointState,checkpoint);
    assert.ok(h.store[KEY].controlRevision>old.controlRevision);
    const currentGeneration=h.store[KEY].hostGeneration;
    const late=await h.host.content({type:"BOSS_HR_HOST_RESULT",hostGeneration:old.hostGeneration,documentId:old.pageDocumentId,
      commandId:"c",leaseToken:"old-lease",outcome:"SENT",observedAt:1_030_050},{tab:{id:old.tabId,url:URL_CHAT}});
    assert.equal(late.success,true);assert.equal(h.store[KEY].hostGeneration,currentGeneration);assert.equal(h.store[KEY].state,"RUNNING");
    assert.equal(h.requests.filter(item=>item.path.endsWith("/result") && item.config.body.outcome==="RESULT_UNKNOWN").length,1);
    assert.equal(h.messages.some(item=>item.type==="BOSS_HR_SEND_V2"),false);
    assert.equal((await h.host.status()).data.retiredOperations,undefined);
  });
}
for(const checkpoint of ["LEASED","UNAVAILABLE"]){
  test(checkpoint+" checkpoint cannot clear an unknown send on explicit resume",async()=>{
    const h=harness({request:async path=>/\/send-commands\/c\/status$/.test(path)?(checkpoint==="UNAVAILABLE"?{success:false,httpStatus:503}:{success:true,httpStatus:200,data:{data:{state:checkpoint}}}):null});
    await h.start();const s=h.store[KEY];await h.host.update({operation:{kind:"SEND",commandId:"c",leaseToken:"l",watchSessionId:s.watchSessionId,deadlineAt:1_000_100}});
    await h.host.control({type:"BOSS_HR_HOST_PAUSE"},h.sender);h.setTime(1_030_000);
    const resume=()=>h.host.control({type:"BOSS_HR_HOST_RESUME",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},h.sender);
    assert.equal((await resume()).errorCode,"SEND_RESULT_PENDING");assert.equal((await resume()).errorCode,"SEND_RESULT_PENDING");
    assert.equal(h.store[KEY].operation.commandId,"c");assert.equal(h.store[KEY].state,"PAUSED");
    assert.equal(h.requests.filter(item=>item.path.endsWith("/result")).length,1);
    assert.equal(h.requests.filter(item=>item.path.endsWith("/autopilot/resume")).length,0);
  });
}
for(const replyMode of ["AUTO","REVIEW"])for(const historyMode of ["RECENT","NEW_ONLY"]){
  test(replyMode+" "+historyMode+" policy is supported by the background reader",async()=>{
    const h=harness({request:async path=>path.endsWith("/autopilot")?{success:true,httpStatus:200,data:{data:{enabled:true,paused:false,authorizationValid:true,replyMode,historyMode,historyDays:30}}}:null});
    await h.start();assert.equal(h.store[KEY].state,"RUNNING");
  });
}
test("an explicitly confirmed start after STOP binds the new account and rebuilds baseline",async()=>{
  const h=harness();await h.start();await h.host.tick();assert.equal(h.store[KEY].baselineComplete,true);
  await h.host.control({type:"BOSS_HR_HOST_STOP"},h.sender);
  h.page.accountIdentity="geek:新账号";h.page.accountName="新账号";
  const next=await h.start();assert.equal(next.success,true);assert.equal(h.store[KEY].state,"RUNNING");
  assert.equal(h.store[KEY].accountIdentity,"geek:新账号");assert.equal(h.store[KEY].cursor.baseline,true);
});
test("same-profile backend analysis still exiting is a bounded retry, not a permanent block",async()=>{
  const h=harness({request:async path=>path.endsWith("/watch/start")?{success:false,httpStatus:409,errorType:"HR_WATCH_ACTIVE",message:"analysis finishing"}:null});
  await h.start();assert.equal(h.store[KEY].state,"RECOVERING");assert.equal(h.store[KEY].paused,false);assert.ok(h.store[KEY].retryAt>1_000_000);
});
test("account confirmation immediately after Chrome startup is applied before a recoverable tick",async()=>{
  const h=harness();await h.start();await h.host.initialize(true);
  assert.equal(h.store[KEY].paused,false);assert.equal(h.store[KEY].needsAccountConfirmation,true);
  const resumed=await h.host.control({type:"BOSS_HR_HOST_RESUME",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL,accountBindingConfirmed:true},h.sender);
  assert.equal(resumed.success,true);assert.equal(h.store[KEY].needsAccountConfirmation,false);assert.equal(h.store[KEY].state,"RUNNING");
  assert.equal(h.requests.filter(item=>item.path.endsWith("/autopilot/resume")).length,1);
});
test("Chrome startup replaces a stale saved window ID using an existing inactive normal window",async()=>{
  const h=harness({page:{accountIdentityStable:true}});await h.start();
  const next=harness({store:h.store,tabs:[{id:20,windowId:42,url:"https://example.test/",active:true,status:"complete"}],
    windows:[{id:42,type:"normal",incognito:false}],page:{accountIdentityStable:true}});
  await next.host.initialize(true);await next.host.tick();
  assert.equal(next.store[KEY].state,"RUNNING");assert.equal(next.created.length,1);
  assert.equal(next.created[0].windowId,42);assert.equal(next.created[0].active,false);
  assert.equal(next.store[KEY].workbenchWindowId,42);assert.equal(next.focused.length,0);
  assert.ok(next.updates.every(item=>!("active" in item.config)));assert.equal(next.tabs.find(item=>item.id===20).active,true);
});
test("Chrome startup with no normal window remains recoverable and never creates or focuses a window",async()=>{
  const h=harness({page:{accountIdentityStable:true}});await h.start();
  const next=harness({store:h.store,tabs:[],windows:[{id:41,type:"popup",incognito:false},{id:43,type:"normal",incognito:true}],page:{accountIdentityStable:true}});
  await next.host.initialize(true);await next.host.tick();
  assert.equal(next.store[KEY].state,"RECOVERING");assert.equal(next.store[KEY].paused,false);
  assert.equal(next.store[KEY].errorCode,"HR_BROWSER_WINDOW_UNAVAILABLE");assert.equal(next.created.length,0);assert.equal(next.focused.length,0);
});
