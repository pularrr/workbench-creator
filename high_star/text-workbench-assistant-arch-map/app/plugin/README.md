# KnowMap 插件

执行说明见 [SKILL.md](SKILL.md)。构建层交付新应用，运行时层在已建应用内问答和扩展图谱。

```sh
npm install
node scripts/knowmap.mjs discover
node scripts/knowmap.mjs profile-example --output ../my-topic-build/profile-example.json
```

以上命令在完整项目根执行，但所有产物必须写入项目根之外的新隔离目录。随后由宿主 LLM 按 SKILL 的七步流程直接编写 Profile、MVP 和 full 网络，再使用项目命令做确定性校验、脚手架、注入与验收。

跨 LLM 接入：导入 discovery.mjs 的 discoverKnowmap()，让具备本地工具的宿主注册返回的 name/description/inputSchema；执行映射到 scripts/knowmap.mjs 的 runKnowmap。不同平台需由宿主适配工具封装，这不是自动安装、远程 MCP 服务或所有提供商兼容声明。

构建阶段严禁使用项目已经配置的 DeepSeek 或其他 Provider；宿主 LLM 自己生成内容。API Key 不写进 Profile、脚手架或任务文件，只能由用户在独立应用交付后自行配置。13栏目是可选渲染词表，Profile 必须按任务选择子集。

实现限制、审查计划和验证结果见 ../docs/plugin-audit-plan.md、../docs/plugin-audit-results.md。
