import assert from "node:assert/strict";
import { test } from "node:test";
import { consolidate, formatAnalysis, ground, needsReasoning, parseAnalysis, quoteIn, type LegalAnalysis } from "../lib/reason.ts";
import type { Evidence } from "../lib/types.ts";

const ev = (n: number, text: string) => ({ n, chunk: { id: `x#${n}`, text } } as unknown as Evidence);
const EVID = [
  ev(1, "11. \"도로\"란 보행과 자동차 통행이 가능한 너비 4미터 이상의 도로로서 다음 각 목의 어느 하나에 해당하는 도로나 그 예정도로를 말한다."),
  ev(2, "③ 다만, 「옥외광고물 등의 관리와 옥외광고산업 진흥에 관한 법률」에 따라 허가를 받거나 신고를 한 광고탑에 대해서는 법 제14조를 준용하지 아니한다."),
];

test("quotes are grounded verbatim or with light rewording, not when invented", () => {
  assert.ok(quoteIn("보행과 자동차 통행이 가능한 너비 4미터 이상의 도로", EVID[0].chunk.text));
  assert.ok(quoteIn("“도로”란 보행과 자동차 통행이 가능한 … 그 예정도로를 말한다", EVID[0].chunk.text));
  assert.ok(!quoteIn("외벽 수선이 수반되는 경우에 한정한다", EVID[0].chunk.text + EVID[1].chunk.text));
});

test("ground() fixes a wrong [n] and marks invented conditions; consolidate() drops them and votes", () => {
  const mk = (conclusion: string, extra = false): unknown => ({ issues: [{ label: "가", issue: "보행자전용도로가 도로인지", conclusion, answer: "…",
    rules: [{ n: 2, quote: "보행과 자동차 통행이 가능한 너비 4미터 이상의 도로로서" }],
    elements: [{ element: "자동차 통행 가능", n: 1, quote: "보행과 자동차 통행이 가능한", met: "no" }, ...(extra ? [{ element: "외벽 수선", n: 1, quote: "외벽 수선이 수반되는 경우", met: "no" }] : [])],
    exceptions: [] }] });
  const a = ground(parseAnalysis(mk("아니오", true)), EVID);
  assert.equal(a.issues[0].rules[0].n, 1); // quote found in [근거 1], not 2
  assert.equal(a.issues[0].elements[1].grounded, false);
  const c = consolidate([{ model: "m1", a }, { model: "m2", a: ground(parseAnalysis(mk("아니오")), EVID) }, { model: "m3", a: ground(parseAnalysis(mk("예")), EVID) }])!;
  assert.equal(c.issues[0].conclusion, "아니오");
  assert.equal(c.issues[0].agree, false);
  assert.deepEqual(c.issues[0].votes, ["아니오", "아니오", "예"]);
  assert.ok(c.issues[0].elements.every(e => e.grounded));
  const txt = formatAnalysis(c);
  assert.ok(txt.includes("결론(다수 2/3): 아니오"));
  assert.ok(txt.includes("반대 결론(1/3): 예"));
  assert.equal(c.issues[0].alt?.conclusion, "예");
  const same = formatAnalysis(consolidate([{ model: "m1", a }, { model: "m2", a }])!);
  assert.ok(same.includes("결론: 아니오") && !same.includes("반대 결론"));
  assert.ok(!/외벽 수선/.test(txt.split("제외한 조건")[0].split("\n").filter(l => l.includes("요건")).join("")));
});

test("parseAnalysis tolerates shape drift; needsReasoning picks judgment questions", () => {
  const a: LegalAnalysis = parseAnalysis({ issues: [{ issue: "x", conclusion: "아니오.", rules: "bad", elements: [{ n: "[근거 3]", quote: "q", met: true }] }] });
  assert.equal(a.issues[0].conclusion, "아니오");
  assert.equal(a.issues[0].elements[0].n, 3);
  assert.equal(a.issues[0].elements[0].met, "yes");
  assert.deepEqual(parseAnalysis(null).issues, []);
  assert.ok(needsReasoning("공작물 축조 신고를 해야 하는지?"));
  assert.ok(needsReasoning("대수선허가가 포함되는지 여부"));
  assert.ok(!needsReasoning("건폐율이 뭔가요"));
});

test("parseAnalysis accepts a bare issue list, a single issue, or a wrapped object", () => {
  const one = { label: "가", issue: "x", conclusion: "예", answer: "y" };
  assert.equal(parseAnalysis([one]).issues.length, 1);
  assert.equal(parseAnalysis(one).issues.length, 1);
  assert.equal(parseAnalysis({ analysis: { issues: [one] } }).issues.length, 1);
  assert.equal(parseAnalysis({ result: [one, one] }).issues.length, 2);
  assert.equal(parseAnalysis([{ issues: [one, one] }]).issues.length, 2);
});
