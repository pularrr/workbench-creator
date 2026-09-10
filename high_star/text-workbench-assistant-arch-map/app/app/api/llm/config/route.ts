import { NextResponse } from "next/server";
import { runtimeLlmConfigStore } from "../../../../server/runtime/app-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(runtimeLlmConfigStore().status());
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { apiKey?: string; baseUrl?: string; model?: string; maxOutputTokens?:number };
    const status = runtimeLlmConfigStore().save({
      apiKey: body.apiKey,
      baseUrl: body.baseUrl?.trim() || "https://api.openai.com/v1",
      model: body.model?.trim() || "",
      maxOutputTokens:body.maxOutputTokens,
    });
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid LLM configuration." }, { status: 400 });
  }
}
