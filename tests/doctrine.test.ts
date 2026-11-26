import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { INTERPRETATION_CANONS } from "../lib/canons.ts";
import { DOCTRINES, matchDoctrines } from "../lib/doctrine.ts";
import { reasonPrompt } from "../lib/reason.ts";

const cases = JSON.parse(fs.readFileSync("tests/minwon.json", "utf8")) as { no: string; question: string; answer: string }[];
const ids = (q: string) => matchDoctrines(q).map(d => d.id);

test("법리 노트: only general principles remain, none sourced from an evaluated 해석례", () => {
  assert.deepEqual(DOCTRINES.map(d => d.id).sort(), ["jun-yong", "self-sanction", "transition-scope"]);
  const evaluated = new Set(cases.map(c => c.no));
  for (const d of DOCTRINES) {
    for (const n of d.source.match(/\d{2}-\d{4}/g) || []) assert.ok(!evaluated.has(n), `${d.id} cites evaluated case ${n}`);
    assert.ok(d.text.length < 600, `${d.id} too long`);
  }
});

test("법리 노트 and canons carry no answer to an evaluated question", () => {
  // The removed answer keys and the case-specific wording that was in the canons.
  const banned = [/리모델링/, /현장관리인/, /대피공간/, /도시계획시설|도시·군계획시설/, /비도시지역/, /제19조제1항/, /건축하거나 대수선하는 경우/, /제11조·제14조/];
  const text = `${INTERPRETATION_CANONS}\n${DOCTRINES.map(d => d.text).join("\n")}`;
  for (const r of banned) assert.doesNotMatch(text, r);
});

test("법리 노트: triggers are general (a similar question outside the set picks the same note)", () => {
  // 법제처 22-1001 (개발제한구역법) is not in the evaluation set.
  assert.ok(ids("지방자치단체가 개발제한구역법을 위반한 경우 그 지방자치단체의 장이 같은 지방자치단체에 시정명령을 하거나 이행강제금을 부과할 수 있는지?").includes("self-sanction"));
  assert.ok(ids("주차장법 시행령 부칙의 경과조치가 시행 후 신청한 변경신고에도 적용되는지?").includes("transition-scope"));
  assert.deepEqual(ids("건폐율 기준이 어떻게 되나요?"), []);
});

test("analysis prompt: 법리 노트 and the structure block are included only when given", () => {
  const p = reasonPrompt({ query: "q", evidenceText: "e", interpretations: [], doctrine: "- 준용의 의미: …", structure: "[준용] …" });
  assert.match(p, /\[법리 노트/);
  assert.match(p, /\[법령 구조 분석/);
  assert.match(p, /"basis"/);
  const bare = reasonPrompt({ query: "q", evidenceText: "e", interpretations: [] });
  assert.doesNotMatch(bare, /\[법리 노트/);
  assert.doesNotMatch(bare, /\[법령 구조 분석 —/);
});
