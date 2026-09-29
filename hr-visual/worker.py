"""One scoped operation per process, with a prepare/commit boundary on private pipes."""
from __future__ import annotations
import json
import queue
import sys
import threading
import time
import uuid
from core import PROTOCOL, Halt, confirmed_new_message, signature, verify_source


def serve(request: dict, driver, receive, emit):
    base = {"protocol": PROTOCOL, "requestId": request.get("requestId", "")}
    submitted = False
    try:
        if request.get("protocol") != PROTOCOL:
            raise Halt("PROTOCOL_MISMATCH", "视觉执行协议不匹配")
        if request.get("operation") not in ("inspect", "prepare"):
            raise Halt("INVALID_OPERATION", "不支持的视觉操作")
        with driver.session():
            driver.open_chat(request["account"])
            capture = driver.select_and_read(request["target"])
            verify_source(capture, request)
            if request["operation"] == "inspect":
                emit({**base, "phase": "result", "ok": True, "capture": capture})
                return
            action = request.get("actionType")
            if action not in ("TEXT", "RESUME_NATIVE"):
                raise Halt("INVALID_ACTION", "仅支持批准文字和原生简历")
            driver.require_empty_composer()
            nonce = uuid.uuid4().hex
            emit({**base, "phase": "prepared", "ok": True, "nonce": nonce, "capture": capture})
            decision = receive(15)
            if decision.get("operation") != "commit" or decision.get("nonce") != nonce or decision.get("requestId") != base["requestId"]:
                raise Halt("CANCELLED", "未取得本轮提交授权，未发送")
            fresh = driver.read_chat(request["target"])
            verify_source(fresh, request)
            if signature(capture) != signature(fresh):
                raise Halt("STALE", "确认期间聊天变化，未发送")
            if action == "TEXT":
                driver.stage_text(request["draft"])
                final = driver.read_chat(request["target"])
                verify_source(final, request)
                if signature(final) != signature(capture):
                    raise Halt("STALE", "输入期间聊天变化，保留草稿，未发送")
                driver.require_staged_text(request["draft"])
            else:
                driver.prepare_resume()
            driver.guard()
            # Persisted backend SUBMITTING precedes this boundary. Never repeat it.
            submitted = True
            driver.submit(action, capture)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                try:
                    after = driver.read_chat(request["target"], receipt=True)
                except Halt as error:
                    if error.code not in ("BODY_NOT_READY","BODY_UNVERIFIED","CONTEXT_INCOMPLETE","OCR_MISMATCH","COMPOSER_UNVERIFIED"):
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
        emit({**base, "phase": "result", "ok": False, "code": code,
              "outcome": "SEND_UNKNOWN" if submitted else "STALE" if code == "STALE" else "BLOCKED",
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
