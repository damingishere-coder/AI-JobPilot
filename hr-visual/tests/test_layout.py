import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from windows_driver import WindowsDriver
from core import Halt, ocr_supports

def node(text,kind,cls,rect):
    return {"text":text,"type":kind,"class":cls,"box":rect}

class LayoutTests(unittest.TestCase):
    def test_resume_prefers_specific_card_and_ignores_phone_agree(self):
        d=WindowsDriver(threading.Event());d.chat_box=(400,0,1600,1000)
        nodes=[node('','ListItem','message-item item-friend',(450,50,1500,300)),
               node('我想要一份您的附件简历，您是否同意','Text','message-card-top-title',(550,60,950,130)),
               node('','Group','card-btn',(750,150,900,210)),node('同意','Text','',(790,160,850,200)),
               node('','ListItem','message-item item-friend',(450,320,1500,600)),
               node('我想要您的电话，您是否同意','Text','message-card-top-title',(550,340,950,420)),
               node('','Group','card-btn',(750,450,900,510)),node('同意','Text','',(790,460,850,500)),
               node('发简历','Text','',(700,900,800,930))]
        with patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes):
            d.prepare_resume()
        self.assertEqual(d.resume_confirm,(790,160,850,200))
        with patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes):
            d.prepare_resume({'text':'请发一份简历','type':'文本','time':'今天'})
        self.assertEqual(d.resume_confirm,(700,900,800,930))
    def test_selected_company_is_reread_and_duplicate_selection_stops(self):
        driver=WindowsDriver(threading.Event())
        nodes=[node("","Group","friend-content selected",(0,0,400,100)),
               node("张女士","Text","",(10,10,80,30)),node("甲公司","Text","",(85,10,180,30))]
        target={"hrName":"张女士","companyName":"甲公司"}
        self.assertEqual(driver._selected_identity(nodes,target),target)
        nodes[-1]["text"]="乙公司"
        with self.assertRaises(Halt): driver._selected_identity(nodes,target)
        nodes[-1]["text"]="甲公司";nodes.append(nodes[0].copy())
        with self.assertRaises(Halt): driver._selected_identity(nodes,target)

    def test_request_card_buttons_are_not_hr_words_at_multiple_scales(self):
        for scale in (.8,1,1.75,2):
            def n(text,kind,cls,rect): return node(text,kind,cls,tuple(round(v*scale) for v in rect))
            nodes=[n("我想要简历拒绝同意","ListItem","message-item item-friend",(0,0,600,220)),
                   n("我想要简历","Text","message-card-top-title message-card-top-text",(60,30,400,70)),
                   n("","Group","card-btn",(60,100,130,150)),n("拒绝","Text","",(70,110,120,140)),
                   n("","Group","card-btn",(160,100,230,150)),n("同意","Text","",(170,110,220,140))]
            result=WindowsDriver(threading.Event())._messages(nodes,(0,0,round(700*scale),round(300*scale)))
            self.assertEqual(result[0]["text"],"我想要简历")
            self.assertEqual(result[0]["from"],"对方")

    def test_blurry_media_and_blank_body_fail_closed(self):
        d=WindowsDriver(threading.Event())
        with self.assertRaises(Halt):d._messages([],(0,0,800,600))
        nodes=[node("图片","ListItem","message-item item-friend",(0,0,600,300)),
               node("图片","Text","",(10,10,40,30)),node("","Image","",(20,50,350,250))]
        with self.assertRaises(Halt):d._messages(nodes,(0,0,800,600))

    def test_delivery_badge_is_excluded_but_same_words_in_message_are_preserved(self):
        nodes=[node("送达送达","ListItem","message-item item-myself",(0,0,600,200)),
               node("送达","Text","",(400,50,460,80)),
               node("","Group","message-status status-delivery",(300,100,350,140)),
               node("送达","Text","",(305,105,345,135))]
        result=WindowsDriver(threading.Event())._messages(nodes,(0,0,800,600))
        self.assertEqual(result[0]['text'],'送达')
        self.assertFalse(result[0]['failed'])
        self.assertFalse(result[0]['pending'])

    def test_ocr_visibility_check_rejects_prefix_and_short_glyph_loss(self):
        self.assertTrue(ocr_supports("你好","你 好"))
        self.assertFalse(ocr_supports("你好","好"))
        self.assertFalse(ocr_supports("您好，请介绍这个岗位的完整职责以及日常工作安排","您好，请介绍这个岗位"))

    def test_failure_and_sending_icons_are_not_success_without_status_text(self):
        for cls,flag in (("send-failed","failed"),("message-failed","failed"),("status error","failed"),("sending","pending")):
            nodes=[node("您好","ListItem","message-item item-myself",(0,0,600,200)),
                   node("您好","Text","",(400,50,460,80)),node("","Group",cls,(360,50,390,80))]
            result=WindowsDriver(threading.Event())._messages(nodes,(0,0,800,600))
            self.assertTrue(result[0][flag])

if __name__=='__main__': unittest.main()
