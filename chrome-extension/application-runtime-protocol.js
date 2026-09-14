/* Runtime v1: protocol only. Selectors, execution claims and recovery remain platform-owned until P0.4. */
(function (root) {
  "use strict";
  const VERSION = "application-runtime/1";
  const ACTIONS = Object.freeze(["NAVIGATE", "OPEN_JOB", "COLLECT_JOB", "PREPARE_APPLY", "START_APPLY", "CONFIRM_APPLY", "VERIFY_APPLY", "RECOVER_PAGE"]);
  const PAGE_TYPES = Object.freeze(["UNKNOWN", "SEARCH", "JOB_DETAIL", "CHAT"]);
  const BLOCKERS = Object.freeze(["NONE", "LOADING", "LOGIN_REQUIRED", "VERIFICATION_REQUIRED", "QUOTA_LIMIT", "BLOCKING_DIALOG", "JOB_UNAVAILABLE", "ERROR"]);
  const OUTCOMES = Object.freeze(["CONFIRMED", "FAILED", "UNKNOWN"]);
  const ERROR_CODES = Object.freeze(["RUNTIME_PROTOCOL_MISMATCH", "INVALID_CONFIRMED_BATCH", "CONFIRMATION_CHANGED", "LOGIN_REQUIRED", "VERIFICATION_REQUIRED", "QUOTA_LIMIT", "RESULT_UNKNOWN"]);
  const isDelivery = type => /^(BOSS|ZHILIAN)_DELIVER_(ONE|BATCH)$/.test(type || "");
  function freezeDispatch(message) {
    if (!isDelivery(message?.type)) throw new Error("INVALID_CONFIRMED_BATCH");
    if (message.runtimeProtocol !== VERSION) throw new Error("RUNTIME_PROTOCOL_MISMATCH");
    const platform = message.type.startsWith("BOSS_") ? "boss" : "zhilian";
    if (message.platform && message.platform !== platform) throw new Error("INVALID_CONFIRMED_BATCH");
    const source = message.type.endsWith("_ONE") ? [message.task] : message.tasks;
    if (!Array.isArray(source) || !source.length || !message.runId || !message.runtimeSessionId || !message.correlationId) {
      throw new Error("INVALID_CONFIRMED_BATCH");
    }
    const keys = new Set();
    const rows = new Set();
    let profile;
    const tasks = source.map(task => {
      if (!task || !Number.isSafeInteger(task.id) || task.id <= 0 || !Number.isSafeInteger(task.profileId) || task.profileId <= 0
          || typeof task.requestKey !== "string" || !task.requestKey.trim() || keys.has(task.requestKey) || rows.has(task.id)
          || (task.platform && task.platform !== platform) || typeof task.url !== "string" || !task.url
          || typeof task.greeting !== "string" || (task.reconciliationOnly !== undefined && typeof task.reconciliationOnly !== "boolean")) {
        throw new Error("INVALID_CONFIRMED_BATCH");
      }
      if (profile !== undefined && profile !== task.profileId) throw new Error("INVALID_CONFIRMED_BATCH");
      if (message.profileId !== undefined && message.profileId !== task.profileId) throw new Error("INVALID_CONFIRMED_BATCH");
      profile = task.profileId;
      keys.add(task.requestKey); rows.add(task.id);
      return Object.freeze({ ...task, platform });
    });
    return Object.freeze({ ...message, platform, profileId: profile,
      ...(message.type.endsWith("_ONE") ? { task: tasks[0] } : { tasks: Object.freeze(tasks) }) });
  }
  root.ApplicationRuntimeProtocol = Object.freeze({ VERSION, ACTIONS, PAGE_TYPES, BLOCKERS, OUTCOMES, ERROR_CODES, isDelivery, freezeDispatch });
})(globalThis);
