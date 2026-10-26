// 지구단위계획 결정조서·시행지침 → DistrictPlan, with an LLM doing the reading and code doing
// the checking. Research on LLM zoning extraction (NBER "AI Zoning", National Zoning Atlas,
// Urban Institute) finds high recall but confident errors, so every extracted value must
// carry a verbatim quote that is found in the source text and contains the number itself;
// anything else is dropped and left for the user to type.
import { generateJSON, hasLLM } from "../llm.ts";
import { squash } from "../review/skills/parse.ts";
import type { DistrictPlan } from "./types.ts";

type Raw = {
  name?: string; block?: string;
  uses?: { designated?: string[]; recommended?: string[]; allowed?: string[]; prohibited?: string[] };
  bcr?: number; far_base?: number; far_allowed?: number; far_max?: number;
  height_max_m?: number; floors_max?: number; floors_min?: number; setback_m?: number;
  evidence?: Record<string, string>;
};

const FIELDS = ["bcr", "far_base", "far_allowed", "far_max", "height_max_m", "floors_max", "floors_min", "setback_m"] as const;

export function planPrompt(text: string, block?: string): string {
  return `다음은 한국 지구단위계획 결정조서(또는 시행지침) 텍스트입니다. ${block ? `대상 획지/가구: "${block}". 이 획지에 적용되는 값만 고르세요.` : "여러 획지가 있으면 가장 일반적인(대표) 획지의 값을 고르고 block에 그 이름을 쓰세요."}
"건축물에 관한 계획"에서 아래 항목을 JSON으로 뽑으세요. 텍스트에 없는 값은 넣지 마세요(추측 금지).
각 숫자 항목마다 evidence에 그 숫자가 들어 있는 원문 구절을 글자 그대로(30~120자) 넣으세요.
{
  "name": "지구단위계획구역 명칭", "block": "획지·가구 번호",
  "uses": { "designated": ["지정용도"], "recommended": ["권장용도"], "allowed": ["허용용도"], "prohibited": ["불허용도"] },
  "bcr": 건폐율 상한(%), "far_base": 기준용적률(%), "far_allowed": 허용용적률(%), "far_max": 상한용적률(%),
  "height_max_m": 최고높이(m), "floors_max": 최고층수, "floors_min": 최저층수, "setback_m": 건축한계선 후퇴거리(m),
  "evidence": { "bcr": "원문", "far_base": "원문", ... , "uses": "용도 원문" }
}
용도는 원문 표현 그대로(예: "제2종 근린생활시설 중 단란주점", "공동주택") 배열로 쓰세요.

텍스트:
"""
${text.slice(0, 60000)}
"""`;
}

const numIn = (quote: string, n: number) => {
  const q = quote.replace(/,/g, "");
  return new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}(?!\\d)`).test(q);
};

/** Keep only values whose quote is in the source text and contains the number. */
export function verifyPlan(raw: Raw, text: string): { plan: DistrictPlan; dropped: string[]; kept: string[] } {
  const src = squash(text);
  const ev = raw.evidence || {};
  const dropped: string[] = [], kept: string[] = [];
  const ok = (field: (typeof FIELDS)[number]) => {
    const v = raw[field];
    if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    const quote = ev[field] || "";
    if (quote && src.includes(squash(quote)) && numIn(quote, v)) { kept.push(field); return v; }
    dropped.push(field);
    return undefined;
  };
  const list = (xs: string[] | undefined, name: string) => {
    const out = (xs || []).map(s => String(s).trim()).filter(Boolean).filter(s => {
      const hit = src.includes(squash(s));
      if (!hit) dropped.push(`${name}:${s}`);
      return hit;
    });
    return out.length ? out : undefined;
  };
  const uses = raw.uses ? { designated: list(raw.uses.designated, "지정용도"), recommended: list(raw.uses.recommended, "권장용도"), allowed: list(raw.uses.allowed, "허용용도"), prohibited: list(raw.uses.prohibited, "불허용도") } : undefined;
  const far = { base: ok("far_base"), allowed: ok("far_allowed"), max: ok("far_max") };
  const height = { maxM: ok("height_max_m"), maxFloors: ok("floors_max"), minFloors: ok("floors_min") };
  const evidence: Record<string, string> = {};
  for (const k of kept) if (ev[k]) evidence[k] = ev[k];
  const plan: DistrictPlan = {
    name: raw.name && src.includes(squash(raw.name)) ? raw.name : undefined,
    block: raw.block || undefined,
    uses: uses && Object.values(uses).some(Boolean) ? uses : undefined,
    bcr: ok("bcr"),
    far: Object.values(far).some(x => x !== undefined) ? far : undefined,
    height: Object.values(height).some(x => x !== undefined) ? height : undefined,
    setback: ok("setback_m"),
    evidence,
    source: "ai",
  };
  return { plan, dropped, kept };
}

export async function extractPlan(text: string, block?: string): Promise<{ plan: DistrictPlan; dropped: string[]; kept: string[] }> {
  if (!hasLLM()) throw new Error("AI 키(GEMINI_API_KEY)가 없어 자동 추출을 할 수 없습니다. 값을 직접 입력하세요.");
  if (text.replace(/\s/g, "").length < 50) throw new Error("결정조서 텍스트가 너무 짧습니다.");
  const raw = await generateJSON<Raw>(planPrompt(text, block), { timeoutMs: 45000, maxTokens: 3000 });
  return verifyPlan(raw || {}, text);
}
