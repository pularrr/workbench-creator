import { NextResponse } from "next/server";
import { activeKnowledgeRepository } from "../../../../server/runtime/app-runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { label?: string; savedBy?: string };
    const savepoint = await (await activeKnowledgeRepository()).createSavepoint(body.label?.trim() || "用户保存版本", body.savedBy?.trim() || "local-user");
    const { dataset: _dataset, ...publicSavepoint } = savepoint;
    return NextResponse.json(publicSavepoint);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create savepoint." }, { status: 400 });
  }
}
