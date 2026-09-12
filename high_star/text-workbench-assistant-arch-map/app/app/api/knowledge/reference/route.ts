import { NextResponse } from "next/server";
export const runtime="nodejs";
export async function GET() {
  return NextResponse.json({ error: "参考基线属于独立示例应用，不由通用 Skill 提供。" }, { status: 404 });
}
export async function POST() { return GET(); }
