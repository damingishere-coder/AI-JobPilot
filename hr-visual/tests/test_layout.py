import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from windows_driver import WindowsDriver
from core import Halt, ocr_supports

def node(text,kind,cls,rect):
    return {"text":text,"type":kind,"class":cls,"box":rect,"control":Mock()}

class LayoutTests(unittest.TestCase):
    def test_search_job_excludes_contact_rows_behind_popup(self):
        d=WindowsDriver(threading.Event());d.window=Mock()
        popup=node('HR公司职位:产品经理','ListItem','search-list',(0,35,300,130))
        label=node('职位:','Text','',(20,80,75,100));job=node('产品经理','Text','',(75,80,200,100))
        scope=[node('公司','Text','',(100,50,170,70)),label,job]
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),popup,*scope,
               node('背景公司','Text','',(180,85,260,105))]
        capture={'hrName':'HR','companyName':'公司','jobName':'产品经理','contextComplete':True,'messages':[{'from':'对方','text':'你好'}]}
        def read_nodes(root=None):return scope if root is popup['control'] else nodes
        with patch.dict(sys.modules,{'pywinauto.keyboard':Mock()}),patch('windows_driver.box',return_value=(0,0,1000,800)),patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_click'),patch.object(d,'_nodes',side_effect=read_nodes) as read,patch.object(d,'read_chat',return_value=capture):
            self.assertEqual(d.select_and_read({'hrName':'HR','companyName':'公司'}),capture)
        self.assertEqual(d.selected_job,'产品经理')
        self.assertIn(((popup['control'],),{}),[(c.args,c.kwargs) for c in read.call_args_list])

    def resume_popup(self, kind='Group'):
        control=Mock();control.iface_selection_item.CurrentIsSelected=True
        return [node('',kind,'choose-resume-dialog',(300,200,900,650)),
                node('简历.pdf','Text','',(350,300,650,330)),
                node('发送','Hyperlink','btn-sure-v2 btn-confirm',(650,550,850,610)),
                node('发送','Button','',(1000,800,1100,850)),
                {**node('','RadioButton','',(320,270,800,380)),'control':control}]

    def test_web_resume_chooser_is_scoped_and_requires_unique_file(self):
        for kind in ('Group','Pane','Dialog'):
            nodes=self.resume_popup(kind)
            self.assertEqual(WindowsDriver._resume_choice(nodes),('简历.pdf',(350,300,650,330),(650,550,850,610)))
            with self.assertRaises(Halt):
                WindowsDriver._resume_choice(nodes+[node('第二份.pdf','Text','',(350,350,650,380))])
            with self.assertRaises(Halt):WindowsDriver._resume_choice(nodes[:2]+nodes[3:])
        self.assertIsNone(WindowsDriver._resume_choice(self.resume_popup()[1:]))
        with self.assertRaises(Halt):WindowsDriver._resume_choice(self.resume_popup()[:-1])
        nodes=self.resume_popup();nodes[-1]['control'].iface_selection_item.CurrentIsSelected=False
        with self.assertRaises(Halt):WindowsDriver._resume_choice(nodes)
        nodes=self.resume_popup();nodes[1]['box']=(350,400,650,430)
        with self.assertRaises(Halt):WindowsDriver._resume_choice(nodes)

    def test_delayed_web_chooser_confirms_once_after_five_seconds(self):
        d=WindowsDriver(threading.Event());d.resume_confirm=(100,700,200,730)
        before={'hrName':'王女士','companyName':'甲公司','messages':[]}
        popup=self.resume_popup();toolbar=Mock();toolbar.window_text.return_value='发简历'
        button=Mock();button.window_text.return_value='发送'
        desktop=Mock();desktop.Desktop.return_value.from_point.side_effect=[toolbar,button]
        with patch.dict(sys.modules,{'pywinauto':desktop}),patch.object(d,'prepare_resume'),patch.object(d,'_click') as click,patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=[[],popup,popup]),patch.object(d,'read_chat',return_value=before),patch('windows_driver.box',return_value=(650,550,850,610)),patch('windows_driver.time.monotonic',side_effect=[0,0,1,2]),patch('windows_driver.time.sleep') as sleep:
            d.submit('RESUME_NATIVE',before)
        self.assertEqual([x.args[0] for x in click.call_args_list],[(100,700,200,730),(650,550,850,610)])
        self.assertEqual(sleep.call_args_list[-1].args[0],3)

    def test_chooser_change_or_source_change_never_clicks_confirmation(self):
        d=WindowsDriver(threading.Event());d.resume_confirm=(100,700,200,730)
        before={'hrName':'王女士','companyName':'甲公司','messages':[]}
        popup=self.resume_popup();changed=self.resume_popup();changed[1]['text']='另一份.pdf'
        desktop=Mock();desktop.Desktop.return_value.from_point.return_value.window_text.return_value='发简历'
        for source,nodes in (({**before,'messages':[{'text':'新消息'}]},popup),(before,changed)):
            with patch.dict(sys.modules,{'pywinauto':desktop}),patch.object(d,'prepare_resume'),patch.object(d,'_click') as click,patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=[popup,nodes]),patch.object(d,'read_chat',return_value=source),patch('windows_driver.time.sleep'):
                with self.assertRaises(Halt):d.submit('RESUME_NATIVE',before)
            self.assertEqual(click.call_count,1)

    def test_offscreen_contact_requires_current_header_name_and_company(self):
        d=WindowsDriver(threading.Event());d.chat_box=(400,0,1200,800)
        target={'hrName':'张女士','companyName':'甲公司'}
        header=[node('张女士','Text','',(430,10,500,40)),node('甲公司','Text','',(520,12,650,42))]
        self.assertEqual(d._selected_identity(header,target),target)
        for nodes in (header[:1],[header[0],node('乙公司','Text','',(520,12,650,42))],
                      [header[0],node('甲公司','Text','',(520,90,650,110))],header+[header[1]]):
            with self.assertRaises(Halt):d._selected_identity(nodes,target)
        conflict=[node('','Group','friend-content selected',(0,0,350,100)),node('张女士','Text','',(10,10,80,40)),node('乙公司','Text','',(100,10,200,40))]
        with self.assertRaises(Halt):d._selected_identity(header+conflict,target)

    def test_highlighted_search_name_uses_popup_not_background_row(self):
        search=(20,0,300,30);target={'hrName':'张女士','companyName':'甲公司','visualJob':'产品经理'}
        popup=node('张女士甲公司招聘职位: 产品经理','ListItem','search-list',(10,35,320,145))
        nodes=[popup,node('甲公司','Text','',(90,45,170,65)),node('产品经理','Text','',(90,100,200,125)),
               node('张女士','Text','',(40,160,100,180)),node('甲公司','Text','',(110,160,200,180))]
        self.assertEqual(WindowsDriver._search_matches(nodes,target,search),[popup])
        self.assertEqual(WindowsDriver._search_matches(nodes[1:],target,search),[])
        self.assertEqual(WindowsDriver._search_matches(nodes,{**target,'hrName':'张'},search),[])
        self.assertEqual(WindowsDriver._search_matches(nodes,{**target,'companyName':'乙公司'},search),[])
        self.assertEqual(WindowsDriver._search_matches(nodes,{**target,'visualJob':'运营'},search),[])

    def test_search_popup_keeps_duplicate_full_identities_ambiguous(self):
        search=(20,0,300,30);target={'hrName':'张女士','companyName':'甲公司'}
        nodes=[node('张女士甲公司职位: 产品','ListItem','search-list',(10,35,320,120)),node('甲公司','Text','',(90,45,170,65)),
               node('张女士甲公司职位: 运营','ListItem','search-list',(10,125,320,220)),node('甲公司','Text','',(90,135,170,155))]
        self.assertEqual(len(WindowsDriver._search_matches(nodes,target,search)),2)

    def test_search_result_without_complete_job_is_not_clicked(self):
        d=WindowsDriver(threading.Event());d.window=Mock()
        popup=node('HR公司','ListItem','search-list',(0,35,300,110))
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),popup,node('公司','Text','',(100,50,170,70))]
        with patch.dict(sys.modules,{'pywinauto.keyboard':Mock()}),patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_click') as click,patch.object(d,'_nodes',return_value=nodes):
            with self.assertRaises(Halt) as result:d.select_and_read({'hrName':'HR','companyName':'公司'})
        self.assertEqual(result.exception.code,'JOB_UNVERIFIED')
        self.assertEqual(click.call_count,1)

    def test_search_job_rejects_old_body_for_same_hr_and_company(self):
        d=WindowsDriver(threading.Event());d.chat_box=(400,0,1200,900);d.selected_job='新岗位'
        target={'hrName':'张女士','companyName':'甲公司'}
        nodes=[node('张女士','Text','',(430,10,500,40)),node('甲公司','Text','',(520,12,650,42)),
               {**node('','Edit','chat-input',(400,600,1200,850)),'control':Mock()},
               node('','Group','left-content',(430,70,850,120)),node('旧岗位','Text','',(450,80,550,105))]
        with patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes):
            with self.assertRaises(Halt) as result:d.read_chat(target)
        self.assertEqual(result.exception.code,'IDENTITY_MISMATCH')

    def test_selected_chat_scrolled_out_of_list_is_not_reported_unselected(self):
        d=WindowsDriver(threading.Event());events=[];d.report=lambda **e:events.append(e)
        nodes=[node('本人','Text','nav-figure',(0,0,100,30)),node('','Edit','boss-search-input',(0,40,300,70)),
               node('HR 公司','Group','friend-content',(0,80,300,130)),node('','Edit','chat-input',(400,600,900,800))]
        with patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes):d.wait_for_list('本人')
        self.assertEqual(events[-1]['stage'],'LIST_READY')

    def test_clipped_row_behind_fixed_filter_is_not_an_hr(self):
        d=WindowsDriver(threading.Event())
        nodes=[node('','Edit','boss-search-input',(20,0,300,30)),node('','List','',(20,45,300,70)),
               node('','Group','friend-content',(0,40,320,140)),node('未读','Text','',(40,50,90,65)),node('(34)','Text','',(95,50,140,65)),
               node('','Group','friend-content',(0,150,320,240)),node('HR','Text','',(40,160,90,180)),node('公司','Text','',(100,160,170,180))]
        with patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes):contacts=d.list_contacts(True)
        self.assertEqual([(c['hrName'],c['companyName']) for c in contacts],[('HR','公司')])

    def test_wheel_fallback_does_not_call_missing_scroll_pattern_or_claim_end(self):
        d=WindowsDriver(threading.Event());row=Mock();row.parent.return_value=None
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),{**node('HR 公司','Group','friend-content',(0,50,300,100)),'control':row}]
        contact={'hrName':'HR','companyName':'公司','previewKey':'p'}
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'list_contacts',return_value=[contact]),patch.object(d,'_wheel_contacts') as wheel:
            result=d.discover_page({'anchor':'HR|公司','keys':['HR|公司']})
        wheel.assert_called_once_with(-3)
        self.assertFalse(result['coverageComplete']);self.assertEqual(result['cursor']['scrollMode'],'WHEEL')

    def test_unresponsive_wheel_cannot_prove_list_top(self):
        d=WindowsDriver(threading.Event())
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),node('HR 公司','Group','friend-content',(0,50,300,100))]
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'_wheel_contacts'):
            with self.assertRaises(Halt) as result:d._list_to_top()
        self.assertEqual(result.exception.code,'LIST_TOP_UNVERIFIED')

    def test_long_list_upward_progress_yields_without_claiming_top(self):
        d=WindowsDriver(threading.Event())
        def rows(text):return [node('','Edit','boss-search-input',(0,0,300,30)),node('','Group','friend-content',(0,50,300,100)),node(text,'Text','',(20,55,200,75))]
        with patch('windows_driver.time.sleep'),patch('windows_driver.time.monotonic',side_effect=[0,0,19]),patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=[rows('中'),rows('下'),rows('上')]),patch.object(d,'_wheel_contacts'):
            with self.assertRaises(Halt) as result:d._list_to_top()
        self.assertEqual(result.exception.code,'LIST_TOP_SEEKING')

    def test_scroll_pattern_top_requires_readback_and_stable_contacts(self):
        d=WindowsDriver(threading.Event());row=Mock();parent=row.parent.return_value;scroll=parent.iface_scroll
        scroll.CurrentVerticallyScrollable=True;scroll.CurrentVerticalScrollPercent=50
        search=Mock();search.get_value.return_value=''
        nodes=[{**node('','Edit','boss-search-input',(0,0,300,30)),'control':search},{**node('HR 公司','Group','friend-content',(0,50,300,100)),'control':row}]
        contact={'hrName':'HR','companyName':'公司'}
        with patch('windows_driver.time.sleep'),patch('windows_driver.box',return_value=(0,0,300,500)),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'list_contacts',return_value=[contact]):
            with self.assertRaises(Halt):d.discover_page({'seekingTop':True})
            scroll.CurrentVerticalScrollPercent=0
            self.assertTrue(d.discover_page({'seekingTop':True})['listTopVerified'])
        with patch('windows_driver.time.sleep'),patch('windows_driver.box',return_value=(0,0,300,500)),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'list_contacts',side_effect=[[contact],[{**contact,'hrName':'另一个'}]]):
            with self.assertRaises(Halt):d.discover_page({'seekingTop':True})

    def test_top_checkpoint_is_resumable_without_exposing_middle_as_first_page(self):
        d=WindowsDriver(threading.Event());row=Mock();row.parent.return_value=None
        search=Mock();search.get_value.return_value=''
        nodes=[{**node('','Edit','boss-search-input',(0,0,300,30)),'control':search},{**node('HR 公司','Group','friend-content',(0,50,300,100)),'control':row}]
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'_list_to_top',side_effect=Halt('LIST_TOP_SEEKING','仍在移动')),patch.object(d,'_click') as click:
            result=d.discover_page({'seekingTop':True})
        self.assertEqual(result['contacts'],[]);self.assertFalse(result['coverageComplete']);self.assertFalse(result['listTopVerified']);click.assert_not_called()
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'_list_to_top'),patch.object(d,'list_contacts',return_value=[{'hrName':'HR','companyName':'公司'}]):
            continued=d.discover_page(result['cursor'])
        self.assertTrue(continued['listTopVerified']);self.assertFalse(continued['coverageComplete'])
        search.get_value.return_value='HR'
        with patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'_list_to_top') as top:
            with self.assertRaises(Halt):d.discover_page({'seekingTop':True})
        top.assert_not_called()

    def test_virtualized_top_detection_compares_text_not_only_rectangles(self):
        d=WindowsDriver(threading.Event())
        def rows(text):return [node('','Edit','boss-search-input',(0,0,300,30)),node('','Group','friend-content',(0,50,300,100)),node(text,'Text','',(20,55,200,75))]
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=[rows('甲'),rows('乙'),rows('甲'),rows('甲'),rows('甲'),rows('乙'),rows('甲'),rows('甲')]),patch.object(d,'_wheel_contacts') as wheel:
            d._list_to_top()
        self.assertEqual([call.args[0] for call in wheel.call_args_list],[-1,200,200,200,-1,1,1])

    def test_small_up_from_bottom_with_ignored_large_up_cannot_prove_top(self):
        d=WindowsDriver(threading.Event())
        def rows(text):return [node('','Edit','boss-search-input',(0,0,300,30)),node('','Group','friend-content',(0,50,300,100)),node(text,'Text','',(20,55,200,75))]
        snapshots=[rows(s) for s in ('底','底','中','中','中','底','中','上')]
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=snapshots),patch.object(d,'_wheel_contacts'):
            with self.assertRaises(Halt) as result:d._list_to_top()
        self.assertEqual(result.exception.code,'LIST_TOP_UNVERIFIED')

    def test_top_challenge_requires_reversible_small_movement(self):
        d=WindowsDriver(threading.Event())
        def rows(text):return [node('','Edit','boss-search-input',(0,0,300,30)),node('','Group','friend-content',(0,50,300,100)),node(text,'Text','',(20,55,200,75))]
        for ending in [('甲',),('乙','错位')]:
            snapshots=[rows(s) for s in ('甲','乙','甲','甲','甲',*ending)]
            with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=snapshots),patch.object(d,'_wheel_contacts'):
                with self.assertRaises(Halt) as result:d._list_to_top()
            self.assertEqual(result.exception.code,'LIST_TOP_UNVERIFIED')

    def test_downward_movement_without_upward_movement_cannot_prove_top(self):
        d=WindowsDriver(threading.Event())
        def rows(text):return [node('','Edit','boss-search-input',(0,0,300,30)),node('','Group','friend-content',(0,50,300,100)),node(text,'Text','',(20,55,200,75))]
        with patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=[rows('甲'),rows('乙'),rows('乙'),rows('乙')]),patch.object(d,'_wheel_contacts'):
            with self.assertRaises(Halt) as result:d._list_to_top()
        self.assertEqual(result.exception.code,'LIST_TOP_UNVERIFIED')

    def test_wheel_delta_cannot_overflow_signed_message_range(self):
        d=WindowsDriver(threading.Event())
        with patch.object(d,'guard') as guard:
            with self.assertRaises(Halt) as result:d._wheel_contacts(300)
        self.assertEqual(result.exception.code,'LIST_SCROLL_UNVERIFIED')
        guard.assert_not_called()

    def test_end_marker_must_be_in_list_not_chat_body(self):
        search=node('','Edit','boss-search-input',(0,0,300,30))
        self.assertFalse(WindowsDriver._list_end_marker([search,node('没有更多了','Text','',(500,500,600,520))]))
        self.assertTrue(WindowsDriver._list_end_marker([search,node('没有更多了','Text','',(100,500,200,520))]))

    def test_loaded_contacts_without_selection_are_not_body_loading(self):
        d=WindowsDriver(threading.Event());events=[];d.report=lambda **e:events.append(e)
        rows=[node('本人','Text','nav-figure',(0,0,100,30)),node('','Edit','boss-search-input',(0,40,300,70)),node('HR 公司','Group','friend-content',(0,80,300,130))]
        with patch.object(d,'guard'),patch.object(d,'_nodes',side_effect=[[],rows]),patch('windows_driver.time.sleep'):
            self.assertEqual(d.wait_for_list('本人'),rows)
        self.assertEqual(events[-1]['stage'],'LIST_READY_NO_SELECTION')
        self.assertEqual(events[0]['stage'],'WAITING_LIST')

    def test_failed_middle_read_resets_stability(self):
        d=WindowsDriver(threading.Event());d.window=Mock()
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),node('HR公司职位','ListItem','search-list',(0,35,300,110)),node('HR','Text','',(20,50,90,70)),node('公司','Text','',(100,50,170,70)),node('职位:','Text','',(20,80,75,100)),node('岗位','Text','',(75,80,200,100))]
        capture={'hrName':'HR','companyName':'公司','jobName':'岗位','contextComplete':True,'messages':[{'from':'对方','text':'你好'}]}
        with patch.dict(sys.modules,{'pywinauto.keyboard':Mock()}),patch('windows_driver.box',return_value=(0,0,1000,800)),patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_click'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'read_chat',side_effect=[capture,Halt('BODY_UNVERIFIED','空白'),capture,capture]) as read:
            self.assertEqual(d.select_and_read({'hrName':'HR','companyName':'公司'}),capture)
        self.assertEqual(read.call_count,4)

    def test_search_empty_middle_snapshot_resets_stability(self):
        d=WindowsDriver(threading.Event());d.window=Mock()
        popup=node('HR公司职位','ListItem','search-list',(0,35,300,110))
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),popup,node('公司','Text','',(100,50,170,70)),node('职位:','Text','',(20,80,75,100)),node('岗位','Text','',(75,80,200,100))]
        capture={'hrName':'HR','companyName':'公司','jobName':'岗位','contextComplete':True,'messages':[{'from':'对方','text':'你好'}]}
        with patch.dict(sys.modules,{'pywinauto.keyboard':Mock()}),patch('windows_driver.box',return_value=(0,0,1000,800)),patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_click') as click,patch.object(d,'_nodes',return_value=nodes),patch.object(d,'_search_matches',side_effect=[[popup],[],[popup],[popup]]) as matches,patch.object(d,'read_chat',return_value=capture):
            self.assertEqual(d.select_and_read({'hrName':'HR','companyName':'公司'}),capture)
        self.assertEqual(matches.call_count,4)
        self.assertEqual(click.call_args_list[-1].args[0],popup['box'])
        self.assertEqual(d.selected_job,'岗位')

    def test_scroll_bottom_without_end_marker_does_not_prove_coverage(self):
        d=WindowsDriver(threading.Event());parent=Mock();scroll=parent.iface_scroll
        scroll.CurrentVerticallyScrollable=True;scroll.CurrentVerticalScrollPercent=100;scroll.CurrentVerticalViewSize=25
        row=Mock();row.parent.return_value=parent
        search=node('','Edit','boss-search-input',(0,0,300,30))
        row_node={**node('HR 公司','Group','friend-content',(0,50,300,100)),'control':row}
        contact={'hrName':'HR','companyName':'公司','identityComplete':True,'previewKey':'p'}
        with patch('windows_driver.box',return_value=(0,40,300,700)),patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=[search,row_node]),patch.object(d,'list_contacts',return_value=[contact]):
            result=d.discover_page({'anchor':'HR|公司','keys':['HR|公司']})
        self.assertFalse(result['coverageComplete']);self.assertEqual(result['coverage'],'NO_PROGRESS')

    def test_disjoint_virtualized_page_is_a_coverage_gap(self):
        d=WindowsDriver(threading.Event());parent=Mock();scroll=parent.iface_scroll
        scroll.CurrentVerticallyScrollable=True;scroll.CurrentVerticalScrollPercent=30;scroll.CurrentVerticalViewSize=25
        row=Mock();row.parent.return_value=parent
        nodes=[node('','Edit','boss-search-input',(0,0,300,30)),{**node('','Group','friend-content',(0,50,300,100)),'control':row}]
        old={'hrName':'旧','companyName':'公司'};new={'hrName':'新','companyName':'公司'}
        with patch('windows_driver.box',return_value=(0,40,300,700)),patch('windows_driver.time.sleep'),patch.object(d,'guard'),patch.object(d,'_nodes',return_value=nodes),patch.object(d,'list_contacts',side_effect=[[old],[new]]):
            result=d.discover_page({'anchor':'旧|公司','keys':['旧|公司']})
        self.assertTrue(result['coverageGap']);self.assertFalse(result['coverageComplete'])

    def test_existing_only_missing_tab_stops_without_any_navigation(self):
        d=WindowsDriver(threading.Event())
        window=Mock();window.window_text.return_value='工作台 - Google Chrome';window.descendants.return_value=[]
        with patch.dict(sys.modules,{'win32gui':Mock(),'pywinauto':Mock()}), patch.object(d,'_chrome_windows',return_value=[window]), patch.object(d,'_activate') as activate:
            with self.assertRaises(Halt) as result: d.open_chat('本人',existing_only=True)
            self.assertEqual(result.exception.code,'CHAT_TAB_MISSING')
            activate.assert_not_called()

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
