# Fob · Fusion One Book

独立的 Web 知识库与协作平台。从 Fouc 复制知识库、编辑器、身份、切换器设计、主题设置、布局与小精灵实现；拥有自己的仓库、依赖安装、账号、数据库、存储、开发服务和部署。

- [产品边界与完整拆分方案](docs/architecture/fob-product-boundaries.md)
- [实施进度与验证记录](.spec/tasks/fob-navigation-consolidation.md)
- [前端开发规则](AI_FRONTEND_RULES.md)

## 本机开发

要求 Node.js 22+、pnpm 10.29.3、Bun。基础设施使用 Docker Compose；Windows 默认通过 WSL `Ubuntu-22.04` 调用 Docker，可在生成的本机配置里指定 `KNOWLEDGE_WSL_DISTRO`。

```powershell
pnpm install --frozen-lockfile
pnpm dev:init
pnpm infra:up
pnpm database:init
pnpm knowledge:jobs:init
pnpm dev:all
```

`dev:init` 生成当前仓库自己的 `.env.fob.local` 与 Web `.env.local`，不会读取 Fouc 配置或覆盖已有本机配置值。`infra:up` 建立独立基础设施、验证数据库/Redis/存储，并在 Windows 同步 WSL 地址。`dev:all` 启动或复用当前仓库的服务，命令结束后服务继续运行并自动刷新源码；遇到其他仓库占用端口时拒绝冒用。

| 服务 | 默认地址 |
| --- | --- |
| Web | `http://127.0.0.1:3001` |
| 业务 API、协作、MCP | `http://127.0.0.1:8721` |
| PostgreSQL | 主机端口 `55433`，独立 `fob` 数据库 |
| Redis | 主机端口 `56380`，独立实例 |
| S3 / 管理台 | 主机端口 `59010` / `59011`，独立 bucket |
| Python 媒体服务（单独启动） | `http://127.0.0.1:8920` |

开发服务日志位于 `.runtime/dev/`。`FOB_DEV_WORKER=1` 启动作业消费者；完整媒体解析仍需单独启动 Python 服务，真实 AI 功能仍需配置模型。访客可直接创建浏览器本地知识库；新产品初始不包含 Fouc 用户账号或知识内容。

媒体服务在 `services/media-worker` 中建立自己的 `.venv`，安装该目录 `requirements.txt`（运行）或 `requirements-dev.txt`（测试）后，从仓库根目录运行 `pnpm media:dev`。该命令监听 `media_worker/` 下的 Python 源码并自动重启服务，Windows 后台开发会话也支持重载。启动适配只传递媒体配置，复用当前 Fob 的 token 与 S3 origin，不把数据库或模型密钥传入媒体子进程；Windows 的 WSL 存储地址也随当前配置使用。

邮箱验证未配置 SMTP 时，验证链接只写入 Fob 自己的服务日志。正式使用应设置 SMTP 和对应 OAuth 应用；注册、登录、密码恢复等复用原身份实现，Cookie 使用 `fob` 前缀。

## 代码结构

```text
src/                       Next.js Web 前端、原布局与基础交互
  features/knowledge/      完整知识库与编辑器
  features/identity/       账号与认证交互
  features/settings/       通用、外观、语言与关于
  features/companion/      原小精灵完整实现
  shell/                   导航、顶栏、页签与圆角主容器
backend/server/            TypeScript/Bun 业务服务、协作、MCP 与作业入口
shared/                    纯文档语义、协议、知识与资源契约
services/media-worker/     Python 多模态处理服务
scripts/                   独立启动、部署初始化与完整性校验
```

Fob 没有 Tauri、设备 sidecar 或对 `../fouc` 的源码/依赖链接。知识库目录直接作为唯一系统侧栏，正文不再嵌套产品导航；顶部切换器直接选择和管理知识库，库成员和全局偏好位于侧栏底部。一个知识库就是一个工作空间，只使用 `knowledgeBaseId`，不存在额外项目或项目关联。成员页面使用当前知识库的真实成员、分组和权限；本地库明确为浏览器个人资源。

## 检查与构建

```powershell
pnpm typecheck
pnpm server:typecheck
pnpm shared:typecheck
pnpm architecture:verify
pnpm i18n:verify
pnpm lint
pnpm build
pnpm server:build
```

`architecture:verify` 检查 886 个知识库/小精灵基线文件、已记录的精确产品适配及明确删除记录，以及无桌面/兄弟产品运行依赖。`.spec/source-baseline.json` 的来源提交仅用于溯源；运行校验不需要 Fouc 仓库。后续正式演进知识库时，应审阅并更新对应适配摘要与哈希，不能删除完整性保护来绕过检查。

领域测试可通过 `pnpm shared:test`、`pnpm knowledge:test`、`pnpm server:test`、`pnpm test:frontend` 执行；涉及数据库/对象存储的套件需要 Fob 自己的 `.env.fob.local`。原仓库菜单交互测试的已知失败与本次验证范围见任务记录，不能把完整矩阵记为全绿。

## 独立生产部署

前端沿用 Next.js 静态导出，`Dockerfile.web` 构建后由 Nginx 提供静态文件及 `/api`/WebSocket 反向代理；`Dockerfile.server` 提供业务服务和独立 worker，Python 服务单独构建。部署文件不引用兄弟目录。

从 `.env.example` 创建服务器自己的受保护环境文件，填写独立数据库/Redis/存储/认证密钥，以及 `FOB_PUBLIC_WEB_ORIGIN`、`FOB_PUBLIC_S3_ORIGIN`。两个公开 origin 使用 HTTPS；S3 origin 必须同时被浏览器和容器访问，并正确转发到对象存储。Web 的 API origin 在构建时固定为公开 Web origin，Nginx 将 API 和实时连接转发到业务服务。

```bash
docker compose --env-file /secure/fob.env -f compose.production.yaml up -d postgres redis minio
docker compose --env-file /secure/fob.env -f compose.production.yaml run --rm database-init
docker compose --env-file /secure/fob.env -f compose.production.yaml run --rm queue-init
docker compose --env-file /secure/fob.env -f compose.production.yaml run --rm storage-init
docker compose --env-file /secure/fob.env -f compose.production.yaml up -d --build
```

入口 TLS 由部署环境的反向代理提供；默认 Web/S3 容器端口只绑定主机 loopback。数据库运行角色为非超级用户、无 BYPASSRLS，并由独立管理员初始化表与权限。生产镜像需要实际构建运行后才能视为部署验收，配置校验不能代替这一步。

## 数据交接

本项目初始化新库，不自动复制 Fouc 账号、登录会话、令牌、密钥或用户文件。已有数据需要按[独立数据复制步骤](docs/architecture/fob-product-boundaries.md#43-现有数据的独立复制)显式交接：保持正文、历史、关系、权限与附件完整，源端只读，目标端独立授权；本机浏览器数据须跨 origin 显式导入。

Fouc 的知识库及其他功能保留原样。将来由 Fouc 的独立任务实现 Fob 连接器，经公开 API/MCP 使用 Fob；不允许两者直接互查数据库。
