const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=require('node:fs').readFileSync(require.resolve('../boss-hr-bridge.js'),'utf8');

function harness({target=8000,duplicate=false,missing=false}={}) {
  let clock=10000;
  const messages=[],scrolls=[];
  const body={},list={scrollTop:0,scrollHeight:12000,clientHeight:1000,parentElement:body,
    dispatchEvent:()=>scrolls.push(list.scrollTop)};
  const card={parentElement:list},account={textContent:'合成求职者',getAttribute:()=>null};
  const document={body,defaultView:{getComputedStyle:()=>({overflowY:'auto'})},
    querySelector:selector=>selector==='.nav-figure .label-text'?account:null,querySelectorAll:()=>[]};
  const window={addEventListener:()=>{}};window.top=window;window.self=window;
  const support={normalizeText:value=>String(value||'').trim(),pageSafety:()=>({safe:true}),chatItems:()=>[card],
    findByUid:()=> {
      const matches=!missing && list.scrollTop<=target && target<list.scrollTop+1000 ? (duplicate?[card,{parentElement:list}]:[card]):[];
      return {matches,unique:matches.length===1?matches[0]:null};
    }};
  const testSource=source.replace(/\}\)\(\);\s*$/,`hostGeneration='generation';hostWatchSessionId='watch';window.test={locateByUid,hostReadStep,locateFailure,wait};})();`);
  vm.runInNewContext(testSource,{window,document,location:{pathname:'/web/geek/chat',href:'https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1'},
    crypto:require('node:crypto').webcrypto,Date:{now:()=>clock},Event:class {},sessionStorage:{getItem:()=>null},GetJobsBossHrSupport:support,
    setTimeout:()=>{throw Error('hidden page timers must not be used');},
    chrome:{runtime:{onMessage:{addListener:()=>{}},sendMessage:(message,reply)=>{
      messages.push(message);
      if(message.type==='BOSS_HR_HOST_WAIT') clock+=message.delayMs;
      reply({success:true,watchActive:true,policyVersion:8});
    }}}});
  return {...window.test,list,scrolls,messages,now:()=>clock};
}

test('a long virtual list uses its saved viewport and verifies the UID without page timers',async()=>{
  const h=harness();
  const found=await h.locateByUid('uid',h.now()+20000,7800);
  assert.equal(found.matches.length,1);assert.deepEqual(h.scrolls,[7800]);
  assert.equal(h.messages.filter(m=>m.type==='BOSS_HR_HOST_WAIT').length,1);
  assert.equal(h.messages.find(m=>m.type==='BOSS_HR_HOST_WAIT').delayMs,500);
});
test('an outdated saved viewport falls back to a bounded UID search',async()=>{
  const h=harness({target:2000});
  assert.equal((await h.locateByUid('uid',h.now()+20000,7800)).matches.length,1);
  assert.deepEqual(h.scrolls.slice(0,2),[7800,0]);
});
test('expiry preserves the read target for retry and never reports a duplicate identity',async()=>{
  const h=harness();
  const response=await h.hostReadStep({cursor:{stage:'CAPTURE'},target:{uid:'uid',listScrollTop:7800},deadlineAt:h.now()+100});
  assert.equal(response.success,false);assert.equal(response.errorCode,'BOSS_CHAT_LOCATE_TIMEOUT');assert.equal(response.retryable,true);
});
test('a complete missing search and duplicate UID have distinct outcomes',async()=>{
  const missing=harness({missing:true});
  const notFound=missing.locateFailure(await missing.locateByUid('uid',missing.now()+20000));
  assert.equal(notFound.errorCode,'BOSS_CHAT_NOT_FOUND');assert.equal(notFound.retryable,true);
  const duplicate=harness({duplicate:true});
  const ambiguous=duplicate.locateFailure(await duplicate.locateByUid('uid',duplicate.now()+20000,7800));
  assert.equal(ambiguous.errorCode,'BOSS_CHAT_IDENTITY_AMBIGUOUS');assert.equal(ambiguous.retryable,false);
});
