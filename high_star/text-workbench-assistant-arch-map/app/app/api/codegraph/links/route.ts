import { NextRequest, NextResponse } from "next/server";
import { addCodeLink, listLinks } from "../../../../server/codegraph/service";

export async function GET(request: NextRequest) {
  return NextResponse.json({ links: await listLinks(request.nextUrl.searchParams.get("knowledgeNodeId") ?? undefined) });
}
export async function POST(request: NextRequest) {
  try { return NextResponse.json({ link: await addCodeLink(await request.json()) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法保存关联实现。" }, { status: 400 }); }
}
