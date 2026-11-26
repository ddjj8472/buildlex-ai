// Preview-only evaluation runner: GET ?i=<index in tests/minwon.json>. Runs the pipeline exactly as /api/ask
// with the test case held out — 법리 노트 off, the case's own 해석례 blocked by 안건명 and 안건번호, only
// 해석례 and amendments dated before the case (asOf), larger models for judging and the answer (the sub-analyses stay on lite; ?lite=1 allows lite everywhere) — and returns the answer next to the 법제처 answer.
// Disabled on production.
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import type { StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

type Case = { no: string; date: string; title: string; question: string; answer: string };

const iso = (d: string) => { const m = d.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : undefined; };

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests", "minwon.json"), "utf8")) as Case[];
  const c = cases[Number(req.nextUrl.searchParams.get("i"))];
  if (!c) return Response.json({ error: "i" }, { status: 400 });
  const t = Date.now();
  const stages: Record<string, string> = {};
  const warnings: string[] = [];
  let answer = "", error = "";
  let precedents: string[] = [], structure = "";
  const emit = (e: StreamEvent) => {
    const x = e as unknown as Record<string, unknown>;
    if (e.type === "stage" && x.status !== "running") stages[String(x.id)] = `${x.status}${x.detail ? `: ${x.detail}` : ""}`;
    else if (e.type === "delta") answer += e.text;
    else if (e.type === "reset") answer = "";
    else if (e.type === "done") answer = e.answer || answer;
    else if (e.type === "warning") warnings.push(String(x.message));
    else if (e.type === "error") error = String(x.message);
    else if (e.type === "evidence") {
      precedents = ((x.interpretations as { title: string; date: string }[]) || []).map(p => `${p.date} ${p.title}`);
      structure = ((x.notes as { title: string; text: string }[]) || []).filter(n => /구조 분석/.test(n.title)).map(n => n.text).join("\n");
    }
  };
  await runPipeline({ query: c.question.slice(0, 1500), evalMode: "none", holdout: [c.title], holdoutNos: [c.no], noDoctrine: true, asOf: iso(c.date), strongOnly: req.nextUrl.searchParams.get("lite") !== "1", signal: req.signal }, emit)
    .catch(e => { error = e instanceof Error ? e.message : String(e); });
  return Response.json({ i: Number(req.nextUrl.searchParams.get("i")), no: c.no, ms: Date.now() - t, stages, precedents, structure, warnings, error, answer, gold: c.answer });
}
