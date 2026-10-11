# HR 托管真实验收：Codex 桌面升级后的路径恢复

## 现场与修复

扩展 1.10.13 与后端已实际恢复托管，专用聊天页沿用原标签。7 条旧受阻记录中的 6 条已读到完整聊天并进入分析；生成阶段报 `AI_GENERATION_UNAVAILABLE`。共用的 `CODEX_PATH` 指向已被桌面升级移除的 `bin/<fingerprint>/codex.exe`，因此 CLI 在启动前失败。

通过现有配置 API 只更新 `CODEX_PATH` 为已核验存在的当前桌面运行文件，原值保存在忽略目录的部署备份中。数据库 schema、模型、密钥、人物档案与沟通授权保持原值。整个检查过程未刷新或重开 BOSS 页面。

`CodexCliService` 增加恢复逻辑：当已配置的桌面版本目录失效时，从当前 Windows 用户的 `LOCALAPPDATA/OpenAI/Codex/bin` 中选择最近安装且含原生 `codex.exe` 的版本目录。范围限定为 16 位指纹目录，忽略符号链接、不完整目录和旧的未分版本启动文件。仍存在的已配置文件继续优先使用；缺失的自定义路径继续报错。

## 验证与交付

```powershell
.\gradlew.bat test --tests '*CodexCliServiceTest' --tests '*CodexCliOutcomeTest' --tests '*ConfigServiceTest' --tests '*AiServiceConfigTest' bootJar --no-daemon
```

本地 37 项测试中 36 通过、1 项按平台跳过，构建通过。新增回归验证旧版本被移除后的恢复、有效的显式路径、缺失的自定义路径和不完整安装。完整 CI 通过后按主线 PR 流程合并，沿用已有 RunDock Backend 与原数据库部署。

首次 Windows CI 的 20 项离线浏览器测试中，1 项在静态岗位夹具的 `navigate` 等待全页 `load` 事件时超时。该夹具需要的是正文 DOM 和采集脚本；修改为等待 `DOMContentLoaded`，继续保留采集脚本就绪检查与完整流程断言，且所有真实招聘网络请求仍受拦截与禁止外连约束。

调整后本地 `./gradlew.bat browserRegressionTest --no-daemon` 的 20 项离线浏览器回归全部通过。

真实消息生成、审核及发送仍须以恢复后的数据库与聊天回执核验；连接正常和构建成功不代表已经发送。4 条历史 `SEND_UNKNOWN` 保持冻结；1 条历史身份未解决记录继续保留人工边界。

## 文件与回滚

- `src/main/java/com/getjobs/application/service/CodexCliService.java`
- `src/test/java/com/getjobs/application/service/CodexCliServiceTest.java`
- `src/test/java/com/getjobs/application/FullPipelineBrowserRegressionTest.java`
- 本交付记录

业务代码回滚基准为 `3c88445fe0c785ae5d9562f0575b80db0c2c6ca6`，通过正常回滚 PR 撤销本次代码；本次没有新增迁移。当前有效的 Codex 路径可以保留。原路径已不存在，恢复原配置会再次阻止 AI 启动，不能作为可用运行方案。保留数据库与所有聊天、建议、命令及未知发送历史。
