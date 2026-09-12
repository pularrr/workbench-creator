/**
 * 通用结构化输出调用函数
 *
 * 封装 LlmProvider + 重试 + repair + incomplete 处理机制，
 * 用于需要 LLM 输出结构化 JSON 的场景。
 *
 * 与直接 fetch + extractJSON 的区别：
 * 1. 使用 LlmProvider 统一接口（自动处理推理模型兼容、tool_choice 剥离等）
 * 2. 3 次重试机制，每次重试时减少输出量
 * 3. repair 机制：把上次的错误反馈给 LLM，引导修复
 * 4. incomplete 处理：输出被截断时保留完整条目
 * 5. 强提示词要求纯 JSON，不含思维过程
 *
 * 设计参考：server/agent/research-output.ts 的 requestResearch 函数
 */

import type { LlmProvider, LlmMessage, LlmResponseResult } from "../../core/llm/contracts";

export interface StructuredOutputOptions {
  /** 最大输出 tokens，默认 8192 */
  maxOutputTokens?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 每次重试时的输出量缩减因子，默认 0.5 */
  retryShrinkFactor?: number;
  /** AbortSignal */
  signal?: AbortSignal;
  /** 每次 LLM 调用前的回调 */
  onCall?: () => void;
  /** 诊断信息回调 */
  onDiagnostic?: (message: string) => void;
}

export interface StructuredOutputResult<T = unknown> {
  /** 解析后的结构化数据 */
  data: T;
  /** 原始 LLM 响应 */
  response: LlmResponseResult;
  /** 重试次数 */
  attempts: number;
  /** 是否从 incomplete 输出中恢复 */
  recoveredFromIncomplete: boolean;
}

/**
 * 从文本中提取 JSON 对象
 * 支持多种格式：纯 JSON、```json 代码块、思考文本+JSON
 */
function parseJsonObject(text: string): unknown {
  if (!text || text.trim().length === 0) {
    throw new Error("LLM 输出为空");
  }

  // 策略 1：尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 继续
  }

  // 策略 2：提取 ```json 代码块
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // 继续
    }
  }

  // 策略 3：提取第一个 { 到最后一个 }（支持嵌套）
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续
    }
  }

  // 策略 4：提取第一个 [ 到最后一个 ]（数组）
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const candidate = text.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续
    }
  }

  // 策略 5：清理常见的 Markdown 标记后重试
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^[\s\S]*?\{/, "{")
    .replace(/\}[\s\S]*?$/, "}");

  try {
    return JSON.parse(cleaned);
  } catch {
    // 继续
  }

  // 策略 6：修复常见的 JSON 语法错误
  try {
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  } catch {
    // 继续
  }

  throw new Error(
    `无法从 LLM 输出中提取 JSON。输出长度: ${text.length}，前 100 字符: ${text.substring(0, 100)}`
  );
}

/**
 * 从不完整输出中提取完整的数组条目
 * 参考 research-output.ts 的 completeArrayObjects
 */
