import type { GraphOperation, GraphPatch } from "../../core/agent/contracts";
import type { AgentEdgeRecord } from "../../core/agent/contracts";
import { applyOperations, createProjectionDiff, deterministicId } from "../../core/agent/graph-operations";
import { datasetToAgentGraph } from "../../core/knowledge/portable-bundle";
import type { KnowledgeDataset, KnowledgeNode } from "../../core/knowledge/schema";
import type { CodeGraphFile, CodeGraphProjection } from "./adapter";
import type { RepositoryConnection } from "../../core/codegraph/schema";
import type { CodeCitation, CodeGraphSymbol } from "../../core/codegraph/schema";

const sourceBranchId = (repositoryId: string) => "source-decode-" + repositoryId;
const repositoryNodeId = (repositoryId: string) => "source-repository-" + repositoryId;
const directoryNodeId = (repositoryId: string, path: string) => deterministicId("source-directory", { repositoryId, path });
const fileNodeId = (repositoryId: string, path: string) => deterministicId("source-file", { repositoryId, path });
const symbolNodeId = (repositoryId: string, symbol: Pick<CodeGraphSymbol, "path" | "name" | "startLine">) => deterministicId("source-symbol", { repositoryId, path: symbol.path, symbol: symbol.name, startLine: symbol.startLine });

function sourceNode(input: Omit<KnowledgeNode, "aliases" | "tags" | "status">): KnowledgeNode {
  return { ...input, aliases: [], tags: ["source-decode", "codegraph-fact"], status: "reviewed" };
}

function sourceCard(nodeId: string, headline: string, detail: string) {
  return { nodeId, headline, blocks: [{ type: "definition" as const, title: "源码定位", text: detail }], formulaIds: [], evidenceIds: [], revision: 1 };
}

function partOf(sourceId: string, targetId: string, rationale: string): AgentEdgeRecord & { weight: number; status: "reviewed" } {
  return { id: deterministicId("source-part-of", { from: sourceId, to: targetId }), sourceId, targetId, type: "PART_OF", rationale, weight: 1, status: "reviewed", evidenceIds: [] };
}

/**
 * Projects CodeGraph file facts as a root child branch. Existing project
 * knowledge nodes, cards and relations are not changed by this patch.
 */
