import { NextRequest, NextResponse } from "next/server";
import { queryCodeContext } from "../../../../server/codegraph/service";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { repositoryId?: string; question?: string; knowledgeNodeId?: string };
    if (!body.repositoryId || !body.question?.trim()) return NextResponse.json({ error: "缺少仓库或问题。" }, { status: 400 });
    return NextResponse.json(await queryCodeContext(body.repositoryId, body.question, { knowledgeNodeId: body.knowledgeNodeId }));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "源码检索失败。" }, { status: 400 }); }
}
