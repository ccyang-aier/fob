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

## 紧凑布局与多服务商修订

用户指出首版过大、单连接设置不符合使用流程后，本次按真实浏览器尺寸重新验收，取代首版视觉结论。

- [x] 菜单 360px / 32px 行高 / 13px 字号；生成空态 120px、输入条 420 × 38px、圆钮 30px、完成条 264 × 38px。正文阅读字号保持原设置。
- [x] 集中统一生成星和四形图标，以及菜单、块、设置、助手、选区和协作光标的 AI 图标。
- [x] 独立服务商 CRUD、三种协议、自定义公网 HTTPS Base URL、加密密钥、100 个模型的增删与显示名、真实模型发现与逐模型测试。
- [x] 快速/深度可绑定不同连接，助手可单轮指定模型；所有 AI 下拉复用 Radix，增长清单支持搜索，没有原生 select。
- [x] 私有连接按账户/知识库隔离，24 套上限；旧设置无损迁移，删除仅清理本连接和默认关联；服务端默认配置独立只读。
- [x] 动态 Gateway、三种真实 SDK 协议、模型清单校验、DNS 固定和重定向拒绝、有限分页/字节/超时、可取消等待；Bun 与真实 Node transport 验证通过。
- [x] assistant_connection 本地数据库升级执行两次通过，schema/current.sql 一致。
- [x] 前端 AI/设置/编辑器/图标回归 147 项、694 断言；窄屏设置导航与桌面拖拽另 2 项、10 断言通过。日志 `ai-refinement-frontend.log`、`ai-mobile-settings-tests.log`。
- [x] 全 AI 后端回归 108 项、651 断言通过，仅过滤外部 Ollama 端到端 1 项。日志 `assistant-connections-backend-final.log`；新连接 HTTP 生命周期单测 9 项、91 断言另行通过，日志 `ai-provider-http-tests.log`。
- [x] 真实浏览器创建两套服务商，默认模型独立保存；智谱连接成功（5262ms）、模型目录搜索多选与刷新保留；测试密钥失败如实显示，删除第二套不影响第一套。
- [x] 显式个人模型问答请求带正确 connectionId/modelId，真实回答含引用；块实际生成、采纳为普通正文。
- [x] 390px 设置导航改为顶部四分区，配置区宽 324px 无横向溢出；生成审阅胶囊 226 × 36px，三个操作完整位于胶囊和视口内；浅深色截图已检查。
- [x] 最终独立设置与生成流程 fresh navigation 的 pageerror 均为 0；类型、图标、国际化、架构、ESLint、生产构建通过。日志 `ai-provider-boundaries.log`、`ai-refinement-lint.log`、`ai-refinement-build.log`。

本轮使用新的合成账户、知识库、文档，未修改用户原有文档或账户模型配置。独立浏览器已关闭，合成知识库、账户、测试密钥及用量记录已在校验归属后清理。当前视觉证据见 [design-qa.md](../../design-qa.md)。

### 后续生成图标纠正

用户再次指出四角星仍与原图不一致，已撤掉 Lucide Sparkle，按最早参考实现倾斜五角轮廓与右下长尖。菜单、生成块、助手、设置和协作光标共用 `GenerateStar`，检查脚本固定该组件摘要，例外不扩展到其它图标。原尺寸与放大对照为 `.runtime/dev/generate-icon-shape-compare.png`。既有图标与双编辑器协作回归 11 项 / 79 断言通过；图标检查、定向 ESLint、类型及架构检查通过。独立账户的实际菜单与生成块截图为 `generate-icon-menu.png` / `generate-icon-block.png`，浏览器校验两者 SVG 路径一致，pageerror 为 0；未调用模型或修改用户原有文档。
