import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { CodeCitation, CodeGraphIndexState, CodeGraphRelation, CodeGraphSymbol, RepositoryConnection } from "../../core/codegraph/schema";

const DEFAULT_EXCLUDES = [".git/**", ".env*", "**/*.pem", "**/*.key", "node_modules/**", "dist/**", "build/**", "coverage/**"];

export class CodeGraphUnavailableError extends Error {}
export class RepositoryAccessError extends Error {}

export type CodeContextBundle = { answer: string; citations: CodeCitation[]; limitations: string[] };
export type CodeGraphFile = { path: string; language: string; nodeCount: number; size: number };
export type CodeGraphProjection = { symbols: CodeGraphSymbol[]; relations: CodeGraphRelation[]; limitations: string[] };

export interface CodeGraphAdapter {
  indexRepository(connection: RepositoryConnection, signal?: AbortSignal): Promise<{ revision?: string }>;
  syncRepository(connection: RepositoryConnection, signal?: AbortSignal): Promise<{ revision?: string }>;
  getRepositoryStatus(connection: RepositoryConnection): Promise<{ state: CodeGraphIndexState; revision?: string }>;
  getRelatedContext(connection: RepositoryConnection, question: string, signal?: AbortSignal): Promise<CodeContextBundle>;
  listFiles(connection: RepositoryConnection, signal?: AbortSignal): Promise<CodeGraphFile[]>;
  projectFiles(connection: RepositoryConnection, files: readonly CodeGraphFile[], maxSymbols: number, signal?: AbortSignal): Promise<CodeGraphProjection>;
}

function commandSpec(): { executable: string; prefixArgs: string[] } {
  if (process.env.CODEGRAPH_COMMAND?.trim()) return { executable: process.env.CODEGRAPH_COMMAND.trim(), prefixArgs: [] };
  // npm global executables are not always inherited by a desktop-launched
  // Next process on Windows. Invoke the package shim with Node directly rather
  // than shelling out through codegraph.cmd, so user questions never become
  // shell syntax. The explicit env override remains authoritative.
  if (process.platform === "win32" && process.env.APPDATA) return { executable: process.execPath, prefixArgs: [join(process.env.APPDATA, "npm", "node_modules", "@colbymchenry", "codegraph", "npm-shim.js")] };
  return { executable: "codegraph", prefixArgs: [] };
}

function runCli(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const spec = commandSpec();
    const child = spawn(spec.executable, [...spec.prefixArgs, ...args], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CODEGRAPH_TELEMETRY: "0" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => reject(new CodeGraphUnavailableError(`CodeGraph 不可用：${error.message}`)));
    child.once("close", (code) => code === 0 ? resolveResult(stdout) : reject(new Error(`CodeGraph 命令失败（${code ?? "unknown"}）：${stderr || stdout}`)));
    signal?.addEventListener("abort", () => child.kill(), { once: true });
  });
}

function runProgram(program: string, args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolveResult) => {
    const child = spawn(program, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", () => resolveResult(undefined));
    child.once("close", (code) => resolveResult(code === 0 ? stdout.trim() || undefined : undefined));
  });
}

function revisionFrom(text: string) {
  const match = text.match(/(?:revision|commit|HEAD)\s*[:=]\s*([0-9a-f]{7,64})/i);
  return match?.[1];
}

async function repositoryRevision(rootPath: string) {
  return await runProgram("git", ["rev-parse", "HEAD"], rootPath) ?? "working-tree";
}

type ContextJson = {
  summary?: unknown;
  codeBlocks?: Array<{ filePath?: unknown; startLine?: unknown; endLine?: unknown; content?: unknown; nodeName?: unknown }>;
};

type CliSymbol = {
  id?: unknown; name?: unknown; kind?: unknown; filePath?: unknown; startLine?: unknown; endLine?: unknown;
  signature?: unknown; isExported?: unknown; isAsync?: unknown;
};

function asSymbol(value: CliSymbol): CodeGraphSymbol | undefined {
  if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.kind !== "string" || typeof value.filePath !== "string"
    || typeof value.startLine !== "number") return undefined;
  return {
    id: value.id, name: value.name, kind: value.kind, path: value.filePath.replaceAll("\\", "/"),
    startLine: value.startLine, endLine: typeof value.endLine === "number" ? value.endLine : value.startLine,
    ...(typeof value.signature === "string" && value.signature ? { signature: value.signature } : {}),
    ...(typeof value.isExported === "boolean" ? { exported: value.isExported } : {}),
    ...(typeof value.isAsync === "boolean" ? { asynchronous: value.isAsync } : {}),
  };
}

function asRelationTarget(value: unknown): CodeGraphSymbol | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.kind !== "string" || typeof item.filePath !== "string" || typeof item.startLine !== "number") return undefined;
  return { id: `resolved:${item.filePath}:${item.name}:${item.startLine}`, name: item.name, kind: item.kind, path: item.filePath.replaceAll("\\", "/"), startLine: item.startLine, endLine: item.startLine };
}

