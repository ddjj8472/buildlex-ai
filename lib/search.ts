import { CORE_LAWS, LAW_TOPICS } from "../data/law-scope.ts";
import type { LawArticle } from "./law-api.ts";

const STOP_WORDS = new Set([
  "건축", "건물", "관련", "기준", "경우", "가능", "여부", "대한", "어떻게",
  "얼마", "해야", "되나요", "인가요", "알려줘", "우리", "있는", "없는",
]);

export type SearchPlan = {
  topics: string[];
  laws: string[];
  keywords: string[];
};

const CONCEPTS = [
  ["건폐율"], ["용적률"], ["일조", "일조권", "정북", "채광"],
  ["대지 안의 공지", "대지안의공지", "이격", "인접 대지경계선"],
  ["접도", "대지와 도로", "도로에", "도로폭"],
  ["주차", "주차대수", "부설주차장"],
  ["피난", "직통계단", "비상계단"], ["방화구획"],
  ["용도변경", "용도 변경"], ["건축허가", "허가"], ["건축신고", "신고"],
  ["조경", "대지의 조경"], ["내진", "구조안전", "구조계산"],
];

function normalized(text: string): string {
  return text.normalize("NFKC").replace(/[ㆍ·]/g, " ").replace(/\s+/g, "").toLowerCase();
}

function concepts(query: string): string[][] {
  return CONCEPTS.filter(group => group.some(term => normalized(query).includes(normalized(term))));
}

export function tokenize(text: string): string[] {
  return [...new Set(
    text
      .replace(/[^0-9A-Za-z가-힣㎡%·ㆍ]/g, " ")
      .split(/\s+/)
      .map((token) => {
        const stem = token.trim().replace(/(에서는|에서|으로|에게|까지|부터|은|는|을|를|과|와|의|이|가)$/, "");
        return stem.length >= 2 ? stem : token.trim();
      })
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  )];
}

export function buildSearchPlan(query: string): SearchPlan {
  const expandedQuery = `${query} ${concepts(query).flat().join(" ")}`;
  const matched = LAW_TOPICS.filter((topic) =>
    topic.triggers.some((trigger) => normalized(expandedQuery).includes(normalized(trigger))),
  );
  const selected = matched.length ? matched : LAW_TOPICS.filter(topic => ["permit", "site"].includes(topic.id));

  return {
    topics: selected.map((topic) => topic.label),
    laws: [...new Set([...selected.flatMap((topic) => topic.laws), ...CORE_LAWS])],
    keywords: [...new Set([...tokenize(query), ...concepts(query).flat(), ...selected.filter(t => t.id === "housing").flatMap(t => t.keywords)])],
  };
}

export function rankArticles(
  articles: LawArticle[],
  query: string,
  keywords: string[],
  limit = 8,
): LawArticle[] {
  const queryTokens = tokenize(query);
  const groups = concepts(query);
  const terms = [...new Set([...queryTokens, ...keywords].map(normalized))].filter(Boolean);
  const unique = [...new Map(articles.map(article => [`${article.lawName}|${article.title}`, article])).values()];
  const frequencies = new Map(terms.map(term => [term, unique.filter(a => normalized(a.title + a.text).includes(term)).length]));
  return unique
    .map((article) => {
      const title = normalized(article.title);
      const body = normalized(article.text);
      const matchedGroups = groups.filter(group => group.some(term => (title + body).includes(normalized(term))));
      let score = groups.length && !matchedGroups.length ? 0 : terms.reduce((sum, term) => {
        const idf = Math.log(1 + unique.length / (1 + (frequencies.get(term) || 0)));
        return sum + idf * (title.includes(term) ? 12 : body.includes(term) ? 2 : 0);
      }, 0) + matchedGroups.length * 4;
      // Changing a building's use and changing the use of its parking lot
      // are distinct intents despite sharing the same Korean keyword.
      if (/주차대수|주차.*몇\s*대|몇\s*대.*주차/.test(query)) {
        if (/부설주차장.*설치기준/.test(title)) score += 25;
        if (/부설주차장.*용도변경/.test(title) && !/주차장(?:을|의).*용도\s*변경/.test(query)) score *= 0.25;
      }
      // Route a community facility action to its own administrative regime.
      // These are subject/exception anchors, not answers to individual cases.
      const housing = /아파트|공동주택|단지|입주민|입주자|행위허가|행위신고/.test(query);
      if (housing && article.lawName.startsWith("공동주택관리법")) {
        if (/행위허가|행위신고|허가.*신고.*기준/.test(article.title)) score += 100;
        if (/부품|교체|수선|복구|유지|보수/.test(query) && /경미한/.test(article.title)) score += 180;
        if (/설치|증설|변경/.test(query) && /별표/.test(article.title)) score += 100;
      }
      if (housing && !/건축허가|건축신고/.test(query) && /건축허가|건축신고|수수료/.test(article.title)) score *= 0.15;
      if (/가설|컨테이너/.test(query) && /가설건축물/.test(article.title)) score += 90;
      if (/휴게|경비원/.test(query) && article.lawName.includes("건축") && /휴게|근로환경/.test(article.text)) score += 35;
      return { article, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.article.text.length - b.article.text.length)
    .slice(0, limit)
    .map(({ article }) => article);
}
