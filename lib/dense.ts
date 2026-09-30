// Optional dense retrieval. Vectors are produced offline by `npm run embed`
// (Gemini embedding API) and stored int8-quantised next to the corpus.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.BUILDLEX_DATA_DIR || path.join(process.cwd(), "data", "index");
export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
export const EMBED_DIM = Number(process.env.GEMINI_EMBED_DIM || 768);

export type DenseIndex = { model: string; dim: number; ids: string[]; scales: Float32Array; vecs: Int8Array; pos: Map<string, number> };

let cache: DenseIndex | null | undefined;

export function loadDense(): DenseIndex | null {
  if (cache !== undefined) return cache;
  const meta = path.join(DATA_DIR, "embeddings-national.json");
  const bin = path.join(DATA_DIR, "embeddings-national.bin");
  if (!fs.existsSync(meta) || !fs.existsSync(bin)) return (cache = null);
  const m = JSON.parse(fs.readFileSync(meta, "utf8")) as { model: string; dim: number; ids: string[]; scales: number[] };
  const buf = fs.readFileSync(bin);
  cache = {
    model: m.model, dim: m.dim, ids: m.ids, scales: Float32Array.from(m.scales),
    vecs: new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), pos: new Map(m.ids.map((id, i) => [id, i])),
  };
  return cache;
}

export function quantize(v: number[]): { q: Int8Array; scale: number } {
  const norm = Math.hypot(...v) || 1;
  const unit = v.map(x => x / norm);
  const max = Math.max(...unit.map(Math.abs)) || 1;
  const scale = max / 127;
  return { q: Int8Array.from(unit.map(x => Math.round(x / scale))), scale };
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

/** Cosine similarity of a query vector against every stored vector. */
export function denseScores(index: DenseIndex, query: number[]): Float32Array {
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
