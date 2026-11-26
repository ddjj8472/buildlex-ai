import assert from "node:assert/strict";
import { test } from "node:test";
import { dateKey, isHeldOut, precedentQueries } from "../lib/precedent.ts";
import type { QueryAnalysis } from "../lib/types.ts";

const a = (legalTerms: string[]): QueryAnalysis => ({ standalone: "q", intent: "", legalTerms, laws: [], subQueries: [], facts: {}, missing: [], source: "rules" });

test("precedent queries: relation types from the structure analysis come first, generic terms are dropped", () => {
  const q = precedentQueries(a(["건축물", "용도변경", "구조 안전", "건축주"]), ["[준용] 건축법 제19조⑦ …", "[부칙·경과조치] …"]);
  assert.deepEqual(q.slice(0, 2), ["준용", "경과조치"]);
  assert.ok(q.includes("용도변경") && !q.includes("건축물") && !q.includes("건축주"));
  assert.ok(q.length <= 5);
});

test("precedent dates: formats normalise, and the cutoff compares them", () => {
  assert.equal(dateKey("2018. 12. 3."), 20181203);
  assert.equal(dateKey("20181203"), 20181203);
  assert.equal(dateKey("2018-12-03"), 20181203);
  assert.ok(dateKey("2017. 5. 1.") < dateKey("2018. 12. 3."));
  assert.equal(dateKey(""), 0);
});

test("precedent holdout: the test case itself is dropped by title", () => {
  const t = "「건축법」 제3조제2항에 따라 건축선의 지정에 관한 규정인 같은 법 제46조의 적용이 제외되는 지역에서 대지 안의 공지 확보를 위해";
  assert.ok(isHeldOut(`민원인 - ${t}`, [t]));
  assert.ok(!isHeldOut("민원인 - 개발제한구역에서 지방자치단체에 이행강제금을 부과할 수 있는지", [t]));
});
