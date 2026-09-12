/**
 * Profile 设计器（LLM 驱动）- 重构版
 *
 * P3-3：通用 LLM 根据用户的任务描述，自动设计一个完整的 TaskProfile。
 *
 * 重构说明：
 * - 原实现直接用 fetch 调用 /responses API + extractJSON 解析文本
 * - 重构后使用 LlmProvider 统一接口 + structuredOutputCall 通用函数
 * - 自动处理推理模型兼容、tool_choice 剥离、重试、repair、incomplete 等
 *
 * 设计流程：
 * 1. 域划分设计：LLM 设计 3-8 个语义域和 3-5 个视觉分支
 * 2. 类型系统设计：基于基础 11 种节点类型 + 12 种边类型，可扩展主题特定类型
 * 3. 栏目与提示词设计：复用基础 13 个栏目，提示词基于 FMCW 模板替换主题内容
 * 4. 初始化策略设计：MVP vs 完整开发参数
 * 5. 校验+修复循环：检查是否符合契约 schema，不符合则让 LLM 修复（最多 3 轮）
 *
 * 参考 FMCW Profile 作为模板，保证设计质量下限。
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { validateProfile as validateTaskProfile } from "./validate-profile";
import { join } from "path";
import type { LlmProvider, LlmMessage } from "../../core/llm/contracts";
import { structuredOutputCall } from "../llm/structured-output";
import type {
  TaskProfile,
  DomainDef,
  NodeTypeDef,
  EdgeTypeDef,
  CardSectionDef,
  PromptConfig,
} from "../../plugin/contracts/task-profile";
import { BASE_NODE_TYPES, BASE_EDGE_TYPES } from "../../plugin/contracts/task-profile";

/**
 * Profile 设计结果
 */
export interface ProfileDesignResult {
  profile: TaskProfile;
  iterations: number;
  validationIssues: string[];
  warnings: string[];
}

/**
 * 域划分校验器
 */
function validateDomains(data: unknown): { domains: DomainDef[]; visualBranches: string[] } {
  if (!data || typeof data !== "object") {
    throw new Error("域划分输出必须是对象");
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.domains) || obj.domains.length === 0) {
    throw new Error("缺少 domains 数组或为空");
  }
  if (!Array.isArray(obj.visualBranches) || obj.visualBranches.length === 0) {
    throw new Error("缺少 visualBranches 数组或为空");
  }
  // 校验每个域
  const domains: DomainDef[] = obj.domains.map((d: unknown, i: number) => {
    if (!d || typeof d !== "object") {
      throw new Error(`域 ${i} 必须是对象`);
    }
    const domain = d as Record<string, unknown>;
    if (!domain.id || typeof domain.id !== "string") {
      throw new Error(`域 ${i} 缺少 id`);
    }
    if (!domain.name || typeof domain.name !== "string") {
      throw new Error(`域 ${i} 缺少 name`);
    }
    return {
      id: domain.id,
      name: domain.name,
      description: typeof domain.description === "string" ? domain.description : "",
      visualBranch: typeof domain.visualBranch === "string" ? domain.visualBranch : (obj.visualBranches as string[])[0],
      order: typeof domain.order === "number" ? domain.order : i + 1,
    };
  });
  return { domains, visualBranches: obj.visualBranches as unknown as string[] };
}

/**
 * 类型系统校验器
 */
function validateTypes(data: unknown): { nodeTypes: NodeTypeDef[]; edgeTypes: EdgeTypeDef[] } {
  if (!data || typeof data !== "object") {
    throw new Error("类型系统输出必须是对象");
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.nodeTypes) || obj.nodeTypes.length === 0) {
    throw new Error("缺少 nodeTypes 数组或为空");
  }
  if (!Array.isArray(obj.edgeTypes) || obj.edgeTypes.length === 0) {
    throw new Error("缺少 edgeTypes 数组或为空");
  }
  return {
    nodeTypes: obj.nodeTypes as NodeTypeDef[],
    edgeTypes: obj.edgeTypes as EdgeTypeDef[],
  };
}

