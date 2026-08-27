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
