// Builds the 법령해석례 vector index (data/index/expc.{json,bin}) from the 법제처 Open API.
//
// Runs as `prebuild` on Vercel, where LAW_API_OC is set; skipped (exit 0) without it, so local builds and
// CI without the key are unaffected and the app falls back to live API search (lib/precedent.ts).
//
// Scope: 해석례 whose 안건명 names a core building law (건축법·국토계획법·주차장법·건축물관리법·녹색건축법·
// 피난방화/설비/구조 규칙·도시군계획시설 규칙·건축사법 …). Each case is embedded as two passages, in the
// spirit of CBR-RAG (Wiratunga et al., ICCBR 2024 — match each part of a case separately):
//   q: 안건명 + 질의요지   (what was asked — matched against the user's question)
//   r: 안건명 + 회답 + 이유 (how it was decided — the principle used)
// Vectors use the same model and int8 format as the statute index (lib/dense.ts), so one query vector serves both.
// The result is cached in .next/cache (kept between Vercel builds) and reused for 14 days.
import fs from "node:fs";
import path from "node:path";
import { fetchLawReasons, interpretationDetail, lawApiEnabled, listInterpretationsPage } from "../lib/law-api.ts";
import { embedLocal, localModelAvailable } from "../lib/local-embed.ts";
import { quantize } from "../lib/dense.ts";

const OUT_DIR = path.join(process.cwd(), "data", "index");
const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "buildlex-expc");
const VERSION = 1;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const DEADLINE = Date.now() + Number(process.env.BUILDLEX_EXPC_BUDGET_MS || 25 * 60 * 1000);

export const QUERIES = [
  "건축법", "국토의 계획 및 이용에 관한 법률", "주차장법", "건축물관리법", "녹색건축물 조성 지원법",
  "건축물의 피난", "건축물의 설비기준", "건축물의 구조기준", "도시ㆍ군계획시설의 결정", "도시계획시설의 결정", "건축사법",
];

type Case = { id: string; no: string; title: string; date: string; asker: string; q: string; a: string; r: string };

const log = (...a: unknown[]) => console.log("[expc]", ...a);

async function retry<T>(fn: () => Promise<T>, n = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { last = e; await new Promise(r => setTimeout(r, 800 * (i + 1))); } }
  throw last;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>, deadline = DEADLINE): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (k < items.length && Date.now() < deadline) { const i = k++; out[i] = await fn(items[i]); } }));
  return out;
}

function copyCached(): boolean {
  const meta = path.join(CACHE_DIR, "expc.json");
  if (!fs.existsSync(meta)) return false;
  try {
    const m = JSON.parse(fs.readFileSync(meta, "utf8")) as { version: number; builtAt: string };
    if (m.version !== VERSION || Date.now() - Date.parse(m.builtAt) > MAX_AGE_MS) return false;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const f of ["expc.json", "expc.bin"]) fs.copyFileSync(path.join(CACHE_DIR, f), path.join(OUT_DIR, f));
    log(`cache hit (${m.builtAt})`);
    return true;
  } catch { return false; }
}

