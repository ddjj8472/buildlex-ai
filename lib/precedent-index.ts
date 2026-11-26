// 법령해석례 vector index search (built by scripts/build-precedents.ts).
//
// Hybrid retrieval like the statute search (lib/search.ts): BM25 over 안건명+질의요지+회답 and dense
// similarity over the two passages of each case, fused with RRF. The dense score of a case weighs the
// question passage above the reasoning passage (CBR-RAG: match what was asked first, then how it was
// decided).
//
// Blocking the same 민원 (evaluation only — production requests pass no holdout):
//  - the held-out case itself, by 안건번호 or title;
//  - near-duplicates: a case whose question passage is almost the same as the query (cosine ≥ DUP_SIM),
//    which catches 재질의 and the same issue sent by another agency under another title;
//  - anything dated on or after `asOf` (no look-ahead past the test case).
import fs from "node:fs";
import path from "node:path";
import { BM25Index } from "./bm25.ts";
import type { Interpretation } from "./types.ts";

type Case = { id: string; no: string; title: string; date: string; asker: string; q: string; a: string; r: string };
type Index = { cases: Case[]; rows: Int32Array; isQ: Uint8Array; scales: Float32Array; vecs: Int8Array; dim: number; bm25: BM25Index; builtAt: string };

const DATA_DIR = process.env.BUILDLEX_DATA_DIR || path.join(process.cwd(), "data", "index");
/** Question-passage cosine at or above which a case counts as the same 민원 (blocked when holding out). */
export const DUP_SIM = Number(process.env.BUILDLEX_EXPC_DUP_SIM || 0.93);

let cached: Index | null | undefined;

export function loadPrecedentIndex(): Index | null {
  if (cached !== undefined) return cached;
  const meta = path.join(DATA_DIR, "expc.json"), bin = path.join(DATA_DIR, "expc.bin");
  if (!fs.existsSync(meta) || !fs.existsSync(bin)) return (cached = null);
  const m = JSON.parse(fs.readFileSync(meta, "utf8")) as { cases: Case[]; rows: number[]; parts: string[]; scales: number[]; dim: number; builtAt: string };
  const buf = fs.readFileSync(bin);
  cached = {
    cases: m.cases, rows: Int32Array.from(m.rows), isQ: Uint8Array.from(m.parts.map(p => (p === "q" ? 1 : 0))),
    scales: Float32Array.from(m.scales), vecs: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), dim: m.dim, builtAt: m.builtAt,
    bm25: new BM25Index(m.cases.map(c => `${c.q}\n${c.a}`), m.cases.map(c => c.title)),
  };
  return cached;
}

export const precedentIndexInfo = () => { const x = loadPrecedentIndex(); return x ? { cases: x.cases.length, vectors: x.rows.length, builtAt: x.builtAt } : null; };

export const dateKey = (d: string) => {
  const m = d.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
};
const normTitle = (t: string) => t.replace(/^[^-]{1,40}\s?-\s?/, "").replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 40);
const sameTitle = (a: string, b: string) => { const x = normTitle(a), y = normTitle(b); return x.length >= 8 && y.length >= 8 && (x.startsWith(y.slice(0, 30)) || y.startsWith(x.slice(0, 30))); };

export type PrecedentHit = Interpretation & { score: number; qSim: number; no: string };

export function searchPrecedentIndex(p: { queryVec: Float32Array | null; queryText: string; limit?: number; holdout?: string[]; holdoutNos?: string[]; asOf?: string }): PrecedentHit[] {
  const x = loadPrecedentIndex();
  if (!x) return [];
  const n = x.cases.length;
  const qSim = new Float32Array(n), rSim = new Float32Array(n);
  if (p.queryVec && p.queryVec.length === x.dim) {
    for (let row = 0; row < x.rows.length; row++) {
      let s = 0;
      const off = row * x.dim;
      for (let j = 0; j < x.dim; j++) s += x.vecs[off + j] * p.queryVec[j];
      s *= x.scales[row];
      const c = x.rows[row];
      if (x.isQ[row]) { if (s > qSim[c]) qSim[c] = s; } else if (s > rSim[c]) rSim[c] = s;
    }
  }
  const holding = !!(p.holdout?.length || p.holdoutNos?.length || p.asOf);
  const cutoff = p.asOf ? dateKey(p.asOf) : 0;
  const blocked = (i: number) => {
    const c = x.cases[i];
    if (p.holdoutNos?.includes(c.no)) return true;
    if (p.holdout?.some(h => sameTitle(h, c.title))) return true;
    if (cutoff && (dateKey(c.date) === 0 || dateKey(c.date) >= cutoff)) return true;
    if (holding && qSim[i] >= DUP_SIM) return true;
    return false;
  };
  const dense = Array.from({ length: n }, (_, i) => ({ i, s: 0.65 * qSim[i] + 0.35 * rSim[i] })).filter(v => v.s > 0 && !blocked(v.i)).sort((a, b) => b.s - a.s).slice(0, 60);
  const bm = x.bm25.scores(p.queryText);
  const lex = Array.from(bm, (s, i) => ({ i, s })).filter(v => v.s > 0 && !blocked(v.i)).sort((a, b) => b.s - a.s).slice(0, 60);
  // RRF (k = 60); dense counts double, as in the statute search where it is the stronger signal.
  const fused = new Map<number, number>();
  dense.forEach((v, r) => fused.set(v.i, (fused.get(v.i) || 0) + 2 / (60 + r + 1)));
  lex.forEach((v, r) => fused.set(v.i, (fused.get(v.i) || 0) + 1 / (60 + r + 1)));
  return [...fused].sort((a, b) => b[1] - a[1]).slice(0, p.limit ?? 3).map(([i, score]) => {
    const c = x.cases[i];
    return {
      title: c.title, agency: "법제처", date: c.date, no: c.no, score, qSim: qSim[i],
      question: c.q, answer: c.a, reason: c.r,
      url: `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=${c.id}`,
    };
  });
}
