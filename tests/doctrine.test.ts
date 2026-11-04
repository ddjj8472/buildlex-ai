import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { DOCTRINES, matchDoctrines } from "../lib/doctrine.ts";
import { reasonPrompt } from "../lib/reason.ts";

const cases = JSON.parse(fs.readFileSync("tests/minwon.json", "utf8")) as { question: string }[];
const ids = (q: string) => matchDoctrines(q).map(d => d.id);

test("법리 노트: each failure-analysis note is picked by the question that needed it", () => {
  const want: Record<number, string> = { 7: "jun-yong", 10: "permit-term", 18: "self-sanction", 20: "change-permit-transition", 25: "change-permit-transition", 32: "remodel-relief", 33: "site-manager", 36: "building-line-concept", 45: "use-change-scope", 49: "planning-facility-far", 56: "evac-space-area" };
  for (const [i, id] of Object.entries(want)) assert.ok(ids(cases[Number(i)].question).includes(id), `case ${i} → ${id}`);
});

test("법리 노트: narrow triggers — a passing mention does not pull an unrelated note", () => {
  // 18 lists 현장관리인 among 건축주등 but is not about its qualification; 46 mentions 건축선 only.
  assert.ok(!ids(cases[18].question).includes("site-manager"));
  assert.ok(!ids(cases[46].question).includes("building-line-concept"));
  assert.ok(!ids(cases[9].question).includes("remodel-relief")); // 리모델링 감리, not 용도변경 완화
  assert.deepEqual(ids("건폐율 기준이 어떻게 되나요?"), []);
  assert.ok(matchDoctrines("준용 변경허가 부칙 대피공간 면적 현장관리인 자격 리모델링 완화 용도변경", 3).length <= 3);
  for (const d of DOCTRINES) assert.ok(d.text.length < 700, `${d.id} too long`);
});

test("법리 노트 goes into the analysis prompt with priority over the general canons", () => {
  const p = reasonPrompt({ query: "q", evidenceText: "e", interpretations: [], doctrine: "- 준용의 의미: …" });
  assert.match(p, /\[법리 노트[^\]]*우선/);
  assert.doesNotMatch(reasonPrompt({ query: "q", evidenceText: "e", interpretations: [] }), /\[법리 노트/);
});
