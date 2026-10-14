const assert=require('node:assert/strict');
const test=require('node:test');
const support=require('../scan-start-support.js');
const request={runId:'boss-test',profileId:4,scanOwnerToken:'owner'};
test('only an exact accepted identity proves page acceptance',()=>{
  const task={...request,startAccepted:true,startConfigKey:'config'};
  assert.equal(support.readonlyStatus(request,task,null).startAccepted,true);
  for(const extra of [{runId:'old'},{profileId:5},{scanOwnerToken:'other'},{startAccepted:false}]) {
    assert.equal(support.readonlyStatus(request,{...task,...extra},null).startAccepted,false);
  }
  assert.equal(support.readonlyStatus(request,null,{...request,isRunning:true}).startAccepted,false);
});
test('terminal or paused accepted state remains evidence without resuming',()=>{
  const status={...request,startAccepted:true,stage:'blocked',paused:true,isRunning:false};
  const before=JSON.stringify(status);
  const result=support.readonlyStatus(request,null,status);
  assert.equal(result.startAccepted,true);assert.equal(result.isRunning,false);assert.equal(result.paused,true);
  assert.equal(JSON.stringify(status),before);
  assert.equal(support.readonlyStatus(request,{...request,startAccepted:true,pausedAt:Date.now()},null).isRunning,false);
  assert.equal(support.readonlyStatus(request,{...request,startAccepted:true,phase:'complete'},null).resumable,false);
});
test('unknown ports and lost replies are never classified as no receiver',()=>{
  assert.equal(support.isNoReceiver(new Error('Could not establish connection. Receiving end does not exist.')),true);
  for(const message of ['The message port closed before a response was received.','timeout','Extension context invalidated.']) {
    assert.equal(support.isNoReceiver(new Error(message)),false);
  }
});
