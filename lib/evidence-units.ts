import type { LawArticle } from "./law-api.ts";

// Stable pointers into the exact evidence shown to the model. Selecting a
// pointer avoids requiring the model to recopy long statutory sentences.
export function evidenceUnits(article: LawArticle): string[] {
  const lines = article.text.slice(0, 6500).split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const blocks: string[] = [];
  let block = "";
  for (const line of lines) {
    // Retain the parent paragraph with its numbered conditions. Detached
    // list items can otherwise be mistaken for a general permission.
    if (/^[①-⑳]|^제\s*\d+\s*조/.test(line) && block) { blocks.push(block); block = ""; }
    block += (block ? "\n" : "") + line;
  }
  if (block) blocks.push(block);
  return blocks.flatMap(s => {
      if (s.length <= 3000) return [s];
      const units: string[] = [];
      for (let i = 0; i < s.length; i += 2700) units.push(s.slice(i, i + 3000));
      return units;
    });
}
