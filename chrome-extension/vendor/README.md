# js-sha256

同步 SHA-256 指纹使用官方 `js-sha256` 1.0.0 的浏览器 UMD 文件，未修改上游实现。比较键使用摘要，避免额外保存完整筛选配置串；采集执行所需的原配置仍沿用既有断点结构，这不代表整个任务配置已加密。

- 上游：https://github.com/emn178/js-sha256
- 固定标签：`v1.0.0`，提交 `9a54fb31d4594762987e1b5d175265f6bac921de`
- 官方 npm 包：https://registry.npmjs.org/js-sha256/1.0.0
- 来源文件：`package/build/sha256.js`
- 许可证：MIT，见 `js-sha256-LICENSE.txt`
- 包下载时核对 npm `dist.integrity`；文件 SHA-256：`d14e31deaf7b7c3a4a89035b32db12a6b7b92b1b91486fa58a8f107397639027`

升级时核对来源、许可证、校验值及 UTF-8 / 多分块标准向量，更新实际浏览器初始化回归。旧明文比较键仅在内存转换以兼容已保存进度，不批量删除旧记录。