/**
 * 栏目校验器
 */
function validateCardSections(data: unknown): CardSectionDef[] {
  if (!Array.isArray(data)) {
    if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).cardSections)) {
      return (data as Record<string, unknown>).cardSections as CardSectionDef[];
    }
    throw new Error("栏目输出必须是数组");
  }
  if (data.length === 0) {
    throw new Error("栏目数组为空");
  }
  return data as CardSectionDef[];
}

/**
 * 提示词校验器
 */
function validatePrompts(data: unknown): PromptConfig {
  if (!data || typeof data !== "object") {
    throw new Error("提示词输出必须是对象");
  }
  return data as PromptConfig;
}

/**
 * Profile 设计器
 */
export class ProfileDesigner {
  private provider: LlmProvider;
  private maxIterations: number = 3;
  private topic: string;
  private taskDescription: string;
  private warnings: string[] = [];

  constructor(provider: LlmProvider, topic: string, taskDescription: string) {
    this.provider = provider;
    this.topic = topic;
    this.taskDescription = taskDescription;
  }

  /**
   * 通用结构化输出调用封装
   */
  private async callStructured<T>(
    instructions: string,
    userContent: string,
    validator: (data: unknown) => T,
    maxOutputTokens: number = 8192
  ): Promise<T> {
    const messages: LlmMessage[] = [{ role: "user", content: userContent }];
    const result = await structuredOutputCall(this.provider, instructions, messages, validator, {
      maxOutputTokens,
      maxRetries: 3,
      onDiagnostic: (msg) => this.warnings.push(msg),
    });
    if (result.attempts > 1) {
      this.warnings.push(`LLM 调用重试 ${result.attempts - 1} 次后成功`);
    }
    if (result.recoveredFromIncomplete) {
      this.warnings.push("从不完整输出中恢复结构化数据");
    }
    return result.data;
  }

  /**
   * Step 1: 设计域划分
   */
  private async designDomains(): Promise<{ domains: DomainDef[]; visualBranches: string[] }> {
    const instructions = `你是知识图谱 Profile 设计专家。根据用户的任务描述，设计知识网络的语义域划分和视觉分支。

要求：
- 语义域数量：3-8 个为建议，可按主题增减，每个域代表一个独立的知识领域
- 视觉分支从 foundation、signal、data、system、ai 选择，用于 UI 展示的颜色/分组，数量按实际需要
- 每个域包含：id（kebab-case）、name（中文名称）、description（一句话描述）、visualBranch（所属视觉分支）、order（排序）
- 域划分要覆盖主题的主要方面，避免重叠
- 参考 FMCW 雷达的域划分：physical-performance / waveform-if / nonideal-calibration / spectral-rva / detection-measurement / clustering-object / estimation / association-tracking / scene-events / system-hardware / ai-learning`;

    const userContent = `主题：${this.topic}
任务描述：${this.taskDescription}

请设计这个知识网络的语义域划分和视觉分支。`;

    return this.callStructured(instructions, userContent, validateDomains);
  }

  /**
   * Step 2: 设计类型系统（节点类型 + 边类型）
   */
  private async designTypes(domains: DomainDef[]): Promise<{ nodeTypes: NodeTypeDef[]; edgeTypes: EdgeTypeDef[] }> {
    const instructions = `你是知识图谱 Profile 设计专家。根据主题和域划分，设计节点类型和边类型。

基础节点类型（11种，可复用或扩展）：
${JSON.stringify(BASE_NODE_TYPES, null, 2)}

基础边类型（12种，可复用或扩展）：
${JSON.stringify(BASE_EDGE_TYPES, null, 2)}

要求：
- 优先复用基础类型，只有主题特定的概念才新增类型
- 每种节点类型包含：type、singular（一个节点只放一个什么）、forbidden（禁止什么）、note（说明）、isGranularSensitive（是否受节点粒度约束）
- 每种边类型包含：type、label、direction（symmetric/directed）、description
- 节点类型从基础11种选择，不新增当前引擎未支持的类型
- 边类型从基础12种选择，数量不作硬限制`;

    const userContent = `主题：${this.topic}
域划分：
${domains.map((d) => `- ${d.id}: ${d.name}`).join("\n")}

请设计节点类型和边类型。`;

    return this.callStructured(instructions, userContent, validateTypes);
  }

