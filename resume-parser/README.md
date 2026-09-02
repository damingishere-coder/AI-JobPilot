# 本地简历识别器

后端通过无 shell 子进程调用该目录中的 Docling + RapidOCR 解析器。原文件仅写入系统临时目录，请求结束时清理。

首次使用前，在项目根目录运行：

```powershell
.\resume-parser\setup.ps1
```

该命令创建项目内隔离的 `.venv`，安装固定版本依赖，并把模型预先准备到 `.resume-models`。正式解析阶段强制使用离线模型缓存，不会在上传简历时自行联网。

旧版 `.doc` 需要本机已安装 LibreOffice；普通 `.docx` 不需要。
