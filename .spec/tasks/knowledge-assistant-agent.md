# AI 接入、生成块与知识助手

日期：2026-11-08。当前设计：[知识助手](../../docs/knowledge-assistant-agent.md)。

## 实现范围

- [x] 并行完成生成块视觉对齐、Pi 参考内核、AI 设置三个子任务，由主任务统一接入与验收。
- [x] 服务端默认 BigModel Coding 配置，实际使用 `glm-5.3-flash`；凭据仅保存在忽略的环境文件中。
- [x] 当前账户 / 知识库的个人模型设置与加密凭据；设置页面和助手弹窗复用表单、错误、加载、用量与连接测试。
- [x] `/` 菜单 AI 项置顶，空态 / 思考 / 流式尾段 / 完成草稿；撤销、修改、原子采纳和普通正文转换。
- [x] AI 容器草稿独立审阅；普通建议仍使用原有全局审阅，互不消耗。
- [x] 私有会话、当前文档 / 知识库问答、选区上下文、来源跳转、重试、停止与部分回答保留、审阅写入。
- [x] Pi 参考的模型适配层、工具循环、五个只读知识工具、预算、权限与来源账本、心跳、跨实例取消和写入收据。
- [x] 会话物理上限 10 / 用户 / 知识库，每会话 20 轮；上下文、工具和正文收据有硬上限。
- [x] 开启历史会话恢复 running / 失联终态，权限失效隐藏旧回答；普通正文编辑只移除失效引用。

## 自动验证

- `bun test --isolate src/features/knowledge/ai src/features/knowledge/editor/review src/features/knowledge/editor/commands src/features/knowledge/editor/block-modules/ai-block src/features/settings src/lib/settings-navigation.test.ts`：131 通过，601 断言，18 文件。日志 `.runtime/dev/assistant-frontend-final.log`。
- AI 后端最终完整回归：91 通过，523 断言，13 文件；排除需真实本地 Ollama 的 1 项。日志 `.runtime/dev/assistant-ai-release.log`。
- 后续权限围栏加固后重跑助手全部 8 项：69 断言通过；覆盖初次读取后来源撤权的写回拒绝。日志 `.runtime/dev/assistant-permission-final.log`。
- 前端、共享和服务端 TypeScript、完整 ESLint、国际化、图标、架构与 source adaptations、生产构建均通过。构建 / Lint 日志为 `.runtime/dev/assistant-build-final.log` / `assistant-lint-final.log`。
- `pnpm architecture:verify`：886 来源条目、1155 运行时模块，无静态环和跨包越界。
- 数据库 assistant preference 表的幂等升级已在本地服务数据库执行，规范 schema 已同步；隔离数据库集成用例随测试自动创建和清理。

## 真实供应商和界面

使用独立合成账户、知识库和两篇合成文档，不把用户原有文档用于模型验收。临时认证状态位于系统临时目录，截图和运行日志位于忽略的 `.runtime/dev/`。

- 设置「测试连接」实际成功，展示 `连接成功 · glm-5.3-flash`，真实累计 token / 调用数刷新。
- 真实模型调用完成 `search × 2 → list_pages → read_page → answer`，正确回答合成清单的权限回归、备份演练、成员指南和验收人，并返回真实来源。
- UI 表单发起的后续问答同样成功，一句话回答负责人并展示引用；历史记录可重新打开。
- 来源按钮实际打开《Aurora 项目发布清单》，URL 指向对应页面与知识库，正文为真实清单。
- 真实生成捕获空态、思考、部分尾段和完成状态；完成时选中真实文本，不增加全局建议侧栏。
- 实际采纳 → `Control+z` → 再采纳，容器计数依次为 0 / 1 / 0；文档内容保留。
- 助手「插入文末」实际写入为建议，打开全局审阅并关闭助手；接受后保留标题、列表、粗体和文档链接。
- 390px 窄屏实际生成后停止，保留 64 字草稿与可操作审阅条，无横向溢出；另检查桌面深色。
- 视觉对比与窄屏记录见根目录 [design-qa.md](../../design-qa.md)。
- 最终稳定页面重新加载后的 pageerror 捕获为空。已关闭隔离浏览器并清理合成知识库、两名测试用户及其会话，未修改原有用户文档。

## 当前依赖边界

- 本机文件夹知识库暂不支持服务端 AI；对应入口显示真实不可用状态。
- 未配置 embedding 时使用真实 ACL 关键词检索；不冒充向量检索。真实本地 Ollama 未在本轮部署，因此相关外部端到端用例未执行。
- 没有终端 / 任意文件 / 浏览器工具，没有无人确认写入；模型不会自动修改权限。
- Pi 源码只作本地参考，提交精简来源清单和当前设计，保留本地完整 checkout 与上游许可。
- 开发期间多文件热更新触发 Next CSS HMR 的样式丢失 / removeChild 异常，完整刷新后恢复；生产构建与最终稳定页面另行验收，不把 HMR 异常隐去。
