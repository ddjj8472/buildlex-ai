import fs from "node:fs";
import { parseCitations } from "/home/claude/buildlex-ai/lib/cite.ts";
import { loadNational } from "/home/claude/buildlex-ai/lib/corpus.ts";
import { hybridSearch } from "/home/claude/buildlex-ai/lib/search.ts";
import { ruleAnalysis } from "/home/claude/buildlex-ai/lib/analyze-rules.ts";
import { formatEvidence } from "/home/claude/buildlex-ai/lib/prompts.ts";
const nat = loadNational(); const keys = new Set([...nat.laws.keys()]);
const S = JSON.parse(fs.readFileSync("/home/claude/buildlex-ai/tests/minwon.json", "utf8"));
let a = 0, b = 0, t = 0, inText = 0;
for (const x of S) {
  const g = x.gold_title as string[]; if (!g.length) continue; t++;
  const an = ruleAnalysis(x.question);
  const r0 = await hybridSearch(an, { dense: false });
  const cited = parseCitations(x.question, keys);
  const r1 = await hybridSearch(an, { dense: false, cited });
  const h0 = g.some(id => r0.evidence.some(e => e.chunk.id === id));
  const h1 = g.some(id => r1.evidence.some(e => e.chunk.id === id));
  if (h0) a++; if (h1) b++;
  const ctx = formatEvidence(r1.evidence, 48000, x.question);
  if (!h1) console.log("MISS", x.no, g.join(","), "|", r1.evidence.slice(0,5).map(e=>e.chunk.id).join(" "));
}
console.log({ total: t, before: a, after: b });
