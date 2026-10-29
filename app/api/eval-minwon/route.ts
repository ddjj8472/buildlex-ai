// Evaluation hook for the 법제처 해석례 set (scripts/eval-minwon): GET /api/eval-minwon?i=<case index>
// runs the same pipeline as /api/ask with that case held out and returns the answer as JSON, so a
// protected preview deployment can be evaluated with a plain GET (no browser needed).
// Disabled on production: it would let anyone spend Gemini quota.
import { runPipeline } from "@/lib/pipeline";
import type { StreamEvent } from "@/lib/types";
import cases from "@/tests/minwon.json";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Case = { title: string; question: string };

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const i = Number(new URL(request.url).searchParams.get("i"));
  const c = (cases as Case[])[i];
  if (!Number.isInteger(i) || !c) return Response.json({ error: "i: 0~59" }, { status: 400 });
  const t0 = Date.now();
  let answer = "";
  const stages: Record<string, string> = {};
  const warnings: string[] = [];
  await runPipeline({ query: c.question.slice(0, 1500), region: "", facts: {}, history: [], evalMode: "none", holdout: [c.title], signal: request.signal }, (e: StreamEvent) => {
    if (e.type === "delta") answer += e.text;
    else if (e.type === "reset") answer = "";
    else if (e.type === "warning") warnings.push(e.message);
    else if (e.type === "stage" && e.status !== "running") stages[e.id] = `${e.status}${e.ms ? `:${e.ms}` : ""}${e.detail ? ` ${e.detail}` : ""}`;
    else if (e.type === "done" && e.answer) answer = e.answer;
    else if (e.type === "error") answer = `ERR ${e.message}`;
  }).catch(e => { answer = `ERR ${e instanceof Error ? e.message : String(e)}`; });
  const conclusion = (answer.match(/## 결론\s*([\s\S]*?)(\n## |$)/)?.[1] ?? answer).trim();
  return Response.json({ i, title: c.title, ms: Date.now() - t0, reason: stages.reason ?? "", conclusion, warnings, answer });
}
