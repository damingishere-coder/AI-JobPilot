const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const extensionDir = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(extensionDir, file), "utf8");
}

test("extension release and both content scripts use the profile-scoped contract", () => {
  const manifest = JSON.parse(source("manifest.json"));
  const background = source("background.js");
  const boss = source("boss-content.js");
  const zhilian = source("zhilian-content.js");

  assert.equal(manifest.version, "1.6.0");
  assert.match(background, /BACKGROUND_VERSION = "2026-09-04-boss-hr-direct"/);
  assert.match(background, /REQUIRED_BOSS_CONTENT_VERSION = "2026-09-04-boss-hr-direct"/);
  assert.match(boss, /EXTENSION_VERSION = "2026-09-04-boss-hr-direct"/);
  assert.match(zhilian, /EXTENSION_VERSION = "2026-09-04-boss-hr-direct"/);
});

test("both platforms bind cursors, dedupe, submissions and progress to profileId", () => {
  for (const file of ["boss-content.js", "zhilian-content.js"]) {
    const content = source(file);
    assert.match(content, /function buildKeywordCursorKey[\s\S]*?profileId: normalizeProfileId\(message\?\.profileId\)/);
    assert.match(content, /chrome-jobs-dedupe[\s\S]*?profileId: normalizeProfileId/);
    assert.match(content, /chrome-jobs[\s\S]*?profileId: normalizeProfileId/);
    assert.match(content, /function postProgress[\s\S]*?profileId: normalizeProfileId\(message\?\.profileId\)/);
    assert.match(content, /if \(!normalizeProfileId\(task\?\.profileId\)\) return false/);
  }
});

test("profile contract failures are terminal rather than resumable", () => {
  const boss = source("boss-content.js");
  const zhilian = source("zhilian-content.js");

  assert.match(boss, /\["PROFILE_REQUIRED", "PROFILE_CHANGED"\][\s\S]*?clearStoredScanTask\(\)/);
  assert.match(zhilian, /\["PROFILE_REQUIRED", "PROFILE_CHANGED"\][\s\S]*?clearStoredScanTask\(\)/);
  assert.match(zhilian, /resumable: false/);
});
