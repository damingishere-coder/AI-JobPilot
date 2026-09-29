import copy
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import PROTOCOL, Halt, confirmed_new_message, require_chat_url, verify_source, stable_pair, source_round
from worker import serve


def msg(text, owner="对方", kind="文本", **extra):
    return {"from": owner, "type": kind, "text": text, "time": "09-23 14:11", **extra}


def capture(*messages):
    return {"hrName": "王女士", "companyName": "甲公司", "contextComplete": True, "messages": list(messages)}


class FakeDriver:
    def __init__(self, before, after=None, stage_change=False, fail_submit=False):
        self.before=before; self.after=after or before; self.submissions=0; self.stage_change=stage_change; self.staged=False; self.fail_submit=fail_submit
    def session(self): return nullcontext()
    def open_chat(self, account): pass
    def select_and_read(self, target): return self.before
    def read_chat(self, target, receipt=False):
        return self.after if receipt or (self.staged and self.stage_change) else self.before
    def require_empty_composer(self):
        if self.composer_text().strip(): raise Halt('HUMAN_DRAFT','已有人工草稿')
    def composer_text(self): return ""
    def require_staged_text(self, text): pass
    def stage_text(self, text): self.staged=True
    def prepare_resume(self): pass
    def prepare_text_submit(self, text): pass
    def guard(self): pass
    def submit(self, action, before=None):
        self.submissions+=1
        if self.fail_submit: raise RuntimeError("submission interrupted")
    def save_receipt(self, *args): return {"before": "encrypted", "after": "encrypted"}


