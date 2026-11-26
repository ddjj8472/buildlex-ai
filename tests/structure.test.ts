import assert from "node:assert/strict";
import { test } from "node:test";
import { loadNational } from "../lib/corpus.ts";
import { consolidate, isContested, parseAnalysis } from "../lib/reason.ts";
import { _internals, analyzeStructure, parseArticleList } from "../lib/structure.ts";
import type { Evidence } from "../lib/types.ts";

const nat = loadNational();
const ev = (...ids: string[]): Evidence[] => ids.map((id, i) => ({ n: i + 1, chunk: nat.byId.get(id)!, score: 1, via: "search" as const }));

test("structure: article lists expand ranges and branch articles, and stop at another law", () => {
  const { articlesOf } = _internals.index();
  const ids = parseArticleList("제44조부터 제47조까지, 제51조 및 제57조", "건축법", articlesOf);
  for (const a of ["건축법#44", "건축법#45", "건축법#46", "건축법#47", "건축법#51", "건축법#57"]) assert.ok(ids.includes(a), a);
  assert.ok(!ids.includes("건축법#58"));
  const mixed = parseArticleList("제48조부터 제50조까지, 제50조의2의 규정과 「국토의 계획 및 이용에 관한 법률」 제54조", "건축법", articlesOf);
  assert.ok(mixed.includes("건축법#50의2") && mixed.includes("건축법#48"));
  assert.ok(!mixed.includes("건축법#54"), "제54조 belongs to another law");
});

test("structure: 준용 — a retrieved article applied to 용도변경 by 제19조⑦ is stated, with the source added", () => {
  const q = "건축법 제19조제7항에서 용도변경에 관하여 제48조를 준용한다고 하는데, 용도변경만 하는 경우에도 구조 안전 확인 서류를 내야 하는지?";
  const s = analyzeStructure(ev("건축법#48", "건축법시행령#32"), q);
  const line = s.lines.find(l => l.startsWith("[준용]") && l.includes("제48조"));
  assert.ok(line, s.lines.join("\n"));
  assert.match(line!, /제19조⑦/);
  assert.match(line!, /용도변경/);
  assert.match(line!, /시행령 제32조/, "the implementing 시행령 article is read the same way");
  assert.ok(s.add.some(a => a.chunk.id === "건축법#19"));
});

test("structure: 준용 is not listed when the question is not about 준용", () => {
  const s = analyzeStructure(ev("건축법#48", "건축법#19"), "구조 안전 확인은 누가 하나요?");
  assert.ok(!s.lines.some(l => l.startsWith("[준용]")));
});

test("structure: 적용 제외 — the exact list and which named articles are outside it", () => {
  const q = "건축법 제3조제2항에 따라 제46조의 적용이 제외되는 지역에서 제58조에 따른 대지 안의 공지 기준선으로 건축선도 적용되는지?";
  const s = analyzeStructure(ev("건축법#3", "건축법#46", "건축법#58"), q);
  const line = s.lines.find(l => l.startsWith("[적용 제외]") && l.includes("제3조②"));
  assert.ok(line, s.lines.join("\n"));
  assert.match(line!, /제44조, 제45조, 제46조, 제47조, 제51조, 제57조/);
  assert.match(line!, /목록에 없는 조문: 제58조/);
  assert.ok(s.lines.some(l => l.startsWith("[용어] '건축선'")), "건축선 is linked to where it is defined");
});

test("structure: 용어 — a term is linked to the article that creates it", () => {
  const s = analyzeStructure(ev("건축법#49"), "부칙 제2조에 따른 건축허가에 대수선허가가 포함되는지?");
  assert.ok(s.lines.some(l => l.startsWith("[용어] '건축허가'") && l.includes("제11조") && l.includes("대수선하려는 자")), s.lines.join("\n"));
});

test("structure: 부칙 — 경과조치 and 적용례 are typed with their scope", () => {
  const b = nat.chunks.find(c => c.lawKey === "건축법" && c.articleNo.includes("16380"))!;
  const s = analyzeStructure([{ n: 1, chunk: b, score: 1, via: "search" }], "법률 제16380호 건축법 부칙 제2조에 따른 건축허가에 대수선허가가 포함되는지?");
  assert.ok(s.lines.some(l => l.startsWith("[부칙·적용례]") && l.includes("최초로 건축허가를 신청")), s.lines.join("\n"));
  assert.ok(!s.lines.some(l => l.includes("제4조(")), "only the 부칙 article the question names");
});

test("reasoning: a conclusion resting on 반대해석 or a split vote is contested", () => {
  const issue = (conclusion: string, basis: string) => ({ issues: [{ label: "가", issue: "x", rules: [], elements: [], exceptions: [], method: "", basis, counter: "c", conclusion, answer: "a" }] });
  const agreeLiteral = consolidate([1, 2, 3].map(() => ({ model: "m", a: parseAnalysis(issue("예", "문언")) })));
  assert.equal(isContested(agreeLiteral), false);
  const agreeContrario = consolidate([1, 2, 3].map(() => ({ model: "m", a: parseAnalysis(issue("아니오", "반대해석")) })));
  assert.equal(isContested(agreeContrario), true);
  const split = consolidate([{ model: "a", a: parseAnalysis(issue("예", "문언")) }, { model: "b", a: parseAnalysis(issue("아니오", "문언")) }]);
  assert.equal(isContested(split), true);
  assert.equal(agreeContrario!.issues[0].counter, "c");
  // Code-side signals: a 준용/적용 제외/부칙 relation, or a scope question answered "아니오".
  assert.equal(isContested(agreeLiteral, { structure: "[준용] 건축법 제19조⑦ …" }), true);
  const agreeNo = consolidate([1, 2, 3].map(() => ({ model: "m", a: parseAnalysis(issue("아니오", "문언")) })));
  assert.equal(isContested(agreeNo, { query: "대수선허가가 포함되는지?" }), true);
  assert.equal(isContested(agreeNo, { query: "건폐율은 얼마인가?" }), false);
});

test("adjudication: only contested issues go to the judge, and a verdict overrides the analysis conclusion", async () => {
  const { judgePrompt, applyJudgment, formatAnalysis } = await import("../lib/reason.ts");
  const mk = (label: string, conclusion: string, basis: string) => ({ label, issue: `쟁점${label}`, rules: [], elements: [], exceptions: [], method: "", basis, counter: "반론", conclusion, answer: `답${label}` });
  const c = consolidate([1, 2, 3].map(() => ({ model: "m", a: parseAnalysis({ issues: [mk("가", "예", "문언"), mk("나", "아니오", "반대해석")] }) })))!;
  const p = judgePrompt({ query: "q", c, evidenceText: "e", structure: "[용어] …" });
  assert.match(p, /\(나\) 쟁점: 쟁점나/);
  assert.doesNotMatch(p, /\(가\) 쟁점/);
  assert.equal(applyJudgment(c, { issues: [{ label: "나", conclusion: "예", answer: "판정답", reason: "이유", confidence: "높음" }] }, "judge"), 1);
  const text = formatAnalysis(c);
  assert.match(text, /▶ 판정\(judge, 확신도 높음\): 예 — 판정답/);
  applyJudgment(c, { issues: [{ label: "나", conclusion: "예", answer: "x", reason: "y", confidence: "낮음" }] }, "judge");
  assert.match(formatAnalysis(c), /해석이 갈릴 수 있는 쟁점/);
});
