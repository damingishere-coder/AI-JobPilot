const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const extensionRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(extensionRoot, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("manifest loads the direct HR bridge and one-minute alarm capability", () => {
  const manifest = JSON.parse(source("chrome-extension/manifest.json"));
  const bossScripts = manifest.content_scripts.find((entry) => entry.matches.some((value) => value.includes("zhipin.com"))).js;
  assert.deepEqual(bossScripts.slice(-3), ["boss-hr-support.js", "boss-hr-bridge.js", "boss-hr-assistant.js"]);
  assert.ok(manifest.permissions.includes("alarms"));
  assert.equal(manifest.version, "1.6.0");
});

test("assistant keeps full auto locked and sends only after explicit confirmation", () => {
  const assistant = source("chrome-extension/boss-hr-assistant.js");
  assert.match(assistant, /全自动（锁定）/);
  assert.match(assistant, /locked\.disabled = true/);
  assert.match(assistant, /window\.confirm/);
  assert.match(assistant, /const dirty = draft\.value\.trim\(\) !== savedDraft/);
  assert.match(assistant, /hr-command-poll/);
  assert.doesNotMatch(assistant, /openCli|OpenCLI/);
  assert.doesNotMatch(assistant, /screenX|screenY|clientX|clientY|elementFromPoint/);
});

test("background binds one exact BOSS tab, scans every minute, and persists Outbox before reading", () => {
  const background = source("chrome-extension/background.js");
  const bridge = source("chrome-extension/boss-hr-bridge.js");
  assert.match(background, /BOSS_HR_ALARM_NAME/);
  assert.match(background, /periodInMinutes: 1/);
  assert.match(background, /if \(bossHrScanPromise\)/);
  assert.match(background, /BOSS_HR_SCAN_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(background, /LOCAL_API_BASE_URLS = \["http:\/\/127\.0\.0\.1:6866"\]/);
  assert.match(bridge, /BOSS_HR_OUTBOX_PUT/);
  assert.match(bridge, /located\.unique\.click\(\)/);
  assert.ok(bridge.indexOf("BOSS_HR_OUTBOX_PUT") < bridge.indexOf("located.unique.click()"));
  assert.doesNotMatch(background + bridge, /chrome\.windows\.create|about:blank|screenX|screenY|clientX|clientY/);
});

test("direct send is fail-closed and requires exact outbound reread", () => {
  const bridge = source("chrome-extension/boss-hr-bridge.js");
  const store = source("src/main/java/com/getjobs/application/service/HrAssistantStore.java");
  assert.match(bridge, /messagesMatch\(latest, command\.expectedLatestInbound\)/);
  assert.match(bridge, /outcome: "RESULT_UNKNOWN"/);
  assert.match(bridge, /message\.from === "本人"/);
  assert.match(bridge, /normalizeText\(message\.text\) === expected/);
  assert.match(store, /case "SENT" -> ProposalStatus\.SENT_CONFIRMED/);
  assert.match(store, /default -> ProposalStatus\.SEND_UNKNOWN/);
  assert.doesNotMatch(bridge, /setInterval\([^)]*executeSend/);
});

test("backend no longer contains the OpenCLI HR runtime classes or settings", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "src/main/java/com/getjobs/application/service/OpenCliBossGateway.java")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "src/main/java/com/getjobs/application/service/ProcessOpenCliCommandRunner.java")), false);
  const application = source("src/main/resources/application.yaml");
  const watcher = source("src/main/java/com/getjobs/application/service/HrAssistantWatchService.java");
  assert.doesNotMatch(application, /APP_HR_OPENCLI|opencli-session|opencli-executable/);
  assert.doesNotMatch(watcher, /OpenCli|openCli/);
});

test("sensitive HR settings remain in the workbench instead of the BOSS overlay", () => {
  const assistant = source("chrome-extension/boss-hr-assistant.js");
  const workbench = source("front/app/env-config/HrAssistantSettingsCard.tsx");
  const environmentPage = source("front/app/env-config/page.tsx");
  assert.doesNotMatch(assistant, /沟通资料与 QQ 通知|hr-settings|qqTargetType|napcatToken/);
  assert.match(workbench, /BOSS HR 值守与 QQ 通知/);
  assert.match(workbench, /localActionFetch/);
  assert.match(environmentPage, /<HrAssistantSettingsCard \/>/);
});
