import { NextResponse } from "next/server";
import { createConfiguredLlmProvider } from "../../../../server/llm/provider-factory";
import { runtimeLlmConfigStore } from "../../../../server/runtime/app-runtime";

export const runtime = "nodejs";

export async function POST() {
  try {
    const store = runtimeLlmConfigStore();
    const provider = createConfiguredLlmProvider({ environment: store.environment() });
    const response = await provider.createResponse({
      instructions: "Return exactly: OK",
      messages: [{ role: "user", content: "Connection test" }],
      maxOutputTokens: 16,
    });
    return NextResponse.json({ ok: true, provider: response.provider, model: response.model, responseId: response.id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "LLM connection failed." }, { status: 502 });
  }
}
