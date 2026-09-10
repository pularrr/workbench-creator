import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expandedKnowledgeDataset } from "../../data/knowledge/initial-dataset";
import { RuntimeLlmConfigStore } from "../config/runtime-llm-config";
import { ConfirmationTokenService } from "../security/confirmation-token";
import { RuntimeKnowledgeRepository } from "./runtime-repository";
import { PostgresRuntimeKnowledgeRepository } from "./postgres-runtime-repository";

const runtimeDirectory = join(process.cwd(), "data", "runtime");

const globalRuntime = globalThis as typeof globalThis & {
  __fmcwKnowledgeRepository?: RuntimeKnowledgeRepository;
  __fmcwPostgresKnowledgeRepository?: PostgresRuntimeKnowledgeRepository;
  __fmcwLlmConfigStore?: RuntimeLlmConfigStore;
  __fmcwConfirmationTokens?: ConfirmationTokenService;
};

export function runtimeKnowledgeRepository(): RuntimeKnowledgeRepository {
  globalRuntime.__fmcwKnowledgeRepository ??= new RuntimeKnowledgeRepository(
    join(runtimeDirectory, "knowledge-state.json"),
    expandedKnowledgeDataset,
  );
  return globalRuntime.__fmcwKnowledgeRepository;
}

/** Explicit async entry point for the migration path; existing JSON callers remain unchanged. */
export function postgresRuntimeKnowledgeRepository(): PostgresRuntimeKnowledgeRepository {
  if (process.env.RUNTIME_STORE !== "postgres") throw new Error("Set RUNTIME_STORE=postgres to use the PostgreSQL repository.");
  globalRuntime.__fmcwPostgresKnowledgeRepository ??= new PostgresRuntimeKnowledgeRepository(expandedKnowledgeDataset);
  return globalRuntime.__fmcwPostgresKnowledgeRepository;
}

export async function activeKnowledgeRepository(): Promise<RuntimeKnowledgeRepository | PostgresRuntimeKnowledgeRepository> {
  if (process.env.RUNTIME_STORE === "postgres") return postgresRuntimeKnowledgeRepository();
  return runtimeKnowledgeRepository();
}

export function runtimeLlmConfigStore(): RuntimeLlmConfigStore {
  globalRuntime.__fmcwLlmConfigStore ??= new RuntimeLlmConfigStore(join(runtimeDirectory, "llm-config.json"));
  return globalRuntime.__fmcwLlmConfigStore;
}

export function confirmationTokenService(): ConfirmationTokenService {
  const secretPath = join(runtimeDirectory, "confirmation-secret");
  if (!process.env.CONFIRMATION_SECRET?.trim() && !existsSync(secretPath)) {
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(secretPath, randomBytes(48).toString("base64url"), { encoding: "utf8", mode: 0o600 });
  }
  globalRuntime.__fmcwConfirmationTokens ??= new ConfirmationTokenService(
    process.env.CONFIRMATION_SECRET?.trim() || readFileSync(secretPath, "utf8").trim(),
  );
  return globalRuntime.__fmcwConfirmationTokens;
}
