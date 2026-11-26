// 입법 취지 (legislative purpose) — the official 제·개정이유 of the amendment that made the provision the
// question turns on. 법제처 cites exactly this when it reads a provision by its purpose (e.g. 시행령 개정이유
// in 해석례 on 리모델링 완화), and the model's recurring error was reading such provisions word by word.
//
//  1. For the provisions the question names (or the top retrieved ones), find the paragraph that matches the
//     question best and its <신설 …> / <개정 …> tag: the amendment that gave it its current wording.
//  2. Map (법령, 공포일자) → 법령MST of that version (data/index/law-versions.json, built from the legalize-kr
//     commit history, which records 법령MST and 공포일자 per amendment).
//  3. Fetch that version's 제·개정이유 (law.go.kr, cached) and keep the parts that mention the article or the
//     question's terms.
// It is purpose, not an answer: it exists for every provision and predates any question about it.
import fs from "node:fs";
import path from "node:path";
import { fetchLawReasons, lawApiEnabled } from "./law-api.ts";
import type { Chunk, Evidence } from "./types.ts";

type Version = { date: string; mst: string; kind: string };
type Reason = Version & { text: string };
let versions: Record<string, Version[]> | null | undefined;
let reasons: Record<string, Reason[]> | null | undefined;
const DATA_DIR = process.env.BUILDLEX_DATA_DIR || path.join(process.cwd(), "data", "index");

const readJson = <T,>(name: string): T | null => {
  const f = path.join(DATA_DIR, name);
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) as T : null; } catch { return null; }
};
function loadVersions(): Record<string, Version[]> | null {
  if (versions === undefined) versions = readJson<Record<string, Version[]>>("law-versions.json");
  return versions ?? null;
}
/** 제·개정이유 prefetched at build time (scripts/build-precedents.ts); null without it (fetched at runtime instead). */
function loadReasons(): Record<string, Reason[]> | null {
  if (reasons === undefined) reasons = readJson<Record<string, Reason[]>>("law-reasons.json");
  return reasons ?? null;
}

const TAG = /<(신설|개정|전문개정)\s+([\d.,\s]+)>/g;
const toIso = (d: string) => { const m = d.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; };
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const tagsOf = (t: string) => [...t.matchAll(TAG)].flatMap(m => m[2].split(/,(?=\s*\d{4})/).map(d => ({ kind: m[1], date: toIso(d) }))).filter(x => x.date);
const termScore = (t: string, terms: string[]) => terms.reduce((s, w) => s + (w.length >= 2 && t.includes(w) ? w.length : 0), 0);

type Line = { l: string; para: number; item: number };
function lineMeta(text: string): Line[] {
  let para = 0, item = 0;
  return text.split("\n").filter(l => l.trim()).map(l => {
    const c = CIRCLED.indexOf(l.trim()[0]);
    if (c >= 0) { para = c + 1; item = 0; }
    const it = l.match(/^\s*(\d+)\.\s/);
    if (it) item = Number(it[1]);
    return { l, para, item };
  });
}

/** How strongly a 제·개정이유 is about this provision: it names the article (주요내용 "(제6조제1항제6호 신설)") or its terms. */
function reasonScore(text: string, articleNo: string, heading: string, terms: string[]): number {
  const flat = text.replace(/\s+/g, "");
  const num = articleNo.replace(/\s+/g, "");
  return (num && flat.includes(num) ? 8 : 0) + termScore(text, terms) + (heading && text.includes(heading) ? 4 : 0);
}

export type Pick = { chunk: Chunk; date: string; kind: string; mst: string; paragraph: string; reason?: string };

/**
 * The amendment behind each named / top provision (at most `max`). The lines the question is about are the
 * 항·호 it names (Evidence.focus), else the lines sharing most of its terms. Their tags — and their 항's lead
 * line, where a 호 has none of its own — give candidate dates; with the build-time 제·개정이유 the candidate
 * whose reason is about this provision wins, otherwise a 신설 tag, otherwise the latest. Amendments after
 * `asOf` are skipped (evaluation: a later amendment may answer the very question, e.g. after a 해석례).
 */
