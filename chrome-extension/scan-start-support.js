(function(root) {
  function fingerprint(serialized) {
    let sha256=root.sha256 || root.window?.sha256;
    if(!sha256 && typeof module!=="undefined") {
      const library=require("./vendor/js-sha256.js");
      sha256=library.sha256 || library;
    }
    if(typeof sha256!=="function") throw new Error("扫描配置指纹组件未加载，请重新加载扩展");
    return "sha256:"+sha256(String(serialized));
  }
  function normalizeKey(key) {
    const value=String(key || "");
    return /^sha256:[a-f0-9]{64}$/.test(value) ? value : fingerprint(value);
  }
  function keyMatches(left,right) {
    return normalizeKey(left)===normalizeKey(right);
  }
  function normalizeBossStartKey(key) {
    const value=String(key || "");
    if(/^sha256:[a-f0-9]{64}$/.test(value)) return value;
    try {
      const parsed=JSON.parse(value);
      if(parsed && typeof parsed.cursor==="string") parsed.cursor=normalizeKey(parsed.cursor);
      return fingerprint(JSON.stringify(parsed));
    } catch {return fingerprint(value);}
  }
  function identityMatches(record, request) {
    return Boolean(record && request && String(request.runId || "").trim()
      && Number.isSafeInteger(Number(request.profileId)) && Number(request.profileId) > 0
      && String(request.scanOwnerToken || "").trim()
      && record.runId === request.runId && Number(record.profileId) === Number(request.profileId)
      && record.scanOwnerToken === request.scanOwnerToken);
  }
  function ack(task, extra = {}) {
    return { ...extra, success: true, startAccepted: true, runId: task.runId,
      profileId: Number(task.profileId), scanOwnerToken: task.scanOwnerToken };
  }
  function readonlyStatus(message, task, status) {
    const acceptedTask = task?.startAccepted === true && identityMatches(task, message) ? task : null;
    const acceptedStatus = status?.startAccepted === true && identityMatches(status, message) ? status : null;
    const record = acceptedStatus || acceptedTask;
    if (!record) return { success: true, startAccepted: false, isRunning: false,
      hasStoredTask: false, stage: "unconfirmed" };
    const paused=Boolean(record.paused || record.pausedAt || record.blockedAt);
    const terminal=["complete","stopped","error"].includes(record.stage || record.phase);
    return ack(record, { stage: record.stage || record.phase || "received",
      isRunning: !paused && !terminal && Boolean(acceptedStatus ? acceptedStatus.isRunning : acceptedTask),
      paused,
      resumable: !terminal && Boolean(acceptedTask || record.resumable), hasStoredTask: !terminal && Boolean(acceptedTask),
      startConfigKey: record.startConfigKey || "" });
  }
  function isNoReceiver(error) {
    return /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error || ""));
  }
  root.GetJobsScanStartSupport = { identityMatches, ack, readonlyStatus, isNoReceiver,
    fingerprint, normalizeKey, keyMatches, normalizeBossStartKey };
  if (typeof module !== "undefined") module.exports = root.GetJobsScanStartSupport;
})(globalThis);
