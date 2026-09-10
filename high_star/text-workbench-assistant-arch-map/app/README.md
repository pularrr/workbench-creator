# 知识图谱 AI 应用

本应用由 KnowMap 脚手架生成。主题和根节点配置在 profiles/active.json，页面配置在 app/config.ts。

先在原插件项目中完成知识审查与 inject，再启动应用：

```sh
npm install
npm run type-check
npm test
npm run build
npm run dev
```

首次没有注入数据时，应用从所选 Profile 的根和域生成骨架。运行时内容存储于 data/runtime/knowledge-state.json，此文件包含状态封装和 checksum，不能用裸网络 JSON 替代。

无 Key 可浏览、查看卡片并使用离线问答；联网聊天与研究需要在“设置 · AI 配置”设置兼容 Responses 协议的提供商。已有知识更新走研究、审查、用户确认，保留版本与审计。

当前 app 内含通用引擎、Profile 和插件执行说明；FMCW 静态参考数据保留用于兼容现有模块，不作为非 FMCW 应用的运行时种子。自定义主题隐藏 FMCW 基准扩充入口。

本目录不递归包含 templates/app；需要生成另一个应用时，请使用原始完整插件项目的 scripts/create-app.mjs。

npm test 验证当前 Profile 和状态持久化往返。测试通过不能替代真实提供商的知识质量验收。核心引擎与 API 在脚手架运行时取原项目当前版本，模板主要承载页面、配置占位符和初始数据逻辑。
