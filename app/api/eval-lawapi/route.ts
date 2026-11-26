// Preview-only probe of the 국가법령정보 Open API shapes used by the precedent / 개정이유 collectors.
// Disabled on production (it spends the API key). GET ?kind=expc&query=..&page=..&display=..
//   kind=expc   → 법령해석례 list (raw, OC stripped)
//   kind=expcd  → one 법령해석례 detail (?id=) — keys and lengths
//   kind=law    → one law version (?mst=) — top-level keys and the 제개정이유 excerpt
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const API = "https://www.law.go.kr/DRF";

async function get(params: Record<string, string>) {
  const endpoint = params.endpoint;
  const q = new URLSearchParams({ OC: process.env.LAW_API_OC || "", type: "JSON", ...params });
  q.delete("endpoint");
  const res = await fetch(`${API}/${endpoint}?${q}`, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "buildlex-ai/2.0", Referer: "https://www.law.go.kr/" } });
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { _raw: text.slice(0, 500) }; }
}

const shape = (v: unknown, depth = 0): unknown => {
  if (depth > 3) return typeof v;
  if (Array.isArray(v)) return [`len ${v.length}`, v.length ? shape(v[0], depth + 1) : null];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k, shape(x, depth + 1)]));
  return typeof v === "string" ? `str ${v.length}: ${v.slice(0, 60)}` : v;
};

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === "production") return Response.json({ error: "not found" }, { status: 404 });
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind") || "expc";
  if (kind === "expc") {
    const d = await get({ endpoint: "lawSearch.do", target: "expc", query: p.get("query") || "건축법", display: p.get("display") || "5", page: p.get("page") || "1", ...(p.get("search") ? { search: p.get("search")! } : {}) });
    return Response.json(JSON.parse(JSON.stringify(d).replace(/OC=[^&"]*/g, "OC=")));
  }
  if (kind === "expcd") return Response.json(shape(await get({ endpoint: "lawService.do", target: "expc", ID: p.get("id") || "" })));
  if (kind === "law") {
    const d = await get({ endpoint: "lawService.do", target: "law", MST: p.get("mst") || "" });
    const law = (d["법령"] || {}) as Record<string, unknown>;
    return Response.json({ keys: Object.keys(law), shape: shape(Object.fromEntries(Object.entries(law).filter(([k]) => !/조문|별표/.test(k)))) });
  }
  return Response.json({ error: "kind" }, { status: 400 });
}
