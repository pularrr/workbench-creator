import { NextResponse } from "next/server";
import { activeKnowledgeRepository } from "../../../server/runtime/app-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const repository = await activeKnowledgeRepository();
  const [dataset, state] = await Promise.all([repository.snapshot(), repository.state()]);
  return NextResponse.json({ dataset, savepoints: state.savepoints.map(({ dataset: _dataset, ...item }) => item) });
}