function parseSymbolSearch(raw: string): CodeGraphSymbol[] {
  try {
    const values = JSON.parse(raw) as Array<{ node?: CliSymbol }>;
    return values.flatMap((value) => value.node ? [asSymbol(value.node)].filter((item): item is CodeGraphSymbol => Boolean(item)) : []);
  } catch { return []; }
}

function parseRelationResult(raw: string, key: "callers" | "callees" | "affected"): CodeGraphSymbol[] {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Array.isArray(value[key]) ? value[key].flatMap((item) => [asRelationTarget(item)].filter((candidate): candidate is CodeGraphSymbol => Boolean(candidate))) : [];
  } catch { return []; }
}

function parseFileOutline(raw: string, path: string): CodeGraphSymbol[] {
  const symbols: CodeGraphSymbol[] = [];
  // The symbols-only file outline is compact text. It is used only to find
  // the canonical JSON symbol record in the next query.
  const pattern = /^- \`([^\`]+)\` \(([^)]+)\)(?:\s+(.+?))?\s+—\s+:(\d+)$/gm;
  for (const match of raw.matchAll(pattern)) {
    const [, name, kind, signature, start] = match;
    if (!["function", "method", "class", "interface"].includes(kind)) continue;
    symbols.push({
      id: "outline:" + path + ":" + name + ":" + start, name, kind, path, startLine: Number(start), endLine: Number(start),
      ...(signature?.trim() ? { signature: signature.trim() } : {}),
    });
  }
  return symbols;
}

function parseContextJson(raw: string, revision: string): CodeContextBundle {
  let parsed: ContextJson;
  try { parsed = JSON.parse(raw) as ContextJson; }
  catch { throw new Error("CodeGraph context 未返回 JSON；请确认已安装 colbymchenry/codegraph 1.6.0 或更高版本。"); }
  const blocks = (parsed.codeBlocks ?? []).flatMap((block) => typeof block.filePath === "string"
    && typeof block.startLine === "number" && typeof block.endLine === "number" && typeof block.content === "string"
    ? [{ path: block.filePath, startLine: block.startLine, endLine: block.endLine, ...(typeof block.nodeName === "string" ? { symbol: block.nodeName } : {}), revision, contentHash: createHash("sha256").update(block.content).digest("hex"), source: "codegraph-fact" as const, content: block.content }]
    : []);
  const citations = blocks.map(({ content: _content, ...citation }) => citation);
  const text = [
    typeof parsed.summary === "string" ? parsed.summary : "",
    ...blocks.map((block) => `\n\n【${block.path}:${block.startLine}-${block.endLine}${block.symbol ? ` · ${block.symbol}` : ""}】\n\`\`\`\n${block.content}\n\`\`\``),
  ].filter(Boolean).join("\n");
  return { answer: text, citations, limitations: citations.length ? [] : ["CodeGraph 未返回可核验代码块，本轮不会将源码作为事实证据。"] };
}

/** The external executable is isolated here: no route, UI or knowledge agent
 * invokes CodeGraph directly. P4-0 uses its documented local-command mode. */
export class LocalCodeGraphAdapter implements CodeGraphAdapter {
  async indexRepository(connection: RepositoryConnection, signal?: AbortSignal) {
    await runCli(["init"], connection.rootPath, signal);
    return { revision: await repositoryRevision(connection.rootPath) };
  }

  async syncRepository(connection: RepositoryConnection, signal?: AbortSignal) {
    await runCli(["sync"], connection.rootPath, signal);
    return { revision: await repositoryRevision(connection.rootPath) };
  }

  async getRepositoryStatus(connection: RepositoryConnection) {
    try {
      const result = await runCli(["status"], connection.rootPath);
      return { state: (/up to date|ready|indexed|healthy/i.test(result) ? "ready" : "stale") as CodeGraphIndexState, revision: revisionFrom(result) ?? await repositoryRevision(connection.rootPath) };
    } catch (error) {
      if (error instanceof CodeGraphUnavailableError) return { state: "failed" as const };
      throw error;
    }
  }

  async getRelatedContext(connection: RepositoryConnection, question: string, signal?: AbortSignal): Promise<CodeContextBundle> {
    const answer = await runCli(["context", "--format", "json", "--max-nodes", "4", question], connection.rootPath, signal);
    return parseContextJson(answer, await repositoryRevision(connection.rootPath));
  }

  async listFiles(connection: RepositoryConnection, signal?: AbortSignal): Promise<CodeGraphFile[]> {
    const output = await runCli(["files", "--format", "flat", "--json"], connection.rootPath, signal);
    try {
      const values = JSON.parse(output) as Array<Partial<CodeGraphFile>>;
      return values.flatMap((value) => typeof value.path === "string"
        ? [{ path: value.path.replaceAll("\\", "/"), language: typeof value.language === "string" ? value.language : "text", nodeCount: typeof value.nodeCount === "number" && Number.isSafeInteger(value.nodeCount) ? value.nodeCount : 0, size: typeof value.size === "number" && Number.isSafeInteger(value.size) ? value.size : 0 }]
        : []);
    } catch {
      throw new Error("CodeGraph files 未返回 JSON，无法构建源码解读导航分支。");
    }
  }

