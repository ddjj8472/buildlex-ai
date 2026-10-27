import fs from "node:fs";
import { parseCitations, missingLaws } from "../../lib/cite.ts";
import { loadNational } from "../../lib/corpus.ts";
const nat = loadNational();
const keys = new Set([...nat.laws.keys()]);
const S = JSON.parse(fs.readFileSync(new URL("../../tests/minwon.json", import.meta.url), "utf8"));
let hit = 0, tot = 0;
for (const [i, x] of S.entries()) {
  const c = parseCitations(x.question, keys);
  const ids = c.map((z: any) => z.id).filter((id: string) => nat.byId.has(id) || id.includes("부칙"));
  const g = x.gold_title as string[];
  if (g.length) { tot++; if (g.some(a => ids.includes(a))) hit++; }
  if ([7, 30, 43, 45, 18, 20, 25].includes(i)) console.log(i, x.no, ids.slice(0, 8), c.filter((z: any) => z.paras.length || z.items.length).slice(0, 3).map((z: any) => `${z.id} p${z.paras} i${z.items}`), "missing:", missingLaws(x.question, keys));
}
console.log("gold cited in question & resolved:", hit, "/", tot);
