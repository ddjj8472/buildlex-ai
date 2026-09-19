import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchPlan, rankArticles, tokenize } from "../lib/search.ts";

test("용적률 질문은 국토계획법을 포함한다", () => {
  const plan = buildSearchPlan("제2종 일반주거지역 용적률은 얼마인가요?");
  assert.ok(plan.laws.includes("국토의 계획 및 이용에 관한 법률 시행령"));
  assert.ok(plan.keywords.includes("용적률"));
});

test("주차장 질문은 주차장법을 포함한다", () => {
  const plan = buildSearchPlan("음식점 부설주차장 설치기준이 궁금합니다");
  assert.ok(plan.laws.includes("주차장법"));
});

test("조문은 질문어가 많이 일치하는 순서로 정렬된다", () => {
  const articles = [
    { lawName: "A", title: "제1조", text: "목적", effectiveDate: "20260101", sourceUrl: "", sourceType: "국가법령" as const },
    { lawName: "B", title: "제2조(용적률)", text: "용도지역의 용적률 기준", effectiveDate: "20260101", sourceUrl: "", sourceType: "국가법령" as const },
  ];
  const result = rankArticles(articles, "용도지역 용적률", tokenize("용도지역 용적률"));
  assert.equal(result[0]?.lawName, "B");
});
