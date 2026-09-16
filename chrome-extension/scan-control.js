(function(root) {
  function create({platform,version,instanceId,current,readTask,saveTask,status,resume,setStopped,readStatus}) {
    let task=null, directive=null, timer=null, flight=null, active=false, offline=false, ack=null, waiting=false, stopped=false, lastSync=0, pauseAt=0, pausedTotal=0, checking=null;
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
        if(command?.kind==='RESUME') {
          const saved=readTask();
          const valid=!!saved && saved.runId===task.runId && Number(saved.profileId)===Number(task.profileId) && saved.scanOwnerToken===task.scanOwnerToken && !saved.completed && Date.now()-Number(saved.updatedAt||saved.startedAt||0)<86400000 && JSON.stringify(saved.config)===JSON.stringify(task.config);
          ack={id:command.id,ok:valid,errorCode:valid?'':'CHECKPOINT_MISSING'};
          await sync();
          if(valid && directive?.desired==='RUNNING') {
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
    async function finish(){
        active=false;
        if(stopped) {
          const command=directive?.commands?.[0];
          if(command?.kind==='STOP'){ack={id:command.id,ok:true};await sync();}
          status({stage:'stopped',isRunning:false,stopRequested:true,message:'扫描已停止',runId:task?.runId});
        }
        const state=readStatus();
        if((stopped && !ack) || (!stopped && ['complete','stopped','error'].includes(state?.stage))) {clearInterval(timer);task=null;}
    }
    return {
      epochFor:runId=>task?.runId===runId?directive?.epoch:undefined,
      fault(){offline=true;lastSync=0;},
      pausedMs:()=>pausedTotal+(pauseAt?Date.now()-pauseAt:0),
      async enter(t) {
        if(t.scanProtocol!==1) {clearInterval(timer);task=null;active=false;stopped=false;return;}
        if(!task || task.runId!==t.runId || task.profileId!==t.profileId) {directive=null;offline=false;ack=null;lastSync=0;pauseAt=0;pausedTotal=0;}
        task=t;active=true;stopped=false;await saveTask(t);
        clearInterval(timer);
        timer=setInterval(async()=>{
          await sync(true);
          if(stopped && !ack){clearInterval(timer);task=null;return;}
          if(!active && !waiting && directive?.commands?.length && readTask()) {
            active=true;
            const stopped=await check();active=false;
            if(stopped) await finish();
            else if(current()) resume();
          }
        },10000);
        await sync();
      },
      leave:finish,checkpoint:check,
    };
  }
  root.GetJobsScanControl={create};
  if(typeof module!=='undefined') module.exports=root.GetJobsScanControl;
})(globalThis);
