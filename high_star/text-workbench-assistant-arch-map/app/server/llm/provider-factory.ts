import type { LlmProvider } from "../../core/llm/contracts";
import { loadLlmConfig, processLlmEnvironment, type LlmEnvironment } from "../config/llm-config";
import { OpenAiResponsesProvider, type FetchLike } from "./openai-responses-provider";

export interface LlmProviderFactoryOptions {
  /** Server-owned environment. Request payloads must never be passed here. */
  environment?: LlmEnvironment;
  /** Dependency injection hook for tests and server observability. */
  fetch?: FetchLike;
}

export function createConfiguredLlmProvider(
  options: LlmProviderFactoryOptions = {},
): LlmProvider {
  const config = loadLlmConfig(options.environment ?? processLlmEnvironment());
  return new OpenAiResponsesProvider(config, options.fetch ?? globalThis.fetch);
}
