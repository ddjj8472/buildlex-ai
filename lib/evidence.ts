import type { LawArticle } from "./law-api.ts";
import { rankArticles } from "./search.ts";

const compact = (s: string) => s.replace(/\s|[ㆍ·]/g, "");
export function selectEvidence(articles: LawArticle[], query: string, keywords: string[], cases: LawArticle[] = []): LawArticle[] {
  const ranked = rankArticles(articles, query, keywords, 10);
  // Explicit citations in the question and retrieved replies must not lose
  // their slots to provisions that merely repeat popular keywords.
  const citedContext = compact([query, ...cases.map(a => a.text)].join(" ").replace(/[「」]/g, ""));
  const direct = articles.filter(a => {
    const number = a.title.match(/^제\d+조(?:의\d+)?/)?.[0];
    return number && citedContext.includes(compact(a.lawName) + number);
  }).slice(0, 3);
  const selected = [...cases, ...direct];
  for (const article of ranked.slice(0, 6)) {
    if (!selected.some(a => a.lawName === article.lawName && a.title === article.title)) selected.push(article);
  }
  // Follow one hop of explicit citations within already fetched laws. The
  // referenced provision gets a slot even when its vocabulary differs.
  for (const article of ranked.slice(0, 3)) {
    const references = [...article.text.matchAll(/(?:(?:「([^」]+)」|(같은\s*법|같은\s*영|법|영))\s*)?제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)];
    for (const ref of references) {
      const base = article.lawName.replace(/\s*시행(?:령|규칙)$/, "");
      const marker = ref[2]?.replace(/\s/g, "");
      const name = ref[1] || (marker?.endsWith("영") ? `${base} 시행령` : marker?.endsWith("법") ? base : article.lawName);
      const prefix = `제${ref[3]}조${ref[4] ? `의${ref[4]}` : ""}`;
      const linked = articles.find(a => compact(a.lawName) === compact(name)
        && (compact(a.title) === prefix || compact(a.title).startsWith(prefix + "(")));
      if (linked && !selected.some(a => a.lawName === linked.lawName && a.title === linked.title)) selected.push(linked);
      if (selected.length >= 10) break;
    }
    if (selected.length >= 10) break;
  }
  for (const article of ranked) {
    if (selected.length >= 10) break;
    if (!selected.some(a => a.lawName === article.lawName && a.title === article.title)) selected.push(article);
  }
  return selected.slice(0, 10);
}
