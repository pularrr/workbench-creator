import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CodeEntryLink, CodeGraphNode, CodeProjectionBatch, RepositoryConnection } from "../../core/codegraph/schema";
import { LocalCodeGraphAdapter, createRepository, validateRepositoryRoot } from "./adapter";
import { CodeGraphStore } from "./store";
import { buildSourceDecodeBranchPatch, buildSourceProjectionPatch, buildSourceRelationRepairPatch, buildSourceSymbolPatch } from "./source-decode-branch";
import { createHostExplanationBrief } from "./host-explanation";
import { activeKnowledgeRepository, confirmationTokenService } from "../runtime/app-runtime";

const store = new CodeGraphStore(join(process.cwd(), "data", "runtime", "codegraph-state.json"));
const adapter = new LocalCodeGraphAdapter();
const now = () => new Date().toISOString();

export async function listCodeGraphState() { return store.read(); }

async function appendSourceDecodeBranch(repository: RepositoryConnection, signal?: AbortSignal) {
  const files = await adapter.listFiles(repository, signal);
  const knowledge = await activeKnowledgeRepository();
  const dataset = await knowledge.snapshot();
  const patch = buildSourceDecodeBranchPatch(dataset, repository, files);
  // Indexing was explicitly started by the user. CodeGraph facts are appended
  // through the same revision gate as normal graph changes, while the patch
  // builder guarantees that no existing knowledge node/card/edge is altered.
  const sessionId = "codegraph-index:" + repository.id;
  const issued = confirmationTokenService().issue(patch, sessionId);
  const proof = confirmationTokenService().verify(issued.token, patch, sessionId);
  await knowledge.applyConfirmedPatch(patch, proof, "codegraph-adapter");
  return { fileCount: files.length, revision: patch.baseRevision + 1 };
}

async function appendSourceSymbols(repository: RepositoryConnection, citations: readonly import("../../core/codegraph/schema").CodeCitation[]) {
  const knowledge = await activeKnowledgeRepository();
  const dataset = await knowledge.snapshot();
  const patch = buildSourceSymbolPatch(dataset, repository, citations);
  if (!patch) return;
  const sessionId = "codegraph-symbols:" + repository.id;
  const issued = confirmationTokenService().issue(patch, sessionId);
  await knowledge.applyConfirmedPatch(patch, confirmationTokenService().verify(issued.token, patch, sessionId), "codegraph-adapter");
}

const projectionPriority = (path: string) => {
  if (/^server\//.test(path)) return 0;
  if (/^features\//.test(path)) return 1;
  if (/^app\/(?:page|layout)\.tsx?$/.test(path)) return 2;
  // Framework route exports are commonly named GET/POST and cannot safely
  // use this CLI's name-based relation lookup without a stable symbol id.
  if (/^app\/(?:.*\/)?route\.tsx?$/.test(path)) return 4;
  return 3;
};

/** Writes one bounded slice of CodeGraph facts. More batches must be started
 * explicitly; a stopped budget is never represented as repository completion. */
export async function projectRepositoryBatch(repositoryId: string, options: { maxFiles?: number; maxSymbols?: number; signal?: AbortSignal } = {}) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new Error("仓库连接不存在。");
  if (repository.state !== "ready") throw new Error("源码索引尚未就绪，不能生成投影批次。");
  const files = await adapter.listFiles(repository, options.signal);
  const completed = new Set(state.batches.filter((batch) => batch.repositoryId === repositoryId && batch.state === "applied").flatMap((batch) => batch.filePaths));
  const selected = files.filter((file) => file.nodeCount > 0 && !completed.has(file.path))
    .sort((left, right) => projectionPriority(left.path) - projectionPriority(right.path) || right.nodeCount - left.nodeCount || left.path.localeCompare(right.path))
    .slice(0, Math.max(1, Math.min(options.maxFiles ?? 4, 6)));
  if (!selected.length) return { state: "complete" as const, batch: undefined, projection: undefined };
  const batch: CodeProjectionBatch = { id: randomUUID(), repositoryId, filePaths: selected.map((file) => file.path), symbolIds: [], state: "queued", startedAt: now(), revision: repository.revision };
  await store.update((draft) => { draft.batches.push(batch); });
  try {
    const projection = await adapter.projectFiles(repository, selected, options.maxSymbols ?? 8, options.signal);
    const knowledge = await activeKnowledgeRepository();
    const dataset = await knowledge.snapshot();
    const patch = buildSourceProjectionPatch(dataset, repository, projection);
    if (patch) {
      const sessionId = "codegraph-projection:" + batch.id;
      const issued = confirmationTokenService().issue(patch, sessionId);
      await knowledge.applyConfirmedPatch(patch, confirmationTokenService().verify(issued.token, patch, sessionId), "codegraph-adapter");
    }
    await store.update((draft) => {
      const item = draft.batches.find((value) => value.id === batch.id)!;
      item.state = "applied"; item.finishedAt = now(); item.symbolIds = projection.symbols.map((symbol) => symbol.id);
      item.facts = projection;
    });
    return { state: "applied" as const, batch, projection, patchApplied: Boolean(patch) };
  } catch (error) {
    await store.update((draft) => {
      const item = draft.batches.find((value) => value.id === batch.id)!;
      item.state = options.signal?.aborted ? "cancelled" : "failed"; item.finishedAt = now(); item.error = error instanceof Error ? error.message : "投影失败。";
    });
    throw error;
  }
}

/** A host-facing, provider-free handoff. The generated application never
 * calls a host LLM by itself; an explicitly registered host consumes this
 * brief and later submits a user-confirmed explanation patch. */
export async function hostExplanationBrief(repositoryId: string, batchId: string) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  const batch = state.batches.find((item) => item.id === batchId && item.repositoryId === repositoryId);
  if (!repository || !batch?.facts) throw new Error("找不到包含 CodeGraph 事实的已完成投影批次。");
  return createHostExplanationBrief(repository, batch.facts);
}