  /**
   * Step 3: 设计栏目目录
   */
  private async designCardSections(nodeTypes: NodeTypeDef[]): Promise<CardSectionDef[]> {
    const instructions = `你是知识图谱 Profile 设计专家。根据主题和节点类型，设计知识卡栏目目录。

基础栏目（13个，可复用或扩展）：
- definition（定义与边界）- core
- principle（原理与推导）- core
- assumptions（假设与适用条件）- core
- comparison（同类方案比较）- core
- inputs_outputs（输入输出）- conditional
- procedure（实现步骤）- conditional
- engineering_tradeoff（工程取舍）- conditional
- failure_mode（失效模式）- conditional
- validation（验证方法）- optional
- application（应用场景）- optional
- research_topic（研究方向）- optional
- code（代码实现）- optional
- misconception（常见误区）- optional

要求：
- 从基础栏目中按适用性选择；当前引擎不接受新增栏目
- 每个栏目包含：type、label、definition、coverage（core/conditional/optional）、appliesTo（节点类型数组或字符串 all）、order（数字）
- 必须包含 definition；其他栏目按节点适用性选择，不强制每个节点填写
- 栏目数量按主题需要，不为凑数新增栏目`;

    const userContent = `主题：${this.topic}
节点类型：
${nodeTypes.map((t) => `- ${t.type}: ${t.singular}`).join("\n")}

请设计知识卡栏目目录。`;

    return this.callStructured(instructions, userContent, validateCardSections, 4096);
  }

  /**
   * Step 4: 设计提示词
   */
  private async designPrompts(domains: DomainDef[], nodeTypes: NodeTypeDef[]): Promise<PromptConfig> {
    const instructions = `你是知识图谱 Profile 设计专家。根据主题和域划分，设计 ReAct 提示词和资料接入提示词。

要求：
- react：ReAct 循环的系统提示词，包含节点粒度硬约束
- topicAppendix：主题特定的追加提示词
- ingest：4 套资料接入提示词（conversation/summary/paper/document）
- review：语义审查提示词
- finalResponse：最终响应提示词
- 提示词中必须包含节点粒度硬约束（一个节点只放一个概念/定义/问题/解决方案）`;

    const userContent = `主题：${this.topic}
域划分：
${domains.map((d) => `- ${d.id}: ${d.name}`).join("\n")}

节点类型：
${nodeTypes.map((t) => `- ${t.type}: ${t.singular}`).join("\n")}

请设计提示词配置。`;

    return this.callStructured(instructions, userContent, validatePrompts, 16384);
  }

  /**
   * Step 5: 设计初始化策略（确定性，不需要 LLM）
   */
  private designInitialization(domains: DomainDef[]): TaskProfile["initialization"] {
    return {
      rootNode: {
        id: this.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "root",
        name: this.topic,
        shortFact: `${this.topic}知识网络的根节点`,
      },
      mvp: {
        nodeCount: [15, 30],
        reactRounds: [2, 3],
        sectionsFilled: ["definition"],
        domainCount: [1, domains.length],
        durationMinutes: [2, 5],
      },
      full: {
        nodeCount: [80, 150],
        reactRounds: [6, 24],
        rootBudgetMinutes: [25, 35],
        durationMinutes: [25, 40],
      },
    };
  }

