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
  assert.match(text, /▶ 최종 결론\(판정 judge, 확신도 높음\): 예 — 판정답/);
  assert.match(text, /채택되지 않았다/);
  assert.doesNotMatch(text, /결론: 아니오 — 답나 \[독립 분석/);
  applyJudgment(c, { issues: [{ label: "나", conclusion: "예", answer: "x", reason: "y", confidence: "낮음" }] }, "judge");
  assert.match(formatAnalysis(c), /해석이 갈릴 수 있는 쟁점/);
});

test("adjudication vote: two agreeing judges confirm, two differing judges become 견해 대립", async () => {
  const { parseJudgment, mergeJudgments, formatAnalysis } = await import("../lib/reason.ts");
  const mk = (conclusion: string) => ({ label: "가", issue: "쟁점가", rules: [], elements: [], exceptions: [], method: "", basis: "반대해석", counter: "반론", conclusion, answer: "하위답" });
  const fresh = () => consolidate([1, 2, 3].map(() => ({ model: "m", a: parseAnalysis({ issues: [mk("아니오")] }) })))!;
  const v = (conclusion: string, confidence: string, answer = "판정답") => ({ issues: [{ label: "가", conclusion, answer, reason: "이유", confidence }] });

  const c1 = fresh();
  const r1 = mergeJudgments(c1, parseJudgment(c1, v("예", "보통"), "A"), parseJudgment(c1, v("예", "높음"), "B"));
  assert.deepEqual(r1, { changed: 1, split: 0 });
  assert.equal(c1.issues[0].judged?.votes, 2);
  assert.equal(c1.issues[0].judged?.confidence, "높음");
  assert.match(formatAnalysis(c1), /판정 A 외 1개 모델 일치/);

  const c2 = fresh();
  const r2 = mergeJudgments(c2, parseJudgment(c2, v("예", "높음"), "A"), parseJudgment(c2, v("아니오", "높음", "반대답"), "B"));
  assert.equal(r2.split, 1);
  assert.equal(c2.issues[0].judged?.confidence, "낮음");
  const t2 = formatAnalysis(c2);
  assert.match(t2, /다른 판정 모델\(B\)은 반대로 판정함\(견해 대립\): 아니오 — 반대답/);
  assert.match(t2, /판정이 엇갈림/);

  // Only one judge answered: it stands alone.
  const c3 = fresh();
  mergeJudgments(c3, parseJudgment(c3, v("예", "높음"), "A"), null);
  assert.equal(c3.issues[0].judged?.votes, undefined);
  assert.equal(c3.issues[0].judged?.confidence, "높음");
});

test("입법 취지: the amendment behind the named 항·호, the one whose 개정이유 is about it, never after asOf", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leg-"));
  fs.writeFileSync(path.join(dir, "law-versions.json"), JSON.stringify({ 건축법시행령: [
    { date: "2015-12-28", mst: "1", kind: "일부개정" }, { date: "2016-07-19", mst: "2", kind: "일부개정" }, { date: "2020-01-01", mst: "3", kind: "일부개정" },
  ] }));
  fs.writeFileSync(path.join(dir, "law-reasons.json"), JSON.stringify({ 건축법시행령: [
    { date: "2015-12-28", mst: "1", kind: "일부개정", text: "주차장 기준 정비" },
    { date: "2016-07-19", mst: "2", kind: "일부개정", text: "◇ 주요내용\n가. 리모델링 활성화를 위하여 건축기준 완화 대상을 확대함(제6조제1항제6호)." },
    { date: "2020-01-01", mst: "3", kind: "일부개정", text: "리모델링 완화 대상 명확화(제6조제1항제6호)" },
  ] }));
  process.env.BUILDLEX_DATA_DIR = dir;
  const { pickAmendments, excerptReasons } = await import(`../lib/legislative.ts?leg=${Date.now()}`);
  const chunk = { id: "c", lawKey: "건축법시행령", lawName: "건축법 시행령", articleNo: "제6조", heading: "적용의 완화", kind: "article",
    text: "[제6조] 적용의 완화\n① 법 제5조제2항에 따라 완화할 수 있는 경우는 다음과 같다. <개정 2015. 12. 28., 2016. 7. 19., 2020. 1. 1.>\n1. 수면 위에 건축하는 건축물\n6. 리모델링이 필요한 건축물인 경우" };
  const ev = [{ n: 1, chunk, score: 1, via: "search", reason: "질문에 인용된 조문", focus: { paras: [1], items: [6] } }];
  // 6호 has no tag of its own: the 항's lead line supplies the dates, and the reason naming 제6조 / 리모델링 wins.
  const [p] = pickAmendments(ev, ["리모델링", "완화"], 2, "2019-01-01");
  assert.equal(p.date, "2016-07-19");
  assert.equal(p.mst, "2");
  assert.match(p.paragraph, /리모델링이 필요한/);
  assert.match(excerptReasons(p.reason.split("\n"), "제6조", ["리모델링"]), /리모델링 활성화/);
  // Without asOf the later, equally relevant amendment is taken.
  assert.equal(pickAmendments(ev, ["리모델링", "완화"])[0].date, "2020-01-01");
  delete process.env.BUILDLEX_DATA_DIR;
});

test("adjudication arbiter: a split between the text and system judges is decided by the arbiter, the other view kept", async () => {
  const { parseJudgment, mergeJudgments, formatAnalysis, arbiterPrompt, judgePrompt } = await import("../lib/reason.ts");
  const mk = (conclusion: string) => ({ label: "가", issue: "쟁점가", rules: [], elements: [], exceptions: [], method: "", basis: "반대해석", counter: "반론", conclusion, answer: "하위답" });
  const c = consolidate([1, 2, 3].map(() => ({ model: "m", a: parseAnalysis({ issues: [mk("아니오")] }) })))!;
  const v = (conclusion: string, confidence: string, answer: string, argument: string) => ({ issues: [{ label: "가", conclusion, answer, reason: "이유", confidence, argument }] });
  const text = parseJudgment(c, v("아니오", "높음", "문언답", "문언 논거"), "T");
  const system = parseJudgment(c, v("예", "높음", "체계답", "체계 논거"), "S");
  const arb = parseJudgment(c, v("예", "높음", "조정답", "-"), "A");
  const r = mergeJudgments(c, text, system, arb);
  assert.equal(r.split, 1);
  assert.equal(c.issues[0].judged?.conclusion, "예");
  assert.equal(c.issues[0].judged?.confidence, "보통");            // a split caps the arbiter's confidence
  assert.equal(c.issues[0].judged?.other?.conclusion, "아니오");    // the text judge's view is kept
  assert.match(formatAnalysis(c), /반대로 판정함\(견해 대립\): 아니오 — 문언답 \/ 이유: 문언 논거/);
  // The arbiter settled it: the answer states the conclusion instead of hedging.
  assert.match(formatAnalysis(c), /조정 판정이 결론지었다: 결론 첫 문장을 이 최종 결론으로 단정/);
  assert.doesNotMatch(formatAnalysis(c), /→ 판정이 엇갈림/);
  const base = { query: "q", c, evidenceText: "e" };
  assert.match(judgePrompt({ ...base, role: "text" }), /문언 검토관/);
  assert.match(judgePrompt({ ...base, role: "system" }), /체계·목적 검토관/);
  assert.match(arbiterPrompt({ ...base, split: [{ label: "가", text: text.get("가")!, system: system.get("가")! }] }), /2006다81035/);
});