/** Recovery path for a batch whose facts were persisted before a repository
 * sync added its file nodes to the navigation branch. */
export async function reapplyProjectionFacts(repositoryId: string, batchId: string) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  const batch = state.batches.find((item) => item.id === batchId && item.repositoryId === repositoryId);
  if (!repository || !batch?.facts) throw new Error("找不到可重放的 CodeGraph 投影事实。");
  const knowledge = await activeKnowledgeRepository();
  const dataset = await knowledge.snapshot();
  const patch = buildSourceProjectionPatch(dataset, repository, batch.facts);
  if (!patch) return { reapplied: false, symbols: 0 };
  const sessionId = "codegraph-projection-replay:" + batch.id;
  const issued = confirmationTokenService().issue(patch, sessionId);
  await knowledge.applyConfirmedPatch(patch, confirmationTokenService().verify(issued.token, patch, sessionId), "codegraph-adapter");
  return { reapplied: true, symbols: batch.facts.symbols.length, relations: batch.facts.relations.length };
}

export async function repairSourceRelations(repositoryId: string) {
  const repository = (await store.read()).repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new Error("仓库连接不存在。");
  const knowledge = await activeKnowledgeRepository();
  const dataset = await knowledge.snapshot();
  const patch = buildSourceRelationRepairPatch(dataset, repository);
  if (!patch) return { repaired: false, removed: 0 };
  const sessionId = "codegraph-relation-repair:" + repositoryId;
  const issued = confirmationTokenService().issue(patch, sessionId);
  await knowledge.applyConfirmedPatch(patch, confirmationTokenService().verify(issued.token, patch, sessionId), "codegraph-adapter");
  return { repaired: true, removed: patch.operations.length };
}
export async function connectRepository(input: { rootPath: string; allowContext: boolean }) {
  const rootPath = await validateRepositoryRoot(input.rootPath);
  const existing = (await store.read()).repositories.find((item) => item.rootPath === rootPath);
  if (existing) return existing;
  const connection = createRepository(rootPath, input.allowContext);
  await store.update((state) => { state.repositories.push(connection); });
  return connection;
}

export async function indexRepository(repositoryId: string, signal?: AbortSignal) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new Error("仓库连接不存在。");
  const runId = randomUUID(), startedAt = now();
  await store.update((draft) => {
    const item = draft.repositories.find((value) => value.id === repositoryId)!;
    item.state = "indexing"; item.updatedAt = startedAt; item.lastError = undefined;
    draft.runs.push({ id: runId, repositoryId, state: "indexing", startedAt });
  });
  try {
    const result = await adapter.indexRepository(repository, signal);
    const indexedRepository: RepositoryConnection = { ...repository, state: "ready", revision: result.revision, updatedAt: now() };
    const sourceBranch = await appendSourceDecodeBranch(indexedRepository, signal);
    await store.update((draft) => {
      const item = draft.repositories.find((value) => value.id === repositoryId)!;
      item.state = "ready"; item.revision = result.revision; item.updatedAt = now();
      const run = draft.runs.find((value) => value.id === runId)!;
      run.state = "ready"; run.revision = result.revision; run.finishedAt = now();
      if (!draft.nodes.some((node) => node.repositoryId === repositoryId && node.kind === "repository")) draft.nodes.push({ id: randomUUID(), repositoryId, kind: "repository", label: item.displayName, path: ".", updatedAt: now() });
      draft.runs.find((value) => value.id === runId)!.error = "已建立源码解读分支：" + sourceBranch.fileCount + " 个文件。";
    });
    // First projection: useful entry/module symbols only. The remaining
    // repository stays queued for explicit continuation batches.
    await projectRepositoryBatch(repositoryId, { maxFiles: 4, maxSymbols: 8, signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "索引失败。";
    await store.update((draft) => {
      const item = draft.repositories.find((value) => value.id === repositoryId)!;
      item.state = signal?.aborted ? "cancelled" : "failed"; item.lastError = message; item.updatedAt = now();
      const run = draft.runs.find((value) => value.id === runId)!;
      run.state = item.state; run.error = message; run.finishedAt = now();
    });
    throw error;
  }
}

export async function repositoryStatus(repositoryId: string) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new Error("仓库连接不存在。");
  const status = await adapter.getRepositoryStatus(repository);
  if (status.state !== repository.state || status.revision !== repository.revision) await store.update((draft) => {
    const item = draft.repositories.find((value) => value.id === repositoryId)!;
    if (item.revision && status.revision && item.revision !== status.revision) for (const link of draft.links.filter((value) => value.repositoryId === repositoryId)) link.stale = true;
    item.state = status.state; item.revision = status.revision ?? item.revision; item.updatedAt = now();
  });
  return { ...repository, ...status };
}

