import { runPipeline } from "@/lib/pipeline";
import type { EvalMode, SiteFacts, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = { query?: unknown; region?: unknown; facts?: unknown; history?: unknown; evalMode?: unknown };

export async function POST(request: Request) {
  let body: Body;
  try { body = await request.json(); } catch { return Response.json({ error: "잘못된 요청입니다." }, { status: 400 }); }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 1500) return Response.json({ error: "질문은 2자 이상 1,500자 이하로 입력해 주세요." }, { status: 400 });
  const region = typeof body.region === "string" ? body.region.slice(0, 40) : "";
  const facts = (body.facts && typeof body.facts === "object" ? Object.fromEntries(Object.entries(body.facts as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.length < 120)) : {}) as SiteFacts;
  const history = Array.isArray(body.history)
    ? (body.history as { q?: unknown; a?: unknown }[]).slice(-4).filter(t => typeof t?.q === "string").map(t => ({ q: String(t.q).slice(0, 800), a: typeof t.a === "string" ? t.a.slice(0, 1200) : undefined }))
    : [];
  const evalMode = (["none", "check", "auto"].includes(body.evalMode as string) ? body.evalMode : "none") as EvalMode;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runPipeline({ query, region, facts, history, evalMode, signal: request.signal }, emit);
      } catch (e) {
        emit({ type: "error", message: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
