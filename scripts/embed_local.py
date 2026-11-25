"""Build the dense (semantic) index with a local open-source Korean embedding model.

  python3 scripts/embed_local.py --model models/koen-e5-tiny [--onnx onnx/model.onnx] [--scope national|ord|all]

Model: exp-models/dragonkue-KoEn-E5-Tiny (37M params, 384-dim, e5 "query:/passage:" prefixes,
mean pooling). Runs on CPU with onnxruntime, no API key, no per-call cost.

Each article is split into the same ~700-char passages the BM25 index uses and every passage
gets a contextual header (법령명 · 조문번호 · 제목 · 편장절), so a passage taken out of a long
article still says which provision it belongs to (cheap form of "contextual retrieval").
Vectors are L2-normalised and stored int8 with a per-row scale, like lib/dense.ts expects.
Output (data/index):
  embeddings-national.json/.bin               ids[] = chunk id per passage row
  ord-emb/<region file>.json/.bin             same, one shard per 지자체
"""
import argparse, json, os, sys, time, glob
import numpy as np, onnxruntime as ort
from tokenizers import Tokenizer

def split_passages(text, size=700):
    if len(text) <= size * 1.4: return [text]
    out, cur = [], ""
    for line in text.split("\n"):
        if cur and len(cur) + len(line) > size: out.append(cur); cur = ""
        cur += ("\n" if cur else "") + line
    if cur: out.append(cur)
    return out

def doc_text(c, p):
    return f"passage: {c['lawName']} {c['articleNo']} {c['heading']}\n{c['path']}\n{p}"

class Embedder:
    def __init__(self, model_dir, onnx_file, threads, max_len=512):
        o = ort.SessionOptions(); o.intra_op_num_threads = threads
        self.s = ort.InferenceSession(os.path.join(model_dir, onnx_file), o, providers=["CPUExecutionProvider"])
        self.tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        self.tok.enable_truncation(max_len); self.tok.enable_padding(pad_id=1, pad_token="<pad>")
        self.names = {i.name for i in self.s.get_inputs()}
    def __call__(self, texts):
        enc = self.tok.encode_batch(texts)
        ids = np.array([e.ids for e in enc], dtype=np.int64); m = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": m}
        if "token_type_ids" in self.names: feed["token_type_ids"] = np.zeros_like(ids)
        h = self.s.run(None, feed)[0]
        v = (h * m[..., None]).sum(1) / m.sum(1, keepdims=True)
        return v / np.linalg.norm(v, axis=1, keepdims=True)

def embed_all(emb, texts, batch=32, label=""):
    order = np.argsort([len(t) for t in texts])  # length-sorted batches waste less padding
    out = np.zeros((len(texts), 384), dtype=np.float32)
    t0 = time.time()
    for i in range(0, len(texts), batch):
        idx = order[i:i + batch]
        out[idx] = emb([texts[j] for j in idx])
        if (i // batch) % 50 == 0:
            done = i + len(idx); el = time.time() - t0
            print(f"\r{label} {done}/{len(texts)}  {el:.0f}s  ~{el / done * (len(texts) - done):.0f}s left", end="", file=sys.stderr, flush=True)
    print(f"\r{label} {len(texts)}/{len(texts)}  {time.time() - t0:.0f}s" + " " * 20, file=sys.stderr)
    return out

def quantize(v):
    scale = np.abs(v).max(1) / 127.0
    scale[scale == 0] = 1
    q = np.round(v / scale[:, None]).astype(np.int8)
    return q, scale

def write(path_base, model, ids, vecs):
    q, scale = quantize(vecs)
    with open(path_base + ".bin", "wb") as f: f.write(q.tobytes())
    with open(path_base + ".json", "w", encoding="utf8") as f:
        json.dump({"model": model, "dim": int(vecs.shape[1]), "ids": ids, "scales": [float(f"{s:.6e}") for s in scale]}, f, ensure_ascii=False)

def corpus_rows(corpus):
    ids, texts = [], []
    for c in corpus["chunks"]:
        for p in split_passages(c["text"]):
            ids.append(c["id"]); texts.append(doc_text(c, p))
    return ids, texts

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/koen-e5-tiny")
    ap.add_argument("--onnx", default="onnx/model.onnx")
    ap.add_argument("--name", default="koen-e5-tiny")
    ap.add_argument("--scope", default="all")
    ap.add_argument("--out", default="data/index")
    ap.add_argument("--threads", type=int, default=os.cpu_count())
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    emb = Embedder(a.model, a.onnx, a.threads)
    tag = f"{a.name}:{os.path.basename(a.onnx)}"
    if a.scope in ("national", "all"):
        corpus = json.load(open(os.path.join(a.out, "national.json"), encoding="utf8"))
        ids, texts = corpus_rows(corpus)
        if a.limit: ids, texts = ids[:a.limit], texts[:a.limit]
        vecs = embed_all(emb, texts, label="national")
        write(os.path.join(a.out, "embeddings-national"), tag, ids, vecs)
    if a.scope in ("ord", "all"):
        os.makedirs(os.path.join(a.out, "ord-emb"), exist_ok=True)
        files = sorted(glob.glob(os.path.join(a.out, "ord", "*.json")))
        all_ids, all_texts, owner = [], [], []
        for f in files:
            ids, texts = corpus_rows(json.load(open(f, encoding="utf8")))
            all_ids += ids; all_texts += texts; owner += [f] * len(ids)
        vecs = embed_all(emb, all_texts, label="ordinances")
        owner = np.array(owner)
        for f in files:
            sel = np.where(owner == f)[0]
            write(os.path.join(a.out, "ord-emb", os.path.basename(f)[:-5]), tag, [all_ids[i] for i in sel], vecs[sel])
        print(f"ordinance rows {len(all_ids)} in {len(files)} shards", file=sys.stderr)

if __name__ == "__main__":
    main()
