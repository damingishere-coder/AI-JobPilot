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
test('configuration fingerprints match SHA-256 vectors and are opaque UTF-8 digests',()=>{
  const crypto=require('node:crypto');
  for(const text of ['', 'abc', '中文', JSON.stringify({salary:['10001,15000'],city:'深圳'})]) {
    const expected='sha256:'+crypto.createHash('sha256').update(text,'utf8').digest('hex');
    assert.equal(support.fingerprint(text),expected);
    assert.equal(support.normalizeKey(expected),expected);
    assert.equal(support.keyMatches(text,expected),true);
  }
});
test('old BOSS nested cursor keys compare without exposing another filter copy',()=>{
  const oldCursor=JSON.stringify({salary:['10001,15000'],keywords:['采购']});
  const oldStart=JSON.stringify({cursor:oldCursor,scanProtocol:1,autoDeliver:false});
  const modern=support.fingerprint(JSON.stringify({cursor:support.fingerprint(oldCursor),scanProtocol:1,autoDeliver:false}));
  assert.equal(support.normalizeBossStartKey(oldStart),modern);
  assert.equal(support.normalizeBossStartKey(modern),modern);
  assert.notEqual(support.normalizeBossStartKey(oldStart),support.fingerprint(oldStart));
});
test('the actual browser bundle supplies synchronous hashing in an isolated context',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const window={};const context=vm.createContext({window});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../vendor/js-sha256.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../scan-start-support.js'),'utf8'),context);
  assert.equal(context.GetJobsScanStartSupport.fingerprint('abc'),'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
