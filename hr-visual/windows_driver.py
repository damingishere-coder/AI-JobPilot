"""Windows UIA/OCR driver scoped to an authenticated BOSS Chrome window.

No CDP, DOM injection, network requests, arbitrary code or page reloads.
Ambiguous accessibility/layout observations stop the operation.
"""
from __future__ import annotations
import asyncio
from contextlib import contextmanager
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import re
import threading
import time
from core import Halt, normalized, require_chat_url, stable_pair, signature, ocr_supports, explicit_resume_request


def box(control):
    r = control.rectangle()
    return (r.left, r.top, r.right, r.bottom)


def inside(child, parent):
    return child[0] >= parent[0] and child[1] >= parent[1] and child[2] <= parent[2] and child[3] <= parent[3] and child[2] > child[0] and child[3] > child[1]


class WindowsDriver:
    def __init__(self, cancelled):
        self.cancelled = cancelled
        self.hwnd = None
        self.window = None
        self.chat_box = None
        self.composer = None
        self.send_button = None
        self.resume_confirm = None
        self.approved_resume_request = None
        self.approved_text = None
        self.target = None
        self.identity = None
        self.selected_job = None
        self.round_boundary = None
        self.ocr_regions = {}
        self.baseline_images = {}
        self.human = threading.Event()
        self.hook_stop = threading.Event()
        self.report = lambda **event: None

    def progress(self, stage, detail, **extra):
        self.report(stage=stage, detail=detail, observedAt=int(time.time()*1000), **extra)

    @staticmethod
    def health():
        try:
            if os.name != "nt":
                raise Halt("WINDOWS_REQUIRED", "视觉执行器需要本机 Windows 交互桌面")
            import win32api, win32gui, win32clipboard, win32crypt, pywinauto  # noqa
            from PIL import ImageGrab  # noqa
            from winrt.windows.media.ocr import OcrEngine
            languages = [x.language_tag for x in OcrEngine.available_recognizer_languages]
            if not any(x.startswith("zh") for x in languages):
                raise Halt("OCR_UNAVAILABLE", "Windows 中文 OCR 未安装")
            return {"ok": True, "languages": languages, "detail": "Windows 视觉依赖可用"}
        except Exception as e:
            return {"ok": False, "detail": str(e)[:240]}

    @contextmanager
    def session(self):
        import win32event, win32api
        try:
            ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
        except Exception:
            pass
        if not self.health()["ok"]:
            raise Halt("DEPENDENCIES", self.health()["detail"])
        # The existing GroupBrief sender uses this same named mutex.
        lock = win32event.CreateMutex(None, False, "Local\\GroupBrief.WechatDesktopSender")
        acquired = False
        try:
            acquired = win32event.WaitForSingleObject(lock, 5000) in (0, 0x80)
            if not acquired:
                raise Halt("DESKTOP_BUSY", "群报或其他桌面发送正在执行，未操作浏览器")
            self._start_human_monitor()
            yield
        finally:
            self.hook_stop.set()
            if acquired:
                win32event.ReleaseMutex(lock)
            win32api.CloseHandle(lock)

    def _start_human_monitor(self):
        """Physical input pauses; injected worker input is ignored by the hooks."""
        ready = threading.Event()
        errors = []
        def monitor():
            import pythoncom
            from ctypes import wintypes
            user = ctypes.windll.user32
            kernel = ctypes.windll.kernel32
            hook_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
            user.SetWindowsHookExW.restype = ctypes.c_void_p
            user.SetWindowsHookExW.argtypes = [ctypes.c_int, hook_type, ctypes.c_void_p, wintypes.DWORD]
            user.CallNextHookEx.restype = ctypes.c_ssize_t
            user.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
            class Keyboard(ctypes.Structure):
                _fields_ = [("vk", wintypes.DWORD), ("scan", wintypes.DWORD), ("flags", wintypes.DWORD), ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]
            class Mouse(ctypes.Structure):
                _fields_ = [("point", wintypes.POINT), ("data", wintypes.DWORD), ("flags", wintypes.DWORD), ("time", wintypes.DWORD), ("extra", ctypes.c_size_t)]
            def keyboard(code, wparam, lparam):
                if code >= 0 and not (ctypes.cast(lparam, ctypes.POINTER(Keyboard)).contents.flags & 0x10):
                    self.human.set()
                return user.CallNextHookEx(None, code, wparam, lparam)
            def mouse(code, wparam, lparam):
                # Include physical movement; any human takeover stops before the next input.
                if code >= 0 and not (ctypes.cast(lparam, ctypes.POINTER(Mouse)).contents.flags & 1):
                    self.human.set()
                return user.CallNextHookEx(None, code, wparam, lparam)
            callbacks = [hook_type(keyboard), hook_type(mouse)]
            hooks = [user.SetWindowsHookExW(13, callbacks[0], None, 0), user.SetWindowsHookExW(14, callbacks[1], None, 0)]
            if not all(hooks):
                errors.append("无法监测人工接管")
            ready.set()
            try:
                while not self.hook_stop.wait(.02):
                    pythoncom.PumpWaitingMessages()
            finally:
                for hook in hooks:
                    if hook:
                        user.UnhookWindowsHookEx(ctypes.c_void_p(hook))
        threading.Thread(target=monitor, daemon=True).start()
        if not ready.wait(3) or errors:
            raise Halt("INPUT_MONITOR", "无法确认人工接管监测已就绪")

    def guard(self, receipt=False, check_url=True):
        import win32gui
        user = ctypes.windll.user32
        user.OpenInputDesktop.restype = ctypes.c_void_p
        desktop = user.OpenInputDesktop(0, False, 0x100)
        if not desktop:
            raise Halt("DESKTOP_LOCKED", "桌面已锁定，停止操作")
        user.CloseDesktop(ctypes.c_void_p(desktop))
        if self.hwnd and win32gui.GetForegroundWindow() != self.hwnd:
            raise Halt("FOCUS_CHANGED", "窗口焦点变化，停止操作")
        if not receipt and (self.cancelled.is_set() or self.human.is_set()):
            raise Halt("HUMAN_TAKEOVER", "收到暂停或检测到人工操作，停止自动输入")
        if self.window and check_url:
            require_chat_url(self._url())

    @staticmethod
    def _chrome_windows():
        import win32api, win32con, win32process
        from pywinauto import Desktop
        windows = []
        for window in Desktop(backend="uia").windows(class_name="Chrome_WidgetWin_1", visible_only=True):
            try:
                _, pid = win32process.GetWindowThreadProcessId(window.handle)
                handle = win32api.OpenProcess(win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, False, pid)
                try:
                    executable = win32process.GetModuleFileNameEx(handle, 0)
                finally:
                    handle.Close()
                if Path(executable).name.lower() == "chrome.exe":
                    windows.append(window)
            except Exception:
                continue
        return windows

    def _url(self):
        values = []
        for c in self.window.descendants(control_type="Edit"):
            name = c.window_text()
            if c.element_info.class_name == "OmniboxViewViews" or any(x in name for x in ("地址和搜索栏", "地址栏", "Address and search bar")):
                try:
                    values.append(c.get_value())
                except Exception:
                    pass
        if len(values) != 1 or not values[0]:
            raise Halt("URL_UNVERIFIED", "无法唯一读取 Chrome 地址栏，未继续输入")
        return values[0]

    def _activate(self, window):
        import win32gui, win32con
        if self.human.is_set() or self.cancelled.is_set():
            raise Halt("HUMAN_TAKEOVER", "人工已接管，未重新抢占窗口")
        user, kernel = ctypes.windll.user32, ctypes.windll.kernel32
        current = kernel.GetCurrentThreadId()
        attached = []
        try:
            win32gui.ShowWindow(window.handle, win32con.SW_RESTORE)
            for hwnd in (win32gui.GetForegroundWindow(), window.handle):
                tid = user.GetWindowThreadProcessId(hwnd, None)
                if tid and tid != current and tid not in attached and user.AttachThreadInput(current, tid, True):
                    attached.append(tid)
            win32gui.BringWindowToTop(window.handle)
            win32gui.SetForegroundWindow(window.handle)
            time.sleep(.15)
            if win32gui.GetForegroundWindow() != window.handle:
                raise Halt("FOCUS_CHANGED", "无法激活指定 Chrome 窗口")
        finally:
            for tid in reversed(attached):
                user.AttachThreadInput(current, tid, False)

    def open_chat(self, account, existing_only=False):
        import win32gui
        from pywinauto import Desktop
        candidates = []
        self.progress("WAITING_CHROME", "正在核对现有 Chrome 窗口")
        windows = self._chrome_windows()
        for w in windows:
            if "BOSS" in w.window_text() or "Boss" in w.window_text():
                candidates.append(w)
        if len(candidates) != 1:
            # Search existing Chrome tabs by their visible UIA names, without navigation/reload.
            tabs = []
            for w in windows:
                for tab in w.descendants(control_type="TabItem"):
                    if "BOSS直聘" in tab.window_text():
                        tabs.append((w, tab))
            if len(tabs) == 1:
                candidates = [tabs[0][0]]
                self._activate(candidates[0])
                tabs[0][1].select()
                time.sleep(3)
            elif not tabs:
                if existing_only:
                    raise Halt("CHAT_TAB_MISSING", "未找到现有 BOSS 聊天标签，已停止；不会新开、重载或刷新页面")
                active = [w for w in windows if w.handle == win32gui.GetForegroundWindow()]
                chosen = active if len(active) == 1 else windows
                if len(chosen) != 1:
                    raise Halt("CHROME_AMBIGUOUS", "无法唯一确定现有 Chrome 登录窗口")
                self.window = chosen[0];self.hwnd = self.window.handle
                self._activate(self.window);self.guard(check_url=False)
                from pywinauto.keyboard import send_keys
                # Open the fixed, user-authorized URL exactly once in the existing profile.
                send_keys("^t", pause=.05)
                send_keys("https://www.zhipin.com/web/geek/chat", with_spaces=True, vk_packet=True, pause=.01)
                send_keys("{ENTER}")
                self.progress("OPENED_ONCE", "本轮已执行一次打开动作，后续不会重新开页")
                time.sleep(3)
                candidates = chosen
            else:
                raise Halt("CHROME_AMBIGUOUS", "未找到唯一已登录的 BOSS Chrome 标签，未新建登录环境")
        self.window = candidates[0]
        self.hwnd = self.window.handle
        self._activate(self.window)
        self.guard()
        nodes = self.wait_for_list(account)
        # The old optional assistant overlay can obscure the real chat screenshot.
        toggles = [n for n in nodes if n["type"] == "Button" and n["class"] == "toggle" and n["text"] == "收起"]
        if len(toggles) == 1:
            self._click(toggles[0]["box"])
            time.sleep(.3)

    def wait_for_list(self, account):
        started = time.monotonic()
        account_seen = False
        while time.monotonic()-started < 30:
            self.guard()
            nodes = self._nodes()
            self._check_page(nodes)
            account_seen = any("nav-figure" in n["class"].split() and normalized(n["text"]) == normalized(account) for n in nodes)
            searches = [n for n in nodes if n["type"] == "Edit" and "boss-search-input" in n["class"]]
            rows = self._contact_rows(nodes) if len(searches) == 1 else []
            filtered = False
            if len(searches) == 1:
                try:
                    filtered = bool(searches[0]["control"].get_value().strip())
                except Exception:
                    pass
            if account_seen and filtered and not rows:
                self.progress("LIST_FILTERED_EMPTY", "联系人搜索当前无可见结果，尚未选择 HR")
                return nodes
            if account_seen and len(searches) == 1 and rows:
                selected = any("selected" in n["class"].split() for n in rows) or any("chat-input" in n["class"].split() for n in nodes)
                self.progress("LIST_READY" if selected else "LIST_READY_NO_SELECTION",
                              "联系人列表已加载" if selected else "联系人列表已加载，尚未选择 HR", visibleCount=len(rows))
                return nodes
            self.progress("WAITING_LIST", "等待联系人列表及登录账号可核验", elapsedSeconds=int(time.monotonic()-started))
            time.sleep(1)
        raise Halt("LIST_NOT_READY" if account_seen else "ACCOUNT_UNVERIFIED",
                   "30 秒内联系人列表未形成可核验内容" if account_seen else "30 秒内未核验当前登录账号")

    def _nodes(self):
        nodes = []
        for c in self.window.descendants():
            try:
                b = box(c)
                if (not inside(b, box(self.window)) and c.element_info.class_name != "im-list") or not c.is_visible():
                    continue
                nodes.append({"text": c.window_text(), "type": c.element_info.control_type,
                              "class": c.element_info.class_name or "", "box": b, "control": c})
            except Exception:
                continue
        return nodes

    def _selected_identity(self, nodes, target):
        selected = [n for n in nodes if "friend-content" in n["class"].split() and "selected" in n["class"].split()]
        if len(selected) != 1:
            raise Halt("IDENTITY_AMBIGUOUS", "当前选中的联系人不唯一")
        children = [n for n in nodes if n["type"] == "Text" and inside(n["box"], selected[0]["box"])]
        result = {}
        for key in ("hrName", "companyName"):
            matches = [n for n in children if normalized(n["text"]) == normalized(target[key])]
            if len(matches) != 1:
                raise Halt("IDENTITY_MISMATCH", "当前选中联系人姓名或公司与批准会话不同")
            result[key] = matches[0]["text"]
        return result

    @staticmethod
    def _check_page(nodes):
        for n in nodes:
            if n["type"] in ("Text", "Dialog") and len(n["text"]) < 160 and any(x in n["text"] for x in ("异常访问", "安全验证", "滑动验证", "操作太频繁", "账号异常", "扫码登录", "短信登录")):
                raise Halt("PLATFORM_CHECK", "页面要求登录或安全验证，停止操作")

    def _move_to(self, rect):
        self.guard()
        import win32api, win32con, win32gui
        x, y = (rect[0]+rect[2])//2, (rect[1]+rect[3])//2
        owner = win32gui.GetAncestor(win32gui.WindowFromPoint((x, y)), win32con.GA_ROOT)
        if owner != self.hwnd:
            raise Halt("OCCLUDED", "目标位置被其他窗口遮挡")
        left, top = win32api.GetSystemMetrics(76), win32api.GetSystemMetrics(77)
        width, height = win32api.GetSystemMetrics(78), win32api.GetSystemMetrics(79)
        win32api.mouse_event(0x0001 | 0x8000 | 0x4000, round((x-left)*65535/max(width-1,1)), round((y-top)*65535/max(height-1,1)))

    def _click(self, rect):
        self._move_to(rect)
        import win32api, win32con
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0)
        win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0)

    def _wheel_contacts(self, ticks):
        if not isinstance(ticks, int) or not 0 < abs(ticks) <= 200:
            raise Halt("LIST_SCROLL_UNVERIFIED", "滚轮步长超过有界范围，未滚动")
        self.guard()
        nodes = self._nodes()
        self._check_page(nodes)
        searches = [n for n in nodes if n["type"] == "Edit" and "boss-search-input" in n["class"]]
        if len(searches) != 1:
            raise Halt("LIST_UNVERIFIED", "联系人列表范围已变化，未滚动")
        rows = self._contact_rows(nodes)
        if not rows:
            raise Halt("LIST_UNVERIFIED", "没有可核验的联系人行，未移动鼠标")
        rows.sort(key=lambda n:n["box"][1])
        self._move_to(rows[len(rows)//2]["box"])
        self.guard()
        import win32api, win32con
        win32api.mouse_event(win32con.MOUSEEVENTF_WHEEL, 0, 0, 120*ticks, 0)

    def _list_to_top(self):
        def snapshot():
            nodes = self._nodes()
            return [(tuple(n["text"] for n in nodes if n["type"] == "Text" and inside(n["box"],row["box"])),row["box"])
                    for row in self._contact_rows(nodes)]
        self.progress("DISCOVERING", "核验列表滚轮有效性与顶部位置")
        before = snapshot()
        self._wheel_contacts(-1)
        time.sleep(1)
        after = snapshot()
        moved_up = False
        if before == after:
            self._wheel_contacts(1)
            time.sleep(1)
            after = snapshot()
            if after == before:
                raise Halt("LIST_TOP_UNVERIFIED", "滚轮未产生可核验的列表变化，不能确认顶部")
            moved_up = True
        previous = after
        stable = 0
        deadline = time.monotonic()+18
        while time.monotonic() < deadline:
            # Returning upward does not enumerate candidates. A bounded large wheel
            # delta stays inside the signed 16-bit WM_MOUSEWHEEL range.
            self._wheel_contacts(200)
            time.sleep(1)
            self.guard()
            current = snapshot()
            moved_up = moved_up or bool(current and current != previous)
            stable = stable+1 if current and current == previous else 0
            if stable >= 2:
                if not moved_up:
                    raise Halt("LIST_TOP_UNVERIFIED", "向上滚轮未产生可核验的变化，不能把静止视口当作顶部")
                # A stopped large wheel may be ignored rather than at the boundary.
                # Prove a reversible small movement and then the upper boundary.
                self._wheel_contacts(-1)
                time.sleep(1)
                below = snapshot()
                if not below or below == current:
                    raise Halt("LIST_TOP_UNVERIFIED", "顶部回检无法向下移动，滚轮响应不可核验")
                self._wheel_contacts(1)
                time.sleep(1)
                if snapshot() != current:
                    raise Halt("LIST_TOP_UNVERIFIED", "顶部回检未返回原列表位置，不能确认覆盖起点")
                self._wheel_contacts(1)
                time.sleep(1)
                if snapshot() != current:
                    raise Halt("LIST_TOP_UNVERIFIED", "列表仍可向上移动，尚未到达顶部")
                return
            previous = current
        raise Halt("LIST_TOP_UNVERIFIED", "向上滚动后未核验列表顶部，保留现场等待恢复")

    @staticmethod
    def _list_end_marker(nodes):
        searches = [n for n in nodes if n["type"] == "Edit" and "boss-search-input" in n["class"]]
        if len(searches) != 1:
            return False
        left = searches[0]["box"]
        return any(n["type"] == "Text" and left[0]-30 <= n["box"][0] < left[2]+30 and n["box"][1] > left[3]
                   and re.fullmatch(r"(?:没有更多(?:联系人)?(?:了)?|暂无更多|已经到底|到底了|全部加载完)[！!。.]?", n["text"].strip()) for n in nodes)

    def select_and_read(self, target):
        self.target = target
        self.selected_job = None
        self.progress("SELECTING_HR", "正在定位 HR 和完整公司", hrName=target["hrName"], companyName=target["companyName"])
        nodes = self._nodes()
        self._check_page(nodes)
        searches = [n for n in nodes if n["type"] == "Edit" and ("联系人" in n["text"] or "boss-search-input" in n["class"])]
        if len(searches) != 1:
            raise Halt("LIST_UNVERIFIED", "联系人列表范围无法唯一确认")
        search = searches[0]["box"]
        # Native contact search reaches off-screen/virtualized rows without page navigation.
        self._click(search)
        from pywinauto.keyboard import send_keys
        escaped = "".join("{"+c+"}" if c in "+^%~(){}" else c for c in target["hrName"])
        send_keys("^a"); send_keys(escaped, with_spaces=True, vk_packet=True, pause=.02)
        time.sleep(3)
        self.guard()
        nodes = self._nodes()
        self._check_page(nodes)
        names = [n for n in nodes if n["type"] == "Text" and normalized(n["text"]) == normalized(target["hrName"])
                 and search[0]-30 <= n["box"][0] < search[2] and n["box"][1] > search[3]]
        matched = []
        for name in names:
            companies = [n for n in nodes if n["type"] == "Text" and normalized(n["text"]) == normalized(target["companyName"])
                         and abs(n["box"][1]-name["box"][1]) < max(20, name["box"][3]-name["box"][1])
                         and search[0] <= n["box"][0] < search[2]]
            if len(companies) == 1:
                matched.append((name, companies[0]))
        if len(matched) != 1:
            raise Halt("IDENTITY_AMBIGUOUS", "列表中未找到姓名和完整公司均唯一匹配的会话")
        name, company = matched[0]
        self.chat_box = (search[2]+4, search[1], box(self.window)[2], box(self.window)[3])
        self._click(name["box"])
        self.progress("WAITING_BODY", "已点击目标联系人，等待正文核验", hrName=target["hrName"], companyName=target["companyName"])
        time.sleep(3)
        deadline = time.monotonic()+17
        previous = None
        last_error = None
        while time.monotonic() < deadline:
            self.progress("WAITING_BODY", "正在核对连续两次完整正文", elapsedSeconds=max(3, int(20-(deadline-time.monotonic()))),
                          hrName=target["hrName"], companyName=target["companyName"])
            try:
                capture = self.read_chat(target)
                if previous and stable_pair(previous, capture):
                    self.progress("BODY_VERIFIED", "身份和完整正文连续两次核验一致", hrName=target["hrName"], companyName=target["companyName"])
                    return capture
                previous = capture
            except Halt as error:
                previous = None
                last_error = error
                if error.code in ("HUMAN_TAKEOVER", "FOCUS_CHANGED", "DESKTOP_LOCKED", "PLATFORM_CHECK", "CANCELLED"):
                    raise
                self.progress("WAITING_BODY", str(error), errorCode=error.code)
            time.sleep(1)
        raise last_error or Halt("BODY_NOT_READY", "20 秒内未读到连续稳定且完整的聊天正文，没有刷新页面")

    def list_contacts(self, include_unverified=False):
        self.guard()
        nodes = self._nodes()
        self._check_page(nodes)
        contacts = []
        for row in self._contact_rows(nodes):
            texts = [n for n in nodes if n["type"] == "Text" and n["text"] and inside(n["box"], row["box"])]
            names = [n for n in texts if not re.fullmatch(r"\d+|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|今天|昨天|前天", n["text"])]
            if len(names) < 2:
                if include_unverified:
                    contacts.append({"hrName":names[0]["text"] if names else "未识别联系人", "companyName":"", "identityComplete":False, "previewKey":hashlib.sha256(row["text"].encode()).hexdigest()})
                continue
            first = min(names, key=lambda n:(n["box"][1],n["box"][0]))
            heading = sorted([n for n in names if abs(n["box"][1]-first["box"][1]) < max(12, first["box"][3]-first["box"][1])],key=lambda n:n["box"][0])
            if len(heading) < 2:
                if include_unverified:
                    contacts.append({"hrName": first["text"], "companyName": "", "identityComplete": False, "previewKey": hashlib.sha256(row["text"].encode()).hexdigest()})
                continue
            hr,company = heading[:2]
            complete = not any("…" in n["text"] or "..." in n["text"] for n in heading[:2])
            if not complete and not include_unverified:
                continue
            material = "|".join(n["text"] for n in texts)
            contacts.append({"hrName":hr["text"],"companyName":company["text"], "identityComplete":complete, "previewKey":hashlib.sha256(material.encode()).hexdigest()})
        unique = {(c["hrName"],c["companyName"]):c for c in contacts}
        if len(unique) != len(contacts):
            raise Halt("IDENTITY_AMBIGUOUS", "联系人存在同名同公司重复项，未开始简历巡检")
        return contacts

    @staticmethod
    def _contact_rows(nodes):
        searches = [n for n in nodes if n["type"] == "Edit" and "boss-search-input" in n["class"]]
        if len(searches) != 1:
            raise Halt("LIST_UNVERIFIED", "联系人列表范围不可唯一核验")
        left = searches[0]["box"]
        cutoff = left[3]
        # Chrome exposes clipped rows behind the fixed filter bar as visible UIA nodes.
        # Exclude them before geometric text grouping, or '未读(34)' becomes a fake HR.
        for n in nodes:
            if n["type"] == "List" and left[0]-40 <= n["box"][0] and n["box"][2] <= left[2]+40 \
                    and left[3] <= n["box"][1] < left[3]+3*(left[3]-left[1]) \
                    and n["box"][3]-n["box"][1] <= 2*(left[3]-left[1]):
                cutoff = max(cutoff, n["box"][3])
        return [n for n in nodes if "friend-content" in n["class"].split() and n["box"][1] >= cutoff
                and left[0]-40 <= n["box"][0] < left[2] and n["box"][2] <= left[2]+40]

    def discover_page(self, cursor=None):
        """One viewport per operation. A stable bottom plus an explicit end marker proves coverage."""
        self.guard()
        nodes = self._nodes()
        searches = [n for n in nodes if n["type"] == "Edit" and "boss-search-input" in n["class"]]
        if len(searches) != 1:
            raise Halt("LIST_UNVERIFIED", "联系人搜索框不可唯一定位")
        if not cursor:
            self._click(searches[0]["box"])
            from pywinauto.keyboard import send_keys
            send_keys("^a{BACKSPACE}")
            time.sleep(3)
            nodes = self._nodes()
        rows = self._contact_rows(nodes)
        if not rows:
            raise Halt("LIST_NOT_READY", "未读到联系人行，不能认定列表为空或已完成")
        scroller = None
        control = rows[0]["control"]
        for _ in range(8):
            control = control.parent()
            if control is None:
                break
            rect = box(control)
            if rect[2] > searches[0]["box"][2]+100:
                break
            try:
                scroller = control.iface_scroll
                break
            except Exception:
                continue
        if cursor:
            current = self.list_contacts(True)
            keys = [normalized(c["hrName"])+"|"+normalized(c["companyName"]) for c in current]
            if cursor.get("anchor") not in keys:
                raise Halt("LIST_POSITION_CHANGED", "列表位置已变化，需明确恢复后重新枚举；已保存的记录保留")
            if scroller is None:
                self._wheel_contacts(-3)
            elif scroller.CurrentVerticallyScrollable:
                view = scroller.CurrentVerticalViewSize
                step = 65*view/max(1, 100-view)  # Keep 35% overlap so clipped rows become fully visible.
                scroller.SetScrollPercent(-1, min(100, scroller.CurrentVerticalScrollPercent+step))
        elif scroller is None:
            self._list_to_top()
        elif scroller.CurrentVerticallyScrollable:
            scroller.SetScrollPercent(-1, 0)
        self.progress("DISCOVERING", "逐屏读取联系人；尚未确认列表末尾")
        time.sleep(3)
        self.guard()
        contacts = self.list_contacts(True)
        nodes = self._nodes()
        end_marker = self._list_end_marker(nodes)
        keys = [normalized(c["hrName"])+"|"+normalized(c["companyName"]) for c in contacts]
        unchanged = bool(cursor) and keys == cursor.get("keys")
        at_bottom = (not scroller.CurrentVerticallyScrollable or scroller.CurrentVerticalScrollPercent >= 99.9) if scroller is not None else unchanged
        gap = bool(cursor and cursor.get("keys") and not set(keys).intersection(cursor["keys"]))
        if scroller is None and end_marker:
            self._wheel_contacts(-3)
            time.sleep(1)
            self.guard()
            probe = self.list_contacts(True)
            at_bottom = keys == [normalized(c["hrName"])+"|"+normalized(c["companyName"]) for c in probe]
        if end_marker and at_bottom:
            time.sleep(1)
            self.guard()
            stable = self.list_contacts(True)
            end_marker = self._list_end_marker(self._nodes()) and keys == [normalized(c["hrName"])+"|"+normalized(c["companyName"]) for c in stable]
        return {"contacts": contacts, "coverageComplete": bool(end_marker and at_bottom),
                "coverageGap": gap,
                "coverage": "END_CONFIRMED" if end_marker and at_bottom else "NO_PROGRESS" if unchanged else "MORE",
                "cursor": {"anchor": keys[-1] if keys else "", "keys": keys, "scrollMode": "WHEEL" if scroller is None else "UIA"}}

    def restore_receipt_boundary(self, before):
        # Resume only a previously verified complete HR round, never inferred hidden text.
        messages = before["messages"]
        end = len(messages)
        while end and messages[end-1]["from"] == "本人":
            end -= 1
        start = end
        while start and messages[start-1]["from"] == "对方":
            start -= 1
        self.round_boundary = [(m["from"],m["text"],m["time"]) for m in messages[start:end]]

    def read_chat(self, target, receipt=False, modal_recheck=False):
        self.guard(receipt=receipt)
        nodes = self._nodes()
        self._check_page(nodes)
        identity = self._selected_identity(nodes, target)
        right = [n for n in nodes if inside(n["box"], self.chat_box)]
        headers = [n for n in right if n["type"] == "Text" and normalized(n["text"]) == normalized(target["hrName"])
                   and n["box"][1] < self.chat_box[1]+140]
        if len(headers) != 1:
            raise Halt("HEADER_MISMATCH", "右侧聊天标题未匹配指定 HR")
        inputs = [n for n in right if "chat-input" in n["class"].split() and n["box"][1] > headers[0]["box"][3]+40]
        if len(inputs) != 1:
            raise Halt("COMPOSER_UNVERIFIED", "聊天输入框不可唯一定位")
        self.composer = inputs[0]["control"]
        composer_top = inputs[0]["box"][1]
        jobs = [n for n in right if n["class"] == "left-content" and n["box"][1] > headers[0]["box"][3] and n["box"][3] < composer_top]
        job_texts = [n for n in right if n["type"] == "Text" and len(jobs) == 1 and inside(n["box"],jobs[0]["box"])]
        job_texts.sort(key=lambda n:n["box"][0])
        if not job_texts:
            raise Halt("JOB_UNVERIFIED", "右侧岗位名称不可读取，未关联平台会话")
        job = job_texts[0]["text"]
        if self.selected_job is not None and job != self.selected_job:
            raise Halt("IDENTITY_MISMATCH", "当前岗位与刚才核对的会话不同")
        self.selected_job = job
        if target.get("visualJob") and normalized(job) != normalized(target["visualJob"]):
            raise Halt("IDENTITY_MISMATCH", "当前岗位与批准时的真实岗位不同")
        body = (self.chat_box[0], headers[0]["box"][3]+5, self.chat_box[2], composer_top)
        send = [n for n in right if n["text"] == "发送" and n["type"] in ("Button", "Text", "Hyperlink") and n["box"][1] >= composer_top]
        # Deduplicate accessibility wrappers for the same visible button.
        send = list({n["box"]: n for n in send}.values())
        self.send_button = None
        if len(send) == 1:
            self.send_button = send[0]["box"]
        lists = [n for n in nodes if n["type"] == "List" and n["class"] == "im-list"
                 and n["box"][0] >= self.chat_box[0] and n["box"][2] <= self.chat_box[2]]
        if len(lists) != 1 or lists[0]["box"][3] > composer_top:
            raise Halt("CONTEXT_INCOMPLETE", "消息列表底部不可见，无法确认最后一条消息")
        # Scope to the actual message list, excluding the assistant panel and toolbar.
        message_nodes = [n for n in right if inside(n["box"], lists[0]["box"])]
        messages = self._messages(message_nodes, body)
        # A fully visible preceding self-message bounds the complete unanswered HR round.
        complete = bool(messages) and (any(m["from"] == "本人" for m in messages[:-1]) or any(n["text"] in ("没有更多消息", "暂无更多消息") for n in right))
        last_hr = len(messages)
        while last_hr and messages[last_hr-1]["from"] == "本人":
            last_hr -= 1
        first_hr = last_hr
        while first_hr and messages[first_hr-1]["from"] == "对方":
            first_hr -= 1
        boundary = [(m["from"],m["text"],m["time"]) for m in messages[first_hr:last_hr]]
        if complete and self.round_boundary is None:
            self.round_boundary = boundary
        elif not complete and self.round_boundary and boundary == self.round_boundary:
            # A new own bubble may move the preceding self bubble above the viewport.
            # The entire HR round must still exactly match the earlier visible boundary.
            complete = True
        if first_hr:
            messages = messages[first_hr-1:]
        capture = {**identity, "jobName": job, "messages": messages, "contextComplete": complete}
        if modal_recheck:
            # The already OCR-verified conversation is obscured by the chooser.
            # Used only to compare the complete live UIA snapshot with that exact baseline.
            return capture
        # OCR is an independent visible-text cross-check, not a substitute for missing identity/direction.
        picture = self._screenshot(body)
        visible_text = asyncio.run(self._ocr(picture))
        end = len(messages)
        while end and messages[end-1]["from"] == "本人":
            end -= 1
        start = end
        while start and messages[start-1]["from"] == "对方":
            start -= 1
        current = messages[start:]
        if not all(ocr_supports(m["text"], visible_text) for m in current):
            # A second OCR scale handles short Chinese glyphs split at high desktop DPI.
            scaled = picture.resize((round(picture.width*.75), round(picture.height*.75)))
            alternative = asyncio.run(self._ocr(scaled))
            for m in current:
                if ocr_supports(m["text"], visible_text) or ocr_supports(m["text"], alternative):
                    continue
                region = self.ocr_regions.get(m["text"])
                if not region:
                    raise Halt("OCR_MISMATCH", "无法核验消息截图范围")
                bubble = self._screenshot(region)
                supported = False
                for scale in (.75, 1.25):
                    cropped_text = asyncio.run(self._ocr(bubble.resize((round(bubble.width*scale),round(bubble.height*scale)))))
                    if ocr_supports(m["text"], cropped_text):
                        supported = True
                        break
                if not supported:
                    raise Halt("OCR_MISMATCH", "正文可访问文本与截图识别不一致，停止发送")
        buffer = io.BytesIO();picture.save(buffer, format="PNG")
        self.baseline_images[signature(capture)] = buffer.getvalue()
        return capture

    def _messages(self, nodes, body):
        items = [n for n in nodes if n["type"] == "ListItem" and inside(n["box"], body)]
        items.sort(key=lambda n:n["box"][1])
        result = []
        for item in items:
            children = [n for n in nodes if n is not item and inside(n["box"], item["box"])]
            titles = [n for n in children if "message-card-top-title" in n["class"].split()]
            if any(n["text"] == "你与该职位竞争者PK情况" for n in titles):
                continue  # Platform promotion, not a message authored by the recruiter.
            buttons = [n["box"] for n in children if "card-btn" in n["class"].split()]
            statuses = [n["box"] for n in children if "message-status" in n["class"].split()]
            klass = item["class"]
            direction = "本人" if ("item-self" in klass or "item-myself" in klass) else "对方" if "item-friend" in klass else ""
            if not direction:
                avatars = [n for n in children if n["type"] == "Image" and 20 <= n["box"][2]-n["box"][0] <= 65 and n["box"][3]-n["box"][1] <= 65]
                left = [n for n in avatars if n["box"][0] < body[0]+100]
                right = [n for n in avatars if n["box"][2] > body[2]-100]
                if bool(left) != bool(right):
                    direction = "对方" if left else "本人"
            texts = []
            text_boxes = []
            stamp = re.match(r"((?:\d{4}[年/-])?\d{1,2}[月/-]\d{1,2}日?\s+\d{1,2}:\d{2})", item["text"])
            timestamp = stamp.group(1) if stamp else ""
            seen = set()
            for n in sorted(children,key=lambda n:(n["box"][1],n["box"][0])):
                if n["type"] != "Text" or not n["text"] or (n["text"],n["box"]) in seen:
                    continue
                if any(inside(n["box"],excluded) for excluded in buttons + statuses):
                    continue
                seen.add((n["text"],n["box"]))
                if re.fullmatch(r"(?:\d{4}年)?(?:\d{1,2}[月/-]\d{1,2}日?\s*)?\d{1,2}:\d{2}|已读|未读",n["text"]):
                    timestamp = n["text"] if ":" in n["text"] else timestamp
                else:
                    texts.append(n["text"])
                    text_boxes.append(n["box"])
            text = "\n".join(texts)
            if not text:
                continue
            self.ocr_regions[text] = (max(body[0],min(b[0] for b in text_boxes)-12),max(body[1],min(b[1] for b in text_boxes)-12),
                                      min(body[2],max(b[2] for b in text_boxes)+12),min(body[3],max(b[3] for b in text_boxes)+12))
            if not direction:
                raise Halt("DIRECTION_UNKNOWN", "正文中的消息无法确定来自 HR 还是本人")
            if any(n["type"] == "Image" and n["box"][2]-n["box"][0] > 100 for n in children):
                raise Halt("MEDIA_UNREAD", "HR 消息包含尚未完整识别的图片")
            resume_card = any(re.search(r"(?:^|[\s_-])(?:resume|attachment|file-card)(?:$|[\s_-])", n["class"], re.I) for n in children)
            kind = "简历" if direction == "本人" and resume_card and "简历" in text else "其他" if titles else "文本"
            flags = " ".join([klass]+[n["class"] for n in children])
            result.append({"from": direction, "type": kind, "text": text, "time": timestamp,
                           "resumeRequestPending": direction == "对方" and bool(titles) and explicit_resume_request(text)
                               and any(n["text"] == "同意" and any(inside(n["box"],b) for b in buttons) for n in children),
                           "failed": "发送失败" in text or bool(re.search(r"(?:^|[\s_-])(?:failed|fail|error)(?:$|[\s_-])",flags)),
                           "pending": "发送中" in text or bool(re.search(r"(?:^|[\s_-])(?:sending|pending|loading)(?:$|[\s_-])",flags))})
        if not result:
            raise Halt("BODY_UNVERIFIED", "聊天正文未形成可核验的消息列表")
        return result

    def require_empty_composer(self):
        self.guard()
        try:
            value = self.composer_text()
        except Exception as e:
            raise Halt("DRAFT_UNVERIFIED", "无法确认输入框为空，保留现有内容") from e
        if value.strip():
            raise Halt("HUMAN_DRAFT", "输入框已有草稿，未覆盖")

    def composer_text(self):
        # Chrome exposes contenteditable through TextPattern, not ValuePattern.
        value = self.composer.iface_text.DocumentRange.GetText(-1)
        return "" if value == "\ufffc" else value

    def stage_text(self, text):
        self.require_empty_composer()
        self._click(box(self.composer))
        self.guard()
        # Unicode key input preserves the user's clipboard and supports Chinese text.
        from pywinauto.keyboard import send_keys
        lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        for index,line in enumerate(lines):
            self.guard()
            if index:
                send_keys("^{ENTER}")  # BOSS uses Ctrl+Enter for a newline; Enter submits.
            escaped = "".join("{"+c+"}" if c in "+^%~(){}" else c for c in line)
            send_keys(escaped, with_spaces=True, with_newlines=False, vk_packet=True, pause=.01)
        self.require_staged_text(text)

    def require_staged_text(self, text):
        self.guard()
        if normalized(self.composer_text()) != normalized(text):
            raise Halt("DRAFT_MISMATCH", "输入后的完整正文不匹配，未点击发送")

    def prepare_text_submit(self, text):
        # An old extension panel may cover the Send button even while UIA exposes it.
        # Use the chat's native Enter action with verified editor focus instead.
        self.require_staged_text(text)
        rect = box(self.composer)
        from pywinauto import Desktop
        hit = Desktop(backend="uia").from_point((rect[0]+rect[2])//2,(rect[1]+rect[3])//2)
        if not self._within_control(hit, self.composer):
            raise Halt("COMPOSER_OCCLUDED", "聊天输入框被其他页面内容遮挡，未提交")
        self._click(rect)
        self.require_staged_text(text)
        self.require_editor_focus()
        self.approved_text = text

    def require_editor_focus(self):
        from pywinauto.uia_defines import IUIA
        from pywinauto.uia_element_info import UIAElementInfo
        from pywinauto.controls.uiawrapper import UIAWrapper
        focused = UIAWrapper(UIAElementInfo(IUIA().get_focused_element()))
        if not self._within_control(focused, self.composer):
            raise Halt("COMPOSER_FOCUS", "键盘焦点不在已核验的聊天输入框，未提交")

    @staticmethod
    def _within_control(control, expected):
        expected_id = expected.element_info.runtime_id
        if not expected_id:
            return False
        for _ in range(8):
            if control.element_info.runtime_id and control.element_info.runtime_id == expected_id:
                return True
            control = control.parent()
            if control is None:
                break
        return False

    def prepare_resume(self, request=None):
        self.approved_resume_request = request
        self.guard()
        nodes = self._nodes()
        # Bind consent to the recruiter's resume card, never to a generic Agree button.
        cards = [n for n in nodes if n["type"] == "ListItem" and "item-friend" in n["class"] and inside(n["box"],self.chat_box)]
        agree = []
        for card in cards:
            children = [n for n in nodes if inside(n["box"],card["box"])]
            titles = [n for n in children if "message-card-top-title" in n["class"].split() and explicit_resume_request(n["text"])]
            if len(titles) != 1:
                continue
            if request is not None:
                if request.get("type") != "其他" or normalized(titles[0]["text"]) != normalized(request.get("text", "")):
                    continue
                parsed = self._messages(children, self.chat_box)
                if len(parsed) != 1 or parsed[0]["time"] != request.get("time", ""):
                    continue
            buttons = [n["box"] for n in children if "card-btn" in n["class"].split()]
            agree.extend(n for n in children if n["type"] in ("Text", "Button") and n["text"] == "同意" and any(inside(n["box"],b) for b in buttons))
        if agree:
            if len(agree) != 1:
                raise Halt("RESUME_AMBIGUOUS", "简历请求卡片不唯一，未点击")
            self.resume_confirm = agree[0]["box"]
            return
        choices = [n for n in nodes if n["text"] == "发简历" and n["type"] in ("Text","Button","Hyperlink") and inside(n["box"],self.chat_box)]
        choices = list({n["box"]: n for n in choices}.values())
        if len(choices) != 1:
            raise Halt("RESUME_BUTTON", "无法唯一定位原生发简历按钮")
        # The toolbar may itself submit. Therefore it is the single submission boundary,
        # never a harmless preparation click. submit() handles a subsequent explicit dialog.
        self.resume_confirm = choices[0]["box"]

    def submit(self, action, before=None):
        if action == "TEXT":
            self.guard()
            if self.approved_text is None:
                raise Halt("DRAFT_UNVERIFIED", "缺少本次核验过的输入正文")
            self.require_staged_text(self.approved_text)
            self.require_editor_focus()
            from pywinauto.keyboard import send_keys
            send_keys("{ENTER}")
            return
        self.prepare_resume(self.approved_resume_request)
        from pywinauto import Desktop
        rect = self.resume_confirm
        hit = Desktop(backend="uia").from_point((rect[0]+rect[2])//2,(rect[1]+rect[3])//2)
        if hit.window_text() not in ("同意", "发简历"):
            raise Halt("RESUME_OCCLUDED", "简历操作位置被遮挡，未点击")
        self._click(rect)
        time.sleep(1)
        nodes = self._nodes()
        dialogs = [n for n in nodes if n["type"] == "Dialog" and "简历" in n["text"]]
        if not dialogs:
            return  # Only a new resume message can establish success.
        if len(dialogs) != 1:
            raise Halt("RESUME_AMBIGUOUS", "简历选择弹窗不唯一，需本人选择")
        dialog = dialogs[0]
        choices = [n for n in nodes if inside(n["box"],dialog["box"]) and n["type"] in ("RadioButton","ListItem")]
        if len(choices) != 1:
            raise Halt("RESUME_AMBIGUOUS", "无法确定唯一简历，未点击弹窗发送")
        files = [n for n in nodes if n["type"] == "Text" and inside(n["box"],choices[0]["box"])
                 and re.search(r"\.(?:pdf|docx?)$", n["text"], re.I)]
        if len(files) != 1:
            raise Halt("RESUME_SELECTION_REQUIRED", "无法核验唯一简历的文件名，未确认弹窗")
        buttons = [n for n in nodes if inside(n["box"],dialog["box"]) and n["type"] == "Button" and n["text"] == "发送"]
        if len(buttons) != 1 or before is None:
            raise Halt("RESUME_CONFIRM", "无法确认简历弹窗的发送按钮或原始依据")
        # No second submission if the recruiter changes the request while the chooser loads.
        time.sleep(4)  # At least five seconds since the toolbar action.
        fresh = self.read_chat(self.target, modal_recheck=True)
        if signature(fresh) != signature(before):
            raise Halt("STALE", "简历确认前聊天已变化，未点击弹窗发送")
        current = self._nodes()
        if not any(n["text"] == files[0]["text"] and n["box"] == files[0]["box"] for n in current):
            raise Halt("RESUME_CHANGED", "简历选项已变化，未确认发送")
        self._click(buttons[0]["box"])

    @staticmethod
    def _screenshot(rect):
        from PIL import ImageGrab
        return ImageGrab.grab(bbox=rect, all_screens=True)

    @staticmethod
    async def _ocr(picture):
        from winrt.windows.graphics.imaging import BitmapDecoder
        from winrt.windows.media.ocr import OcrEngine
        from winrt.windows.globalization import Language
        from winrt.windows.storage.streams import InMemoryRandomAccessStream, DataWriter
        stream = InMemoryRandomAccessStream()
        writer = DataWriter(stream)
        out = io.BytesIO();picture.save(out,format="PNG")
        writer.write_bytes(out.getvalue());await writer.store_async();await writer.flush_async();writer.detach_stream();stream.seek(0)
        decoder = await BitmapDecoder.create_async(stream)
        bitmap = await decoder.get_software_bitmap_async()
        engine = OcrEngine.try_create_from_language(Language("zh-Hans-CN"))
        if engine is None:
            raise Halt("OCR_UNAVAILABLE", "中文 OCR 不可用")
        result = await engine.recognize_async(bitmap)
        return result.text

    def save_receipt(self, step, before, after):
        import win32crypt
        if not re.fullmatch(r"[a-f0-9-]{36}",step):
            raise Halt("EVIDENCE_ID", "回执步骤编号无效")
        root = Path(os.environ.get("APP_DATA_DIR", "data"))/"hr-visual-evidence"
        root.mkdir(parents=True,exist_ok=True)
        result = {}
        for kind,capture in (("before",before),("after",after)):
            if capture is None:
                continue
            raw = self.baseline_images[signature(capture)]
            protected = win32crypt.CryptProtectData(raw,"BOSS HR visual receipt",None,None,None,0)
            path = root/f"{step}-{kind}.png.dpapi"
            path.write_bytes(protected)
            result[kind] = {"file":str(path.resolve()),"sha256":hashlib.sha256(raw).hexdigest()}
        return result
