import { LlmConfigurationError } from "../../core/llm/contracts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface LlmEnvironment {
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  LLM_MAX_OUTPUT_TOKENS?: string;
  LLM_MAX_TOOL_ROUNDS?: string;
  LLM_MAX_INPUT_CHARS?: string;
  LLM_MAX_TOOLS?: string;
}

export interface PublicLlmConfig {
  configured: boolean;
  provider: "openai-responses";
  baseUrl: string;
  model: string;
  budgets: {
    timeoutMs: number;
    maxOutputTokens: number;
    maxToolRounds: number;
    maxInputChars: number;
    maxTools: number;
  };
}

const readInteger = (
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new LlmConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

const normalizeBaseUrl = (value: string | undefined): string => {
  const raw = value?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LlmConfigurationError("LLM_BASE_URL must be an absolute URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new LlmConfigurationError("LLM_BASE_URL must use HTTPS (HTTP is allowed only for localhost)." );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LlmConfigurationError("LLM_BASE_URL cannot contain credentials, a query, or a fragment.");
  }
  return url.toString().replace(/\/$/, "");
};

export class LlmServerConfig {
  readonly provider = "openai-responses" as const;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxToolRounds: number;
  readonly maxInputChars: number;
  readonly maxTools: number;
  readonly #apiKey: string;

  constructor(environment: LlmEnvironment) {
    const apiKey = environment.LLM_API_KEY?.trim();
    const model = environment.LLM_MODEL?.trim();
    if (!apiKey) throw new LlmConfigurationError("LLM_API_KEY is required for online LLM access.");
    if (!model) throw new LlmConfigurationError("LLM_MODEL is required for online LLM access.");

    this.#apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(environment.LLM_BASE_URL);
    this.model = model;
    this.timeoutMs = readInteger(environment.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS", 60_000, 1_000, 300_000);
    this.maxOutputTokens = readInteger(
      environment.LLM_MAX_OUTPUT_TOKENS,
      "LLM_MAX_OUTPUT_TOKENS",
      16_384,
      1,
      131_072,
    );
    this.maxToolRounds = readInteger(environment.LLM_MAX_TOOL_ROUNDS, "LLM_MAX_TOOL_ROUNDS", 8, 0, 32);
    this.maxInputChars = readInteger(
      environment.LLM_MAX_INPUT_CHARS,
      "LLM_MAX_INPUT_CHARS",
      120_000,
      1_000,
      2_000_000,
    );
    this.maxTools = readInteger(environment.LLM_MAX_TOOLS, "LLM_MAX_TOOLS", 48, 0, 128);
  }

  authorize(headers: Headers): void {
    headers.set("authorization", `Bearer ${this.#apiKey}`);
  }

  toJSON(): PublicLlmConfig {
    return {
      configured: true,
      provider: this.provider,
      baseUrl: this.baseUrl,
      model: this.model,
      budgets: {
        timeoutMs: this.timeoutMs,
        maxOutputTokens: this.maxOutputTokens,
        maxToolRounds: this.maxToolRounds,
        maxInputChars: this.maxInputChars,
        maxTools: this.maxTools,
      },
    };
  }
}

export function processLlmEnvironment(): LlmEnvironment {
  return {
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_TIMEOUT_MS: process.env.LLM_TIMEOUT_MS,
    LLM_MAX_OUTPUT_TOKENS: process.env.LLM_MAX_OUTPUT_TOKENS,
    LLM_MAX_TOOL_ROUNDS: process.env.LLM_MAX_TOOL_ROUNDS,
    LLM_MAX_INPUT_CHARS: process.env.LLM_MAX_INPUT_CHARS,
    LLM_MAX_TOOLS: process.env.LLM_MAX_TOOLS,
  };
}

export function loadLlmConfig(environment: LlmEnvironment = processLlmEnvironment()): LlmServerConfig {
  return new LlmServerConfig(environment);
}

export function isLlmConfigured(environment: LlmEnvironment = processLlmEnvironment()): boolean {
  return Boolean(environment.LLM_API_KEY?.trim() && environment.LLM_MODEL?.trim());
}