  /**
   * 校验 Profile
   */
  private validateProfile(profile: TaskProfile): string[] {
    try { validateTaskProfile(profile); return []; }
    catch (error) { return [error instanceof Error ? error.message : String(error)]; }
  }

  /**
   * 修复 Profile（让 LLM 修复校验问题）
   */
  private async fixProfile(profile: TaskProfile, issues: string[]): Promise<TaskProfile> {
    const instructions = `你是知识图谱 Profile 修复专家。根据校验问题，修复 Profile 中的错误。

只修复列出的问题，不要改变其他正确的部分。
输出完整的修复后的 Profile JSON。`;

    const userContent = `当前 Profile：
${JSON.stringify(profile, null, 2)}

校验问题：
${issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}

请修复这些问题，输出完整的修复后的 Profile JSON。`;

    return this.callStructured(instructions, userContent, (data) => data as TaskProfile, 16384);
  }

  /**
   * 执行完整的 Profile 设计流程
   */
  async design(): Promise<ProfileDesignResult> {
    this.warnings = [];
    let iterations = 0;

    // Step 1: 域划分
    const { domains, visualBranches } = await this.designDomains();

    // Step 2: 类型系统
    const { nodeTypes, edgeTypes } = await this.designTypes(domains);

    // Step 3: 栏目目录
    const cardSections = await this.designCardSections(nodeTypes);

    // Step 4: 提示词
    const prompts = await this.designPrompts(domains, nodeTypes);

    // Step 5: 初始化策略
    const initialization = this.designInitialization(domains);

    // 组装 Profile
    const now = new Date().toISOString();
    let profile: TaskProfile = {
      id: this.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "custom-profile",
      name: this.topic,
      version: "0.1.0",
      description: `由 Profile 设计器自动生成：${this.taskDescription}`,
      schemaVersion: "task-profile/1",
      createdAt: now,
      updatedAt: now,
      author: "knowmap-profile-designer",
      tags: [this.topic, "auto-generated"],
      domains,
      visualBranches,
      nodeTypes,
      edgeTypes,
      cardSections,
      validation: {
        domainCount: domains.length,
        visualBranchCount: visualBranches.length,
        rootNodeRequired: true,
      },
      prompts,
      initialization,
    };

    // Step 6: 校验+修复循环
    let validationIssues = this.validateProfile(profile);
    while (validationIssues.length > 0 && iterations < this.maxIterations) {
      iterations++;
      this.warnings.push(`第 ${iterations} 轮修复：${validationIssues.length} 个问题`);
      try {
        profile = await this.fixProfile(profile, validationIssues);
        validationIssues = this.validateProfile(profile);
      } catch (error) {
        this.warnings.push(`修复失败：${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }

    if (validationIssues.length > 0) {
      this.warnings.push(`经过 ${iterations} 轮修复后仍有 ${validationIssues.length} 个问题未解决`);
    }

    return {
      profile,
      iterations,
      validationIssues,
      warnings: this.warnings,
    };
  }

  /**
   * 将 Profile 写入文件
   */
  writeProfileToFile(profile: TaskProfile, outputPath?: string): string {
    const profileId = profile.id;
    const defaultPath = join(process.cwd(), "profiles", `${profileId}.ts`);
    const filePath = outputPath || defaultPath;

    const content = `// Auto-generated by ProfileDesigner

import type { TaskProfile } from "../plugin/contracts/task-profile";

export const profile: TaskProfile = ${JSON.stringify(profile, null, 2)};

export default profile;
`;

    validateTaskProfile(profile);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
    return filePath;
  }
}

/**
 * 从配置文件加载 LLM 配置（兼容旧接口）
 */
export function loadLLMConfigFromFile(): { apiKey: string; baseUrl: string; model: string } {
  try {
    const configPath = join(process.cwd(), "data", "runtime", "llm-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    return {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  } catch {
    return {
      apiKey: process.env.LLM_API_KEY || "",
      baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
      model: process.env.LLM_MODEL || "deepseek-chat",
    };
  }
}
