// RAG evaluation: accuracy (does the gold provision reach the evidence, and how high?)
// and economy (how much text the LLM has to read) for BM25-only, dense-only and hybrid
// retrieval, with the rule-based query analysis (no LLM, so the numbers are a floor and
// cost nothing to reproduce).
//
//   npx tsx scripts/eval-rag.ts [--configs bm25,dense,hybrid] [--out eval.json]
//
// Datasets
//   tests/gold.json       43  개발셋 (검색 튜닝에 사용)
//   tests/heldout.json    15  검증셋 (튜닝에 쓰지 않음)
//   tests/minwon.json     60  법제처 법령해석례 질의요지 → 회답 제목의 조문(gold_title)
//   tests/ordinance.json  24  지역 조례 질문 (6개 지자체) → 조례 조문
//   tests/ordinance-paraphrase.json 10  조례 질문을 일상어로 (핵심 용어 없이)
//   tests/paraphrase.json 36  법률용어 없이 일상어로 쓴 질문 (검색 튜닝·사전에 쓰지 않은 새 문항)
// 해석례 질의요지는 조문 번호를 직접 적는 경우가 많아, 검색 자체를 재려고 질문 속 조문 고정(cited)은 끈다.
import fs from "node:fs";
import { ruleAnalysis } from "../lib/analyze-rules.ts";
import { parseCitations } from "../lib/cite.ts";
import { loadNational, listRegions } from "../lib/corpus.ts";
import { loadDense } from "../lib/dense.ts";
import { evaluationPrompt, formatEvidence, rerankPrompt } from "../lib/prompts.ts";
import { hybridSearch, type SearchOptions } from "../lib/search.ts";
import type { Evidence } from "../lib/types.ts";

type Item = { set: string; q: string; gold: string[]; region?: string };

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const configsArg = arg("--configs", "bm25,dense,hybrid");

function load(): Item[] {
  const j = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
  const out: Item[] = [];
  for (const x of j("tests/gold.json")) out.push({ set: "개발셋", q: x.q, gold: x.gold });
  for (const x of j("tests/heldout.json")) out.push({ set: "검증셋", q: x.q, gold: x.gold });
  for (const x of j("tests/minwon.json")) if (x.gold_title?.length) out.push({ set: "해석례", q: x.question.slice(0, 600), gold: x.gold_title });
  for (const x of j("tests/paraphrase.json")) out.push({ set: "일상어", q: x.q, gold: x.gold });
  for (const x of j("tests/ordinance.json")) out.push({ set: "조례", q: x.q, gold: x.gold, region: x.region });
  for (const x of j("tests/ordinance-paraphrase.json")) out.push({ set: "조례 일상어", q: x.q, gold: x.gold, region: x.region });
  return out;
}

type Config = { name: string; opts: SearchOptions };
const CONFIGS: Record<string, Config> = {
  bm25: { name: "BM25만 (현재 운영)", opts: { dense: false } },
  dense: { name: "벡터만", opts: { dense: true, denseOnly: true } },
  hybrid: { name: "하이브리드 (BM25+벡터, RRF)", opts: { dense: true } },
  "hybrid-w0.8": { name: "하이브리드 w=0.8", opts: { dense: true, denseWeight: 0.8 } },
  "hybrid-w1.6": { name: "하이브리드 w=1.6", opts: { dense: true, denseWeight: 1.6 } },
  "hybrid-w2.4": { name: "하이브리드 w=2.4", opts: { dense: true, denseWeight: 2.4 } },
};

type Row = { set: string; rank: number; inEvidence: boolean; n: number; answerChars: number; reasonChars: number; leanRank: number; leanChars: number; ms: number; prodLLM: number; leanLLM: number; rerankChars: number };

function rankOf(evidence: Evidence[], gold: string[], ordinanceOnly: boolean) {
  const list = ordinanceOnly ? evidence.filter(e => e.via === "ordinance") : evidence;
  return list.findIndex(e => gold.includes(e.chunk.id));
}

