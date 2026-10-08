const test=require("node:test");
const assert=require("node:assert/strict");
const {create,PROTOCOL,KEY,ALARM}=require("../boss-hr-host.js");
const crypto=require("node:crypto").webcrypto;
const support=require("../boss-hr-support.js");
const URL_CHAT="https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1";
const PATROL_NOW=Date.parse('2026-10-08T02:00:00Z');
function patrolHarness(items,options={}) {
  const opened=[];
  let policy={enabled:true,paused:false,authorizationValid:true,replyMode:'AUTO',historyMode:'RECENT',historyDays:15,...options.policy};
  const h=harness({time:PATROL_NOW,store:options.store,
    request:async(path,config)=> {
      if(options.request){const result=await options.request(path,config);if(result)return result;}
      if(path.endsWith('/autopilot'))return {success:true,httpStatus:200,data:{data:policy}};
      if(path.endsWith('/watch/legacy-anchors'))return {success:true,httpStatus:200,data:{data:options.legacy || []}};
    },scan:message=> {
      if(message.cursor.stage==='LIST')return {success:true,targets:items.filter(item=>message.cursor.scope==='ALL' || item.unreadCount),hasMore:false,nextScrollTop:0};
      if(!message.target)return {success:true,capture:null};
      opened.push(message.target.uid);
      const item=items.find(item=>item.uid===message.target.uid);
      const observation={...item,unreadCount:0,lastDirection:item.lastDirection || '对方'};
      return {success:true,observation,capture:observation.lastDirection==='本人'?null:{captureId:'round-'+item.previewKey,unreadCount:1,
        session:{uid:item.uid},messages:[{from:'对方',text:'合成新消息',type:'文本'}],contextComplete:true}};
    }});
  return {...h,opened,setItems:value=>{items=value;},setPolicy:value=>{policy={...policy,...value};},
    finish:async()=>{for(let step=0;h.store[KEY].cursor && step<25;step++)await h.host.tick();assert.equal(h.store[KEY].cursor,null);}};
}
const patrolItem=(uid,lastTime,changes={})=>({uid,lastTime,previewKey:uid+'-preview',unreadCount:0,...changes});

