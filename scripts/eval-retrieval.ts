// Retrieval evaluation on tests/gold.json: Recall@k and MRR of gold provisions.
import fs from "node:fs";
import { ruleAnalysis } from "../lib/analyze-rules.ts";
import { hybridSearch } from "../lib/search.ts";

type Item = { q: string; gold: string[] };
const file = process.argv.find(a => a.endsWith(".json")) || "tests/gold.json";
const items = JSON.parse(fs.readFileSync(file, "utf8")) as Item[];
const verbose = process.argv.includes("-v");

async function main() {
  let r1 = 0, r5 = 0, r10 = 0, mrr = 0;
  for (const it of items) {
    const a = ruleAnalysis(it.q);
    const { evidence } = await hybridSearch(a, { dense: process.env.DENSE === "1", limit: 10, maxExpansions: 4 });
    const ids = evidence.map(e => e.chunk.id);
    const rank = ids.findIndex(id => it.gold.includes(id));
    if (rank === 0) r1++;
    if (rank >= 0 && rank < 5) r5++;
    if (rank >= 0) r10++;
    if (rank >= 0) mrr += 1 / (rank + 1);
    if (verbose || rank < 0 || rank >= 5) console.log(`${rank < 0 ? "MISS" : "@" + (rank + 1)}\t${it.q}\n\t→ ${ids.slice(0, 5).join(" | ")}`);
  }
  const n = items.length;
  console.log(`\nN=${n}  R@1=${(r1 / n).toFixed(2)}  R@5=${(r5 / n).toFixed(2)}  R@all(≤14)=${(r10 / n).toFixed(2)}  MRR=${(mrr / n).toFixed(3)}`);
}
main();
