import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceUrl, fetchLocalOrdinance, fetchNationalLaw } from "../lib/law-api.ts";

test("공식 상세 링크를 우선 사용하고 상대주소와 HTTPS를 처리한다", () => {
  assert.equal(buildSourceUrl("law", "123", "/LSW/lsInfoP.do?lsiSeq=456&amp;efYd=20260101"),
    "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=456&efYd=20260101");
  assert.equal(buildSourceUrl("ordin", "123", "http://law.go.kr/LSW/ordinInfoP.do?ordinSeq=456"),
    "https://law.go.kr/LSW/ordinInfoP.do?ordinSeq=456");
});

test("공식 링크가 없거나 외부·API 주소면 공개 일련번호 뷰어로 연결한다", () => {
  for (const link of ["", "https://example.com", "javascript:alert(1)", "/DRF/lawService.do?OC=test"]) {
    assert.equal(buildSourceUrl("law", "123", link), "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=123");
    assert.equal(buildSourceUrl("ordin", "456", link), "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=456");
  }
});

test("국가법령 원문 링크는 법령ID가 아닌 검색된 개정 일련번호를 사용한다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => new Response(JSON.stringify(++calls === 1
    ? { LawSearch: { law: [{ 법령명한글: "건축법", 법령일련번호: "987", 법령ID: "123", 현행연혁코드: "현행" }] }}
    : { 법령: { 조문: { 조문단위: { 조문여부: "조문", 조문번호: "1", 조문내용: "본문" } } }}));
  try {
    assert.equal((await fetchNationalLaw("건축법"))[0].sourceUrl, "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=987");
  } finally { globalThis.fetch = originalFetch; }
});

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
    ? { OrdinSearch: { law: [{ 자치법규명: "용인시 건축조례", 자치법규일련번호: "987", 자치법규ID: "123" }] }}
    : { LawService: { 조문: { 조: { 조문번호: "0001", 조제목: "검증", 조내용: body } } }}));
  try {
    const result = await fetchLocalOrdinance("용인시");
    assert.equal(result.length, 1);
    assert.ok(result[0].text.endsWith("마지막 단서"));
    assert.equal(result[0].sourceUrl, "https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=987");
  } finally { globalThis.fetch = originalFetch; }
});