export function buildSourceDecodeBranchPatch(dataset: KnowledgeDataset, repository: RepositoryConnection, files: readonly CodeGraphFile[]): GraphPatch {
  const root = dataset.nodes.find((item) => item.primaryParentId === null);
  if (!root) throw new Error("原知识图缺少唯一根节点，无法追加源码解读分支。");
  const branchId = sourceBranchId(repository.id);
  const repoId = repositoryNodeId(repository.id);
  const operations: GraphOperation[] = [];
  const branch = sourceNode({
    id: branchId, canonicalName: "源码解读", shortFact: "由 CodeGraph 索引的已授权源码导航分支；原项目知识节点保持不变。",
    nodeRole: "category", nodeType: "category", domainId: root.domainId, visualBranch: "system",
    primaryParentId: root.id, level: root.level + 1, order: 9000,
  });
  const repositoryNode = sourceNode({
    id: repoId, canonicalName: repository.displayName, shortFact: "已授权源码仓库，索引版本：" + (repository.revision ?? "working-tree") + "。",
    nodeRole: "category", nodeType: "category", domainId: root.domainId, visualBranch: "system",
    primaryParentId: branchId, level: branch.level + 1, order: 0,
  });
  operations.push(
    { kind: "upsert-node", node: branch }, { kind: "upsert-card", card: sourceCard(branch.id, branch.shortFact, "该分支只承载 CodeGraph 已核验的源码导航事实；不会改写原项目知识图。") },
    { kind: "upsert-node", node: repositoryNode }, { kind: "upsert-card", card: sourceCard(repositoryNode.id, repositoryNode.shortFact, "仓库根目录由用户授权；CodeGraph 索引状态为 " + repository.state + "。") },
    { kind: "upsert-edge", edge: partOf(branchId, root.id, "源码解读是原项目知识图根节点下的独立扩展分支。") },
    { kind: "upsert-edge", edge: partOf(repoId, branchId, "该仓库由源码解读分支管理。") },
  );
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join("/"));
  }
  for (const path of [...directories].sort((a, b) => a.localeCompare(b))) {
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parentId = parentPath ? directoryNodeId(repository.id, parentPath) : repoId;
    const directory = sourceNode({
      id: directoryNodeId(repository.id, path), canonicalName: path.split("/").at(-1)!, shortFact: "源码目录：" + path + "。",
      nodeRole: "category", nodeType: "category", domainId: root.domainId, visualBranch: "system",
      primaryParentId: parentId, level: parentPath ? parentPath.split("/").length + repositoryNode.level + 1 : repositoryNode.level + 1, order: 0,
    });
    operations.push(
      { kind: "upsert-node", node: directory },
      { kind: "upsert-card", card: sourceCard(directory.id, directory.shortFact, "目录结构来自 CodeGraph 文件索引。") },
      { kind: "upsert-edge", edge: partOf(directory.id, parentId, "由 CodeGraph 文件路径确定的目录归属。") },
    );
  }
  for (const [order, file] of files.slice().sort((a, b) => a.path.localeCompare(b.path)).entries()) {
    const parentPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const parentId = parentPath ? directoryNodeId(repository.id, parentPath) : repoId;
    const item = sourceNode({
      id: fileNodeId(repository.id, file.path), canonicalName: file.path.split("/").at(-1)!, shortFact: file.language + " 源文件；CodeGraph 已索引 " + file.nodeCount + " 个符号。",
      nodeRole: "entity", nodeType: "artifact", domainId: root.domainId, visualBranch: "system",
      primaryParentId: parentId, level: parentPath ? parentPath.split("/").length + repositoryNode.level + 1 : repositoryNode.level + 1, order,
    });
    operations.push(
      { kind: "upsert-node", node: item },
      { kind: "upsert-card", card: sourceCard(item.id, item.shortFact, "路径：" + file.path + "；文件大小：" + file.size + " 字节。可在源码解读问答中检索其相关符号和代码范围。") },
      { kind: "upsert-edge", edge: partOf(item.id, parentId, "由 CodeGraph 文件路径确定的文件归属。") },
    );
  }
  operations.push({ kind: "append-history", entry: { id: deterministicId("source-decode-history", { repositoryId: repository.id, revision: dataset.revision, files: files.map((file) => file.path) }), nodeId: branchId, kind: "revision_applied", summary: "CodeGraph 已建立 " + files.length + " 个源码文件的导航分支。", occurredAt: new Date().toISOString(), revision: dataset.revision + 1 } });
  const snapshot = { ...datasetToAgentGraph(dataset), revision: dataset.revision };
  const projected = applyOperations(snapshot, operations, dataset.revision + 1);
  return {
    id: deterministicId("source-decode-patch", { repositoryId: repository.id, baseRevision: dataset.revision, revision: repository.revision, files }),
    proposalId: deterministicId("source-decode-proposal", { repositoryId: repository.id, files }),
    baseRevision: dataset.revision,
    summary: "追加“源码解读”分支：" + repository.displayName,
    rationale: "CodeGraph 已完成用户授权仓库的本地索引；本补丁只新增根节点下的源码导航节点与事实关系，不修改原项目知识节点。",
    evidence: [{ id: "codegraph-index-" + repository.id, title: "CodeGraph 本地索引", source: repository.rootPath, locator: repository.revision, note: files.length + " 个文件" }],
    operations,
    projectionDiff: createProjectionDiff(snapshot, projected, branchId),
    builtBy: "build-agent",
  };
}

