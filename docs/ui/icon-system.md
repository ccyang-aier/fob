# Fob 图标系统

本规范适用于当前 Fob 仓库的所有产品 UI；替代早期 Phosphor、混合图标资源及自绘 UI SVG 方案。

## 来源与入口

- 默认使用 [Font Awesome 7 Solid](https://www.shadcn.io/icons/fa7-solid)，官方 `@fortawesome/free-solid-svg-icons`，以官方 React 组件渲染，固定版本。多个候选时优先圆润、饱满、轮廓简单且小尺寸易识别的造型，避免复杂细节和无意义的外框。
- 只有明确需要轻量轮廓的控制，使用 [Lucide](https://www.shadcn.io/icons/lucide)。不把导航实体、通知、设置等默认退回轮廓风格，也不把所有动作一刀切成厚实图标。
- 业务组件只从 `@/components/icons` 引用。官方依赖、语义映射及轮廓例外集中在 `src/components/icons/index.ts`；渲染和尺寸在同目录的 `solid-icon.tsx`、`metrics.ts`。
- 不新增第三套图标包、远程图标服务、混合 PNG 图标包、手写 SVG/path 或用 CSS 给轮廓图标强制填色。用户上传图片、用户文档内容、Emoji 和产品品牌图形是内容资源，不能作为引入另一套 UI 图标的借口。
- shadcn CLI 的 `components.json` 保持 `iconLibrary: lucide`，用于生成轻量基础控件；生成后仍须把导入收口到本地目录，按语义选择 FA7 或已批准的 Lucide。

## 语义与候选

| 用途 | 选择 |
| --- | --- |
| 文件夹/文档/标签 | FA7 `folder` / `file-lines` / `tag` |
| 成员/模板/设置/帮助 | FA7 `user-group` / `table-cells-large` / `gear` / `circle-question` |
| 咖啡/通知/分享 | FA7 `mug-saucer` / `bell` / `share-nodes`；咖啡不另加底色容器 |
| 前进后退/对外打开/更多 | Lucide 细线箭头、`ExternalLink`、`Ellipsis`；更多是独立三点 |
| 主导航收纳 | Lucide `PanelLeft`，不再维护自绘变体 |
| 折叠/切换器 | Lucide `Chevron*` / `ChevronsUpDown`；滚动条方向箭头等确需三角的位置才用 FA7 caret |
| 加减/关闭/勾选/缩放/刷新 | Lucide 对应简单控制符号 |
| 搜索/分栏/加载/复选框边界 | 已登记的 Lucide 轮廓控制；不增加厚重外框 |
| 星标/点赞等切换状态 | 未选中 Lucide 轮廓，已选中 FA7 Solid，保留状态含义 |
| H1/H2/H3 等编辑指令 | 保留区别明确的 Lucide 标题级别；其他格式、媒体和资源类型使用 FA7 对应语义 |

轮廓例外必须在集中目录中明确导出并在此记录用途；不能在业务组件随手导入。旧语义名称可作为兼容别名，实际几何必须来自上述官方包。文件夹与页面图标的持久化 ID、颜色、Emoji 继续兼容已有数据。

## 尺寸与材质

| 场景 | 尺寸 |
| --- | --- |
| 默认工具/系统操作 | 14px |
| 菜单、资源树、紧凑列表 | 12px |
| 折叠、切换器、辅助指示 | 10px |
| 空状态、内容图标预览、资源插图 | 原数字尺寸统一减 2px，例如 24→22px、48→46px；仍按容器与用途验证 |

共享渲染器使用固定方形框并保留官方路径比例。`ICON_SIZES` 与调用方的 `size` 保留原有布局请求：16/14/12 三档；渲染边界统一减 2px，实际显示为 14/12/10px。原 18–20px 请求先归常规档，13–15px 归紧凑档，12px 及以下归指示档，再统一缩小；大于 20px 的明确数字预览尺寸同样减 2px，Emoji 走同一尺寸解析。避免在业务组件再次减小请求值、依赖父级字号或任意 CSS 放大。大尺寸只供插图和内容预览，不能用于普通工具按钮。

Lucide 线宽固定 1.75，避免导航箭头和更多过粗。图标使用现有语义/功能颜色与 `currentColor`；保留主页、星标、草稿、回收站的浅彩色。按钮点击区与图形尺寸分别控制，不能为缩小图形而缩小可操作范围。

## 实现与检查

使用官方 [React 接入方式](https://docs.fontawesome.com/web/use-with/react/)，逐个导入 FA7 定义以支持 tree shaking；不导入整套 `fas`，不运行时下载图标。FA CSS 仅在根样式的 components layer 加载一次，禁用自动注入。

Font Awesome Free 图标由 Fonticons, Inc. 提供，官方许可文本保留在 `public/licenses/fontawesome.txt`，源定义与名称保持官方归属。

新增图标时先检查集中目录已有语义，确认候选简单且适合 12/14px，再登记导出和用途。完成后执行 `pnpm icons:verify`、类型检查、lint，并在真实页面检查浅深色、收起状态与可访问名称。该检查已并入 lint，阻止第三方直引、旧 Phosphor/混合资源与手写 UI SVG 回流。

验证证据保存在 [.spec/tasks/fob-fa7-icons.md](../../.spec/tasks/fob-fa7-icons.md)。
