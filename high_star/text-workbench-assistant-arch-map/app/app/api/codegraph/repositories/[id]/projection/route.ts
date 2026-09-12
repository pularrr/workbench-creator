import { NextRequest, NextResponse } from "next/server";
import { hostExplanationBrief, listCodeGraphState, projectRepositoryBatch } from "../../../../../../server/codegraph/service";

export const runtime = "nodejs";

/** Continues one bounded fact-only projection batch. Host LLM explanation is
 * deliberately a separate build-layer step, never an implicit API-side call. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { maxFiles?: number; maxSymbols?: number };
    return NextResponse.json(await projectRepositoryBatch(id, {
      maxFiles: typeof body.maxFiles === "number" ? body.maxFiles : undefined,
      maxSymbols: typeof body.maxSymbols === "number" ? body.maxSymbols : undefined,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成源码投影批次。" }, { status: 400 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const batchId = request.nextUrl.searchParams.get("hostBrief");
  if (batchId) {
    try { return NextResponse.json(await hostExplanationBrief(id, batchId)); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成宿主解释简报。" }, { status: 400 }); }
  }
  const state = await listCodeGraphState();
  return NextResponse.json({ batches: state.batches.filter((batch) => batch.repositoryId === id) });
}
