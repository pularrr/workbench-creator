/**
 * PluginState 契约 —— 插件运行时状态的数据结构
 *
 * 记录插件当前所处的阶段、加载的 Profile、MVP 输出、研究检查点、
 * 用户确认记录等。支持中断恢复——服务重启后可以从 PluginState 恢复。
 */

import type { TaskProfile } from "./task-profile";
import type { MvpOutput, MvpConfirmation } from "./mvp-output";
import type { ResearchCandidate } from "./research-candidate";

/** 插件阶段 */
export type PluginPhase =
  | "idle"              // 空闲，等待用户输入
  | "profile-design"    // Profile 设计中（P3-3 LLM 设计 Profile）
  | "mvp-generation"    // MVP 生成中（Phase 1）
  | "mvp-confirmation"  // 等待用户确认 MVP（Phase 2）
  | "full-development"  // 完整开发中（Phase 3）
  | "completed"         // 完成
  | "failed";           // 失败

/** 研究检查点 —— 自适应 ReAct 的中间状态 */
export interface ResearchCheckpoint {
  batches: ResearchCandidate[];       // 已生成的候选批次
  visitedTopicIds: string[];          // 已访问的主题节点 ID
  currentTopicId: string | null;      // 当前正在研究的主题
  callCount: number;                   // 已调用模型次数
  startTime: string;                   // 开始时间
  lastActivityAt: string;              // 最后活动时间
  stopReason?: "converged" | "budget_exceeded" | "no_more_topics" | "user_stopped" | "error";
  distributedSubCalls?: number;        // 分布式子调用次数
}

/** 用户确认记录 */
export interface UserConfirmationRecord {
  mvpConfirmed: boolean;
  confirmedAt?: string;
  lockedDesign?: {
    domains: string[];
    nodeTypes: string[];
    cardSections: string[];
    rootNodeId: string;
  };
  adjustments?: Array<{
    at: string;
    selectedDirections: string[];
    customFeedback?: string;
  }>;
  candidateConfirmations?: Array<{
    at: string;
    candidateBatchId: string;
    accepted: boolean;
    notes?: string;
  }>;
}

/** 任务记录 */
export interface TaskRecord {
  taskId: string;
  type: "mvp" | "full" | "profile-design" | "deep-search" | "ingest";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: {
    current: number;
    total: number;
    message: string;
  };
  error?: string;
  outputRef?: string;  // 输出文件路径或引用
}

/** 插件配置 */
export interface PluginConfig {
  // LLM 配置
  llm: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKey?: string;  // 不持久化，运行时注入
  };
  // 输出配置
  output: {
    directory: string;       // 输出目录
    format: "json" | "jsonl";
    maxBatchSize: number;    // 单批最大候选数
  };
  // 预算配置
  budget: {
    mvpMaxMinutes: number;       // MVP 最大时间（5 分钟）
    fullMaxMinutes: number;      // 完整开发最大时间（40 分钟）
    rootMaxCalls: number;        // 根任务模型调用保险丝（默认4096，由 MVP 验收预算覆盖）
    maxToolRounds: number;       // 最大工具轮次（8）
    distributeThreshold: {       // 分布式子调用触发阈值
      gaps: number;               // 3
      newNodes: number;           // 8
    };
  };
  // 验证配置
  validation: {
    failOpen: boolean;            // 语义审查失败时是否降级为 warning（true）
    maxRetries: number;           // 格式修复最大重试次数（3）
  };
}

/** PluginState 完整契约 */
export interface PluginState {
  // 基本信息
  pluginVersion: string;
  schemaVersion: string;          // "plugin-state/1"
  sessionId: string;
  createdAt: string;
  updatedAt: string;

  // 当前阶段
  phase: PluginPhase;

  // 用户输入
  userRequest: {
    rawInput: string;             // 用户原始输入
    parsedTask?: string;          // 解析后的任务类型
    topic?: string;                // 主题
  };

  // Profile
  currentProfile: TaskProfile | null;
  profileHistory: Array<{
    profileId: string;
    name: string;
    createdAt: string;
    source: "user" | "llm-designed" | "template";
  }>;

  // MVP
  mvpOutput: MvpOutput | null;
  mvpConfirmation: MvpConfirmation | null;

  // 研究检查点
  checkpoint: ResearchCheckpoint | null;

  // 用户确认记录
  userConfirmations: UserConfirmationRecord;

  // 任务记录
  tasks: TaskRecord[];
  currentTaskId: string | null;

  // 配置
  config: PluginConfig;

  // 错误与恢复
  lastError?: {
    message: string;
    stack?: string;
    at: string;
    recoverable: boolean;
  };
  recoveryInfo?: {
    canResume: boolean;
    resumeFrom: "checkpoint" | "mvp" | "profile" | "beginning";
    reason: string;
  };

  // 统计
  stats: {
    totalLlmCalls: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalDurationSeconds: number;
    nodesGenerated: number;
    cardsGenerated: number;
    relationsGenerated: number;
  };
}

/**
 * 插件状态持久化 —— 支持中断恢复
 */
export interface PluginStateStore {
  save(state: PluginState): Promise<void>;
  load(sessionId: string): Promise<PluginState | null>;
  list(): Promise<Array<{ sessionId: string; phase: PluginPhase; updatedAt: string }>>;
  delete(sessionId: string): Promise<void>;
}

/**
 * 阶段转换 —— 合法的阶段转换路径
 */
export const PHASE_TRANSITIONS: Record<PluginPhase, PluginPhase[]> = {
  idle: ["profile-design", "mvp-generation"],
  "profile-design": ["mvp-generation", "idle", "failed"],
  "mvp-generation": ["mvp-confirmation", "failed"],
  "mvp-confirmation": ["full-development", "mvp-generation", "idle", "failed"],
  "full-development": ["completed", "failed"],
  completed: ["idle"],
  failed: ["idle", "mvp-generation", "full-development"],
};
