const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../application-runtime-protocol.js"), "utf8"), context);
const protocol = context.ApplicationRuntimeProtocol;
function message() {
  return { type: "BOSS_DELIVER_BATCH", platform: "boss", runtimeProtocol: protocol.VERSION,
    runId: "batch", correlationId: "interaction", runtimeSessionId: "session",
    tasks: [{ id: 1, profileId: 2, requestKey: "confirmed-attempt", url: "https://www.zhipin.com/job_detail/test.html", greeting: "合成话术" }] };
}
test("confirmed batch is copied and frozen, never expands with later input", () => {
  const input = message(); const frozen = protocol.freezeDispatch(input);
  input.tasks[0].greeting = "changed"; input.tasks.push({ id: 2 });
  assert.equal(frozen.tasks.length, 1); assert.equal(frozen.tasks[0].greeting, "合成话术");
  assert.ok(Object.isFrozen(frozen.tasks)); assert.ok(Object.isFrozen(frozen.tasks[0]));
});
test("protocol, identity, duplicate attempts and mixed profiles fail closed", () => {
  for (const change of [
    m => delete m.runtimeProtocol, m => delete m.runtimeSessionId, m => { m.tasks = []; },
    m => delete m.tasks[0].requestKey, m => { m.tasks[0].profileId = 0; },
    m => { m.platform = "zhilian"; }, m => { m.tasks[0].reconciliationOnly = "false"; },
    m => m.tasks.push({ ...m.tasks[0] }),
    m => m.tasks.push({ ...m.tasks[0], id: 3, requestKey: "second", profileId: 4 })
  ]) {
    const input = message(); change(input); assert.throws(() => protocol.freezeDispatch(input));
  }
});
test("read-only reconciliation stays explicit and UNKNOWN is a first-class outcome", () => {
  const input = message(); input.tasks[0].reconciliationOnly = true;
  assert.equal(protocol.freezeDispatch(input).tasks[0].reconciliationOnly, true);
  assert.ok(protocol.OUTCOMES.includes("UNKNOWN"));
});
