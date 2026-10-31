# 编辑器富内容执行记录

当前设计：`docs/editor-rich-content.md`。

## 范围与状态

- 已接入共享 schema、稳定 ID、Markdown、插入菜单和浏览器 NodeView。
- 已实现公开网页摘要及网络边界、Mermaid、PDF、B站官方播放器、Excalidraw 场景编辑。
- 首批范围完成；类型、相关回归、真实编辑/刷新/导出、PDF 权限、深浅主题、桌面与窄屏均已验证。

## 现有工作保护

开始时仓库存在导航图标、目录概览、页面移动等未提交工作；本次保留，提交仅包含富内容相关变更。

## 验证（2026-10-26）

- 前端、业务服务与共享包类型检查通过；生产 `pnpm build` 静态页面 8/8 通过。
- 相关共享协议、schema、Markdown/HTML、插入粘贴、归档附件、本机双窗格与 50 次连续属性更新：303 tests / 449 assertions 通过。
- 真实 HTTP/PostgreSQL/Yjs 协作、分享和历史测试：11 tests / 86 assertions 通过；包含 file/pdf 两种块的 guest 附件引用授权、拒绝探测未引用附件、只读拒绝上传、撤权后拒绝下载。测试数据库已按 fixture 清理。
- `pnpm icons:verify`、`pnpm i18n:verify`、`pnpm architecture:verify` 通过；`pnpm exec eslint src scripts/dev.mjs scripts/prepare-rich-content.mjs --max-warnings=0` 通过。
- 全仓 `pnpm lint` 被既有 `pl_works/guizang/assets/motion.min.js` 等第三方脚本警告阻断；未改动这些范围外脚本。更广的编辑器实例序列产生大量 happy-dom/React 警告，已停止该序列，使用上述相关测试和真实浏览器验证本次范围。

## 真实界面证据

环境：`http://localhost:3001`，Playwright Chromium；本次会话未提供 Browser 插件，因此使用 Playwright CLI。桌面 1440×1000、窄屏 390×844。

- 新建本机知识库和文档，在同一正文中插入五类内容；刷新后 Mermaid 源码、PDF 附件和白板场景均恢复。
- 粘贴 `https://example.com/` 后，真实 Fob 服务返回 `Example Domain`，卡片保存元数据快照。
- Mermaid 源码编辑后生成 SVG 预览；错误语法出现明确提示，修正源码后恢复；键盘调整高度从 360 到 380；切换深浅主题后重新渲染。窄屏保留可读尺寸并在块内横向浏览，页面无水平溢出。
- 上传实际两页 PDF，读到两页 canvas；点击下一页后页码为 2，缩放选择 150%。
- B站 BV 链接得到官方播放器，参数 `p=2&t=12&autoplay=0`；初始暂停在 12 秒，手动播放后 `paused=false` 且时间前进，再次暂停。源平台脚本存在自身的混合内容升级和 fingerprint 日志，未将其当作 Fob 运行错误。
- 在 Excalidraw 画布中实际绘制矩形并保存，正文保留 1 个元素，下载 `.excalidraw` 文件含 Fob 来源和完整场景。再次保存生成 11,642 字符的 PNG data URL 及 SHA-256；冷刷新直接显示已存快照，无 whiteboard-runtime/Excalidraw 请求。
- 从真实文档菜单下载 HTML 和 Markdown。HTML 约 704 KiB，包含 4 张内嵌图片、PDF 附件及视频来源，无 iframe；Markdown 保留 mermaid/excalidraw 围栏和原链接。
- 主题与窄屏交互期间未产生 pageerror；窄屏 document.scrollWidth 为 390，与 viewport 相同。
- 截图与下载产物留在本聊天的外部 QA 目录，未加入提交：`rich-content-desktop.png`、`rich-content-dark.png`、`rich-content-mobile.png`、`whiteboard-editor.png`。

## 兼容范围

- PDF 外部 URL 需要源站允许 CORS；私有附件沿用 Fob 自身授权，不通过公共元数据服务读取。
- 白板首版为明确保存的画布会话，支持陈旧场景冲突提示；不声明多人同时绘图。
- B站首批识别 BV、av 和官方播放器长链接，外部内容始终受源平台可用性与权限限制。

## 白板阅读与交互优化（2026-10-31）

当前设计见 [编辑器富内容块](../../docs/editor-rich-content.md)。

- 在用户当前文档复现：白板预览区高 400px，通用 Grid 容器中的图片实际高约 701px，预览内部滚动高度约 733px，导致绘图下半部分不可见。白板改用独立的 Flex 适配容器，图片等比包含于现有高度内，取消内部滚动；场景与已保存的高度不需迁移。
- 白板选择 `RichBlockFrame` 的 canvas 外观，阅读态移除标题栏、卡片外框与常驻调高手柄。共享操作组在悬停、点击聚焦或键盘聚焦时显示；触屏使用按需显示策略并保留至少 44px 的操作目标。其他内容块默认外观和触屏策略保持原有行为。
- 标题移到画布弹窗内编辑，与绘图一起显式保存；取消不改原标题或场景。会话关闭、节点销毁或场景/标题被外部修改后拒绝过期保存。弹窗固定其挂载宿主，避免重绘时把当前 dialog 选作自身 Portal 容器。
- 新增 2 项真实编辑器组件测试，覆盖白板无标题栏、保留可访问标题、点击聚焦且不改正文、其他图表仍保留标题，以及只读白板无编辑或调高入口。连同白板语义与 HTML/Markdown 导出专项共 23 tests / 79 assertions 通过。
- 当前已登录的内置浏览器中使用独立临时页面验证同一现有文档：完整的两个矩形和连线均可见；400px 高度下图片和预览区高度均为 400px，内部滚动差值为 0。默认工具栏透明度为 0，点击或 Tab 到下载按钮后为 1，失焦并移开后恢复 0。
- 原生白板全屏显示退出按钮，完整图片适配可视区，内部滚动差值为 0；退出后恢复原 400px 高度。编辑弹窗打开、修改临时标题并取消后仍保留原可访问标题与绘图；源文件下载为 Fob 来源的 Excalidraw JSON，保留原有 3 个图元。未向原文档提交绘图或标题修改。
- 窄屏实际 CSS 视口约 410×888，白板图片宽度适配正文，横纵内部滚动差值均为 0，默认工具栏隐藏、外框与标题栏均不显示；验证后恢复原窗口尺寸及用户原有导航展开状态。真实触控硬件与跨客户端冲突竞态未在本轮重新实机覆盖。
- 浏览器控制台 0 error / 0 warning，无框架错误覆盖层。截图和下载产物保存在本聊天的仓库外 visualizations 目录，临时验证页面已关闭。
- `pnpm typecheck`、修改文件 ESLint、`pnpm icons:verify`、`pnpm i18n:verify`、`pnpm architecture:verify`、`git diff --check` 通过；`pnpm build` 生产编译、类型检查及静态页面 8/8 通过。开发 Web、业务及媒体服务和作业消费者保持运行。
