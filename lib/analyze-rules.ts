// Rule-based query analysis (no LLM). Also used to validate/merge LLM output.
import { expandTerms, hintLaws } from "./lexicon.ts";
import type { QueryAnalysis, SiteFacts } from "./types.ts";

const ZONES = [
  "제1종전용주거지역", "제2종전용주거지역", "제1종일반주거지역", "제2종일반주거지역", "제3종일반주거지역", "준주거지역",
  "중심상업지역", "일반상업지역", "근린상업지역", "유통상업지역", "전용공업지역", "일반공업지역", "준공업지역",
  "보전녹지지역", "생산녹지지역", "자연녹지지역", "보전관리지역", "생산관리지역", "계획관리지역", "농림지역", "자연환경보전지역",
];

const USES = [
  "단독주택", "다중주택", "다가구주택", "공관", "아파트", "연립주택", "다세대주택", "기숙사", "제1종 근린생활시설", "제2종 근린생활시설",
  "근린생활시설", "문화 및 집회시설", "종교시설", "판매시설", "운수시설", "의료시설", "교육연구시설", "노유자시설", "수련시설",
  "운동시설", "업무시설", "오피스텔", "숙박시설", "위락시설", "공장", "창고시설", "위험물 저장 및 처리 시설", "자동차 관련 시설",
  "동물 및 식물 관련 시설", "자원순환 관련 시설", "교정시설", "국방·군사시설", "방송통신시설", "발전시설", "묘지 관련 시설",
  "관광 휴게시설", "장례시설", "야영장 시설", "휴게음식점", "일반음식점", "제과점", "사무소", "학원", "고시원", "도시형 생활주택",
];

export function extractFacts(text: string): SiteFacts {
  const t = text.replace(/\s+/g, "");
  const f: SiteFacts = {};
  const zone = ZONES.find(z => t.includes(z)) || (/(\d)종\s*일반\s*주거/.exec(text) ? `제${/(\d)종\s*일반\s*주거/.exec(text)![1]}종일반주거지역` : undefined);
  if (zone) f.용도지역 = zone;
  const use = USES.find(u => t.includes(u.replace(/\s+/g, "")));
  if (use) f.건축물용도 = use;
  const area = text.match(/대지\s*(?:면적)?\s*(?:이|은|는)?\s*([\d,.]+)\s*(㎡|제곱미터|m2|평)/);
  if (area) f.대지면적 = area[1] + area[2];
  const floor = text.match(/연면적\s*(?:이|은|는)?\s*([\d,.]+)\s*(㎡|제곱미터|m2|평)/);
  if (floor) f.연면적 = floor[1] + floor[2];
  const storeys = text.match(/(지상\s*)?(\d{1,3})\s*층(?!간)/);
  if (storeys) f.층수 = `${storeys[1] ? "지상 " : ""}${storeys[2]}층`;
  const road = text.match(/(\d+(?:\.\d+)?)\s*(?:m|미터)\s*(?:도로|폭)/);
  if (road) f.도로 = `너비 ${road[1]}m 도로`;
  const when = text.match(/(\d{4})\s*년\s*(\d{1,2})?\s*월?\s*(?:에)?\s*(허가|착공|신고|사용승인|건축)/);
  if (when) f.허가시점 = `${when[1]}년${when[2] ? ` ${when[2]}월` : ""} ${when[3]}`;
  const region = text.match(/([가-힣]{1,6}(?:특별시|광역시|특별자치시|특별자치도|도)?\s*[가-힣]{1,6}(?:시|군|구))(?![가-힣])/);
  if (region && !/설치|건축|주차|도시/.test(region[1])) f.지역 = region[1];
  return f;
}

const FOLLOW_UP = /^(그럼|그러면|그렇다면|그런데|추가로|또|이\s*경우|그\s*경우|위\s*경우|이때|그때)/;

export function ruleAnalysis(query: string, history: { q: string }[] = [], known: SiteFacts = {}): QueryAnalysis {
  const prev = history.at(-1)?.q;
  const standalone = prev && (FOLLOW_UP.test(query.trim()) || query.trim().length < 18) ? `${prev} ${query}` : query;
  const legalTerms = expandTerms(standalone);
  const laws = hintLaws(standalone);
  const facts = { ...known, ...extractFacts(query) };
  const missing: string[] = [];
  if (/건폐율|용적률|높이|층수|건축제한|용도지역/.test(standalone) && !facts.용도지역) missing.push("용도지역");
  if (/조례|이격|공지|주차|조경|건폐율|용적률|수수료|심의/.test(standalone) && !facts.지역) missing.push("지역(시·군·구)");
  if (/용도변경|주차|피난|계단|허가|신고|편의시설|소방/.test(standalone) && !facts.건축물용도) missing.push("건축물 용도");
  if (/주차|피난|계단|허가|신고|편의시설|소방|승강기/.test(standalone) && !facts.연면적) missing.push("연면적·바닥면적");
  return {
    standalone, intent: "", legalTerms, laws, subQueries: [], facts, missing: missing.slice(0, 3),
    offTopic: false, source: "rules",
  };
}
