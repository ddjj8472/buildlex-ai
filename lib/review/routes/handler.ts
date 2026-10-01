// Shared JSON handler for the plan-review phase routes: size guard, JSON parse, error shape.
export const MAX_BODY = 4_200_000; // under the 4.5 MB serverless request limit

export function phaseHandler<B, R>(name: string, run: (body: B, signal: AbortSignal) => Promise<R>) {
  return async (request: Request) => {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BODY) return Response.json({ error: `${name}: 요청이 너무 큽니다(${(len / 1e6).toFixed(1)}MB). 페이지 해상도를 낮춰 주세요.` }, { status: 413 });
    let body: B;
    try { body = (await request.json()) as B; } catch { return Response.json({ error: "잘못된 요청입니다." }, { status: 400 }); }
    const started = Date.now();
    try {
      const result = await run(body, request.signal);
      return Response.json({ ok: true, ms: Date.now() - started, result });
    } catch (e) {
      return Response.json({ error: `${name} 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
    }
  };
}
