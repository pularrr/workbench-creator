import { NextRequest, NextResponse } from "next/server";
import { connectRepository, indexRepository, listCodeGraphState } from "../../../../server/codegraph/service";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json(await listCodeGraphState()); }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { rootPath?: string; allowContext?: boolean; startIndex?: boolean };
    if (!body.rootPath) return NextResponse.json({ error: "缺少仓库目录。" }, { status: 400 });
    const repository = await connectRepository({ rootPath: body.rootPath, allowContext: body.allowContext === true });
    if (body.startIndex !== false) await indexRepository(repository.id);
    return NextResponse.json({ repository });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法连接仓库。" }, { status: 400 }); }
}
