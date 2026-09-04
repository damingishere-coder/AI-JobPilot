const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const EXTENSION_DIR = path.resolve(__dirname, "..");

function source(file) {
  return fs.readFileSync(path.join(EXTENSION_DIR, file), "utf8");
}

test("Boss and Zhilian callbacks carry request identity, outcome and evidence", () => {
  for (const file of ["boss-content.js", "zhilian-content.js"]) {
    const text = source(file);
    assert.match(text, /requestKey:\s*task\.requestKey/);
    assert.match(text, /outcome,/);
    assert.match(text, /evidence:/);
    assert.match(text, /executeDeliveryOnce\(message\.task/);
  }
});

test("uncertain delivery paths remain unknown and batch responses expose per-row results", () => {
  const background = source("background.js");
  const boss = source("boss-content.js");
  const zhilian = source("zhilian-content.js");

  assert.match(background, /Boss已进入沟通页，但未收到明确平台成功状态/);
  assert.doesNotMatch(background, /Boss已进入沟通页，按成功处理/);
  assert.match(boss, /outcome:\s*"UNKNOWN"/);
  assert.match(zhilian, /outcome:\s*"UNKNOWN"/);
  for (const text of [background, boss, zhilian]) {
    assert.match(text, /unknownCount:/);
    assert.match(text, /results/);
    assert.match(text, /persisted/);
  }
});

test("delivery-result persistence is explicit so the frontend can compensate failed callbacks", () => {
  const background = source("background.js");
  const boss = source("boss-content.js");
  const zhilian = source("zhilian-content.js");

  assert.match(background, /persisted:\s*result\?\.persisted\s*===\s*true/);
  assert.match(boss, /persisted:\s*false/);
  assert.match(zhilian, /persisted:\s*false/);
});

test("Boss confirms only an exact rendered greeting and stops the batch on unknown", () => {
  const background = source("background.js");
  const boss = source("boss-content.js");

  assert.match(boss, /readChatInput\(input\)\s*!==\s*greeting/);
  assert.match(boss, /function normalizeGreetingText/);
  assert.match(boss, /countRenderedGreetingMessages\(greeting, input\)\s*>\s*beforeCount/);
  assert.match(boss, /greetingEvidence:\s*greetingResult\?\.evidence/);
  assert.match(boss, /GREETING_INPUT_MISSING/);
  assert.match(boss, /GREETING_SEND_BUTTON_MISSING/);
  assert.match(boss, /GREETING_RENDER_UNCONFIRMED/);
  assert.match(background, /GREETING_RENDERED_EXACT/);
  assert.match(background, /if \(outcome === "UNKNOWN"\)/);
  assert.match(background, /unprocessedCount/);
  assert.match(background, /skipped:\s*true/);
  assert.doesNotMatch(boss, /return findClickable\(\["发送"\]\)/);
  assert.doesNotMatch(background, /for \(let attempt = 0; attempt < 3; attempt\+\+\) \{\s*try \{\s*const response = await chrome\.tabs\.sendMessage\(tabId, \{\s*\.\.\.message,\s*type: "BOSS_DELIVER_CURRENT_V2"/s);
});
