// 법령 구조 분석 — relations that code can read off the current statute text, handed to the model as
// computed facts instead of being left to its reading. Each one targets a failure the 법제처 해석례
// evaluation traced to structure, not to missing knowledge:
//  - 준용: "A에 관하여는 제X조를 준용한다" — the model read 제X조's own wording ("건축하거나 대수선하는
//    경우") literally and dropped A. We list, for every retrieved article, which provision applies it to
//    what by 준용, and say the wording is read as A's.
//  - 적용 제외: "…은 제44조부터 제47조까지 … 적용하지 아니한다" — ranges are expanded to the exact list, so
//    which retrieved articles are excluded and which still apply is stated, not inferred.
//  - 용어: a term in the question is linked to the provision that defines it (정의 조항의 호, "이하 'X'라
//    한다") or creates it (조문 제목이 그 용어인 조문, e.g. 제11조(건축허가)), and that text is added.
//  - 부칙: transitional provisions are typed as 경과조치 (종전 규정이 적용되는 대상) or 적용례 (개정 규정이
//    처음 적용되는 대상) with the scope phrase quoted.
// Related work: structure-aware retrieval over statute cross-reference graphs (Korean statute QA,
// arXiv 2604.06173; StatuteGraph in LabourCrew, arXiv 2609.27814) and Rules as Code (OECD OPSI 2020;
// Catala, Merigoux et al. 2021) — here limited to relations that are explicit in the text.
import { loadNational } from "./corpus.ts";
import type { Chunk, Evidence } from "./types.ts";

type Edge = { sourceId: string; para: string; subject: string; excluded: string[] };
type Exclusion = { chunkId: string; para: string; condition: string; targets: string[] };
type Term = { term: string; chunkId: string; kind: "정의" | "조문"; text: string };

type Index = {
  junyong: Map<string, Edge[]>;
  exclusions: Map<string, Exclusion[]>;
  terms: Map<string, Term[]>;
  articlesOf: Map<string, { id: string; base: number; branch: number }[]>;
};

let cache: Index | null = null;

const ART_ID = /#(\d+)(?:의(\d+))?$/;

function articleKey(id: string): { base: number; branch: number } | null {
  const m = id.match(ART_ID);
  return m ? { base: Number(m[1]), branch: m[2] ? Number(m[2]) : 0 } : null;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** Splits an article into paragraphs (①, ②, …) with their label. */
function paragraphs(text: string): { para: string; text: string }[] {
  const out: { para: string; text: string }[] = [];
  let cur = { para: "", text: "" };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t && CIRCLED.includes(t[0])) { if (cur.text) out.push(cur); cur = { para: t[0], text: t }; }
    else cur.text += (cur.text ? "\n" : "") + line;
  }
  if (cur.text) out.push(cur);
  return out;
}

/**
 * Article references in a list such as "제3조, 제11조제2항부터 제9항까지, 제14조부터 제16조까지, 제50조의2"
 * → chunk ids of the same law. References after "「" (another law) are ignored.
 */
export function parseArticleList(list: string, lawKey: string, articlesOf: Index["articlesOf"]): string[] {
  const own = list.split("「")[0];
  const arts = articlesOf.get(lawKey) || [];
  const ids = new Set<string>();
  const re = /제(\d+)조(?:의(\d+))?(?:제\d+항(?:\s*(?:부터|~|∼)\s*제\d+항\s*까지)?)?(?:\s*(?:부터|~|∼)\s*제(\d+)조(?:의(\d+))?(?:제\d+항)?\s*까지)?/g;
  for (const m of own.matchAll(re)) {
    const a = Number(m[1]), ab = m[2] ? Number(m[2]) : 0;
    if (m[3]) {
      const b = Number(m[3]), bb = m[4] ? Number(m[4]) : Infinity;
      for (const x of arts) {
        const afterStart = x.base > a || (x.base === a && x.branch >= ab);
        const beforeEnd = x.base < b || (x.base === b && (bb === Infinity ? true : x.branch <= bb));
        if (afterStart && beforeEnd) ids.add(x.id);
      }
    } else {
      const x = arts.find(y => y.base === a && y.branch === ab);
      if (x) ids.add(x.id);
    }
  }
  return [...ids];
}

