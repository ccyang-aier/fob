# AI 接入、生成块与知识助手

日期：2026-11-09。内核当前设计：[知识助手](../../docs/knowledge-assistant-agent.md)。当前聊天入口的产品设计与本轮 UI 验收分别见 [煤球 AI 对话](../../docs/companion-ai-chat.md) 和 [煤球对话任务](companion-ai-chat.md)。下文早期独立助手实现与验收保留为历史，不代表当前界面。

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

## 可拖拽悬浮助手

- [x] 参考真实 Dribbble 设计图片，重排标题、文档上下文、快捷提示、消息、历史和输入工具栏；保留 Fob 共享规范。
- [x] 默认 400 × 600px 悬浮窗口，指针拖拽、方向键、位置记忆及 visualViewport 边界；打开前后正文宽度相同。
- [x] 消息独立滚动和回到最新回答；输入自动增长、IME / Shift+Enter、提交前失败不清空草稿、共享删除确认和无匹配空态。
- [x] 只展示活动文档浮窗；不锁背景，不在外部编辑时关闭；设置与菜单 Escape 独立，全屏不重建会话子树。
- [x] 实际复现精灵顶层遮挡发送，修成独立 manual popover 和原生模态关闭后的受控置顶；菜单、Tooltip、设置各在正确宿主，最右下角实际发送通过。
- [x] 独立合成知识库两篇文档；模型真实带引用回答负责人和日期，实际停止长回答保留约 2800 字符的界面内容。
- [x] 390 × 844 窄屏、390 × 320 模拟键盘视口及深色检查；输入/发送/模型菜单完整可用，无横向溢出。
- [x] 相关 AI / 设置 / 文档编辑器前端回归 71 项、511 断言通过，日志 `assistant-floating-tests.log`；类型、国际化、图标、ESLint 通过。
- [x] 最终稳定页面 pageerror / console error 均为 0，正文边界不变；真实 Fullscreen API 进入退出保留输入。生产构建与架构检查通过，日志 `assistant-floating-build.log` / `assistant-floating-boundaries.log` / `assistant-floating-lint.log`。

布局评估与机械扫描由两个独立子代理完成，机械结果为空；人工评估仍发现并修复输入区 80px 空白、信息层级及重复控件。设计与交互证据见 [design-qa.md](../../design-qa.md)，当前设计仍以 [知识助手](../../docs/knowledge-assistant-agent.md) 为准。

## 按单一 Golo 参考重做聊天界面

