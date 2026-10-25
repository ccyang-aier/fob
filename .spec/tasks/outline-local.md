# Outline 本地运行任务

当前方案：[Outline 本地源码运行](../../docs/outline-local.md)。

## 来源与边界

- 日期：2026-10-25。
- 来源：`https://github.com/outline/outline.git`，分支 `main`，提交 `f4e87b3eeef42fa998515a64fb5b47e5c9b550a3`，版本 `1.12.0`。
- 代码克隆到 `opensource/outline`，保留独立 `.git`，Fob 不提交第三方源码或凭据。
- 构建和运行使用专属 `fob-outline-local` 镜像、网络、数据库、Redis、文件卷和本地邮件服务。

## 执行门槛

- [x] 核验最新主分支并克隆源码。
- [x] 确认宿主 Node 24.16.0 低于上游要求，改用独立 Node 26.12.1 容器。
- [x] 准备独立随机密钥、本地邮箱认证及启动管理脚本。
- [x] 上游锁文件不可变安装及完整源码构建成功。
- [x] 数据库迁移、初始工作空间和服务健康检查通过。
- [x] 实际浏览器完成邮箱登录、文档创建/编辑和刷新持久化验证。
- [x] 检查未登录访问边界、独立持久化和原 Fob 服务。
- [x] 本地脚本静态检查通过。

## 验证证据

- `yarn install --immutable`：1703 个依赖安装成功，没有修改上游锁文件；上游既有 peer dependency 和禁用安装脚本提示保留。
- 完整 `yarn build`：Vite 8.3.5、5068 个前端模块、PWA、翻译和 SWC 服务端编译均成功。上游现有大 chunk 提示不影响构建。
- 镜像 `fob-outline-local:source` 的 `org.opencontainers.image.revision` 为来源提交 `f4e87b3eeef42fa998515a64fb5b47e5c9b550a3`；克隆工作树 `git status --short` 为空。
- 313 项 PostgreSQL 迁移完成；Outline、PostgreSQL、Redis、Mailpit 四个服务全部 healthy。
- Playwright 真实浏览器使用 `admin@outline.local` 请求登录邮件，在 Mailpit 内点击魔法登录链接，成功进入中文工作空间。
- 创建“Outline 本地运行验证”文档，输入正文，刷新后标题与正文保留；上传 `outline-smoke.txt`，文档中显示附件。
- 执行管理脚本 `down` 再 `up`，重建全部容器和网络后，会话仍有效，文档标题、正文、附件引用保留。认证下载附件 HTTP 200，内容与原始 49 字节文件一致。
- 重建前后均为 1 个工作空间、1 个用户、5 个文档（4 个官方入门文档与 1 个验证文档）、1 个附件；引导脚本没有重复创建记录。
- 匿名调用 `POST /api/documents.info` 返回 401，匿名读取附件返回 403。此项验证本地未登录边界，不替代上游完整权限测试矩阵。
- 重建后的独立页面控制台为 0 errors / 0 warnings；首次未登录页面的 `auth.info` 401 是认证探测。运行时上游 Node 26 的 `localStorage` 实验性提示保留。
- Outline `/_health`、Mailpit `/api/v1/info`、Fob Web 3001 与业务服务 8721 `/api/auth/ok` 均返回 HTTP 200。
- `pnpm lint` 全库检查、两个本地脚本的 `node --check`、`docker compose config --quiet`、`node scripts/verify-extraction.mjs`、`git diff --check` 全部通过。
- 截图保存于仓库外的 Codex visualizations 目录；浏览器会话、依赖、密钥和运行时文件不进入提交。

## 已发现的环境限制

- GitHub 直连源码传输停滞；使用当前系统 HTTP 代理的命令级设置后克隆成功，没有修改全局 Git 配置。
- Docker Hub 直连不可用；使用现有 Skopeo 从镜像传输导入 Node 和 Mailpit 镜像。
- Debian 软件源 HTTP 直连超时；构建使用上游已禁用安装脚本的锁定依赖和预编译工具包，不安装无须使用的系统编译工具。

首次下载遗留目录的递归清理被自动审批策略拒绝，因此保留在已忽略的 `opensource/.runtime` 内；不参与构建和提交。

本地运行环境已经验收；公网部署、外部 SMTP/OAuth 与完整上游功能矩阵不在本次验证范围内。
