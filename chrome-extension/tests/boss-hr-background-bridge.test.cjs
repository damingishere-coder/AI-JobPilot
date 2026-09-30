const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const vm=require("node:vm");
const source=readFileSync(require.resolve("../boss-hr-bridge.js"),"utf8");
const PROTOCOL="2026-09-30-hr-background-v1";
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
