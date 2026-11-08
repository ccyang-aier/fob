# 煤球 AI 对话执行记录

日期：2026-11-09。范围：按用户选定的第 1 张 Whisper Bubbles 完整实现宠物聊天。设计见 [docs/companion-ai-chat.md](../../docs/companion-ai-chat.md)。独立助手窗口与顶栏入口保持已撤回状态。

## 实现

- 透明气泡、独立胶囊输入、现有宠物锚定与跟随、原文引用、安全 Markdown、错误恢复、最近对话与确认删除。
- 工作台/活动文档发布最小上下文，外置状态机负责私有会话、流式问答、停止、恢复、轮询与 scope epoch。
- 浏览器仅保留至多 10 个 UUID 指针，跨用户/知识库立即隔离；后端重新执行成员与来源 ACL。
- 知识库模式允许没有当前页面；文档模式仍要求真实 UUID。自然煤球人格复用既有 Agent、模型配置、工具预算和保留上限。
- 默认点击对话，右键与 Shift+F10 保留原互动；现有生成块与设置入口不受影响。

## 验收记录

以下均已完成，日志和截图只存忽略的 `.runtime/dev/`：

| 检查 | 结果 / 证据 |
| --- | --- |
| 前端 companion / AI / 模型选择 | 78 通过，666 断言；`coal-chat-frontend-tests.log` |
| 编辑器接线、来源导航、slash/选区 | 25 通过，189 断言；`coal-chat-editor-regression.log` |
| 后端完整 AI 模块真实 PG 回归 | 118 通过，730 断言，1 项真实本地 Ollama 被筛除；`coal-chat-backend-final.log` |
| 共享契约与来源 ledger | 10 通过，153 断言；`coal-chat-contracts-final.log`（其中 ledger 亦计入后端总集，不将数字重复相加） |
| Web / Server / Shared 类型 | 均通过，分别为 `coal-chat-typecheck.log` / `coal-chat-server-typecheck.log` / `coal-chat-shared-typecheck.log` |
| 图标、国际化、Lint、架构边界与抽取摘要 | 均通过；`coal-chat-icons.log` / `coal-chat-i18n.log` / `coal-chat-lint.log` / `coal-chat-architecture.log` |
| 生产静态构建 | 通过；`coal-chat-build.log`，开发与生产构建目录独立 |

浏览器沿用用户已明确允许的本地 Playwright CLI，专用 Chrome 上下文。实际 GLM 调用完成文档两轮追问、历史引用跳转、无页面的知识库检索、另一知识库的不同负责人/日期，以及 A/B 切换时的私有草稿和答案隔离。

已通过实际 UI 验证停止保留部分正文、关闭生成并重开、刷新恢复、最近对话搜索、取消/确认删除、AI 设置跳转后草稿保留、来源打开目标文档、四角拖动不误开合、窄屏、深色和模拟键盘。复制、重新回答、输入法、Shift+Enter、错误恢复、流式迟到与跨用户隔离另有组件/状态机回归。

桌面气泡宽 304px、胶囊高 40px。长多轮消息区不产生横向滚动。保持 layout 390×844、模拟 visualViewport 390×320 时，气泡为 x12/y12、294×296，精灵也在可见区；恢复视口后回到用户原位置。键盘测试为模拟，没有物理手机结论。

最终冻结后 fresh navigation 捕获 `pageerror=[]`、`console error=[]`，旧独立窗口节点为 0，打开聊天不改变正文宽度。开发期间曾遇到 CSS HMR 导航中断及服务 watch 短暂重启，未用中间状态作最终证据。视觉同图比较与修复过程见 [design-qa.md](../../design-qa.md)，当前结果 passed。

引用回归还修正了旧历史被当成裸数字的提示方式：只对预算内的历史权威来源重新验真、重映射，并移除失效数字标记；当前文档与没有当前页的知识库模式均有覆盖。默认煤球用简短自然回应，复杂请求按用户需要展开。

## 数据与提交

真实模型验收使用专用 verified 合成账户及两个仅该用户 owner 的隔离知识库。正文、检索索引与 ACL 均来自实际服务端。脚本以账户前缀、标记、准确库名、所有权与无外部关联为事务前置条件；验收后仅删除本 fixture 数据。认证、凭据与运行快照不提交。

已关闭专用浏览器并成功执行受保护的 `cleanup` 事务：合成账户、两个知识库及其 jobs/usage 清理完成，导出的 storage-state、metadata 与临时 fixture 脚本已删除。证据为忽略的 `coal-chat-fixture-cleanup.log`。真实用户内容与模型配置未更改。普通问候的真实模型响应自称煤球、没有展开当前文档、引用数为 0，见 `coal-chat-casual.png`。
