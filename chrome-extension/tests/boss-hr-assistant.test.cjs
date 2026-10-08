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
  const bossScripts = manifest.content_scripts.find((entry) => entry.matches.includes("https://www.zhipin.com/*")).js;
  assert.deepEqual(bossScripts.slice(-3), ["boss-hr-support.js", "boss-hr-bridge.js", "boss-hr-assistant.js"]);
  assert.ok(manifest.permissions.includes("alarms"));
  assert.equal(manifest.version, "1.10.4");
});

test("assistant uses the shared background host and preserves explicit manual send", () => {
  const assistant = source("chrome-extension/boss-hr-assistant.js");
  assert.match(assistant, /hr-background-status/);
  assert.match(assistant, /hr-background-pause/);
  assert.doesNotMatch(assistant, /mutate\("hr-start"/);
  assert.match(assistant, /window\.confirm/);
  assert.match(assistant, /const dirty = draft\.value\.trim\(\) !== savedDraft/);
  assert.doesNotMatch(assistant, /hr-command-poll/);
  assert.doesNotMatch(assistant, /openCli|OpenCLI/);
  assert.doesNotMatch(assistant, /screenX|screenY|clientX|clientY|elementFromPoint/);
});

test("background binds one exact BOSS tab, scans every minute, and persists Outbox before reading", () => {
  const background = source("chrome-extension/background.js");
  const bridge = source("chrome-extension/boss-hr-bridge.js");
  assert.match(background, /BOSS_HR_ALARM_NAME/);
  assert.match(background, /periodInMinutes: intervalMinutes/);
  assert.match(background, /if \(bossHrScanPromise\)/);
  assert.match(background, /BOSS_HR_SCAN_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(background, /LOCAL_API_BASE_URLS = \["http:\/\/127\.0\.0\.1:6866"\]/);
  assert.match(bridge, /BOSS_HR_OUTBOX_PUT/);
  assert.match(bridge, /await openConversation\(located\.unique, currentSnapshot, message\.deadlineAt\)/);
  const legacyScan=bridge.slice(bridge.indexOf("async function scan(message)"),bridge.indexOf("async function collectUnreadTargets"));
  assert.ok(legacyScan.indexOf("BOSS_HR_OUTBOX_PUT") < legacyScan.indexOf("await openConversation(located.unique"));
  const hrBackground = background.slice(background.indexOf("async function startBossHrWatch("), background.indexOf("async function handleZhilianLocalApiRequest("));
  assert.doesNotMatch(hrBackground + bridge, /chrome\.windows\.create|about:blank|screenX|screenY|clientX|clientY/);
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

test("legacy workbench routes preserve access to the separated HR, profile, and connection views", () => {
  const environmentPage = source("front/app/env-config/page.tsx");
  const legacyProfilePage = source("front/app/ai-config/page.tsx");
  const hrPage = source("front/app/hr/page.tsx");
  const profilesPage = source("front/app/profiles/page.tsx");
  const settingsPage = source("front/app/settings/page.tsx");
  const profileEditor = source("front/app/ai-config/ProfileEditor.tsx");
  const workbench = source("front/app/env-config/HrAssistantSettingsCard.tsx");

  assert.match(environmentPage, /export\s*\{\s*default\s*\}\s*from\s*['"]\.\.\/settings\/page['"]/);
  assert.match(legacyProfilePage, /export\s*\{\s*default\s*\}\s*from\s*['"]\.\.\/profiles\/page['"]/);
  for (const page of [hrPage, settingsPage]) {
    assert.match(page, /import HrAssistantSettingsCard from ['"]\.\.\/env-config\/HrAssistantSettingsCard['"]/);
  }
  assert.match(hrPage, /<HrAssistantSettingsCard\s+mode="workspace"\s*\/>/);
  assert.match(profilesPage, /import ProfileEditor from ['"]\.\.\/ai-config\/ProfileEditor['"]/);
  assert.match(profilesPage, /<ProfileEditor\s+management\s+showCommunication\s*\/>/);
  assert.match(profileEditor, /import HrAssistantSettingsCard from ['"]\.\.\/env-config\/HrAssistantSettingsCard['"]/);
  assert.match(profileEditor, /showCommunication\s*&&\s*<div hidden=\{profileTab !== 'communication'\}><HrAssistantSettingsCard\s+mode="communication"\s*\/>/);
  assert.match(settingsPage, /<EnvironmentSettings\s*\/>/);
  assert.match(settingsPage, /<HrAssistantSettingsCard\s+mode="connection"\s*\/>/);
  assert.doesNotMatch(settingsPage, /mode="workspace"|HrAutopilotSettings/);
  assert.match(workbench, /\(mode === 'legacy' \|\| mode === 'communication'\) && <fieldset disabled=\{saving\}/);
  assert.match(workbench, /\(mode === 'legacy' \|\| mode === 'connection'\) && <fieldset disabled=\{saving\}/);
});

test("sensitive HR settings remain in the workbench instead of the BOSS overlay", () => {
  const assistant = source("chrome-extension/boss-hr-assistant.js");
  const workbench = source("front/app/env-config/HrAssistantSettingsCard.tsx");
  assert.match(assistant, /settings\.href="http:\/\/127\.0\.0\.1:6866\/hr";settings\.target="_blank";settings\.rel="noopener noreferrer"/);
  assert.doesNotMatch(assistant, /沟通资料与 QQ 通知|hr-settings|qqTargetType|napcatToken/);
  for (const relativePath of ["chrome-extension/boss-hr-assistant.js", "chrome-extension/boss-hr-bridge.js", "chrome-extension/boss-hr-support.js"]) {
    assert.doesNotMatch(source(relativePath), /hr-assistant\/settings|communicationProfile|qqTarget|qqOperator|napcatToken|napcatWsUrl/i);
  }
  assert.match(workbench, /BOSS HR 值守与 QQ 通知/);
  assert.match(workbench, /localActionFetch/);
  assert.match(workbench, /expectedProfileId: currentProfile\.id/);
  assert.match(workbench, /type="password" value=\{form\.napcatToken\}/);
  assert.match(workbench, /napcatToken:\s*''/);
  assert.match(workbench, /setTargetMasked\(settings\.qqTargetMasked \|\| ''\)/);
  assert.match(workbench, /setOperatorMasked\(settings\.qqOperatorMasked \|\| ''\)/);
  assert.match(workbench, /setTokenConfigured\(settings\.napcatTokenConfigured === true\)/);
  assert.doesNotMatch(workbench, /(?:napcatToken|qqTarget|qqOperator):\s*settings\.(?:napcatToken|qqTarget|qqOperator)\b/);
});
