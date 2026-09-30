// Hybrid retrieval: BM25 (several query variants) + optional dense vectors,
// fused with weighted Reciprocal Rank Fusion, optionally reranked, then
// expanded along the delegation graph (법률 ↔ 시행령 ↔ 시행규칙 ↔ 별표 ↔ 조례).
import { topK } from "./bm25.ts";
import { applicableRegions, familyOf, loadNational, type Loaded } from "./corpus.ts";
import { denseScores, embed, loadDense } from "./dense.ts";
import { lawKeyOf } from "./text.ts";
import type { Chunk, Evidence, QueryAnalysis, Region } from "./types.ts";

export type Reranker = (query: string, candidates: Chunk[]) => Promise<Map<string, number> | null>;

export type SearchOptions = {
  region?: Region | null;
  dense?: boolean;
  rerank?: Reranker;
  limit?: number;
  maxExpansions?: number;
};

export type SearchDebug = {
  lists: { name: string; top: string[] }[];
  dense: "used" | "unavailable" | "failed" | "off";
  reranked: boolean;
  ms: number;
};

const RRF_K = 60;

type Ranked = { name: string; weight: number; ids: string[] };

function rrf(lists: Ranked[]): Map<string, number> {
  const fused = new Map<string, number>();
  for (const l of lists) l.ids.forEach((id, r) => fused.set(id, (fused.get(id) || 0) + l.weight / (RRF_K + r + 1)));
  return fused;
}

export function queryVariants(a: QueryAnalysis): { name: string; text: string; weight: number }[] {
  const v = [
    { name: "원문", text: a.standalone, weight: 1 },
    { name: "법률용어 확장", text: `${a.standalone} ${a.legalTerms.join(" ")}`, weight: 1.2 },
  ];
  a.subQueries.slice(0, 3).forEach((q, i) => v.push({ name: `하위질의${i + 1}`, text: q, weight: 0.7 }));
  if (a.legalTerms.length) v.push({ name: "전문용어", text: a.legalTerms.join(" "), weight: 0.8 });
  return v;
}

// Core statutes of building administration get a mild prior; hinted laws a stronger one.
const CORE = new Set(["건축법", "국토의계획및이용에관한법률"]);
const DEFINITION_Q = /(란|이란|라는\s*게|뜻|정의|의미|말하나요|무엇인가요|뭔가요|어떤\s*(건물|건축물|것)을\s*말)/;

function lawBoost(loaded: Loaded, a: QueryAnalysis): (c: Chunk) => number {
  const keys = a.laws.map(lawKeyOf).filter(Boolean);
  const wantsDefinition = DEFINITION_Q.test(a.standalone);
  return (c: Chunk) => {
    const fam = familyOf(c.lawKey, loaded.laws);
    let m = CORE.has(fam) || CORE.has(c.lawKey) ? 1.15 : 1;
    if (keys.some(k => c.lawKey === k || fam === k || c.lawKey.startsWith(k) || k.startsWith(c.lawKey))) m *= 1.3;
    if (wantsDefinition && /정의|용어/.test(c.heading)) m *= 1.4;
    return m;
  };
}

function bm25Lists(loaded: Loaded, a: QueryAnalysis, depth: number): { lists: Ranked[]; best: Float32Array } {
  const boost = lawBoost(loaded, a);
  const lists: Ranked[] = [];
  let best: Float32Array = new Float32Array(loaded.chunks.length);
  for (const v of queryVariants(a)) {
    const s = loaded.score(v.text);
    for (let i = 0; i < s.length; i++) {
      s[i] *= boost(loaded.chunks[i]);
      // Deleted/very short provisions carry little evidential value.
      if (loaded.chunks[i].text.length < 25) s[i] *= 0.3;
    }
    if (v.name === "법률용어 확장") best = s;
    lists.push({ name: `BM25·${v.name}`, weight: v.weight, ids: topK(s, depth).map(x => loaded.chunks[x.i].id) });
  }
  return { lists, best };
}

async function denseList(a: QueryAnalysis, depth: number): Promise<{ list: Ranked | null; status: SearchDebug["dense"] }> {
  const index = loadDense();
  if (!index) return { list: null, status: "unavailable" };
  try {
    const [vec] = await embed([`${a.standalone}\n${a.legalTerms.join(", ")}`], "RETRIEVAL_QUERY", AbortSignal.timeout(6000));
    const s = denseScores(index, vec);
    return { list: { name: "Dense", weight: 1.1, ids: topK(s, depth).map(x => index.ids[x.i]) }, status: "used" };
  } catch {
    return { list: null, status: "failed" };
  }
}

