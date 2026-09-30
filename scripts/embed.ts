/**
 * Build the dense (semantic) index for national provisions with the Gemini
 * embedding API.   GEMINI_API_KEY=... npm run embed
 *
 * Vectors are cached per chunk content hash in data/index/embed-cache.jsonl,
 * so re-running after a corpus rebuild only embeds changed provisions.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EMBED_DIM, EMBED_MODEL, embed, quantize } from "../lib/dense.ts";
import type { CorpusFile } from "../lib/types.ts";

const DIR = path.resolve("data/index");
const CACHE = path.resolve("data/embed-cache.jsonl"); // not deployed (outside data/index)
const BATCH = 90;

function docText(c: CorpusFile["chunks"][number]) {
  return `${c.lawName} ${c.articleNo} ${c.heading}\n${c.path}\n${c.text}`.slice(0, 2400);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
  const corpus = JSON.parse(fs.readFileSync(path.join(DIR, "national.json"), "utf8")) as CorpusFile;
  const cache = new Map<string, number[]>();
  if (fs.existsSync(CACHE)) {
    for (const line of fs.readFileSync(CACHE, "utf8").split("\n")) {
      if (!line) continue;
      const { h, v } = JSON.parse(line) as { h: string; v: number[] };
      cache.set(h, v);
    }
  }
  const hashes = corpus.chunks.map(c => crypto.createHash("sha1").update(`${EMBED_MODEL}:${EMBED_DIM}:${docText(c)}`).digest("hex"));
  const todo = corpus.chunks.map((c, i) => ({ c, h: hashes[i] })).filter(x => !cache.has(x.h));
  console.log(`chunks=${corpus.chunks.length} cached=${corpus.chunks.length - todo.length} to embed=${todo.length}`);
  const out = fs.createWriteStream(CACHE, { flags: "a" });
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let vecs: number[][] | null = null;
    for (let attempt = 0; attempt < 5 && !vecs; attempt++) {
      try { vecs = await embed(batch.map(x => docText(x.c)), "RETRIEVAL_DOCUMENT", AbortSignal.timeout(60000)); }
      catch (e) { console.warn(`retry ${attempt + 1}:`, (e as Error).message); await new Promise(r => setTimeout(r, 2000 * (attempt + 1) ** 2)); }
    }
    if (!vecs) throw new Error("embedding failed repeatedly");
    batch.forEach((x, j) => { cache.set(x.h, vecs![j]); out.write(JSON.stringify({ h: x.h, v: vecs![j].map(n => Number(n.toFixed(5))) }) + "\n"); });
    process.stdout.write(`\r${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  out.end();
  const dim = EMBED_DIM;
  const vecs = new Int8Array(corpus.chunks.length * dim);
  const scales: number[] = [];
  corpus.chunks.forEach((_, i) => {
    const { q, scale } = quantize(cache.get(hashes[i])!);
    vecs.set(q, i * dim);
    scales.push(Number(scale.toExponential(6)));
  });
  fs.writeFileSync(path.join(DIR, "embeddings-national.bin"), Buffer.from(vecs.buffer));
  fs.writeFileSync(path.join(DIR, "embeddings-national.json"), JSON.stringify({ model: EMBED_MODEL, dim, ids: corpus.chunks.map(c => c.id), scales }));
  console.log(`\nwrote ${corpus.chunks.length} vectors (${(vecs.byteLength / 1e6).toFixed(1)} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