test('RECENT baseline opens only the authorized fifteen-day range, including its calendar boundary',async()=>{
  const h=patrolHarness([patrolItem('two-months','2026-08-08',{unreadCount:1}),patrolItem('month','09-08'),
    patrolItem('expired','09-22',{unreadCount:1}),patrolItem('boundary','09-23'),patrolItem('recent','今天')]);
  await h.start();await h.finish();
  assert.deepEqual(h.opened,['boundary','recent']);
  assert.equal(h.requests.filter(r=>r.path.endsWith('/watch/captures')).length,2);
});
test('NEW_ONLY baseline catalogs previews without opening old unread or recent conversations',async()=>{
  const h=patrolHarness([patrolItem('old','09-08',{unreadCount:2}),patrolItem('recent','今天',{unreadCount:1})],{policy:{historyMode:'NEW_ONLY'}});
  await h.start();await h.finish();assert.deepEqual(h.opened,[]);
  h.setTime(PATROL_NOW+60001);await h.host.tick();await h.finish();assert.deepEqual(h.opened,[]);
  assert.equal(h.requests.some(r=>r.path.endsWith('/watch/captures')),false);
  assert.equal(Object.keys(h.store[KEY].previews).length,2);
});
test('an old contact with a new incoming message is eligible immediately after NEW_ONLY cataloging',async()=>{
  const h=patrolHarness([patrolItem('old-contact','09-08')],{policy:{historyMode:'NEW_ONLY'}});
  await h.start();await h.finish();
  h.setItems([patrolItem('old-contact','今天',{previewKey:'new-question',unreadCount:1})]);
  h.setTime(PATROL_NOW+60001);await h.host.tick();await h.finish();
  assert.deepEqual(h.opened,['old-contact']);assert.equal(h.messages.findLast(m=>m.type==='BOSS_HR_HOST_SCAN_STEP').cursor.baseline,false);
});
test('legacy unknown records do not force ALL or reopen unchanged recent conversations',async()=>{
  const h=patrolHarness([patrolItem('recent','今天')],{legacy:[{conversationId:132,status:'READ_ONLY'}]});
  await h.start();await h.finish();
  h.setTime(PATROL_NOW+60001);await h.host.tick();await h.finish();
  assert.equal(h.messages.findLast(m=>m.type==='BOSS_HR_HOST_SCAN_STEP' && m.cursor.stage==='LIST').cursor.scope,'UNREAD');
  h.setTime(PATROL_NOW+1800001);await h.host.tick();await h.finish();
  assert.deepEqual(h.opened,['recent']);assert.equal(h.store[KEY].paused,false);
});
test('answered conversations stay closed until a new HR preview arrives even without an unread badge',async()=>{
  const h=patrolHarness([patrolItem('answered','今天',{lastDirection:'本人'})]);
  await h.start();await h.finish();
  h.setTime(PATROL_NOW+1800001);await h.host.tick();await h.finish();assert.deepEqual(h.opened,['answered']);
  h.setItems([patrolItem('answered','今天',{previewKey:'fresh-HR-question'})]);
  h.setTime(PATROL_NOW+3600002);await h.host.tick();await h.finish();assert.deepEqual(h.opened,['answered','answered']);
});
test('relative date labels changing overnight do not reopen an unchanged preview',async()=>{
  const h=patrolHarness([patrolItem('answered','今天 10:00',{lastDirection:'本人'})]);
  await h.start();await h.finish();
  h.setItems([patrolItem('answered','昨天 10:00',{lastDirection:'本人'})]);
  h.setTime(PATROL_NOW+86400000);await h.host.tick();await h.finish();assert.deepEqual(h.opened,['answered']);
});
test('worker restart and explicit resume retain completed preview evidence',async()=>{
  const items=[patrolItem('answered','今天',{lastDirection:'本人'})],h=patrolHarness(items);
  await h.start();await h.finish();await h.host.control({type:'BOSS_HR_HOST_PAUSE'},h.sender);
  const next=patrolHarness(items,{store:h.store});next.setTime(PATROL_NOW+1800001);
  await next.host.control({type:'BOSS_HR_HOST_RESUME',expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},next.sender);await next.finish();
  assert.deepEqual(next.opened,[]);assert.equal(next.store[KEY].previews.answered.lastDirection,'本人');
});
test('a saved pre-upgrade full capture queue is rebuilt before opening its old target',async()=>{
  const h=patrolHarness([patrolItem('old','09-08')],{policy:{historyMode:'NEW_ONLY'}});
  await h.start();await h.finish();
  await h.host.update({patrolVersion:0,previews:{},cursor:{stage:'CAPTURE',scope:'ALL',queue:[{uid:'old'}],seen:['old']}});
  await h.host.tick();await h.finish();assert.deepEqual(h.opened,[]);
});
test('upgrading a completed NEW_ONLY baseline preserves recent unread without opening read history',async()=>{
  const h=patrolHarness([],{policy:{historyMode:'NEW_ONLY'}});await h.start();await h.finish();
  h.setItems([patrolItem('unhandled','今天',{unreadCount:1}),patrolItem('read-history','今天'),patrolItem('old-unread','09-08',{unreadCount:1})]);
  await h.host.update({patrolVersion:0,previews:{},cursor:{stage:'CAPTURE',scope:'ALL',queue:[{uid:'unhandled'}],seen:['unhandled']}});
  await h.host.tick();await h.finish();assert.deepEqual(h.opened,['unhandled']);
  assert.equal(h.messages.findLast(m=>m.type==='BOSS_HR_HOST_SCAN_STEP').cursor.baseline,false);
});
test('narrowing history policy discards a now-expired queued target without opening it',async()=>{
  const h=patrolHarness([patrolItem('twenty-days','09-18')],{policy:{historyDays:30}});
  await h.start();assert.equal(h.store[KEY].cursor.queue.length,1);
  h.setPolicy({historyDays:15});await h.host.tick();await h.finish();assert.deepEqual(h.opened,[]);
});
test('unknown read historical dates and explicit future dates do not cause baseline browsing',async()=>{
  const h=patrolHarness([patrolItem('unknown','很久以前'),patrolItem('invalid','2026-02-30'),patrolItem('future','2026-10-09',{unreadCount:1})]);
  await h.start();await h.finish();assert.deepEqual(h.opened,[]);
});
test('new unread count can reveal another identical message while stable unread previews are skipped',async()=>{
  const h=patrolHarness([patrolItem('same-text','今天',{unreadCount:1})]);
  await h.start();await h.finish();
  h.setTime(PATROL_NOW+60001);await h.host.tick();await h.finish();assert.deepEqual(h.opened,['same-text','same-text']);
  h.setItems([patrolItem('same-text','今天')]);h.setTime(PATROL_NOW+1800001);await h.host.tick();await h.finish();
  assert.deepEqual(h.opened,['same-text','same-text']);
});
test('missing preview evidence blocks before any conversation is opened',async()=>{
  const h=harness({rawTargets:true,scan:()=>({success:true,targets:[{uid:'incomplete'}],hasMore:false})});
  await h.start();assert.equal(h.store[KEY].errorCode,'HR_LIST_EVIDENCE_MISSING');
  assert.equal(h.messages.filter(m=>m.type==='BOSS_HR_HOST_SCAN_STEP' && m.cursor.stage==='CAPTURE').length,0);
});
test('an old content bridge cannot silently bypass patrol filtering',async()=>{
  const h=harness({scan:()=>({success:true,patrolVersion:0,targets:[],hasMore:false})});
  await h.start();assert.equal(h.store[KEY].errorCode,'HR_PATROL_PROTOCOL_MISMATCH');assert.equal(h.store[KEY].paused,true);
});
test('queued calendar-boundary targets expire before opening after midnight in Shanghai',async()=>{
  const h=patrolHarness([patrolItem('boundary','09-23')]);await h.start();
  assert.equal(h.store[KEY].cursor.queue.length,1);
  h.setTime(Date.parse('2026-10-08T16:01:00Z'));await h.finish();assert.deepEqual(h.opened,[]);
});
for(const lastDirection of ['本人','对方'])test('confirmed send remembers only an outgoing preview, observed '+lastDirection,async()=>{
  const h=harness();await h.start();await h.host.tick();
  const s=h.store[KEY];await h.host.update({operation:{kind:'SEND',commandId:'c',uid:'u1',leaseToken:'l'}});
  await h.host.content({type:'BOSS_HR_HOST_RESULT',hostGeneration:s.hostGeneration,documentId:s.pageDocumentId,commandId:'c',leaseToken:'l',outcome:'SENT',
    observation:{uid:'u1',previewKey:'after-send',lastTime:'今天',unreadCount:0,lastDirection}},{tab:{id:s.tabId,url:URL_CHAT}});
  assert.equal(h.store[KEY].previews.u1.signature.includes('after-send'),lastDirection==='本人');
});
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
  const store=options.store || {},requests=[],updates=[],created=[],focused=[],alarms=[],messages=[],timers=new Map();
  let timerId=0;
  const tabs=options.tabs || [{id:99,windowId:8,url:"http://127.0.0.1:6866/env-config",active:true,status:"complete"}];
  const windows=options.windows || [{id:8,type:"normal",incognito:false}];
  let clock=options.time || 1_000_000,pageTime=clock,session=null,sequence=0;
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
        if(message.type==="BOSS_HR_HOST_SCAN_STEP") {
          const result=options.scan?await options.scan(message):message.cursor.stage==="LIST"?{success:true,targets:[{uid:"u1",captureId:"preview"}],hasMore:false,nextScrollTop:0}
            :message.target?{success:true,observedAt:++pageTime,observation:{...message.target,lastDirection:"对方",unreadCount:0},capture:{captureId:"whole-round",unreadCount:1,session:{uid:"u1"},messages:[{from:"对方",type:"文本",text:"您好",messageId:"in-1"}],contextComplete:true}}:{success:true,capture:null};
          return {patrolVersion:1,...result,...(result.targets && !options.rawTargets?{targets:result.targets.map(item=>({previewKey:item.uid+"-preview",lastTime:"今天",unreadCount:1,...item}))}:{})};
        }
        if(message.type==="BOSS_HR_SEND_V2" && options.send)return options.send(message);
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
  const host=create({chrome,request,ensureContent:async()=>{},now:()=>clock,uuid:()=>"generation-"+(++sequence),
    setTimer:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
  const sender={tab:{id:99,windowId:8,url:"http://127.0.0.1:6866/env-config"}};
  const start=()=>host.control({type:"BOSS_HR_HOST_START",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL,accountBindingConfirmed:true},sender);
  return {host,start,sender,store,page,tabs,requests,updates,created,focused,alarms,messages,timers,
    continue:async()=>{const entry=timers.entries().next().value;if(!entry)return false;timers.delete(entry[0]);await entry[1].fn();return true;},
    setTime:value=>{clock=value;pageTime=value;},setSession:value=>{session=value;}};
}
test('queued read targets retain the observed viewport across worker restarts',async()=>{
  const h=harness({scan:message=>({success:true,targets:[{uid:'u1',captureId:'preview',listScrollTop:14000}],hasMore:false,nextScrollTop:0})});
  await h.start();assert.equal(h.store[KEY].cursor.queue[0].listScrollTop,14000);
  await h.host.initialize();assert.equal(h.store[KEY].cursor.queue[0].listScrollTop,14000);
});

test('missing read targets trigger bounded list rechecks while preserving baseline policy',async()=>{
  const h=harness({scan:message=>message.cursor.stage==='LIST'?{success:true,targets:[{uid:'lost',captureId:'preview'}],hasMore:false,nextScrollTop:0}
    :{success:false,errorCode:'BOSS_CHAT_NOT_FOUND',retryable:true}});
  await h.start();
  for(let attempt=0;attempt<2;attempt++) {
    await h.host.tick();assert.equal(h.store[KEY].cursor.stage,'LIST');assert.equal(h.store[KEY].cursor.baseline,true);
    assert.equal(h.store[KEY].listRechecks,attempt+1);assert.equal(h.store[KEY].paused,false);
    h.setTime(1_100_000+attempt*100000);await h.host.tick();
  }
  await h.host.tick();assert.equal(h.store[KEY].state,'BLOCKED');assert.equal(h.store[KEY].errorCode,'BOSS_CHAT_NOT_FOUND');
  assert.equal(h.requests.filter(r=>r.path.endsWith('/watch/captures')).length,0);
  assert.equal(h.messages.filter(m=>m.type==='BOSS_HR_SEND_V2').length,0);
});

test('short background waits check the actual page binding and cancel after pause',async()=>{
  const h=harness();await h.start();await h.continue();
  const state=h.store[KEY];state.operation={kind:'CAPTURE',deadlineAt:1_020_000};
  const sender={tab:{id:state.tabId,url:URL_CHAT},frameId:0};
  const message={type:'BOSS_HR_HOST_WAIT',hostGeneration:state.hostGeneration,documentId:state.pageDocumentId,
    watchSessionId:state.watchSessionId,accountIdentity:state.accountIdentity,delayMs:3000};
  const delayed=h.host.content(message,sender);await new Promise(resolve=>setImmediate(resolve));
  assert.equal([...h.timers.values()][0].ms,3000);await h.continue();assert.equal((await delayed).success,true);
  const cancelled=h.host.content(message,sender);const rejected=assert.rejects(cancelled,/托管已停止/);
  await new Promise(resolve=>setImmediate(resolve));await h.host.control({type:'BOSS_HR_HOST_PAUSE'},h.sender);
  await h.continue();await rejected;
});

test('background waits reject stale identity, invalid duration and exhausted work deadlines',async()=>{
  const h=harness();await h.start();await h.continue();
  const state=h.store[KEY];state.operation={kind:'CAPTURE',deadlineAt:1_020_000};
  const sender={tab:{id:state.tabId,url:URL_CHAT},frameId:0};
  const message={type:'BOSS_HR_HOST_WAIT',hostGeneration:state.hostGeneration,documentId:state.pageDocumentId,
    watchSessionId:state.watchSessionId,accountIdentity:state.accountIdentity,delayMs:500};
  for(const change of [{delayMs:0},{delayMs:3001},{delayMs:'500'},{watchSessionId:'old'},{accountIdentity:'other'}])
    assert.equal((await h.host.content({...message,...change},sender)).success,false);
  h.setTime(1_019_800);assert.equal((await h.host.content(message,sender)).errorCode,'BOSS_CHAT_LOCATE_TIMEOUT');
  assert.equal(h.timers.size,0);
});

test('a saved capture cursor continues promptly without waiting for the next thirty-second alarm',async()=>{
  const h=harness();await h.start();
  assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,1000);
  assert.equal(await h.continue(),true);
  assert.equal(h.store[KEY].baselineComplete,true);assert.equal(h.store[KEY].cursor,null);
  assert.equal(h.timers.size,0);
});
test('a successful send receipt with a saved read cursor waits for the regular alarm',async()=>{
  let claimSend=false,h;
  h=harness({
    request:async path=>path.endsWith('/send-commands/claim') && claimSend
      ?{success:true,httpStatus:200,data:{success:true,data:{commandId:'send-1',leaseToken:'lease-1',leaseDeadlineEpochMs:1_060_000}}}:null,
    send:async message=>{
      const command=message.command;
      const receipt=await h.host.content({type:'BOSS_HR_HOST_RESULT',hostGeneration:command.hostGeneration,
        documentId:command.pageDocumentId,commandId:command.commandId,leaseToken:command.leaseToken,outcome:'SENT'},
      {tab:{id:h.store[KEY].tabId,url:URL_CHAT}});
      assert.equal(receipt.success,true);
      return {success:true,reported:true};
    }
  });
  await h.start();assert.equal(h.timers.size,1);assert.equal(h.store[KEY].cursor.stage,'CAPTURE');
  claimSend=true;await h.host.tick();
  assert.equal(h.store[KEY].state,'RUNNING');assert.equal(h.store[KEY].operation,null);
  assert.equal(h.store[KEY].cursor.stage,'CAPTURE');assert.equal(h.timers.size,0);
  assert.equal(h.messages.filter(message=>message.type==='BOSS_HR_SEND_V2').length,1);
  assert.ok(h.alarms.some(item=>item.name===ALARM && item.config.periodInMinutes===.5));
});
test('fast cursor continuation has a bounded burst and the regular alarm can resume the saved queue',async()=>{
  const targets=Array.from({length:25},(_,index)=>({uid:'uid-'+index,captureId:'preview-'+index}));
  const h=harness({scan:message=>message.cursor.stage==='LIST'?{success:true,targets,hasMore:false,nextScrollTop:0}
    :{success:true,capture:null,observedAt:1_000_050}});
  await h.start();
  for(let step=0;step<20;step++)assert.equal(await h.continue(),true);
  assert.equal(h.timers.size,0);assert.equal(h.store[KEY].cursor.queue.length,5);
  await h.host.tick();assert.equal(h.store[KEY].cursor.queue.length,4);assert.equal(h.timers.size,1);
});
for(const action of ['PAUSE','STOP'])test(action+' cancels fast continuation without resurrecting a saved cursor',async()=>{
  const h=harness();await h.start();const stale=[...h.timers.values()][0].fn;
  await h.host.control({type:'BOSS_HR_HOST_'+action},h.sender);
  const requests=h.requests.length;
  assert.equal(h.timers.size,0);await stale();assert.equal(h.requests.length,requests);
  assert.equal(h.store[KEY].state,action==='STOP'?'STOPPED':'PAUSED');
});
test('a cancelled timer cannot continue a newly resumed control revision',async()=>{
  const h=harness();await h.start();const stale=[...h.timers.values()][0].fn;
  await h.host.control({type:'BOSS_HR_HOST_PAUSE'},h.sender);
  await h.host.control({type:'BOSS_HR_HOST_RESUME',expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},h.sender);
  const requests=h.requests.length;await stale();assert.equal(h.requests.length,requests);
});
test('a retryable continuation failure waits for the regular recovery alarm instead of looping',async()=>{
  const h=harness({scan:message=>message.cursor.stage==='LIST'?{success:true,targets:[{uid:'u1'}],hasMore:false,nextScrollTop:0}
    :{success:false,errorCode:'HR_PAGE_NOT_READY',message:'page not ready',retryable:true}});
  await h.start();assert.equal(await h.continue(),true);
  assert.equal(h.store[KEY].state,'RECOVERING');assert.equal(h.timers.size,0);
  assert.equal(h.store[KEY].cursor.queue[0].uid,'u1');
});
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
for(const replyMode of ["AUTO","REVIEW"])for(const historyMode of ["RECENT","NEW_ONLY"])for(const historyDays of [1,7,15,30]){
  test(replyMode+" "+historyMode+" "+historyDays+" days policy binds and captures in the background",async()=>{
    const h=harness({request:async path=>path.endsWith("/autopilot")?{success:true,httpStatus:200,data:{data:{enabled:true,paused:false,authorizationValid:true,replyMode,historyMode,historyDays}}}:null});
    await h.start();assert.equal(h.store[KEY].state,"RUNNING");
    assert.ok(h.requests.some(item=>item.path.endsWith("/watch/start")));
    await h.host.tick();
    assert.equal(h.requests.some(item=>item.path.endsWith("/watch/captures")),historyMode==="RECENT");
    assert.equal(h.created[0].active,false);
    assert.equal(h.focused.length,0);
    assert.ok(h.updates.every(item=>!("active" in item.config)));
    assert.equal(h.tabs.find(tab=>tab.id===99).active,true);
  });
}

