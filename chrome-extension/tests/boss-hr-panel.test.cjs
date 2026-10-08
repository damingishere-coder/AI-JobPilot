const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Node {
  constructor(tag){this.tagName=tag;this.childNodes=[];this.events={};this.style={};this.dataset={};this.scrollTop=0;this.classes=new Set();this.classList={toggle:(name,value)=>{const on=value??!this.classes.has(name);if(on)this.classes.add(name);else this.classes.delete(name);},contains:name=>this.classes.has(name)};}
  append(...nodes){nodes.forEach(node=>this.appendChild(node));}
  appendChild(node){node.remove();node.parent=this;this.childNodes.push(node);return node;}
  replaceChild(node,old){node.remove();const index=this.childNodes.indexOf(old);old.parent=null;node.parent=this;this.childNodes[index]=node;}
  insertBefore(node,next){node.remove();node.parent=this;const index=this.childNodes.indexOf(next);this.childNodes.splice(index<0?this.childNodes.length:index,0,node);}
  remove(){if(this.parent){const index=this.parent.childNodes.indexOf(this);if(index>=0)this.parent.childNodes.splice(index,1);this.parent=null;}}
  get lastChild(){return this.childNodes.at(-1);}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(name,value){this[name]=value;}
  attachShadow(){this.shadow=new Node('shadow');return this.shadow;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function harness({mismatch=false,hostState={},statusState={},policyState={}}={}){
  const document={documentElement:new Node('html'),getElementById:()=>null,createElement:tag=>new Node(tag)};
  let timer,fail=false,held=new Set(),clock=0,timeoutId=0;
  const operations=[],pending=[],timeouts=new Map();
  const binding={watchSessionId:'watch',hostGeneration:'generation',pageDocumentId:'document'};
  const host={transport:'CHROME_BACKGROUND',state:'RUNNING',intentEnabled:true,profileId:4,...binding,...hostState};
  const status={transport:'CHROME_BACKGROUND',watching:true,currentProfileId:4,currentProfileName:'合成档案',...binding,...(mismatch?{watchSessionId:'other'}:{}),...statusState};
  const policy={enabled:true,authorizationValid:true,replyMode:'AUTO',historyMode:'RECENT',historyDays:15,...policyState};
  const runtime={sendMessage:(message,reply)=>{operations.push(message);if(fail)return reply({success:false,message:'连接失败'});
    const data=message.operation==='hr-background-status'?host:message.operation==='hr-status'?status:message.operation==='hr-autopilot'?policy:message.operation==='hr-proposals'?[]:{};
    const response={success:true,data:{success:true,data:structuredClone(data)}};
    if(held.has(message.operation))pending.push({operation:message.operation,reply,response});else reply(response);}};
  const window={setInterval:fn=>{timer=fn;return 1;},clearInterval:()=>{},
    setTimeout:(fn,ms)=>{const id=++timeoutId;timeouts.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timeouts.delete(id)};
  window.top=window;window.self=window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../boss-hr-assistant.js'),'utf8'),{document,window,chrome:{runtime},location:{pathname:'/web/geek/chat'},Date});
  await flush();const root=document.documentElement.childNodes[0].shadow;
  const nodes=()=>{const result=[];const walk=node=>{result.push(node);node.childNodes.forEach(walk);};walk(root);return result;};
  return {nodes,operations,tick:async()=>{timer();await flush();},fail:()=>{fail=true;},
    hold:operations=>{held=new Set(operations);},setHost:value=>Object.assign(host,value),setStatus:value=>Object.assign(status,value),
    release:async response=>{pending.splice(0).forEach(item=>item.reply(response || item.response));await flush();},
    expire:async ms=>{clock+=ms;for(const [id,timeout] of timeouts)if(timeout.at<=clock){timeouts.delete(id);timeout.fn();}await flush();}};
}
test('panel shows the saved 15 day policy and shared status, with collapsed records and same-host pause',async()=>{
  const h=await harness();
  assert.ok(h.nodes().some(node=>node.textContent==='后台托管：运行中'));
  assert.ok(h.nodes().some(node=>node.textContent?.includes('最近 15 天')));
  assert.equal(Boolean(h.nodes().find(node=>node.tagName==='details' && node.className==='records').open),false);
  const pause=h.nodes().find(node=>node.textContent==='暂停后台托管');assert.equal(pause.disabled,false);await pause.events.click();await flush();
  const message=h.operations.find(message=>message.operation==='hr-background-pause');assert.equal(message.body.expectedProfileId,4);
  assert.equal(h.operations.some(message=>message.operation==='hr-start'),false);
});
test('a running host exposes blocked capture analysis and clears its warning after recovery',async()=>{
  const message='有 2 条聊天记录处理受阻，尚未发送回复。';
  const h=await harness({statusState:{activity:{background:{blockedCaptures:2,message}}}});
  assert.ok(h.nodes().some(node=>node.textContent==='后台托管：巡检中，部分回复受阻'));
  assert.ok(h.nodes().some(node=>node.className==='error' && node.textContent===message));
  assert.equal(h.nodes().find(node=>node.className==='dot').classList.contains('on'),false);
  assert.equal(h.nodes().find(node=>node.textContent==='暂停后台托管').disabled,false);
  h.setStatus({activity:{background:{blockedCaptures:0,message:''}}});await h.tick();
  assert.ok(h.nodes().some(node=>node.textContent==='后台托管：运行中'));
  assert.equal(h.nodes().some(node=>node.textContent===message),false);
});
test('backend errors remain visible while the host still reports running',async()=>{
  const h=await harness({statusState:{lastError:'实际后台核验失败'}});
  assert.ok(h.nodes().some(node=>node.className==='error' && node.textContent==='实际后台核验失败'));
});
test('different backend binding is never shown as running',async()=>{
  const h=await harness({mismatch:true});
  assert.equal(h.nodes().some(node=>node.textContent==='后台托管：运行中'),false);
  assert.ok(h.nodes().some(node=>node.textContent==='后台托管：后台连接待核验'));
});
test('a refresh failure removes the old running claim and keeps a manual refresh control',async()=>{
  const h=await harness();h.fail();await h.tick();
  assert.equal(h.nodes().some(node=>node.textContent==='后台托管：运行中'),false);
  assert.ok(h.nodes().some(node=>node.textContent==='立即刷新'));
  assert.ok(h.nodes().some(node=>node.textContent==='连接失败'));
});
const readOperations=['hr-status','hr-proposals','hr-autopilot','hr-background-status'];
for(const lateFailure of [false,true])test('a pending background refresh does not swallow resume or overwrite newer state with a late '+(lateFailure?'failure':'response'),async()=>{
  const h=await harness({hostState:{state:'PAUSED',paused:true},statusState:{watching:false}});
  h.hold(readOperations);await h.tick();
  const resume=h.nodes().find(node=>node.textContent==='恢复后台托管');
  assert.equal(resume.disabled,false);
  h.hold([]);h.setHost({state:'RUNNING',paused:false});h.setStatus({watching:true});
  await resume.events.click();await flush();
  const requests=h.operations.filter(message=>message.operation==='hr-background-resume');
  assert.equal(requests.length,1);assert.equal(requests[0].body.expectedProfileId,4);
  assert.ok(h.nodes().some(node=>node.textContent==='后台托管：运行中'));
  await h.release(lateFailure?{success:false,message:'旧连接失败'}:undefined);
  assert.ok(h.nodes().some(node=>node.textContent==='后台托管：运行中'));
  assert.equal(h.nodes().some(node=>node.textContent==='恢复后台托管'),false);
});
test('a missing read callback times out and permits a fresh status check',async()=>{
  const h=await harness({hostState:{state:'PAUSED',paused:true}});
  h.hold(['hr-proposals']);await h.tick();
  await h.expire(15_000);
  assert.ok(h.nodes().some(node=>node.textContent?.includes('[HR_LOCAL_TIMEOUT]')));
  assert.equal(h.nodes().find(node=>node.textContent==='立即刷新').disabled,false);
  h.hold([]);await h.tick();
  assert.equal(h.nodes().find(node=>node.textContent==='恢复后台托管').disabled,false);
  await h.release();
  assert.equal(h.nodes().find(node=>node.textContent==='恢复后台托管').disabled,false);
});
test('a missing action callback releases its busy state without replaying the action',async()=>{
  const h=await harness({hostState:{state:'PAUSED',paused:true}});
  h.hold(['hr-background-resume']);
  const resume=h.nodes().find(node=>node.textContent==='恢复后台托管');
  void resume.events.click();void resume.events.click();await flush();
  assert.equal(h.operations.filter(message=>message.operation==='hr-background-resume').length,1);
  assert.equal(h.nodes().find(node=>node.textContent==='恢复后台托管').disabled,true);
  await h.expire(120_000);
  assert.ok(h.nodes().some(node=>node.textContent?.includes('[HR_LOCAL_TIMEOUT]')));
  assert.equal(h.nodes().find(node=>node.textContent==='恢复后台托管').disabled,false);
  await h.tick();await h.release();
  assert.equal(h.operations.filter(message=>message.operation==='hr-background-resume').length,1);
  assert.ok(h.nodes().some(node=>node.textContent?.includes('[HR_LOCAL_TIMEOUT]')));
});
for(const scenario of [
  {hostState:{needsAccountConfirmation:true},reason:'请在工作台重新确认 BOSS 账号后恢复。'},
  {policyState:{authorizationValid:false},reason:'托管授权尚未确认，请在工作台核对规则后恢复。'},
  {hostState:{profileId:5},reason:'托管档案与当前档案不一致，请在工作台核对。'},
])test('resume remains disabled with its actual reason: '+scenario.reason,async()=>{
  const h=await harness({...scenario,hostState:{state:'PAUSED',paused:true,...scenario.hostState}});
  const resume=h.nodes().find(node=>node.textContent==='恢复后台托管');
  assert.equal(resume.disabled,true);assert.equal(resume.title,scenario.reason);
  assert.ok(h.nodes().some(node=>node.textContent===scenario.reason));
  assert.equal(h.operations.some(message=>message.operation==='hr-background-resume'),false);
});
