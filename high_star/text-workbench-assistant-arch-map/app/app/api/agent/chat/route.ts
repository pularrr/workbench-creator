import { NextResponse } from "next/server";
import { onlineAgentService } from "../../../../server/agent/online-agent-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; nodeId?: string; query?: string };
    if (!body.sessionId?.trim() || !body.nodeId?.trim() || !body.query?.trim()) throw new Error("sessionId, nodeId and query are required.");
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of onlineAgentService().answerStream({ sessionId: body.sessionId!, nodeId: body.nodeId!, query: body.query! })) {
            if (event.type === "meta") {
              controller.enqueue(sse("meta", { runId: event.runId, mode: event.mode, provider: event.provider, model: event.model }));
            } else if (event.type === "delta") {
              controller.enqueue(sse("delta", { text: event.text }));
            } else if (event.type === "done") {
              controller.enqueue(sse("done", { result: event.result }));
              controller.close();
              return;
            } else if (event.type === "error") {
              controller.enqueue(sse("error", { message: event.message }));
              controller.close();
              return;
            }
          }
          controller.close();
        } catch (error) {
          controller.enqueue(sse("error", { message: error instanceof Error ? error.message : "Agent request failed." }));
          controller.close();
        }
      },
    });
    return new NextResponse(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent request failed." }, { status: 400 });
  }
}
