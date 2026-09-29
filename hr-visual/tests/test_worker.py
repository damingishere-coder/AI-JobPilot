import copy
import sys
import unittest
from unittest.mock import patch
from contextlib import nullcontext, contextmanager
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import PROTOCOL, Halt, confirmed_new_message, require_chat_url, verify_source, stable_pair, source_round, resume_request
from worker import serve


def msg(text, owner="对方", kind="文本", **extra):
    return {"from": owner, "type": kind, "text": text, "time": "09-23 14:11", **extra}


def capture(*messages):
    return {"hrName": "王女士", "companyName": "甲公司", "contextComplete": True, "messages": list(messages)}


class FakeDriver:
    def __init__(self, before, after=None, stage_change=False, fail_submit=False):
        self.before=before; self.after=after or before; self.submissions=0; self.stage_change=stage_change; self.staged=False; self.fail_submit=fail_submit
        self.receipts=[]
    def session(self): return nullcontext()
    def open_chat(self, account, existing_only=False): self.existing_only=existing_only
    def restore_receipt_boundary(self, before): pass
    def select_and_read(self, target): return self.before
    def read_chat(self, target, receipt=False):
        return self.after if receipt or (self.staged and self.stage_change) else self.before
    def require_empty_composer(self):
        if self.composer_text().strip(): raise Halt('HUMAN_DRAFT','已有人工草稿')
    def composer_text(self): return ""
    def require_staged_text(self, text): pass
    def stage_text(self, text): self.staged=True
    def prepare_resume(self, request=None): pass
    def prepare_text_submit(self, text): pass
    def guard(self): pass
    def pending_pause(self): return {}
    def submit(self, action, before=None):
        self.submissions+=1
        if self.fail_submit: raise RuntimeError("submission interrupted")
    def save_receipt(self, *args):
        self.receipts.append(args)
        return {"before": "encrypted", "after": "encrypted"}


