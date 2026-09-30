/**
 * Build the searchable corpus from legalize-kr Markdown snapshots.
 *
 *   LEGALIZE_DIR=../legalize-kr ORDINANCE_DIR=../ordinance-kr npm run corpus
 *
 * - national laws  -> data/index/national.json
 * - ordinances     -> data/index/ord/<region>.json (one shard per region)
 * - region list    -> data/index/regions.json
 *
 * Articles are chunked per 조, 부칙 are excluded, appendix titles are indexed
 * (their bodies are fetched live from the 법제처 API at answer time), and
 * citations such as "법 제11조", "영 제3조의2", "「주차장법」 제19조", "별표 1"
 * are resolved into a graph used for delegation expansion.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NATIONAL_LAWS, ORDINANCE_KINDS } from "../data/law-list.ts";
import type { Chunk, CorpusFile, LawMeta, Level, Region } from "../lib/types.ts";
import { lawKeyOf } from "../lib/text.ts";
import { fetchAppendix } from "../lib/law-api.ts";
export { lawKeyOf };

const LEGALIZE_DIR = process.env.LEGALIZE_DIR || "../legalize-kr";
const ORDINANCE_DIR = process.env.ORDINANCE_DIR || "../ordinance-kr";
const OUT = path.resolve("data/index");
const AS_OF = process.env.AS_OF || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/**
 * legalize-kr stores the latest *promulgated* text, which may not be in force
 * yet (시행예정). With git history available, pick the version whose 시행일자 is
 * the latest date on or before AS_OF, and remember the pending one.
 */
