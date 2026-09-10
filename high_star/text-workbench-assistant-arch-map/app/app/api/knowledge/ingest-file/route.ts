import { NextResponse } from "next/server";
import { extractFile, supportsFile } from "../../../../core/ingestion/adapters";
import { stageTextImport } from "../../../../core/ingestion/offline-intake";
import { onlineAgentService } from "../../../../server/agent/online-agent-service";
import { matchClaimsToGraph } from "../../../../server/agent/claim-matcher";
import { createConfiguredLlmProvider } from "../../../../server/llm/provider-factory";
import { activeKnowledgeRepository, runtimeLlmConfigStore } from "../../../../server/runtime/app-runtime";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * P3-4 file ingestion: accepts a multipart upload (image or PDF), parses it
 * into text via the matching adapter (OCR for images, text-layer + scanned
 * OCR for PDFs), then runs the same staged pipeline as text ingestion:
 * stage → P3-3 graph matching → deep search → candidate.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sessionId = (form.get("sessionId") as string | null)?.trim() ?? "";
    const nodeId = (form.get("nodeId") as string | null)?.trim() ?? "";
    const kind = (form.get("kind") as string | null) ?? "document";

    if (!sessionId || !nodeId) throw new Error("sessionId and nodeId are required.");
    if (!(file instanceof File)) throw new Error("Missing file upload.");
    if (file.size <= 0) throw new Error("Uploaded file is empty.");
    if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 20 MB limit.");

    const buffer = new Uint8Array(await file.arrayBuffer());
    const fileKind: "image" | "pdf" = file.type.startsWith("image") ? "image" : "pdf";
    if (!supportsFile(fileKind, file.type)) {
      throw new Error(`Unsupported file type: ${file.type}. 支持图片（png/jpg/webp）与 PDF。`);
    }

    const title = file.name || "用户上传资料";
    const parsed = await extractFile(fileKind, buffer, title, "local-user", file.type);
    if (!parsed.segments.length) {
      return NextResponse.json({
        error: "未能从文件中提取到可用的文字内容。",
        notes: parsed.notes ?? [],
        artifactId: parsed.artifact.id,
      }, { status: 422 });
    }

    const text = parsed.segments.map((segment) => segment.text).join("\n\n");
    const staged = stageTextImport({
      kind: (kind === "paper" || kind === "conversation" || kind === "summary" || kind === "document") ? kind : "document",
      title,
      text,
      suppliedBy: "local-user",
      currentNodeId: nodeId,
    });

    // P3-3: real graph matching before deep search.
    let matches = staged.matches;
    if (runtimeLlmConfigStore().status().configured) {
      try {
        const provider = createConfiguredLlmProvider({ environment: runtimeLlmConfigStore().environment() });
      matches = await matchClaimsToGraph(provider, await (await activeKnowledgeRepository()).snapshot(), staged, nodeId);
      } catch {
        // Fail-open.
      }
    }

    const result = await onlineAgentService().deepSearch({
      sessionId,
      nodeId,
      query: `整理这份上传资料（${title}）并扩充当前节点：\n${text.slice(0, 20_000)}`,
      staged: { ...staged, matches },
    });

    return NextResponse.json({
      ...result,
      stagedArtifactId: staged.artifact.id,
      stagedClaimCount: staged.claims.length,
      ingestKind: kind,
      parsedNotes: parsed.notes ?? [],
      matchDecisions: matches.map((m) => ({ claimId: m.claimId, decision: m.decision, matchedNodeId: m.matchedNodeId ?? null, score: m.score })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File ingestion failed." }, { status: 400 });
  }
}
