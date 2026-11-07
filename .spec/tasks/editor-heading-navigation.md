# 标题章节折叠与悬浮目录

设计：[editor-heading-navigation.md](../../docs/editor-heading-navigation.md)。

## 实现

- [x] 按同级/上级标题划分章节，父子章节独立折叠，个人页面状态保存。
- [x] 光标、目录、搜索及块链接自动展开隐藏祖先，保持正文与撤销独立。
- [x] 短线轨道和悬浮目录；层级缩进、当前位置、键盘与视口约束。
- [x] HTML 导出完整正文并恢复折叠状态。

## 验证

- 2026-11-07：章节模型、折叠/定位/撤销、嵌套容器、稳定 ID 与快照失败恢复测试通过。
- 同轮回归：章节模型及真实 DOM、HTML 导出、文档导航、目录元数据、块拖拽和块链接，共 41 项测试、277 次断言通过。补充验证只读可折叠，折叠不产生 Yjs 更新，动态卸载不破坏协作撤销。
- `pnpm typecheck`、`pnpm icons:verify`、`pnpm i18n:verify`、`pnpm architecture:verify` 和改动 TypeScript 文件的 ESLint 检查通过；`git diff --check` 通过。
- 真实服务端文档验证：父子章节独立折叠、刷新后状态保留、目录打开/关闭及定位、搜索匹配自动展开、键盘轨道入口和 Escape、窄屏浮层避让；浏览器控制台无错误。检查结束恢复正文展开状态。
- Web `http://localhost:3001` 与业务服务 `http://localhost:8721` 保持运行，Web/Bun 源码热更新继续生效。界面截图保存在仓库外的本次可视化目录，不纳入提交。
