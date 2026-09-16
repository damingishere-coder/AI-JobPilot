const {test}=require('node:test');const assert=require('node:assert/strict');
const {create,observation}=require('../scan-observer.js');
function fixture(){let data={},calls=[],sequence=0,response={success:true,data:{success:true,epoch:1,state:'RUNNING',desired:'RUNNING',acceptedEventIds:[],commands:[]}};
 const storage={get:async()=>structuredClone(data),set:async x=>{data=structuredClone(x)}};
 const request=async(path,options)=>{calls.push({path,body:options.body});return {...response,data:{...response.data,acceptedEventIds:options.body.events.map(e=>e.eventId)}}};
 return {storage,request,calls,setResponse:r=>response=r,create:()=>create({storage,request,version:'1.8.16',uuid:()=>`id${++sequence}`})};}
const task={platform:'boss',profileId:4,runId:'run',ownerToken:'owner',tabId:2,contentVersion:'1.8.16'};
test('events survive worker recreation, redact and only leave outbox after acknowledgement',async()=>{
 const f=fixture(),a=f.create();await a.attach(task);await a.event(task,{stage:'detail',message:'token secret',url:'private',totalRead:3});
 const b=f.create();await b.sync(task);assert.equal(f.calls[0].body.events.length,1);assert.ok(!JSON.stringify(f.calls).includes('secret'));
 await b.sync(task);assert.equal(f.calls[1].body.events.length,0);
});
test('stale owner rejected; transient transport failure pauses until explicit resume acknowledgement',async()=>{
 const f=fixture(),a=f.create();await a.attach(task);
 assert.equal((await a.sync({...task,ownerToken:'wrong'})).success,false);
 f.setResponse({success:false});await a.sync(task);
 f.setResponse({success:true,data:{success:true,epoch:1,state:'BLOCKED',desired:'PAUSED',commands:[]}});
 const r=await a.sync(task);assert.equal(r.localPaused,true);assert.equal(f.calls.at(-1).body.events[0].errorCode,'BACKEND_UNAVAILABLE');
 f.setResponse({success:true,data:{success:true,epoch:2,state:'RUNNING',desired:'RUNNING',commands:[]}});
 assert.equal((await a.sync({...task,ack:{id:'resume',ok:true}})).localPaused,false);
});
test('ACK is retained when backend still reports pending command and epoch advances',async()=>{
 const f=fixture(),a=f.create();await a.attach(task);
 f.setResponse({success:true,data:{success:true,epoch:2,state:'PAUSED',desired:'RESUMING',commands:[{id:'resume',kind:'RESUME'}]}});
 await a.sync({...task,ack:{id:'resume',ok:true}});await f.create().tick();
 assert.equal(f.calls.at(-1).body.epoch,2);assert.equal(f.calls.at(-1).body.ack.id,'resume');
});
test('background tick never supplies a page heartbeat; closed tab is a blocked observation',async()=>{
 const f=fixture(),a=f.create();await a.attach(task);await a.closed(2);await a.tick();
 assert.equal(f.calls[0].body.pageAlive,false);assert.equal(f.calls[0].body.events[0].errorCode,'SCAN_TAB_CLOSED');
});
test('normalization marks partial and excludes raw error bodies',()=>{
 assert.equal(observation({stage:'complete',outcome:'partial'}).state,'PARTIAL');
 assert.equal(observation({type:'error',stage:'submitBatchFailed',diagnosticType:'LOCAL_API_ERROR'}).state,'BLOCKED');
 assert.equal(observation({errorType:'<html>private</html>'}).errorCode,'UNCLASSIFIED_ERROR');
});

test('outbox capacity pauses collection and reports the gap after draining',async()=>{
 const f=fixture(),a=f.create();await a.attach(task);
 for(let i=0;i<505;i++)await a.event(task,{stage:'detail',totalRead:i});
 let result=await a.sync(task);assert.equal(result.localPaused,true);
 assert.equal(f.calls[0].body.events.length,100);
 await a.tick();
 for(let i=0;i<5;i++)await a.tick();
 assert.ok(f.calls.some(c=>c.body.events.some(e=>e.errorCode==='LOG_QUEUE_FULL')));
});
