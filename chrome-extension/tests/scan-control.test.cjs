const {test}=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness({failSave=false}={}){
 let clock=10000,saved=null,state={stage:'collecting'},reply={success:true,desired:'RUNNING',commands:[]},live=true,latched=false;
 const calls=[],timers=new Set();let onSleep=()=>{},held=null;
 const context=vm.createContext({Date:{now:()=>clock},console,
   setInterval:fn=>{timers.add(fn);return fn},clearInterval:fn=>timers.delete(fn),
   setTimeout:fn=>{clock+=2500;onSleep();return setImmediate(fn)},
   chrome:{runtime:{sendMessage:async data=>{calls.push(structuredClone(data));if(held){const wait=held;held=null;await wait;}if(data.ack?.ok){reply={success:true,desired:reply.commands[0]?.kind==='RESUME'?'RUNNING':reply.desired,commands:[]}}return structuredClone(reply)}}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scan-control.js'),'utf8'),context);
 const task={runId:'run',profileId:4,scanProtocol:1,scanOwnerToken:'owner',config:{keywords:['test']},updatedAt:clock};
 const control=context.GetJobsScanControl.create({platform:'boss',version:'1.8.16',instanceId:'10000-a',current:()=>live,
   readTask:()=>saved,saveTask:async t=>{if(failSave && t.pausedAt)throw new Error('storage unavailable');saved={...t,updatedAt:clock}},status:s=>state={...state,...s},readStatus:()=>state,
   setStopped:()=>latched=true,resume:()=>{}});
 return {control,task,calls,timers,holdNext:()=>{let release;held=new Promise(resolve=>release=resolve);return ()=>release()},setReply:r=>{reply=r;clock+=2500},onSleep:fn=>onSleep=fn,latched:()=>latched,saved:()=>saved,state:()=>state,close:()=>live=false};
}
test('stop is latched at checkpoint but acknowledged only after run exits',async()=>{
 const h=harness();await h.control.enter(h.task);
 h.setReply({success:true,desired:'STOPPED',commands:[{id:'stop',kind:'STOP'}]});
 assert.equal(await h.control.checkpoint(),true);assert.equal(h.latched(),true);
 assert.equal(h.calls.some(c=>c.ack?.id==='stop'),false);
 await h.control.leave();assert.equal(h.calls.some(c=>c.ack?.id==='stop'),true);assert.equal(h.timers.size,0);
});
test('pause persists checkpoint; concurrent probes share a wait; explicit resume releases it',async()=>{
 const h=harness();await h.control.enter(h.task);
 h.setReply({success:true,desired:'PAUSED',commands:[{id:'pause',kind:'PAUSE'}]});
 h.onSleep(()=>h.setReply({success:true,desired:'RESUMING',commands:[{id:'resume',kind:'RESUME'}]}));
 const a=h.control.checkpoint(),b=h.control.checkpoint();assert.equal(a,b);
 assert.equal(await a,false);assert.ok(h.saved().pausedAt);
 assert.ok(h.calls.some(c=>c.ack?.id==='pause'));assert.ok(h.calls.some(c=>c.ack?.id==='resume'));
 assert.ok(h.control.pausedMs()>0);h.close();await h.control.leave();
});
test('completed runs clear heartbeat timer and legacy scans never poll the backend',async()=>{
 const h=harness();await h.control.enter({...h.task,scanProtocol:undefined});assert.equal(h.calls.length,0);
 await h.control.enter(h.task);h.setReply({success:true,desired:'STOPPED',commands:[]});await h.control.checkpoint();await h.control.leave();assert.equal(h.timers.size,0);
});

test('failed checkpoint never reports a successful pause acknowledgement',async()=>{
 const h=harness({failSave:true});await h.control.enter(h.task);
 h.setReply({success:true,desired:'PAUSED',commands:[{id:'pause',kind:'PAUSE'}]});
 h.onSleep(()=>h.close());await h.control.checkpoint();
 assert.ok(h.calls.some(c=>c.ack?.id==='pause'&&c.ack.ok===false));
 assert.equal(h.calls.some(c=>c.ack?.id==='pause'&&c.ack.ok===true),false);
 await h.control.leave();
});

test('STOP ack created during heartbeat is sent after that heartbeat completes',async()=>{
 const h=harness();await h.control.enter(h.task);
 h.setReply({success:true,desired:'STOPPED',commands:[{id:'stop',kind:'STOP'}]});await h.control.checkpoint();
 const release=h.holdNext(),heartbeat=[...h.timers][0]();
 const finish=h.control.leave();release();await heartbeat;await finish;
 assert.ok(h.calls.some(c=>c.ack?.id==='stop'&&c.ack.ok===true));
});
