import assert from "node:assert/strict";
import test from "node:test";
import { findOfficialCases } from "../lib/official-cases.ts";
import { renderGroundedAnswer } from "../lib/grounding.ts";
import { selectEvidence } from "../lib/evidence.ts";
import { buildSearchPlan, rankArticles } from "../lib/search.ts";
import type { LawArticle } from "../lib/law-api.ts";

const queries = [
  ["아파트 단지 어린이 공원을 주차 공간으로 바꾸려면 주민 동의와 신고가 필요한가요?", "어린이공원"],
  ["용인시 아파트 조경과 보도블록을 주차장으로 전환할 때 기준은?", "조경시설"],
  ["아파트 재활용 집하장을 경비원의 휴게공간으로 변경하려면 대표회의 의결만 하면 되나요?", "경비원 휴게실"],
  ["단지 테니스장 일부 변경과 외부 개방 조건이 궁금합니다", "테니스장"],
  ["아파트 운동시설 두 곳을 철거해 주차장으로 바꿀 때 면적과 절차는?", "주민운동시설"],
  ["건축허가를 받은 주택 업무시설 복합건물의 옥상 사무실 증축과 택배함 철거는 공동주택 행위허가 대상인가요?", "옥상 증축"],
];
test("용인시 공개 회답 6개를 바꿔 쓴 질문에서도 해당 사안의 근거를 찾는다", () => {
  for (const [query, title] of queries) assert.ok(findOfficialCases(query, "용인시").some(a => a.title.includes(title)), query);
});
test("다른 지역·공공 도시공원·무관한 시설에는 단지 회답을 적용하지 않는다", () => {
  assert.deepEqual(findOfficialCases(queries[0][0], "수원시"), []);
  assert.deepEqual(findOfficialCases("용인시 도시계획시설인 어린이공원을 공영주차장으로 변경하려고 합니다", "용인시"), []);
  assert.deepEqual(findOfficialCases("아파트 주차장 주차요금 기준", "용인시"), []);
});
test("접도 길이와 내부 통로 폭 해석례를 구분해 검색한다", () => {
  assert.equal(findOfficialCases("도로에 2m 접하지만 내부 통로 일부가 2m 미만인데 접도 위반인가요?", "용인시")[0].lawName, "법제처 법령해석 18-0087");
  assert.deepEqual(findOfficialCases("대지가 도로에 1m만 접하면 건축이 가능한가요?", "용인시"), []);
});
test("공동주택·시공·정비사업의 필요한 법률을 누락하지 않는다", () => {
  assert.ok(buildSearchPlan(queries[0][0]).laws.includes("공동주택관리법 시행령"));
  assert.ok(buildSearchPlan("주택법 제34조의 시공 제한 범위").laws.includes("건설산업기본법"));
  assert.ok(buildSearchPlan("도시정비법 다물건자 조합원 지위 시점").laws.includes("도시 및 주거환경정비법"));
  assert.ok(!buildSearchPlan(queries[0][0]).laws.includes("주차장법"));
  assert.ok(buildSearchPlan("아파트 부설주차장 주차대수 설치기준").laws.includes("주차장법"));
});
const article = (lawName: string, title: string, text: string): LawArticle => ({lawName, title, text, effectiveDate:"20260101", sourceUrl:"", sourceType:"국가법령"});
test("관련 조문의 명시적 다른 법률 인용을 한 단계 연결한다", () => {
  const main = article("주택법", "제34조(주택의 시공)", "시공자는 「건설산업기본법」 제9조에 따른 건설사업자이다.");
  const linked = article("건설산업기본법", "제9조(건설업의 등록)", "등록 절차와 요건을 정한다.");
  const pool = [main, linked, ...Array.from({length:10}, (_, i) => article("주택법", `제${100+i}조(시공 관련)`, "시공 시공 제한"))];
  assert.ok(selectEvidence(pool, "주택법 제34조 시공 제한", buildSearchPlan("주택법 시공").keywords).includes(linked));
});
test("조합원 자격의 직접 조문이 포괄적인 건축 절차보다 먼저 나온다", () => {
  const direct = article("도시 및 주거환경정비법", "제39조(조합원의 자격 등)", "여러 명을 대표하는 1명을 조합원으로 본다.");
  const broad = article("건축법", "제11조(건축허가)", "조합원 조합설립인가 다물건자 건축허가");
  const q = "도시정비법 다물건자 조합원 지위 시점";
  assert.equal(rankArticles([broad, direct], q, buildSearchPlan(q).keywords)[0], direct);
});
test("시행규칙의 법·영 인용을 시행규칙 동번호 조문으로 잘못 연결하지 않는다", () => {
  const main = article("공동주택관리법 시행규칙", "제15조(행위허가)", "법 제35조 및 영 제35조에 따른 행위허가 기준입니다.");
  const law = article("공동주택관리법", "제35조(행위허가 기준)", "행위허가의 기준");
  const decree = article("공동주택관리법 시행령", "제35조(행위허가 기준)", "행위허가의 기준");
  const wrong = article("공동주택관리법 시행규칙", "제35조(조정 비용)", "조정 비용");
  const pool = [main, law, decree, wrong, ...Array.from({length:10}, (_,i) => article("공동주택관리법", `제${100+i}조(행위허가)`, "행위허가 기준"))];
  const selected = selectEvidence(pool, "공동주택관리법 시행규칙 제15조 행위허가", ["행위허가"]);
  assert.ok(selected.includes(law));
  assert.ok(selected.includes(decree));
  assert.ok(!selected.includes(wrong));
});
test("원문에 없는 인용과 수치를 거부한다", () => {
  const ev = [article("가상 검사 법령", "제1조(기준)", "해당 시설의 변경은 입주자 3분의 2 이상 동의를 받아 신고해야 합니다.")];
  const response = (text: string, quote: string, source = 1) => JSON.stringify({claims:[{text,supports:[{source,quote}]}],missing:[],next:["동의서를 확인하세요."]});
  assert.throws(() => renderGroundedAnswer(response("동의 필요", "입주자 모두의 동의를 받아야 합니다"), ev));
  assert.throws(() => renderGroundedAnswer(response("100% 동의 필요", ev[0].text), ev));
  assert.throws(() => renderGroundedAnswer(response("동의 필요", ev[0].text, 8), ev));
  assert.ok(renderGroundedAnswer(response("3분의 2 이상 동의와 신고가 필요합니다.", ev[0].text), ev).includes("[근거 1]"));
});
