import {
  LlmAbortedError,
  LlmHttpError,
  LlmRequestError,
  LlmTimeoutError,
  type JsonObject,
  type JsonValue,
  type LlmFunctionCall,
  type LlmFunctionTool,
  type LlmProvider,
  type LlmResponseRequest,
  type LlmResponseResult,
  type LlmResponseStatus,
  type LlmStreamEvent,
  type LlmUsage,
  type LlmTool,
} from "../../core/llm/contracts";
import type { LlmServerConfig } from "../config/llm-config";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const numeric = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const jsonOutput = (value: string | JsonValue): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const statusOf = (value: unknown): LlmResponseStatus => {
  if (value === "completed" || value === "incomplete" || value === "failed") return value;
  return "unknown";
};

/**
 * Reasoning models (o1/o3/o4, gpt-5, deepseek-reasoner, r1, "thinking" family)
 * reject the `tool_choice` parameter and often reject `parallel_tool_calls`.
 * Matching by model name keeps normal chat models on the strictest behavior
 * while letting reasoning models run without provider errors.
 */
const REASONING_MODEL_HINTS = [
  /(^|[-_:./])(o[1-9]|o[1-9]-mini|o[1-9]-preview)([-_:./]|$)/i,
  /(^|[-_:./])gpt-5([-_.]|$)/i,
  /(^|[-_:./])(deepseek-reasoner|deepseek-r1|r1)([-_:./]|$)/i,
  /reasoning/i,
  /thinking/i,
];

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_HINTS.some((pattern) => pattern.test(model));
}

const TOOL_CHOICE_UNSUPPORTED = /tool[_ ]?choice|thinking mode does not support|does not support.*tool_choice|not supported.*tool_choice/i;

function isToolChoiceError(error: unknown): boolean {
  return error instanceof LlmHttpError && TOOL_CHOICE_UNSUPPORTED.test(error.message);
}

function parseArguments(rawArguments: string): Pick<LlmFunctionCall, "arguments" | "argumentParseError"> {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (!isRecord(parsed)) {
      return { arguments: null, argumentParseError: "Function arguments must be a JSON object." };
    }
    return { arguments: parsed as JsonObject };
  } catch (error) {
    return {
      arguments: null,
      argumentParseError: error instanceof Error ? error.message : "Invalid JSON arguments.",
    };
  }
}

function parseToolCalls(output: unknown): LlmFunctionCall[] {
  if (!Array.isArray(output)) return [];
  const calls: LlmFunctionCall[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "function_call") continue;
    const callId = optionalString(item.call_id);
    const name = optionalString(item.name);
    if (!callId || !name) continue;
    const rawArguments = typeof item.arguments === "string" ? item.arguments : "{}";
    calls.push({
      ...(optionalString(item.id) ? { id: optionalString(item.id) } : {}),
      callId,
      name,
      rawArguments,
      ...parseArguments(rawArguments),
    });
  }
  return calls;
}

function parseText(response: UnknownRecord): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text;
  if (!Array.isArray(response.output)) return "";
  const fragments: string[] = [];
  for (const item of response.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
        fragments.push(content.text);
      }
    }
  }
  return fragments.join("");
}

function parseUsage(value: unknown): LlmUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = numeric(value.input_tokens);
  const outputTokens = numeric(value.output_tokens);
  const totalTokens = numeric(value.total_tokens);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined;

  const inputDetails = isRecord(value.input_tokens_details) ? value.input_tokens_details : undefined;
  const outputDetails = isRecord(value.output_tokens_details) ? value.output_tokens_details : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(numeric(inputDetails?.cached_tokens) !== undefined
      ? { cachedInputTokens: numeric(inputDetails?.cached_tokens) }
      : {}),
    ...(numeric(outputDetails?.reasoning_tokens) !== undefined
      ? { reasoningTokens: numeric(outputDetails?.reasoning_tokens) }
      : {}),
  };
}

