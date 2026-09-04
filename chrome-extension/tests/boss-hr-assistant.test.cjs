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
  assert.doesNotMatch(assistant, /screenX|screenY|clientX|clientY|elementFromPoint/);
});

test('QQ settings support encrypted group notification and optional operator mode', () => {
  const assistant = source('chrome-extension/boss-hr-assistant.js');
  assert.match(assistant, /\[\["PRIVATE", "私人 QQ"\], \["GROUP", "指定群聊"\]\]/);
  assert.match(assistant, /群内操作人 QQ（可选）/);
  assert.match(assistant, /不填则群聊仅接收通知/);
  assert.match(assistant, /qqTargetType: read\("qqTargetType"\)/);
  assert.match(assistant, /qqOperator: read\("qqOperator"\)/);
  assert.match(assistant, /qqOperatorClear/);
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
