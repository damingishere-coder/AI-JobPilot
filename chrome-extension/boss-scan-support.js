(function (root) {
  if (root.GetJobsBossScanSupport) return;

  const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1000;

  function isFreshTask(task, now = Date.now(), ttlMs = DEFAULT_TASK_TTL_MS) {
    if (!task || task.type !== "BOSS_SCAN_START" || !task.runId) return false;
    if (task.completed || ["complete", "stopped", "error"].includes(String(task.phase || ""))) return false;
    const lastActiveAt = Number(task.updatedAt || task.startedAt || 0);
    return Boolean(lastActiveAt && Number(now) - lastActiveAt <= Number(ttlMs));
  }

  function normalizeBatchIndex(value, batchTotal) {
    const total = Math.max(0, Math.floor(Number(batchTotal) || 0));
    const parsed = Math.max(0, Math.floor(Number(value) || 0));
    return Math.min(parsed, total);
  }

  function classifyLocalApiFailure(error) {
    const explicit = String(error?.code || "");
    if (explicit) return explicit;
    const text = String(error?.message || error || "");
    if (/Invalid CORS request|cors/i.test(text)) return "CORS_REJECTED";
    if (/超时|timeout|abort/i.test(text)) return "LOCAL_API_TIMEOUT";
    if (/无法连接|Failed to fetch|NetworkError|本地服务请求失败|6866端口/i.test(text)) {
      return "LOCAL_SERVICE_UNAVAILABLE";
    }
    return "LOCAL_API_ERROR";
  }

  root.GetJobsBossScanSupport = Object.freeze({
    DEFAULT_TASK_TTL_MS,
    isFreshTask,
    normalizeBatchIndex,
    classifyLocalApiFailure
  });
})(typeof window !== "undefined" ? window : globalThis);
