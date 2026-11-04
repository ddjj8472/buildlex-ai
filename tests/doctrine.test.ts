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

test("법리 노트: a similar question outside the set picks the same note (generalization probes)", () => {
  // 법제처 22-1001 (개발제한구역법) and 22-0475 (방화유리창) — not in the evaluation set.
  assert.ok(ids("지방자치단체가 개발제한구역법을 위반한 경우 그 지방자치단체의 장이 같은 지방자치단체에 시정명령을 하거나 이행강제금을 부과할 수 있는지?").includes("self-sanction"));
  assert.ok(ids("외벽 창호의 수선이 수반되지 않는 용도변경을 하려는 경우 같은 시설군 안에서 건축물대장 기재내용 변경을 신청하는 경우에도 방화유리창으로 해야 하는지?").includes("use-change-scope"));
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
