const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const vm=require("node:vm");
const source=readFileSync(require.resolve("../boss-hr-bridge.js"),"utf8");
const PROTOCOL="2026-09-30-hr-background-v1";
function captureHarness(batches) {
  const realSupport=require('../boss-hr-support.js');
  let batch=0,scrolls=0;
  const scroller={scrollHeight:1000,clientHeight:100,scrollTop:900,dispatchEvent:()=>{scrolls++;batch=Math.min(batch+1,batches.length-1);}};
  const pane={parentElement:scroller};
  const account={textContent:'合成求职者',getAttribute:()=>null};
  const document={querySelector:selector=>selector==='.chat-conversation .im-list'?pane:selector==='.nav-figure .label-text'?account:null,
    querySelectorAll:selector=>selector.includes('> .message-item')?batches[batch].map(()=>({classList:{contains:()=>false}})):[]};
  const window={addEventListener:()=>{}};window.top=window;window.self=window;
  const snapshot={uid:'uid-1',hrName:'合成HR',companyName:'合成公司',jobName:'采购',lastMessage:'新提问',unreadCount:0};
  const testSource=source.replace(/\}\)\(\);\s*$/,`window.test={hostReadStep,readContext};
    locateByUid=async()=>({matches:[{}],unique:{}});openConversation=async()=>({success:true});
    captureStillCurrent=()=>true;hydrateMedia=async()=>{};})();`);
  vm.runInNewContext(testSource,{window,document,location:{pathname:'/web/geek/chat',href:'https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1'},
    crypto:require('node:crypto').webcrypto,TextEncoder,Event:class {},Date,setTimeout:fn=>setTimeout(fn,0),clearTimeout,
    chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:(message,reply)=>reply({success:true,watchActive:true})}},
    sessionStorage:{getItem:()=>null},GetJobsBossHrSupport:{...realSupport,pageSafety:()=>({safe:true}),
      itemSnapshot:()=>snapshot,currentSession:()=>({...snapshot}),readMessages:()=>batches[batch]}});
  return {...window.test,scrolls:()=>scrolls};
}
const text=(from,messageId,body,time='今天')=>({from,type:'文本',text:body,time,messageId,media:[]});
test('NEW_ONLY baseline captures stay historical while a later ALL scan captures new incoming without an unread badge',async()=>{
  const messages=[text('本人','self-1','较早回复'),text('本人','self-2','最近回复'),text('对方','new-1','新提问')];
  const h=captureHarness([messages]);
  const scan=baseline=>h.hostReadStep({cursor:{stage:'CAPTURE',scope:'ALL',baseline},target:{uid:'uid-1'},deadlineAt:Date.now()+20000});
  assert.equal((await scan(true)).capture.historical,true);
  const live=await scan(false);
  assert.equal(live.capture.historical,false);
  assert.equal(live.capture.messages.at(-1).messageId,'new-1');
});
test('a reconciliation scan still skips a conversation already answered by the user',async()=>{
  const h=captureHarness([[text('对方','old-1','旧提问'),text('本人','self-1','已经回复')]]);
  const result=await h.hostReadStep({cursor:{stage:'CAPTURE',scope:'ALL',baseline:false},target:{uid:'uid-1'},deadlineAt:Date.now()+20000});
  assert.equal(result.capture,null);
});
test('legacy identity reading continues beyond two recent self boundaries until its unique older incoming round is present',async()=>{
  const legacy=text('对方','','旧简历请求','09-21 09:16');
  const recent=[text('本人','self-1','近期回复1'),text('对方','recent-1','近期提问'),text('本人','self-2','近期回复2'),text('对方','new-1','新提问')];
  const loaded=[text('本人','old-self','更早回复'),{...legacy,messageId:'old-source'},...recent];
  const h=captureHarness([recent,loaded]);
  const result=await h.hostReadStep({cursor:{stage:'CAPTURE',scope:'ALL',baseline:false},target:{uid:'uid-1',legacyAnchorId:132},
    legacyAnchors:[{conversationId:132,capture:{contextComplete:true,messages:[text('本人','','旧回复'),legacy]}}],deadlineAt:Date.now()+20000});
  assert.equal(result.capture.contextComplete,true);
  assert.ok(result.capture.messages.some(message=>message.messageId==='old-source'));
  assert.equal(h.scrolls(),1);
});
test('legacy identity reading stays incomplete when its source is absent at the deadline',async()=>{
  const legacy=text('对方','','旧简历请求','09-21 09:16');
  const h=captureHarness([[text('本人','self-1','回复1'),text('本人','self-2','回复2'),text('对方','new-1','新提问')]]);
  const read=await h.readContext(Date.now()-1,{contextComplete:true,messages:[legacy]});
  assert.equal(read.complete,false);assert.equal(h.scrolls(),0);
});
test('legacy identity reading rejects duplicate matching rounds and does not relax their timestamps',async()=>{
  const legacy=text('对方','','旧简历请求','09-21 09:16');
  for(const messages of [
    [text('本人','self-1','回复1'),{...legacy,messageId:'old-1'},text('本人','self-2','回复2'),{...legacy,messageId:'old-2'}],
    [text('本人','self-1','回复1'),text('本人','self-2','回复2'),{...legacy,time:'',messageId:'old-1'}],
  ]) {
    const h=captureHarness([messages]);
    const read=await h.readContext(Date.now()+20000,{contextComplete:true,messages:[legacy]});
    assert.equal(read.complete,false);
  }
});
test('legacy identity reading has a finite history-loading budget when the source never appears',async()=>{
  const recent=[text('本人','self-1','回复1'),text('本人','self-2','回复2'),text('对方','new-1','新提问')];
  const batches=[recent];
  // Each expansion must retain the preceding visible first row to preserve the boundary.
  for(let index=1;index<42;index++)batches.push([text('本人','older-'+index,'更早回复'),...batches[index-1]]);
  const h=captureHarness(batches);
  const read=await h.readContext(Date.now()+20000,{contextComplete:true,messages:[text('对方','','旧简历请求','09-21 09:16')]});
  assert.equal(read.complete,false);assert.equal(h.scrolls(),40);
});
test("a new build replaces an older bridge with the same wire protocol and same-build injection stays single",()=>{
  let registrations=0,listener;
  const window={__GET_JOBS_BOSS_HR_BRIDGE__:PROTOCOL,addEventListener:()=>{}};window.top=window;window.self=window;
  const context=vm.createContext({window,document:{querySelector:()=>null},location:{pathname:'/web/geek/chat',href:'https://www.zhipin.com/web/geek/chat'},
    crypto:{randomUUID:()=>"new-document"},chrome:{runtime:{onMessage:{addListener:fn=>{registrations++;listener=fn;}}}},sessionStorage:{getItem:()=>null},
    GetJobsBossHrSupport:{normalizeText:value=>String(value || ''),pageSafety:()=>({safe:true})}});
  vm.runInContext(source,context);vm.runInContext(source,context);
  assert.equal(registrations,1);
  let result;listener({source:'GET_JOBS_BACKGROUND',type:'BOSS_HR_HOST_PAGE_PING'},{},value=>result=value);
  assert.equal(result.documentId,'new-document');assert.equal(result.protocol,PROTOCOL);
});
test("production list reader uses the overflow scroller, keeps selected parent filter and clamps the bottom",async()=>{
  let listener,clicks=0,writes=[];
  const account={textContent:"合成求职者",getAttribute:()=>null};
  const menu={textContent:"合成求职者 退出登录"};
  const body={};
  const scroller={scrollHeight:15642,clientHeight:829,scrollTop:0,parentElement:body,dispatchEvent:()=>{},overflow:"auto"};
  const ul={scrollHeight:15600,clientHeight:100,parentElement:scroller,overflow:"visible"};
  Object.defineProperty(ul,"scrollTop",{get:()=>0,set:value=>writes.push(value)});
  const item={parentElement:ul};
  const filter={className:"label",parentElement:{className:"filter active",getAttribute:()=>null},getAttribute:()=>null,click:()=>clicks++};
  const document={body,defaultView:{getComputedStyle:node=>({overflowY:node.overflow})},
    querySelector:selector=>selector===".nav-figure .label-text"?account:selector.includes(",")?menu:null,querySelectorAll:()=>[]};
  const window={addEventListener:()=>{}};window.top=window;window.self=window;
  vm.runInNewContext(source,{window,document,location:{href:"https://www.zhipin.com/web/geek/chat",pathname:"/web/geek/chat"},
    crypto:{randomUUID:()=>"document"},chrome:{runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:(message,reply)=>reply({success:true,watchActive:true})}},
    sessionStorage:{getItem:()=>null,removeItem:()=>{}},Event:class {},setTimeout:fn=>setTimeout(fn,0),clearTimeout,Date,
    GetJobsBossHrSupport:{normalizeText:value=>String(value || "").trim(),pageSafety:()=>({safe:true}),allTab:()=>filter,
      chatItems:()=>[item],itemSnapshot:()=>({uid:"u1",lastTime:"今天",unreadCount:0}),captureId:()=>"preview",previewKey:async()=>"preview-key"}});
  const call=message=>new Promise(resolve=>listener({source:"GET_JOBS_BACKGROUND",...message},{},resolve));
  const page=await call({type:"BOSS_HR_HOST_PAGE_PING"});
  assert.equal(page.accountName,"合成求职者");assert.equal(page.accountIdentity,"geek:合成求职者");
  await call({type:"BOSS_HR_HOST_BIND",protocol:PROTOCOL,documentId:"document",hostGeneration:"generation",watchSessionId:"watch",explicitResume:true});
  const scan=scrollTop=>call({type:"BOSS_HR_HOST_SCAN_STEP",hostGeneration:"generation",documentId:"document",cursor:{stage:"LIST",scope:"ALL",scrollTop}});
  const next=await scan(14000);
  assert.equal(next.success,true);assert.equal(next.actualScrollTop,14000);assert.equal(next.nextScrollTop,14704);assert.equal(next.hasMore,true);
  assert.equal(next.targets[0].listScrollTop,14000);
  await new Promise(resolve=>setTimeout(resolve,0));
  const bottom=await scan(20000);
  assert.equal(bottom.actualScrollTop,14813);assert.equal(bottom.hasMore,false);
  assert.equal(clicks,0);assert.deepEqual(writes,[]);
});
for(const action of ["MANUAL_PAUSE","UNBIND"]){
  test(action+" during a pending production guard denies the next DOM operation",async()=>{
    const events={},outbound=[];let listener,releaseGuard,enterGuard,reads=0;
    const guarded=new Promise(resolve=>{enterGuard=resolve;});
    const account={getAttribute:name=>name==="data-geek-account-name"?"合成求职者":null,textContent:"合成求职者"};
    const document={querySelector:selector=>selector.startsWith(".nav-figure")?account:null};
    const window={addEventListener:(name,fn)=>events[name]=fn};window.top=window;window.self=window;
    const runtime={onMessage:{addListener:fn=>listener=fn},sendMessage:(message,reply)=>{
      outbound.push(message);
      if(message.type==="BOSS_HR_HOST_GUARD"){releaseGuard=()=>reply({success:true,watchActive:true,policyVersion:2});enterGuard();}
      else reply({success:true});
    }};
    vm.runInNewContext(source,{window,document,location:{href:"https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1",pathname:"/web/geek/chat"},
      crypto:{randomUUID:()=>"document"},chrome:{runtime},sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
      GetJobsBossHrSupport:{normalizeText:value=>String(value || "").trim(),pageSafety:()=>({safe:true}),findByUid:()=>{reads++;return {matches:[]};}},
      setTimeout,clearTimeout,Date});
    const call=message=>new Promise(resolve=>listener({source:"GET_JOBS_BACKGROUND",...message},{},resolve));
    await call({type:"BOSS_HR_HOST_BIND",protocol:PROTOCOL,documentId:"document",hostGeneration:"generation",watchSessionId:"watch",explicitResume:true});
    const send=call({type:"BOSS_HR_SEND_V2",command:{commandId:"command",uid:"uid",leaseToken:"lease",draft:"合成回复",policyVersion:2,
      hostGeneration:"generation",pageDocumentId:"document",watchSessionId:"watch",deadlineAt:Date.now()+20000}});
    await guarded;
    if(action==="MANUAL_PAUSE")events.pointerdown({isTrusted:true,composedPath:()=>[]});
    else await call({type:"BOSS_HR_HOST_UNBIND",hostGeneration:"generation"});
    releaseGuard();const result=await send;
    assert.equal(result.outcome,"FAILED_SAFE");assert.equal(reads,0);
    assert.equal(outbound.some(message=>message.type==="BOSS_HR_HOST_DISPATCH"),false);
    const report=outbound.find(message=>message.type==="BOSS_HR_HOST_RESULT");
    assert.equal(report.hostGeneration,"generation");assert.equal(report.documentId,"document");assert.equal(report.watchSessionId,"watch");
  });
}
