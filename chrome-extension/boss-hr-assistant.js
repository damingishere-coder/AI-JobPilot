(function () {
  "use strict";

  const PANEL_VERSION = "2026-09-07-hr-autopilot";
  if (window.top !== window.self || window.__GET_JOBS_BOSS_HR_ASSISTANT__ === PANEL_VERSION) return;
  window.__GET_JOBS_BOSS_HR_ASSISTANT_CLEANUP__?.();
  window.__GET_JOBS_BOSS_HR_ASSISTANT__ = PANEL_VERSION;

  const HOST_ID = "getjobs-boss-hr-assistant";
  document.getElementById(HOST_ID)?.remove();
  const REFRESH_MS = 15_000;
  let activeRequest = false;
  let latestStatus = null;
  let latestProposals = [];
  let actionError = "";
  let intervalMinutes = 1;
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
    .body{padding:12px;overflow:auto;max-height:calc(78vh - 48px)}.status{font-size:12px;line-height:1.55;background:#f8fafc;border-radius:10px;padding:9px;margin-bottom:9px}.error{color:#b91c1c}.actions{display:flex;gap:7px;margin-bottom:10px}.btn{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:8px;padding:7px 10px;cursor:pointer;font-size:12px}.btn.primary{background:#0f766e;color:#fff;border-color:#0f766e}.btn.danger{color:#b91c1c}.btn:disabled{opacity:.48;cursor:not-allowed}.locked{flex:1;background:#e2e8f0;color:#64748b}
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
      const [status, proposals] = await Promise.all([
        localApi("hr-status"), localApi("hr-proposals",{includeClosed})
      ]);
      latestStatus = { ...status, lastError: status?.lastError || actionError };
      latestProposals = Array.isArray(proposals) ? proposals : [];

    } catch (error) {
      latestStatus = { watching: false, lastError: error.message || String(error), chromeBridge: { ready: true, tabBound: false } };
    } finally {
      activeRequest = false;
      render();
    }
  }

  function render() {
    const rendered={nodes:[],appendChild(node){this.nodes.push(node);}};
    const scroll=body.scrollTop;
    const watching = Boolean(latestStatus?.watching);
    dot.classList.toggle("on", watching);
    const statusBox = element("div", `status ${latestStatus?.lastError ? "error" : ""}`);
    const bridge = latestStatus?.chromeBridge;
    const timing = latestStatus?.lastScanAt ? `｜上次扫描 ${formatTime(latestStatus.lastScanAt)}` : "";
    const next = latestStatus?.nextScanAt ? `｜下次 ${formatTime(latestStatus.nextScanAt)}` : "";
    statusBox.textContent = latestStatus
      ? `${watching ? (latestStatus.intervalMs === 1800000 ? "值守中：每 30 分钟读取全部会话" : (latestStatus.fullAutoLocked ? "值守中：每 60 秒检查未读" : "托管中：每分钟新消息，半小时补漏")) : "值守已停止"}｜Chrome 扩展已连接${bridge?.tabBound ? "／当前 BOSS 标签已绑定" : "／标签未绑定"}｜Outbox ${bridge?.outboxCount || 0}｜NapCat ${latestStatus.napcatConnected ? "已连接" : "未连接"}${latestStatus.scanRunning ? `｜正在逐个读取与生成，已处理 ${latestStatus.scannedCount || 0} 个` : timing + next}${latestStatus.lastError ? `｜${latestStatus.lastError}` : ""}`
      : "正在连接本地 AI-JobPilot…";
    rendered.appendChild(statusBox);
    rendered.appendChild(element("div", "status", `当前人物档案：${latestStatus?.currentProfileName || "未读取"}；切换档案不会切换 BOSS 登录账号。值守期间请先停止再切换。`));
    const schedule = document.createElement("select");
    schedule.setAttribute("aria-label", "值守检查范围与间隔");
    schedule.className = "btn";
    for (const [value, label] of [[30, "每 30 分钟：全部会话（含已读）"], [1, "每 1 分钟：仅未读会话"]]) {
      const option = element("option", "", label);
      option.value = String(value);
      schedule.appendChild(option);
    }
    schedule.value = String(watching ? (latestStatus.intervalMs === 1800000 ? 30 : 1) : intervalMinutes);
    schedule.disabled = watching;
    schedule.addEventListener("change", () => { intervalMinutes = Number(schedule.value); });
    rendered.appendChild(schedule);

    const actions = element("div", "actions");
    const start = button("开始值守", "btn primary");
    start.disabled = watching;
    start.disabled = watching || !latestStatus?.currentProfileId || latestStatus?.profileSwitchBlocked;
    start.addEventListener("click", () => mutate("hr-start", null, { expectedProfileId: latestStatus?.currentProfileId, intervalMinutes }));
    const stop = button("停止", "btn danger");
    stop.disabled = !watching;
    stop.addEventListener("click", () => mutate("hr-stop"));
    const dedicated=/getjobs-autopilot=1/.test(location.search||"");
    const locked = button(!dedicated ? "打开专用托管标签" : "恢复托管", "btn");
    locked.addEventListener("click",()=> {
      if(!dedicated) mutate("hr-dedicated-open");
      else { window.dispatchEvent(new Event("getjobs:hr:resume")); mutate("hr-resume"); }
    });
    actions.append(start, stop, locked);
    rendered.appendChild(actions);
    const readAll = button("立即读取全部并生成草稿", "btn");
    readAll.disabled = !watching || Boolean(latestStatus?.scanRunning);
    readAll.addEventListener("click", () => mutate("hr-scan-all", null, { expectedProfileId: latestStatus?.currentProfileId }));
    rendered.appendChild(readAll);
    const historyToggle=button(includeClosed?"只看待处理":"查看最近已处理记录","btn");
    historyToggle.addEventListener("click",()=>{includeClosed=!includeClosed;refresh();});
    rendered.appendChild(historyToggle);
    rendered.appendChild(element("div", "section-title", `${includeClosed?"最近记录（最多200条）":"待确认回复"}（${latestProposals.length}）`));
    if (!latestProposals.length) {
      rendered.appendChild(element("div", "empty", "暂无待确认消息。符合已确认托管边界的新消息自动处理，例外发送 QQ。"));
    } else {
      latestProposals.forEach((proposal) => rendered.appendChild(renderProposal(proposal)));
    }
    const wanted=rendered.nodes;
    wanted.forEach((node,index)=>{if(body.childNodes[index]!==node) body.insertBefore(node,body.childNodes[index]||null);});
    while(body.childNodes.length>wanted.length) body.lastChild.remove();
    body.scrollTop=scroll;
    const live=new Set(latestProposals.map(p=>p.id));
    for(const id of cards.keys()) if(!live.has(id)) cards.delete(id);
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
