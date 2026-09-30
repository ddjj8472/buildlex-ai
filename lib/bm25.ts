// Compact inverted-index BM25 (typed-array postings) with two fields.
import { tokenize } from "./tokenize.ts";

type Postings = { docs: Int32Array; tfs: Uint16Array };

class Field {
  postings = new Map<string, Postings>();
  lens: Float32Array;
  avg = 1;
  constructor(texts: string[]) {
    const acc = new Map<string, { d: number[]; t: number[] }>();
    this.lens = new Float32Array(texts.length);
    texts.forEach((text, doc) => {
      const counts = new Map<string, number>();
      const toks = tokenize(text);
      this.lens[doc] = toks.length;
      for (const t of toks) counts.set(t, (counts.get(t) || 0) + 1);
      for (const [t, c] of counts) {
        let p = acc.get(t);
        if (!p) acc.set(t, (p = { d: [], t: [] }));
        p.d.push(doc);
        p.t.push(Math.min(c, 65535));
      }
    });
    for (const [t, p] of acc) this.postings.set(t, { docs: Int32Array.from(p.d), tfs: Uint16Array.from(p.t) });
    const total = this.lens.reduce((s, x) => s + x, 0);
    this.avg = total / Math.max(1, texts.length) || 1;
  }
}

export type Bm25Options = { k1?: number; b?: number; titleWeight?: number };

export class BM25Index {
  readonly size: number;
  private body: Field;
  private title: Field;
  constructor(bodies: string[], titles: string[], private opts: Bm25Options = {}) {
    this.size = bodies.length;
    this.body = new Field(bodies);
    this.title = new Field(titles);
  }

  /** Returns a dense score array (one entry per document). */
  scores(query: string, termWeights?: Map<string, number>): Float32Array {
    const out = new Float32Array(this.size);
    const q = new Map<string, number>();
    for (const t of tokenize(query)) q.set(t, (q.get(t) || 0) + 1);
    if (termWeights) for (const [t, w] of termWeights) q.set(t, Math.max(q.get(t) || 0, w));
    const k1 = this.opts.k1 ?? 1.2;
    const b = this.opts.b ?? 0.6;
    const tw = this.opts.titleWeight ?? 2.5;
    for (const [term, qtf] of q) {
      const kind = term.startsWith("w:") ? 1 : 0.45;
      const weight = kind * Math.min(qtf, 3);
      for (const [field, fw] of [[this.body, 1], [this.title, tw]] as const) {
        const p = field.postings.get(term);
        if (!p) continue;
        const idf = Math.log(1 + (this.size - p.docs.length + 0.5) / (p.docs.length + 0.5));
        for (let i = 0; i < p.docs.length; i++) {
          const d = p.docs[i];
          const tf = p.tfs[i];
          const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * field.lens[d] / field.avg));
          out[d] += fw * weight * idf * norm;
        }
      }
    }
    return out;
  }
}

export function topK(scores: Float32Array, k: number, filter?: (i: number) => boolean): { i: number; s: number }[] {
  const res: { i: number; s: number }[] = [];
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s <= 0 || (filter && !filter(i))) continue;
    if (res.length < k) { res.push({ i, s }); if (res.length === k) res.sort((a, b) => b.s - a.s); continue; }
    if (s > res[k - 1].s) {
      res[k - 1] = { i, s };
      for (let j = k - 1; j > 0 && res[j].s > res[j - 1].s; j--) [res[j], res[j - 1]] = [res[j - 1], res[j]];
    }
  }
  return res.sort((a, b) => b.s - a.s);
}
