(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GetJobsBossHrHost = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const PROTOCOL = "2026-09-30-hr-background-v1";
  const KEY = "__GET_JOBS_BOSS_HR_HOST_V1__";
  const ALARM = "getjobs-boss-hr-background";
  const CHAT_URL = "https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1";
  const TYPES = new Set(["START", "STATUS", "PAUSE", "RESUME", "STOP", "VIEW"].map(value => "BOSS_HR_HOST_" + value));
  function create({ chrome, request, ensureContent, now = Date.now, uuid = () => crypto.randomUUID() }) {
    let queue = Promise.resolve(), tickPromise = null, controlPromise = null;
    const read = async () => (await chrome.storage.local.get(KEY))[KEY] || null;
    const update = (changes, expected = null) => {
      const next = queue.then(async () => {
        const state = await read();
        if (expected && ((!state && expected.exists!==false) || (state && expected.exists===false)
          || (!state?.intentEnabled && !expected.allowDisabled) || (state?.paused && !expected.allowPaused)
          || (state?.hostGeneration || "")!==(expected.hostGeneration || "") || Number(state?.controlRevision || 0)!==Number(expected.controlRevision || 0)))
          throw fault("HR_HOST_CANCELLED","托管已停止或运行代次发生变化");
        const value = { ...(state || {}), ...changes, protocol: PROTOCOL, updatedAt: now() };
        await chrome.storage.local.set({ [KEY]: value });
        return value;
      });
      queue = next.catch(() => {});
      return next;
    };
    const apiData = value => value?.data?.data || null;
    const context = state => ({ operation:"hr-background",platform: "boss", pageTabId: state.tabId, timeoutMs: 15000, requireActionToken: true });
    const active = async expected => {
      const current=await read();
      if (!current?.intentEnabled || current.paused || current.hostGeneration!==expected.hostGeneration || current.controlRevision!==expected.controlRevision)
        throw fault("HR_HOST_CANCELLED","托管已停止或运行代次发生变化");
      return current;
    };
    const anchors = (state, page) => ({ hostGeneration: state.hostGeneration, pageDocumentId: page?.documentId || state.pageDocumentId,
      pageObservedAt: page?.observedAt || state.lastPageSeenAt, accountIdentity: page?.accountIdentity || state.accountIdentity });
    const fault = (code, message, retryable = false) => Object.assign(new Error(message), { errorCode: code, retryable });
    const chat = url => { try { const u = new URL(url); return u.origin === "https://www.zhipin.com" && /^\/web\/geek\/chat\/?$/.test(u.pathname) && u.searchParams.get("getjobs-autopilot") === "1"; } catch { return false; } };
    async function alarm() { await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); }
    async function restoreTab(state) {
      if (state?.tabId != null && typeof state.originalAutoDiscardable === "boolean")
        await chrome.tabs.update(state.tabId, { autoDiscardable: state.originalAutoDiscardable }).catch(() => {});
    }
    async function reportFault(state, code) {
      if (!state?.watchSessionId || !state.accountIdentity) return;
      await request("/api/hr-assistant/watch/fault", { ...context(state), method:"POST", body:{
        transport:"CHROME_BACKGROUND",watchSessionId:state.watchSessionId,hostGeneration:state.hostGeneration,
        accountIdentity:state.accountIdentity,code:String(code || "HR_HOST_FAILED").slice(0,80)
      } }).catch(()=>{});
    }
    async function status() {
      const state = await read();
      const publicState=state?{...state}:{};
      // Lease checkpoints belong to this worker, not the workbench page.
      if(publicState.operation) {publicState.operation={...publicState.operation};delete publicState.operation.leaseToken;}
      delete publicState.retiredOperations;
      return { success: true, data: { transport: "CHROME_BACKGROUND", state: "STOPPED", intentEnabled: false, paused: false,
        ...publicState, hrBackgroundProtocol: PROTOCOL } };
    }
    async function stop(reason = "用户停止", disabled = true, origin = "USER") {
      const state = await read();
      await update({ intentEnabled: !disabled && Boolean(state?.intentEnabled), paused: !disabled, state: disabled ? "STOPPED" : "PAUSED",
        pauseReason: reason, pauseOrigin:origin,errorCode: "", message: reason, watchSessionId: "", nextScanAt: null,controlRevision:Number(state?.controlRevision || 0)+1 });
      if(disabled || origin!=="REMOTE")await chrome.alarms.clear(ALARM);
      else await alarm();
      if(origin!=="REMOTE" && state?.profileId)await request("/api/hr-assistant/autopilot/pause",{...context(state),method:"POST",body:{transport:"CHROME_BACKGROUND"}}).catch(()=>{});
      if (state?.watchSessionId) await request("/api/hr-assistant/watch/stop", { ...context(state), method: "POST",
        body: { watchSessionId: state.watchSessionId, reason, transport: "CHROME_BACKGROUND", ...anchors(state) } }).catch(() => {});
      if (state?.tabId != null) await chrome.tabs.sendMessage(state.tabId, { source: "GET_JOBS_BACKGROUND", type: "BOSS_HR_HOST_UNBIND", hostGeneration: state.hostGeneration }).catch(() => {});
      await restoreTab(state);
      return status();
    }
    async function settleUnknown(state) {
      const operation=state.operation;
      if(operation?.kind!=="SEND")return state;
      if(now()<Number(operation.deadlineAt || 0)+15000)
        throw fault("SEND_RESULT_PENDING","上一条发送仍待核验，请等待租约结束；不会重复发送");
      if(!operation.leaseToken || !operation.watchSessionId)
        throw fault("SEND_CHECKPOINT_MISSING","旧发送缺少恢复检查点，请先人工核验该会话");
      const expected={...state,allowPaused:true,allowDisabled:true};
      let receipt=null;
      if(!operation.recoveryResultAttempted) {
        state=await update({operation:{...operation,recoveryResultAttempted:true}},expected);
        receipt=await request(`/api/hr-assistant/send-commands/${encodeURIComponent(operation.commandId)}/result`,{
          ...context(state),method:"POST",body:{watchSessionId:operation.watchSessionId,tabId:operation.tabId || state.tabId,
            leaseToken:operation.leaseToken,outcome:"RESULT_UNKNOWN",evidence:"后台回执检查点丢失，明确恢复前冻结旧会话，不重复发送",
            hostGeneration:operation.hostGeneration || state.hostGeneration,pageDocumentId:operation.pageDocumentId || state.pageDocumentId,
            accountIdentity:operation.accountIdentity || state.accountIdentity,pageObservedAt:operation.pageObservedAt || state.lastPageSeenAt}
        }).catch(()=>null);
      }
      // The persistent lease checkpoint remains authoritative after a backend or
      // document restart. An unavailable server must never clear the outbox.
      const checkpoint=await request(`/api/hr-assistant/send-commands/${encodeURIComponent(operation.commandId)}/status`,{
        ...context(state),method:"POST",body:{watchSessionId:operation.watchSessionId,leaseToken:operation.leaseToken}
      }).catch(()=>null);
      if(!checkpoint?.success || !["UNKNOWN","SENT","STALE","BLOCKED"].includes(apiData(checkpoint)?.state))
        throw fault("SEND_RESULT_PENDING",checkpoint?.message || receipt?.message || "后端尚未确认旧发送已冻结，请稍后恢复；不会重发");
      const retired={...operation,hostGeneration:operation.hostGeneration || state.hostGeneration,pageDocumentId:operation.pageDocumentId || state.pageDocumentId,
        accountIdentity:operation.accountIdentity || state.accountIdentity,tabId:operation.tabId || state.tabId,checkpointState:apiData(checkpoint).state};
      return update({operation:null,retiredOperations:[...(state.retiredOperations || []).filter(item=>item.commandId!==retired.commandId),retired].slice(-8)},expected);
    }
    async function control(message, sender) {
      if (message.type === "BOSS_HR_HOST_STATUS") return status();
      if (message.type === "BOSS_HR_HOST_PAUSE") return stop("用户暂停",false);
      if (message.type === "BOSS_HR_HOST_STOP") return stop();
      if (controlPromise) return { success: false, errorCode: "HR_HOST_BUSY", message: "托管操作正在处理，请查看当前状态" };
      controlPromise = (async () => {
        if (message.type === "BOSS_HR_HOST_PAUSE") return stop("用户暂停", false);
        if (message.type === "BOSS_HR_HOST_STOP") return stop();
        if (message.type === "BOSS_HR_HOST_VIEW") {
          const state = await read();
          const tab = state?.tabId != null ? await chrome.tabs.get(state.tabId).catch(() => null) : null;
          if (!tab || !chat(tab.url)) return { success: false, message: "尚未绑定专用聊天标签" };
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          return status();
        }
        if (message.hrBackgroundProtocol !== PROTOCOL) throw fault("HR_HOST_PROTOCOL_MISMATCH", "请加载 Chrome Bridge 1.10.1 并刷新工作台");
        let previous = await read();
        const profileId = Number(message.expectedProfileId);
        if (!Number.isSafeInteger(profileId) || profileId <= 0) throw fault("PROFILE_REQUIRED", "请先确认当前人物档案");
        if (previous?.intentEnabled && !previous.paused && !previous.needsAccountConfirmation && previous.profileId === profileId) return status();
        if (previous?.intentEnabled && previous.profileId !== profileId) throw fault("HR_HOST_PROFILE_CONFLICT", "请先停止当前档案的托管");
        if (message.type === "BOSS_HR_HOST_START" && message.accountBindingConfirmed !== true)
          throw fault("ACCOUNT_CONFIRMATION_REQUIRED", "请确认当前 Chrome 登录的是本档案对应的 BOSS 求职者账号");
        if (previous?.needsAccountConfirmation && message.accountBindingConfirmed !== true)
          throw fault("ACCOUNT_RECONFIRM_REQUIRED", "Chrome 已重启，请确认当前求职者账号后恢复");
        if(previous?.operation?.kind==="SEND")previous=await settleUnknown(previous);
        const reauthorize=message.type==="BOSS_HR_HOST_START" && !previous?.intentEnabled;
        if(message.type==="BOSS_HR_HOST_RESUME") {
          const resumed=await request("/api/hr-assistant/autopilot/resume",{...context(previous || {}),method:"POST",body:{transport:"CHROME_BACKGROUND"}});
          if(!resumed.success)throw fault(resumed.errorType || "HR_POLICY_RESUME_FAILED",resumed.message || "后台托管规则尚未恢复");
        }
        await update({ intentEnabled: true, paused: false, state: "STARTING", pauseReason: "", errorCode: "", message: "正在后台校验登录和托管规则",
          profileId, hostGeneration:message.type==="BOSS_HR_HOST_RESUME" && previous?.intentEnabled ? previous.hostGeneration : uuid(),
          browserSessionId:message.type==="BOSS_HR_HOST_RESUME" && previous?.intentEnabled ? previous.browserSessionId : uuid(),watchSessionId: "", pageDocumentId: "", lastPageSeenAt: null,
          accountBindingConfirmed: message.accountBindingConfirmed === true || previous?.accountBindingConfirmed === true,
          accountIdentity: !reauthorize && previous?.profileId === profileId ? previous.accountIdentity || "" : "", accountName: !reauthorize && previous?.profileId === profileId ? previous.accountName || "" : "",
          cursor: !reauthorize && previous?.profileId===profileId ? previous.cursor || null : null, baselineComplete:!reauthorize && Boolean(previous?.baselineComplete),lastReconcileAt:reauthorize?null:previous?.lastReconcileAt || null,
          operation: null, retryCount: 0, retryAt: 0, nextScanAt: now(), workbenchWindowId: sender?.tab?.windowId,
          explicitResume: true, needsAccountConfirmation: false, legacyAnchorsChecked: false,controlRevision:Number(previous?.controlRevision || 0)+1,
          expectedAccountName: String(message.expectedAccountName || (!reauthorize && previous?.expectedAccountName) || "") },
          {...(previous || {}),exists:Boolean(previous),allowDisabled:true,allowPaused:true});
        await alarm();
        await tick();
        return status();
      })().catch(error => ({ success: false, errorCode: error.errorCode || "HR_HOST_START_FAILED", message: error.message })).finally(() => { controlPromise = null; });
      return controlPromise;
    }
    async function getPage(state, explicit = false) {
      let tab = state.tabId != null ? await chrome.tabs.get(state.tabId).catch(() => null) : null;
      if (!tab) {
        const tabs = await chrome.tabs.query({});
        const candidates = tabs.filter(item => chat(item.url || item.pendingUrl || ""));
        if (candidates.length > 1) throw fault("HR_HOST_TAB_AMBIGUOUS", "发现多个专用聊天标签，请保留一个后恢复");
        tab=candidates[0];
        if(!tab) {
          // Chrome window IDs do not survive a browser restart. Use a verified
          // existing normal window, and never create or focus a window here.
          let window=state.workbenchWindowId!=null ? await chrome.windows.get(state.workbenchWindowId).catch(()=>null) : null;
          if(!window || window.type!=="normal" || window.incognito) {
            const windows=await chrome.windows.getAll({windowTypes:["normal"],populate:false});
            window=windows.find(item=>item.type==="normal" && !item.incognito);
          }
          if(!window)throw fault("HR_BROWSER_WINDOW_UNAVAILABLE","Chrome 暂无普通窗口，等待浏览器窗口出现后在后台恢复",true);
          await active(state);
          tab=await chrome.tabs.create({url:CHAT_URL,active:false,windowId:window.id}).catch(()=>{
            throw fault("HR_BACKGROUND_TAB_CREATE_FAILED","Chrome 窗口暂不可用，后台稍后重试",true);
          });
        }
        state = await update({ tabId: tab.id,workbenchWindowId:tab.windowId,originalAutoDiscardable: tab.autoDiscardable !== false, watchSessionId: "", pageDocumentId: "" },state);
      }
      if (!chat(tab.url || tab.pendingUrl || "")) throw fault("BOSS_CHAT_TAB_NAVIGATED", "专用标签已离开聊天页，请恢复托管");
      await active(state);
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      if (tab.frozen) throw fault("BOSS_CHAT_TAB_FROZEN", "Chrome 冻结了聊天标签；请在 Chrome 恢复该标签后点击恢复，系统不会抢桌面");
      if (tab.discarded) throw fault("BOSS_CHAT_TAB_DISCARDED", "Chrome 已卸载聊天标签；请恢复标签后点击恢复，系统不会激活页面");
      if (tab.status !== "complete" || tab.pendingUrl) throw fault("BOSS_CHAT_TAB_LOADING", "聊天标签正在加载，后台稍后重试", true);
      await ensureContent(tab.id);
      const page = await timeout(chrome.tabs.sendMessage(tab.id, { source: "GET_JOBS_BACKGROUND", type: "BOSS_HR_HOST_PAGE_PING", protocol: PROTOCOL }), 8000);
      if (!page?.success || page.protocol !== PROTOCOL) throw fault(page?.errorCode || "HR_PAGE_NOT_READY", page?.message || "聊天脚本未就绪，后台稍后重试", true);
      if (!page.safety?.safe) throw fault(page.safety?.errorCode || "HR_PAGE_UNVERIFIED", page.safety?.message || "BOSS 登录或页面无法核验");
      if (!page.accountIdentity || !page.accountName || page.accountRole !== "GEEK") throw fault("BOSS_ACCOUNT_UNVERIFIED", "未读到求职者顶栏账号，请查看聊天页面并核验账号");
      if (state.needsAccountConfirmation) throw fault("ACCOUNT_RECONFIRM_REQUIRED", "Chrome 已重启，页面只提供账号显示名，请确认当前求职者账号后恢复");
      if (state.accountIdentity && state.accountIdentity !== page.accountIdentity) throw fault("BOSS_ACCOUNT_CHANGED", "BOSS 登录账号已变化，需要停止托管后重新确认账号");
      if (state.expectedAccountName && state.expectedAccountName !== page.accountName) throw fault("BOSS_ACCOUNT_MISMATCH", "登录账号与已确认账号不一致");
      if (page.userPaused && !explicit) throw fault("USER_PAUSED", "检测到专用聊天页手动操作，请明确恢复");
      if (page.operation?.active) throw fault("HR_PAGE_OPERATION_BUSY", "页面还有读取或发送在处理，等待结果", true);
      if (page.hasDraft) throw fault("USER_DRAFT_PRESENT","聊天输入框有未发送文字，请人工处理后恢复");
      state = await update({ accountIdentity: page.accountIdentity, accountName: page.accountName, accountIdentityStable:page.accountIdentityStable===true, pageDocumentId: page.documentId, lastPageSeenAt: page.observedAt },state);
      return { state, page };
    }
    async function bind(state, page) {
      const backend = await request("/api/hr-assistant/status", { ...context(state), method: "GET", requireActionToken: false });
      const observed = apiData(backend);
      await active(state);
      const matched = backend.success && observed?.watching && observed.watchSessionId === state.watchSessionId
        && observed.hostGeneration === state.hostGeneration && observed.pageDocumentId === page.documentId;
      if (!matched) {
        if (observed?.watching) {
          if (observed.hostGeneration!==state.hostGeneration || observed.profileId!==state.profileId)
            throw fault("HR_OTHER_WATCH_ACTIVE","已有其他值守任务，请先停止原任务");
          const stopped=await request("/api/hr-assistant/watch/stop",{...context(state),method:"POST",body:{watchSessionId:observed.watchSessionId,reason:"当前后台页面重载，校验后重新绑定",...anchors(state,page)}});
          if (!stopped.success) throw fault("HR_REBIND_FAILED",stopped.message || "旧页面绑定尚未结束");
          await active(state);
        }
        const started = await request("/api/hr-assistant/watch/start", { ...context(state), method: "POST", body: {
          tabId: state.tabId, url: CHAT_URL, contentVersion: PROTOCOL, browserSessionId: state.browserSessionId,
          expectedProfileId: state.profileId, intervalMinutes: 1, reviewLimit: 0, transport: "CHROME_BACKGROUND",
          accountName: page.accountName, accountBindingConfirmed: state.accountBindingConfirmed, ...anchors(state, page) } });
        if (!started.success || !apiData(started)?.watchSessionId) throw fault(started.errorType || "HR_BACKEND_BIND_FAILED", started.message || "值守绑定未确认",
          started.httpStatus >= 500 || !started.httpStatus || (started.httpStatus===409 && started.errorType==="HR_WATCH_ACTIVE"
            && (!observed?.profileId || observed.profileId===state.profileId)));
        try {state = await update({ watchSessionId: apiData(started).watchSessionId },state);}
        catch(error) {
          await request("/api/hr-assistant/watch/stop",{...context(state),method:"POST",body:{watchSessionId:apiData(started).watchSessionId,reason:"后台启动已被用户取消",...anchors(state,page)}}).catch(()=>{});
          throw error;
        }
      }
      const bound = await chrome.tabs.sendMessage(state.tabId, { source: "GET_JOBS_BACKGROUND", type: "BOSS_HR_HOST_BIND",
        protocol: PROTOCOL, hostGeneration: state.hostGeneration, watchSessionId: state.watchSessionId, documentId: page.documentId, explicitResume:state.explicitResume===true });
      if (!bound?.success) throw fault("HR_PAGE_BIND_FAILED", "专用页面绑定已变化");
      // A new backend binding has already consumed the first observation. Obtain a new
      // timestamp from the actual page; never advance it using the service worker clock.
      await new Promise(resolve=>setTimeout(resolve,20));
      const heartbeatPage=await timeout(chrome.tabs.sendMessage(state.tabId,{source:"GET_JOBS_BACKGROUND",type:"BOSS_HR_HOST_PAGE_PING",protocol:PROTOCOL}),8000);
      if (!heartbeatPage?.success || heartbeatPage.documentId!==page.documentId || heartbeatPage.accountIdentity!==state.accountIdentity || !heartbeatPage.safety?.safe || heartbeatPage.userPaused)
        throw fault("HR_PAGE_CHANGED","绑定后的登录账号或页面已变化");
      const heartbeat = await request("/api/hr-assistant/watch/heartbeat", { ...context(state), method: "POST", body: {
        watchSessionId: state.watchSessionId, tabId: state.tabId, url: CHAT_URL, contentVersion: PROTOCOL,
        transport: "CHROME_BACKGROUND", scanRunning: Boolean(state.operation && state.operation.kind !== "SEND"), outboxCount: 0, fault: "", ...anchors(state, heartbeatPage) } });
      if (!heartbeat.success) throw fault(heartbeat.errorType || "HR_HEARTBEAT_REJECTED", heartbeat.message || "页面心跳未确认", !heartbeat.httpStatus || heartbeat.httpStatus >= 500);
      return update({lastPageSeenAt:heartbeatPage.observedAt},state);
    }
    async function tick() {
      if (tickPromise) return tickPromise;
      let owner=null;
      tickPromise = (async () => {
        let state = await read();
        owner=state;
        if (!state?.intentEnabled || (state.paused && state.pauseOrigin!=="REMOTE") || Number(state.retryAt || 0) > now()) return;
        if(state.paused && state.pauseOrigin==="REMOTE") {
          const remote=await request("/api/hr-assistant/autopilot",{...context(state),method:"GET",requireActionToken:false});
          if(!remote.success || apiData(remote)?.paused!==false)return;
          state=await update({paused:false,state:"RECOVERING",pauseReason:"",pauseOrigin:"",retryAt:0}, {...state,allowPaused:true});
          owner=state;
        }
        // Never reclaim or replay a command when the previous worker lost its callback.
        if (state.operation?.kind === "SEND") {
          if (now() < state.operation.deadlineAt + 15000) return;
          await update({ state: "BLOCKED", paused: true, pauseReason: "SEND_RESULT_UNKNOWN", errorCode: "SEND_RESULT_UNKNOWN", message: "发送回执未确认，请人工核验；不会自动重发" },state);
          await reportFault(state,"SEND_RESULT_UNKNOWN");
          await restoreTab(state);
          return;
        }
        const policy = await request("/api/hr-assistant/autopilot", { ...context(state), method: "GET", requireActionToken: false });
        const p = apiData(policy);
        await active(state);
        if (!policy.success) throw fault(policy.errorType || "HR_POLICY_UNAVAILABLE", policy.message || "无法读取托管规则", !policy.httpStatus || policy.httpStatus>=500);
        if (p?.paused) { await stop("QQ 或工作台已暂停托管", false,"REMOTE"); return; }
        if (!p?.enabled || !["AUTO","REVIEW"].includes(p.replyMode) || p.authorizationValid !== true
          || !["RECENT","NEW_ONLY"].includes(p.historyMode) || Number(p.historyDays) !== 30)
          throw fault("HR_AUTHORIZATION_REQUIRED", "请确认回复模式、历史处理范围和当前沟通资料");
        const ready = await getPage(state, state.explicitResume===true);
        state = await bind(ready.state, ready.page);
        state = await update({ state: "RUNNING", errorCode: "", message: "后台托管中", pauseReason: "", retryCount: 0, retryAt: 0, explicitResume:false },state);
        const legacy = await request("/api/hr-assistant/watch/legacy-anchors", { ...context(state), method:"POST",
          body:{watchSessionId:state.watchSessionId,tabId:state.tabId,...anchors(state,ready.page)} });
        if (!legacy.success) throw fault(legacy.errorType || "HR_LEGACY_ANCHORS_UNAVAILABLE",legacy.message || "无法核验历史未知发送",!legacy.httpStatus || legacy.httpStatus>=500);
        const legacyAnchors=Array.isArray(apiData(legacy))?apiData(legacy):[];
        await active(state);
        // A pending reply is already checked again against a newly read whole HR round by executeSend.
        const claimed = await request("/api/hr-assistant/send-commands/claim", { ...context(state), method: "POST",
          body: { watchSessionId: state.watchSessionId, tabId: state.tabId, ...anchors(state, ready.page) } });
        if (!claimed.success) throw fault(claimed.errorType || "HR_CLAIM_FAILED", claimed.message || "发送队列核验失败", !claimed.httpStatus || claimed.httpStatus >= 500);
        const command = apiData(claimed);
        await active(state);
        if (command) {
          const deadlineAt = Math.min(now() + 45000, Number(command.leaseDeadlineEpochMs) - 5000);
          await update({ operation: { kind: "SEND", phase: "CLAIMED", commandId: command.commandId,leaseToken:command.leaseToken,deadlineAt,
            startedAt: now(),watchSessionId:state.watchSessionId,hostGeneration:state.hostGeneration,pageDocumentId:state.pageDocumentId,
            accountIdentity:state.accountIdentity,tabId:state.tabId,pageObservedAt:state.lastPageSeenAt } },state);
          try {
            // The content script reports to a fresh worker independently of this callback.
            const result = await timeout(chrome.tabs.sendMessage(state.tabId, { source: "GET_JOBS_BACKGROUND", type: "BOSS_HR_SEND_V2",
              command: { ...command, deadlineAt, hostGeneration: state.hostGeneration, pageDocumentId: ready.page.documentId, watchSessionId: state.watchSessionId } }), 50000);
            if (!result?.reported) await content({ type: "BOSS_HR_HOST_RESULT", hostGeneration: state.hostGeneration, documentId: ready.page.documentId,
              commandId: command.commandId, leaseToken: command.leaseToken, outcome: "RESULT_UNKNOWN", evidence: "页面结果未持久确认" }, { tab: { id: state.tabId, url: CHAT_URL } });
          } catch { await update({ state: "RECOVERING", message: "发送回执待核验，不会重发" },state).catch(()=>{}); }
          return;
        }
        if (!state.cursor && Number(state.nextScanAt || 0) > now()) return;
        if (!state.cursor) state = await update({ cursor: { stage: "LIST", scope: legacyAnchors.length || !state.baselineComplete || !state.lastReconcileAt || now()-state.lastReconcileAt>=1800000?"ALL":"UNREAD", scrollTop: 0, queue: [], seen: [], baseline: !state.baselineComplete,
          scanId: uuid(), reconcile: !state.lastReconcileAt || now() - state.lastReconcileAt >= 1800000 }, operation: null },state);
        const cursor = state.cursor;
        await update({ operation: { kind: cursor.stage, phase: "READING", startedAt: now(), deadlineAt: now() + 20000 } },state);
        const response = await timeout(chrome.tabs.sendMessage(state.tabId, { source: "GET_JOBS_BACKGROUND", type: "BOSS_HR_HOST_SCAN_STEP",
          protocol: PROTOCOL, hostGeneration: state.hostGeneration, documentId: ready.page.documentId, watchSessionId: state.watchSessionId,
          cursor, legacyAnchors, target: cursor.queue[0] || null, deadlineAt: now() + 20000 }), 22000);
        const latest = await read();
        if (!latest?.intentEnabled || latest.paused || latest.hostGeneration !== state.hostGeneration) return;
        if (!response?.success) throw fault(response?.errorCode || "HR_CAPTURE_READ_FAILED", response?.message || "会话读取未就绪", response?.retryable === true);
        if (cursor.stage === "LIST") {
          const seen = new Set(cursor.seen), targets = cursor.queue.slice();
          for (const item of response.targets || []) if (item.uid && !seen.has(item.uid)) { seen.add(item.uid); targets.push({ uid: item.uid, captureId: item.captureId,legacyAnchorId:item.legacyAnchorId || null }); }
          targets.sort((a,b)=>Number(Boolean(b.legacyAnchorId))-Number(Boolean(a.legacyAnchorId)));
          if (seen.size > 1000) throw fault("HR_LIST_LIMIT", "会话列表超过安全范围，请人工检查");
          const stalled=response.hasMore && seen.size===cursor.seen.length && Number(response.nextScrollTop)===Number(cursor.scrollTop);
          const stalledSteps=stalled?Number(cursor.stalledSteps || 0)+1:0;
          if(stalledSteps>=3) throw fault("HR_LIST_SCROLL_STALLED", "联系人列表滚动未前进，已暂停并保留采集进度，请检查页面后恢复");
          await update({ cursor: { ...cursor, queue: targets, seen: [...seen], scrollTop: response.nextScrollTop,
            stalledSteps,
            stage: response.hasMore ? "LIST" : "CAPTURE" }, operation: null },state);
        } else {
          if (response.capture) {
            const capture = response.capture;
            const saved = await request("/api/hr-assistant/watch/captures", { ...context(state), method: "POST", body: {
              watchSessionId: state.watchSessionId, tabId: state.tabId, scanId: cursor.scanId, totalUnread: capture.unreadCount || 0,
              captures: [capture], ...anchors(state, { ...ready.page, observedAt: response.observedAt }) } });
            if (!saved.success || !apiData(saved)?.accepted || apiData(saved).captureId !== capture.captureId)
              throw fault(saved.errorType || "HR_CAPTURE_ACK_MISSING", saved.message || "采集未确认保存，保留游标稍后重读", !saved.httpStatus || saved.httpStatus>=500);
          }
          const remaining = cursor.queue.slice(1);
          if (remaining.length) await update({ cursor: { ...cursor, queue: remaining }, operation: null },state);
          else await update({ cursor: null, operation: null, baselineComplete: true, lastScanAt: now(), nextScanAt: now() + 60000,
            lastReconcileAt: cursor.reconcile ? now() : state.lastReconcileAt },state);
        }
      })().catch(async error => {
        if(error.errorCode==="HR_HOST_CANCELLED")return;
        const state = await read();
        if (!state?.intentEnabled || state.paused || state.hostGeneration!==owner?.hostGeneration || state.controlRevision!==owner?.controlRevision) return;
        const retries = Number(state.retryCount || 0) + 1;
        await update({ state: error.retryable ? "RECOVERING" : "BLOCKED", paused: !error.retryable,
          pauseReason: error.retryable ? "" : error.errorCode, errorCode: error.errorCode || "HR_HOST_FAILED", message: String(error.message || error).slice(0, 300),
          retryCount: retries, retryAt: now() + [60000, 120000, 300000][Math.min(retries - 1, 2)], operation: state.operation?.kind === "SEND" ? state.operation : null },state).catch(()=>null);
        const current=await read();
        if (!error.retryable && current?.hostGeneration===state.hostGeneration && current.controlRevision===state.controlRevision && current.intentEnabled) {
          await reportFault(state,error.errorCode);
          await restoreTab(state);
        }
      }).finally(() => { tickPromise = null; });
      return tickPromise;
    }
    async function content(message, sender) {
      let state = await read();
      if (!state || (sender.frameId != null && sender.frameId!==0) || !chat(sender?.tab?.url || ""))
        return {success:false,errorCode:"HR_HOST_STALE_PAGE"};
      if (message.type === "BOSS_HR_HOST_RESULT") {
        const live=state.operation?.kind==="SEND" && state.operation.commandId===message.commandId ? state.operation : null;
        const operation=live || (state.retiredOperations || []).find(item=>item.commandId===message.commandId);
        if(!operation || (operation.tabId || state.tabId)!==sender.tab.id
          || (operation.hostGeneration || state.hostGeneration)!==message.hostGeneration
          || (operation.pageDocumentId || state.pageDocumentId)!==message.documentId
          || (operation.leaseToken && operation.leaseToken!==message.leaseToken))return {success:false,errorCode:"HR_HOST_STALE_COMMAND"};
        const outcome = ["SENT", "STALE", "FAILED_SAFE", "RESULT_UNKNOWN"].includes(message.outcome) ? message.outcome : "RESULT_UNKNOWN";
        const result = await request(`/api/hr-assistant/send-commands/${encodeURIComponent(message.commandId)}/result`, { ...context(state), method: "POST", body: {
          watchSessionId: operation.watchSessionId || state.watchSessionId, tabId:operation.tabId || state.tabId, leaseToken: message.leaseToken, outcome,
          evidence: String(message.evidence || "").slice(0, 500), observedCapture: message.observedCapture || null,
          observedLatestInbound: message.observedLatestInbound || null,hostGeneration:operation.hostGeneration || state.hostGeneration,
          pageDocumentId:operation.pageDocumentId || state.pageDocumentId,accountIdentity:operation.accountIdentity || state.accountIdentity,
          pageObservedAt:message.observedAt || operation.pageObservedAt || state.lastPageSeenAt } });
        if (result.success) {
          const receiptStatus=apiData(result)?.status;
          const failed = outcome === "RESULT_UNKNOWN" || outcome === "FAILED_SAFE" || receiptStatus==="SEND_UNKNOWN" || receiptStatus==="BLOCKED"
            || (outcome==="SENT" && receiptStatus!=="SENT_CONFIRMED");
          const current=await read();
          if(!live || current?.operation?.commandId!==message.commandId || current.hostGeneration!==message.hostGeneration)return {success:true};
          await update({ operation: null, state: !current.intentEnabled?"STOPPED":failed ? "BLOCKED" : (current.paused ? "PAUSED" : "RUNNING"), paused:current.intentEnabled?(failed || current.paused):false,
            errorCode: current.intentEnabled && failed ? "SEND_RESULT_UNKNOWN" : current.errorCode || "",
            message: !current.intentEnabled || current.paused ? current.message : failed ? "发送待人工核验，不会重发" : "后台托管中" },
            {...current,allowDisabled:true,allowPaused:true}).catch(()=>{});
          if(failed && current.intentEnabled) {await reportFault(current,"SEND_RESULT_UNKNOWN");await restoreTab(current);}
        }
        return { success: result.success };
      }
      if(state.tabId!==sender.tab.id || state.hostGeneration!==message.hostGeneration || state.pageDocumentId!==message.documentId)
        return {success:false,errorCode:"HR_HOST_STALE_PAGE"};
      if (message.type === "BOSS_HR_HOST_MANUAL_PAUSE") return stop("专用聊天页检测到手动操作", false);
      if (!state.intentEnabled || state.paused) return { success: false, errorCode: "HR_HOST_PAUSED" };
      if (message.type === "BOSS_HR_HOST_GUARD") {
        if(message.accountIdentity!==state.accountIdentity)return {success:false,errorCode:"BOSS_ACCOUNT_CHANGED",watchActive:false};
        if(message.commandId && (state.operation?.kind!=="SEND" || state.operation.commandId!==message.commandId))
          return {success:false,errorCode:"HR_HOST_STALE_COMMAND",watchActive:false};
        const policy = await request("/api/hr-assistant/autopilot/guard", { ...context(state), method: "POST", body: {
          transport:"CHROME_BACKGROUND",watchSessionId:state.watchSessionId,tabId:state.tabId,...anchors(state,{documentId:message.documentId,observedAt:message.observedAt,accountIdentity:message.accountIdentity}) } });
        const p = apiData(policy),current=await read();
        const permitted=Boolean(policy.success && current?.intentEnabled && !current.paused && current.hostGeneration===message.hostGeneration
          && current.controlRevision===state.controlRevision && p?.watchActive===true && p?.enabled && p?.authorizationValid === true && !p.paused);
        return {success:permitted,policyVersion:p?.version,watchActive:permitted};
      }
      if (message.type === "BOSS_HR_HOST_DISPATCH") {
        if (state.operation?.kind !== "SEND" || state.operation.phase !== "CLAIMED" || state.operation.commandId !== message.commandId)
          return { success: false, errorCode: "HR_HOST_STALE_COMMAND" };
        // Persist before the HTTP call. Its result may be lost after the backend has accepted it.
        await update({ operation: { ...state.operation, phase: "DISPATCHED" } },state);
        const dispatched = await request(`/api/hr-assistant/send-commands/${encodeURIComponent(message.commandId)}/dispatch`, { ...context(state), method: "POST", body: {
          watchSessionId: state.watchSessionId, tabId: state.tabId, leaseToken: message.leaseToken, beforeCapture: message.beforeCapture,
          ...anchors(state, { documentId: message.documentId, observedAt: message.observedAt, accountIdentity: state.accountIdentity }) } });
        await active(state);
        return { success: Boolean(dispatched.success && apiData(dispatched)?.dispatched) };
      }
      if (message.type === "BOSS_HR_HOST_CHANGED") { await update({ nextScanAt: 0 },state); return { success: true }; }
      return { success: false, errorCode: "HR_HOST_MESSAGE_REJECTED" };
    }
    async function removed(tabId, info = {}) {
      const state = await read();
      if (!state?.intentEnabled || state.paused || state.tabId !== tabId) return;
      if (info.isWindowClosing && !(await chrome.tabs.query({})).length) {
        await update({ tabId: null, watchSessionId: "", state: "RECOVERING", message: "Chrome 已关闭，下次启动校验恢复" });
      } else await stop("专用聊天标签已关闭", false);
    }
    async function changed(tabId, info, tab) {
      const state = await read();
      if (!state?.intentEnabled || state.paused || state.tabId !== tabId) return;
      if (info.url && !chat(info.url)) { await stop("专用标签已离开 BOSS 聊天页", false); return; }
      if (info.status === "complete") { await update({ watchSessionId: "", pageDocumentId: "", nextScanAt: 0 }); await alarm(); }
    }
    async function initialize(browserStartup = false) {
      const state = await read();
      if (state?.intentEnabled && (!state.paused || state.pauseOrigin==="REMOTE")) {
        await alarm();
        await update({ state: "RECOVERING", message: "后台恢复中，等待核验登录与页面", retryAt: 0,
          needsAccountConfirmation:browserStartup && !state.accountIdentityStable ? true : state.needsAccountConfirmation || false },{...state,allowPaused:state.pauseOrigin==="REMOTE"});
      }
    }
    async function timeout(promise, ms) {
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fault("HR_PAGE_TIMEOUT", "后台页面未及时响应", true)), ms); })]); }
      finally { clearTimeout(timer); }
    }
    return { control, content, tick, read, update, initialize, removed, changed, status, alarmName: ALARM, protocol: PROTOCOL, types: TYPES };
  }
  return { create, PROTOCOL, KEY, ALARM, TYPES };
});
