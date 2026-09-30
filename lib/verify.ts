// Deterministic citation verification ("환각 게이트").
//  - [n] markers must point to supplied evidence
//  - the answer must cite at least one piece of evidence
//  - article references in the text ("「건축법」 제11조", "같은 법 시행령 제14조")
//    must exist in the corpus; if they exist but were not retrieved, flag them
import { loadNational } from "./corpus.ts";
import { lawKeyOf } from "./text.ts";
import type { Evidence } from "./types.ts";

export type Verification = { ok: boolean; issues: string[]; cited: number[] };

export function verifyAnswer(answer: string, evidence: Evidence[]): Verification {
  const issues: string[] = [];
  const cited = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+(?:\s*[,，]\s*\d+)*)\]/g)) for (const n of m[1].split(/[,，]/)) cited.add(Number(n.trim()));
  const bad = [...cited].filter(n => n < 1 || n > evidence.length);
  if (bad.length) issues.push(`존재하지 않는 근거 번호 인용: ${bad.map(n => `[${n}]`).join(", ")}`);
  if (!cited.size && answer.trim()) issues.push("답변에 근거 번호가 없습니다.");

  const national = loadNational();
  const inEvidence = new Set(evidence.map(e => e.chunk.id));
  const evidenceLaws = new Set(evidence.map(e => e.chunk.lawKey));
  let lastLaw = "";
  const unknown: string[] = [];
  const outside: string[] = [];
  const unsure: string[] = [];
  const re = /「([^」]{2,60})」\s*(?:(시행령|시행규칙)\s*)?제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|같은\s*법\s*(시행령|시행규칙)?\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g;
  for (const m of answer.matchAll(re)) {
    let lawKey: string;
    let n: string, b: string | undefined;
    const inferred = !m[1];
    if (m[1]) {
      lawKey = lawKeyOf(m[1]) + (m[2] || "");
      lastLaw = lawKeyOf(m[1]).replace(/(시행령|시행규칙)$/, "");
      n = m[3]; b = m[4];
    } else {
      if (!lastLaw) continue;
      lawKey = lastLaw + (m[5] || "");
      n = m[6]; b = m[7];
    }
    const id = `${lawKey}#${Number(n)}${b ? `의${Number(b)}` : ""}`;
    const label = m[0].replace(/\s+/g, " ");
    if (!national.laws.has(lawKey)) {
      if (!evidenceLaws.has(lawKey)) continue; // outside corpus scope (e.g. 민법) — cannot verify
    }
    if (!national.byId.has(id) && !inEvidence.has(id)) (inferred ? unsure : unknown).push(label);
    else if (!inEvidence.has(id)) outside.push(label);
  }
  if (unknown.length) issues.push(`현행 조문에서 확인되지 않는 인용: ${[...new Set(unknown)].join(", ")}`);
  if (unsure.length) issues.push(`"같은 법" 인용 대상 확인 필요: ${[...new Set(unsure)].slice(0, 5).join(", ")}`);
  if (outside.length) issues.push(`검색 근거 밖 조문 언급(원문 확인 권장): ${[...new Set(outside)].slice(0, 5).join(", ")}`);
  const hard = bad.length > 0 || unknown.length > 0 || (!cited.size && !!answer.trim());
  return { ok: !hard, issues, cited: [...cited].sort((a, b) => a - b) };
}
