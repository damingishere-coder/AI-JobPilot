# 版本发布与下载说明

本文说明 AI JobPilot 的版本命名、GitHub Release 产物、校验方式和发布边界。

## 当前发布状态

当前正式版为 [v1.5.0](https://github.com/damingishere-coder/AI-JobPilot/releases/tag/v1.5.0)，应用版本 **1.5.0**，配套 Chrome Bridge **1.8.0**。主要面向 Windows 本地开发与个人使用。

普通用户优先使用源码包与 [Windows 启动指南](../WINDOWS_SETUP.md)。JAR 已包含页面，前端静态 ZIP 用于独立集成，扩展 ZIP 需要在 Chrome 中单独加载；它们不是多个不同的应用版本。

### 使用 JAR 运行

需要 Java 21。新安装时，将下载的 JAR 放入你选定的独立程序文件夹，在该目录打开 PowerShell：

```powershell
New-Item -ItemType Directory -Force db,data,output,target\logs | Out-Null
$env:SERVER_ADDRESS = '127.0.0.1'
$env:SERVER_PORT = '6866'
$env:APP_AUTO_OPEN_BROWSER = 'false'
$env:APP_BROWSER_INITIALIZE_ON_STARTUP = 'false'
java -jar .\AI-JobPilot-v1.5.0.jar
```

打开 **http://127.0.0.1:6866**，检查 **http://127.0.0.1:6866/api/ready**，再配置模型与简历。该路径无需安装 Node / pnpm，但不是 Windows 安装器。基础使用可以粘贴简历；上传 PDF、Word、图片所需的 `resume-parser` 脚本、Python 环境和模型不包含在 JAR 中，需从同版本源码准备，见 [本机识别器](../resume-parser/README.md)。

把扩展 ZIP 解压到固定目录，在 `chrome://extensions/` 加载该目录。已有扩展则重新加载并刷新页面，核对扩展版本 1.8.0。

已有部署不要直接另起一个 6866 服务，也不要随意改数据库路径。先备份并沿用原管理器和配置，参考 [1.5 升级与回滚](releases/v1.5.0.md)。`v1.5.0` 标签及发行包保持不可变；发布后的文档勘误以 `main` 的最新指南为准。

仓库已发布正式版本及自动化构建产物，但还没有免运行环境的完整 Windows 桌面安装器。源码启动需要 Java、Node.js 和 pnpm；已构建 JAR 的基础运行只需 Java 21。完整 Windows 安装包仍在路线图中。

## Release 产物

正式推送符合 `v*.*.*` 的 Git 标签后，Release 工作流会先执行：

1. 前端依赖锁定安装
2. 前端 lint 与静态构建
3. Chrome 扩展清单、引用文件与 JavaScript 语法检查
4. 后端测试
5. 包含前端静态资源的 Spring Boot JAR 构建
6. 产物 SHA256 校验值生成

成功后发布以下文件：

```text
AI-JobPilot-vX.Y.Z.jar
AI-JobPilot-vX.Y.Z-chrome-extension.zip
AI-JobPilot-vX.Y.Z-frontend-static.zip
AI-JobPilot-vX.Y.Z-source.zip
SHA256SUMS.txt
```

### 后端 JAR

包含后端代码和构建时生成的前端静态资源，适合开发者进行运行验证和二次打包。

该文件目前不等同于完整桌面安装器。运行前仍需 Java 21，并需要按照项目文档准备本地配置和数据目录。

### Chrome 扩展包

解压后可在 Chrome 扩展管理页通过“加载已解压的扩展程序”进行安装。

扩展包不包含：

- 招聘平台账号
- Cookie 或 Token
- 简历
- API Key
- Chrome 用户目录

### 前端静态包

提供构建后的 Next.js 静态文件，主要用于开发验证、后端集成和部署测试。

### 源码包

由对应 Git 标签直接生成，便于确认 Release 与仓库版本一致。

## 校验下载文件

下载 Release 文件后，建议使用 `SHA256SUMS.txt` 验证完整性。

### Windows PowerShell

```powershell
Get-FileHash .\AI-JobPilot-vX.Y.Z.jar -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

将两处 SHA256 值进行对比。

### Linux / macOS

```bash
sha256sum -c SHA256SUMS.txt
```

## 版本命名

采用语义化版本：

```text
v主版本.次版本.修订版本
```

示例：

```text
v1.3.1
v1.4.0
v2.0.0
```

预发布版本可以使用：

```text
v1.4.0-rc.1
v1.4.0-beta.1
```

带有 `-rc`、`-beta` 等后缀的标签会作为 GitHub Prerelease 发布。

## 发布前检查

维护者发布版本前应确认：

- [ ] `main` 分支 CI 全部通过
- [ ] CodeQL 没有未处理的高危告警
- [ ] `CHANGELOG.md` 已更新
- [ ] `front/package.json` 与 Gradle 的应用版本一致，并记录配套 Chrome Bridge 版本（扩展独立递增，不为对齐应用而降级）
- [ ] 示例截图和文档没有 Cookie、API Key、简历或个人账号信息
- [ ] `.env`、数据库、日志和 Chrome 用户目录未进入提交
- [ ] 已知限制已写入 Release Notes
- [ ] Release 产物 SHA256 校验通过

## 手动预览构建

维护者可以在 GitHub Actions 中手动运行 `Release` 工作流并填写版本号，例如：

```text
v1.3.1-rc.1
```

手动运行只生成保留 14 天的 Actions Artifact，不会自动创建公开 Release。

只有推送正式 Git 标签时，工作流才会创建 GitHub Release。

## 安全边界

任何 Release 产物都不得包含：

- `.env` 或密钥配置
- 本地 SQLite 数据库
- 简历和用户上传文件
- 招聘平台 Cookie、Token 或聊天记录
- 浏览器缓存和 Chrome Profile
- 运行日志

发现 Release 中包含敏感信息时，应立即删除对应 Release 和标签、轮换相关密钥，并按照 `SECURITY.md` 处理。
