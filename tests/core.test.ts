import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleAnalysis, extractFacts } from "../lib/analyze-rules.ts";
import { resolveRegion } from "../lib/corpus.ts";
import { denseScores, quantize, type DenseIndex } from "../lib/dense.ts";
import { hybridSearch } from "../lib/search.ts";
import { tokenize } from "../lib/tokenize.ts";
import { verifyAnswer } from "../lib/verify.ts";
import { resolveRefs } from "../scripts/build-corpus.ts";

test("tokenizer strips particles and is spacing-robust", () => {
  const a = tokenize("대지 안의 공지를");
  const b = tokenize("대지안의공지");
  assert.ok(a.includes("w:공지"));
  const bigrams = (t: string[]) => t.filter(x => x.startsWith("b:"));
  assert.deepEqual(new Set(bigrams(b)).has("b:안의"), true);
  assert.ok(bigrams(a).some(x => bigrams(b).includes(x)));
});

test("citation resolver handles 법/영/「」/같은 법/별표", () => {
  const chunk = { id: "A#1", text: "법 제58조 및 영 제3조의2, 「주차장법」 제19조, 같은 법 시행령 제6조, 제3조, 별표 2" } as never;
  const meta = { lawKey: "A", level: "시행규칙", parentKey: "P", decreeKey: "D" } as never;
  const ids = new Set(["P#58", "D#3의2", "주차장법#19", "주차장법시행령#6", "A#3", "A#별표2"]);
  assert.deepEqual(new Set(resolveRefs(chunk, meta, ids, new Map([["주차장법", "주차장법"]]))), ids);
});

test("facts extraction", () => {
  const f = extractFacts("용인시 제2종 일반주거지역, 대지면적 330㎡, 지상 5층 근린생활시설");
  assert.equal(f.용도지역, "제2종일반주거지역");
  assert.equal(f.대지면적, "330㎡");
  assert.equal(f.층수, "지상 5층");
  assert.equal(f.건축물용도, "근린생활시설");
});

test("region resolution", () => {
  assert.equal(resolveRegion("용인시")?.key, "경기도/용인시");
  assert.equal(resolveRegion("서울 강남구")?.key, "서울특별시/강남구");
});

test("hybrid search finds core provisions", async () => {
  const { evidence } = await hybridSearch(ruleAnalysis("대수선의 범위가 궁금합니다"), { dense: false });
  assert.equal(evidence[0].chunk.id, "건축법시행령#3의2");
  const { evidence: ord } = await hybridSearch(ruleAnalysis("대지 안의 공지 거리"), { dense: false, region: resolveRegion("용인시") });
  assert.ok(ord.some(e => e.via === "ordinance" && e.chunk.lawName.includes("용인시")));
});

test("delegation expansion adds lower-level provisions", async () => {
  const { evidence } = await hybridSearch(ruleAnalysis("용도지역의 건폐율"), { dense: false });
  const ids = evidence.map(e => e.chunk.id);
  assert.ok(ids.includes("국토의계획및이용에관한법률#77"));
  assert.ok(ids.includes("국토의계획및이용에관한법률시행령#84"));
});

test("verifier flags hallucinated citations", async () => {
  const { evidence } = await hybridSearch(ruleAnalysis("대수선의 범위"), { dense: false });
  assert.equal(verifyAnswer("대수선은 「건축법 시행령」 제3조의2에 따릅니다 [1].", evidence).ok, true);
  const bad = verifyAnswer("「건축법」 제999조에 따라 가능합니다 [1] [40].", evidence);
  assert.equal(bad.ok, false);
  assert.equal(bad.issues.length, 2);
  assert.equal(verifyAnswer("근거 없는 답변", evidence).ok, false);
});

test("dense scoring ranks the nearest vector first", () => {
  const vs = [[1, 0, 0], [0, 1, 0], [0.7, 0.7, 0]];
  const qs = vs.map(quantize);
  const index: DenseIndex = { model: "t", dim: 3, ids: ["a", "b", "c"], scales: Float32Array.from(qs.map(q => q.scale)), vecs: Int8Array.from(qs.flatMap(q => [...q.q])), pos: new Map() };
  const s = denseScores(index, [0.1, 1, 0]);
  assert.equal([...s].indexOf(Math.max(...s)), 1);
});

test("verifier accepts [근거 n] citations", async () => {
  const { evidence } = await hybridSearch(ruleAnalysis("대수선의 범위"), { dense: false });
  const v = verifyAnswer("대수선 범위는 시행령에 있습니다[근거 1]. 추가로 [근거 2, 3] 참고.", evidence);
  assert.equal(v.ok, true);
  assert.deepEqual(v.cited, [1, 2, 3]);
});
