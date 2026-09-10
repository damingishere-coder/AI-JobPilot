(function (root) {
  const MAX_ACTIVE_MS = 15 * 60 * 1000;
  const MAX_RECOVERIES = 3;
  function jobKey(job) {
    if (job?.id) return String(job.id);
    try { const u = new URL(job?.url); return /\/(?:job_detail|jobdetail)\//.test(u.pathname) ? u.pathname.split("/").pop().replace(/\.html?$/, "") : u.origin + u.pathname; } catch { return ""; }
  }
  function selectScrollContainer(cards, doc) {
    const first = cards.find(card => card?.getBoundingClientRect?.().height > 0) || cards[0];
    let node = first?.parentElement;
    while (node && node !== doc.body && node !== doc.documentElement) {
      if (node.scrollHeight > node.clientHeight + 20) {
        const overflow = doc.defaultView?.getComputedStyle(node).overflowY;
        if (/auto|scroll|overlay/.test(overflow || "")) return node;
      }
      node = node.parentElement;
    }
    return doc.scrollingElement || doc.documentElement;
  }
  function pagination(doc) {
    const nodes = [...doc.querySelectorAll("a, button, [role='button']")];
    const next = nodes.find(node => node.getBoundingClientRect().height > 0
      && /^(下一页|下页|next)$/i.test((node.getAttribute("aria-label") || node.textContent || "").trim()));
    const disabled = next && (next.disabled || next.hasAttribute("disabled") || next.getAttribute("aria-disabled") === "true"
      || /disable/i.test(next.className));
    return { next: disabled ? null : next, exhausted: Boolean(disabled) };
  }
  async function advance({ doc, cards, readKeys, seen, sleep, stopped, recovery = false }) {
    const node = selectScrollContainer(cards(), doc);
    if (!node) return { grew: false, stopped: false };
    const height = Math.max(240, node.clientHeight || doc.defaultView?.innerHeight || 600);
    const scroll = (top, delta) => {
      node.scrollTop = Math.max(0, Math.min(top, node.scrollHeight - node.clientHeight));
      const view = doc.defaultView;
      node.dispatchEvent(new view.Event("scroll", { bubbles: true }));
      node.dispatchEvent(new view.WheelEvent("wheel", { bubbles: true, deltaY: delta }));
    };
    if (recovery) {
      scroll(node.scrollTop - height / 2, -height / 2);
      await sleep(400);
      if (await stopped()) return { grew: false, stopped: true };
      scroll(node.scrollHeight, height);
    } else scroll(node.scrollTop + height * 0.85, height * 0.85);
    for (let poll = 0; poll < 10; poll++) {
      if (await stopped()) return { grew: false, stopped: true };
      await sleep(500);
      const keys = readKeys().filter(Boolean);
      if (keys.some(key => !seen.has(key))) return { grew: true, stopped: false };
    }
    return { grew: false, stopped: false };
  }
  function applyReceipts(state, items, keyword, target) {
    state.credited = state.credited || {};
    for (const item of items || []) {
      if (item.freshAccepted === true && item.jobKey && !state.credited[item.jobKey]) state.credited[item.jobKey] = keyword;
    }
    const accepted = Object.values(state.credited).filter(value => value === keyword).length;
    return { accepted, remaining: Math.max(0, target - accepted) };
  }
  function outcome(results, total) {
    if (results.length < total) return "partial";
    if (results.every(item => item.stopReason === "target_reached")) return "complete";
    if (results.every(item => ["target_reached", "platform_exhausted"].includes(item.stopReason))) return "exhausted";
    return "partial";
  }
  function results(task) {
    const target = Number(task.config?.searchJobLimit || 20);
    return (task.keywords || task.config?.keywords || []).map((keyword, index) => {
      const data = task.continuousScan?.keywords?.[keyword] || {};
      const accepted = Object.values(task.continuousScan?.credited || {}).filter(owner => owner === keyword).length;
      const stopReason = accepted >= target ? "target_reached" : data.stopReason || "reason_unrecorded";
      return { keywordIndex: index + 1, keyword, target, collected: accepted,
        historyDuplicates: Number(data.historyDuplicates || 0), sameRunDuplicates: Number(data.sameRunDuplicates || 0), submissionFailures: Number(data.submissionFailures || 0), detailFailures: Number(data.detailFailures || 0),
        recoveryAttempts: Math.min(3, Number(data.recoveryAttempts || 0)), stopReason,
        outcome: stopReason === "target_reached" ? "complete" : stopReason === "platform_exhausted" ? "exhausted" : "partial" };
    });
  }
  function archive(storage, platform, task) {
    storage.setItem(`getjobs-last-scan:${platform}:${task.profileId}`, JSON.stringify({ ...task, archivedAt: Date.now() }));
  }
  function restore(storage, platform, incoming) {
    const text = storage.getItem(`getjobs-last-scan:${platform}:${incoming.profileId}`);
    if (!text) throw new Error("没有可恢复的关键词记录");
    const previous = JSON.parse(text);
    if (previous.keywordCursorKey !== incoming.keywordCursorKey || previous.runId !== incoming.runId) {
      throw new Error("搜索条件或任务已变化，请按当前条件开始新的扫描");
    }
    const indices = results(previous).filter(item => item.outcome === "partial").map(item => item.keywordIndex - 1);
    if (!indices.length) throw new Error("没有未完成的关键词");
    for (const index of indices) {
      const data = previous.continuousScan.keywords[(previous.keywords || previous.config.keywords)[index]];
      if (data) { data.elapsedMs = 0; data.activeDetailAt = 0; data.recoveryAttempts = 0; data.stopReason = ""; }
    }
    return { ...previous, ...Object.fromEntries(["pageTabId", "scanOwnerToken", "requestId"].map(key => [key, incoming[key]])),
      currentIndex: indices[0], resumeIndices: indices,
      phase: Number(previous.currentIndex) === indices[0] && ["detail", "submitting"].includes(previous.phase) ? previous.phase : "collecting",
      searchPage: 1, pausedAt: null, lastError: null, startedAt: Date.now() };
  }
  function accountDetailTime(task, now = Date.now()) {
    const keyword = (task.keywords || task.config?.keywords || [])[Number(task.currentIndex || 0)];
    const data = task.continuousScan?.keywords?.[keyword];
    if (!data) return;
    if (data.activeDetailAt) data.elapsedMs = Number(data.elapsedMs || 0) + Math.max(0, now - data.activeDetailAt);
    data.activeDetailAt = task.phase === "detail" && !task.pausedAt && !task.waitingForCapacity ? now : 0;
  }
  async function submit({ jobs, state, keyword, target, send, checkpoint, stopped, sleep, progress }) {
    state.receipts ||= {};
    const unique = [...new Map(jobs.map(job => [jobKey(job), job])).values()];
    const terminal = receipt => receipt && !receipt.retryable && ["QUEUED", "EXISTING", "SKIPPED", "INSUFFICIENT", "FAILED"].includes(receipt.status);
    let failures = 0;
    while (true) {
      if (await stopped()) return { success: true, cancelled: true, totalAccepted: Object.keys(state.credited || {}).length };
      const pending = unique.filter(job => !terminal(state.receipts[jobKey(job)])).slice(0, 10);
      if (!pending.length) break;
      await checkpoint();
      let data;
      try { data = await send(pending); failures = 0; }
      catch (error) { if (++failures >= 3) throw error; await sleep(3000); continue; }
      if (data.cancelled) {
        const pendingKeys = new Set(pending.map(jobKey));
        const received = (data.items || []).filter(item => pendingKeys.has(item.jobKey) && typeof item.freshAccepted === "boolean");
        for (const receipt of received) state.receipts[receipt.jobKey] = receipt;
        applyReceipts(state, received, keyword, target);
        await checkpoint();
        return { success: true, cancelled: true, totalAccepted: Object.keys(state.credited || {}).length };
      }
      const keys = new Set(pending.map(jobKey));
      if (!Array.isArray(data.items) || data.items.length !== keys.size
          || new Set(data.items.map(item => item.jobKey)).size !== keys.size
          || data.items.some(item => !keys.has(item.jobKey) || typeof item.freshAccepted !== "boolean"
            || !["QUEUED", "EXISTING", "SKIPPED", "INSUFFICIENT", "FAILED", "REJECTED"].includes(item.status)
            || (item.status === "REJECTED" && !item.retryable))) {
        throw new Error("后台缺少新岗位逐项入队回执，请更新服务后继续；已保留断点");
      }
      for (const receipt of data.items) state.receipts[receipt.jobKey] = receipt;
      const counts = applyReceipts(state, data.items, keyword, target);
      await checkpoint();
      progress?.({ ...counts, waitingForCapacity: data.items.some(item => item.retryable) });
      if (data.items.some(item => item.retryable)) await sleep(3000);
    }
    const counts = applyReceipts(state, [], keyword, target);
    return { success: true, ...counts, received: unique.length, saved: counts.accepted,
      queued: counts.accepted, totalAccepted: Object.keys(state.credited).length,
      insufficient: unique.filter(job => state.receipts[jobKey(job)]?.status === "INSUFFICIENT").length,
      submissionFailures: unique.filter(job => ["FAILED", "SKIPPED"].includes(state.receipts[jobKey(job)]?.status) && !state.receipts[jobKey(job)]?.duplicateKind).length,
      skipped: unique.filter(job => state.receipts[jobKey(job)]?.freshAccepted !== true).length, restored: 0 };
  }
  const api = { MAX_ACTIVE_MS, MAX_RECOVERIES, jobKey, pagination, selectScrollContainer, advance, applyReceipts, outcome, results, archive, restore, accountDetailTime, submit };
  root.GetJobsContinuousScan = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
