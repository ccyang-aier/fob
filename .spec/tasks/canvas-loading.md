# 知识画布加载动画

## 2026-11-08

- 替换 CanvasSpinner 原有带底座的旋转图标，改为直接置于画布的三条错位舒展细线与小号状态文案。复用主题、UI 字体和原有调用接口，文档权限／元数据／会话与知识资源加载同步采用同一呈现；错误、拒绝访问和登录跳转未改动。
- 使用 impeccable 的 product／animate 规范，按现有产品上下文执行局部设计；无新动画依赖、CSS 图标或手写 UI SVG。动画只改变 transform／opacity，默认状态始终可见；减少动态效果时静止展示。加载时长、权限边界和文档就绪判断不增加延迟。
- TypeScript、修改文件 ESLint、图标规范通过；原编辑器状态、真实 Y.Doc 编辑器实例及数据库访问／交互回归合计 34 tests／185 assertions／0 fail。没有添加样式镜像测试。
- Browser plugin not available；通过 CUA Playwright 打开仓库外 Bun 预览服务，真实导入 CanvasSpinner 并服务端渲染，加载该组件的实际 CSS 及产品主题令牌／全局样式。该预览用于稳定观察瞬时加载态，没有在用户会话中注入延迟、改写权限状态或正文。浅色／深色下确认 role=status、真实文案、0px 边框、透明背景和无阴影，三条细线均按 1.6s 动画运行；样式提供减少动态效果的静态替代。
- 预览脚本与 document-loading-light.png、document-loading-dark.png 位于仓库外 visualizations；不提交临时预览服务、截图或运行数据。
- 最终预览复用应用真实字体栈与 Next 全局样式；浅深色均无浏览器 console error／warning。360×640 的实际 iframe 视口中，加载区和文档 scrollWidth 均为 360px、scrollHeight=640px，没有横向溢出；已关闭验证页签并停止临时预览服务。减少动态效果的替代由 CSS 媒体规则提供，本轮未修改系统偏好。
- 架构边界及差异检查通过；Web 3001 与业务服务 8721 保持运行。
