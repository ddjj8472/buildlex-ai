import type { LawArticle } from "./law-api.ts";
import { YONGIN_CASES } from "../data/yongin-cases.ts";

// Small, manually reviewed index. These dated replies are reference cases,
// not a complete case-law search service or a substitute for current statutes.
export function findOfficialCases(query: string, region: string): LawArticle[] {
  const q = query.replace(/\s+/g, "");
  const result: LawArticle[] = [];
  if (/통로/.test(q) && /2(?:m|미터|메터)|2미만|접도/.test(q) && /미만|좁|안되|안돼/.test(q)) {
    result.push({
      lawName: "법제처 법령해석 18-0087",
      title: "건축물 대지의 접도의무 규정의 의미",
      text: "2018년 6월 12일 회답 요약: 대지가 도로에 2미터 이상 접하지만 건물에서 도로로 이어지는 통로에 폭 2미터 미만 부분이 있는 사안이다. 실제 출입을 방해하지 않는다고 인정되는 상황이라면 건축법 제44조제1항 위반으로 보지 않는다는 회답이다. 대지의 접도 길이와 내부 통로의 폭은 구분해야 한다. 건물 종류·규모, 통행 장애물과 주변 통행 여건을 함께 살펴야 한다. 과거 회답으로서 당시 규정에 관한 해석이며 현재 법령의 개정 여부와 개별 현장 조건을 별도로 확인해야 한다.",
      effectiveDate: "20180612", sourceType: "공식 질의회답",
      sourceUrl: "https://www.moleg.go.kr/lawinfo/nwLwAnInfo.mo?cs_seq=396876&mid=a10106020000",
    });
  }
  if ((region.replace(/\s/g, "").includes("용인") || q.includes("용인")) && /아파트|공동주택|단지|주상복합|업무시설/.test(q)) {
    const matching = YONGIN_CASES.filter(item => item.groups.every(group => group.some(term => q.includes(term.replace(/\s/g, "")))));
    for (const item of matching.slice(0, 2)) result.push({
      lawName: "용인시 공개 민원 회답", title: item.title, text: item.summary,
      effectiveDate: item.date, dateLabel: "공개", sourceType: "공식 질의회답", sourceUrl: item.url,
    });
  }
  return result;
}
