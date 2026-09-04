(function () {
  "use strict";

  if (window.top !== window.self || window.__GET_JOBS_BOSS_HR_ASSISTANT__) return;
  window.__GET_JOBS_BOSS_HR_ASSISTANT__ = true;

  const HOST_ID = "getjobs-boss-hr-assistant";
  const REFRESH_MS = 15_000;
  let activeRequest = false;
  let latestStatus = null;
  let latestSettings = null;
  let latestProposals = [];

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
    details{border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px}summary{cursor:pointer;padding:9px 10px;font-weight:650;font-size:13px}.settings{padding:0 10px 10px;display:grid;grid-template-columns:1fr 1fr;gap:7px}.wide{grid-column:1/-1}label{font-size:11px;color:#64748b;display:block;margin-bottom:3px}input,textarea,select{width:100%;border:1px solid #cbd5e1;border-radius:7px;padding:7px;font:inherit;font-size:12px;background:#fff}textarea{resize:vertical;min-height:58px}.check{display:flex;gap:6px;align-items:center;font-size:12px}.check input{width:auto}
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
  window.setInterval(() => {
    host.style.display = location.pathname.startsWith("/web/geek/chat") ? "block" : "none";
    if (host.style.display !== "none") refresh();
  }, REFRESH_MS);

  async function refresh() {
    if (activeRequest || !location.pathname.startsWith("/web/geek/chat")) return;
    activeRequest = true;
    try {
      const [status, settings, proposals] = await Promise.all([
        localApi("hr-status"), localApi("hr-settings"), localApi("hr-proposals")
      ]);
      latestStatus = status;
      latestSettings = settings;
      latestProposals = Array.isArray(proposals) ? proposals : [];
    } catch (error) {
      latestStatus = { watching: false, lastError: error.message || String(error), openCli: { ready: false } };
    } finally {
      activeRequest = false;
      render();
    }
  }

  function render() {
    body.replaceChildren();
    const watching = Boolean(latestStatus?.watching);
    dot.classList.toggle("on", watching);
    const statusBox = element("div", `status ${latestStatus?.lastError ? "error" : ""}`);
    const openCli = latestStatus?.openCli;
    statusBox.textContent = latestStatus
      ? `${watching ? "值守中：每 60 秒扫描一次" : "值守已停止"}｜OpenCLI ${openCli?.ready ? "已连接" : "未就绪"}｜NapCat ${latestStatus.napcatConnected ? "已连接" : "未连接"}${latestStatus.lastError ? `｜${latestStatus.lastError}` : ""}`
      : "正在连接本地 AI-JobPilot…";
    body.appendChild(statusBox);

    const actions = element("div", "actions");
    const start = button("开始值守", "btn primary");
    start.disabled = watching || !openCli?.ready;
    start.addEventListener("click", () => mutate("hr-start"));
    const stop = button("停止", "btn danger");
    stop.disabled = !watching;
    stop.addEventListener("click", () => mutate("hr-stop"));
    const locked = button("全自动（锁定）", "btn locked");
    locked.disabled = true;
    actions.append(start, stop, locked);
    body.appendChild(actions);
    body.appendChild(renderSettings());
    body.appendChild(element("div", "section-title", `待确认回复（${latestProposals.length}）`));
    if (!latestProposals.length) {
      body.appendChild(element("div", "empty", "暂无待确认消息。AI 不会未经确认自动回复。"));
    } else {
      latestProposals.forEach((proposal) => body.appendChild(renderProposal(proposal)));
    }
  }

  function renderSettings() {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "沟通资料与 QQ 通知";
    const form = element("div", "settings");
    const profile = latestSettings?.communicationProfile || {};
    const fields = [
      ["expectedSalary", "期望薪资", profile.expectedSalary || ""],
      ["workLocation", "工作地点", profile.workLocation || ""],
      ["availability", "到岗时间", profile.availability || ""],
      ["interviewAvailability", "可面试时间", profile.interviewAvailability || ""],
      ["contactPreference", "联系方式偏好", profile.contactPreference || ""],
      ["tone", "回复语气", profile.tone || "简洁、礼貌、积极"],
      ["forbiddenClaims", "禁止承诺/编造", profile.forbiddenClaims || "不得编造经历或承诺未知事实", true]
    ];
    fields.forEach(([name, label, value, wide]) => form.appendChild(inputField(name, label, value, Boolean(wide))));
    form.appendChild(inputField("napcatWsUrl", "NapCat WebSocket", latestSettings?.napcatWsUrl || "ws://127.0.0.1:3001", true));
    const typeWrap = element("div");
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "QQ 通知方式";
    const targetType = document.createElement("select");
    targetType.name = "qqTargetType";
    [["PRIVATE", "私人 QQ"], ["GROUP", "指定群聊"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      targetType.appendChild(option);
    });
    targetType.value = latestSettings?.qqTargetType || "PRIVATE";
    typeWrap.append(typeLabel, targetType);
    form.appendChild(typeWrap);
    const targetWrap = inputField("qqTarget", "目标 QQ", "", false, latestSettings?.qqTargetMasked || "仅保存加密值");
    const operatorWrap = inputField("qqOperator", "群内操作人 QQ（可选）", "", true,
      latestSettings?.qqOperatorConfigured ? `${latestSettings.qqOperatorMasked}，留空不修改` : "不填则群聊仅接收通知");
    const clearOperatorWrap = element("label", "check wide");
    const clearOperator = document.createElement("input");
    clearOperator.type = "checkbox";
    clearOperator.name = "qqOperatorClear";
    clearOperatorWrap.append(clearOperator, document.createTextNode("清除已配置的群内操作人，改为仅通知"));
    const updateTargetMode = () => {
      const groupMode = targetType.value === "GROUP";
      targetWrap.querySelector("label").textContent = groupMode ? "目标群号" : "目标私人 QQ";
      operatorWrap.classList.toggle("hidden", !groupMode);
      clearOperatorWrap.classList.toggle("hidden", !groupMode || !latestSettings?.qqOperatorConfigured);
    };
    targetType.addEventListener("change", updateTargetMode);
    form.append(targetWrap, operatorWrap, clearOperatorWrap);
    updateTargetMode();
    form.appendChild(inputField("napcatToken", "NapCat Token", "", false, latestSettings?.napcatTokenConfigured ? "已配置，留空不修改" : "必填"));
    const checkWrap = element("label", "check wide");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.name = "qqEnabled";
    check.checked = Boolean(latestSettings?.qqEnabled);
    checkWrap.append(check, document.createTextNode("仅将高价值消息通知到上述 QQ 目标"));
    form.appendChild(checkWrap);
    const save = button("保存设置", "btn primary wide");
    save.addEventListener("click", () => saveSettings(form));
    form.appendChild(save);
    details.append(summary, form);
    return details;
  }

  function renderProposal(proposal) {
    const card = element("article", `card ${proposal.highValue ? "high" : ""}`);
    const meta = element("div", "meta");
    meta.append(
      element("span", "code", `#${proposal.confirmationCode}`),
      element("span", "", proposal.companyName || "未知公司"),
      element("span", "", proposal.jobName || "未知岗位"),
      element("span", "", proposal.hrName || "HR")
    );
    if (proposal.highValue) meta.appendChild(element("span", "tag", "高价值/需注意"));
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
    card.append(meta, source, draft, cardActions);
    return card;
  }

  async function saveSettings(form) {
    const read = (name) => form.querySelector(`[name="${name}"]`)?.value?.trim() || "";
    const communicationProfile = {
      expectedSalary: read("expectedSalary"), workLocation: read("workLocation"),
      availability: read("availability"), interviewAvailability: read("interviewAvailability"),
      contactPreference: read("contactPreference"), tone: read("tone"), forbiddenClaims: read("forbiddenClaims")
    };
    await mutate("hr-settings-save", null, {
      communicationProfile,
      qqEnabled: Boolean(form.querySelector('[name="qqEnabled"]')?.checked),
      napcatWsUrl: read("napcatWsUrl"), napcatToken: read("napcatToken"),
      qqTargetType: read("qqTargetType") || "PRIVATE", qqTarget: read("qqTarget"),
      qqOperator: read("qqOperator") || (form.querySelector('[name="qqOperatorClear"]')?.checked ? "" : null),
      retentionDays: 30
    });
  }

  async function mutate(operation, id, body) {
    if (activeRequest) return;
    activeRequest = true;
    try {
      await localApi(operation, id ? { id } : {}, body);
    } catch (error) {
      latestStatus = { ...(latestStatus || {}), lastError: error.message || String(error) };
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
        if (!response?.success) return reject(new Error(response?.message || "本地接口调用失败"));
        const envelope = response.data;
        if (!envelope?.success) return reject(new Error(envelope?.message || "本地接口拒绝请求"));
        resolve(envelope.data);
      });
    });
  }

  function inputField(name, labelText, value, wide, placeholder = "") {
    const wrap = element("div", wide ? "wide" : "");
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement(name === "forbiddenClaims" ? "textarea" : "input");
    input.name = name;
    input.value = value;
    input.placeholder = placeholder;
    if (name === "napcatToken") input.type = "password";
    wrap.append(label, input);
    return wrap;
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
})();
