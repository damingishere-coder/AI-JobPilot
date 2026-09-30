const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const vm=require("node:vm");
const source=readFileSync(require.resolve("../boss-hr-bridge.js"),"utf8");
const PROTOCOL="2026-09-30-hr-background-v1";
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
      chatItems:()=>[item],itemSnapshot:()=>({uid:"u1"}),captureId:()=>"preview"}});
  const call=message=>new Promise(resolve=>listener({source:"GET_JOBS_BACKGROUND",...message},{},resolve));
  const page=await call({type:"BOSS_HR_HOST_PAGE_PING"});
  assert.equal(page.accountName,"合成求职者");assert.equal(page.accountIdentity,"geek:合成求职者");
  await call({type:"BOSS_HR_HOST_BIND",protocol:PROTOCOL,documentId:"document",hostGeneration:"generation",watchSessionId:"watch",explicitResume:true});
  const scan=scrollTop=>call({type:"BOSS_HR_HOST_SCAN_STEP",hostGeneration:"generation",documentId:"document",cursor:{stage:"LIST",scope:"ALL",scrollTop}});
  const next=await scan(14000);
  assert.equal(next.success,true);assert.equal(next.actualScrollTop,14000);assert.equal(next.nextScrollTop,14704);assert.equal(next.hasMore,true);
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
