import type { LawArticle } from "./law-api.ts";

// Stable pointers into the exact evidence shown to the model. Selecting a
// pointer avoids requiring the model to recopy long statutory sentences.
export function evidenceUnits(article: LawArticle): string[] {
  return article.text.slice(0, 6500).split(/\n+|(?<=[.!?])\s+(?=[가-힣])/)
    .map(s => s.trim()).filter(Boolean)
    .flatMap(s => {
      if (s.length <= 900) return [s];
      const units: string[] = [];
      for (let i = 0; i < s.length; i += 850) units.push(s.slice(i, i + 900));
      return units;
    });
}
