# Fob

Fob（Fusion One Book）是面向个人与团队的 Web 知识工作空间，集文档编辑、文件管理、检索、协作与 AI 于一体。愿景是让知识易于记录、组织、发现和复用，成为持续积累的共同资产。

## 工程约定

- 使用 Next.js App Router、React、TypeScript、Tailwind CSS v4、现有 Radix 风格组件、TypeScript/Bun 业务服务和 PostgreSQL；后端 API 保持 Node 兼容，Python 服务负责媒体处理。
- `src/` 负责前端，`backend/server/` 负责身份、知识与模型，`shared/` 负责纯契约和文档语义。前端仅通过 `@fob/server/knowledge-api` 以 `import type` 引用服务端类型。
- 知识库是工作空间和权限边界；顶部切换器管理知识库，成员、分组、页面、ACL 及业务操作统一以 `knowledgeBaseId` 为作用域。
- shell 提供唯一系统侧栏与收起状态；资源适配器负责查询、权限和操作，当前导航所有者负责跨功能文档跳转与通知。
- 界面展示真实产品数据和操作结果，明确呈现外部配置依赖、不可用状态与错误。
- 数据库、对象存储、认证状态、部署及浏览器存储使用 Fob 自有配置与命名空间；工作范围限当前仓库。

## 工作流程

- 前端工作前及提交前阅读 `AI_FRONTEND_RULES.md`。
- 修改 Next.js 行为前，查阅 `node_modules/next/dist/docs/` 中的当前版本指南与弃用说明。
- 架构以 `docs/architecture/fob-product-boundaries.md` 为准，执行状态见 `.spec/tasks/fob-extraction.md`；每个主题在 `docs/` 保留一份当前设计，执行门槛与验证证据放在 `.spec/tasks/`。
- 开发期间保持 Web 与业务服务运行，验证变更行为、资源权限边界及真实界面流程。
- 完成验证后使用清晰的约定式提交信息；提交内容不包含凭据、运行时快照或临时截图。
