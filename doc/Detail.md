# 旧版环境配置说明

> 这是一份旧版环境配置文档。当前项目已经整理出新的使用和开发入口，建议优先阅读：

- [使用指南](使用指南.md)
- [开发指南](开发指南.md)
- [文档索引](文档索引.md)

## 当前推荐环境

- JDK 21
- Gradle Wrapper
- Node.js 20.19 或更高版本
- pnpm
- Playwright for Java

## 当前推荐启动方式

后端：

```bash
./gradlew bootRun
```

如果 macOS 或 Linux 提示 `permission denied: ./gradlew`，可先执行：

```bash
chmod +x gradlew
```

或者临时使用：

```bash
sh gradlew bootRun
```

前端：

```bash
cd front
pnpm install
pnpm dev
```

访问：

```text
http://localhost:6866
```

## 旧内容说明

旧版文档曾包含 Maven、JDK17 截图和部分早期路径说明。当前项目实际使用 Gradle、JDK 21 和 `com.getjobs` 包结构，因此旧内容已不再作为主文档保留。
