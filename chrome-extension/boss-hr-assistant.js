(function () {
  "use strict";

  const PANEL_VERSION = "2026-09-30-hr-background-ui-v2";
  if (window.top !== window.self || window.__GET_JOBS_BOSS_HR_ASSISTANT__ === PANEL_VERSION) return;
  window.__GET_JOBS_BOSS_HR_ASSISTANT_CLEANUP__?.();
  window.__GET_JOBS_BOSS_HR_ASSISTANT__ = PANEL_VERSION;

  const HOST_ID = "getjobs-boss-hr-assistant";
  document.getElementById(HOST_ID)?.remove();
  const REFRESH_MS = 5_000;
  let activeRequest = false;
  let latestStatus = null;
  let latestProposals = [];
  let latestPolicy = null;
  let latestHost = null;
  let lastRefreshAt = 0;
  let actionError = "";
  const cards=new Map();
  let includeClosed=false;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif";
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}.panel{width:370px;max-height:78vh;background:#fff;color:#172033;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 18px 50px rgba(15,23,42,.24);overflow:hidden}
    header{display:flex;align-items:center;gap:8px;padding:12px 14px;background:linear-gradient(135deg,#0f766e,#0891b2);color:#fff}.title{font-weight:750;flex:1}.dot{width:9px;height:9px;border-radius:50%;background:#f59e0b}.dot.on{background:#4ade80}.toggle{border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:8px;padding:5px 9px;cursor:pointer}
    .body{padding:14px;overflow:auto;max-height:calc(78vh - 48px)}.status{font-size:12px;line-height:1.8;background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:12px;overflow-wrap:anywhere}.error{color:#b91c1c}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:9px 12px;cursor:pointer;font-size:12px;line-height:1.5;text-align:center;text-decoration:none;display:inline-block}.btn.primary{background:#0f766e;color:#fff;border-color:#0f766e}.btn.danger{color:#b91c1c}.btn:disabled{opacity:.48;cursor:not-allowed}.locked{flex:1;background:#e2e8f0;color:#64748b}summary{cursor:pointer;font-size:13px;line-height:1.8}details.records{border-top:1px solid #e2e8f0;padding-top:12px;margin-top:12px}.freshness{font-size:11px;color:#64748b;margin:8px 0}
    textarea{width:100%;border:1px solid #cbd5e1;border-radius:7px;padding:7px;font:inherit;font-size:12px;background:#fff;resize:vertical;min-height:58px}
    .section-title{font-size:13px;font-weight:700;margin:9px 0}.empty{font-size:12px;color:#64748b;text-align:center;padding:18px}.card{border:1px solid #e2e8f0;border-radius:11px;padding:10px;margin-bottom:9px;background:#fff}.meta{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;color:#64748b}.code{font-weight:800;color:#0f766e}.source{font-size:12px;background:#f8fafc;border-radius:7px;padding:7px;margin:7px 0;white-space:pre-wrap}.card-actions{display:flex;gap:6px;margin-top:7px}.card-actions .btn{padding:6px 9px}.high{border-color:#f59e0b}.tag{background:#fff7ed;color:#9a3412;border-radius:999px;padding:2px 6px}.hidden{display:none!important}
  `;
  root.appendChild(style);

  const panel = element("section", "panel");
  const header = element("header");
  const dot = element("span", "dot");
  const title = element("span", "title", "AI HR 助手");
  const collapse = button("收起", "toggle");
  header.append(dot, title, collapse);
  const body = element("div", "body");
  const recordsSection=element("details","records");
  panel.append(header, body);
  root.appendChild(panel);
  collapse.addEventListener("click", () => {
    body.classList.toggle("hidden");
    collapse.textContent = body.classList.contains("hidden") ? "展开" : "收起";
  });

  render();
  refresh();
  const refreshTimer = window.setInterval(() => {
    host.style.display = location.pathname.startsWith("/web/geek/chat") ? "block" : "none";
    if (host.style.display !== "none") refresh();
  }, REFRESH_MS);
  window.__GET_JOBS_BOSS_HR_ASSISTANT_CLEANUP__ = () => { window.clearInterval(refreshTimer); host.remove(); };

  async function refresh() {
    if (activeRequest || !location.pathname.startsWith("/web/geek/chat")) return;
    activeRequest = true;
    try {
      const [status, proposals, policy, background] = await Promise.all([
        localApi("hr-status"), localApi("hr-proposals",{includeClosed}), localApi("hr-autopilot"), localApi("hr-background-status")
      ]);
      latestStatus = { ...status, lastError: status?.lastError || actionError };
      latestProposals = Array.isArray(proposals) ? proposals : [];
      latestPolicy=policy;
      latestHost=background;
      lastRefreshAt=Date.now();

    } catch (error) {
      latestHost=null;
      latestStatus = { watching: false, lastError: error.message || String(error), chromeBridge: { ready: true, tabBound: false } };
    } finally {
      activeRequest = false;
      render();
    }
  }

  function render() {
    const rendered={nodes:[],appendChild(node){this.nodes.push(node);}};
    const scroll=body.scrollTop;
    const bound=Boolean(latestHost?.watchSessionId && latestHost.hostGeneration && latestHost.pageDocumentId
      && latestHost.watchSessionId===latestStatus?.watchSessionId && latestHost.hostGeneration===latestStatus?.hostGeneration
      && latestHost.pageDocumentId===latestStatus?.pageDocumentId && latestHost.profileId===latestStatus?.currentProfileId);
    const watching=latestHost?.state==="RUNNING" && bound && latestStatus?.watching && latestStatus.transport==="CHROME_BACKGROUND"
      && latestPolicy?.enabled && latestPolicy.authorizationValid===true;
    const labels={STOPPED:"已停止",STARTING:"正在核对账号与页面",RUNNING:"后台连接待核验",PAUSED:"已暂停",RECOVERING:"正在恢复连接",BLOCKED:"需要处理后恢复"};
    dot.classList.toggle("on",Boolean(watching));
    const statusBox=element("div","status");
    statusBox.appendChild(element("strong","",`后台托管：${watching?"运行中":labels[latestHost?.state] || "状态未确认"}`));
    statusBox.appendChild(element("div","",`当前档案：${latestStatus?.currentProfileName || "未读取"}`));
    if(latestHost?.intentEnabled) statusBox.appendChild(element("div","",`已核验账号：${latestHost.accountName || "等待核验"}`));
    if(watching) {
      const cursor=latestHost.cursor;
      const progress=latestHost.operation?.kind==="SEND"?"正在核验或发送已审核回复":cursor?.stage==="LIST"?`浏览联系人，已发现 ${cursor.seen?.length || 0} 个`:cursor?.stage==="CAPTURE"?`检查待回复会话，剩余 ${cursor.queue?.length || 0} 个`:"等待下一次巡检";
      statusBox.appendChild(element("div","",progress));
    }
    const error=actionError || (!latestHost?latestStatus?.lastError:latestHost.state==="BLOCKED"?latestHost.message:latestHost.state==="RECOVERING"?latestHost.message:"");
    if(error) statusBox.appendChild(element("div","error",error));
    rendered.appendChild(statusBox);
    const automatic=latestPolicy?.enabled && latestPolicy.replyMode==="AUTO";
    rendered.appendChild(element("div","status",`回复方式：${automatic?"普通对话自动回复，关键事项发 QQ":"逐条确认后发送"}。范围：${latestPolicy?.historyMode==="RECENT"?`最近 ${latestPolicy.historyDays} 天待回复会话`:"仅处理新消息"}。已由你回复且没有新提问的会话跳过。`));
    if(latestPolicy?.enabled && latestPolicy.blockers?.length && latestHost?.state!=="STOPPED") rendered.appendChild(element("div","status error",latestPolicy.blockers.join("；")));
    const actions=element("div","actions");
    const settings=element("a","btn primary",latestHost?.intentEnabled?"托管设置 / 修改范围":"前往工作台开启托管");
    settings.href="http://127.0.0.1:6866/env-config";settings.target="_blank";settings.rel="noopener noreferrer";
    actions.appendChild(settings);
    const paused=latestHost?.state==="PAUSED" || latestHost?.state==="BLOCKED";
    const control=button(paused?"恢复后台托管":"暂停后台托管","btn");
    control.disabled=activeRequest || !latestHost?.intentEnabled || !latestStatus?.currentProfileId || latestHost.profileId!==latestStatus.currentProfileId
      || (paused && (latestHost.needsAccountConfirmation || latestPolicy?.authorizationValid!==true));
    control.addEventListener("click",()=>mutate(paused?"hr-background-resume":"hr-background-pause",null,{expectedProfileId:latestStatus.currentProfileId}));
    actions.appendChild(control);
    rendered.appendChild(actions);
    if(latestHost?.needsAccountConfirmation) rendered.appendChild(element("div","status error","请在工作台重新确认 BOSS 账号后恢复。"));
    const freshness=element("div","freshness",`上次刷新：${lastRefreshAt?formatTime(lastRefreshAt):"尚未成功"} · 每 5 秒读取后台实际状态`);
    const refreshButton=button("立即刷新","btn");
    refreshButton.disabled=activeRequest;
    refreshButton.addEventListener("click",()=>refresh());
    rendered.appendChild(freshness);rendered.appendChild(refreshButton);
    const recordNodes=[element("summary","",`回复记录（${latestProposals.length}） · 点击展开`)];
    const historyToggle=button(includeClosed?"只看待处理":"查看最近已处理记录","btn");
    historyToggle.addEventListener("click",()=>{includeClosed=!includeClosed;refresh();});
    recordNodes.push(historyToggle);
    if(!latestProposals.length) recordNodes.push(element("div","empty","暂无待处理回复。普通消息按授权自动处理，关键事项发送 QQ。"));
    else latestProposals.forEach(proposal=>recordNodes.push(renderProposal(proposal)));
    reconcile(recordsSection,recordNodes);
    rendered.appendChild(recordsSection);
    const wanted=rendered.nodes;
    reconcile(body,wanted);
    body.scrollTop=scroll;
    const live=new Set(latestProposals.map(p=>p.id));
    for(const id of cards.keys()) if(!live.has(id)) cards.delete(id);
  }

  function reconcile(container,wanted) {
    wanted.forEach((node,index)=> {
      const previous=container.childNodes[index];
      if(previous===node) return;
      // Replace transient status nodes in place so the attached reply editor
      // and its details element retain focus, unsaved text and open state.
      if(previous && !wanted.includes(previous)) container.replaceChild(node,previous);
      else container.insertBefore(node,previous || null);
    });
    while(container.childNodes.length>wanted.length) container.lastChild.remove();
  }

  function renderProposal(proposal) {
    const key=JSON.stringify(proposal);
    const previous=cards.get(proposal.id);
    if(previous?.key===key) return previous.node;
    const card = element("article", `card ${proposal.highValue ? "high" : ""}`);
    const meta = element("div", "meta");
    meta.append(
      element("span", "code", `#${proposal.confirmationCode}`),
      element("span", "", proposal.companyName || "未知公司"),
      element("span", "", proposal.jobName || "未知岗位"),
      element("span", "", proposal.hrName || "HR")
    );
    const risks = Array.isArray(proposal.riskTags) ? proposal.riskTags : [];
    const label = proposal.status==="SENT_CONFIRMED" ? "已确认发送" : proposal.status==="SKIPPED" ? "已整理 / 无需回复"
      : proposal.status==="SEND_UNKNOWN" ? "发送结果未知，禁止重试" : risks.includes("AI_FAILURE") ? "草稿生成失败"
      : risks.includes("NON_TEXT_MESSAGE") ? "需人工查看"
        : ({ NEEDS_USER: "待补充信息", REJECTION: "婉拒 / 无需回复", NO_REPLY: "无需回复", INTERVIEW_INVITE: "面试邀请", OFFER: "录用意向" })[proposal.classification];
    if (label || proposal.highValue) meta.appendChild(element("span", "tag", label || "需注意"));
    const source = element("div", "source", `HR：${proposal.sourceMessage || "（非文本消息）"}`);
    const decision=latestPolicy?.activity?.decisions?.find(d=>d.proposalId===proposal.id);
    if(decision) source.appendChild(element("div","status",`${decision.origin==="BACKLOG"?"历史待办 · ":""}${decision.reason}`));
    const draft = document.createElement("textarea");
    draft.value = proposal.draft || "";
    const savedDraft = draft.value.trim();
    draft.placeholder = "补充事实后填写要发送的回复";
    const cardActions = element("div", "card-actions");
    const save = button("保存修改", "btn");
    save.disabled = true;
    save.addEventListener("click", () => mutate("hr-revise", proposal.id, { expectedVersion: proposal.version, draft: draft.value }));
    const send = button("确认发送", "btn primary");
    send.disabled = !savedDraft || proposal.status !== "REVIEW_REQUIRED";
    draft.addEventListener("input", () => {
      const dirty = draft.value.trim() !== savedDraft;
      save.disabled = !dirty || !draft.value.trim() || proposal.status !== "REVIEW_REQUIRED";
      send.disabled = dirty || !draft.value.trim() || proposal.status !== "REVIEW_REQUIRED";
    });
    send.addEventListener("click", () => {
      if (!window.confirm(`确认只向 ${proposal.hrName || "当前 HR"} 发送以下内容？\n\n${draft.value}`)) return;
      mutate("hr-send", proposal.id, { expectedVersion: proposal.version });
    });
    const skip = button("跳过", "btn danger");
    skip.addEventListener("click", () => mutate("hr-skip", proposal.id));
    cardActions.append(save, send, skip);
    card.append(meta, source);
    if (proposal.summary) card.appendChild(element("div", "source", proposal.summary));
    const missingFacts = Array.isArray(proposal.missingFacts) ? proposal.missingFacts.filter(value => typeof value === "string" && value.trim()) : [];
    if (missingFacts.length) card.appendChild(element("div", "source", `需要处理：${missingFacts.join("；")}`));
    const details=element("details");
    details.appendChild(element("summary","","完整对话与图片 / 卡片 / 附件"));
    const detailBody=element("div","source"); details.appendChild(detailBody);
    details.addEventListener("toggle",async()=> {
      if(!details.open || details.dataset.loaded) return;
      detailBody.textContent="正在读取已采集内容…";
      try {
        const capture=await localApi("hr-context",{id:proposal.id});
        detailBody.textContent=capture.contextComplete?"本次上下文已读取":"上下文未完整读取，缺失内容不代表没有消息";
        for(const message of capture.messages||[]) {
          detailBody.appendChild(element("p","",`${message.from} [${message.type}] ${message.text||""}`));
          for(const media of message.media||[]) {
            detailBody.appendChild(element("p","",`${media.name} [${media.readStatus}] ${media.extractedText||""}`));
            if(media.dataUrl?.startsWith("data:image/")) {
              const img=document.createElement("img");img.src=media.dataUrl;img.alt=media.name||"HR 图片";img.style.maxWidth="100%";detailBody.appendChild(img);
            } else if(media.dataUrl?.startsWith("data:audio/")) {
              const audio=document.createElement("audio");audio.src=media.dataUrl;audio.controls=true;detailBody.appendChild(audio);
            } else if(media.dataUrl?.startsWith("data:application/pdf;") || media.dataUrl?.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;")) {
              const link=element("a","","下载原始附件");link.href=media.dataUrl;link.download=media.name||"HR附件";detailBody.appendChild(link);
            }
          }
        }
        details.dataset.loaded="true";
      } catch(error) {detailBody.textContent=error.message||"详情读取失败";}
    });
    if(previous) {
      const old=previous.node.querySelector("textarea");
      if(old && old.value!==old.dataset.saved) {draft.value=old.value;save.disabled=false;send.disabled=true;}
      const priorDetail=previous.node.querySelector("details");
      if(priorDetail?.open) details.open=true;
    }
    draft.dataset.saved=savedDraft;
    card.append(details,draft, cardActions);
    cards.set(proposal.id,{key,node:card});
    return card;
  }

  async function mutate(operation, id, body) {
    if (activeRequest) return;
    activeRequest = true;
    try {
      await localApi(operation, id ? { id } : {}, body);
      actionError = "";
    } catch (error) {
      actionError = error.message || String(error);
      latestStatus = { ...(latestStatus || {}), lastError: actionError };
    } finally {
      activeRequest = false;
      await refresh();
    }
  }

  function localApi(operation, params = {}, body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        source: "GET_JOBS_BOSS_CONTENT", type: "BOSS_LOCAL_API", operation, params, body, timeoutMs: 120000
      }, (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError) return reject(new Error(runtimeError));
        if (!response?.success) return reject(new Error(formatError(response, "本地接口调用失败")));
        const envelope = response.data;
        if (!envelope?.success) return reject(new Error(formatError(envelope, "本地接口拒绝请求")));
        resolve(envelope.data);
      });
    });
  }

  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(text, className) {
    const node = element("button", className, text);
    node.type = "button";
    return node;
  }

  function formatError(value, fallback) {
    const code = value?.errorCode || value?.errorType || "";
    const requestId = value?.requestId || value?.data?.requestId || "";
    return `${code ? `[${code}] ` : ""}${value?.message || fallback}${requestId ? `（${requestId}）` : ""}`;
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleTimeString("zh-CN", { hour12: false });
  }
})();