function inForceVersion(rel: string, head: string): { src: string; upcoming?: string } {
  const headDate = (head.match(/^시행일자:\s*'?([\d-]+)/m) || [])[1] || "";
  if (!headDate || headDate <= AS_OF) return { src: head };
  let commits: string[] = [];
  try {
    commits = execFileSync("git", ["-c", "gc.auto=0", "-C", LEGALIZE_DIR, "log", "--format=%H", "-n", "14", "--", rel], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch { return { src: head, upcoming: headDate }; }
  let best: { src: string; date: string } | null = null;
  const pending: string[] = [];
  for (const h of commits) {
    let src: string;
    try { src = execFileSync("git", ["-c", "gc.auto=0", "-C", LEGALIZE_DIR, "show", `${h}:${rel}`], { encoding: "utf8", maxBuffer: 64 << 20 }); } catch { continue; }
    const d = (src.match(/^시행일자:\s*'?([\d-]+)/m) || [])[1] || "";
    if (!d) continue;
    if (d > AS_OF) { pending.push(d); continue; }
    if (!best || d > best.date) best = { src, date: d };
  }
  if (!best) return { src: head, upcoming: headDate };
  return { src: best.src, upcoming: pending.sort()[0] };
}

type FrontMatter = { fields: Record<string, string>; attachments: Record<string, string>[] };

function parseFrontMatter(src: string): { fm: FrontMatter; body: string } {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  const fm: FrontMatter = { fields: {}, attachments: [] };
  if (!m) return { fm, body: src };
  let inAttach = false;
  let current: Record<string, string> | null = null;
  for (const line of m[1].split("\n")) {
    const top = line.match(/^([^\s:\-][^:]*):\s*(.*)$/);
    if (top) {
      inAttach = top[1] === "첨부파일";
      fm.fields[top[1]] = unquote(top[2]);
      continue;
    }
    if (!inAttach) continue;
    const item = line.match(/^\s*-\s+([^:]+):\s*(.*)$/);
    if (item) {
      current = { [item[1].trim()]: unquote(item[2]) };
      fm.attachments.push(current);
      continue;
    }
    const kv = line.match(/^\s+([^:]+):\s*(.*)$/);
    if (kv && current) current[kv[1].trim()] = unquote(kv[2]);
  }
  return { fm, body: src.slice(m[0].length) };
}

function unquote(v: string) {
  return v.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}


function cleanText(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/<img[^>]*>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(\d+)\\\./g, "$1.")
    .replace(/([가-힣])\\\./g, "$1.")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type RawArticle = { articleNo: string; key: string; heading: string; path: string; text: string };

function parseArticles(body: string): RawArticle[] {
  const out: RawArticle[] = [];
  let chapter = "";
  let section = "";
  let cur: { articleNo: string; key: string; heading: string; path: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cleanText(cur.lines);
    if (text && !/^삭제\s*[<(<]?[\d.\s]*[>)>]?$/.test(text)) out.push({ ...cur, text });
    cur = null;
  };
  for (const line of body.split("\n")) {
    if (/^##\s*부\s*칙/.test(line)) { flush(); break; }
    const art = line.match(/^#{4,6}\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:\((.*)\))?\s*$/);
    if (art) {
      flush();
      const key = art[2] ? `${Number(art[1])}의${Number(art[2])}` : String(Number(art[1]));
      cur = { articleNo: `제${art[1]}조${art[2] ? `의${art[2]}` : ""}`, key, heading: (art[3] || "").trim(), path: [chapter, section].filter(Boolean).join(" > "), lines: [] };
      continue;
    }
    const ch = line.match(/^##\s+(.*)$/);
    if (ch) { flush(); chapter = ch[1].trim(); section = ""; continue; }
    const sec = line.match(/^###\s+(.*)$/);
    if (sec) { flush(); section = sec[1].trim(); continue; }
    if (/^#\s/.test(line)) continue;
    if (cur) cur.lines.push(line);
  }
  flush();
  return out;
}

type LawFile = {
  meta: LawMeta;
  articles: RawArticle[];
  appendices: { key: string; articleNo: string; title: string; link: string }[];
  firstArticle: string;
  ordinanceKind?: string;
};

function levelOf(file: string): Level {
  if (file.startsWith("법률")) return "법률";
  if (file.startsWith("시행령") || file.startsWith("대통령령")) return "시행령";
  return "시행규칙";
}

function articleUrl(lawName: string, articleNo: string, ordinance = false) {
  const base = ordinance ? "https://www.law.go.kr/자치법규/" : "https://www.law.go.kr/법령/";
  return base + encodeURIComponent(lawName.replace(/\s+/g, "")) + (articleNo.startsWith("제") ? "/" + encodeURIComponent(articleNo) : "");
}

function readNational(): LawFile[] {
  const files: LawFile[] = [];
  for (const folder of NATIONAL_LAWS) {
    const dir = path.join(LEGALIZE_DIR, "kr", folder);
    if (!fs.existsSync(dir)) { console.warn("missing", dir); continue; }
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort()) {
      if (/\(/.test(file) && fs.readdirSync(dir).some(f => f !== file && f.startsWith(file.split("(")[0]))) continue;
      const version = inForceVersion(`kr/${folder}/${file}`, fs.readFileSync(path.join(dir, file), "utf8"));
      const { fm, body } = parseFrontMatter(version.src);
      if (fm.fields["상태"] && fm.fields["상태"] !== "시행") continue;
      const lawName = fm.fields["제목"];
      const articles = parseArticles(body);
      const appendices = fm.attachments
        .filter(a => (a["별표구분"] || "") === "별표" && !/^삭제/.test(a["제목"] || ""))
        .map(a => {
          const n = Number(a["별표번호"]);
          const b = Number(a["별표가지번호"] || 0);
          const articleNo = `별표 ${n}${b ? `의${b}` : ""}`;
          return { key: `별표${n}${b ? `의${b}` : ""}`, articleNo, title: a["제목"], link: a["PDF링크"] || a["파일링크"] || "" };
        });
      files.push({
        meta: {
          lawKey: lawKeyOf(lawName), lawName, level: levelOf(file),
          effectiveDate: fm.fields["시행일자"] || "", promulgated: fm.fields["공포일자"] || "",
          sourceUrl: fm.fields["출처"] || articleUrl(lawName, ""), mst: fm.fields["법령MST"] || "",
          articleCount: articles.length, upcoming: version.upcoming,
        },
        articles, appendices, firstArticle: articles[0]?.text || "",
      });
    }
  }
  // Delegation parents.
  const byKey = new Map(files.map(f => [f.meta.lawKey, f]));
  for (const f of files) {
    if (f.meta.level === "법률") continue;
    const folderLaw = files.find(o => o.meta.level === "법률" && f.meta.lawKey.startsWith(o.meta.lawKey) && f.meta.lawKey !== o.meta.lawKey);
    const cited = [...f.firstArticle.matchAll(/「([^」]+)」/g)].map(m => lawKeyOf(m[1])).filter(k => byKey.has(k));
    const parent = folderLaw?.meta.lawKey || cited.find(k => byKey.get(k)!.meta.level === "법률");
    f.meta.parentKey = parent;
    if (f.meta.level === "시행규칙") {
      const decree = cited.find(k => byKey.get(k)!.meta.level === "시행령")
        || (parent ? files.find(o => o.meta.level === "시행령" && o.meta.lawKey === parent + "시행령")?.meta.lawKey : undefined);
      f.meta.decreeKey = decree;
    }
  }
  for (const f of files) {
    if (f.meta.level !== "법률") continue;
    f.meta.decreeKey = files.find(o => o.meta.lawKey === f.meta.lawKey + "시행령")?.meta.lawKey;
    f.meta.ruleKey = files.find(o => o.meta.lawKey === f.meta.lawKey + "시행규칙")?.meta.lawKey;
  }
  return files;
}

function readOrdinances(nationalKeys: Set<string>): { files: LawFile[]; regions: Region[] } {
  const files: LawFile[] = [];
  const regions = new Map<string, Region>();
  if (!fs.existsSync(ORDINANCE_DIR)) return { files, regions: [] };
  for (const province of fs.readdirSync(ORDINANCE_DIR)) {
    const pdir = path.join(ORDINANCE_DIR, province);
    if (province.startsWith(".") || province.startsWith("_") || !fs.statSync(pdir).isDirectory()) continue;
    for (const city of fs.readdirSync(pdir)) {
      if (city === "_교육청") continue;
      const odir = path.join(pdir, city, "조례");
      if (!fs.existsSync(odir)) continue;
      for (const name of fs.readdirSync(odir)) {
        const kind = ORDINANCE_KINDS.find(k => k.pattern.test(name));
        const file = path.join(odir, name, "본문.md");
        if (!kind || !fs.existsSync(file)) continue;
        const { fm, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
        const lawName = fm.fields["자치법규명"] || name;
        const region = `${province}/${city}`;
        const articles = parseArticles(body);
        if (!articles.length) continue;
        const parent = kind.parent;
        files.push({
          meta: {
            lawKey: lawKeyOf(lawName), lawName, level: "조례", region,
            effectiveDate: fm.fields["시행일자"] || "", promulgated: fm.fields["공포일자"] || "",
            sourceUrl: fm.fields["출처"] || articleUrl(lawName, "", true), mst: fm.fields["자치법규일련번호"] || "",
            parentKey: nationalKeys.has(parent) ? parent : undefined,
            decreeKey: nationalKeys.has(parent + "시행령") ? parent + "시행령" : undefined,
            ruleKey: nationalKeys.has(parent + "시행규칙") ? parent + "시행규칙" : undefined,
            articleCount: articles.length,
          },
          articles, appendices: [], firstArticle: articles[0]?.text || "", ordinanceKind: kind.label,
        });
        const r = regions.get(region) || {
          key: region,
          label: city === "_본청" ? province : `${province} ${city}`,
          province, city: city === "_본청" ? "" : city,
          parents: city === "_본청" ? [] : [`${province}/_본청`],
          ordinances: [],
        };
        r.ordinances.push(lawName);
        regions.set(region, r);
      }
    }
  }
  return { files, regions: [...regions.values()].sort((a, b) => a.label.localeCompare(b.label, "ko")) };
}

function toChunks(f: LawFile): Chunk[] {
  const ord = f.meta.level === "조례";
  const chunks: Chunk[] = f.articles.map(a => ({
    id: `${f.meta.lawKey}#${a.key}`, lawKey: f.meta.lawKey, lawName: f.meta.lawName, level: f.meta.level,
    articleNo: a.articleNo, heading: a.heading, path: a.path, text: a.text, kind: "article",
    effectiveDate: f.meta.effectiveDate, sourceUrl: articleUrl(f.meta.lawName, a.articleNo, ord), refs: [],
    region: f.meta.region, mst: f.meta.mst,
  }));
  for (const ap of f.appendices) {
    chunks.push({
      id: `${f.meta.lawKey}#${ap.key}`, lawKey: f.meta.lawKey, lawName: f.meta.lawName, level: f.meta.level,
      articleNo: ap.articleNo, heading: ap.title, path: "별표", text: `[${ap.articleNo}] ${ap.title}`, kind: "appendix",
      effectiveDate: f.meta.effectiveDate, sourceUrl: f.meta.sourceUrl, refs: [], attachment: ap.link, mst: f.meta.mst,
    });
  }
  return chunks;
}

const ART = String.raw`제\s*(\d+)\s*조(?:\s*의\s*(\d+))?`;

export function resolveRefs(chunk: Chunk, meta: LawMeta, ids: Set<string>, nameToKey: Map<string, string>): string[] {
  const out = new Set<string>();
  const text = chunk.text;
  const add = (lawKey: string | undefined, n: string, b?: string) => {
    if (!lawKey) return;
    const id = `${lawKey}#${Number(n)}${b ? `의${Number(b)}` : ""}`;
    if (ids.has(id) && id !== chunk.id) out.add(id);
  };
  const addAppendix = (lawKey: string | undefined, n: string, b?: string) => {
    if (!lawKey) return;
    const id = `${lawKey}#별표${Number(n)}${b ? `의${Number(b)}` : ""}`;
    if (ids.has(id) && id !== chunk.id) out.add(id);
  };
  let lastLaw: string | undefined;
  const re = new RegExp(String.raw`「([^」]{2,60})」\s*(?:${ART})?|같은\s*법\s*(시행령|시행규칙)?\s*${ART}|(?<![가-힣])(법|영|규칙)\s*${ART}|${ART}|(?:(법|영|「[^」]+」)\s*)?별표\s*(\d+)(?:\s*의\s*(\d+))?`, "g");
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      const key = nameToKey.get(lawKeyOf(m[1]));
      lastLaw = key;
      if (m[2]) add(key, m[2], m[3]);
    } else if (m[5] !== undefined) {
      const base = lastLaw;
      const target = m[4] === "시행령" ? (base ? base + "시행령" : undefined) : m[4] === "시행규칙" ? (base ? base + "시행규칙" : undefined) : base;
      add(target, m[5], m[6]);
    } else if (m[7] !== undefined) {
      const target = m[7] === "법" ? (meta.level === "법률" ? meta.lawKey : meta.parentKey)
        : m[7] === "영" ? meta.decreeKey : meta.ruleKey;
      add(target, m[8], m[9]);
    } else if (m[10] !== undefined) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 4), m.index);
      if (/부칙\s*$/.test(before)) continue;
      add(meta.lawKey, m[10], m[11]);
    } else if (m[13] !== undefined) {
      const owner = m[12] === "법" ? (meta.level === "법률" ? meta.lawKey : meta.parentKey)
        : m[12] === "영" ? meta.decreeKey
        : m[12] ? nameToKey.get(lawKeyOf(m[12].slice(1, -1))) : meta.lawKey;
      addAppendix(owner, m[13], m[14]);
    }
  }
  return [...out];
}

async function main() {
  fs.mkdirSync(path.join(OUT, "ord"), { recursive: true });
  const national = readNational();
  const nationalKeys = new Set(national.map(f => f.meta.lawKey));
  const { files: ordinances, regions } = readOrdinances(nationalKeys);
  const nameToKey = new Map<string, string>();
  for (const f of national) nameToKey.set(f.meta.lawKey, f.meta.lawKey);

  const nationalChunks = national.flatMap(toChunks);
  const nationalIds = new Set(nationalChunks.map(c => c.id));
  const metaByKey = new Map(national.map(f => [f.meta.lawKey, f.meta]));
  for (const c of nationalChunks) c.refs = resolveRefs(c, metaByKey.get(c.lawKey)!, nationalIds, nameToKey);

  // Optional: pull 별표 본문 from the 법제처 API so appendices are searchable offline.
  if (process.env.LAW_API_OC) {
    let ok = 0;
    const apps = nationalChunks.filter(c => c.kind === "appendix");
    for (const c of apps) {
      const body = await fetchAppendix(c.mst || "", c.articleNo).catch(() => null);
      if (body) { c.text = `[${c.articleNo}] ${c.heading}\n${body}`; ok++; }
    }
    console.log(`appendix bodies: ${ok}/${apps.length}`);
  }

  const builtAt = new Date().toISOString();
  const pendingLaws = national.filter(f => f.meta.upcoming).map(f => `${f.meta.lawName}(${f.meta.upcoming})`);
  console.log(`as of ${AS_OF}: ${pendingLaws.length} laws have pending amendments`, pendingLaws.slice(0, 8).join(", "));
  const corpus: CorpusFile = { builtAt, asOf: AS_OF, source: "legalize-kr", laws: national.map(f => f.meta), chunks: nationalChunks };
  fs.writeFileSync(path.join(OUT, "national.json"), JSON.stringify(corpus));

  const byRegion = new Map<string, LawFile[]>();
  for (const f of ordinances) byRegion.set(f.meta.region!, [...(byRegion.get(f.meta.region!) || []), f]);
  for (const old of fs.readdirSync(path.join(OUT, "ord"))) fs.rmSync(path.join(OUT, "ord", old));
  let ordChunkCount = 0;
  for (const [region, fs_] of byRegion) {
    const chunks = fs_.flatMap(toChunks);
    const ids = new Set([...nationalIds, ...chunks.map(c => c.id)]);
    for (const c of chunks) {
      const meta = fs_.find(f => f.meta.lawKey === c.lawKey)!.meta;
      c.refs = resolveRefs(c, meta, ids, nameToKey);
    }
    ordChunkCount += chunks.length;
    const shard: CorpusFile = { builtAt, source: "legalize-kr/ordinance-kr", laws: fs_.map(f => f.meta), chunks };
    fs.writeFileSync(path.join(OUT, "ord", regionFile(region)), JSON.stringify(shard));
  }
  fs.writeFileSync(path.join(OUT, "regions.json"), JSON.stringify({ builtAt, regions }));
  const edges = nationalChunks.reduce((s, c) => s + c.refs.length, 0);
  console.log(`national laws=${national.length} chunks=${nationalChunks.length} edges=${edges}`);
  console.log(`ordinances=${ordinances.length} regions=${regions.length} chunks=${ordChunkCount}`);
}

export function regionFile(region: string) {
  return region.replace(/\//g, "__") + ".json";
}

if (process.argv[1] && process.argv[1].endsWith("build-corpus.ts")) main().catch(e => { console.error(e); process.exit(1); });
