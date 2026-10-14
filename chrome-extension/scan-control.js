(function(root) {
  function create({platform,version,instanceId,current,readTask,saveTask,status,resume,setStopped,readStatus,clearTask}) {
    let task=null, directive=null, timer=null, flight=null, active=false, offline=false, ack=null, waiting=false, stopped=false, lastSync=0, pauseAt=0, pausedTotal=0, checking=null, finishing=null, checkpointError='';
    async function sync(force=false) {
      if(!task || !current()) return null;
      if(flight) {await flight;if(ack)return sync(true);return directive;}
      if(!force && !ack && directive && Date.now()-lastSync<2000) return directive;
      const sentAck=ack;
      flight=(async()=>{
        try {
          const r=await chrome.runtime.sendMessage({source:'GET_JOBS_SCAN_CONTROL',type:'SCAN_CONTROL_SYNC',
            platform,profileId:task.profileId,runId:task.runId,ownerToken:task.scanOwnerToken,
            contentVersion:version,instanceId,fault:offline?'CONTENT_PAUSED_OFFLINE':'',ack:sentAck});
          if(!r?.success) {offline=true;return null;}
          directive=r;if(ack===sentAck)ack=null;lastSync=Date.now();
          if(r.desired==='RUNNING' && !r.localPaused) offline=false;
          return r;
        } catch(_) {offline=true;return null;} finally {flight=null;}
      })();return flight;
    }
    async function checkpoint() {
      if(!active || !task) return false;
      if(stopped) return true;
      await sync();
      while(current()) {
        const command=directive?.commands?.[0];
        if(command?.kind==='STOP' || directive?.desired==='STOPPED') {
          stopped=true;setStopped();return true;
        }
        if(command?.kind==='RESUME' || command?.kind==='PAUSE' || checkpointError) {
          const saved=readTask();
          const matches=!!saved && saved.runId===task.runId && Number(saved.profileId)===Number(task.profileId)
            && saved.scanOwnerToken===task.scanOwnerToken && !saved.completed && JSON.stringify(saved.config)===JSON.stringify(task.config);
          const timestamp=Number(saved?.updatedAt||saved?.startedAt||0);
          const errorCode=checkpointError || (!saved || !timestamp ? 'CHECKPOINT_MISSING'
            : !matches ? 'CHECKPOINT_MISMATCH' : Date.now()-timestamp>=86400000 ? 'CHECKPOINT_EXPIRED' : '');
          if(errorCode) {
            if(command) {ack={id:command.id,ok:false,errorCode};await sync();}
            status({stage:'blocked',paused:true,isRunning:false,resumable:false,runId:task.runId,
              diagnosticType:errorCode,resumeErrorCode:errorCode,
              message:errorCode==='CHECKPOINT_EXPIRED'?'恢复断点已超过 24 小时，请停止本轮后新建扫描':'恢复断点不存在或身份不匹配，请停止本轮后新建扫描'});
            return true;
          }
        }
        if(command?.kind==='RESUME') {
          ack={id:command.id,ok:true,errorCode:''};
          await sync();
          if(directive?.desired==='RUNNING') {
            offline=false;
            status({stage:'resume',paused:false,isRunning:true,message:'已确认继续扫描',runId:task.runId});
          }
        }
        if(!offline && directive?.desired==='RUNNING') {if(pauseAt){pausedTotal+=Date.now()-pauseAt;pauseAt=0;}return false;}
        if(!pauseAt)pauseAt=Date.now();
        const saved=readTask() || task;
        let checkpointSaved=false;
        try {await saveTask({...saved,scanProtocol:1,scanOwnerToken:task.scanOwnerToken,pausedAt:Date.now()});checkpointSaved=true;}
        catch(_) { if(command) {ack={id:command.id,ok:false,errorCode:'CHECKPOINT_SAVE_FAILED'};await sync();} offline=true; }

        status({stage:'blocked',paused:true,isRunning:false,resumable:true,message:offline?'后端连接中断，断点已保留':'扫描已暂停，断点已保留',runId:task.runId});
        if(command?.kind==='PAUSE' && checkpointSaved) {ack={id:command.id,ok:true};await sync();}
        waiting=true;await new Promise(resolve=>setTimeout(resolve,1000));waiting=false;
        await sync();
      }
      return true;
    }
    function check(){if(!checking)checking=checkpoint().finally(()=>{checking=null});return checking;}
    function finish(){
        if(!finishing) finishing=finishInternal().finally(()=>{finishing=null;});
        return finishing;
    }
    async function finishInternal(){
        active=false;
        if(stopped) {
          let clearFailed=false;
          try {if(current()) await clearTask?.(task);} catch {clearFailed=true;}
          const command=directive?.commands?.[0];
          if(command?.kind==='STOP'){ack={id:command.id,ok:!clearFailed,errorCode:clearFailed?'CHECKPOINT_CLEAR_FAILED':''};await sync();}
          status({stage:clearFailed?'blocked':'stopped',isRunning:false,stopRequested:true,
            paused:clearFailed,resumable:false,diagnosticType:clearFailed?'CHECKPOINT_CLEAR_FAILED':'',
            message:clearFailed?'扫描执行已停止，但断点清理失败，请核对扫描记录':'扫描已停止',runId:task?.runId});
        }
        const state=readStatus();
        if((stopped && !ack) || (!stopped && ['complete','stopped','error'].includes(state?.stage))) {clearInterval(timer);task=null;}
    }
    async function heartbeat() {
          await sync(true);
          if(!current() || !task) {clearInterval(timer);return;}
          if(stopped && !ack){clearInterval(timer);task=null;return;}
          if(!active && !waiting && (directive?.commands?.[0]?.kind==='STOP' || directive?.desired==='STOPPED')) {
            stopped=true;setStopped();await finish();return;
          }
          if(!active && !waiting && directive?.commands?.length) {
            active=true;
            const shouldStop=await check();active=false;
            if(shouldStop) await finish();
            else if(current()) resume();
          }
    }
    async function start(t, running, options={}) {
        if(finishing) await finishing;
        if(t.scanProtocol!==1) {clearInterval(timer);task=null;active=false;stopped=false;return;}
        if(!task || task.runId!==t.runId || task.profileId!==t.profileId) {directive=null;offline=false;ack=null;lastSync=0;pauseAt=0;pausedTotal=0;}
        task=t;active=running;stopped=false;checkpointError=options.checkpointError || '';
        // Reconnecting controls must not create a missing checkpoint or renew
        // the original checkpoint's 24-hour recovery window.
        if(running) await saveTask(t);
        clearInterval(timer);
        timer=setInterval(heartbeat,10000);
        await sync();
        if(!running) await heartbeat();
    }
    return {
      epochFor:runId=>task?.runId===runId?directive?.epoch:undefined,
      fault(){offline=true;lastSync=0;},
      pausedMs:()=>pausedTotal+(pauseAt?Date.now()-pauseAt:0),
      enter:t=>start(t,true),
      watch:(t,options)=>start(t,false,options),
      leave:finish,checkpoint:check,
    };
  }
  root.GetJobsScanControl={create};
  if(typeof module!=='undefined') module.exports=root.GetJobsScanControl;
})(globalThis);