/** Adds only CodeGraph-returned symbols below already indexed file nodes. */
export function buildSourceSymbolPatch(dataset: KnowledgeDataset, repository: RepositoryConnection, citations: readonly CodeCitation[]): GraphPatch | undefined {
  const root = dataset.nodes.find((item) => item.primaryParentId === null);
  if (!root) throw new Error("原知识图缺少唯一根节点。");
  const operations: GraphOperation[] = [];
  for (const citation of citations) {
    if (!citation.symbol) continue;
    const fileId = fileNodeId(repository.id, citation.path);
    const file = dataset.nodes.find((item) => item.id === fileId);
    if (!file) continue;
    const id = symbolNodeId(repository.id, { path: citation.path, name: citation.symbol, startLine: citation.startLine });
    const symbol = sourceNode({
      id, canonicalName: citation.symbol, shortFact: "CodeGraph 已定位的源码符号：" + citation.path + " 第 " + citation.startLine + "–" + citation.endLine + " 行。",
      nodeRole: "entity", nodeType: "component", domainId: root.domainId, visualBranch: "system",
      primaryParentId: file.id, level: file.level + 1, order: citation.startLine,
    });
    operations.push(
      { kind: "upsert-node", node: symbol },
      { kind: "upsert-card", card: sourceCard(symbol.id, symbol.shortFact, "路径：" + citation.path + "；版本：" + citation.revision + "；内容哈希：" + citation.contentHash + "。") },
      { kind: "upsert-edge", edge: partOf(symbol.id, file.id, "CodeGraph 将该符号定位在此文件范围内。") },
    );
  }
  if (!operations.length) return undefined;
  const snapshot = { ...datasetToAgentGraph(dataset), revision: dataset.revision };
  const projected = applyOperations(snapshot, operations, dataset.revision + 1);
  return {
    id: deterministicId("source-symbol-patch", { repositoryId: repository.id, baseRevision: dataset.revision, citations }),
    proposalId: deterministicId("source-symbol-proposal", { repositoryId: repository.id, citations }),
    baseRevision: dataset.revision,
    summary: "补充 CodeGraph 命中符号：" + repository.displayName,
    rationale: "仅将本次 CodeGraph 结构化代码块中的符号追加到既有源码解读分支。",
    evidence: citations.map((citation) => ({ id: deterministicId("codegraph-citation", citation), title: citation.symbol ?? citation.path, source: citation.path, locator: citation.revision, note: "第 " + citation.startLine + "–" + citation.endLine + " 行" })),
    operations,
    projectionDiff: createProjectionDiff(snapshot, projected),
    builtBy: "build-agent",
  };
}

function symbolCitation(symbol: CodeGraphSymbol, revision: string): CodeCitation {
  const text = [symbol.kind, symbol.name, symbol.signature ?? "", symbol.path, symbol.startLine, symbol.endLine].join("\n");
  return {
    path: symbol.path, symbol: symbol.name, startLine: symbol.startLine, endLine: symbol.endLine, revision,
    contentHash: deterministicId("codegraph-symbol-fact", text), source: "codegraph-fact",
  };
}

/** Builds a bounded symbol/call/impact projection from CodeGraph facts.
 * It intentionally contains no LLM explanation: that belongs to a separate
 * host-authored candidate patch and therefore can never overwrite a fact. */
