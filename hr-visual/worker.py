"""One scoped operation per process, with a prepare/commit boundary on private pipes."""
from __future__ import annotations
import json
import queue
import sys
import threading
import time
import uuid
from core import PROTOCOL, Halt, confirmed_new_message, signature, verify_source, resume_request


def serve(request: dict, driver, receive, emit):
    base = {"protocol": PROTOCOL, "requestId": request.get("requestId", "")}
    submitted = False
    capture = None
    try:
        if request.get("protocol") != PROTOCOL:
            raise Halt("PROTOCOL_MISMATCH", "视觉执行协议不匹配")
        if request.get("operation") not in ("inspect", "prepare", "reconcile", "discover"):
            raise Halt("INVALID_OPERATION", "不支持的视觉操作")
        with driver.session():
            driver.open_chat(request["account"], existing_only=bool(request.get("existingChatOnly")
                             or request.get("resumeRule") or request["operation"] in ("discover", "reconcile")))
            if request["operation"] == "discover":
                emit({**base, "phase": "result", "ok": True, "contacts": driver.list_contacts(), "coverage": "VISIBLE_LOADED_CONTACTS"})
                return
            baseline = request.get("receiptBefore") if request["operation"] == "reconcile" else request.get("contextBaseline")
            if baseline is not None:
                verify_source(baseline, {"target": request["target"]})
                driver.restore_receipt_boundary(baseline)
            capture = driver.select_and_read(request["target"])
            if request["operation"] == "reconcile":
                if not confirmed_new_message(request["receiptBefore"], capture, request["actionType"], request.get("draft", "")):
                    raise Halt("RECEIPT_UNCONFIRMED", "只读复核未发现完整匹配的新增本人消息；未再次发送")
                evidence = driver.save_receipt(request["stepId"], None, capture)
                emit({**base, "phase": "result", "ok": True, "outcome": "SENT_CONFIRMED", "capture": capture,
                      "evidence": evidence, "detail": "只读复核已确认新增本人消息，没有再次提交"})
                return
            verify_source(capture, request)
            if request["operation"] == "inspect":
                emit({**base, "phase": "result", "ok": True, "capture": capture,
                      "composer": driver.composer_text(), "resumeRequest": resume_request(capture)})
                return
            action = request.get("actionType")
            if action not in ("TEXT", "RESUME_NATIVE"):
                raise Halt("INVALID_ACTION", "仅支持批准文字和原生简历")
            if request.get("resumeRule") and (action != "RESUME_NATIVE" or resume_request(capture) != request.get("resumeRequest")):
                raise Halt("STALE", "简历请求已变化或不再有效，未发送")
            adopt = action == "TEXT" and bool(request.get("adoptApprovedDraft")) and bool(driver.composer_text().strip())
            if adopt:
                driver.require_staged_text(request["draft"])
            else:
                driver.require_empty_composer()
            nonce = uuid.uuid4().hex
            driver.save_receipt(request["stepId"], capture, None)
            emit({**base, "phase": "prepared", "ok": True, "nonce": nonce, "capture": capture})
            decision = receive(15)
            if decision.get("operation") != "commit" or decision.get("nonce") != nonce or decision.get("requestId") != base["requestId"]:
                raise Halt("CANCELLED", "未取得本轮提交授权，未发送")
            fresh = driver.read_chat(request["target"])
            verify_source(fresh, request)
            if signature(capture) != signature(fresh):
                raise Halt("STALE", "确认期间聊天变化，未发送")
            if action == "TEXT":
                if not adopt:
                    driver.stage_text(request["draft"])
                final = driver.read_chat(request["target"])
                verify_source(final, request)
                if signature(final) != signature(capture):
                    raise Halt("STALE", "输入期间聊天变化，保留草稿，未发送")
                driver.require_staged_text(request["draft"])
                driver.prepare_text_submit(request["draft"])
                focused = driver.read_chat(request["target"])
                verify_source(focused, request)
                if signature(focused) != signature(capture):
                    raise Halt("STALE", "聚焦输入框后聊天发生变化，未提交")
                driver.require_staged_text(request["draft"])
            else:
                driver.prepare_resume(request.get("resumeRequest") if request.get("resumeRule") else None)
                final = driver.read_chat(request["target"])
                verify_source(final, request)
                if signature(final) != signature(capture):
                    raise Halt("STALE", "准备简历期间聊天变化，未点击")
                if request.get("resumeRule") and resume_request(final) != request.get("resumeRequest"):
                    raise Halt("STALE", "简历请求已失效，未点击")
            driver.guard()
            # Persisted backend SUBMITTING precedes this boundary. Never repeat it.
            submitted = True
            driver.submit(action, capture)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                try:
                    after = driver.read_chat(request["target"], receipt=True)
                except Halt as error:
                    if error.code not in ("BODY_NOT_READY","BODY_UNVERIFIED","CONTEXT_INCOMPLETE","OCR_MISMATCH","COMPOSER_UNVERIFIED","IDENTITY_AMBIGUOUS"):
                        raise
                    time.sleep(1)
                    continue
                if confirmed_new_message(capture, after, action, request.get("draft", "")):
                    evidence = driver.save_receipt(request["stepId"], capture, after)
                    emit({**base, "phase": "result", "ok": True, "outcome": "SENT_CONFIRMED",
                          "detail": "已观察到完整匹配的新增本人消息", "capture": after, "evidence": evidence})
                    return
                time.sleep(1)
            raise Halt("RECEIPT_TIMEOUT", "15 秒内未观察到匹配的新增本人消息，禁止自动重试")
    except Exception as error:
        code = getattr(error, "code", "DRIVER_ERROR")
        evidence = {}
        if request.get("operation") != "reconcile" and capture is not None and request.get("stepId"):
            try:
                evidence = driver.save_receipt(request["stepId"], capture, None)
            except Exception:
                pass
        emit({**base, "phase": "result", "ok": False, "code": code,
              "outcome": "SEND_UNKNOWN" if submitted else "STALE" if code == "STALE" else "BLOCKED",
              "submitted": submitted, "before": capture, "evidence": evidence,
              "detail": str(error)[:240]})


def main():
    from windows_driver import WindowsDriver
    if "--health" in sys.argv:
        result = WindowsDriver.health()
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["ok"] else 1
    inbox = queue.Queue()
    cancelled = threading.Event()
    def reader():
        for line in sys.stdin:
            try:
                value = json.loads(line)
                if value.get("operation") == "cancel":
                    cancelled.set()
                inbox.put(value)
            except (ValueError, AttributeError):
                cancelled.set()
        cancelled.set()
    threading.Thread(target=reader, daemon=True).start()
    request = inbox.get(timeout=15)
    driver = WindowsDriver(cancelled)
    serve(request, driver, inbox.get, lambda value: print(json.dumps(value, ensure_ascii=False), flush=True))
    return 0


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
