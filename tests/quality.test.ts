import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPlan, rankArticles } from "../lib/search.ts";
import { buildSearchPlan as oldPlan, rankArticles as oldRank } from "./baseline-search.ts";
import { cleanAnswer, validateAnswer } from "../lib/answer-quality.ts";
import type { LawArticle } from "../lib/law-api.ts";

// Synthetic retrieval fixtures: no legal thresholds or factual legal advice.
const corpus: LawArticle[] = [
  ["용적률", "용도지역별 용적률을 정한다."],
  ["건폐율", "용도지역별 건폐율을 정한다."],
  ["대지와 도로의 관계", "대지는 도로에 접하여야 한다."],
  ["대지 안의 공지", "인접 대지경계선으로부터 띄어야 하는 거리를 정한다."],
  ["일조 등의 확보를 위한 건축물의 높이 제한", "정북 방향과 채광을 위한 기준을 적용한다."],
  ["용도변경", "건축물의 용도변경 시 확인할 사항이다."],
  ["부설주차장의 설치기준", "주차대수와 주차단위구획을 검토한다."],
  ["직통계단의 설치", "피난을 위한 계단 설치 기준이다."],
  ["허가 서류", "건축허가 건축신고 용도변경 대수선 사용승인 용도지역 건폐율 용적률 개발행위허가 대지와 도로 접도 일조 높이제한 대지의 조경 부설주차장 설치기준 주차단위구획 피난시설 방화구획 내화구조 마감재료 직통계단"],
].map(([title, text], index) => ({lawName: "검색 평가용 가상 법령", title: `제${index+1}조(${title})`, text, effectiveDate: "20260101", sourceUrl: "", sourceType: "국가법령"}));

const cases: [string, number][] = [
  ["용적률은 얼마인가요?", 0], ["건폐율은 어떻게 확인하나요?", 1],
  ["접도 요건이 궁금합니다", 2], ["이격 기준 알려줘", 3],
  ["정북방향 일조권을 확인하고 싶어요", 4], ["용도 변경 절차는?", 5],
  ["주차대수는 얼마인가요?", 6], ["직통계단 설치 기준 알려줘", 7],
];

test("동일한 8개 질문에서 검색 Top-1 정확도가 기존보다 높아야 한다", () => {
  let before = 0, after = 0;
  const rows = cases.map(([query, index]) => {
    const expected = corpus[index].title;
    const old = oldRank(corpus, query, oldPlan(query).keywords, 1)[0]?.title;
    const current = rankArticles(corpus, query, buildSearchPlan(query).keywords, 1)[0]?.title;
    before += Number(old === expected); after += Number(current === expected);
    return {query, expected, before: old, after: current};
  });
  console.table(rows);
  console.log(`Synthetic Top-1: ${before}/${cases.length} -> ${after}/${cases.length}`);
  assert.ok(after > before);
  assert.equal(after, cases.length);
});

test("기존의 명확한 단일 용어 검색 성능을 유지한다", () => {
  for (const [query] of cases) {
    const terms = buildSearchPlan(query).keywords;
    const result = rankArticles(corpus, query, terms, 8);
    assert.ok(result.length > 0);
    assert.equal(new Set(result.map(a => a.title)).size, result.length);
  }
});

test("복합 질문에서 뒤쪽 전문 법령을 잘라내지 않는다", () => {
  const plan = buildSearchPlan("용적률 주차 피난 내진 기준");
  assert.ok(plan.laws.includes("건축물의 구조기준 등에 관한 규칙"));
  assert.ok(plan.laws.includes("건축물의 피난ㆍ방화구조 등의 기준에 관한 규칙"));
});

test("본문 중복으로 근거 슬롯을 낭비하지 않는다", () => {
  const result = rankArticles([corpus[0], corpus[0]], "용적률", ["용적률"]);
  assert.equal(result.length, 1);
});

test("음식점 주차대수 질문은 주차장 자체의 용도변경과 구분한다", () => {
  const articles = [
    {...corpus[6], title: "제16조(부설주차장의 용도변경 신청 등)", text: "부설주차장 용도변경 신청"},
    {...corpus[6], title: "제6조(부설주차장의 설치기준)", text: "시설물의 용도를 변경하는 경우 주차대수 산정"},
  ];
  const query = "음식점으로 용도변경할 때 주차대수는 어떻게 확인하나요?";
  assert.equal(rankArticles(articles, query, buildSearchPlan(query).keywords, 1)[0].title, articles[1].title);
});

test("마크다운 기호 제거 후 수치와 인용은 보존한다", () => {
  assert.equal(cleanAnswer("## 판단\n**50%** 적용 [근거 1]\n* 확인사항"), "판단\n50% 적용 [근거 1]\n• 확인사항");
});

test("존재하지 않는 근거나 무인용 답변을 성공으로 제공하지 않는다", () => {
  assert.throws(() => validateAnswer("가능합니다 [근거 9]", 2));
  assert.throws(() => validateAnswer("가능합니다", 2));
  assert.throws(() => validateAnswer("가능합니다 [근거 0]", 2));
  assert.throws(() => validateAnswer("기준 [근거 1, 근거 9]", 2));
  assert.equal(validateAnswer("기준 [근거 1, 2]", 2), "기준 [근거 1] [근거 2]");
  assert.equal(validateAnswer("**확인 필요** [근거 2]", 2), "확인 필요 [근거 2]");
});
