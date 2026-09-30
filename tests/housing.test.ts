import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPlan, rankArticles } from "../lib/search.ts";
import { flattenAppendices } from "../lib/law-api.ts";
import { parseIntent } from "../lib/query-analysis.ts";
import type { LawArticle } from "../lib/law-api.ts";

test("공동주택 시설의 행위허가에는 주택관리법 3단을 검색한다", () => {
  for (const query of ["아파트 CCTV 증설 행위허가", "단지 경비원 휴게시설 설치", "공동주택 승강기 부품 수선"]) {
    const plan = buildSearchPlan(query);
    for (const law of ["공동주택관리법", "공동주택관리법 시행령", "공동주택관리법 시행규칙"]) assert.ok(plan.laws.includes(law));
  }
});

test("부품 수선 질문에서 일반 건축신고보다 경미한 행위 조문을 우선한다", () => {
  const sample = (lawName: string, title: string, text: string): LawArticle => ({lawName,title,text,effectiveDate:"",sourceUrl:"",sourceType:"국가법령"});
  const articles = [sample("건축법", "제14조(건축신고)", "허가 신고 변경"), sample("공동주택관리법 시행규칙", "제15조(경미한 행위의 범위)", "부대시설의 부품 수선"), sample("공동주택관리법", "제35조(행위허가 기준 등)", "행위허가")];
  const query = "아파트 승강기 부품 교체 신고";
  assert.equal(rankArticles(articles, query, buildSearchPlan(query).keywords, 1)[0].title, articles[1].title);
});

test("별표의 표 본문과 말미 예외를 보존하고 서식은 검색에서 제외한다", () => {
  const table = "행위허가 기준 ".repeat(3000) + "말미 조건";
  const detail = {별표:{별표단위:[{별표구분:"별표",별표번호:"0003",별표제목:"행위허가 또는 신고의 기준",별표내용:table},{별표구분:"서식",별표번호:"0001",별표내용:"신청서"}]}};
  const result = flattenAppendices(detail,"공동주택관리법 시행령","20260930","https://www.law.go.kr/");
  assert.equal(result.length,1);
  assert.equal(result[0].kind,"appendix");
  assert.ok(result[0].text.endsWith("말미 조건"));
});

test("의도 분석의 잘못된 JSON·URL은 검색계획에 들어가지 않는다", () => {
  assert.deepEqual(parseIntent("잘못된 응답"),{laws:[],terms:[]});
  assert.deepEqual(parseIntent('{"laws":["공동주택관리법","https://example.com",1],"terms":["부대시설",null]}'),{laws:["공동주택관리법"],terms:["부대시설"]});
});