async function run(cfg: Config, items: Item[]) {
  const lawKeys = new Set(loadNational().laws.keys());
  const regions = listRegions();
  const rows: Row[] = [];
  for (const it of items) {
    const a = ruleAnalysis(it.q);
    const region = it.region ? regions.find(r => r.key === it.region) ?? null : null;
    const cited = it.set === "해석례" ? [] : parseCitations(it.q, lawKeys);
    // 운영과 같은 AI 재순위 후보(상위 30개)를 잡아서 그 프롬프트 분량만 잰다 (AI는 부르지 않음).
    let rerankChars = 0;
    const capture = async (query: string, pool: Parameters<NonNullable<SearchOptions["rerank"]>>[1]) => {
      rerankChars = rerankPrompt(query, pool.map(c => ({ id: c.id, label: `${c.lawName} ${c.articleNo}(${c.heading})`, text: c.text.slice(0, 380).replace(/\s+/g, " ") }))).length;
      return null;
    };
    const t0 = Date.now();
    const full = await hybridSearch(a, { ...cfg.opts, region, cited, rerank: capture }); // 운영 설정: 검색 9 + 연결 6 + 조례 4
    const ms = Date.now() - t0;
    const lean = await hybridSearch(a, { ...cfg.opts, region, cited, limit: 5, maxExpansions: 2 }); // 절약 설정
    const ordOnly = !!it.region;
    rows.push({
      set: it.set,
      rank: rankOf(full.evidence, it.gold, ordOnly),
      inEvidence: rankOf(full.evidence, it.gold, ordOnly) >= 0,
      n: full.evidence.length,
      answerChars: formatEvidence(full.evidence, 48000, it.q).length,
      reasonChars: formatEvidence(full.evidence, 24000, it.q).length,
      leanRank: rankOf(lean.evidence, it.gold, ordOnly),
      leanChars: formatEvidence(lean.evidence, 48000, it.q).length,
      ms,
      rerankChars,
      // 판단형 질문 1건이 AI에 읽히는 근거 분량: 재순위 + 법리 분석 3회(24k 예산) + 답변(48k 예산) + 품질 평가
      prodLLM: rerankChars + 3 * formatEvidence(full.evidence, 24000, it.q).length + formatEvidence(full.evidence, 48000, it.q).length + evaluationPrompt(it.q, "", full.evidence).length,
      leanLLM: 3 * formatEvidence(lean.evidence, 24000, it.q).length + formatEvidence(lean.evidence, 48000, it.q).length + evaluationPrompt(it.q, "", lean.evidence).length,
    });
  }
  return rows;
}

function summarize(rows: Row[]) {
  const n = rows.length || 1;
  const r = (k: number) => rows.filter(x => x.rank >= 0 && x.rank < k).length / n;
  const mrr = rows.reduce((s, x) => s + (x.rank >= 0 ? 1 / (x.rank + 1) : 0), 0) / n;
  const avg = (f: (x: Row) => number) => rows.reduce((s, x) => s + f(x), 0) / n;
  return {
    N: rows.length, R1: r(1), R3: r(3), R5: r(5), Rall: rows.filter(x => x.inEvidence).length / n, MRR: mrr,
    leanRall: rows.filter(x => x.leanRank >= 0).length / n,
    evidenceN: avg(x => x.n), prodLLM: avg(x => x.prodLLM), leanLLM: avg(x => x.leanLLM), rerankChars: avg(x => x.rerankChars), answerChars: avg(x => x.answerChars), reasonChars: avg(x => x.reasonChars), leanChars: avg(x => x.leanChars), ms: avg(x => x.ms),
  };
}

async function main() {
  const items = load();
  const dense = loadDense();
  console.log(`items ${items.length}  dense index: ${dense ? `${dense.model} · ${dense.ids.length} rows` : "none"}`);
  const out: Record<string, unknown> = {};
  for (const key of configsArg.split(",")) {
    const w = /^hybrid-w([\d.]+)$/.exec(key);
    const cfg = CONFIGS[key] ?? (w ? { name: `하이브리드 w=${w[1]}`, opts: { dense: true, denseWeight: Number(w[1]) } } : undefined);
    if (!cfg) throw new Error(`unknown config ${key}`);
    const rows = await run(cfg, items);
    const sets = [...new Set(items.map(i => i.set))];
    const res: Record<string, ReturnType<typeof summarize>> = {};
    for (const s of sets) res[s] = summarize(rows.filter(r => r.set === s));
    res["전체(국가법령)"] = summarize(rows.filter(r => !r.set.startsWith("조례")));
    out[key] = { name: cfg.name, sets: res, rows };
    console.log(`\n== ${cfg.name}`);
    for (const [s, v] of Object.entries(res))
      console.log(`${s.padEnd(10)} N=${String(v.N).padStart(3)}  R@1 ${v.R1.toFixed(2)}  R@3 ${v.R3.toFixed(2)}  R@5 ${v.R5.toFixed(2)}  근거포함 ${v.Rall.toFixed(2)}  MRR ${v.MRR.toFixed(3)} | 절약설정 포함 ${v.leanRall.toFixed(2)} | 근거 ${v.evidenceN.toFixed(1)}건 답변 ${Math.round(v.answerChars)}자 절약 ${Math.round(v.leanChars)}자 | ${Math.round(v.ms)}ms | AI 입력: 운영 ${Math.round(v.prodLLM)}자 · 절약 ${Math.round(v.leanLLM)}자`);
  }
  // LLM 재순위 호출 1회 분량 (운영에서 BM25 결과 상위 30개를 AI에 다시 읽힘)
  const nat = loadNational();
  const sample = nat.chunks.filter(c => c.text.length > 40).slice(0, 30)
    .map(c => ({ id: c.id, label: `${c.lawName} ${c.articleNo}(${c.heading})`, text: c.text.slice(0, 380).replace(/\s+/g, " ") }));
  out.rerankPromptChars = rerankPrompt("질문", sample).length;
  console.log(`\nrerank prompt ≈ ${out.rerankPromptChars}자 (30 candidates)`);
  fs.writeFileSync(arg("--out", "/tmp/eval-rag.json"), JSON.stringify(out, null, 1));
}
main();