- [x] 实际打开并截图 Golo 的 [AI Chat Interface in Light Theme](https://dribbble.com/shots/24101037-AI-Chat-Interface-in-Light-Theme)，以该图作为当前唯一视觉基准；旧版混合参考不作为本轮通过依据。
- [x] 520 × 432px 横向浮窗、32px 标题栏、12px 正文与标题；移除大空态、介绍段落和独立文档栏，文档名放进标题标签。
- [x] 建议问题使用一个轻描边浮层、四行箭头操作；白底输入、随内容收缩的模型胶囊、24px 细圆框发送、30px 引用条。完成回答移除重复助手标题，检索步骤移到末尾。
- [x] 通过真实文档选区入口带入上下文；润色和移除引用可用，移除不丢草稿。390 × 320 视口的建议列表首尾均可滚动到，不用底对齐制造不可达内容。
- [x] 真实模型回答负责人和日期并带来源；实际测试发送、停止、三类菜单、设置返回、拖拽和历史搜索。测试隔离账户及知识库，不修改用户已有资料。
- [x] 71 项 / 511 断言通过；类型、ESLint、图标、国际化（3258 条文案）、架构和生产构建通过。日志 `assistant-golo-tests-final.log`、`assistant-golo-types-final.log`、`assistant-golo-lint-final.log`、`assistant-golo-i18n.log`、`assistant-golo-boundaries.log`、`assistant-golo-build-final.log`。

当前视觉核对、密度说明和浏览器证据见 [design-qa.md](../../design-qa.md)。不把预览画布、示例对话、品牌差异或开发热更新中间态冒充为逐像素一致。

验收结束后已关闭独立浏览器，按知识库归属和合成账户前缀核对后清理测试知识库、账户、会话任务和用量；删除临时认证状态。Web 与业务服务继续运行。

## 历史决定：删除独立聊天弹窗

用户在上一阶段明确撤回独立 AI 助手弹窗与文档顶栏入口，当时只制作煤球精灵聊天的 imagegen UX 方案。本节保留该阶段执行与验收事实；用户随后选择方案 1，当前实现范围见末尾「煤球气泡与内核补齐」。

- [x] 删除旧聊天 panel / conversation / composer / history / window / geometry / answer / settings wrapper、样式、专用文案、选区事件桥和 React 控制器，共 19 个前端文件及其专用测试。
- [x] 清理服务端文档编辑器里的挂载、状态和订阅，移除文档头 `assistant` 插槽及选区工具栏打开旧窗口的入口，没有保留不可点击的占位。
- [x] 保留编辑器内生成、可视化、流式草稿、采纳与撤销；保留全局多服务商 AI 设置、共享模型选择器、鉴权 transport 和流式解析，以及后端权限/会话 API 与 Agent Harness。没有清空用户会话、连接或凭据。
- [x] 煤球精灵代码和现有交互没有修改，新聊天代码未实现；待用户选择 UX 方案后再开发。
- [x] 更新当前设计和三个源适配摘要。架构检查通过：1161 个运行时模块，无循环和公开包边界违规；国际化通过：219 个目录、3160 条双语文案。
- [x] 相关前端回归 100 项 / 501 断言、TypeScript 与生产构建通过，日志 `assistant-retirement-tests.log`、`assistant-retirement-types.log`、`assistant-retirement-build.log`。
- [x] 全量 ESLint 与图标检查通过（820 个源文件），日志 `assistant-retirement-lint.log`；清理选区工具栏剩余 context 引用后，定向复验 6 项 / 39 断言通过，日志 `assistant-retirement-selection.log`。

- [x] 根任务 Chrome 验收：1050 × 917 与 390 × 844 中旧顶栏入口和 Portal 均不存在；选区格式正常；实际插入正文 AI 工作块、打开全局 AI 接入设置、展开煤球原有互动工具通过；pageerror / console error 均为 0。证据见 `assistant-retirement-*.png` 和 [design-qa.md](../../design-qa.md)。
- [x] 内置 imagegen 独立生成并展示三张煤球聊天 UX 方案，顺序固定为当前会话的展示顺序，仅设计，不实现代码。预览和生成记录位于忽略的 `.runtime/dev/companion-ai-ux-*`。

以上自动化和浏览器验收没有调用真实产品模型，也未修改用户已有文档。Web 和业务服务继续运行。

验收完成后已关闭独立 Chrome 上下文；在事务内核对合成账户前缀、知识库 owner 及无外部成员关联后清理 fixture 的任务、用量、知识库和认证账户，并删除临时认证状态。三张 UX 预览及生成记录继续留在忽略目录供选择。

## 当前实现：煤球气泡与内核补齐

用户已选定 imagegen 方案 1，要求完整实现煤球 AI 对话。当前唯一聊天入口是点击全局煤球精灵打开轻量气泡；不恢复已撤回的独立助手窗口、顶栏 AI 按钮或选区打开聊天入口。产品设计与前端执行证据统一见 [煤球 AI 对话](../../docs/companion-ai-chat.md) 和 [煤球对话任务](companion-ai-chat.md)。本节只记录已经落盘的接入和后端验证，不把早期窗口验收套用到新气泡。

- [x] 煤球气泡及私有会话控制器复用现有 `assistant-api.ts`、NDJSON 路由、Conversations、ModelGateway 和 Agent Harness，没有第二套模型请求栈。
- [x] 活动工作区提供用户、知识库和可选文档上下文；没有当前文档时显式使用知识库模式，页面值为 `null`，不伪造文档 ID 或读取未经授权的首页。
- [x] 共享契约允许知识库 ask 省略或显式传入 `pageId: null`，默认及显式文档模式仍要求有效 UUID；空页文档请求在持久化和模型调用前返回 `invalid_request`。Turn 可空并保留旧 UUID 请求与历史兼容，无需数据库迁移。
- [x] 空知识库可以正常日常对话；后续资料读取仍通过原只读工具、ACL/RLS 和披露账本。日常对话使用「煤球，Fob 中的知识伙伴」人设，不主动总结打开的文档或讲述工具过程，不编造知识事实和引用。
- [x] 私有会话、列表、恢复、取消和删除保持用户 + 知识库作用域。无页历史不制造空页面授权，但实际披露页仍逐一复验；空账本也执行身份刷新，凭据失效会清空部分输出。
- [x] 旧工具只读、调用/消息/输出预算、流式用量、心跳、取消及留存上限保持。跨实例 Stop 可中止无页知识库对话，恢复保持 `pageId: null`。
- [x] 服务端显式应用建议仍要求目标编辑权限和权限围栏。新增用例发现只读目标原被误报为 503，现归一为 `access_changed / 403`；有编辑权限的显式目标仍可写入可审阅建议。
- [x] 本轮真实续问检查发现旧历史引用被变成裸数字示范。现先按完整对话对和字节预算选历史，再将其中实际引用经权威正文重新验真、映射为本轮编号；来源摘录与 `sources` 事件同步发布。未知或失效数字标记整体移除，不把普通数字猜作引用。
- [x] 2026-11-09 全 AI 后端最终回归：118 通过、730 断言、16 文件；筛除依赖真实本地 Ollama 的 1 项。日志 `.runtime/dev/coal-chat-backend-final.log`，命令如下。
- [x] 共享契约与来源账本定向回归：10 通过、153 断言，日志 `.runtime/dev/coal-chat-contracts-final.log`；`server:typecheck`、共享 TypeScript 和限定改动 `git diff --check` 通过。

```powershell
bun --env-file=.env.fob.local test --isolate backend/server/src/modules/knowledge/ai --test-name-pattern '^(?!.*a real local Ollama model streams blocks end to end)'
bun test --isolate shared/src/knowledge/contracts/assistant.test.ts backend/server/src/modules/knowledge/ai/agent/sources.test.ts
pnpm server:typecheck
pnpm --filter @fob/shared typecheck
```

新增集成覆盖空库无页聊天、`null` 幂等重放、多轮私有恢复、跨知识库拒绝、文档空页拒绝、无页授权检索与撤权、空披露账本凭据失效、跨服务实例取消、目标编辑权限与实际建议写入。同文档续问保留真实引用链接，无当前页续问将历史 source 2 重映射为本轮 source 1，撤权后衍生回答不可读取；未入选的超预算历史不会触发来源读取。数据库集成使用临时隔离库，测试结束已自动删除。真实模型与图 1 视觉验收状态由 [煤球对话任务](companion-ai-chat.md) 单独记录，此处不提前宣称 UI 验收通过。
