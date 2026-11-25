// In-process query embedding with an open-source Korean retrieval model
// (exp-models/dragonkue-KoEn-E5-Tiny: multilingual-e5-small fine-tuned on Korean
// query–passage pairs, vocabulary cut to Korean+English, 37M params, 384-dim).
//
// Runs on onnxruntime-web (WebAssembly) so the serverless bundle needs no native
// binaries, and on @huggingface/tokenizers (pure JS; token ids match the Python
// `tokenizers` library used to embed the documents — checked in tests).
// One query ≈ 30–60 ms on a single CPU core; the model loads once per instance (~1 s).
import fs from "node:fs";
import path from "node:path";

const MODEL_DIR = process.env.BUILDLEX_MODEL_DIR || path.join(process.cwd(), "data", "model", "koen-e5-tiny");
const ONNX_FILE = process.env.BUILDLEX_MODEL_ONNX || "model_qint8.onnx";
const MAX_LEN = 512;

type Session = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
};
type Ort = typeof import("onnxruntime-web");

let ready: Promise<{ ort: Ort; session: Session; encode: (t: string) => number[] }> | null = null;

export function localModelAvailable(): boolean {
  return fs.existsSync(path.join(MODEL_DIR, ONNX_FILE)) && fs.existsSync(path.join(MODEL_DIR, "tokenizer.json"));
}

function init() {
  if (!ready) {
    ready = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.numThreads = 1; // no worker threads inside a serverless function
      const { Tokenizer } = await import("@huggingface/tokenizers");
      const tok = new Tokenizer(
        JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "tokenizer.json"), "utf8")),
        JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "tokenizer_config.json"), "utf8")),
      );
      const session = (await ort.InferenceSession.create(fs.readFileSync(path.join(MODEL_DIR, ONNX_FILE)))) as unknown as Session;
      const encode = (t: string) => {
        const ids = tok.encode(t).ids as number[];
        // Keep </s> when truncating, like the Python tokenizer does.
        return ids.length <= MAX_LEN ? ids : [...ids.slice(0, MAX_LEN - 1), ids[ids.length - 1]];
      };
      return { ort, session, encode };
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/** Mean-pooled, L2-normalised embedding. Prefix queries with "query: " (e5 convention). */
export async function embedLocal(text: string): Promise<Float32Array> {
  const { ort, session, encode } = await init();
  const ids = encode(text);
  const n = ids.length;
  const shape = [1, n];
  const feeds: Record<string, unknown> = {
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
    attention_mask: new ort.Tensor("int64", new BigInt64Array(n).fill(1n), shape),
  };
  if (session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(n), shape);
  const out = await session.run(feeds);
  const h = out[session.outputNames[0]].data;
  const dim = h.length / n;
  const v = new Float32Array(dim);
  for (let i = 0; i < n; i++) for (let j = 0; j < dim; j++) v[j] += h[i * dim + j];
  let norm = 0;
  for (let j = 0; j < dim; j++) norm += v[j] * v[j];
  norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < dim; j++) v[j] /= norm;
  return v;
}
