"""Pure validation rules; the driver never treats model confidence as permission."""
from __future__ import annotations
import hashlib
import json
import re
import unicodedata
from difflib import SequenceMatcher
from urllib.parse import urlsplit

PROTOCOL = "2026-09-29-hr-visual-v2"


class Halt(RuntimeError):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code


def normalized(value: str) -> str:
    return re.sub(r"\s+", "", value or "")


def ocr_supports(text: str, image_text: str) -> bool:
    """OCR only corroborates visibility; exact facts and receipts use full UIA text.

    Windows OCR splits glyphs and full-width punctuation. Short messages must match
    completely; long messages need 92% character coverage, never a prefix alone.
    """
    clean = lambda s: re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", s))
    expected, observed = clean(text), clean(image_text)
    if not expected:
        return False
    if expected in observed:
        return True
    if len(expected) < 12:
        return False
    matched = sum(block.size for block in SequenceMatcher(None, expected, observed, autojunk=False).get_matching_blocks())
    return matched / len(expected) >= .92


def require_chat_url(value: str) -> None:
    url = urlsplit(value if "://" in value else "https://" + value)
    if (url.scheme != "https" or url.hostname not in ("www.zhipin.com", "zhipin.com")
            or url.username or url.password or url.port not in (None, 443)
            or url.path.rstrip("/") != "/web/geek/chat"):
        raise Halt("URL_UNVERIFIED", "地址栏不是已核验的 BOSS 聊天页，停止操作")


def inbound_round(messages: list[dict]) -> list[str]:
    end = len(messages)
    while end and messages[end - 1]["from"] != "对方":
        end -= 1
    start = end
    while start and messages[start - 1]["from"] == "对方":
        start -= 1
    return [normalized(m["text"]) for m in messages[start:end]]


def outgoing_tail(messages: list[dict]) -> list[dict]:
    start = len(messages)
    while start and messages[start - 1]["from"] != "对方":
        start -= 1
    return messages[start:]


def source_round(messages: list[dict]) -> list[str]:
    end=len(messages)
    while end and messages[end-1]["from"] != "对方":
        end-=1
    start=end
    while start and messages[start-1]["from"] == "对方":
        start-=1
    return [normalized(m.get("type","文本"))+"|"+normalized(m.get("time",""))+"|"+normalized(m["text"]) for m in messages[start:end]]


def explicit_resume_request(text: str) -> bool:
    text = normalized(text)
    if re.search(r"不要|不用|无需|不需要|暂不|别发|已收到|收到.*简历|看过.*简历|我发|我给|我提供|我的简历|你发过|您发过|简历已|身份证|银行卡|证件|链接|邮箱|微信", text):
        return False
    if re.search(r"(?:简历|履历)(?:解析|分析|优化|修改|制作|生成|功能|系统|筛选|匹配|模板|归档|要求)|(?:开发|研发).{0,12}(?:简历|履历)", text):
        return False
    return bool(re.search(r"(?:发|提供|给|传).{0,12}(?:简历|履历)|(?:想要|要(?:一|个|份)|需要(?:一|你|您)|看(?:看|一下|下)).{0,10}(?:简历|履历)|(?:简历|履历).{0,12}(?:发我|发给|给我|提供|发送|看看)", text))


def resume_request(capture: dict) -> dict | None:
    """Only an observed recruiter request authorizes a native resume action."""
    if not capture.get("contextComplete"):
        return None
    messages = capture.get("messages", [])
    candidates = [(i,m) for i,m in enumerate(messages) if m.get("from") == "对方" and explicit_resume_request(m.get("text", ""))]
    if not candidates:
        return None
    index, message = candidates[-1]
    later = messages[index+1:]
    if any(m.get("from") == "本人" and m.get("type") == "简历" for m in later):
        return None
    if any(m.get("from") == "对方" and re.search(r"不用|无需|不要|暂不|不需要|已收到", m.get("text", "")) for m in later):
        return None
    if message.get("type") == "其他" and not message.get("resumeRequestPending"):
        return None  # A resolved/rejected request card must not become a toolbar fallback.
    return {"text": message["text"], "time": message.get("time", ""), "type": message.get("type", "文本")}


def verify_source(capture: dict, request: dict) -> None:
    for key in ("hrName", "companyName"):
        if not normalized(capture.get(key, "")) or normalized(capture[key]) != normalized(request["target"][key]):
            raise Halt("IDENTITY_MISMATCH", "HR 或公司不匹配，停止发送")
    if not capture.get("contextComplete") or not capture.get("messages"):
        raise Halt("CONTEXT_INCOMPLETE", "正文或当前完整消息轮次未读到")
    if any(m.get("from") not in ("对方", "本人") for m in capture["messages"]):
        raise Halt("DIRECTION_UNKNOWN", "无法确定消息发言方")
    if "expectedRound" in request:
        if inbound_round(capture["messages"]) != request["expectedRound"]:
            raise Halt("STALE", "HR 本轮消息已变化，旧回复失效")
        if "expectedSourceRound" in request and source_round(capture["messages"]) != request["expectedSourceRound"]:
            raise Halt("STALE", "来源消息时间或类型已变化，旧回复失效")
        tail = [normalized(m["text"]) for m in outgoing_tail(capture["messages"])]
        if tail != [normalized(t) for t in request.get("ownTexts", [])]:
            raise Halt("STALE", "本人已回复或会话出现未授权的新消息")


def signature(capture: dict) -> str:
    material = {k: capture.get(k) for k in ("hrName", "companyName", "messages", "contextComplete")}
    return hashlib.sha256(json.dumps(material, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def confirmed_new_message(before: dict, after: dict, action: str, draft: str) -> bool:
    if any(normalized(before.get(k, "")) != normalized(after.get(k, "")) for k in ("hrName", "companyName")):
        return False
    if not after.get("contextComplete") or not after.get("messages"):
        return False
    if source_round(before["messages"]) != source_round(after["messages"]):
        return False
    old = outgoing_tail(before["messages"])
    new = outgoing_tail(after["messages"])
    if len(new) != len(old) + 1:
        return False
    key = lambda m: (m["from"], m.get("type", "文本"), normalized(m["text"]))
    if [key(m) for m in new[:-1]] != [key(m) for m in old]:
        return False
    last = new[-1]
    if last["from"] != "本人" or last.get("pending") or last.get("failed"):
        return False
    if action == "TEXT":
        return last.get("type", "文本") == "文本" and normalized(last["text"]) == normalized(draft)
    return action == "RESUME_NATIVE" and last.get("type") == "简历" and bool(last["text"].strip())


def stable_pair(first: dict, second: dict) -> bool:
    return bool(first.get("messages")) and first.get("contextComplete") and signature(first) == signature(second)
