/**
 * ProfileLoader —— Profile 加载机制
 *
 * P3-2 Step 7 会完善为完整的加载器（支持运行时切换 Profile、注入到应用各层）。
 * 当前 Step 1 只提供基础结构：加载指定 Profile、获取域定义、获取验证配置。
 *
 * FMCW 基线零退化：现有代码不使用 ProfileLoader 时，仍然使用硬编码配置。
 */

import type { TaskProfile } from "../../plugin/contracts/task-profile";
import { ACTIVE_PROFILE } from "../../profiles/active";

/** 内置 Profile 注册表 */
const builtinProfiles: Map<string, TaskProfile> = new Map([
  [ACTIVE_PROFILE.id, ACTIVE_PROFILE],
]);

/**
 * ProfileLoader 类
 *
 * 负责加载、缓存和提供 Profile 配置。
 * 当前支持内置 Profile；P3-3 完成后支持 LLM 设计的动态 Profile。
 */
export class ProfileLoader {
  private cache: Map<string, TaskProfile> = new Map();
  private currentProfileId: string;

  constructor(defaultProfileId: string = ACTIVE_PROFILE.id) {
    this.currentProfileId = defaultProfileId;
    // 预加载内置 Profile
    for (const [id, profile] of builtinProfiles) {
      this.cache.set(id, profile);
    }
  }

  /**
   * 加载指定 Profile
   */
  load(profileId: string): TaskProfile {
    const profile = this.cache.get(profileId) ?? builtinProfiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}. Available: ${[...this.cache.keys()].join(", ")}`);
    }
    this.currentProfileId = profileId;
    return profile;
  }

  /**
   * 获取当前 Profile
   */
  getCurrent(): TaskProfile {
    return this.load(this.currentProfileId);
  }

  /**
   * 获取域定义
   */
  getDomains(): TaskProfile["domains"] {
    return this.getCurrent().domains;
  }

  /**
   * 获取域 ID 列表
   */
  getDomainIds(): string[] {
    return this.getDomains().map((d) => d.id);
  }

  /**
   * 获取视觉分支列表
   */
  getVisualBranches(): string[] {
    return [...this.getCurrent().visualBranches];
  }

  /**
   * 获取验证配置
   */
  getValidationConfig(): TaskProfile["validation"] {
    return this.getCurrent().validation;
  }

  /**
   * 获取根节点定义
   */
  getRootNode(): TaskProfile["initialization"]["rootNode"] {
    return this.getCurrent().initialization.rootNode;
  }

  /**
   * 获取节点类型定义
   */
  getNodeTypes(): TaskProfile["nodeTypes"] {
    return this.getCurrent().nodeTypes;
  }

  /**
   * 获取边类型定义
   */
  getEdgeTypes(): TaskProfile["edgeTypes"] {
    return this.getCurrent().edgeTypes;
  }

  /**
   * 获取知识卡栏目定义
   */
  getCardSections(): TaskProfile["cardSections"] {
    return this.getCurrent().cardSections;
  }

  /**
   * 获取提示词配置
   */
  getPrompts(): TaskProfile["prompts"] {
    return this.getCurrent().prompts;
  }

  /**
   * 获取初始化策略（MVP vs 完整开发参数）
   */
  getInitialization(): TaskProfile["initialization"] {
    return this.getCurrent().initialization;
  }

  /**
   * 获取 Profile 元数据
   */
  getMetadata(): { id: string; name: string; version: string; description: string } {
    const p = this.getCurrent();
    return { id: p.id, name: p.name, version: p.version, description: p.description };
  }

  /**
   * 注册自定义 Profile（P3-3 后用于 LLM 设计的动态 Profile）
   */
  register(profile: TaskProfile): void {
    this.cache.set(profile.id, profile);
  }

  /**
   * 列出所有可用 Profile
   */
  listAvailable(): Array<{ id: string; name: string; version: string }> {
    return [...this.cache.values()].map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
    }));
  }
}

/**
 * 全局默认 ProfileLoader 实例
 *
 * 应用启动时使用此实例。P3-2 Step 7 会将其注入到应用各层（validation、agent、UI）。
 */
export const defaultProfileLoader = new ProfileLoader(ACTIVE_PROFILE.id);

/**
 * 便捷函数：获取 FMCW Profile
 */
