(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root.top === root.self && root.location.hostname === "www.zhipin.com"
      && /^\/web\/geek\/chat\/?$/.test(root.location.pathname)) api.install(root.document);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ATTRIBUTE = "data-getjobs-hr-uid";
  const MESSAGE_TYPE = "data-getjobs-hr-message-type";
  const EVENT = "getjobs:hr:refresh-identities";

  function text(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

  function sourceUid(source) {
    if (!source || typeof source !== "object") return "";
    if ([source.friendId, source.friendSource].some(value => typeof value === "number" && !Number.isSafeInteger(value))) return "";
    const friendId = text(source.friendId);
    const friendSource = text(source.friendSource);
    // The current BOSS chat bundle keys both the virtual row and its card by
    // `${friendId}-${friendSource}`. Never derive identity from a name or index.
    if (!/^[1-9]\d{0,19}$/.test(friendId) || !/^\d{1,3}$/.test(friendSource)) return "";
    const uid = `${friendId}-${friendSource}`;
    return text(source.uniqueId) === uid ? uid : "";
  }

  function sync(documentRef) {
    // Clear first: virtual-list nodes can be reused for a different person.
    for (const node of documentRef.querySelectorAll(`[${ATTRIBUTE}]`)) node.removeAttribute(ATTRIBUTE);
    for (const node of documentRef.querySelectorAll(`[${MESSAGE_TYPE}]`)) node.removeAttribute(MESSAGE_TYPE);
    for (const row of documentRef.querySelectorAll(".chat-conversation .im-list > .message-item")) {
      try {
        const component = row.__vue__;
        const message = component?.$el === row ? component.$props?.message : null;
        // ChatMessage renders this very li and selects its body by messageType.
        // Avatars, quoted images and inline emoji do not determine that type.
        if (!message || !text(message.mid) || text(message.mid) !== row.getAttribute("data-mid")) continue;
        const type = ({ text: "文本", image: "图片", sticker: "图片", sound: "语音", video: "视频", resume: "附件" })[message.messageType];
        row.setAttribute(MESSAGE_TYPE, typeof type === "string" ? type : "其他");
      } catch { /* Unrecognized message metadata requires manual review. */ }
    }
    for (const wrapper of documentRef.querySelectorAll(".user-list .friend-content-warp")) {
      try {
        const component = wrapper.__vue__;
        if (!component || component.$el !== wrapper) continue;
        const source = component.$props?.source;
        const uid = sourceUid(source);
        const cards = wrapper.querySelectorAll(".friend-content");
        if (!uid || cards.length !== 1) continue;
        const card = cards[0];
        // Check that these props still describe this rendered card. These texts
        // are consistency checks only; they are never an identity fallback.
        const name = card.querySelector(".name-text");
        const brand = card.querySelector(".name-box > span:nth-child(2)");
        if (!name || !text(source.name) || text(name.textContent) !== text(source.name)) continue;
        if (!brand || text(brand.textContent) !== text(source.brandName)) continue;
        card.setAttribute(ATTRIBUTE, uid);
      } catch {
        // Unsupported component shapes stay unbound and fail closed.
      }
    }
    for (const pane of documentRef.querySelectorAll(".chat-conversation")) {
      try {
        const component = pane.__vue__;
        // The public chat component subscribes to selectedFriend$. Require
        // the right-hand conversation and the selected list card to agree.
        const uid = component?.$el === pane ? sourceUid(component.selectedFriend$) : "";
        if (uid) pane.setAttribute(ATTRIBUTE, uid);
      } catch { /* Leave an unsupported pane unbound. */ }
    }
  }

  function install(documentRef) {
    // On-demand, synchronous metadata only: no timer, network, navigation or
    // component method calls. Do not export the rest of the component props.
    documentRef.addEventListener(EVENT, () => sync(documentRef));
  }
  return { sourceUid, sync, install };
});