const trimSubject = (s: string) => s
  .replace(/^[\s\S]*(?:다\.|다만,)\s*/, "")
  .replace(/^[①-⑳]\s*/, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(-90);

function build(): Index {
  const { chunks } = loadNational();
  const articlesOf: Index["articlesOf"] = new Map();
  for (const c of chunks) {
    const k = articleKey(c.id);
    if (!k || c.kind !== "article") continue;
    if (!articlesOf.has(c.lawKey)) articlesOf.set(c.lawKey, []);
    articlesOf.get(c.lawKey)!.push({ id: c.id, ...k });
  }
  const junyong: Index["junyong"] = new Map();
  const exclusions: Index["exclusions"] = new Map();
  const terms: Index["terms"] = new Map();
  const addTerm = (t: Term) => {
    const key = t.term.replace(/\(.*?\)/g, "").replace(/\s+/g, "");
    if (key.length < 2 || key.length > 14) return;
    if (!terms.has(key)) terms.set(key, []);
    terms.get(key)!.push({ ...t, term: key });
  };

  const JUN = /([^.。\n]{2,160}?)(?:에\s*관하여는|에\s*대하여는|에\s*관해서는|의\s*경우에는)\s*([^.。\n]*?)(?:을|를)\s*준용한다/g;
  const NOT_JUN = /(제\d+조[^.。\n]{0,120}?)(?:은|는|을|를)\s*준용하지\s*아니한다/g;
  const EXCL = /((?:제\d+조(?:의\d+)?(?:제\d+항(?:\s*부터\s*제\d+항\s*까지)?)?(?:\s*부터\s*제\d+조(?:의\d+)?\s*까지)?(?:의\s*규정)?\s*(?:,|및|와|과|또는)?\s*)+)(?:을|를)\s*적용하지\s*아니한다/g;
  const DEF_ITEM = /^\s*\d+(?:의\d+)?\.\s*[“"]([^”"]{1,20})[”"](?:이)?란\s*([^\n]+)/gm;
  const INLINE = /([^.\n]{0,120})[\[(]이하\s*[“"]([^”"]{1,14})[”"]\s*(?:이)?라\s*한다[\])]/g;

  for (const c of chunks) {
    if (c.kind !== "article" || c.region) continue;
    for (const p of paragraphs(c.text)) {
      for (const m of p.text.matchAll(JUN)) {
        const targets = parseArticleList(m[2], c.lawKey, articlesOf);
        if (!targets.length) continue;
        const excluded = [...p.text.matchAll(NOT_JUN)].flatMap(x => parseArticleList(x[1], c.lawKey, articlesOf));
        for (const t of targets) {
          if (t === c.id || excluded.includes(t)) continue;
          if (!junyong.has(t)) junyong.set(t, []);
          junyong.get(t)!.push({ sourceId: c.id, para: p.para, subject: trimSubject(m[1]), excluded });
        }
      }
      for (const m of p.text.matchAll(EXCL)) {
        const targets = parseArticleList(m[1], c.lawKey, articlesOf);
        if (targets.length < 2) continue; // a single-article exclusion is plain text; lists are where ranges get misread
        const before = p.text.slice(0, m.index).replace(/^[①-⑳]\s*/, "").replace(/\s+/g, " ");
        const sentence = before.split(/다\.\s*/).pop()!.trim();
        const condition = sentence.length > 130 ? `${sentence.slice(0, 128)}…` : sentence;
        if (!exclusions.has(c.id)) exclusions.set(c.id, []);
        exclusions.get(c.id)!.push({ chunkId: c.id, para: p.para, condition, targets });
      }
    }
    if (c.heading === "정의") for (const m of c.text.matchAll(DEF_ITEM)) addTerm({ term: m[1], chunkId: c.id, kind: "정의", text: `"${m[1]}"란 ${m[2]}`.slice(0, 260) });
    // Inline definitions inside 부칙 are amendment instructions ("…을 …으로 한다"), not definitions.
    if (!/부칙/.test(c.articleNo + c.heading)) for (const m of c.text.matchAll(INLINE)) addTerm({ term: m[2], chunkId: c.id, kind: "정의", text: `${m[1].trim()} (이하 "${m[2]}"라 한다)`.slice(-240) });
    const h = c.heading.trim();
    if (/^[가-힣]{2,8}$/.test(h) && c.level === "법률" && h !== "부칙" && !/부칙/.test(c.articleNo)) {
      const first = paragraphs(c.text)[0]?.text.replace(/\s+/g, " ").slice(0, 220) || "";
      addTerm({ term: h, chunkId: c.id, kind: "조문", text: first });
    }
  }
  return { junyong, exclusions, terms, articlesOf };
}

function index(): Index {
  return (cache ??= build());
}

export type StructureResult = {
  /** Lines for the [법령 구조 분석] block. */
  lines: string[];
  /** Chunks the relations point to that the evidence lacks (added as evidence). */
  add: { chunk: Chunk; reason: string }[];
};

const label = (c: Chunk, para = "") => `${c.lawName} ${c.articleNo}${para}${c.heading && c.heading !== "부칙" ? `(${c.heading})` : ""}`;
const short = (id: string) => {
  const c = loadNational().byId.get(id);
  return c ? c.articleNo : id.split("#")[1];
};

/** The question names this article ("제58조", "같은 법 제58조", "시행령 제32조" …). */
function mentions(query: string, c: Chunk): boolean {
  const no = c.articleNo.replace(/\s+/g, "");
  if (!/^제\d+조/.test(no)) return false;
  const re = new RegExp(`${no}(?![의\\d])`);
  return re.test(query.replace(/\s+/g, ""));
}

/** Terms that the question uses and the corpus defines; quoted and longer terms first. */
function questionTerms(query: string, lawKeys: Set<string>): Term[] {
  const { terms } = index();
  const q = query.replace(/\s+/g, "");
  const quoted = new Set([...query.matchAll(/[“"‘']([^”"’']{2,14})[”"’']/g)].map(m => m[1].replace(/\s+/g, "")));
  const GENERIC = /^(건축물|건축|대지|허가|신고|시설|용도|법률|조례|공사|도로)$/;
  const found: { t: Term; score: number }[] = [];
  for (const [key, list] of terms) {
    if (!q.includes(key) || GENERIC.test(key)) continue;
    const pick = list.find(t => lawKeys.has(loadNational().byId.get(t.chunkId)?.lawKey || "") && t.kind === "정의")
      || list.find(t => lawKeys.has(loadNational().byId.get(t.chunkId)?.lawKey || ""));
    if (!pick) continue;
    found.push({ t: pick, score: (quoted.has(key) ? 10 : 0) + key.length + (pick.kind === "정의" ? 1 : 0) });
  }
  // A term contained in a longer matched term ("허가" in "건축허가") is dropped.
  found.sort((a, b) => b.score - a.score);
  const out: Term[] = [];
  for (const f of found) if (!out.some(o => o.term.includes(f.t.term))) out.push(f.t);
  return out.slice(0, 4);
}

const TRANSITION = /(?:시행\s*전에|시행\s*당시)([^.。\n]{4,320}?)(?:에\s*대해서는|에\s*대하여는|의\s*경우에는|경우에는|에\s*관하여는)\s*[^.。\n]{0,120}?종전의\s*규정에\s*따른다/;
const APPLICATION = /(?:시행\s*(?:후|이후))\s*((?:최초로\s*)?[^.。\n]{4,200}?)\s*경우부터\s*적용한다/;

/** Structural relations among the retrieved provisions and the question's terms. */
export function analyzeStructure(evidence: Evidence[], query: string): StructureResult {
  const idx = index();
  const nat = loadNational();
  const ids = new Set(evidence.map(e => e.chunk.id));
  const lawKeys = new Set(evidence.map(e => e.chunk.lawKey));
  const lines: string[] = [];
  const add: StructureResult["add"] = [];
  const want = (c: Chunk | undefined, reason: string) => {
    if (c && !ids.has(c.id) && !add.some(a => a.chunk.id === c.id) && add.length < 4) add.push({ chunk: c, reason });
  };

  const named = (c: Chunk) => mentions(query, c);

  // 준용: retrieved article T is applied to subject S by source article P. Listed only when the question is
  // about that relation: it names the subject and either says 준용 or names T itself.
  let junCount = 0;
  for (const e of evidence) {
    if (junCount >= 3) break;
    for (const edge of idx.junyong.get(e.chunk.id) || []) {
      const src = nat.byId.get(edge.sourceId);
      if (!src || junCount >= 3) continue;
      const key = edge.subject.split(/\s/).pop()!.replace(/(의|에|을|를|은|는)$/, "");
      if (!(key.length >= 3 && query.includes(key) && /준용/.test(query))) continue;
      want(src, `${e.chunk.articleNo}를 준용하는 조문`);
      // Lower-level provisions that implement T (e.g. 시행령 "법 제48조제2항에 따라 …") are read the same way.
      const delegated = evidence.filter(d => d.chunk.id !== e.chunk.id && d.chunk.lawKey !== e.chunk.lawKey && d.chunk.lawKey.startsWith(e.chunk.lawKey) && !/부칙/.test(d.chunk.articleNo) && new RegExp(`법 ${e.chunk.articleNo}(?![의\\d])`).test(d.chunk.text)).map(d => label(d.chunk));
      lines.push(`[준용] ${label(src, edge.para)}은(는) 「${edge.subject}」에 관하여 ${label(e.chunk)}를 준용한다. 따라서 ${e.chunk.articleNo}${delegated.length ? `와 그 시행 조문(${delegated.slice(0, 2).join(", ")})` : ""}의 행위·주체·시점 문구는 「${edge.subject}」에 맞게 바꿔 읽어 적용한다.${edge.excluded.length ? ` (같은 항이 준용에서 명시적으로 뺀 조문: ${edge.excluded.map(short).join(", ")})` : ""}`);
      junCount++;
    }
  }

  // 적용 제외: expanded lists, and which retrieved articles fall inside — when the question is about exclusion.
  if (/(적용(?:이|을)?\s*(?:제외|배제)|적용하지\s*아니|적용되지\s*않|적용\s*제외)/.test(query)) {
    for (const e of evidence) {
      for (const x of idx.exclusions.get(e.chunk.id) || []) {
        if (!named(e.chunk) && !x.targets.some(t => { const c = nat.byId.get(t); return c && named(c); })) continue;
        const sameLaw = evidence.filter(d => d.chunk.lawKey === e.chunk.lawKey && d.chunk.id !== e.chunk.id && articleKey(d.chunk.id));
        const inList = [...new Set(sameLaw.filter(d => x.targets.includes(d.chunk.id)).map(d => d.chunk.articleNo))];
        const outList = [...new Set(sameLaw.filter(d => !x.targets.includes(d.chunk.id) && named(d.chunk)).map(d => d.chunk.articleNo))];
        lines.push(`[적용 제외] ${label(e.chunk, x.para)}: "${x.condition}"에는 ${x.targets.map(short).join(", ")}를 적용하지 않는다.${inList.length ? ` 근거 중 이 목록에 든 조문: ${inList.join(", ")}.` : ""}${outList.length ? ` 질문이 묻는 조문 중 이 목록에 없는 조문: ${outList.join(", ")}.` : ""}`);
      }
    }
  }

  // 용어: the provision that defines or creates each term the question uses.
  for (const t of questionTerms(query, lawKeys).slice(0, 3)) {
    const c = nat.byId.get(t.chunkId);
    if (!c) continue;
    want(c, `'${t.term}'의 ${t.kind === "정의" ? "정의" : "근거 조문"}`);
    lines.push(t.kind === "정의"
      ? `[용어] '${t.term}'의 정의 — ${label(c)}: ${t.text.replace(/\s+/g, " ")}`
      : `[용어] '${t.term}'을(를) 정한 조문 — ${label(c)}: "${t.text}"`);
  }

  // 부칙: 경과조치 / 적용례 with their scope, for the 부칙 (and 조) the question names.
  const buchikNos = [...query.matchAll(/제(\d{4,6})호/g)].map(m => m[1]);
  const buchikArts = [...query.matchAll(/부칙\s*제(\d+)조/g)].map(m => m[1]);
  for (const e of evidence) {
    if (!/부칙/.test(e.chunk.id + e.chunk.articleNo)) continue;
    if (!buchikNos.some(n => e.chunk.articleNo.includes(n))) continue;
    for (const part of e.chunk.text.split(/\n(?=제\d+조)/)) {
      const no = part.match(/^제(\d+)조/)?.[1];
      if (buchikArts.length && (!no || !buchikArts.includes(no))) continue;
      const head = part.match(/^제\d+조(?:\([^)]*\))?/)?.[0] || "";
      const tr = part.match(TRANSITION);
      if (tr) lines.push(`[부칙·경과조치] ${e.chunk.lawName} ${e.chunk.articleNo} ${head}: 종전 규정이 적용되는 대상은 "시행 전에 ${tr[1].trim()}"이다. 이 대상에 해당하지 않는 신청·행위에는 개정 규정이 적용된다.`);
      const ap = part.match(APPLICATION);
      if (ap) lines.push(`[부칙·적용례] ${e.chunk.lawName} ${e.chunk.articleNo} ${head}: 개정 규정은 "시행 후 ${ap[1].trim()} 경우"부터 적용된다.`);
    }
  }

  return { lines: [...new Set(lines)].slice(0, 10), add };
}

/** For tests and diagnostics. */
export function structureIndexStats() {
  const i = index();
  return { junyongTargets: i.junyong.size, exclusionArticles: i.exclusions.size, terms: i.terms.size };
}
export const _internals = { index, paragraphs };
