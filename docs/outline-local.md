# Outline 本地源码运行

## 目录与隔离

- `opensource/outline/` 是从 [outline/outline](https://github.com/outline/outline) 克隆的独立 Git 工作树，由 `opensource/.gitignore` 排除，不作为 Fob 的源码或子模块提交。
- `opensource/outline-local.Dockerfile` 使用 Node 26.12.1、Corepack 0.36.0，以及上游声明的 Yarn 4.18.0；执行 `yarn install --immutable` 和完整的 `yarn build`。保留上游锁文件和依赖脚本禁用策略，原生工具使用 npm 包附带的预编译二进制。
- `opensource/compose.outline.yaml` 提供 `fob-outline-local` 独立 Compose 项目、PostgreSQL、Redis、附件卷和 Mailpit 本地收件箱。数据库与 Redis 不发布宿主端口。应用和收件箱只发布在本机回环地址。
- `opensource/.env.outline.local` 由初始化脚本生成随机数据库密码、`SECRET_KEY` 和 `UTILS_SECRET`，不提交、不复用 Fob 配置。容器标签记录构建来源提交。
- Fob 的 ESLint 排除第三方克隆目录，仍检查本地运行脚本。

## 首次安装

Windows 使用已经安装并运行 Docker Engine / Compose 的 WSL 发行版；默认 `Ubuntu-22.04`，可用 `OUTLINE_WSL_DISTRO` 指定其他发行版。宿主 Node 只运行管理脚本，不承担 Outline 构建。Linux 可直接使用 Docker。

在 Fob 根目录执行：

```powershell
New-Item -ItemType Directory -Path opensource -Force
git clone --depth 1 --single-branch --branch main https://github.com/outline/outline.git opensource/outline
node opensource/outline-local.mjs init
node opensource/outline-local.mjs build
node opensource/outline-local.mjs up
```

`init` 重复执行保留已有密钥，仅同步构建提交。`up` 等待健康检查，Outline 自动执行数据库迁移，再通过上游模型幂等创建 `Outline Local` 工作空间、管理员和官方入门文档。Windows 下使用专属隐藏会话保持 WSL 运行。

首次构建须能访问 GitHub、npm 和 Docker Registry。若系统使用 HTTP 代理，需要给下载命令显式配置；不要将代理或认证信息写入受版本管理的文件。例如 Windows Git 可使用系统已配置的代理：

```powershell
$outlineProxy = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer
git -c "http.proxy=http://$outlineProxy" clone --depth 1 --single-branch --branch main https://github.com/outline/outline.git opensource/outline
```

Docker 所需外部镜像为 `node:26.12.1-slim`、`postgres:17-alpine`、`redis:7.4.8-alpine` 和 `axllent/mailpit:v1.32.0`。可以提前导入这些同名镜像，再构建和启动。Docker Hub 直连不可用时，本机现有 Skopeo 可通过镜像传输获取，例如：

```powershell
wsl -d Ubuntu-22.04 --exec skopeo copy --retry-times 3 --override-os linux --override-arch amd64 docker://m.daocloud.io/docker.io/library/node:26.12.1-slim docker-daemon:node:26.12.1-slim
wsl -d Ubuntu-22.04 --exec skopeo copy --retry-times 3 --override-os linux --override-arch amd64 docker://m.daocloud.io/docker.io/axllent/mailpit:v1.32.0 docker-daemon:axllent/mailpit:v1.32.0
```

## 访问与登录

1. 打开 [Outline](http://localhost:3802)。
2. 使用 `admin@outline.local` 请求邮箱登录。
3. 打开 [本地收件箱](http://localhost:3803)，读取验证码或登录链接，完成登录。

这是仅供本机使用的管理员和邮件环境。邮件在 Mailpit 内捕获，不配置外部 SMTP、OAuth 或其他产品的账户。生产环境需要另行配置认证、SMTP、HTTPS 和备份。

## 日常操作

```powershell
node opensource/outline-local.mjs status
node opensource/outline-local.mjs logs
node opensource/outline-local.mjs down
node opensource/outline-local.mjs up
```

`down` 保留数据库、Redis、附件和邮件卷。重新运行 `up` 会恢复原数据。保存生成的密钥文件，否则原数据中的加密内容无法解密。

更新源码时，在 `opensource/outline` 执行 `git pull --ff-only`，然后在 Fob 根目录重新运行 `build` 和 `up`。升级前备份数据库、附件卷和密钥，核对上游运行时要求。

执行与验证记录见 [Outline 本地运行任务](../.spec/tasks/outline-local.md)。
