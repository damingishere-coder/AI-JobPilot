(function (root) {
  "use strict";
  const blocked = () => ({ success: false, outcome: "UNKNOWN", evidence: "NO_CONFIRMATION", persisted: false,
    haltBatch: true, actionStarted: false, message: "执行许可未确认或当前批次已停止；未开始新操作，请只读核对。" });
  async function claim({ task, message, platform, pageTabId, ownerAlive, request }) {
    if (task.reconciliationOnly) return { task };
    if (!await ownerAlive(pageTabId)) return { blocked: blocked() };
    try {
      const result = await request(`/api/delivery-attempts/${encodeURIComponent(task.requestKey)}/runtime/claim`, {
        method: "POST", requireActionToken: true, platform, pageTabId, operation: "runtime-claim",
        body: { platform, profileId: task.profileId, id: task.id, url: task.url, greeting: task.greeting,
          runId: message.runId, runtimeSessionId: message.runtimeSessionId, correlationId: message.correlationId }
      });
      if (!result.success || result.data?.success !== true || typeof result.data.enabled !== "boolean") return { blocked: blocked() };
      return { task: { ...task, runtime: result.data.enabled
        ? { runtimeSessionId: message.runtimeSessionId, claimVersion: result.data.claimVersion } : null } };
    } catch { return { blocked: blocked() }; }
  }
  async function beforeEffect({ task, begin, observe, matches, active }) {
    if (task.reconciliationOnly) return blocked();
    if (!task.runtime) return null; // Backend explicitly selected the existing executor during rollout.
    try {
      const state = observe();
      if (!matches() || state.blocker !== "NONE" || !active()) return blocked();
      const permit = await begin({ profileId: task.profileId, ...task.runtime, pageType: state.pageType, blocker: state.blocker });
      if (permit.permitted !== true || !matches() || observe().blocker !== "NONE" || !active()) return blocked();
      return null;
    } catch { return blocked(); }
  }
  root.BrowserApplicationRuntime = Object.freeze({ version: "browser-application-runtime/1", claim, beforeEffect });
})(typeof window === "undefined" ? globalThis : window);
