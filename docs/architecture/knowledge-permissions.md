# 知识库、文件夹与文档权限

本文件是当前权限设计与 Outline 对齐审计，日期 2026-11-07。基准为仓库内 `opensource/outline` 的现有源码，不宣称上游最新版本。成员界面规范见 [成员页](../ui/knowledge-base-members.md)，文档协作见 [文档协作](../document-collaboration.md)，执行证据保存在 `.spec/tasks/knowledge-base-members.md`。

## 模型与边界

一个 Fob 知识库对应一个工作空间、成员目录和权限边界。Outline 的 Team 映射到知识库，Collection 映射到文件夹，Document 映射到页面。数据库、认证、对象存储、服务运行和命名空间仍为 Fob 自有；不连接 Outline 的数据库或认证。

工作空间角色与资源权限是两个轴。一个编辑者可以在甲文件夹编辑、乙文件夹查看、丙文件夹没有访问权；改变工作空间角色不会把个人授权批量改写。

| 工作空间角色 | 默认能力 | 单独资源授权 |
| --- | --- | --- |
| 所有者 `owner` | 管理知识库、成员目录、邀请、角色与根文件夹 | 仍需实际正文访问权，不能绕过私有文档 ACL |
| 管理员 `admin` | 使用已授予的文件夹默认访问，不授予全库成员管理或私有元数据能力 | 按实际资源级别查看、编辑或管理 |
| 编辑者 `member` | 使用文件夹给普通成员的默认访问 | 个人授权可提升默认级别 |
| 查看者 `viewer` | 默认访问最高为查看，不能因默认编辑而获得写能力 | 显式编辑／管理可以提升，按当前成员角色实时计算 |
| 访客 `guest` | 不继承知识库默认访问 | 仅通过个人、历史分组或文档祖先授权访问；明确编辑授权可编辑并在授权位置创建文档 |

Fob 保留已有 `owner` 身份用于知识库所有权、删除与最后所有者保护；在内容权限计算中它不绕过私有文档 ACL。这是兼容扩展，不把“所有者”作为普通角色下拉项或邀请目标。

资源新授权只有三级：`view`（可查看）、`edit`（可编辑）、`full`（可管理），对应 Outline 的 `read`、`read_write`、`admin`。历史存储 `comment` 保留读取兼容，认证成员显示为查看；评论是阅读后的功能能力，不再作为新个人授权级别。采用 Outline 默认的成员可评论策略，访客不能评论，公开只读链接也不会获得评论能力。

## 授权合成

每个主体的文件夹授权和文档祖先授权取较高级别，再与允许该工作空间角色使用的默认值合成。低级个人授权不是拒绝规则；删除它不能撤销更高的继承授权。访客不展开知识库主体；查看者计算编辑／管理时排除知识库默认主体，仍接受个人及既有分组的明确授权。

创建文件夹会在同一事务为创建者建立个人管理授权；新知识库的默认文件夹和显式本机导入路径使用同一规则。降低或删除现存最后一个文件夹管理授权会失败。已有无人管理的旧策略不被自动扩权。

Fob 现有嵌套文件夹可明确继承父文件夹默认值和个人授权；独立文件夹形成边界。文档的 `inheritsPermissions=false` 继续清空祖先和文件夹输入，随后应用该页面的个人 ACL。Outline 的文档成员继承采用正向叠加，并不提供完全相同的独立页面边界；本次不删除 Fob 已存在的隐私边界，不以对齐名义开放旧私有内容。

## 可见数据与操作

| 入口／操作 | 当前规则及修正 |
| --- | --- |
| 文件夹目录、详情、搜索 facets | 仅所有者可看全库元数据；其他人（包括管理员）必须有实际文件夹访问权，过滤在分页前执行；不因普通成员身份列出全部私有目录 |
| 文档列表、搜索、正文、AI 读取 | 使用真实成员／分组主体及当前代次 ACL；授权过滤在分页、排名与计数前执行 |
| 直接分享私有文档 | 可以阅读该文档及按继承规则允许的后代，不因此获得整个文件夹目录；搜索、成员权限弹窗及分享来源都隐藏无权查看的文件夹／祖先名称 |
| 编辑／创建 | 需要目标文档编辑权或目的地文件夹编辑权；个人提权、查看者、访客使用同一决策，API 与 AI 创建均检查目的地 |
| 移动／回收文档 | 源文档编辑权；跨文件夹移动另需目的地编辑权，不再额外要求源文档管理级别 |
| 恢复文档 | 非访客、非查看者，且当前真实授权仍能编辑；从当前文件夹及祖先授权计算，不恢复旧缓存，不按曾经拥有权限放行 |
| 管理文档成员 | 先可阅读正文，再要求文档管理、文件夹管理或所有者身份；管理员称谓不产生资源权限 |
| 文件夹改名、默认值和授权 | 知识库所有者或该文件夹管理者；文件夹移动仍限知识库所有者 |
| 附件下载 | 所有角色都必须可阅读实际引用该附件的文档；知道哈希、属于该知识库或拥有全局管理身份均不能直接读取私有附件 |
| 附件上传／全库资产撤销 | 上传要求所有者身份或实际编辑位置；查看者仅默认可读时不能上传。全库资产撤销限知识库所有者，删除文档中的引用是文档编辑操作 |
| 公开发布 | 与管理成员分开，保留 Fob 的非访客资源管理级门禁；过期条件必须与同一页面、未撤销条件整体合取，不能选出另一页面或已撤销的链接 |
| 订阅与通知 | 创建订阅和生成通知检查当时访问权；读取通知及未读计数再次检查当前目录／文档访问，撤权后不保留私有名称 |