function toolPayload(tool: LlmTool): UnknownRecord {
  if ("type" in tool && tool.type === "web_search") return { type: "web_search" };
  const functionTool = tool as LlmFunctionTool;
  return {
    type: "function",
    name: functionTool.name,
    description: functionTool.description,
    parameters: functionTool.parameters,
    strict: functionTool.strict ?? true,
  };
}

/**
 * Builds the Responses API request body. Reasoning models cannot receive
 * `tool_choice` or `parallel_tool_calls`, so both are stripped for them.
 */
function buildRequestBody(request: LlmResponseRequest, config: LlmServerConfig, stream: boolean): UnknownRecord {
  const messages = request.messages ?? [];
  const toolOutputs = request.toolOutputs ?? [];
  const tools = request.tools ?? [];
  const input: UnknownRecord[] = [
    ...messages.map((message) => ({ role: message.role, content: message.content })),
    ...toolOutputs.map((output) => ({
      type: "function_call_output",
      call_id: output.callId,
      output: jsonOutput(output.output),
    })),
  ];
  const reasoning = isReasoningModel(config.model);
  const body: UnknownRecord = {
    model: config.model,
    input,
    max_output_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
    store: false,
    stream,
    ...(request.instructions ? { instructions: request.instructions } : {}),
    ...(tools.length ? { tools: tools.map(toolPayload) } : {}),
    ...(request.toolChoice && !reasoning ? { tool_choice: request.toolChoice } : {}),
    ...(request.parallelToolCalls !== undefined && !reasoning
      ? { parallel_tool_calls: request.parallelToolCalls }
      : {}),
    ...(request.session?.previousResponseId
      ? { previous_response_id: request.session.previousResponseId }
      : {}),
    ...(request.metadata ? { metadata: request.metadata } : {}),
  };
  return body;
}

/** Normalizes a completed Responses API payload into the provider result. */
function parseResponsePayload(payload: unknown, config: LlmServerConfig, requestId?: string | null): LlmResponseResult {
  if (!isRecord(payload)) throw new LlmRequestError("LLM provider returned an invalid response body.");
  const id = optionalString(payload.id);
  if (!id) throw new LlmRequestError("LLM provider response is missing an id.");
  const incompleteDetails = isRecord(payload.incomplete_details) ? payload.incomplete_details : undefined;
  return {
    id,
    provider: "openai-responses",
    model: optionalString(payload.model) ?? config.model,
    status: statusOf(payload.status),
    text: parseText(payload),
    toolCalls: parseToolCalls(payload.output),
    ...(parseUsage(payload.usage) ? { usage: parseUsage(payload.usage) } : {}),
    session: { previousResponseId: id },
    ...(requestId ? { requestId } : {}),
    ...(optionalString(incompleteDetails?.reason)
      ? { incompleteReason: optionalString(incompleteDetails?.reason) }
      : {}),
  };
}

async function errorFromResponse(response: Response): Promise<LlmHttpError> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  let message = `LLM provider returned HTTP ${response.status}.`;
  let code: string | undefined;
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload.error)) {
      message = optionalString(payload.error.message) ?? message;
      code = optionalString(payload.error.code);
    }
  } catch {
    // Keep the status-only message. Raw provider bodies may contain sensitive data.
  }
  return new LlmHttpError(message, response.status, requestId, code);
}

export class OpenAiResponsesProvider implements LlmProvider {
  readonly name = "openai-responses";
  get limits() { return { maxOutputTokens: this.config.maxOutputTokens, maxInputChars: this.config.maxInputChars }; }

