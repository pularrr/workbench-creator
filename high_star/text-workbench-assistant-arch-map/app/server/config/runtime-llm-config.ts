import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LlmServerConfig, processLlmEnvironment, type LlmEnvironment, type PublicLlmConfig } from "./llm-config";

type StoredLlmConfig = {
  schemaVersion: "fmcw-llm-config/1";
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens?: number;
};

export type PublicLlmStatus =
  | PublicLlmConfig
  | { configured: false; provider: "openai-responses"; baseUrl: string; model: string };

export interface LlmConfigUpdate {
  apiKey?: string;
  baseUrl: string;
  model: string;
  maxOutputTokens?: number;
}

export class RuntimeLlmConfigStore {
  constructor(private readonly filePath: string) {}

  environment(): LlmEnvironment {
    const stored = this.read();
    const system = processLlmEnvironment();
    return {
      LLM_API_KEY: system.LLM_API_KEY?.trim() || stored?.apiKey,
      LLM_BASE_URL: system.LLM_BASE_URL?.trim() || stored?.baseUrl,
      LLM_MODEL: system.LLM_MODEL?.trim() || stored?.model,
      LLM_TIMEOUT_MS: system.LLM_TIMEOUT_MS,
      LLM_MAX_OUTPUT_TOKENS: system.LLM_MAX_OUTPUT_TOKENS || (stored?.maxOutputTokens ? String(stored.maxOutputTokens) : undefined),
      LLM_MAX_TOOL_ROUNDS: system.LLM_MAX_TOOL_ROUNDS,
      LLM_MAX_INPUT_CHARS: system.LLM_MAX_INPUT_CHARS,
      LLM_MAX_TOOLS: system.LLM_MAX_TOOLS,
    };
  }

  status(): PublicLlmStatus {
    const environment = this.environment();
    if (!environment.LLM_API_KEY?.trim() || !environment.LLM_MODEL?.trim()) {
      return {
        configured: false,
        provider: "openai-responses",
        baseUrl: environment.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
        model: environment.LLM_MODEL?.trim() || "",
      };
    }
    return new LlmServerConfig(environment).toJSON();
  }

  save(update: LlmConfigUpdate): PublicLlmConfig {
    const previous = this.read();
    const apiKey = update.apiKey?.trim() || previous?.apiKey || process.env.LLM_API_KEY?.trim();
    const candidate: LlmEnvironment = {
      ...processLlmEnvironment(),
      LLM_API_KEY: apiKey,
      LLM_BASE_URL: update.baseUrl,
      LLM_MODEL: update.model,
      LLM_MAX_OUTPUT_TOKENS: update.maxOutputTokens !== undefined ? String(update.maxOutputTokens) : previous?.maxOutputTokens ? String(previous.maxOutputTokens) : processLlmEnvironment().LLM_MAX_OUTPUT_TOKENS,
    };
    const validated = new LlmServerConfig(candidate);
    const file: StoredLlmConfig = {
      schemaVersion: "fmcw-llm-config/1",
      apiKey: apiKey!,
      baseUrl: validated.baseUrl,
      model: validated.model,
      maxOutputTokens: validated.maxOutputTokens,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.filePath);
    return validated.toJSON();
  }

  private read(): StoredLlmConfig | undefined {
    if (!existsSync(this.filePath)) return undefined;
    try {
      const value = JSON.parse(readFileSync(this.filePath, "utf8")) as StoredLlmConfig;
      return value.schemaVersion === "fmcw-llm-config/1" ? value : undefined;
    } catch {
      return undefined;
    }
  }
}