for(const historyDays of [0,-1,31,1.5,15.5,"15",null,undefined]){
  test("invalid history range "+String(historyDays)+" is refused before creating or binding a chat tab",async()=>{
    const h=harness({request:async path=>path.endsWith("/autopilot")?{success:true,httpStatus:200,data:{data:{enabled:true,paused:false,authorizationValid:true,replyMode:"AUTO",historyMode:"RECENT",historyDays}}}:null});
    await h.start();
    assert.equal(h.store[KEY].state,"BLOCKED");
    assert.equal(h.store[KEY].errorCode,"HR_AUTHORIZATION_REQUIRED");
    assert.equal(h.created.length,0);
    assert.equal(h.requests.some(item=>item.path.endsWith("/watch/start")),false);
    assert.equal(h.requests.some(item=>item.path.endsWith("/watch/captures")),false);
  });
}

test("a reloaded worker can explicitly resume a range-blocked host using the saved fifteen-day policy",async()=>{
  let historyDays=31;
  const request=async path=>path.endsWith("/autopilot")?{success:true,httpStatus:200,data:{data:{enabled:true,paused:false,authorizationValid:true,replyMode:"AUTO",historyMode:"RECENT",historyDays}}}:null;
  const blocked=harness({request});
  await blocked.start();
  assert.equal(blocked.store[KEY].errorCode,"HR_AUTHORIZATION_REQUIRED");
  assert.equal(blocked.store[KEY].paused,true);
  const generation=blocked.store[KEY].hostGeneration;
  historyDays=15;
  const reloaded=harness({store:blocked.store,request});
  const result=await reloaded.host.control({type:"BOSS_HR_HOST_RESUME",expectedProfileId:1,hrBackgroundProtocol:PROTOCOL},reloaded.sender);
  assert.equal(result.success,true);
  assert.equal(result.data.state,"RUNNING");
  assert.equal(result.data.hostGeneration,generation);
  assert.ok(reloaded.requests.some(item=>item.path.endsWith("/autopilot/resume")));
  await reloaded.host.tick();
  assert.ok(reloaded.requests.some(item=>item.path.endsWith("/watch/captures")));
  assert.equal(reloaded.created[0].active,false);
  assert.equal(reloaded.focused.length,0);
});
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
