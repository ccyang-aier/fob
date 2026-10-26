# 文档块拖拽实施与验证

当前设计：[文档块拖拽](../../docs/editor-block-drag.md)。

## 实施

- [x] 在共享文档正文装配浮动六点手柄，统一支持本地、协作与文件夹正文。
- [x] 原生拖动预览、源块淡化、蓝色边界插入线及边缘自动滚动。
- [x] 单事务移动、保留块 ID、列表同级排序、只读与销毁清理。
- [x] 集中登记官方 FA7 图标，无新增依赖。

## 验证（2026-10-27）

- `bun test --isolate src/features/knowledge/editor/extensions/block-drag.test.ts`：8 项通过，覆盖双向整块移动、一次撤销/重做、整表与列表项、无效目标、协作期间源位置映射、只读清理、跨编辑器拒绝、Yjs 持久化与撤销。
- `keyboard-editing.test.ts` 的 24 项既有键盘行为与 `local-document-editor.instance.test.tsx` 的 3 项双面板同步回归通过。测试环境既有 KaTeX quirks-mode 和 React NodeView flushSync 提示保留；真实浏览器无新增应用错误或警告。
- 浏览器插件不可用，使用已有 Playwright CLI 和独立 Chrome 会话；测试数据位于此浏览器自己创建的本地知识库，未修改用户浏览器数据。
- 1440×1000 的真实浏览器通过：段落移至首位、列表项换序、块 ID 与存储内容对应、撤销/重做、刷新保留、Escape 取消、移出正文隐藏控件、26 段长正文拖至边缘自动滚动及清理。拖动前后的源 ID 不变，指示线在结束后消失。
- 浅色与深色查看六点手柄；390×844 窄屏下手柄完整落在视口内、正文无横向溢出。开发 CSS 热更新曾短暂丢失局部样式，刷新后恢复；视觉验收使用刷新后的页面。
- `pnpm typecheck`、`pnpm icons:verify`（包含在 lint）、`pnpm lint`、`pnpm architecture:verify`、`pnpm i18n:verify`、`pnpm build` 与 `git diff --check` 通过。构建产物在独立 `.next-build`，Web 与业务服务保持运行。
- 悬停、拖动中、完成后、深色与窄屏截图保存在本聊天仓库外的 Codex visualizations 目录，没有提交运行数据或截图。

## 验证范围

协作部分验证真实 Yjs 绑定与撤销事务，没有新增账号或创建服务端测试知识库；多用户浏览器并发、触摸拖放及第三方嵌入内部交互未纳入本次浏览器验收。只读和跨编辑器边界由实例测试覆盖。
