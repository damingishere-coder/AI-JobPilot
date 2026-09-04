(function () {
  "use strict";

  if (window.top !== window.self || window.__GET_JOBS_BOSS_HR_BRIDGE__) return;
  window.__GET_JOBS_BOSS_HR_BRIDGE__ = true;

  const support = globalThis.GetJobsBossHrSupport;
  const CONTENT_VERSION = "2026-09-04-boss-hr-direct";
  const MAX_CAPTURES = 100;
  const OPEN_WAIT_MS = 450;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.source !== "GET_JOBS_BACKGROUND") return;
    if (message.type === "BOSS_HR_CONTENT_VERSION") {
      sendResponse({ success: true, version: CONTENT_VERSION, url: location.href });
      return;
    }
    if (message.type === "BOSS_HR_SCAN") {
      scan(message).then(sendResponse).catch((error) => sendResponse(failure("HR_SCAN_FAILED_SAFE", error)));
      return true;
    }
    if (message.type === "BOSS_HR_SEND") {
      executeSend(message.command).then(sendResponse).catch((error) => {
        sendResponse({ success: true, outcome: "FAILED_SAFE", evidence: concise(error) });
      });
      return true;
    }
  });

  async function scan(message) {
    const safety = support.pageSafety(document);
    if (!safety.safe) return { success: false, pause: true, ...safety };
    if (!location.pathname.startsWith("/web/geek/chat")) {
      return { success: false, pause: true, errorCode: "BOSS_CHAT_TAB_NAVIGATED", message: "当前标签页已离开 BOSS 聊天页" };
    }

    const initialUnreadTotal = support.unreadTotal(document);
    const unread = support.unreadTab(document);
    if (unread && !/active|selected/i.test(String(unread.className || ""))) {
      unread.click();
      await wait(350);
    }

    const collected = await collectUnreadTargets(message.deadlineAt);
    if (!collected.success) return collected;
    const targets = collected.targets;
    for (const pending of Array.isArray(message.outbox) ? message.outbox : []) {
      if (pending?.uid && !targets.has(pending.uid)) targets.set(pending.uid, pending);
      if (targets.size >= MAX_CAPTURES) break;
    }

    // Opening an unread conversation clears its badge. Process the saved targets from
    // the full list so a browser interruption can still recover an Outbox entry.
    const all = support.allTab(document);
    if (all && !/active|selected/i.test(String(all.className || ""))) {
      all.click();
      await wait(350);
    }

    const captures = [];
    const errors = [];
    for (const snapshot of targets.values()) {
      if (Date.now() > Number(message.deadlineAt || 0)) {
        return { success: false, pause: true, errorCode: "BOSS_HR_SCAN_TIMEOUT", message: "单轮扫描超过 5 分钟，已暂停" };
      }
      const captureId = snapshot.captureId || support.captureId(snapshot);
      const stored = await backgroundRequest("BOSS_HR_OUTBOX_PUT", { capture: { ...snapshot, captureId } });
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
      located.unique.click();
      await wait(OPEN_WAIT_MS);
      const afterSafety = support.pageSafety(document);
      if (!afterSafety.safe) return { success: false, pause: true, ...afterSafety };
      const session = support.currentSession(document, currentSnapshot);
      const messages = support.readMessages(document);
      if (!messages.length) {
        errors.push({ captureId, errorCode: "BOSS_CHAT_MESSAGES_MISSING" });
        continue;
      }
      const inbound = support.latestInbound(messages);
      if (!inbound) {
        errors.push({ captureId, errorCode: "BOSS_CHAT_INBOUND_MISSING" });
        continue;
      }
      session.lastMessage = inbound.text;
      session.lastTime = inbound.time || currentSnapshot.lastTime;
      delete session.surfaceText;
      captures.push({ captureId, unreadCount: currentSnapshot.unreadCount, session, messages });
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
      truncated: targets.size >= MAX_CAPTURES
    };
  }

  async function collectUnreadTargets(deadlineAt) {
    const targets = new Map();
    let unchangedRounds = 0;
    let list = null;
    for (let round = 0; round < 120; round++) {
      if (Date.now() > Number(deadlineAt || 0)) {
        return { success: false, pause: true, errorCode: "BOSS_HR_SCAN_TIMEOUT", message: "单轮扫描超过 5 分钟，已暂停" };
      }
      const before = targets.size;
      const items = support.chatItems(document);
      for (const item of items) {
        const snapshot = support.itemSnapshot(item);
        if (snapshot.unreadCount <= 0) continue;
        if (!snapshot.uid) {
          return { success: false, pause: true, errorCode: "BOSS_CHAT_UID_MISSING", message: "未读会话缺少稳定 UID，已暂停避免误认 HR" };
        }
        targets.set(snapshot.uid, snapshot);
        if (targets.size >= MAX_CAPTURES) break;
      }
      if (targets.size >= MAX_CAPTURES) break;
      list ||= findScrollableList(items[0]);
      if (!list || list.scrollTop + list.clientHeight >= list.scrollHeight - 2) break;
      unchangedRounds = targets.size === before ? unchangedRounds + 1 : 0;
      if (unchangedRounds >= 3) break;
      list.scrollTop = Math.min(list.scrollHeight, list.scrollTop + Math.max(240, Math.floor(list.clientHeight * 0.85)));
      list.dispatchEvent(new Event("scroll", { bubbles: true }));
      await wait(140);
    }
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
    if (!command?.commandId || !command?.uid || !command?.draft) {
      return { success: true, outcome: "FAILED_SAFE", evidence: "发送命令缺少必要字段" };
    }
    const safety = support.pageSafety(document);
    if (!safety.safe) return { success: true, outcome: "FAILED_SAFE", evidence: safety.errorCode };

    const located = await locateByUid(command.uid);
    if (located.matches.length !== 1) {
      return { success: true, outcome: "FAILED_SAFE", evidence: "BOSS_CHAT_IDENTITY_AMBIGUOUS" };
    }
    located.unique.click();
    await wait(OPEN_WAIT_MS);

    const session = support.currentSession(document, { uid: command.uid, hrName: command.hrName,
      companyName: command.companyName, jobName: command.jobName });
    if (!identityMatches(session, command)) {
      return { success: true, outcome: "STALE", evidence: "会话标题、公司或岗位已变化" };
    }
    const before = support.readMessages(document);
    const latest = support.latestInbound(before);
    if (!support.messagesMatch(latest, command.expectedLatestInbound)) {
      return { success: true, outcome: "STALE", evidence: "HR 最新消息已变化", observedLatestInbound: latest };
    }

    const inputs = Array.from(document.querySelectorAll("#chat-input,textarea,[contenteditable='true']"))
      .filter((element) => visible(element));
    if (inputs.length !== 1) return { success: true, outcome: "FAILED_SAFE", evidence: "聊天输入框未唯一命中" };
    const input = inputs[0];
    writeInput(input, command.draft);
    if (support.normalizeText(inputValue(input)) !== support.normalizeText(command.draft)) {
      return { success: true, outcome: "FAILED_SAFE", evidence: "输入框内容复核失败" };
    }

    const sendButtons = Array.from(document.querySelectorAll("button,[role='button']"))
      .filter((element) => visible(element) && /^发送$/.test(support.normalizeText(element.textContent)) && !element.disabled);
    let dispatched = false;
    if (sendButtons.length === 1) {
      sendButtons[0].click();
      dispatched = true;
    } else if (sendButtons.length === 0) {
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

  function identityMatches(session, command) {
    const title = support.normalizeText(session.title || session.hrName);
    const surface = support.normalizeText(session.surfaceText);
    const hrName = support.normalizeText(command.hrName);
    const companyName = support.normalizeText(command.companyName);
    const jobName = support.normalizeText(command.jobName);
    return (!hrName || title.includes(hrName))
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
      source: "GET_JOBS_BOSS_HR_CONTENT", type, ...payload
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
