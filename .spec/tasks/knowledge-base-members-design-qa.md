# 成员与文件夹权限 UX 对齐检查

日期：2026-11-04。当前设计：`docs/ui/knowledge-base-members.md`。

## 视觉输入与实际产物

逐对同时查看用户两张参考和 IAB 实际截图：

- 成员参考：`C:/Users/17335/AppData/Local/Temp/codex-clipboard-571b4748-a581-4b98-876e-349d36b24866.png`。
- 权限参考：`C:/Users/17335/AppData/Local/Temp/codex-clipboard-53aeb40c-b5ea-4618-a1bb-00de46fc20f8.png`。
- 实际截图目录：`C:/Users/17335/.codex/visualizations/2026/11/03/01a1a1e3-b195-7e50-9eb0-91bb01c97f88/`。
- 成员：`fob-members-aligned.png`、`fob-members-selected.png`、`fob-members-aligned-dark.png`、`fob-members-aligned-mobile.png`。
- 文件夹：`fob-folders-aligned.png`、`fob-folders-aligned-mobile.png`、`fob-folder-grant-dialog.png`、`fob-folder-inherit-dialog.png`。

## 检查结果

| 优先级 | 项目 | 最终结果 |
| --- | --- | --- |
| P1 | 群组删除与真实数据 | 仅有成员／文件夹权限两分区；成员列替换为真实加入日期，授权列使用真实成员。目录、人数、头像、日期及文件夹取自现有服务。 |
| P1 | 选择与反馈 | 最后一位所有者不可选；选择显示批量角色工具栏，取消清除。修正全局 plain 操作背景覆盖复选框的问题，最终 DOM 为黑底、白勾，`SelectionCheck` 实际 18px。 |
| P1 | 权限功能 | 默认权限、成员授权、继承、例外明细、有效权限查询均有真实数据和写接口。撤权、继承边界、移动、并发冲突、原子回滚及隔离由真实 PostgreSQL／Worker 集成测试验证。 |
| P2 | 尺度、布局与材质 | 保留唯一系统侧栏。标题 20px、控件 30px、表头 34px、成员行 48px、文件夹行 40px；单层细边框和灰表头，无额外卡片、侧栏或统计区。徽标使用少量语义色；文件夹轮廓使用集中登记的官方 Lucide。 |
| P2 | 弹窗与键盘 | 原生模态对话框约束焦点，关闭后回到邀请／授权入口；确认了方向键切换已加入／待接受。表单拒绝已有成员邮箱，未选成员时授权按钮原生 disabled。 |
| P2 | 深色与窄屏 | 深色所有者徽标为可读浅杏文字／深杏底。390×844 覆盖请求下实际页面约 410 CSS px，页面宽度同为 410；成员表 600px、权限表约 670px，仅各自 324px 容器内部横滚。 |

参考中的八位演示人物改为当前库实际两位成员；群组列改为加入时间／个人授权；继承和徽标按当前存储策略呈现。以上为任务明确要求及真实数据适配，不生成样例记录。

浏览器完成：成员姓名／邮箱搜索及无结果恢复、勾选／取消、批量角色菜单、待接受空态、键盘切换、邀请重复邮箱校验、文件夹搜索保留祖先、授权必填门禁、继承预览及取消、有效权限查询、浅深主题和窄屏。写操作在一次性测试数据库中执行并清理，开发库保留原权限与成员。

日志包含开发期间共享模块变更产生的 Fast Refresh 整页刷新提示、既有隐藏编辑器 `TextSelection ... callout` 警告及 `chrome-extension` sandbox/localStorage 错误；最终成员及权限流程无运行错误遮罩。最终恢复浅色、默认视口及展开导航，关闭临时 QA 页。

P0／P1／P2 无未处理项。

## 2026-11-05 边框、切换按钮与图标细化

- 成员、待接受邀请、文件夹权限共用的表格外框改为仅有上下 1px 边线，左右 0px、无外框圆角；行分隔线保留。
- 管理分区改为两个 30px 按钮，以 `aria-pressed` 表达切换，激活背景实测 `rgb(239, 239, 239)`；`::after` 为 `none`，没有下划线或通栏分隔线。桌面上留白 24px，窄屏 20px。
- “邀请成员”“查看有效权限”“添加授权”分别使用 FA7 `user-plus`、`eye`、`shield-halved`，按统一目录和尺寸渲染，图标不重复进入可访问名称。
- 继续用独立 Playwright Chromium（Browser 插件未列出，当前内置浏览器连接此前超时），1016×917 与 390×844、浅深主题复核。实际库来自两个临时测试账户，未修改用户当前库的成员或权限。
- 实测成员表和权限表左右边框均为 `0px`，成员表上下 `1px`；键盘 Enter 可切换分区，只有当前按钮为按下状态。邀请、有效权限和添加授权三个原生弹窗均正常打开及 Escape 关闭。
- 窄屏等待侧栏收起动画完成后，权限表 670px 内容在 305px 容器中横向滚动，整页不横向溢出；截图不使用动画中间帧。页面有真实内容，无框架错误遮罩，控制台 error/warning 均为 0。
- 现有成员页、成员列表及成员面板专项 12 项测试通过（54 个断言）；Web 类型、图标、lint、架构边界及迁移摘要检查均通过。
- 本轮截图保存在仓库外的 `C:/Users/17335/.codex/visualizations/2026/11/04/01a1a75b-5632-7aa0-a2e2-e14e6bf24d97/`：`fob-members-polished.png`、`fob-permissions-polished.png`、`fob-permissions-polished-dark.png`、`fob-permissions-polished-mobile.png`，以及两张紧凑 detail 截图，不提交截图或运行快照。
