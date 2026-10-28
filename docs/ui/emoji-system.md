# Fob 默认 Emoji

用户选择 [shadcn.io 的 OpenMoji 视觉风格](https://www.shadcn.io/icons/openmoji)。Fob 使用 OpenMoji 17.0.0 的原版彩色 SVG 精选集，涵盖表情心情、手势心意、自然动物、食物日常、工作学习、活动出行、物品科技、符号标记 8 类，每类 56 个，总计 448 个，原始资源约 1.17 MiB。原有 400 个选项及各类内部顺序保留，每类再追加 6 个常用选项，正好铺满 8 列网格的 7 行。

## 资源与呈现

- `src/components/icons/openmoji-catalog.json` 维护这 448 个选择的 Unicode、上游 hexcode、中英文名称、检索词与分组；`emoji-catalog.ts` 提供检索和 Unicode 展示变体兼容。
- 本地原版资源在 `public/icons/openmoji/`，由 `sources.json` 固定版本、来源及 SHA-256；`scripts/sync-openmoji.mjs` 仅同步经过审阅的精选集，不加入完整图标包，不依赖运行时 CDN。
- 统一经 `@/components/icons` 的 `Emoji` 显示，沿用共享尺寸规则。已有 Unicode 持久值保持原样，精选集内的展示变体映射到同一图形，旧内容中未入选的 Emoji 保留原文字显示。
- 独立表情块、提示框、文档与文件夹的内容图标及共享表情入口使用同一资源集；系统导航和操作控件的普通图标继续按 [图标系统](icon-system.md) 选型。

## 选择器与编辑行为

- `EmojiPalette` 提供搜索、8 类浏览、8 列键盘导航、选中态和禁用态；搜索同时匹配 Unicode、中英文名称及上游关键词，搜索期间可跨当前分类定位结果。
- `EmojiPicker` 提供带触发器的共享弹层；文档图标选择器使用相同精选数据和渲染器。
- 评论、回复、编辑与选区快捷评论的表情卡优先向触发器左侧展开，并与底部操作行对齐，保留侧栏内容可见；空间不足时自动翻转或回退至上下方，并限制在视口内。Escape、点击外部关闭及回焦沿用共享弹层。
- `/表情` 或 `/emoji` 插入独立表情块，默认 😀，点击表情可从同一选择器更换；只读时仅显示内容。Unicode `value` 是持久值，更换保留块 ID，并沿用正文保存、协作和撤销；公共 Markdown 输出 Unicode，HTML 导出嵌入本地 OpenMoji。
- 提示框左侧只选择表情，右侧只选择语气/背景。切换主题保留已选表情；中英文名称、Emoji 值和块 ID 保持文档、撤销与导出兼容。

## 来源、许可与门槛

原始作品由 OpenMoji 及其贡献者创作，遵循 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。Fob 保留未修改的原版 SVG、资源目录中的署名说明，以及 `public/licenses/openmoji.txt` 的完整许可。

`pnpm icons:verify` 校验 448 个资源、8×56 的精选范围、固定上游 URL 和文件摘要，拒绝额外素材；新增或替换选项应同步审阅目录、来源清单与本规范。表情系统回归覆盖 Unicode 兼容、未入选表情回退、中英文检索、分类、键盘选择、只读与保存失败。
