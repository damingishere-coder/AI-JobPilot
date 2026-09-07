(function () {
  "use strict";

  const CONTENT_VERSION = "2026-09-07-hr-autopilot";
  if (window.top !== window.self || window.__GET_JOBS_BOSS_HR_BRIDGE__ === CONTENT_VERSION) return;
  window.__GET_JOBS_BOSS_HR_BRIDGE__ = CONTENT_VERSION;
  const support = globalThis.GetJobsBossHrSupport;
  const MAX_CAPTURES = 100;
  const OPEN_WAIT_MS = 450;

  let userPaused=false;
  try {userPaused=sessionStorage.getItem("getjobs-hr-paused")==="1";} catch {userPaused=true;}
  let managed=false;
  let executingPolicyVersion=0;
  let operationActive=false;
  let sendDispatched=false;
  const pauseForUser=(event)=> {
    if(!managed || !event.isTrusted || event.composedPath().some(node=>node?.id==="getjobs-boss-hr-assistant")) return;
    userPaused=true;
    try {sessionStorage.setItem("getjobs-hr-paused","1");} catch {}
    chrome.runtime.sendMessage({source:"GET_JOBS_BOSS_CONTENT",type:"BOSS_LOCAL_API",operation:"hr-pause"},()=>{});
  };
  window.addEventListener("pointerdown",pauseForUser,true);
  window.addEventListener("keydown",pauseForUser,true);
  window.addEventListener("wheel",pauseForUser,true);
  window.addEventListener("getjobs:hr:resume",()=>{userPaused=false;try {sessionStorage.removeItem("getjobs-hr-paused");} catch {userPaused=true;}});
  async function guard() {
    if(userPaused) throw new Error("USER_PAUSED：检测到手动操作，请明确恢复托管");
    if(!managed) return;
    const response=await backgroundRequest("BOSS_LOCAL_API",{operation:"hr-watch-guard"});
    const p=response?.data?.data || response?.data;
    if(userPaused || !response?.success || !p?.enabled || p.authorizationValid!==true || !p.watchActive || p.paused || (executingPolicyVersion>0 && p.version!==executingPolicyVersion)) throw new Error("托管授权已暂停、变更或无法核验");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.source !== "GET_JOBS_BACKGROUND") return;
    if (message.type === "BOSS_HR_CONTENT_VERSION_V2") {
      sendResponse({ success: true, version: CONTENT_VERSION, url: location.href });
      return;
    }
    if (message.type === "BOSS_HR_SCAN_V2") {
      if(operationActive) {sendResponse({success:false,errorCode:"HR_OPERATION_BUSY",message:"已有读取或发送操作，等待其结果"});return;}
      operationActive=true;
      scan(message).then(sendResponse).catch((error) => sendResponse(failure("HR_SCAN_FAILED_SAFE", error))).finally(()=>{operationActive=false;});
      return true;
    }
    if (message.type === "BOSS_HR_SEND_V2") {
      if(operationActive) {sendResponse({success:true,outcome:"FAILED_SAFE",evidence:"已有浏览器操作，未执行发送"});return;}
      operationActive=true;
      executeSend(message.command).then(sendResponse).catch((error) => {
        sendResponse({ success: true, outcome: sendDispatched ? "RESULT_UNKNOWN" : "FAILED_SAFE", evidence: concise(error) });
      }).finally(()=>{operationActive=false;});
      return true;
    }
  });

  async function scan(message) {
    managed=message.managed===true;
    executingPolicyVersion=0;
    await guard();
    const safety = support.pageSafety(document);
    if (!safety.safe) return { success: false, pause: true, ...safety };
    if (!location.pathname.startsWith("/web/geek/chat")) {
      return { success: false, pause: true, errorCode: "BOSS_CHAT_TAB_NAVIGATED", message: "当前标签页已离开 BOSS 聊天页" };
    }

    const initialUnreadTotal = support.unreadTotal(document);
    const scanAll = message.scanAll === true;
    const unread = scanAll ? support.allTab(document) : support.unreadTab(document);
    if (unread && !/active|selected/i.test(String(unread.className || ""))) {
      await guard();
      unread.click();
      await wait(350);
    }

    const collected = await collectUnreadTargets(message.deadlineAt, scanAll);
    if (!collected.success) return collected;
    const targets = collected.targets;
    const summaries={...(message.summaries||{})};
    const signature=(item)=>JSON.stringify([item.lastMessage,item.lastTime]);
    if(managed && !message.baseline) for(const [uid,item] of targets) {
      if(summaries[uid]===signature(item) && !item.unreadCount) targets.delete(uid);
    }
    for (const pending of Array.isArray(message.outbox) ? message.outbox : []) {
      if (pending?.uid && !targets.has(pending.uid)) targets.set(pending.uid, pending);
      if (targets.size >= (scanAll ? 1000 : MAX_CAPTURES)) break;
    }

    // Opening an unread conversation clears its badge. Process the saved targets from
    // the full list so a browser interruption can still recover an Outbox entry.
    const all = support.allTab(document);
    if (all && !/active|selected/i.test(String(all.className || ""))) {
      await guard();
      all.click();
      await wait(350);
    }

    const captures = [];
    const errors = [];
    let scannedCount = 0;
    for (const snapshot of targets.values()) {
      await guard();
      if (Date.now() > Number(message.deadlineAt || 0)) {
        return { success: false, pause: true, errorCode: "BOSS_HR_SCAN_TIMEOUT", message: "本轮读取达到安全时限，已暂停；已保存的进度保留" };
      }
      const captureId = snapshot.captureId || (scanAll ? `${message.scanId}:${snapshot.uid}` : support.captureId(snapshot));
      const stored = await backgroundRequest("BOSS_HR_OUTBOX_PUT", { capture: { ...snapshot, captureId }, watchSessionId: message.watchSessionId });
      if (!stored?.success) return { success: false, pause: true, errorCode: "HR_OUTBOX_WRITE_FAILED", message: "无法在打开会话前保存 Outbox" };

      const located = await locateByUid(snapshot.uid);
      if (located.matches.length !== 1) {
        errors.push({ captureId, errorCode: "BOSS_CHAT_IDENTITY_AMBIGUOUS" });
        continue;
      }
      const visibleSnapshot = support.itemSnapshot(located.unique);
      const currentSnapshot = {
        ...snapshot,
        ...visibleSnapshot,
        captureId,
        unreadCount: snapshot.unreadCount || visibleSnapshot.unreadCount || 1
      };
      await guard();
    located.unique.click();
      await wait(scanAll ? 2000 : OPEN_WAIT_MS);
      const afterSafety = support.pageSafety(document);
      if (!afterSafety.safe) return { success: false, pause: true, ...afterSafety };
      const session = support.currentSession(document, currentSnapshot);
      if (session.uid !== snapshot.uid) {
        errors.push({ captureId, errorCode: "BOSS_CHAT_IDENTITY_AMBIGUOUS" });
        continue;
      }
      const read=await readContext();
      const messages=read.messages;
      if(managed && !messages.length) {
        messages.push({from:"对方",type:"读取失败",text:"[未取得聊天内容；列表预览仅供定位] "+(currentSnapshot.lastMessage||"预览也不可读"),
          time:currentSnapshot.lastTime||"",messageId:"",media:[{name:"聊天内容",mimeType:"",sourceUrl:"",dataUrl:"",readStatus:"UNAVAILABLE",extractedText:"消息区域未渲染或读取失败，请人工查看BOSS原会话"}]});
        read.complete=false;
      }
      if (!messages.length && !scanAll) {
        errors.push({ captureId, errorCode: "BOSS_CHAT_MESSAGES_MISSING" });
        continue;
      }
      const inbound = support.latestInbound(messages);
      if (!inbound && !scanAll) {
        errors.push({ captureId, errorCode: "BOSS_CHAT_INBOUND_MISSING" });
        continue;
      }
      session.lastMessage = inbound?.text || "";
      session.lastTime = inbound?.time || currentSnapshot.lastTime;
      delete session.surfaceText;
      const capture = { captureId, unreadCount: currentSnapshot.unreadCount, session, messages,
        historical:managed && message.baseline===true,contextComplete:read.complete };
      await hydrateMedia(capture.messages);
      if (message.streamResults) {
        const saved = await backgroundRequest("BOSS_HR_CAPTURE_RESULT", { capture, scanId: message.scanId, watchSessionId: message.watchSessionId });
        if (!saved?.success) return { success: false, pause: true, errorCode: saved?.errorCode || "HR_CAPTURE_SUBMIT_FAILED", message: saved?.message || "生成或保存结果未确认，已暂停，不自动重试" };
      } else captures.push(capture);
      summaries[snapshot.uid]=signature(currentSnapshot);
      scannedCount++;
    }

    if (errors.length) {
      return {
        success: false,
        pause: true,
        errorCode: errors[0].errorCode,
        message: `有 ${errors.length} 个会话无法安全读取，已保留 Outbox 并暂停值守`
      };
    }

    return {
      success: true,
      scanId: String(message.scanId || ""),
      totalUnread: initialUnreadTotal,
      captures,
      errors,
      summaries,
      streamed: Boolean(message.streamResults),
      scannedCount,
      truncated: targets.size >= (scanAll ? 1000 : MAX_CAPTURES)
    };
  }

  async function collectUnreadTargets(deadlineAt, scanAll = false) {
    const targets = new Map();
    let unchangedRounds = 0;
    let reachedEnd = false;
    let list = findScrollableList(support.chatItems(document)[0]);
    if (list && list.scrollTop > 0) {
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await wait(350);
    }
    for (let round = 0; round < 120; round++) {
      await guard();
      if (Date.now() > Number(deadlineAt || 0)) {
        return { success: false, pause: true, errorCode: "BOSS_HR_SCAN_TIMEOUT", message: "本轮读取达到安全时限，已暂停；已保存的进度保留" };
      }
      const before = targets.size;
      const items = support.chatItems(document);
      for (const item of items) {
        const snapshot = support.itemSnapshot(item);
        if (!scanAll && snapshot.unreadCount <= 0) continue;
        if (!snapshot.uid) {
          return { success: false, pause: true, errorCode: "BOSS_CHAT_UID_MISSING", message: "会话缺少稳定 UID，已暂停避免误认 HR" };
        }
        targets.set(snapshot.uid, snapshot);
        if (targets.size >= (scanAll ? 1000 : MAX_CAPTURES)) break;
      }
      if (targets.size >= (scanAll ? 1000 : MAX_CAPTURES)) {
        if (scanAll) return { success: false, pause: true, errorCode: "HR_LIST_LIMIT", message: "会话列表超过本轮安全上限，未完成全部读取，已暂停" };
        break;
      }
      list ||= findScrollableList(items[0]);
      if (!list || list.scrollTop + list.clientHeight >= list.scrollHeight - 2) { reachedEnd = true; break; }
      unchangedRounds = targets.size === before ? unchangedRounds + 1 : 0;
      if (unchangedRounds >= 3) break;
      list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(240, Math.floor(list.clientHeight * 0.85)));
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await wait(140);
    }
    if (scanAll && !reachedEnd) return { success: false, pause: true, errorCode: "HR_LIST_INCOMPLETE", message: "未能确认已读到会话列表底部，已暂停，未标记全部完成" };
    return { success: true, targets };
  }

  function findScrollableList(item) {
    for (let element = item?.parentElement; element && element !== document.body; element = element.parentElement) {
      if (element.scrollHeight > element.clientHeight + 20) return element;
    }
    return document.querySelector("[class*='chat-list'],[class*='friend-list'],[class*='conversation-list']");
  }

  async function locateByUid(uid) {
    let located = support.findByUid(document, uid);
    if (located.matches.length) return located;
    const items = support.chatItems(document);
    const list = findScrollableList(items[0]);
    if (!list) return located;
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
    await wait(120);
    for (let round = 0; round < 120; round++) {
      await guard();
      located = support.findByUid(document, uid);
      if (located.matches.length) return located;
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 2) break;
      list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(240, Math.floor(list.clientHeight * 0.85)));
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await wait(120);
    }
    return support.findByUid(document, uid);
  }

  async function executeSend(command) {
    sendDispatched=false;
    managed=Number(command?.policyVersion||0)>0;
    executingPolicyVersion=Number(command?.policyVersion||0);
    await guard();
    if (!command?.commandId || !command?.uid || !command?.draft) {
      return { success: true, outcome: "FAILED_SAFE", evidence: "发送命令缺少必要字段" };
    }
    const safety = support.pageSafety(document);
    if (!safety.safe) return { success: true, outcome: "FAILED_SAFE", evidence: safety.errorCode };

    const located = await locateByUid(command.uid);
    if (located.matches.length !== 1) {
      return { success: true, outcome: "FAILED_SAFE", evidence: "BOSS_CHAT_IDENTITY_AMBIGUOUS" };
    }
    await guard();
    located.unique.click();
    await wait(OPEN_WAIT_MS);

    const session = support.currentSession(document, { uid: command.uid, hrName: command.hrName,
      companyName: command.companyName, jobName: command.jobName });
    if (!identityMatches(session, command)) {
      return { success: true, outcome: "STALE", evidence: "会话标题、公司或岗位已变化" };
    }
    const read=await readContext();
    const before=read.messages;
    if(command.expectedInboundRound?.length) {
      let start=before.length; while(start>0 && before[start-1].from==="对方") start--;
      const round=before.slice(start);
      if(round.length!==command.expectedInboundRound.length || round.some((m,i)=>!support.messagesMatch(m,command.expectedInboundRound[i])))
        return {success:true,outcome:"STALE",evidence:"HR本轮内容已变化"};
    }
    if(command.actionType==="RESUME") return await sendResume(command,before);
    const latest = support.latestInbound(before);
    if (!support.messagesMatch(latest, command.expectedLatestInbound)) {
      return { success: true, outcome: "STALE", evidence: "HR 最新消息已变化", observedLatestInbound: latest };
    }

    const inputs = Array.from(document.querySelectorAll("#chat-input,textarea,[contenteditable='true']"))
      .filter((element) => visible(element));
    if (inputs.length !== 1) return { success: true, outcome: "FAILED_SAFE", evidence: "聊天输入框未唯一命中" };
    if (!Number.isFinite(command.deadlineAt) || Date.now() >= command.deadlineAt) return { success: true, outcome: "FAILED_SAFE", evidence: "发送命令已过期" };
    const input = inputs[0];
    if(support.normalizeText(inputValue(input))) return {success:true,outcome:"FAILED_SAFE",evidence:"输入框已有未发送文字，等待人工处理"};
    await guard();
    writeInput(input, command.draft);
    if (support.normalizeText(inputValue(input)) !== support.normalizeText(command.draft)) {
      return { success: true, outcome: "FAILED_SAFE", evidence: "输入框内容复核失败" };
    }

    const sendButtons = Array.from(document.querySelectorAll("button,[role='button']"))
      .filter((element) => visible(element) && /^发送$/.test(support.normalizeText(element.textContent)) && !element.disabled);
    if (Date.now() >= command.deadlineAt) return { success: true, outcome: "FAILED_SAFE", evidence: "发送命令已过期" };
    await guard();
    const recheck=support.currentSession(document,{uid:command.uid});
    if(recheck.uid!==command.uid || !support.messagesMatch(support.latestInbound(support.readMessages(document)),command.expectedLatestInbound))
      return {success:true,outcome:"STALE",evidence:"点击发送前会话或消息发生变化"};
    if(Date.now()>=command.deadlineAt) return {success:true,outcome:"FAILED_SAFE",evidence:"授权复核后租约已过期"};
    let dispatched = false;
    if (sendButtons.length === 1) {
      sendDispatched=true;
      sendButtons[0].click();
      dispatched = true;
    } else if (sendButtons.length === 0) {
      sendDispatched=true;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      dispatched = true;
    } else {
      return { success: true, outcome: "FAILED_SAFE", evidence: "发送按钮命中多个候选项" };
    }

    if (!dispatched) return { success: true, outcome: "FAILED_SAFE", evidence: "未触发发送动作" };
    const confirmed = await waitForOutbound(command.draft, before.length);
    return confirmed
      ? { success: true, outcome: "SENT", evidence: "DOM_OUTBOUND_EXACT_MATCH", observedLatestInbound: latest }
      : { success: true, outcome: "RESULT_UNKNOWN", evidence: "发送动作已触发但未确认相同本人出站消息", observedLatestInbound: latest };
  }

  async function readContext() {
    let messages=support.readMessages(document);
    const pane=document.querySelector(".chat-conversation .im-list");
    let scroller=pane?.parentElement;
    for(let i=0;i<4 && scroller && scroller.scrollHeight<=scroller.clientHeight+10;i++) scroller=scroller.parentElement;
    const hasBoundary=items=>items.filter(m=>m.from==="本人").length>=2;
    const rowCount=()=>Array.from(document.querySelectorAll(".chat-conversation .im-list > .message-item"))
      .filter(node=>!node.classList.contains("item-system")).length;
    let lostBoundary=rowCount()!==messages.length;
    for(let i=0;i<8 && !hasBoundary(messages) && scroller;i++) {
      await guard();
      const count=messages.length;
      scroller.scrollTop=0; scroller.dispatchEvent(new Event("scroll",{bubbles:true})); await wait(350);
      const loaded=support.readMessages(document);
      if(rowCount()!==loaded.length) lostBoundary=true;
      const first=messages[0]?.messageId;
      const overlap=first ? loaded.findIndex(m=>m.messageId===first) : -1;
      if(messages.length && overlap<0) {lostBoundary=true;break;}
      messages=messages.length ? loaded.slice(0,overlap).concat(messages) : loaded;
      if(messages.length===count) break;
    }
    // Keep the latest round plus a preceding complete exchange; virtual-list gaps remain incomplete.
    const beginning=Array.from(document.querySelectorAll(".chat-conversation .history-tip,.chat-conversation .load-more"))
      .some(node=>/没有更多消息|已加载全部|沟通从这里开始/.test(node.textContent||""));
    return {messages,complete:!lostBoundary && (hasBoundary(messages) || (beginning && messages.some(m=>m.from==="本人")))};
  }
  async function hydrateMedia(messages) {
    let budget=12_000_000;
    for(const message of messages) for(const media of message.media||[]) {
      if(!media.sourceUrl) continue;
      try {
        const url=new URL(media.sourceUrl,location.href);
        if(url.protocol!=="https:" || !/(^|\.)(zhipin\.com|zhipin\.cn|bosszhipin\.com)$/i.test(url.hostname)) throw new Error("未授权的媒体来源");
        const response=await fetch(url.href,{credentials:url.origin===location.origin?"same-origin":"omit",redirect:"error",signal:AbortSignal.timeout(10000)});
        if(!response.ok) throw new Error("媒体未取得");
        const declared=Number(response.headers.get("content-length")||0);
        if(declared>6000000) throw new Error("媒体过大");
        const reader=response.body.getReader(); let size=0;const chunks=[];
        while(true) { const {done,value}=await reader.read();if(done) break;size+=value.length;
          if(size>6000000 || size>budget) {await reader.cancel();throw new Error("媒体超过限制");} chunks.push(value); }
        budget-=size;
        const mime=response.headers.get("content-type")?.split(";")[0]||media.mimeType||"application/octet-stream";
        const blob=new Blob(chunks,{type:mime});
        media.dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
        media.mimeType=mime;media.readStatus="CAPTURED";
      } catch(error) {media.readStatus="UNAVAILABLE";media.extractedText=error.message||"未取得原始媒体";}
    }
  }

  async function sendResume(command,before) {
    // BOSS may send the account's attached resume immediately on toolbar click.
    // Never open/click that control until the existing attachment bytes are verified.
    if(!command.resumeName || !/^[a-f0-9]{64}$/.test(command.resumeSha256||""))
      return {success:true,outcome:"FAILED_SAFE",evidence:"指定简历授权不完整"};
    const links=Array.from(document.querySelectorAll(".resume-list .resume-item.is-selected a[href],.resume-list .resume-item.active a[href],[data-resume-selected='true'] a[href]"))
      .filter(a=>support.normalizeText(a.getAttribute("download")||a.textContent)===support.normalizeText(command.resumeName));
    const selectedHref=links[0]?.href;
    if(links.length!==1) return {success:true,outcome:"FAILED_SAFE",evidence:"无法唯一读取BOSS已上传简历；请在QQ决策后人工核验附件"};
    try {
      const url=new URL(links[0].href,location.href);
      if(url.protocol!=="https:" || !/(^|\.)(zhipin\.com|zhipin\.cn|bosszhipin\.com)$/i.test(url.hostname)) throw new Error("简历来源无法核验");
      const response=await fetch(url.href,{credentials:url.origin===location.origin?"same-origin":"omit",redirect:"error",signal:AbortSignal.timeout(8000)});
      if(!response.ok) throw new Error("简历字节无法读取");
      const reader=response.body.getReader();let size=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>6000000){await reader.cancel();throw new Error("简历超过6MB");}chunks.push(value);}
      const buffer=await new Blob(chunks).arrayBuffer();
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer))).map(v=>v.toString(16).padStart(2,"0")).join("");
      if(sha!==command.resumeSha256) throw new Error("BOSS简历与指定文件指纹不一致");
    } catch(error) {return {success:true,outcome:"FAILED_SAFE",evidence:error.message};}
    await guard();
    const session=support.currentSession(document,{uid:command.uid});
    const latest=support.latestInbound(support.readMessages(document));
    if(session.uid!==command.uid || !support.messagesMatch(latest,command.expectedLatestInbound)) return {success:true,outcome:"STALE",evidence:"发送简历前会话已变化"};
    if(Date.now()>=command.deadlineAt) return {success:true,outcome:"FAILED_SAFE",evidence:"简历发送授权已过期"};
    const buttons=Array.from(document.querySelectorAll("button,[role='button'],.btn-resume"))
      .filter(node=>visible(node)&&/^(发简历|发送简历)$/.test(support.normalizeText(node.textContent))&&!node.disabled);
    if(buttons.length!==1) return {success:true,outcome:"FAILED_SAFE",evidence:"简历发送按钮未唯一命中"};
    const selectedNow=Array.from(document.querySelectorAll(".resume-list .resume-item.is-selected a[href],.resume-list .resume-item.active a[href],[data-resume-selected='true'] a[href]"));
    if(selectedNow.length!==1 || selectedNow[0]!==links[0] || selectedNow[0].href!==selectedHref
        || support.normalizeText(selectedNow[0].getAttribute("download")||selectedNow[0].textContent)!==support.normalizeText(command.resumeName))
      return {success:true,outcome:"FAILED_SAFE",evidence:"发送前指定简历选中项已变化"};
    sendDispatched=true;
    buttons[0].click();
    // A modal after the click is ambiguous: do not click additional generic confirmation buttons.
    for(let i=0;i<20;i++) {
      await wait(250);
      const messages=support.readMessages(document);
      const sent=messages.slice(before.length).some(m=>m.from==="本人" && m.type==="附件"
        && (m.text===command.resumeName || m.media?.some(x=>x.name===command.resumeName)));
      if(sent) return {success:true,outcome:"SENT",evidence:"指定SHA256简历及新增本人附件消息均核验成功",observedLatestInbound:latest};
    }
    return {success:true,outcome:"RESULT_UNKNOWN",evidence:"已触发简历操作，未确认新增指定附件，不自动重试",observedLatestInbound:latest};
  }

  function identityMatches(session, command) {
    const title = support.normalizeText(session.title || session.hrName);
    const surface = support.normalizeText(session.surfaceText);
    const hrName = support.normalizeText(command.hrName);
    const companyName = support.normalizeText(command.companyName);
    const jobName = support.normalizeText(command.jobName);
    return session.uid === command.uid && (!hrName || title.includes(hrName))
      && (!companyName || surface.includes(companyName))
      && (!jobName || surface.includes(jobName));
  }

  function writeInput(input, value) {
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
      if (setter) setter.call(input, value); else input.value = value;
    } else {
      input.textContent = value;
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function inputValue(input) {
    return "value" in input ? input.value : input.textContent;
  }

  async function waitForOutbound(text, previousCount) {
    const expected = support.normalizeText(text);
    for (let attempt = 0; attempt < 20; attempt++) {
      await wait(250);
      const messages = support.readMessages(document);
      if (messages.length <= previousCount) continue;
      const found = messages.slice(previousCount)
        .some((message) => message.from === "本人" && support.normalizeText(message.text) === expected);
      if (found) return true;
    }
    return false;
  }

  function visible(element) {
    const rect = element?.getBoundingClientRect?.();
    const style = element ? getComputedStyle(element) : null;
    return Boolean(rect && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden");
  }

  function backgroundRequest(type, payload) {
    return new Promise((resolve) => chrome.runtime.sendMessage({
      source: type === "BOSS_LOCAL_API" ? "GET_JOBS_BOSS_CONTENT" : "GET_JOBS_BOSS_HR_CONTENT", type, ...payload
    }, (response) => resolve(response || { success: false })));
  }

  function failure(errorCode, error) {
    return { success: false, pause: false, errorCode, message: concise(error) };
  }

  function concise(error) {
    const value = error?.message || String(error || "未知错误");
    return value.length <= 300 ? value : value.slice(0, 300);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
