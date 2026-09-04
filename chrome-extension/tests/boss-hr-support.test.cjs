const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const support = require(path.resolve(__dirname, "..", "boss-hr-support.js"));

function textElement(text, attributes = {}) {
  return {
    textContent: text,
    innerText: text,
    className: attributes.className || "",
    getAttribute(name) { return attributes[name] ?? null; },
    contains(other) { return other === this; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 100, height: 30 }; }
  };
}

test("parses no unread and the exact unread(16) tab", () => {
  const empty = { querySelectorAll() { return [textElement("全部"), textElement("未读")]; } };
  const sixteen = { querySelectorAll() { return [textElement("全部"), textElement("未读(16)")]; } };
  assert.equal(support.unreadTotal(empty), 0);
  assert.equal(support.unreadTotal(sixteen), 16);
  assert.equal(support.unreadTab(sixteen).textContent, "未读(16)");
});

test("finds the semantic all tab used to recover read Outbox conversations", () => {
  const all = textElement("全部");
  const documentRef = { querySelectorAll: () => [textElement("未读(16)"), all] };
  assert.equal(support.allTab(documentRef), all);
});

test("reads numeric avatar badges and never uses a name as stable identity", () => {
  const badge = textElement("2", { className: "unread-badge" });
  const item = textElement("胡女士\n公司\n您好", { "data-friend-id": "friend-123" });
  item.querySelectorAll = (selector) => selector.includes("aria-label") ? [badge] : [];
  assert.equal(support.badgeCount(item), 2);
  assert.equal(support.stableUid(item), "friend-123");

  const sameNameWithoutUid = textElement("胡女士\n公司\n您好");
  assert.equal(support.stableUid(sameNameWithoutUid), "");
});

test("same-name HR conversations remain distinct by stable UID", () => {
  const first = textElement("王女士\n甲公司", { "data-friend-id": "friend-a" });
  const second = textElement("王女士\n乙公司", { "data-friend-id": "friend-b" });
  const documentRef = { querySelectorAll: () => [first, second] };
  assert.equal(support.findByUid(documentRef, "friend-a").unique, first);
  assert.equal(support.findByUid(documentRef, "friend-b").unique, second);
  assert.equal(support.findByUid(documentRef, "王女士").unique, null);
});

test("detects login and verification pages without bypassing them", () => {
  const login = { location: { pathname: "/web/user/login" }, body: { innerText: "扫码登录" } };
  const captcha = { location: { pathname: "/web/geek/chat" }, body: { innerText: "请完成滑块验证" } };
  assert.deepEqual(support.pageSafety(login), {
    safe: false, errorCode: "BOSS_LOGIN_REQUIRED", message: "BOSS 登录已失效，值守已暂停"
  });
  assert.equal(support.pageSafety(captcha).errorCode, "BOSS_SECURITY_CHALLENGE");
});

test("message comparison is direction/type/time/text exact and fail closed", () => {
  const expected = { from: "对方", type: "文本", text: " 明天下午可以吗？ ", time: "11:02" };
  assert.equal(support.messagesMatch({ ...expected, text: "明天下午可以吗？" }, expected), true);
  assert.equal(support.messagesMatch({ ...expected, from: "本人" }, expected), false);
  assert.equal(support.messagesMatch({ ...expected, type: "图片" }, expected), false);
  assert.equal(support.messagesMatch({ ...expected, time: "11:03" }, expected), false);
});

test("capture ids stay stable for a static page and change with a new inbound preview", () => {
  const base = { uid: "friend-1", lastMessage: "你好", lastTime: "11:02" };
  assert.equal(support.captureId(base), support.captureId({ ...base }));
  assert.notEqual(support.captureId(base), support.captureId({ ...base, lastMessage: "新消息" }));
});
