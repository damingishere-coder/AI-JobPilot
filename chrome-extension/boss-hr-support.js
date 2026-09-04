(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GetJobsBossHrSupport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CHAT_ITEM_SELECTORS = [
    "[data-friend-id]", "[data-uid]", "[data-user-id]", "[data-boss-id]", "[data-encrypt-id]",
    "li[role='listitem']", ".chat-list li", "[class*='chat-list'] li",
    ".geek-chat-card", ".chat-item", ".friend-item", ".conversation-item",
    "[class*='chat-item']", "[class*='chatItem']", "[class*='friend-item']"
  ];
  const CHAT_ROOT_SELECTORS = [
    ".chat-list", ".friend-list", ".conversation-list", ".user-list",
    "[class*='chat-list']", "[class*='chatList']", "[class*='friend-list']", "[class*='conversation-list']"
  ];
  const MESSAGE_SELECTORS = [
    "[data-message-id]", ".message-item", ".chat-message", ".item-myself", ".item-friend",
    "[class*='message-item']", "[class*='messageItem']"
  ];
  const UID_ATTRIBUTES = ["data-friend-id", "data-uid", "data-user-id", "data-boss-id", "data-encrypt-id"];

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return false;
    const rect = element.getBoundingClientRect();
    const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
  }

  function pageSafety(documentRef) {
    const path = String(documentRef?.location?.pathname || globalThis.location?.pathname || "");
    const text = normalizeText(documentRef?.body?.innerText || documentRef?.body?.textContent || "").slice(0, 8000);
    if (/\/web\/user\/?(?:login)?/i.test(path) || /登录后查看|请先登录|手机号登录|扫码登录/.test(text)) {
      return { safe: false, errorCode: "BOSS_LOGIN_REQUIRED", message: "BOSS 登录已失效，值守已暂停" };
    }
    const securityControl = Array.from(documentRef?.querySelectorAll?.(
      "iframe[src*='captcha'],iframe[src*='verify'],.geetest_panel,[id*='captcha'],[class*='captcha'],[class*='security-verify']"
    ) || []).some(isVisible);
    if (/\/web\/(?:security|verify|captcha)/i.test(path) || securityControl
        || /请完成(?:滑块|安全)验证|访问过于频繁|检测到异常访问|环境存在风险/.test(text)) {
      return { safe: false, errorCode: "BOSS_SECURITY_CHALLENGE", message: "BOSS 出现验证码或风控，值守已暂停，请人工处理" };
    }
    return { safe: true, errorCode: "", message: "" };
  }

  function unreadTotal(documentRef) {
    const candidates = Array.from(documentRef.querySelectorAll("button,span,div,a"));
    for (const element of candidates) {
      const text = normalizeText(element.textContent);
      const match = text.match(/^未读(?:\((\d+)\)|（(\d+)）)?$/);
      if (match) return Number(match[1] || match[2] || 0);
    }
    return 0;
  }

  function unreadTab(documentRef) {
    return Array.from(documentRef.querySelectorAll("button,span,div,a"))
      .find((element) => /^未读(?:\(\d+\)|（\d+）)?$/.test(normalizeText(element.textContent))) || null;
  }

  function allTab(documentRef) {
    return Array.from(documentRef.querySelectorAll("button,span,div,a"))
      .find((element) => normalizeText(element.textContent) === "全部") || null;
  }

  function chatItems(documentRef) {
    const seen = new Set();
    const items = [];
    const roots = Array.from(documentRef.querySelectorAll(CHAT_ROOT_SELECTORS.join(",")))
      .filter((root) => isVisible(root) && root.querySelectorAll(CHAT_ITEM_SELECTORS.join(",")).length > 0);
    const scopes = roots.length ? roots : [documentRef];
    for (const scope of scopes) {
      for (const selector of CHAT_ITEM_SELECTORS) {
        for (const element of scope.querySelectorAll(selector)) {
          if (seen.has(element) || !isVisible(element)) continue;
          const text = normalizeText(element.innerText || element.textContent);
          if (!text || text.length > 1200) continue;
          seen.add(element);
          items.push(element);
        }
      }
    }
    return items;
  }

  function badgeCount(item) {
    const candidates = Array.from(item.querySelectorAll("[aria-label],[class],span,i,em,b"));
    for (const element of candidates) {
      const text = normalizeText(element.textContent);
      const aria = normalizeText(element.getAttribute?.("aria-label"));
      const className = String(element.className || "");
      if (/^\d{1,3}$/.test(text) && /(badge|unread|notice|count|red|dot)/i.test(className + " " + aria)) return Number(text);
      if (/^\d{1,3}$/.test(text) && typeof getComputedStyle === "function") {
        const rgb = String(getComputedStyle(element).backgroundColor || "").match(/\d+/g) || [];
        if (rgb.length >= 3 && Number(rgb[0]) > 170 && Number(rgb[1]) < 150 && Number(rgb[2]) < 150) return Number(text);
      }
      const match = aria.match(/(?:未读|新消息)\s*(\d{1,3})/);
      if (match) return Number(match[1]);
      if (!text && /(unread|red-dot|new-message)/i.test(className)) return 1;
    }
    return 0;
  }

  function stableUid(item) {
    for (const element of [item, ...item.querySelectorAll(UID_ATTRIBUTES.map((name) => `[${name}]`).join(","))]) {
      for (const attribute of UID_ATTRIBUTES) {
        const value = normalizeText(element.getAttribute?.(attribute));
        if (value) return value;
      }
    }
    for (const anchor of item.querySelectorAll("a[href]")) {
      try {
        const url = new URL(anchor.href, "https://www.zhipin.com");
        for (const key of ["uid", "friendId", "bossId", "encryptId", "securityId"]) {
          const value = normalizeText(url.searchParams.get(key));
          if (value) return value;
        }
        const pathMatch = url.pathname.match(/\/(?:chat|im)\/([^/?#]+)/i);
        if (pathMatch?.[1]) return pathMatch[1];
      } catch {
        // Ignore malformed links. Missing identity is handled fail-closed.
      }
    }
    return "";
  }

  function itemSnapshot(item) {
    const textLines = String(item.innerText || item.textContent || "").split(/\r?\n/).map(normalizeText).filter(Boolean);
    const uid = stableUid(item);
    return {
      uid,
      unreadCount: badgeCount(item),
      hrName: normalizeText(item.querySelector(".name-box,.title-box span,[class*='name'],[class*='title']")?.textContent || textLines[0]),
      companyName: normalizeText(item.querySelector("[class*='company'],[class*='brand']")?.textContent || textLines[1]),
      jobName: normalizeText(item.querySelector("[class*='job'],[class*='position']")?.textContent || ""),
      lastMessage: normalizeText(item.querySelector(".last-msg-text,.last-msg,[class*='last-msg'],[class*='last'],[class*='message'],[class*='desc']")?.textContent || textLines.at(-1)),
      lastTime: normalizeText(item.querySelector("time,[class*='time']")?.textContent || "")
    };
  }

  function findByUid(documentRef, uid) {
    const rawMatches = chatItems(documentRef).filter((item) => stableUid(item) === String(uid || ""));
    const matches = rawMatches.filter((item) => !rawMatches.some((other) => other !== item && other.contains(item)));
    return { matches, unique: matches.length === 1 ? matches[0] : null };
  }

  function currentSession(documentRef, fallback) {
    const scope = documentRef.querySelector("[class*='chat-content'],[class*='conversation-detail'],[class*='chat-panel'],main") || documentRef;
    const title = normalizeText(scope.querySelector("h1,h2,h3,[class*='chat-title'],[class*='title']")?.textContent || fallback?.hrName);
    const text = normalizeText(scope.innerText || scope.textContent).slice(0, 1600);
    return {
      uid: fallback?.uid || "",
      securityId: normalizeText(scope.querySelector("[data-security-id]")?.getAttribute("data-security-id")),
      hrName: fallback?.hrName || title,
      companyName: fallback?.companyName || "",
      jobName: fallback?.jobName || "",
      title,
      lastMessage: fallback?.lastMessage || "",
      lastTime: fallback?.lastTime || "",
      surfaceText: text
    };
  }

  function readMessages(documentRef) {
    const seen = new Set();
    const messages = [];
    for (const selector of MESSAGE_SELECTORS) {
      for (const element of documentRef.querySelectorAll(selector)) {
        if (seen.has(element) || !isVisible(element)) continue;
        seen.add(element);
        const className = String(element.className || "");
        const directionHint = normalizeText(element.getAttribute?.("data-direction") || element.getAttribute?.("data-from"));
        const direction = /(self|mine|outbound|本人|我)/i.test(directionHint)
          || /(^|[\s_-])(item-myself|myself|self|mine|message-self|right)([\s_-]|$)/i.test(className)
          ? "本人" : "对方";
        const content = element.querySelector("[class*='bubble'],[class*='message-content'],[class*='messageContent']") || element;
        const type = content.querySelector("audio,[class*='voice']") ? "语音"
          : content.querySelector("[class*='file'],[class*='attachment']") ? "附件"
            : content.querySelector("img:not([class*='avatar'])") ? "图片" : "文本";
        const textNode = content.querySelector("[class*='text'],[class*='content']") || content;
        const text = normalizeText(textNode?.innerText || textNode?.textContent || element.innerText || element.textContent);
        const time = normalizeText(element.querySelector("time,[class*='time']")?.textContent || element.getAttribute?.("data-time"));
        if (!text && type === "文本") continue;
        messages.push({ from: direction, type, text, time });
      }
    }
    return messages;
  }

  function latestInbound(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.from === "对方") return messages[index];
    }
    return null;
  }

  function messagesMatch(left, right) {
    if (!left || !right) return false;
    return normalizeText(left.from) === normalizeText(right.from)
      && normalizeText(left.type) === normalizeText(right.type)
      && normalizeText(left.text) === normalizeText(right.text)
      && (!normalizeText(right.time) || normalizeText(left.time) === normalizeText(right.time));
  }

  function simpleHash(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function captureId(snapshot) {
    return `${simpleHash(snapshot.uid)}-${simpleHash([snapshot.uid, snapshot.lastMessage, snapshot.lastTime].join("|"))}`;
  }

  return {
    normalizeText, pageSafety, unreadTotal, unreadTab, allTab, chatItems, badgeCount, stableUid,
    itemSnapshot, findByUid, currentSession, readMessages, latestInbound, messagesMatch,
    simpleHash, captureId
  };
});
