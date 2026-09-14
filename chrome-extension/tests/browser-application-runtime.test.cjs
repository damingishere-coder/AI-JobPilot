const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const scope={}; vm.runInNewContext(readFileSync(join(__dirname,'../browser-application-runtime.js'),'utf8'),scope);
const runtime=scope.BrowserApplicationRuntime;
const task={id:1,profileId:1,requestKey:'request',url:'https://fixture.invalid/job',greeting:'synthetic',runtime:{runtimeSessionId:'session',claimVersion:1}};
const state=()=>({pageType:'JOB_DETAIL',blocker:'NONE'});

test('both adapters share one permit boundary and read-only mode cannot invoke it',async()=>{
  for(const platform of ['boss','zhilian']) {
    let effects=0,requests=0;
    const begin=async()=>({permitted:++requests===1});
    for(let i=0;i<2;i++) if(!await runtime.beforeEffect({task,begin,observe:state,matches:()=>true,active:()=>true})) effects++;
    assert.equal(effects,1,platform);
    await runtime.beforeEffect({task:{...task,reconciliationOnly:true},begin,observe:state,matches:()=>true,active:()=>true});
    assert.equal(requests,2);
  }
});
test('page changes while awaiting the permit stop the first side effect',async()=>{
  let matches=true;
  const blocked=await runtime.beforeEffect({task,begin:async()=>{matches=false;return {permitted:true}},observe:state,matches:()=>matches,active:()=>true});
  assert.equal(blocked.outcome,'UNKNOWN');assert.equal(blocked.actionStarted,false);
});
test('obstructions and replaced content instances do not request a permit',async()=>{
  let requests=0;
  for(const options of [{observe:()=>({blocker:'LOGIN_REQUIRED'}),active:()=>true},{observe:state,active:()=>false}]) {
    const blocked=await runtime.beforeEffect({task,begin:async()=>{requests++;return {permitted:true}},matches:()=>true,...options});
    assert.equal(blocked.outcome,'UNKNOWN');
  }
  assert.equal(requests,0);
});
test('missing rollout response is not interpreted as permission to use the old executor',async()=>{
  for(const platform of ['boss','zhilian']) {
    const result=await runtime.claim({task,message:{runId:'run',runtimeSessionId:'session',correlationId:'corr'},platform,pageTabId:1,
      ownerAlive:async()=>true,request:async()=>({success:true,data:{success:true}})});
    assert.equal(result.blocked.outcome,'UNKNOWN');assert.equal(result.task,undefined);
  }
});