export function pickAmendments(evidence: Evidence[], terms: string[], max = 2, asOf?: string): Pick[] {
  const vs = loadVersions();
  if (!vs) return [];
  const rs = loadReasons();
  const cands = [
    ...evidence.filter(e => e.reason === "질문에 인용된 조문"),
    ...evidence.filter(e => e.via === "search" && e.reason !== "질문에 인용된 조문").slice(0, 4),
    ...evidence.filter(e => e.via === "expand").slice(0, 3),
  ];
  const out: (Pick & { s: number; order: number })[] = [];
  const seen = new Set<string>();
  for (const [order, e] of cands.entries()) {
    const list = vs[e.chunk.lawKey];
    if (!list || e.chunk.kind !== "article" || seen.has(e.chunk.id)) continue;
    seen.add(e.chunk.id);
    const lines = lineMeta(e.chunk.text);
    const f = e.focus;
    let target = f && (f.paras.length || f.items.length)
      ? lines.filter(m => (f.paras.length ? f.paras.includes(m.para) : true) && (f.items.length ? f.items.includes(m.item) : true))
      : [];
    if (!target.length) target = lines.map(m => ({ m, s: termScore(m.l, terms) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2).map(x => x.m);
    if (!target.length) continue;
    const leads = target.filter(t => t.item).map(t => lines.find(m => m.para === t.para && m.item === 0)).filter((m): m is Line => !!m);
    const dates = new Map<string, { kind: string; w: number }>();
    const add = (t: string, w: number) => { for (const g of tagsOf(t)) { const cur = dates.get(g.date); if (!cur || cur.w < w || (g.kind !== "개정" && cur.kind === "개정")) dates.set(g.date, { kind: g.kind, w: Math.max(w, cur?.w ?? 0) }); } };
    for (const t of target) add(t.l, 3);
    for (const t of leads) add(t.l, 1);
    const scored = [...dates].filter(([d]) => !asOf || d <= asOf).map(([date, x]) => {
      const v = list.find(y => y.date === date);
      const r = rs?.[e.chunk.lawKey]?.find(y => y.date === date);
      return { date, kind: x.kind, v, r, s: (r ? reasonScore(r.text, e.chunk.articleNo, e.chunk.heading, terms) : 0) * 10 + x.w + (x.kind !== "개정" ? 2 : 0) };
    }).filter(x => x.v);
    if (!scored.length) continue;
    scored.sort((a, b) => b.s - a.s || b.date.localeCompare(a.date));
    const best = scored[0];
    out.push({ chunk: e.chunk, date: best.date, kind: best.kind, mst: best.v!.mst, paragraph: target.map(t => t.l.trim()).join(" ").slice(0, 200), reason: best.r?.text, s: best.r ? best.s : 0, order });
  }
  // With the reasons at hand, the provisions whose amendment is most clearly about the question win
  // (a 시행령 호 reached by delegation can matter more than the 법 조문 the asker cited); otherwise cited first.
  return out.sort((a, b) => (b.s >= 30 ? b.s : 0) - (a.s >= 30 ? a.s : 0) || a.order - b.order).slice(0, max).map(({ s: _s, order: _o, ...p }) => p);
}

/** The parts of a 제·개정이유 that concern the article or the question's terms. */
export function excerptReasons(paras: string[], articleNo: string, terms: string[], max = 700): string {
  const num = articleNo.replace(/\s+/g, "");
  const hits = paras.filter(p => p.replace(/\s+/g, "").includes(num) || terms.some(t => t.length >= 2 && p.includes(t)));
  const head = paras.find(p => /개정이유|제정이유/.test(p)) ? paras.slice(0, 2) : paras.slice(0, 1);
  const text = [...new Set([...head, ...hits])].join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** [입법 취지] lines for the prompt (empty without the API key or a matching version). */
export async function legislativePurpose(evidence: Evidence[], terms: string[], asOf?: string): Promise<string[]> {
  if (!lawApiEnabled() && !loadReasons()) return [];
  const picks = pickAmendments(evidence, terms, 2, asOf);
  const lines = await Promise.all(picks.map(async p => {
    const paras = p.reason ? p.reason.split("\n") : lawApiEnabled() ? await fetchLawReasons(p.mst).catch(() => [] as string[]) : [];
    const text = excerptReasons(paras, p.chunk.articleNo, terms);
    // A reason that is only its heading ("[일부개정] ◇ 개정이유") says nothing about the provision.
    const substance = text.replace(/\[[^\]]*\]|◇|개정이유|제정이유|주요내용|\s/g, "");
    return substance.length >= 40 ? `[입법 취지] ${p.chunk.lawName} ${p.chunk.articleNo}${p.chunk.heading ? `(${p.chunk.heading})` : ""}의 해당 부분은 ${p.date.replace(/-/g, ".")} ${p.kind}됨 — 그 개정의 제·개정이유: "${text}"` : "";
  }));
  return lines.filter(Boolean);
}
