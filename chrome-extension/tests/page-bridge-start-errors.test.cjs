const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function run(error,throws=false) {
  let listener;const sent=[];
  const window={location:{origin:'http://127.0.0.1:6866'},addEventListener:(_name,fn)=>listener=fn,
    postMessage:message=>sent.push(message)};
  const chrome={runtime:{lastError:error?{message:error}:null,onMessage:{addListener(){}},
    sendMessage:(_message,callback)=>{if(throws)throw new Error(error);callback(undefined);}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../page-bridge.js'),'utf8'),{window,chrome});
  listener({source:window,origin:window.location.origin,data:{source:'GET_JOBS_PAGE',type:'BOSS_SCAN_START',requestId:'r'}});
  return sent.find(message=>message.requestId==='r').response;
}
test('bridge loss reports structured errors instead of an empty success',()=>{
  assert.equal(run('').errorCode,'BRIDGE_EMPTY_RESPONSE');
  assert.equal(run('The message port closed before a response was received.').errorCode,'BRIDGE_EMPTY_RESPONSE');
  assert.equal(run('Receiving end does not exist.').errorCode,'EXTENSION_NOT_CONNECTED');
});
test('synchronous invalidated contexts respond immediately without another dispatch',()=>{
  const response=run('Extension context invalidated.',true);
  assert.equal(response.success,false);assert.equal(response.errorCode,'EXTENSION_NOT_CONNECTED');
});
