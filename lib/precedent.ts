// 해석례 검색 (precedent retrieval) — similar 법제처 법령해석례 found by meaning, not by one keyword.
//
// The earlier search sent the first legal term to the 법령해석례 API and kept titles sharing words with the
// question; for most hard questions it returned unrelated items. Here:
//  1. several list searches: the question's legal terms plus the relation types the structure analysis
//     found (준용, 경과조치, 적용례, 적용 제외) — the precedents that state how to read such provisions;
//  2. candidates are ranked by the same local embedding model as the statute index (question vs. title),
//     then by question vs. title + 질의요지 after the top ones are fetched;
//  3. the 이유 (reasoning) is kept, because the principle a precedent applies is stated there.
// Evaluation: `holdout` drops the test case itself and `asOf` drops every precedent dated on or after the
// test case, so only what existed before the question can be used (no look-ahead).
import { interpretationDetail, lawApiEnabled, listInterpretations, type InterpretationItem } from "./law-api.ts";
import { embedLocal, localModelAvailable } from "./local-embed.ts";
import type { Interpretation, QueryAnalysis } from "./types.ts";

const normTitle = (t: string) => t.replace(/^[^-]{1,40}\s-\s/, "").replace(/[^가-힣A-Za-z0-9]/g, "").slice(0, 40);
export const isHeldOut = (title: string, holdout: string[] = []) => {
  const t = normTitle(title);
  return t.length >= 8 && holdout.some(h => { const n = normTitle(h); return n.length >= 8 && (t.startsWith(n.slice(0, 30)) || n.startsWith(t.slice(0, 30))); });
};

/** "2018. 12. 3." / "20181203" / "2018-12-03" → 20181203 (0 if unknown). */
export const dateKey = (d: string) => {
  const m = d.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
};

const GENERIC = /^(건축물|건축|건축주|허가|신고|법률|시행령|규정|경우|해당|여부|기준)$/;

/** List queries: principle words from the structure analysis first, then the question's legal terms. */
export function precedentQueries(a: QueryAnalysis, structureLines: string[] = []): string[] {
  const s = structureLines.join("\n");
  const principle = [
    /\[준용\]/.test(s) ? "준용" : "",
    /\[부칙·경과조치\]/.test(s) ? "경과조치" : "",
    /\[부칙·적용례\]/.test(s) ? "적용례" : "",
    /\[적용 제외\]/.test(s) ? "적용 제외" : "",
  ].filter(Boolean);
  const terms = a.legalTerms.map(t => t.trim()).filter(t => t.length >= 2 && !GENERIC.test(t)).slice(0, 4);
  return [...new Set([...principle, ...terms])].slice(0, 5);
}

const dot = (x: Float32Array, y: Float32Array) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };

export async function findPrecedents(p: { query: string; analysis: QueryAnalysis; structureLines?: string[]; holdout?: string[]; asOf?: string; limit?: number }): Promise<Interpretation[]> {
  if (!lawApiEnabled()) return [];
  const limit = p.limit ?? 3;
  const cutoff = p.asOf ? dateKey(p.asOf) : 0;
  const lists = await Promise.allSettled(precedentQueries(p.analysis, p.structureLines).map(q => listInterpretations(q, 20)));
  const seen = new Map<string, InterpretationItem>();
  for (const r of lists) if (r.status === "fulfilled") for (const it of r.value) {
    if (isHeldOut(it.title, p.holdout)) continue;
    if (cutoff && (dateKey(it.date) === 0 || dateKey(it.date) >= cutoff)) continue;
    seen.set(it.id, it);
  }
  let cands = [...seen.values()];
  if (!cands.length) return [];
  const qtext = `query: ${p.analysis.standalone || p.query}`.slice(0, 600);
  const useDense = localModelAvailable();
  const qv = useDense ? await embedLocal(qtext).catch(() => null) : null;
  // Stage 1: question vs. title.
  if (qv) {
    const scored = await Promise.all(cands.map(async c => ({ c, s: dot(qv, await embedLocal(`passage: ${c.title}`)) })));
    cands = scored.sort((x, y) => y.s - x.s).map(x => x.c);
  }
  // Stage 2: fetch the top ones, rank by title + 질의요지.
  const top = cands.slice(0, Math.max(limit * 2, 6));
  const details = await Promise.all(top.map(async c => ({ c, d: await interpretationDetail(c.id).catch(() => null) })));
  const withText = details.filter(x => x.d && (x.d.question || x.d.answer));
  let ranked = withText;
  if (qv) {
    const scored = await Promise.all(withText.map(async x => ({ x, s: dot(qv, await embedLocal(`passage: ${x.c.title}\n${x.d!.question.slice(0, 400)}`)) })));
    ranked = scored.sort((a, b) => b.s - a.s).map(v => v.x);
  }
  return ranked.slice(0, limit).map(({ c, d }) => ({
    title: c.title, agency: c.agency, date: c.date, url: c.url,
    question: d!.question.slice(0, 1200), answer: d!.answer.slice(0, 1500), reason: d!.reason.slice(0, 2000),
  }));
}
