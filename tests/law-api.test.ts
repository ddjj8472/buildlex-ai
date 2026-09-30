import assert from "node:assert/strict";
import test from "node:test";
import { fetchLocalOrdinance } from "../lib/law-api.ts";

test("다른 지역 조례를 검색 결과의 대체 근거로 선택하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ OrdinSearch: { law: [
      { 자치법규명: "수원시 건축 조례", 자치법규일련번호: "1" },
    ] }}));
  };
  try {
    assert.deepEqual(await fetchLocalOrdinance("용인시"), []);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("조례명 공백 차이는 허용하고 긴 조문은 검색 전에 자르지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const body = "본문 ".repeat(3000) + "마지막 단서";
  globalThis.fetch = async () => new Response(JSON.stringify(++calls === 1
    ? { OrdinSearch: { law: [{ 자치법규명: "용인시 건축조례", 자치법규일련번호: "1", 자치법규ID: "1" }] }}
    : { LawService: { 조문: { 조: { 조문번호: "0001", 조제목: "검증", 조내용: body } } }}));
  try {
    const result = await fetchLocalOrdinance("용인시");
    assert.equal(result.length, 1);
    assert.ok(result[0].text.endsWith("마지막 단서"));
  } finally { globalThis.fetch = originalFetch; }
});
