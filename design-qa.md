# AI 界面验收

日期：2026-11-08。结果：**passed**，保留文档阅读字号与现有产品共享交互规范。

参考：用户提供的五张生成菜单 / 空态 / 思考 / 流式 / 完成态图片。实现是现有 Fob 产品内的真实功能。业务设计见 [知识助手](docs/knowledge-assistant-agent.md)，自动验证与真实调用证据见 [.spec 记录](.spec/tasks/knowledge-assistant-agent.md)。

## 环境与证据

先尝试内置浏览器，遇到脚本加载和 Chrome 控制故障；用户明确允许改用本地 Playwright 后，使用独立 Chrome 测试上下文、合成账户及隔离知识库完成验收。桌面视口 1600 × 900，窄屏 600 × 850、390 × 844，截图按 CSS 像素保存，未将截图缩放伪装为一致。

本地截图位于忽略的 `.runtime/dev/`，未提交运行快照或认证状态：

| 状态 | 证据 |
| --- | --- |
| 空态、胶囊和发送按钮 | `ai-empty-final.png`、`ai-empty-dark.png` |
| 思考 | `ai-thinking-empty-final.png` |
| 实际流式尾段 | `ai-streaming-tail-final.png` |
| 完成、蓝色真实选区和采纳条 | `ai-review-final.png` |
| 菜单分组与 AI 前置 | `ai-slash-final.png`、`ai-slash-narrow.png` |
| 设置页及真实连接成功 | `ai-settings.png`、`ai-settings-connected.png` |
| 知识助手、真实来源及插入审阅 | `ai-agent-answer.png`、`ai-agent-ui-answer.png`、`ai-agent-inserted.png` |
| 窄屏输入、停止后的草稿 | `ai-mobile-empty.png`、`ai-mobile-review.png` |
| 深色 | `ai-empty-dark.png` |

`ai-compare-empty.png`、`ai-compare-thinking.png`、`ai-compare-review.png` 将原图与实现内容区域放在同一张图中比对。比对后修复输入聚焦黑边、全局建议侧栏重复打开、绿色建议下划线、完成未自动选择，以及星形数量；最终改用官方五角轮廓 Star，保持集中图标目录。处理中的输入固定为单行高度，长提示只在编辑时展开。

## 视觉与交互结论

- 空态 190px、16px 圆角和浅虚线；胶囊最大宽 576px、最小高度 54px，黑色圆形发送 / 停止按钮，柔和阴影。移动端按视口缩小并保留完整点击区。
- 完成态使用浅灰实线框、蓝色原生文字选区和下方悬浮「撤销 / 提出修改要求 / 采纳」。正文继承用户当前文档字号，避免改写阅读偏好；没有额外的全块选中背景。
- 真实修改生成后选中新的文本；独立块采纳与原生撤销经过 UI 验证。全局审阅不消耗块内草稿。
- 实际移动端生成 → 停止后保留部分正文；390px 视口下审阅条 x=121、宽=201，位于视口内，三个按钮可访问。空态容器宽 225、输入宽 137，无横向越界。
- 助手输入与发送区域避让现有精灵，真实发送按钮和键盘 Enter 都可工作。Markdown 不执行 HTML，不加载模型返回的远程图片，来源跳转使用经过验证的页面 / 块。
- 设置、助手、菜单均使用真实加载和错误状态；图标和国际化验证通过。深色控件、占位文字及选区保持对比。

## 问题与处理

开发期间连续跨文件热更新触发 Next CSS HMR 的重复样式替换及 `removeChild` 异常，完整刷新恢复；未将这些开发日志伪装成业务通过。最终稳定页面重新加载后捕获的 pageerror 列表为空，标题值正确，截图为 `ai-empty-current.png`；生成流程亦曾记录 0 个 console error，仅保留头像 LCP 提示和编辑器选区相关开发 warning。生产构建独立通过。受控组件 / 权限 / 流式协议和真实协作回归与浏览器验收共同构成证据。

没有因权限或配置依赖而虚构界面结果；本机库未支持 AI、未部署的 Ollama 和向量模型依赖均明确记录。
