const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync(require.resolve('../boss-hr-bridge.js'),'utf8');

function harness({readyAt=350,replaceAt=Infinity,changeDraftAt=Infinity,ambiguousAt=Infinity,pauseAt=Infinity,changeRoundAt=Infinity,disableOnFinalGuard=false}={}) {
  let clock=1000,clicks=0,writtenAt=null,readyObserved=false,finalDisabled=false;
  const inbound={from:'对方',type:'文本',text:'合成问候',time:'今天',messageId:'inbound'};
  const messages=[inbound];
  const normalize=value=>String(value??'').trim();
  const button={textContent:'发送',classList:{contains:()=>false},getAttribute:()=>null,hasAttribute:()=>false,
    getBoundingClientRect:()=>({width:60,height:28}),click:()=>{clicks++;messages.push({from:'本人',type:'文本',text:'合成回复',messageId:'outbound'});}};
  Object.defineProperty(button,'disabled',{get:()=>{
    const disabled=writtenAt===null || clock-writtenAt<readyAt || finalDisabled;
    if(!disabled)readyObserved=true;
    return disabled;
  }});
  const makeInput=()=>({textContent:'',focus:()=>{},dispatchEvent:()=>{if(writtenAt===null)writtenAt=clock;},
    getBoundingClientRect:()=>({width:600,height:80}),closest(){return {querySelectorAll:()=>this===input?(clock-writtenAt>=ambiguousAt?[button,{...button}]:[button]):[]};}});
  let input=makeInput(),replaced=false;
  const advance=ms=>{
    clock+=ms;
    if(writtenAt!==null && clock-writtenAt>=replaceAt && !replaced){const text=input.textContent;input=makeInput();input.textContent=text;replaced=true;}
    if(writtenAt!==null && clock-writtenAt>=changeDraftAt)input.textContent='本人未发送草稿';
    if(writtenAt!==null && clock-writtenAt>=changeRoundAt)messages.splice(0,messages.length,{...inbound,text:'新的HR提问'});
  };
  const document={querySelectorAll:()=>[input]};
  const window={addEventListener:()=>{}};window.top=window;window.self=window;
  class ClockDate extends Date {static now(){return clock;}}
  const support={normalizeText:normalize,pageSafety:()=>({safe:true}),currentSession:()=>({uid:'uid',title:'合成HR',observedCompanyName:'合成公司'}),
    readMessages:()=>messages.map(x=>({...x})),latestInbound:rows=>rows.findLast(x=>x.from==='对方'),messagesMatch:(a,b)=>a?.text===b?.text};
  const code=source.replace(/\}\)\(\);\s*$/,`window.test={executeSend};
    guard=async()=>hooks.guard();wait=async ms=>hooks.wait(ms);
    locateByUid=async()=>({matches:[{}],unique:{}});openConversation=async()=>({success:true});
    readContext=async()=>({messages:GetJobsBossHrSupport.readMessages(),complete:true});})();`);
  vm.runInNewContext(code,{window,document,Date:ClockDate,location:{pathname:'/web/geek/chat'},
    crypto:{randomUUID:()=> 'document'},sessionStorage:{getItem:()=>null},
    HTMLTextAreaElement:class {},HTMLInputElement:class {},InputEvent:class {},Event:class {},
    getComputedStyle:()=>({display:'block',visibility:'visible'}),GetJobsBossHrSupport:support,
    chrome:{runtime:{onMessage:{addListener:()=>{}}}},hooks:{wait:advance,guard:()=>{
      if(writtenAt!==null && clock-writtenAt>=pauseAt)throw new Error('USER_PAUSED');
      if(disableOnFinalGuard && readyObserved)finalDisabled=true;
    }}});
  return {send:async(deadline=20000)=>window.test.executeSend({commandId:'command',uid:'uid',draft:'合成回复',hrName:'合成HR',companyName:'合成公司',
    expectedLatestInbound:inbound,expectedInboundRound:[inbound],deadlineAt:1000+deadline}),
    clicks:()=>clicks,draft:()=>input.textContent,elapsed:()=>clock-1000,replaced:()=>replaced};
}

test('waits for delayed editor readiness and clicks once after the native control enables',async()=>{
  const h=harness();const result=await h.send();
  assert.equal(result.outcome,'SENT');assert.equal(h.clicks(),1);assert.ok(h.elapsed()>=350);
});

test('reacquires an editor replaced during reactive rendering without rewriting its draft',async()=>{
  const h=harness({replaceAt:100});const result=await h.send();
  assert.equal(h.replaced(),true);assert.equal(result.outcome,'SENT');assert.equal(h.clicks(),1);
});

test('keeps a changed user draft and never sends it',async()=>{
  const h=harness({changeDraftAt:100});const result=await h.send();
  assert.equal(result.outcome,'STALE');assert.equal(h.clicks(),0);assert.equal(h.draft(),'本人未发送草稿');
});

test('a permanently disabled control stops safely within the readiness budget',async()=>{
  const h=harness({readyAt:Infinity});const result=await h.send();
  assert.equal(result.outcome,'FAILED_SAFE');assert.equal(h.clicks(),0);assert.equal(h.elapsed(),2500);
});

test('readiness waiting respects the command deadline',async()=>{
  const h=harness({readyAt:Infinity});const result=await h.send(250);
  assert.equal(result.outcome,'FAILED_SAFE');assert.equal(h.clicks(),0);assert.ok(h.elapsed()<=250);
});

test('ambiguous native send controls fail closed without clicking either',async()=>{
  const h=harness({ambiguousAt:100});const result=await h.send();
  assert.equal(result.outcome,'FAILED_SAFE');assert.equal(h.clicks(),0);assert.match(result.evidence,/多个/);
});

test('manual pause during readiness waiting aborts before a send',async()=>{
  const h=harness({pauseAt:100});await assert.rejects(h.send(),/USER_PAUSED/);assert.equal(h.clicks(),0);
});

test('a changed inbound round is rechecked after readiness',async()=>{
  const h=harness({changeRoundAt:100});const result=await h.send();
  assert.equal(result.outcome,'STALE');assert.equal(h.clicks(),0);
});

test('the native control is checked again after the final authorization guard',async()=>{
  const h=harness({disableOnFinalGuard:true});const result=await h.send();
  assert.equal(result.outcome,'FAILED_SAFE');assert.equal(h.clicks(),0);
});