export function buildSourceProjectionPatch(dataset: KnowledgeDataset, repository: RepositoryConnection, projection: CodeGraphProjection): GraphPatch | undefined {
  const root = dataset.nodes.find((item) => item.primaryParentId === null);
  if (!root || !projection.symbols.length) return undefined;
  const operations: GraphOperation[] = [];
  const known = new Set(dataset.nodes.map((node) => node.id));
  const ensureSymbol = (symbol: CodeGraphSymbol) => {
    const id = symbolNodeId(repository.id, symbol);
    if (known.has(id)) return id;
    const file = dataset.nodes.find((node) => node.id === fileNodeId(repository.id, symbol.path));
    if (!file) return undefined;
    const citation = symbolCitation(symbol, repository.revision ?? "working-tree");
    const detail = [
      "种类：" + symbol.kind + "；路径：" + symbol.path + " 第 " + symbol.startLine + "–" + symbol.endLine + " 行。",
      symbol.signature ? "签名：" + symbol.signature : "",
      symbol.exported === true ? "该符号由文件导出。" : "",
      symbol.asynchronous === true ? "该符号为异步实现。" : "",
    ].filter(Boolean).join("\n");
    const node = sourceNode({
      id, canonicalName: symbol.name, shortFact: "CodeGraph 已定位的 " + symbol.kind + "：" + symbol.path + " 第 " + symbol.startLine + "–" + symbol.endLine + " 行。",
      nodeRole: "entity", nodeType: "component", domainId: root.domainId, visualBranch: "system",
      primaryParentId: file.id, level: file.level + 1, order: symbol.startLine,
    });
    operations.push(
      { kind: "upsert-node", node },
      { kind: "upsert-card", card: { nodeId: id, headline: symbol.name, blocks: [
        { type: "definition", title: "源码事实", text: detail },
        { type: "inputs_outputs", title: "签名与接口", text: symbol.signature ?? "CodeGraph 未提供函数签名。" },
      ], formulaIds: [], evidenceIds: [], revision: 1 } },
      { kind: "upsert-edge", edge: partOf(id, file.id, "CodeGraph 将该符号定位在此文件范围内。") },
    );
    known.add(id);
    return id;
  };
  for (const symbol of projection.symbols) ensureSymbol(symbol);
  for (const relation of projection.relations) {
    const fromId = ensureSymbol(relation.from), toId = ensureSymbol(relation.to);
    if (!fromId || !toId || fromId === toId) continue;
    const edgeType = relation.kind === "AFFECTS" ? "AFFECTS" : relation.kind;
    const edge: AgentEdgeRecord & { weight: number; status: "reviewed" } = {
      id: deterministicId("source-relation", { repositoryId: repository.id, kind: relation.kind, fromId, toId }),
      sourceId: fromId, targetId: toId, type: edgeType, rationale: "CodeGraph " + (relation.kind === "CALLS" ? "调用关系" : relation.kind === "CALLED_BY" ? "调用者关系" : "影响分析") + "事实。" + (relation.limitation ? " 注意：" + relation.limitation : ""),
      weight: 1, status: "reviewed", evidenceIds: [],
    };
    operations.push({ kind: "upsert-edge", edge });
  }
  if (!operations.length) return undefined;
  const snapshot = { ...datasetToAgentGraph(dataset), revision: dataset.revision };
  const projected = applyOperations(snapshot, operations, dataset.revision + 1);
  return {
    id: deterministicId("source-projection-patch", { repositoryId: repository.id, baseRevision: dataset.revision, revision: repository.revision, symbols: projection.symbols, relations: projection.relations }),
    proposalId: deterministicId("source-projection-proposal", { repositoryId: repository.id, symbols: projection.symbols, relations: projection.relations }),
    baseRevision: dataset.revision, summary: "投影 CodeGraph 符号与调用关系：" + repository.displayName,
    rationale: "仅写入 CodeGraph 返回的符号、调用者、被调用者与影响范围事实；不包含模型解释，也不修改原项目知识节点。",
    evidence: projection.symbols.map((symbol) => ({ id: deterministicId("codegraph-symbol-evidence", symbol), title: symbol.name, source: symbol.path, locator: repository.revision, note: "第 " + symbol.startLine + "–" + symbol.endLine + " 行；" + symbol.kind })),
    operations, projectionDiff: createProjectionDiff(snapshot, projected), builtBy: "build-agent",
  };
}

/** Removes only earlier relation projections made before name-collision
 * filtering. Navigation nodes, source symbols and original knowledge stay. */
export function buildSourceRelationRepairPatch(dataset: KnowledgeDataset, repository: RepositoryConnection): GraphPatch | undefined {
  const sourceIds = new Set(dataset.nodes.filter((node) => node.tags.includes("source-decode")).map((node) => node.id));
  const operations: GraphOperation[] = dataset.edges
    .filter((edge) => sourceIds.has(edge.sourceId) && ["CALLS", "CALLED_BY", "AFFECTS"].includes(edge.type))
    .map((edge) => ({ kind: "remove-edge" as const, edgeId: edge.id }));
  if (!operations.length) return undefined;
  const snapshot = { ...datasetToAgentGraph(dataset), revision: dataset.revision };
  const projected = applyOperations(snapshot, operations, dataset.revision + 1);
  return {
    id: deterministicId("source-relation-repair", { repositoryId: repository.id, baseRevision: dataset.revision, removed: operations }),
    proposalId: deterministicId("source-relation-repair-proposal", { repositoryId: repository.id, operations }),
    baseRevision: dataset.revision, summary: "修复过宽的 CodeGraph 名称式关系投影：" + repository.displayName,
    rationale: "仅移除旧版本对 GET/POST 等通用符号的可能误匹配关系；文件、符号和原知识图保持不变。",
    evidence: [], operations, projectionDiff: createProjectionDiff(snapshot, projected), builtBy: "build-agent",
  };
}
