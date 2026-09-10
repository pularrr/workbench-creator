export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type LlmMessageRole = "user" | "assistant" | "system" | "developer";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmFunctionTool {
  type?: "function";
  name: string;
  description: string;
  parameters: JsonObject;
  strict?: boolean;
}

export interface LlmWebSearchTool {
  type: "web_search";
}

export type LlmTool = LlmFunctionTool | LlmWebSearchTool;

export interface LlmFunctionCallOutput {
  callId: string;
  output: string | JsonValue;
}

export interface LlmSession {
  /** Provider-issued opaque response id used to continue a stateful exchange. */
  previousResponseId?: string;
}

export type LlmToolChoice = "auto" | "none" | "required";

export interface LlmResponseRequest {
  instructions?: string;
  messages?: readonly LlmMessage[];
  tools?: readonly LlmTool[];
  toolChoice?: LlmToolChoice;
  parallelToolCalls?: boolean;
  session?: LlmSession;
  toolOutputs?: readonly LlmFunctionCallOutput[];
  maxOutputTokens?: number;
  metadata?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface LlmFunctionCall {
  id?: string;
  callId: string;
  name: string;
  rawArguments: string;
  arguments: JsonObject | null;
  argumentParseError?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export type LlmResponseStatus = "completed" | "incomplete" | "failed" | "unknown";

export interface LlmResponseResult {
  id: string;
  provider: string;
  model: string;
  status: LlmResponseStatus;
  text: string;
  toolCalls: readonly LlmFunctionCall[];
  usage?: LlmUsage;
  session: Required<LlmSession>;
  requestId?: string;
  incompleteReason?: string;
}

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "done"; result: LlmResponseResult }
  | { type: "error"; error: Error };

export interface LlmProvider {
  readonly name: string;
  readonly limits?: { maxOutputTokens: number; maxInputChars: number };
  createResponse(request: LlmResponseRequest): Promise<LlmResponseResult>;
  /**
   * Optional server-sent streaming variant. Implementations that support it
   * should yield text_delta events while generating, then a single done event
   * carrying the normalized result. Errors are surfaced as an error event.
   */
  createStream?(request: LlmResponseRequest): AsyncIterable<LlmStreamEvent>;
}

export class LlmConfigurationError extends Error {
  readonly name = "LlmConfigurationError";
}

export class LlmRequestError extends Error {
  readonly name = "LlmRequestError";
}

export class LlmTimeoutError extends Error {
  readonly name = "LlmTimeoutError";
}

export class LlmAbortedError extends Error {
  readonly name = "LlmAbortedError";
}

export class LlmHttpError extends Error {
  readonly name = "LlmHttpError";

  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
