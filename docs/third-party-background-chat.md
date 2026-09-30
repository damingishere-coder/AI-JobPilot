# BOSS 后台托管的参考代码与许可

核对日期：2026-09-30。后台托管复用当前 Chrome Bridge 和求职者聊天页面，不引入第三方账号、远程聊天服务或整套自动投递程序。后台运行仍须通过本项目的资料授权、独立审核、会话身份复核、持久发送步骤及真实新增本人消息回执。

## 采用的实现范围

`2bebetter/boss-job-helper` 的 `HRHandler.setupMessageObserver` 提供了已有聊天容器上的 DOM 变化观察思路。本项目只将观察器的断开、重新绑定和 `childList/subtree` 观察配置用于提醒既有巡检调度器检查消息；发送、事实判断、授权和去重沿用本项目实现。

- 固定提交：`ad70c21ad60e23a4cbb9b4ca5adf5d185e3b7796`
- [相关原始代码](https://github.com/2bebetter/boss-job-helper/blob/ad70c21ad60e23a4cbb9b4ca5adf5d185e3b7796/job-helper.user.js#L2627-L2650)
- [原始 MIT License](https://github.com/2bebetter/boss-job-helper/blob/ad70c21ad60e23a4cbb9b4ca5adf5d185e3b7796/LICENSE)
- 保留的版权通知：`Copyright (c) 2026 2bebetter`

没有采用其“只处理最新会话”、仅内存去重、点击后直接返回发送成功的逻辑。DOM 发生变化不代表读取完整，也不代表消息已发送。

## 其他已核对的项目

| 项目及固定提交 | 许可证 | 可参考内容及适配边界 |
| --- | --- | --- |
| [as161233574-alt/boss-zhipin-bot](https://github.com/as161233574-alt/boss-zhipin-bot/blob/4f62a113de42fa3e8b14d243b4f7d2de45dfd732/boss_app/services/automation.py#L779-L987) · `4f62a113de42fa3e8b14d243b4f7d2de45dfd732` | [MIT](https://github.com/as161233574-alt/boss-zhipin-bot/blob/4f62a113de42fa3e8b14d243b4f7d2de45dfd732/LICENSE) | 求职者会话列表、聊天 DOM 与系统消息识别。默认 Firefox 有界面模式；按 HR 名字关联、前 20 字匹配回执及失败后再按 Enter 的逻辑不适合直接用于本项目。 |
| [ufownl/auto-zhipin](https://github.com/ufownl/auto-zhipin/blob/09e6af1ab35e8dd2ea420e860fccc4b95642223c/boss_zhipin.py#L40-L59) · `09e6af1ab35e8dd2ea420e860fccc4b95642223c` | [BSD-3-Clause](https://github.com/ufownl/auto-zhipin/blob/09e6af1ab35e8dd2ea420e860fccc4b95642223c/LICENSE) | 有无界面浏览器扫码回调，但主体为岗位查询、投递，不是连续聊天回复。本次没有引入其 runner 或登录状态导出逻辑。 |

招聘者端的候选人搜索、批量招呼项目不作为本次求职者聊天托管实现依据。README 的自动化声明也不视为本机实测验收。

## Chrome 后台运行依据

- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)：内容脚本读取已绑定页面的 DOM，扩展后台通过指定标签消息通信；运行不需要系统鼠标键盘或前台窗口。
- [Service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：扩展后台会休眠，状态需要持久保存，重新唤醒后校验现有账号、页面和运行记录。
- [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)：低频巡检可唤醒扩展；Chrome 120 起最短 30 秒周期，但执行可能延迟。每次后台启动应检查并恢复既有 alarm，不能只依赖内存定时器或新版专有的跨会话选项。
- [Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)：`autoDiscardable=false` 用于防止资源不足时自动丢弃托管标签，停止时恢复原值；它不保证标签不会被冻结。
- [省电冻结](https://developer.chrome.com/blog/freezing-on-energy-saver)：冻结会暂停事件、定时器和 Promise。页面被冻结、被丢弃、关闭或进入账号验证时，状态需要明确展示阻塞，不能通过自动激活窗口满足运行条件。

真实验收需分别确认：后台收到消息、完整读取、单次发送和新增本人消息回执，以及当前活跃标签和前台窗口没有被改变。扩展返回 `STARTING`、授权 `enabled=true`、HTTP 成功或构建通过都不是“正在托管”的单独证据。

## MIT License — 2bebetter/boss-job-helper

```text
MIT License

Copyright (c) 2026 2bebetter

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
