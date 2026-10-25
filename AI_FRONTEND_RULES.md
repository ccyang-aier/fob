# AI 前端规则

沿用已有布局与共享控件；局部 CSS 只负责布局，不重复定义全局交互颜色。参考图明确时，准确还原造型、线宽、尺寸、材质、圆角和间距。

1. **输入与文案**：输入框、文本域、选择框及外层焦点只变边框，不加阴影、ring 或 outline；placeholder 统一 `--muted`。保留操作提示、真实状态、错误与风险，删除重复标题、功能介绍及实现细节；普通业务页复用系统历史导航，不重复加面包屑。
2. **共享交互**：中性操作复用 `Button`、`DropdownMenuTrigger` 或 `fob-action`，由 `components/ui/interaction-states.css` 管理。工具按钮 `data-surface="plain"` 常态透明，hover 用 `--interaction-hover-bg`（浅色 `#fafafa`），展开/选中用 `--interaction-active-bg`（`#efefef`）；`"muted"` 常驻浅灰底，hover/激活用灰白底。侧栏共用这两种反馈，深色用对应灰度；反馈即时，无背景过渡。菜单展开依赖 `aria-expanded`，避免 Tooltip 改写的 `data-state`。
3. **菜单与指针**：点击项用手形指针，输入、拖拽、缩放和禁用用对应指针；轻量保存不闪禁用光标。每级菜单只高亮当前交互行，新鼠标/键盘目标优先于旧展开/选中态，无其他目标时保留展开入口高亮。使用 `globals.css` 的 `--menu-*` 与 `fob-menu-item`；危险操作常态红色，hover/键盘高亮红底，警示用对应语义色，图文保持对比度。菜单靠外点/Escape 关闭，不加无用标题、说明或关闭图标；可增长选项支持搜索，少量固定操作不加搜索。“全部”保留 ARIA 选中语义，不加粗。
4. **侧栏与描边**：浅色侧栏固定 `#f9f9f9`，材质和导航行只从根 `globals.css` 加载，使用 `--wt-sidebar-*`、`--sidebar-row-*`，不做白底浮卡。鼠标离开即清除 hover，普通鼠标焦点不残留高亮，分区标题仅 hover 显底条，键盘定位用边框。控件描边用 `--control-border`，资源卡片用 `--resource-card-border`；实际检查背景、hover 和选中态。
5. **组件与加载**：视图切换复用 `ViewSwitcher`，列表左、卡片右；hover 只变底色，保留图标色，不另加选中描边。筛选/排序入口回焦无 ring、outline、阴影或边框渐变。资源卡片复用 `resource-card.module.css` 单层描边，不加阴影或悬浮位移。模态底栏按钮统一 30px。按钮忙碌用 `Button loading`/`aria-busy` 或 `ButtonLoading` 三点动画，保留内容占位及可访问名称，阻止重复提交；非按钮加载另行处理。
6. **消息反馈**：全局操作反馈通过 `useAppAlert` 发布，由根部唯一宿主显示底部居中深色 Toast，不自建通知 DOM、样式或计时器。持续认证/权限/操作错误复用 `AppAlert` 材质与语义，保留恢复入口；字段校验、内容加载和危险确认各司其职。
7. **分隔与拖拽**：分隔用 `--separator-width`（1px）和 `--separator-color`，`--line`、侧栏边界同色，相邻面板仅一条边界。缩放复用根部 `components/ui/resize-handle.css`、`fob-resize-handle`；hover、按下、键盘焦点及拖动均即时显示 `--drag-indicator-color` 黑色、`--drag-indicator-width` 2px 线，无颜色/透明度/线宽过渡，按方向使用 `col-resize`/`row-resize`。离开点击区用 `data-resizing="true"` 保持，仅当前拖动手柄高亮；重排插入线沿用相同令牌，无效操作说明原因。
8. **配色**：通用导航、按钮、选中和焦点用黑白灰；`--accent*` 是固定中性强调色，实色面搭配 `--accent-foreground`，不增加彩色主题、取色或主题色偏好。保留语义、内容、品牌、图表及已定义功能色（如 SQL、字段类型、格式工具、链接、AI 块），用专属令牌，禁止按控件名称批量去色或让主题令牌隐式控制类型/语法色。AI 快捷操作和引用的明亮浅蓝反馈，以及 skills/MCP/plugins/prompts 的浅绿/浅杏橙/浅蓝/浅玫红类型色保留。
9. **Tooltip**：复用共享组件，无箭头，使用 `--tooltip-bg`、`--tooltip-ink`；浅色主题用深色提示，深色主题用浅色提示，辅助文字同样可读。菜单资料提示延迟显示于当前行上下方并稍横向错位，不遮行、不接收鼠标，不改变菜单尺寸或滚动位置。
10. **图标**：全系统使用清晰、圆润、等粗的线性轮廓图标，圆角线帽、留白和尺寸一致，不用灰色双色局部填充。主页、星标、草稿、回收站沿用 Dense 浅彩色实心图标，折叠按钮复用 Dense 圆角收纳造型；激活仅改变行反馈。品牌、用户内容、状态及专业编辑图标保留各自含义。
