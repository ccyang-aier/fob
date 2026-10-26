# 工作页签外观

激活页签沿用现有 32px 高度、8px 圆角和细边框，背景使用共享 `--shell-tab-active-bg: var(--panel)`，浅色为纯白，深色随面板主题适配。非激活页签常态背景透明、无边框，悬停仍使用共享 `fob-action` 反馈；关闭按钮保留独立反馈。切换、键盘焦点、关闭、拖动及滚动行为保持原有交互。

验证记录见 [.spec/tasks/workbench-tabs.md](../../.spec/tasks/workbench-tabs.md)。
