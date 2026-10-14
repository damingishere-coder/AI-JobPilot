(function(root) {
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
  root.GetJobsScanStartSupport = { identityMatches, ack, readonlyStatus, isNoReceiver };
  if (typeof module !== "undefined") module.exports = root.GetJobsScanStartSupport;
})(globalThis);