Fob 当前仅允许所有者创建根文件夹、读取与管理全库成员目录和邀请外部账户，可视为 Outline 关闭对应组织偏好的配置；本次不新增组织偏好设置页。公开发布继续要求管理级，较 Outline 的部分编辑者分享路径更严格，界面不把“可管理成员”误当成“可公开发布”。文件夹管理者可创建其子文件夹。分组管理此前已退役，本次不重新增加分组产品；已有分组主体仍在服务端参与正向授权计算。个人集合、归档、组织暂停及付费策略没有等价产品能力，不伪造对应 UI 或状态。

## 与 Outline 的源码对照

| 设计依据 | 本地 Outline 源码 | Fob 实现 |
| --- | --- | --- |
| 设置成员目录、搜索、角色筛选、排序、徽标及行操作 | [Users](../../opensource/outline/app/scenes/Settings/Users.tsx)、[UsersTable](../../opensource/outline/app/scenes/Settings/components/UsersTable.tsx)、[用户操作](../../opensource/outline/app/hooks/useUserMenuActions.tsx) | `organization/members-section.tsx`；只显示实际支持的姓名、邮箱及加入时间 |
| 工作空间角色、三级资源权限 | [身份类型](../../opensource/outline/shared/types/auth.ts)、[权限类型](../../opensource/outline/shared/types/permissions.ts) | `shared/src/resources/index.ts`、`contracts/member-access.ts` |
| 默认值与个人授权分开，合成后解释结果 | [文件夹授权列表](../../opensource/outline/app/components/Sharing/Collection/AccessControlList.tsx)、[文档授权列表](../../opensource/outline/app/components/Sharing/Document/AccessControlList.tsx)、[权限合成](../../opensource/outline/server/utils/permissions.ts) | `folderAccessForMember`、`permissionForMember`、成员资源权限 GET/PATCH |
| 元数据与正文权限、查看者／访客、集合管理 | [Collection policy](../../opensource/outline/server/policies/collection.ts) | `organization/folder-access.ts`、`teamspaces.ts`、`api/page-route-guards.ts` |
| 文档阅读、编辑、评论、移动、删除、恢复和管理成员 | [Document policy](../../opensource/outline/server/policies/document.ts) | `permissions/authorization.ts`、`api/page-routes.ts`、`documents/service.ts` |
| 私有集合目录与最后集合管理者 | [User](../../opensource/outline/server/models/User.ts)、[UserMembership](../../opensource/outline/server/models/UserMembership.ts) | 权限过滤后的目录及 facets、`assertFolderManagerRetained` |
| 评论默认仅成员 | [默认偏好](../../opensource/outline/shared/constants.ts)、[CommentingAccess](../../opensource/outline/shared/types/team.ts) | 阅读成员可评论，访客和匿名只读链接保持禁写 |

这次审计修正了此前普通成员枚举私有文件夹、默认编辑误提权查看者、访客单独授权不能创建、全局管理员绕过私有创建目的地、单文档分享暴露文件夹名称、附件只检查知识库成员、旧订阅通知暴露已撤权目录，以及文档编辑与移动／回收权限不一致等问题。公开链接快照的过期 OR 条件也已改为明确分组，回归覆盖同库不同页面、旋转及撤销后不再选出旧链接。

## 事务、并发与撤销

写操作使用知识库 → 文件夹 → 文档的锁序，在等待锁后复核成员与会话。成员资源 PATCH 带资源版本，修改单一目标成员，保留其他授权；跨库 ID、伪造主体及版本冲突不产生部分写入。

文档授权修改同步重建目标子树。文件夹修改与权限围栏、索引清空及 outbox 在同一事务提交；继承子文件夹一起失效，Worker 按当前状态重建。旧代次文档和索引立即拒绝读取，重建延迟只影响新授予的可用时间。协作连接按当前权限复核，撤销阅读会断开，撤销编辑会停止写入。所有者检查成员文档同样受自己的实际内容访问限制。知识库邀请和会新增访客成员的文档邀请均仅所有者可生成、撤销；接受邀请时重验邀请者仍拥有所有权。成员目录及成员资源权限检查接口对所有非所有者一律拒绝；管理员不再具有隐含的文档授权、模板、资产与评论治理权限。文档协作的人员选择通过资源级 `page.people` 查询获得当前可访问者的姓名与头像，不读取全库成员目录。

已有数据库只执行增加查看者枚举的幂等升级，不重置数据、不重写现有成员或授权：

```powershell
bun --env-file=.env.fob.local backend/server/scripts/upgrade-outline-permissions.ts
pnpm database:status
```

初始 schema 与 `current.sql` 同步包含查看者。升级脚本使用 Fob 配置，不保存或打印连接凭据。涉及 UI、HTTP、真实 PostgreSQL／RLS、搜索、附件、通知、协作及匿名链接的验证证据见实施记录；不能以视觉相似替代权限回归。
