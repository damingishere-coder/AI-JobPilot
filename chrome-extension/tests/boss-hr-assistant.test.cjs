const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('manifest loads the Shadow DOM HR assistant on BOSS pages', () => {
  const manifest = JSON.parse(source('chrome-extension/manifest.json'));
  const bossScripts = manifest.content_scripts.find((entry) => entry.matches.some((value) => value.includes('zhipin.com'))).js;
  assert.ok(bossScripts.includes('boss-hr-assistant.js'));
  assert.equal(manifest.version, '1.5.0');
});

test('assistant keeps full auto locked and sends only after explicit confirmation', () => {
  const assistant = source('chrome-extension/boss-hr-assistant.js');
  assert.match(assistant, /全自动（锁定）/);
  assert.match(assistant, /locked\.disabled = true/);
  assert.match(assistant, /window\.confirm/);
  assert.match(assistant, /const dirty = draft\.value\.trim\(\) !== savedDraft/);
  assert.match(assistant, /send\.disabled = dirty/);
  assert.match(assistant, /operation, params, body/);
  assert.match(assistant, /lastError: status\?\.lastError \|\| actionError/);
  assert.doesNotMatch(assistant, /screenX|screenY|clientX|clientY|elementFromPoint/);
});

test('sensitive HR settings live in the workbench instead of the BOSS overlay', () => {
  const assistant = source('chrome-extension/boss-hr-assistant.js');
  const workbench = source('front/app/env-config/HrAssistantSettingsCard.tsx');
  const environmentPage = source('front/app/env-config/page.tsx');
  assert.doesNotMatch(assistant, /沟通资料与 QQ 通知|hr-settings|qqTargetType|napcatToken/);
  assert.match(assistant, /localApi\("hr-status"\), localApi\("hr-proposals"\)/);
  assert.match(workbench, /BOSS HR 值守与 QQ 通知/);
  assert.match(workbench, /localActionFetch/);
  assert.match(workbench, /群内操作人 QQ（可选）/);
  assert.match(environmentPage, /<HrAssistantSettingsCard \/>/);
});

test('backend contract fixes scanning at no less than sixty seconds and never retries HR send', () => {
  const watcher = source('src/main/java/com/getjobs/application/service/HrAssistantWatchService.java');
  const background = source('chrome-extension/background.js');
  const gateway = source('src/main/java/com/getjobs/application/service/OpenCliBossGateway.java');
  assert.match(watcher, /Math\.max\(60_000, scanIntervalMs\)/);
  assert.match(watcher, /@Scheduled\(fixedRate = 60_000\)/);
  assert.match(watcher, /lastScanAt\.plusNanos\(scanIntervalMs \* 1_000_000\)/);
  assert.match(watcher, /scanRunning\.compareAndSet\(false, true\)/);
  assert.match(watcher, /watching\.get\(\) && !scanRunning\.get\(\)/);
  assert.match(background, /options\.operation === "hr-send"/);
  assert.match(background, /\? \[localActionBaseUrl \|\| LOCAL_API_BASE_URLS\[0\]\]/);
  assert.match(gateway, /"chatmsg", uid, "--side", "geek"/);
  assert.match(gateway, /"fill", "#chat-input"/);
  assert.match(gateway, /"keys", "Enter"/);
  assert.doesNotMatch(gateway, /"boss", "send"/);
});

test('unread extraction requires numeric per-conversation badges and checks total unread', () => {
  const gateway = source('src/main/java/com/getjobs/application/service/OpenCliBossGateway.java');
  const watcher = source('src/main/java/com/getjobs/application/service/HrAssistantWatchService.java');
  assert.match(gateway, /\^未读\\\\\(\\\\d\+\\\\\)\$/);
  assert.match(gateway, /unreadCount/);
  assert.match(gateway, /if \(unread <= 0\) continue/);
  assert.match(gateway, /SCROLL_CHAT_LIST_SCRIPT/);
  assert.match(gateway, /scrollTop = Math\.min/);
  assert.match(watcher, /gateway\.scrollUnreadList\(\)/);
  assert.match(watcher, /BOSS 显示有未读消息/);
});
