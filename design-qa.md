# AI 界面验收

日期：2026-11-08。用户指出首版尺寸过大、设置结构不合理后，重新验收紧凑版和多服务商配置；首版截图不作为本次视觉通过的依据。保留文档阅读字号与现有产品共享交互规范。

参考：用户提供的五张生成菜单 / 空态 / 思考 / 流式 / 完成态图片。实现是现有 Fob 产品内的真实功能。业务设计见 [知识助手](docs/knowledge-assistant-agent.md)，自动验证与真实调用证据见 [.spec 记录](.spec/tasks/knowledge-assistant-agent.md)。

## 环境与证据

用户已允许本地 Playwright 验收，使用独立 Chrome 测试上下文、合成账户及隔离知识库。紧凑版桌面视口 1130 × 917，窄屏 390 × 844，截图按 CSS 像素保存，未将截图缩放伪装为一致。

本地截图位于忽略的 `.runtime/dev/`，未提交运行快照或认证状态：

| 状态 | 证据 |
| --- | --- |
| 空态、胶囊和发送按钮 | `ai-block-compact-empty.png` |
| 思考 | `ai-block-compact-thinking.png` |
| 完成、真实选区和采纳条 | `ai-block-compact-review.png` |
| 菜单尺寸与统一四形图标 | `ai-slash-refined.png` |
| 两个服务商、独立模型与默认选择 | `ai-providers-refined.png` |
| 指定个人服务商的真实问答 | `ai-assistant-selected-provider.png` |
| 窄屏设置 | `ai-providers-mobile.png` |
| 窄屏生成审阅 | `ai-block-compact-mobile.png` |
| 深色协议菜单 | `ai-providers-dark-menu.png` |

用户再次指出四角 Sparkle 与原图不一致后，生成星按最早原图改为五角斜星与右下长尖，使用固定摘要的共享参考组件；不再用“最接近的官方星形”代替。可视化仍为官方 Diamond/Circle/Triangle/Square 四格组合，两者等效标准画布线宽 1.75。处理中的输入固定为单行高度，长提示只在编辑时展开。

## 视觉与交互结论

- 菜单实测 360 × 400px，行高 32px、字号 13px。空态实测 120px、10px 圆角和浅虚线；胶囊实测 420 × 38px，发送按钮 30 × 30px。没有通过缩放整个组件实现。
- 完成态使用浅灰实线框、蓝色原生文字选区和下方悬浮「撤销 / 提出修改要求 / 采纳」。正文继承用户当前文档字号，避免改写阅读偏好；没有额外的全块选中背景。
- 真实修改生成后选中新的文本；独立块采纳与原生撤销经过 UI 验证。全局审阅不消耗块内草稿。
- 完成条实测 264 × 38px，真实生成短句后「采纳」移除容器、保留普通正文。设置控件实测 30px 高、13px 字号，原生 select 数量为 0。
- 浏览器实际创建两套不同协议服务商，保存独立模型；刷新后快速/深度分别保留 GLM Flash / GLM Research。智谱连接测试成功，读取实际模型目录，搜索 flashx、添加并保存后刷新仍保留。
- 使用测试密钥的第二个服务商显示真实失败；删除它仅清理其深度默认关联，快速模型和另一个服务商保留。助手显式选择模型的请求携带对应 connectionId/modelId，并完成真实带来源问答。
- 窄屏最初发现固定设置侧栏挤压配置区，已改为顶部四分区导航；配置区实测宽 324px 且无横向溢出。修复审阅胶囊内部按钮越界后，390px 视口实测胶囊 226 × 36px，三个按钮均被胶囊完整包住；真实生成与 fresh navigation 未产生 pageerror。
- 助手输入与发送区域避让现有精灵，真实发送按钮和键盘 Enter 都可工作。Markdown 不执行 HTML，不加载模型返回的远程图片，来源跳转使用经过验证的页面 / 块。
- 设置、助手、菜单均使用真实加载和错误状态；图标和国际化验证通过。深色控件、占位文字及选区保持对比。