/** P4-4 refresh path. CodeGraph performs an incremental sync; its internal
 * graph stays separate while changed citations are marked stale by revision. */
export async function syncRepository(repositoryId: string, signal?: AbortSignal) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new Error("仓库连接不存在。");
  const previousRevision = repository.revision;
  const result = await adapter.syncRepository(repository, signal);
  await store.update((draft) => {
    const item = draft.repositories.find((value) => value.id === repositoryId)!;
    item.state = "ready"; item.revision = result.revision; item.updatedAt = now(); item.lastError = undefined;
    if (previousRevision && result.revision && previousRevision !== result.revision) for (const link of draft.links.filter((value) => value.repositoryId === repositoryId)) link.stale = true;
  });
  // A sync can introduce source files that did not exist during the initial
  // index. Refresh the navigation projection before any new symbol batch.
  await appendSourceDecodeBranch({ ...repository, state: "ready", revision: result.revision, updatedAt: now() }, signal);
  return repositoryStatus(repositoryId);
}

export async function listLinks(knowledgeNodeId?: string) {
  const state = await store.read();
  return knowledgeNodeId ? state.links.filter((item) => item.knowledgeNodeId === knowledgeNodeId) : state.links;
}

export async function addCodeLink(input: Omit<CodeEntryLink, "id" | "createdAt" | "updatedAt" | "stale">) {
  const createdAt = now();
  const link: CodeEntryLink = { ...input, id: randomUUID(), stale: false, createdAt, updatedAt: createdAt };
  await store.update((state) => {
    let codeNodeId = link.codeNodeId;
    if (!codeNodeId) {
      const file = state.nodes.find((node) => node.repositoryId === link.repositoryId && node.kind === "file" && node.path === link.citation.path);
      const fileNode: CodeGraphNode = file ?? { id: randomUUID(), repositoryId: link.repositoryId, kind: "file", label: link.citation.path.split("/").at(-1) ?? link.citation.path, path: link.citation.path, updatedAt: createdAt };
      if (!file) state.nodes.push(fileNode);
      if (link.citation.symbol) {
        const symbol = state.nodes.find((node) => node.repositoryId === link.repositoryId && node.kind === "symbol" && node.path === link.citation.path && node.symbol === link.citation.symbol);
        const symbolNode: CodeGraphNode = symbol ?? { id: randomUUID(), repositoryId: link.repositoryId, kind: "symbol", label: link.citation.symbol, path: link.citation.path, symbol: link.citation.symbol, parentId: fileNode.id, citation: link.citation, updatedAt: createdAt };
        if (!symbol) state.nodes.push(symbolNode);
        codeNodeId = symbolNode.id;
      } else codeNodeId = fileNode.id;
    }
    link.codeNodeId = codeNodeId;
    state.links.push(link);
  });
  return link;
}

export async function queryCodeContext(repositoryId: string, question: string, options: { knowledgeNodeId?: string; signal?: AbortSignal } = {}) {
  const state = await store.read();
  const repository = state.repositories.find((item) => item.id === repositoryId);
  if (!repository) throw new Error("仓库连接不存在。");
  if (repository.state !== "ready") throw new Error("源码索引尚未就绪。");
  if (!repository.allowedToSendContext) throw new Error("用户未授权将局部源码发送给 LLM。");
  const context = await adapter.getRelatedContext(repository, question, options.signal);
  await appendSourceSymbols(repository, context.citations);
  if (context.citations.length) await store.update((draft) => {
    for (const citation of context.citations) {
      let file = draft.nodes.find((node) => node.repositoryId === repositoryId && node.kind === "file" && node.path === citation.path);
      if (!file) { file = { id: randomUUID(), repositoryId, kind: "file", label: citation.path.split("/").at(-1) ?? citation.path, path: citation.path, citation, updatedAt: now() }; draft.nodes.push(file); }
      if (options.knowledgeNodeId && !draft.links.some((link) => link.knowledgeNodeId === options.knowledgeNodeId && link.repositoryId === repositoryId && link.relation === "IMPLEMENTED_BY" && link.citation.path === citation.path && link.citation.startLine === citation.startLine && link.citation.endLine === citation.endLine)) {
        const createdAt = now();
        draft.links.push({ id: randomUUID(), knowledgeNodeId: options.knowledgeNodeId, repositoryId, codeNodeId: file.id, relation: "IMPLEMENTED_BY", citation, source: "codegraph-fact", rationale: "由用户启用的 CodeGraph 源码解读命中。", stale: false, createdAt, updatedAt: createdAt });
      }
    }
  });
  return context;
}

export type { CodeGraphNode, RepositoryConnection };