async function main() {
  if (!lawApiEnabled()) { log("LAW_API_OC not set — skipped"); return; }
  if (!localModelAvailable()) { log("local embedding model missing — skipped"); return; }
  if (process.env.BUILDLEX_EXPC_FORCE !== "1" && copyCached()) return;

  // 1. Lists (all pages) for each core law.
  const seen = new Map<string, Omit<Case, "q" | "a" | "r">>();
  for (const q of QUERIES) {
    let page = 1, total = Infinity;
    while ((page - 1) * 100 < total && Date.now() < DEADLINE) {
      const res = await retry(() => listInterpretationsPage(q, page)).catch(e => { log(`list ${q} p${page} failed: ${e}`); return null; });
      if (!res) break;
      total = res.total;
      for (const it of res.items) if (!seen.has(it.id)) seen.set(it.id, { id: it.id, no: it.no, title: it.title, date: it.date, asker: it.asker });
      if (!res.items.length) break;
      page++;
    }
    log(`list "${q}": total ${total === Infinity ? "?" : total}, unique so far ${seen.size}`);
  }

  // 2. Details.
  const heads = [...seen.values()];
  let done = 0;
  const cases = (await pool(heads, 6, async h => {
    const d = await retry(() => interpretationDetail(h.id, 15000)).catch(() => null);
    if (++done % 100 === 0) log(`details ${done}/${heads.length}`);
    return d && (d.question || d.answer) ? { ...h, q: d.question.slice(0, 1500), a: d.answer.slice(0, 1500), r: d.reason.slice(0, 4000) } : null;
  })).filter((c): c is Case => !!c);
  log(`details ok: ${cases.length}/${heads.length}`);

  // 3. Embeddings: q-passage and r-passage per case.
  const rows: number[] = [], parts: string[] = [], scales: number[] = [], vecs: Int8Array[] = [];
  let dim = 0;
  for (let i = 0; i < cases.length && Date.now() < DEADLINE; i++) {
    const c = cases[i];
    for (const [part, text] of [["q", `${c.title}\n${c.q}`], ["r", `${c.title}\n${c.a}\n${c.r.slice(0, 1200)}`]] as const) {
      const v = await embedLocal(`passage: ${text}`);
      dim = v.length;
      const { q, scale } = quantize(v);
      rows.push(i); parts.push(part); scales.push(scale); vecs.push(q);
    }
    if ((i + 1) % 200 === 0) log(`embedded ${i + 1}/${cases.length}`);
  }
  const bin = new Int8Array(vecs.length * dim);
  vecs.forEach((v, k) => bin.set(v, k * dim));
  const meta = { version: VERSION, builtAt: new Date().toISOString(), model: "koen-e5-tiny:model_qint8.onnx", dim, scope: QUERIES, cases, rows, parts, scales };
  for (const dir of [OUT_DIR, CACHE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "expc.json"), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, "expc.bin"), Buffer.from(bin.buffer));
  }
  log(`wrote ${cases.length} cases, ${vecs.length} vectors`);
}

// ── 제·개정이유 of core-law versions (data/index/law-reasons.json), for lib/legislative.ts ──
const REASON_LAWS = ["건축법", "건축법시행령", "건축법시행규칙", "국토의계획및이용에관한법률", "국토의계획및이용에관한법률시행령", "주차장법", "주차장법시행령", "건축물관리법", "건축물관리법시행령", "건축물의피난방화구조등의기준에관한규칙", "건축물의설비기준등에관한규칙", "녹색건축물조성지원법"];

async function buildReasons() {
  if (!lawApiEnabled()) return;
  const cache = path.join(CACHE_DIR, "law-reasons.json");
  if (process.env.BUILDLEX_EXPC_FORCE !== "1" && fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 30 * 24 * 3600 * 1000) {
    fs.copyFileSync(cache, path.join(OUT_DIR, "law-reasons.json"));
    log("law-reasons cache hit");
    return;
  }
  const versions = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "law-versions.json"), "utf8")) as Record<string, { date: string; mst: string; kind: string }[]>;
  // 타법개정 reasons describe the other law, so only this law's own amendments are fetched.
  const jobs = REASON_LAWS.flatMap(k => (versions[k] || []).filter(v => /일부개정|전부개정|제정/.test(v.kind) && v.date >= "2000-01-01").map(v => ({ k, ...v })));
  let n = 0;
  const got = await pool(jobs, 4, async j => {
    const paras = await retry(() => fetchLawReasons(j.mst, 30000), 2).catch(() => [] as string[]);
    if (++n % 50 === 0) log(`reasons ${n}/${jobs.length}`);
    return { ...j, text: paras.join("\n").slice(0, 12000) };
  }, Date.now() + Number(process.env.BUILDLEX_REASONS_BUDGET_MS || 8 * 60 * 1000));
  const out: Record<string, { date: string; mst: string; kind: string; text: string }[]> = {};
  for (const g of got) if (g && g.text) (out[g.k] ??= []).push({ date: g.date, mst: g.mst, kind: g.kind, text: g.text });
  const json = JSON.stringify(out);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "law-reasons.json"), json);
  fs.writeFileSync(cache, json);
  log(`law-reasons: ${Object.values(out).reduce((s, x) => s + x.length, 0)}/${jobs.length} versions`);
}

main()
  .catch(e => { console.error("[expc] failed (build continues without the index):", e); })
  .then(() => buildReasons())
  .catch(e => { console.error("[expc] law-reasons failed (build continues without them):", e); })
  // Never fail or hang the build: onnxruntime / keep-alive sockets must not hold the process open.
  .finally(() => process.exit(0));
