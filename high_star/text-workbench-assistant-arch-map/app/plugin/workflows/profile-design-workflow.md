# Step 1：设计并验证 Profile

执行者：宿主 LLM。输入：主题、范围、可选资料。输出：TaskProfile JSON。读取 [Profile 提示词](../prompts/profile-design-prompt.md) 和 ../contracts/task-profile.ts。

1. 在 KnowMap 项目根目录之外新建本任务专用目录。需要参考时执行：
```sh
node scripts/knowmap.mjs profile-example --output <隔离任务目录>/profile-example.json
```
2. 宿主根据用户主题和当前任务直接编写 `<隔离任务目录>/profile-draft.json`。禁止调用 `design`、项目 ProfileDesigner、`/api/profile/design` 或项目已经配置的 DeepSeek/其他 Provider。
3. 13种 cardSections 是渲染器支持词表。宿主逐项判断是否适合本任务，只选择有明确用途的子集，并重新设置 `appliesTo`、`coverage` 和顺序；不得以“栏目完整”为由全部选入。`definition` 是唯一通用必选栏目。
4. 校验并输出规范化 Profile：
```sh
node scripts/knowmap.mjs validate-profile --input <隔离任务目录>/profile-draft.json --output <隔离任务目录>/profile.json
```

验证：命令退出0；域 ID 唯一，根不与域重复，域分支引用存在，validation 数量等于实际数量，并设置 maxPrimaryChildren（默认8）。域数不强制3–8。初始 nodeCount 是目标范围。保留 category 作为中间导航类型；当前实现只支持基础类型和栏目，不能凭 Profile 新增 UI 类型。

修复：根据错误字段修改草稿，再写新输出文件。不要复制空数组作为有效 Profile；不要从 profile.id 推测 rootNode.id（激光雷达示例分别是 lidar-tech-route 和 lidar）。整个构建过程不读取项目 Key；API 设计入口不用于 Skill 构建。
