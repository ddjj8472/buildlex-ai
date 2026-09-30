import { ruleAnalysis } from "@/lib/analyze-rules";
import { resolveRegion } from "@/lib/corpus";
import { hybridSearch } from "@/lib/search";

export const runtime = "nodejs";

// Retrieval-only endpoint for debugging and evaluation (no LLM calls).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json({ error: "q is required" }, { status: 400 });
  const analysis = ruleAnalysis(q);
  const region = resolveRegion(url.searchParams.get("region") || analysis.facts.지역);
  const { evidence, debug } = await hybridSearch(analysis, { region, dense: url.searchParams.get("dense") !== "0" });
  return Response.json({
    analysis, region: region?.label || null, debug,
    results: evidence.map(e => ({ n: e.n, id: e.chunk.id, law: e.chunk.lawName, article: e.chunk.articleNo, heading: e.chunk.heading, via: e.via, score: Number(e.score.toFixed(4)) })),
  });
}