## 问题与处理

开发期间连续跨文件热更新触发 Next CSS HMR 的重复样式替换及 `removeChild` 异常，完整刷新恢复；未将这些开发日志伪装成业务通过。最终稳定页面重新加载后捕获的 pageerror 列表为空，标题值正确，截图为 `ai-empty-current.png`；生成流程亦曾记录 0 个 console error，仅保留头像 LCP 提示和编辑器选区相关开发 warning。生产构建独立通过。受控组件 / 权限 / 流式协议和真实协作回归与浏览器验收共同构成证据。

没有因权限或配置依赖而虚构界面结果；本机库未支持 AI、未部署的 Ollama 和向量模型依赖均明确记录。

## 生成星形修正

原参考为用户的 `codex-clipboard-888ddb18-f3e6-48b8-8892-e467df95c1af.png`，不是随后指出错误版本的四角星截图。五角、斜向和右下长尖的原尺寸及 4 倍并排核对见 `.runtime/dev/generate-icon-shape-compare.png`；右侧直接渲染产品 `GenerateStar` 组件。菜单和空态使用相同 SVG 几何，布局与控件尺寸保持紧凑版。图标规则仅增加这个用户指定且固定摘要的例外。

## AI 助手悬浮重构

实际查看 Dribbble 上 [AI Agent chat widget](https://dribbble.com/shots/24512905-Chat-widget-for-AI-Agent)、[AI agent widget](https://dribbble.com/shots/25829668-AI-agent-widget-Daily-Design-29) 的图片，取其消息层级、贴底输入和轻量快捷提示，不复制宣传画布、渐变或品牌素材。单独子代理完成五项布局评估与机械预扫描（JSON `[]`），合并确认固定侧栏、控件堆叠及精灵补偿 80px 是主要问题。

| 对照项 | 修正与真实证据 |
| --- | --- |
| 右侧固定栏挤压正文 | 改为 400 × 600px 可拖拽窗口；1119 × 917 视口打开前后正文均宽 676.8px |
| 输入框悬在半空 | 输入区贴窗口底部；删除 80px 补偿，模型/资料范围/档位/发送合并为一条紧凑工具栏 |
| 右下精灵挡发送 | 实际复现 Playwright pointer interception；改用独立 manual popover 后，最右下位置和设置关闭后均通过命中检测并实际发送 |
| 历史空白与原生确认 | 搜索无结果明确显示空态，删除使用共享 AppAlert 确认；取消不会调用删除 |
| 窄屏和键盘 | 390 × 320 模拟键盘视口下窗口 374 × 304px，输入最高 76px，发送在 y=267–295，菜单完整可见，无横向溢出 |

真实模型回答了合成文档的负责人和日期并带引用；实际停止流式回答保留了已有正文。拖拽四角、方向键移动、重开位置恢复、外部编辑保持打开、切到成员页隐藏、模型菜单及 AI 设置的 Escape 隔离均经过 UI 操作验证。通过真实 Fullscreen API 进入/退出全屏后，宿主按事件移动且草稿仍保留；无原生 popover 的回退及原生模态重排另有自动回归。

当前截图为 `.runtime/dev/assistant-floating-empty.png`、`assistant-floating-window.png`、`assistant-floating-answer.png`、`assistant-floating-stopped.png`、`assistant-floating-mobile.png`、`assistant-floating-keyboard.png` 和 `assistant-floating-dark.png`。连续跨模块热更新期间曾出现样式短暂失效，稳定刷新后重新验收；不以开发热更新中间态作为最终界面通过依据。

最终稳定刷新后，URL/页面标题正确、正文有真实合成内容，无框架错误覆盖层，pageerror 与 console error 均为空；打开助手前后正文边界相同，窗口默认位置为 x=695/y=104、400 × 600px。生产构建、类型、ESLint、图标、国际化和架构检查通过。浏览器插件不可用，沿用用户已明确允许的本地 Chrome / Playwright 验收；键盘高度使用视口模拟，不声称物理手机验收。
