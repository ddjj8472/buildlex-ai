import type { LawArticle } from "./law-api.ts";
import { rankArticles } from "./search.ts";

const compact = (s: string) => s.replace(/\s|[ㆍ·]/g, "");
export function selectEvidence(articles: LawArticle[], query: string, keywords: string[], cases: LawArticle[] = []): LawArticle[] {
  const ranked = rankArticles(articles, query, keywords, 10);
  const selected = [...cases, ...ranked.slice(0, 6)];
  // Follow one hop of explicit citations within already fetched laws. The
  // referenced provision gets a slot even when its vocabulary differs.
  for (const article of ranked.slice(0, 3)) {
    const references = [...article.text.matchAll(/(?:「([^」]+)」\s*)?(?:같은\s*(?:법|영)\s*)?제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)];
    for (const ref of references) {
      const name = ref[1] || article.lawName;
      const prefix = `제${ref[2]}조${ref[3] ? `의${ref[3]}` : ""}`;
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
