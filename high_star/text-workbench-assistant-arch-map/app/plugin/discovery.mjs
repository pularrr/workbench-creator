/** Host-neutral discovery. The host registers the descriptor and supplies local tool access. */
export function discoverKnowmap() {
  return {
    schemaVersion: "knowmap-discovery/1",
    name: "knowmap_plugin",
    description: "从用户主题设计 Profile，生成并确认 MVP，研究完整知识网络，校验后交付可运行的知识图谱应用。已有应用内问答请使用运行时 API。",
    inputSchema: { type: "object", properties: {
      action: { type: "string", enum: ["profile-example", "validate-profile", "sync-budget", "plan", "validate", "inject"] },
      input: { type: "string", description: "本地 JSON 输入文件绝对路径；profile-example 可省略" },
      output: { type: "string", description: "新的输出文件；inject 时为已有应用目录" },
    }, required: ["action", "output"], additionalProperties: false },
    entrypoint: "node scripts/knowmap.mjs <action> --input <json-file> --output <path>",
    skill: "plugin/SKILL.md", scaffold: "node scripts/create-app.mjs --profile-file <profile.json> --name <name> --output <directory>",
    hostResponsibilities: ["宿主 LLM 直接生成 Profile、MVP 和完整 network JSON。", "MVP 预算验收后必须用 sync-budget 将批准预算写回 Profile，再生成 full。", "构建期不得调用项目 data/runtime/llm-config.json 或环境中的付费 Provider。", "所有中间产物和新应用必须位于项目根目录之外的新隔离目录。"],
    requirements: { localTools: true, node: ">=22.13.0", dependencies: "npm install" },
    limits: ["宿主必须显式注册此描述或加载 SKILL.md；模型不会自行扫描磁盘。", "13 个栏目是当前渲染器支持的分类词表，不是每个任务必须填满的模板；宿主按任务选择子集。", "API Key 仅由用户在生成应用交付后配置。"],
  };
}
export default discoverKnowmap;