class WorkerTests(unittest.TestCase):
    def test_only_explicit_once_token_can_open_and_progress_is_not_a_result(self):
        d=FakeDriver(capture(msg('你好')))
        self.run_driver(d,operation='bootstrap',allowOpenOnce=True)
        self.assertFalse(d.existing_only)
        self.run_driver(d,operation='bootstrap')
        self.assertTrue(d.existing_only)
        self.run_driver(d,operation='prepare',allowOpenOnce=True)
        self.assertTrue(d.existing_only)
        events=[]
        def opening(account,existing_only=False):
            d.report(stage='LIST_READY_NO_SELECTION',observedAt=1000,detail='列表已加载')
        d.open_chat=opening
        serve(self.request(operation='bootstrap'),d,lambda _:None,events.append)
        self.assertEqual([e['phase'] for e in events],['progress','result'])

    def test_background_rule_and_readonly_receipt_never_open_a_new_page(self):
        before=capture(msg('发一份简历'))
        for extra in [dict(operation='discover'),dict(operation='reconcile'),
                      dict(operation='inspect',existingChatOnly=True),dict(resumeRule=True)]:
            d=FakeDriver(before)
            self.run_driver(d,**extra)
            self.assertTrue(d.existing_only)

    def test_resume_rule_is_independent_of_a_prior_text_reply_and_never_repeats_resume(self):
        request=msg('我想要一份您的附件简历，您是否同意',kind='其他',resumeRequestPending=True)
        before=capture(request,msg('可以先了解一下','本人'))
        self.assertIsNotNone(resume_request(before))
        sent=capture(*before['messages'],msg('附件简历.pdf','本人','简历'))
        self.assertIsNone(resume_request(sent))
        resolved=capture({**request,'resumeRequestPending':False})
        self.assertIsNone(resume_request(resolved))

    def test_resume_rule_rejects_negation_nonrequests_and_sensitive_destination(self):
        for text in ['不用发简历了','已收到你的简历','简历不错','我发你一份简历','简历已收到','需要优化简历','我们需要简历归档','岗位要简历模板','要一份简历模板','岗位需要简历解析经验','能提供简历解析方案吗','开发过简历系统吗','发身份证和简历','简历发到微信','请发简历到这个邮箱']:
            self.assertIsNone(resume_request(capture(msg(text))))
        for text in ['方便发一份附件简历吗','能提供简历吗','简历发给我看看','我想要一份您的附件简历，您是否同意']:
            self.assertIsNotNone(resume_request(capture(msg(text))))

    def test_resume_rule_cannot_authorize_text_or_changed_request(self):
        before=capture(msg('发一份简历'))
        for action,descriptor in [('TEXT',resume_request(before)),('RESUME_NATIVE',{'text':'different'})]:
            d=FakeDriver(before)
            result=self.run_driver(d,expectedRound=['发一份简历'],resumeRule=True,resumeRequest=descriptor,actionType=action)
            self.assertEqual(result['outcome'],'STALE')
            self.assertEqual(d.submissions,0)
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

    def test_takeover_during_receipt_preserves_confirmed_or_unknown_result_and_stops_batch(self):
        from windows_driver import WindowsDriver
        import threading
        for confirmed in [True, False]:
            before=capture(msg("你好"),msg("什么时候到岗？"))
            after=capture(*before["messages"],msg("两周后可以到岗。","本人"))
            d=FakeDriver(before,after,fail_submit=not confirmed)
            events=WindowsDriver(threading.Event())
            original=d.submit
            def submit(action, capture=None):
                events.human.set()
                original(action,capture)
            d.submit=submit
            d.pending_pause=events.pending_pause
            result=self.run_driver(d)
            self.assertEqual(result['outcome'],'SENT_CONFIRMED' if confirmed else 'SEND_UNKNOWN')
            self.assertEqual(result['code'],'HUMAN_TAKEOVER')
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

    def test_failure_scene_is_saved_before_desktop_lock_release(self):
        d=FakeDriver(capture(msg('你好'),msg('什么时候到岗？')),fail_submit=True)
        order=[]
        @contextmanager
        def session():
            order.append('locked')
            try: yield
            finally: order.append('released')
        def failure(step):
            order.append('failure')
            return {'failure':'encrypted failure scene'}
        d.session=session;d.save_failure=failure
        result=self.run_driver(d)
        self.assertEqual(order,['locked','failure','released'])
        self.assertEqual(result['outcome'],'SEND_UNKNOWN')
        self.assertEqual(result['evidence']['failure'],'encrypted failure scene')
        self.assertEqual(d.submissions,1)

    def test_receipt_timeout_keeps_last_read_error_and_failure_scene(self):
        d=FakeDriver(capture(msg('你好'),msg('什么时候到岗？')));read=d.read_chat
        def blocked(target,receipt=False):
            if receipt:raise Halt('OCR_MISMATCH','正文被弹层遮挡')
            return read(target,receipt)
        d.read_chat=blocked;d.save_failure=lambda step:{'failure':'encrypted'}
        with patch('worker.time.monotonic',side_effect=[0,0,16]),patch('worker.time.sleep'):
            result=self.run_driver(d)
        self.assertEqual(result['outcome'],'SEND_UNKNOWN')
        self.assertIn('OCR_MISMATCH',result['detail'])
        self.assertEqual(d.submissions,1)

    def test_receipt_waits_for_list_reorder_without_submitting_twice(self):
        before=capture(msg("你好"),msg("什么时候到岗？"))
        after=capture(*before['messages'],msg("两周后可以到岗。","本人"))
        d=FakeDriver(before,after);read=d.read_chat;remaining=[True]
        def reordered(target,receipt=False):
            if receipt and remaining:
                remaining.pop()
                raise Halt('IDENTITY_AMBIGUOUS','列表正在置顶')
            return read(target,receipt)
        d.read_chat=reordered
        with patch('worker.time.sleep'):
            self.assertEqual(self.run_driver(d)['outcome'],'SENT_CONFIRMED')
        self.assertEqual(d.submissions,1)

    def test_readonly_reconciliation_never_stages_or_submits(self):
        before=capture(msg("你好"),msg("什么时候到岗？"))
        after=capture(*before['messages'],msg("两周后可以到岗。","本人"))
        d=FakeDriver(after)
        result=self.run_driver(d,operation='reconcile',receiptBefore=before)
        self.assertEqual(result['outcome'],'SENT_CONFIRMED')
        self.assertEqual(d.submissions,0);self.assertFalse(d.staged)
        self.assertEqual(len(d.receipts),1);self.assertIsNone(d.receipts[0][1])
        d.before=before
        self.assertEqual(self.run_driver(d,operation='reconcile',receiptBefore=before)['code'],'RECEIPT_UNCONFIRMED')
        self.assertEqual(d.submissions,0)
        self.assertEqual(len(d.receipts),1)  # A failed review must not replace the original before image.

    def test_persistent_ambiguous_receipt_times_out_without_retrying_submit(self):
        d=FakeDriver(capture(msg("你好"),msg("什么时候到岗？")));read=d.read_chat
        def ambiguous(target,receipt=False):
            if receipt: raise Halt('IDENTITY_AMBIGUOUS','列表未稳定')
            return read(target)
        d.read_chat=ambiguous
        with patch('worker.time.sleep'),patch('worker.time.monotonic',side_effect=[0,0,16]):
            result=self.run_driver(d)
        self.assertEqual(result['outcome'],'SEND_UNKNOWN')
        self.assertEqual(result['code'],'RECEIPT_TIMEOUT')
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
