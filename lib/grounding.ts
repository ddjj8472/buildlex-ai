import type { LawArticle } from "./law-api.ts";
import { cleanAnswer } from "./answer-quality.ts";
import { evidenceUnits } from "./evidence-units.ts";

type Claim = { text: string; supports: Array<{ source: number; quote?: string; unit?: number }> };
type GroundedResult = { claims: Claim[]; missing: string[]; next: string[] };
const compact = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

export function renderGroundedAnswer(raw: string, evidence: LawArticle[]): string {
  const data = JSON.parse(raw) as GroundedResult;
  if (!Array.isArray(data.claims) || !data.claims.length || data.claims.length > 8
    || !Array.isArray(data.missing) || !Array.isArray(data.next)) throw new Error("답변 구조 검증 실패");
  const claims = data.claims.map((claim, index) => {
    if (typeof claim.text !== "string" || !claim.text.trim() || !Array.isArray(claim.supports) || !claim.supports.length) throw new Error("근거 없는 판단");
    const supports = claim.supports.map(s => {
      const article = evidence[s.source - 1];
      if (!Number.isInteger(s.source) || !article) throw new Error("원문에 없는 근거 번호");
      if (s.unit !== undefined) {
        const quote = evidenceUnits(article)[s.unit - 1];
        if (!Number.isInteger(s.unit) || !quote) throw new Error("원문에 없는 문구 번호");
        return {...s, quote};
      }
      return s;
    });
    for (const support of supports) {
      const article = evidence[support.source - 1];
      if (!Number.isInteger(support.source) || !article || typeof support.quote !== "string"
        || compact(support.quote).length < (support.unit !== undefined ? 1 : 12) || !compact(article.text.slice(0, 6500)).includes(compact(support.quote))) throw new Error(`원문에 없는 근거 문구 또는 인용 길이 부족 (판단 ${index+1}, 근거 ${support.source})`);
    }
    // Catch invented numerical thresholds. This is a limited check, not an
    // entailment proof: the prompt must still distinguish principle and scope.
    const quoted = supports.map(s => s.quote + " " + evidence[s.source - 1].title).join(" ");
    const numbers = Array.from(claim.text.matchAll(/\d+(?:\.\d+)?/g), m => m[0]);
    const quotedNumbers = Array.from(quoted.matchAll(/\d+(?:\.\d+)?/g), m => m[0]);
    if (numbers.some(n => !quotedNumbers.includes(n))) throw new Error(`근거에 없는 수치 (판단 ${index+1}: ${numbers.filter(n => !quotedNumbers.includes(n)).join(", ")})`);
    const onlyPastReply = claim.supports.every(s => evidence[s.source - 1].sourceType === "공식 질의회답");
    const qualifier = onlyPastReply && !/회신|회답|당시|사례/.test(claim.text) ? "공개된 유사 회신의 안내를 기준으로 보면, " : "";
    return qualifier + cleanAnswer(claim.text) + " " + [...new Set(claim.supports.map(s => `[근거 ${s.source}]`))].join(" ");
  });
  const items = (value: unknown[]) => value.slice(0, 3).map((s, i) => {
    if (typeof s !== "string") throw new Error("확인사항 형식 오류");
    return `${i + 1}. ${cleanAnswer(s)}`;
  }).join("\n");
  return ["현재 판단", claims[0], "", "적용 조건과 근거", ...claims.slice(1).map((s, i) => `${i+1}. ${s}`),
    "", "부족한 정보", items(data.missing) || "추가 조건이 제시되지 않았습니다.", "", "다음 확인사항", items(data.next)].join("\n");
}