function completeArrayObjects(text: string, key: string): unknown[] {
  const results: unknown[] = [];
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[`, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;

    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      else if (text[i] === "]" && depth === 1) break;
      i++;
    }

    if (depth === 0 || text[i] === "]") {
      const arrayText = "[" + text.substring(start, i) + "]";
      try {
        const parsed = JSON.parse(arrayText);
        if (Array.isArray(parsed)) {
          results.push(...parsed.filter((item) => item && typeof item === "object"));
        }
      } catch {
        // 跳过无法解析的条目
      }
    }
  }

  return results;
}

/**
 * 通用结构化输出调用
 *
 * @param provider LLM Provider
 * @param instructions 系统提示词（会自动追加"纯 JSON，不含思维过程"要求）
 * @param messages 用户消息
 * @param validator 数据校验函数，返回校验后的结构化数据
 * @param options 选项
 * @returns 结构化输出结果
 */
export async function structuredOutputCall<T = unknown>(
  provider: LlmProvider,
  instructions: string,
  messages: readonly LlmMessage[],
  validator: (data: unknown) => T,
  options: StructuredOutputOptions = {}
): Promise<StructuredOutputResult<T>> {
  const {
    maxOutputTokens = 8192,
    maxRetries = 3,
    retryShrinkFactor = 0.5,
    signal,
    onCall,
    onDiagnostic,
  } = options;

  const outputLimit = provider.limits?.maxOutputTokens ?? 16384;
  let outputBudget = Math.min(maxOutputTokens, outputLimit);
  let repair = "";
  let failure = "";
  let lastResponse: LlmResponseResult | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    signal?.throwIfAborted();
    onCall?.();

    // 追加纯 JSON 要求
    const batchInstructions =
      instructions +
      "\n\n【输出格式要求（必须严格遵守）】\n" +
      "1. 直接输出 JSON 对象，不要包含任何思考、解释、前缀或后缀文本\n" +
      "2. 不要使用 Markdown 代码块标记\n" +
      "3. 不要说\"好的\"、\"以下是\"等过渡语\n" +
      "4. 输出的第一个字符必须是 {，最后一个字符必须是 }\n" +
      "5. JSON 必须是合法的，可以直接被 JSON.parse 解析\n" +
      "6. 字符串内的换行及特殊字符必须按 JSON 转义\n" +
      (attempt > 0 ? `\n【上次输出修复要求】\n${repair}\n` : "");

    try {
      const response = await provider.createResponse({
        instructions: batchInstructions,
        messages,
        maxOutputTokens: outputBudget,
        signal,
      });

      lastResponse = response;

      // 处理 incomplete（输出被截断）
      if (response.status === "incomplete") {
        onDiagnostic?.(`输出被截断，尝试从部分输出中恢复完整条目...`);

        // 尝试从文本中提取完整的 JSON
        try {
          const partial = parseJsonObject(response.text);
          const data = validator(partial);
          onDiagnostic?.(`从不完整输出中成功恢复结构化数据`);
          return { data, response, attempts: attempt + 1, recoveredFromIncomplete: true };
        } catch {
          // 无法从部分输出中恢复，缩减预算后重试
          outputBudget = Math.max(1024, Math.floor(outputBudget * retryShrinkFactor));
          failure = `输出被截断：${response.incompleteReason ?? "unknown"}；已生成文本 ${response.text.length} 字符；下次预算 ${outputBudget}`;
          onDiagnostic?.(`输出被截断，缩减预算至 ${outputBudget} 后重试（${attempt + 1}/${maxRetries}）`);
          repair = `上次输出被截断。请减少输出量，只输出最核心的内容。错误：${failure.slice(0, 500)}`;
          continue;
        }
      }

      // 解析 JSON
      const parsed = parseJsonObject(response.text);

      // 校验并规范化
      const data = validator(parsed);

      return { data, response, attempts: attempt + 1, recoveredFromIncomplete: false };
    } catch (error) {
      failure = error instanceof Error ? error.message : "未知错误";
      onDiagnostic?.(
        `结构化输出校验未通过，正在修复（${attempt + 1}/${maxRetries}）：${failure.slice(0, 160)}`
      );

      // 缩减输出预算
      outputBudget = Math.max(1024, Math.floor(outputBudget * retryShrinkFactor));

      // 构建 repair 提示
      repair =
        `上次输出未通过格式校验：${failure.slice(0, 1500)}\n` +
        `请修复 JSON 转义与字段类型。只输出本次能完整容纳的核心内容，禁止声称全部完成。\n` +
        `待修复输出（前 2000 字符）：\n${lastResponse?.text?.slice(0, 2000) ?? "无"}`;
    }
  }

  throw new Error(
    `结构化输出经 ${maxRetries} 次校验仍未通过：${failure.slice(0, 600)}`
  );
}