  /**
   * Projects only a small, high-value part of the external graph. This is
   * deliberately not a database dump: CLI relations are facts, while their
   * architectural meaning remains available for the host explanation stage.
   */
  async projectFiles(connection: RepositoryConnection, files: readonly CodeGraphFile[], maxSymbols: number, signal?: AbortSignal): Promise<CodeGraphProjection> {
    const selected = files
      .slice()
      .sort((left, right) => right.nodeCount - left.nodeCount || left.path.localeCompare(right.path))
      .slice(0, Math.max(1, Math.min(files.length, 6)));
    const limitations: string[] = [];
    const symbols: CodeGraphSymbol[] = [];
    for (const file of selected) {
      const outline = await runCli(["node", "--file", file.path, "--symbols-only"], connection.rootPath, signal);
      for (const shallow of parseFileOutline(outline, file.path)) {
        const raw = await runCli(["query", "--json", "--limit", "12", shallow.name], connection.rootPath, signal);
        const canonical = parseSymbolSearch(raw).find((candidate) => candidate.path === shallow.path && candidate.name === shallow.name && candidate.startLine === shallow.startLine);
        symbols.push(canonical ?? shallow);
        if (symbols.length >= maxSymbols) break;
      }
      if (symbols.length >= maxSymbols) break;
    }
    const unique = [...new Map(symbols
      .sort((a, b) => Number(Boolean(b.exported)) - Number(Boolean(a.exported)) || a.path.localeCompare(b.path) || a.startLine - b.startLine)
      .map((symbol) => [symbol.id, symbol] as const)).values()]
      .slice(0, Math.max(1, maxSymbols));
    const relations: CodeGraphRelation[] = [];
    for (const symbol of unique) {
      if (!["function", "method"].includes(symbol.kind)) {
        limitations.push(symbol.path + ":" + symbol.startLine + " 的 " + symbol.name + " 是 " + symbol.kind + "，当前只对可执行符号投影调用和影响关系。");
        continue;
      }
      // The CLI relation commands resolve by name. Route exports such as GET
      // and POST are intentionally duplicated throughout a Next.js project;
      // projecting those matches as facts would manufacture false edges.
      if (new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "main", "run", "init", "close", "get", "set", "status"]).has(symbol.name)) {
        limitations.push(symbol.path + ":" + symbol.startLine + " 的 " + symbol.name + " 为通用名称，已跳过名称式关系投影；需由更精确的 CodeGraph 标识符接口支持后再补充。");
        continue;
      }
      const [callers, callees, affected] = await Promise.all([
        runCli(["callers", "--json", "--limit", "12", symbol.name], connection.rootPath, signal),
        runCli(["callees", "--json", "--limit", "12", symbol.name], connection.rootPath, signal),
        runCli(["impact", "--json", "--depth", "2", symbol.name], connection.rootPath, signal),
      ]);
      const ambiguity = "当前 CLI 按符号名查询；同名符号可能需要在宿主解释时结合文件路径核验。";
      for (const target of parseRelationResult(callers, "callers")) relations.push({ kind: "CALLED_BY", from: symbol, to: target, limitation: ambiguity });
      for (const target of parseRelationResult(callees, "callees")) relations.push({ kind: "CALLS", from: symbol, to: target, limitation: ambiguity });
      for (const target of parseRelationResult(affected, "affected")) {
        if (target.id !== symbol.id && !(target.path === symbol.path && target.startLine === symbol.startLine)) relations.push({ kind: "AFFECTS", from: symbol, to: target, limitation: ambiguity });
      }
    }
    if (!unique.length) limitations.push("本批文件未从 CodeGraph 检索到可投影的函数、方法、类或接口。");
    return { symbols: unique, relations, limitations };
  }
}

export async function validateRepositoryRoot(input: string): Promise<string> {
  if (!input || !existsSync(input)) throw new RepositoryAccessError("仓库目录不存在。");
  const root = await realpath(input);
  const configuredRoots = (process.env.CODEGRAPH_ALLOWED_ROOTS ?? process.cwd()).split(";").filter(Boolean).map((item) => resolve(/* turbopackIgnore: dynamic user-configured path */ item));
  const permitted = configuredRoots.some((allowed) => root === allowed || root.startsWith(`${allowed}${sep}`));
  if (!permitted) throw new RepositoryAccessError("该目录不在 CODEGRAPH_ALLOWED_ROOTS 允许范围内。");
  return root;
}

export function createRepository(rootPath: string, allowContext: boolean): RepositoryConnection {
  const now = new Date().toISOString();
  return { id: randomUUID(), rootPath, displayName: basename(rootPath), allowedToSendContext: allowContext, excludePatterns: [...DEFAULT_EXCLUDES], state: "idle", createdAt: now, updatedAt: now };
}

export function citationForFile(rootPath: string, absolutePath: string, text: string, startLine = 1, endLine = 1): CodeCitation {
  return { path: relative(rootPath, absolutePath).replaceAll("\\", "/"), startLine, endLine, revision: "unverified", contentHash: createHash("sha256").update(text).digest("hex"), source: "codegraph-fact" };
}