  constructor(
    private readonly config: LlmServerConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  async createResponse(request: LlmResponseRequest): Promise<LlmResponseResult> {
    this.validate(request);
    request = { ...request, signal: AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(request.signal ? [request.signal] : [])]) };
    const runOnce = async (withToolChoice: boolean): Promise<LlmResponseResult> => {
      const body = buildRequestBody({ ...request, toolChoice: withToolChoice ? request.toolChoice : undefined }, this.config, false);
      const response = await this.post(body, request.signal);
      if (!response.ok) throw await errorFromResponse(response);
      return parseResponsePayload(await response.json(), this.config, response.headers.get("x-request-id"));
    };
    try {
      return await runOnce(true);
    } catch (error) {
      // Reasoning models reject `tool_choice`; when the provider complains,
      // retry once without it before surfacing the failure.
      if (request.toolChoice && isToolChoiceError(error)) return runOnce(false);
      throw error;
    }
  }

  async *createStream(request: LlmResponseRequest): AsyncIterable<LlmStreamEvent> {
    this.validate(request);
    request = { ...request, signal: AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(request.signal ? [request.signal] : [])]) };
    const runOnce = async (): Promise<Response> => {
      const body = buildRequestBody(request, this.config, true);
      return this.post(body, request.signal);
    };
    let response = await runOnce();
    if (!response.ok) {
      const error = await errorFromResponse(response);
      // Some reasoning-model gateways reject the request until `tool_choice` is
      // removed; retry the stream once without it.
      if (request.toolChoice && isToolChoiceError(error)) {
        const body = buildRequestBody({ ...request, toolChoice: undefined }, this.config, true);
        response = await this.post(body, request.signal);
        if (!response.ok) throw await errorFromResponse(response);
      } else {
        throw error;
      }
    }
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.body) {
      throw new LlmRequestError("LLM provider returned an empty streaming body.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const block of events) {
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
            yield { type: "text_delta", text: parsed.delta };
          } else if (parsed.type === "response.completed" && parsed.response !== undefined) {
            try {
              yield { type: "done", result: parseResponsePayload(parsed.response, this.config, requestId) };
            } catch (error) {
              yield { type: "error", error: error instanceof Error ? error : new LlmRequestError("Streamed response could not be parsed.") };
            }
            return;
          } else if (parsed.type === "error" && isRecord(parsed.error)) {
            const message = optionalString(parsed.error.message) ?? "LLM provider streamed an error.";
            const code = optionalString(parsed.error.code);
            throw new LlmHttpError(message, 400, requestId, code);
          }
        }
      }
      yield { type: "error", error: new LlmRequestError("LLM provider stream ended without a completed response.") };
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error : new LlmRequestError("LLM stream failed.") };
    } finally {
      reader.releaseLock();
    }
  }

  private validate(request: LlmResponseRequest): void {
    const messages = request.messages ?? [];
    const toolOutputs = request.toolOutputs ?? [];
    const tools = request.tools ?? [];
    if (messages.length === 0 && toolOutputs.length === 0) {
      throw new LlmRequestError("At least one message or function call output is required.");
    }
    if (toolOutputs.length > 0 && !request.session?.previousResponseId) {
      throw new LlmRequestError("Function call outputs require a previous response id.");
    }
    if (tools.length > this.config.maxTools) {
      throw new LlmRequestError(`Tool count exceeds the configured limit of ${this.config.maxTools}.`);
    }
    const inputChars =
      (request.instructions?.length ?? 0) +
      messages.reduce((total, message) => total + message.content.length, 0) +
      toolOutputs.reduce((total, output) => total + jsonOutput(output.output).length, 0);
    if (inputChars > this.config.maxInputChars) {
      throw new LlmRequestError(`Input exceeds the configured limit of ${this.config.maxInputChars} characters.`);
    }
    const maxOutputTokens = request.maxOutputTokens ?? this.config.maxOutputTokens;
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > this.config.maxOutputTokens) {
      throw new LlmRequestError(
        `maxOutputTokens must be between 1 and the configured limit of ${this.config.maxOutputTokens}.`,
      );
    }
  }

  private async post(body: UnknownRecord, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new LlmAbortedError("LLM request was aborted.");
      const headers = new Headers({ "content-type": "application/json" });
      this.config.authorize(headers);
      return await this.fetchImpl(`${this.config.baseUrl}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new LlmTimeoutError(`LLM request exceeded ${this.config.timeoutMs} ms.`);
      if (signal?.aborted || (controller.signal.aborted && !timedOut)) {
        throw new LlmAbortedError("LLM request was aborted.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

/** Parses one SSE block and returns its typed payload for Responses events. */
function parseSseBlock(block: string): UnknownRecord | undefined {
  let data: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!data) return undefined;
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
