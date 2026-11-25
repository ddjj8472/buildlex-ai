// Dense (semantic) retrieval. Vectors are produced offline and stored int8-quantised
// next to the corpus:
//   data/index/embeddings-national.{json,bin}   국가 법령 (한 조문이 여러 행일 수 있음)
//   data/index/ord-emb/<지역>.{json,bin}         지자체 조례 샤드
// Two embedding backends share this file format:
//   - local  (기본): open-source Korean model run in-process (lib/local-embed.ts),
//                    built by `python3 scripts/embed_local.py`. No API key, no per-query cost.
//   - gemini (선택): Gemini embedding API, built by `npm run embed`.
// The backend is chosen by the index's `model` tag, so queries are always embedded
// with the same model that embedded the documents.
import fs from "node:fs";
import path from "node:path";
import { regionFile } from "./corpus.ts";

const DATA_DIR = process.env.BUILDLEX_DATA_DIR || path.join(process.cwd(), "data", "index");
export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
export const EMBED_DIM = Number(process.env.GEMINI_EMBED_DIM || 768);

/** One row per passage; `ids[row]` is the chunk the passage belongs to (rows of one long article repeat its id). */
export type DenseIndex = { model: string; dim: number; ids: string[]; scales: Float32Array; vecs: Int8Array; pos: Map<string, number> };

function readIndex(base: string): DenseIndex | null {
  const meta = `${base}.json`;
  const bin = `${base}.bin`;
  if (!fs.existsSync(meta) || !fs.existsSync(bin)) return null;
  const m = JSON.parse(fs.readFileSync(meta, "utf8")) as { model: string; dim: number; ids: string[]; scales: number[] };
  const buf = fs.readFileSync(bin);
  return {
    model: m.model, dim: m.dim, ids: m.ids, scales: Float32Array.from(m.scales),
    vecs: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), pos: new Map(m.ids.map((id, i) => [id, i])),
  };
}

let national: DenseIndex | null | undefined;
const regional = new Map<string, DenseIndex | null>();

export function loadDense(): DenseIndex | null {
  if (national === undefined) national = readIndex(path.join(DATA_DIR, "embeddings-national"));
  return national;
}

export function loadRegionDense(region: string): DenseIndex | null {
  if (!regional.has(region)) regional.set(region, readIndex(path.join(DATA_DIR, "ord-emb", regionFile(region).replace(/\.json$/, ""))));
  return regional.get(region) ?? null;
}

export const isLocalModel = (tag: string) => !tag.startsWith("gemini");

export function quantize(v: ArrayLike<number>): { q: Int8Array; scale: number } {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  const norm = Math.sqrt(n) || 1;
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i] / norm));
  const scale = (max || 1) / 127;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / norm / scale);
  return { q, scale };
}

export async function embed(texts: string[], task: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT", signal?: AbortSignal): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: signal ?? AbortSignal.timeout(20000),
    body: JSON.stringify({
      requests: texts.map(text => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType: task,
        outputDimensionality: EMBED_DIM,
      })),
    }),
  });
  if (!res.ok) throw new Error(`embedding ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { embeddings: { values: number[] }[] };
  return data.embeddings.map(e => e.values);
}

/** Embed a search query with whichever backend built `index`. */
export async function embedQuery(index: DenseIndex, text: string, signal?: AbortSignal): Promise<Float32Array> {
  if (isLocalModel(index.model)) {
    const { embedLocal } = await import("./local-embed.ts");
    return embedLocal(`query: ${text}`);
  }
  const [v] = await embed([text], "RETRIEVAL_QUERY", signal);
  return Float32Array.from(v);
}

/** Cosine similarity of a query vector against every stored row. */
export function denseScores(index: DenseIndex, query: ArrayLike<number>): Float32Array {
  const { q } = quantize(query);
  const out = new Float32Array(index.ids.length);
  const dim = index.dim;
  for (let i = 0; i < index.ids.length; i++) {
    let dot = 0;
    const off = i * dim;
    for (let j = 0; j < dim; j++) dot += q[j] * index.vecs[off + j];
    out[i] = dot * index.scales[i];
  }
  return out;
}

/** Best-scoring chunks: a chunk's score is its best passage (rows of one article are max-pooled). */
export function denseTop(index: DenseIndex, query: ArrayLike<number>, k: number, keep?: (id: string) => boolean): { id: string; s: number }[] {
  const s = denseScores(index, query);
  const best = new Map<string, number>();
  for (let i = 0; i < s.length; i++) {
    const id = index.ids[i];
    if (keep && !keep(id)) continue;
    if (s[i] > (best.get(id) ?? -Infinity)) best.set(id, s[i]);
  }
  return [...best.entries()].map(([id, v]) => ({ id, s: v })).sort((a, b) => b.s - a.s).slice(0, k);
}
