# Fob 开发服务

当前开发方式见 [README](../../README.md#本机开发) 与[运行架构](../../docs/architecture/fob-product-boundaries.md#运行与部署)。

## 实现

- Web 使用 Next.js dev，业务 API、协作、MCP 与作业 Worker 使用 Bun watch，由 `pnpm dev:all` 启动或复用当前仓库的常驻进程。
- `pnpm media:dev` 监听媒体包的 Python 文件，合并连续写入并顺序重启。Windows 只回收本次启动的 Python 进程树，避免隐藏会话中 Uvicorn reload 的 Ctrl+C 停止问题；保留配置白名单与凭据隔离。
- PostgreSQL、Redis、MinIO 使用 Fob 自有 Compose 项目；开发日志位于忽略目录 `.runtime/dev/`。

## 验证（2026-10-25）

- `node --check scripts/media-worker.mjs` 与该脚本的 ESLint 检查通过。
- `pnpm architecture:verify` 通过，知识空间、前端、服务端与共享契约边界保持独立。
- `knowledge-infra.mjs verify` 通过 PostgreSQL 扩展与查询、Redis 认证读写、S3 签名 PUT/GET/DELETE 检查；三个容器均 healthy。
- `pnpm database:status` 返回 ready，35 张业务表、30 张强制资源 RLS 表均符合预期。
- `pnpm dev:all` 成功复用当前仓库的 Web、业务服务与作业 Worker；Web 首页与身份健康端点返回 200。
- 媒体 `/health` 返回 200；使用当前 Fob token 的 capabilities 返回 200，缺少认证返回 401，错误处理请求返回 422。
- 修改 Python 源码时间戳后，媒体监听进程发生替换，旧进程退出，健康端点恢复 200，Node 监听器持续运行；源码内容未被修改。

## 外部依赖

- 当前媒体 capabilities 的 operations 为空；转写和文档解析仍需准备对应 Python 依赖与本地模型。本次验证服务启动、认证与源码重载，不代表真实媒体解析或模型推理验收。