class WorkerTests(unittest.TestCase):
    def request(self, **extra):
        return {"protocol": PROTOCOL, "requestId": "r1", "operation": "prepare", "account": "本人",
                "target": {"hrName": "王女士", "companyName": "甲公司"}, "expectedRound": ["你好", "什么时候到岗？"],
                "ownTexts": [], "actionType": "TEXT", "draft": "两周后可以到岗。", "stepId": "step", **extra}

    def run_driver(self, driver, decision="commit", **extra):
        events=[]
        def receive(timeout):
            return {"operation": decision, "nonce": events[-1]["nonce"], "requestId": "r1"}
        serve(self.request(**extra), driver, receive, events.append)
        return events[-1]

    def test_exact_new_reply_is_confirmed_once(self):
        before=capture(msg("你好"),msg("什么时候到岗？"))
        after=capture(*before["messages"],msg("两周后可以到岗。","本人"))
        d=FakeDriver(before,after)
        self.assertEqual(self.run_driver(d)["outcome"],"SENT_CONFIRMED")
        self.assertEqual(d.submissions,1)

    def test_never_submits_on_changed_round_or_manual_reply(self):
        cases=[capture(msg("你好"),msg("什么时候到岗？"),msg("新增问题")),
               capture(msg("你好"),msg("什么时候到岗？"),msg("我已回复","本人"))]
        for before in cases:
            d=FakeDriver(before)
            self.assertEqual(self.run_driver(d)["outcome"],"STALE")
            self.assertEqual(d.submissions,0)

    def test_new_message_while_typing_invalidates_old_draft(self):
        d=FakeDriver(capture(msg("你好"),msg("什么时候到岗？")),capture(msg("你好"),msg("先不用回复")),stage_change=True)
        self.assertEqual(self.run_driver(d)["outcome"],"STALE")
        self.assertEqual(d.submissions,0)

    def test_chat_change_after_focusing_editor_stops_before_enter(self):
        d=FakeDriver(capture(msg("你好"),msg("什么时候到岗？")))
        def focus_then_change(text):
            d.before=capture(msg("你好"),msg("什么时候到岗？"),msg("先不用回复"))
        d.prepare_text_submit=focus_then_change
        self.assertEqual(self.run_driver(d)["outcome"],"STALE")
        self.assertEqual(d.submissions,0)

    def test_cancel_and_wrong_identity_cannot_send(self):
        d=FakeDriver(capture(msg("你好"),msg("什么时候到岗？")))
        self.assertEqual(self.run_driver(d,"cancel")["outcome"],"BLOCKED")
        self.assertEqual(d.submissions,0)
        d.before["companyName"]="乙公司"
        self.assertEqual(self.run_driver(d)["code"],"IDENTITY_MISMATCH")

    def test_crash_after_submit_is_unknown_and_not_retried(self):
        d=FakeDriver(capture(msg("你好"),msg("什么时候到岗？")),fail_submit=True)
        self.assertEqual(self.run_driver(d)["outcome"],"SEND_UNKNOWN")
        self.assertEqual(d.submissions,1)

    def test_obscured_editor_stops_before_submission(self):
        d=FakeDriver(capture(msg("你好"),msg("什么时候到岗？")))
        def obstructed(text): raise Halt("COMPOSER_OCCLUDED","编辑框被遮挡")
        d.prepare_text_submit=obstructed
        result=self.run_driver(d)
        self.assertEqual(result['outcome'],'BLOCKED')
        self.assertFalse(result['submitted'])
        self.assertEqual(d.submissions,0)

    def test_explicit_reconfirmation_uses_exact_approved_staged_draft(self):
        before=capture(msg("你好"),msg("什么时候到岗？"))
        after=capture(*before['messages'],msg("两周后可以到岗。","本人"))
        d=FakeDriver(before,after)
        d.composer_text=lambda:"两周后可以到岗。"
        self.assertEqual(self.run_driver(d)['outcome'],'BLOCKED')
        self.assertEqual(d.submissions,0)
        self.assertEqual(self.run_driver(d,adoptApprovedDraft=True)['outcome'],'SENT_CONFIRMED')
        self.assertFalse(d.staged)
        self.assertEqual(d.submissions,1)
        def wrong(text): raise Halt('DRAFT_MISMATCH','人工草稿不同')
        d=FakeDriver(before,after);d.composer_text=lambda:'别的草稿';d.require_staged_text=wrong
        self.assertEqual(self.run_driver(d,adoptApprovedDraft=True)['outcome'],'BLOCKED')
        self.assertEqual(d.submissions,0)

    def test_old_prefix_match_and_cleared_composer_are_not_receipts(self):
        before=capture(msg("你好"),msg("相同内容","本人"))
        self.assertFalse(confirmed_new_message(before,copy.deepcopy(before),"TEXT","相同内容"))
        self.assertFalse(confirmed_new_message(capture(msg("你好")),capture(msg("你好"),msg("两周后可以到岗，但是尚未确定。","本人")),"TEXT","两周后可以到岗。"))

    def test_resume_needs_new_self_resume_card(self):
        before=capture(msg("请发简历"),msg("好的","本人"))
        self.assertFalse(confirmed_new_message(before,capture(*before["messages"],msg("已发送","本人")),"RESUME_NATIVE",""))
        after=capture(*before["messages"],msg("附件简历：产品经理.pdf","本人","简历"))
        self.assertTrue(confirmed_new_message(before,after,"RESUME_NATIVE",""))
        self.assertFalse(confirmed_new_message(after,after,"RESUME_NATIVE",""))

    def test_failed_or_pending_bubble_is_not_success(self):
        before=capture(msg("你好"))
        for flag in ("failed","pending"):
            self.assertFalse(confirmed_new_message(before,capture(msg("你好"),msg("您好","本人",**{flag:True})),"TEXT","您好"))

    def test_url_allowlist_is_exact(self):
        require_chat_url("https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1")
        for url in ("http://www.zhipin.com/web/geek/chat", "https://www.zhipin.com.evil.test/web/geek/chat", "https://evil@www.zhipin.com/web/geek/chat", "https://www.zhipin.com/web/geek/chat/other", "about:blank"):
            with self.assertRaises(Halt): require_chat_url(url)

    def test_stability_requires_nonempty_complete_context(self):
        c=capture(msg("你好"))
        self.assertTrue(stable_pair(c,copy.deepcopy(c)))
        self.assertFalse(stable_pair(c,capture()))
        c["contextComplete"]=False
        self.assertFalse(stable_pair(c,c))

    def test_protocol_mismatch_never_reads_or_sends(self):
        d=FakeDriver(capture(msg("你好")))
        self.assertEqual(self.run_driver(d,protocol="old")["code"],"PROTOCOL_MISMATCH")
        self.assertEqual(d.submissions,0)

    def test_same_words_from_a_new_message_do_not_reuse_approval(self):
        old=capture(msg("你好"),msg("什么时候到岗？"))
        fresh=copy.deepcopy(old);fresh["messages"][-1]["time"]="09-24 14:11"
        d=FakeDriver(fresh)
        self.assertEqual(self.run_driver(d,expectedSourceRound=source_round(old["messages"]))["outcome"],"STALE")
        self.assertEqual(d.submissions,0)


if __name__ == "__main__": unittest.main()