export async function hybridSearch(a: QueryAnalysis, opts: SearchOptions = {}): Promise<{ evidence: Evidence[]; debug: SearchDebug }> {
  const t0 = Date.now();
  const national = loadNational();
  const limit = opts.limit ?? 9;
  const { lists, best } = bm25Lists(national, a, 80);
  let denseStatus: SearchDebug["dense"] = "off";
  if (opts.dense !== false) {
    const d = await denseList(a, 80);
    denseStatus = d.status;
    if (d.list) lists.push(d.list);
  }
  const fused = rrf(lists);
  let ranked = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([id, s]) => ({ id, s }));

  let reranked = false;
  if (opts.rerank) {
    const pool = ranked.slice(0, 30).map(r => national.byId.get(r.id)!).filter(Boolean);
    const scores = await opts.rerank(a.standalone, pool).catch(() => null);
    if (scores && scores.size) {
      reranked = true;
      // Blend: LLM relevance (0-3) dominates, fused rank breaks ties.
      ranked = ranked.slice(0, 30)
        .map((r, i) => ({ id: r.id, s: (scores.get(r.id) ?? 0) * 10 + (30 - i) / 30 }))
        .filter(r => (scores.get(r.id) ?? 0) > 0 || r.s > 0.9)
        .sort((x, y) => y.s - x.s)
        .concat(ranked.slice(30));
    }
  }

  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const push = (chunk: Chunk, score: number, via: Evidence["via"], reason?: string) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    evidence.push({ n: 0, chunk, score, via, reason });
    return true;
  };
  for (const r of ranked) {
    if (evidence.length >= limit) break;
    const c = national.byId.get(r.id);
    if (c) push(c, r.s, "search");
  }

  // Delegation expansion: add the lower/upper-level provisions and 별표 that
  // the top hits point to (or that point to them), ranked by lexical fit.
  const maxExp = opts.maxExpansions ?? 6;
  const idxOf = new Map(national.chunks.map((c, i) => [c.id, i]));
  const expansions: { chunk: Chunk; score: number; from: Chunk }[] = [];
  for (const e of evidence.slice(0, 6)) {
    const neighbours = [...e.chunk.refs, ...(national.citedBy.get(e.chunk.id) || [])];
    const cands = neighbours
      .map(id => national.byId.get(id))
      .filter((c): c is Chunk => !!c && !seen.has(c.id))
      .filter(c => c.kind === "appendix" || c.level !== e.chunk.level || familyOf(c.lawKey, national.laws) !== familyOf(e.chunk.lawKey, national.laws) || c.lawKey === e.chunk.lawKey)
      .map(c => ({ chunk: c, score: best[idxOf.get(c.id) ?? -1] ?? 0, from: e.chunk }))
      .filter(x => x.score > 0 || (x.chunk.kind === "appendix" && e.chunk.refs.includes(x.chunk.id)))
      .sort((x, y) => y.score - x.score)
      .slice(0, 2);
    expansions.push(...cands);
  }
  expansions.sort((x, y) => y.score - x.score);
  for (const x of expansions) {
    if (evidence.filter(e => e.via !== "search").length >= maxExp) break;
    push(x.chunk, x.score, x.chunk.kind === "appendix" ? "appendix" : "expand", `${x.from.lawName} ${x.from.articleNo}와 연결`);
  }

  // Regional ordinances (own 시·군·구 + 광역).
  const regional = applicableRegions(opts.region ?? null);
  if (regional.length) {
    const families = new Set(evidence.map(e => familyOf(e.chunk.lawKey, national.laws)));
    const expanded = queryVariants(a).find(v => v.name === "법률용어 확장")!.text;
    const ordHits: { chunk: Chunk; s: number }[] = [];
    for (const l of regional) {
      const s = l.score(expanded);
      for (const h of topK(s, 8)) {
        const chunk = l.chunks[h.i];
        const parent = l.laws.get(chunk.lawKey)?.parentKey || "";
        // Prefer ordinances delegated by a law that is already in the evidence.
        ordHits.push({ chunk, s: h.s * (families.has(parent) ? 1.3 : 1) });
      }
    }
    const max = Math.max(0, ...ordHits.map(h => h.s));
    ordHits
      .filter(h => h.s >= max * 0.45 && h.chunk.text.length >= 25)
      .sort((x, y) => y.s - x.s)
      .slice(0, 4)
      .forEach(h => push(h.chunk, h.s, "ordinance"));
  }

  evidence.forEach((e, i) => (e.n = i + 1));
  return {
    evidence,
    debug: { lists: lists.map(l => ({ name: l.name, top: l.ids.slice(0, 5) })), dense: denseStatus, reranked, ms: Date.now() - t0 },
  };
}
