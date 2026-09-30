// Loads the prebuilt corpus (data/index) and keeps BM25 indexes in memory.
import fs from "node:fs";
import path from "node:path";
import { BM25Index } from "./bm25.ts";
import type { Chunk, CorpusFile, LawMeta, Region } from "./types.ts";

export type Loaded = {
  corpus: CorpusFile;
  chunks: Chunk[];
  byId: Map<string, Chunk>;
  /** Passage-level index; passageOf[p] = chunk index. Long articles are split
   * into ~700-char windows so a single 호 inside a long 정의 조문 can match. */
  index: BM25Index;
  passageOf: Int32Array;
  /** Score chunks: max over their passages plus a small bonus for extra matches. */
  score: (query: string) => Float32Array;
  citedBy: Map<string, string[]>;
  laws: Map<string, LawMeta>;
};

const DATA_DIR = process.env.BUILDLEX_DATA_DIR || path.join(process.cwd(), "data", "index");

function titleOf(c: Chunk) {
  return `${c.lawName} ${c.articleNo} ${c.heading}`;
}

export function splitPassages(text: string, size = 700): string[] {
  if (text.length <= size * 1.4) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length > size) { out.push(cur); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) out.push(cur);
  return out;
}

function build(corpus: CorpusFile): Loaded {
  const chunks = corpus.chunks;
  const byId = new Map(chunks.map(c => [c.id, c]));
  const citedBy = new Map<string, string[]>();
  for (const c of chunks) for (const r of c.refs) citedBy.set(r, [...(citedBy.get(r) || []), c.id]);
  const bodies: string[] = [];
  const titles: string[] = [];
  const owner: number[] = [];
  chunks.forEach((c, i) => {
    for (const p of splitPassages(c.text)) {
      bodies.push(`${c.heading}\n${c.path}\n${p}`);
      titles.push(titleOf(c));
      owner.push(i);
    }
  });
  const index = new BM25Index(bodies, titles);
  const passageOf = Int32Array.from(owner);
  const score = (query: string) => {
    const ps = index.scores(query);
    const best = new Float32Array(chunks.length);
    const extra = new Float32Array(chunks.length);
    for (let p = 0; p < ps.length; p++) {
      const c = passageOf[p];
      if (ps[p] > best[c]) { extra[c] += best[c]; best[c] = ps[p]; } else extra[c] += ps[p];
    }
    for (let c = 0; c < best.length; c++) best[c] += Math.min(extra[c] * 0.1, best[c] * 0.3);
    return best;
  };
  return { corpus, chunks, byId, citedBy, index, passageOf, score, laws: new Map(corpus.laws.map(l => [l.lawKey, l])) };
}

let national: Loaded | null = null;
const regional = new Map<string, Loaded | null>();
let regionList: Region[] | null = null;

export function loadNational(): Loaded {
  if (!national) {
    const corpus = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "national.json"), "utf8")) as CorpusFile;
    national = build(corpus);
  }
  return national;
}

export function regionFile(region: string) {
  return region.replace(/\//g, "__") + ".json";
}

export function loadRegion(region: string): Loaded | null {
  if (!regional.has(region)) {
    const file = path.join(DATA_DIR, "ord", regionFile(region));
    regional.set(region, fs.existsSync(file) ? build(JSON.parse(fs.readFileSync(file, "utf8")) as CorpusFile) : null);
  }
  return regional.get(region) ?? null;
}

export function listRegions(): Region[] {
  if (!regionList) {
    const file = path.join(DATA_DIR, "regions.json");
    regionList = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")).regions as Region[]) : [];
  }
  return regionList;
}

/** Resolve free text such as "용인시", "경기 용인", "서울 강남구" to a region key. */
export function resolveRegion(text: string | undefined): Region | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, "");
  if (!t) return null;
  const list = listRegions();
  const exact = list.find(r => r.key === text || r.label.replace(/\s+/g, "") === t);
  if (exact) return exact;
  const cityHits = list.filter(r => r.city && (t.includes(r.city) || r.city.startsWith(t) || t.startsWith(r.city.replace(/(시|군|구)$/, ""))));
  if (cityHits.length === 1) return cityHits[0];
  if (cityHits.length > 1) {
    const withProvince = cityHits.find(r => t.includes(r.province.slice(0, 2)));
    if (withProvince) return withProvince;
    return cityHits.find(r => t.includes(r.city)) || cityHits[0];
  }
  const province = list.find(r => !r.city && (t.includes(r.province) || r.province.startsWith(t)));
  return province || null;
}

/** Regions whose ordinances apply: the 시·군·구 itself plus its 광역 본청. */
export function applicableRegions(region: Region | null): Loaded[] {
  if (!region) return [];
  return [region.key, ...region.parents].map(loadRegion).filter((x): x is Loaded => !!x);
}

export function findChunk(id: string, regionKey?: string): Chunk | undefined {
  const n = loadNational().byId.get(id);
  if (n) return n;
  if (regionKey) {
    const region = listRegions().find(r => r.key === regionKey) || null;
    for (const l of applicableRegions(region)) {
      const c = l.byId.get(id);
      if (c) return c;
    }
  }
  return undefined;
}

export function familyOf(lawKey: string, laws: Map<string, LawMeta>): string {
  const meta = laws.get(lawKey) || loadNational().laws.get(lawKey);
  return meta?.parentKey || lawKey;
}
