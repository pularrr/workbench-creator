import { NextRequest, NextResponse } from "next/server";
import { syncRepository } from "../../../../../../server/codegraph/service";

export const runtime = "nodejs";
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ repository: await syncRepository((await context.params).id) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "源码刷新失败。" }, { status: 400 }); }
}
