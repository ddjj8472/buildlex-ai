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

export function tokenize(text: string): string[] {
  return [...new Set(
    text
      .replace(/[^0-9A-Za-z가-힣㎡%·ㆍ]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  )];
}

export function buildSearchPlan(query: string): SearchPlan {
  const matched = LAW_TOPICS.filter((topic) =>
    topic.triggers.some((trigger) => query.includes(trigger)),
  );
  const selected = matched.length ? matched : [LAW_TOPICS[0], LAW_TOPICS[5]];

  return {
    topics: selected.map((topic) => topic.label),
    laws: [...new Set([...CORE_LAWS, ...selected.flatMap((topic) => topic.laws)])].slice(0, 8),
    keywords: [...new Set([...tokenize(query), ...selected.flatMap((topic) => topic.keywords)])],
  };
}

function occurrenceScore(text: string, keyword: string): number {
  if (!text.includes(keyword)) return 0;
  if (text.startsWith(keyword) || text.includes(`(${keyword})`)) return 7;
  return keyword.length >= 4 ? 5 : 3;
}

export function rankArticles(
  articles: LawArticle[],
  query: string,
  keywords: string[],
  limit = 8,
): LawArticle[] {
  const queryTokens = tokenize(query);
  return articles
    .map((article) => {
      const haystack = `${article.title} ${article.text}`.replace(/\s+/g, " ");
      const score = queryTokens.reduce(
        (sum, token) => sum + occurrenceScore(haystack, token) * 2,
        0,
      ) + keywords.reduce((sum, keyword) => sum + occurrenceScore(haystack, keyword), 0);
      return { article, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.article.text.length - b.article.text.length)
    .slice(0, limit)
    .map(({ article }) => article);
}
