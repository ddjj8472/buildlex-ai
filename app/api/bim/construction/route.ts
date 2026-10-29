import type { BimFacts } from "@/lib/bim/types";
import { reviewConstruction, type ConstructionInput, type Tri } from "@/lib/bim/construction";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { ProjectValues } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const TRI = new Set<Tri>(["yes", "no", "unknown"]);
const KEYS: (keyof ConstructionInput)[] = ["publicClient", "ownerBuild", "towerCrane", "piling", "drill"];

// 시공 단계 검토: measured model facts + a few planning answers → construction-stage duties.
export const POST = phaseHandler<{ facts?: BimFacts; values?: ProjectValues; input?: Record<string, unknown> }, unknown>("시공 단계 검토", async body => {
  if (!body.facts || body.facts.version !== 1) throw new Error("검토할 모델 정보가 없습니다. IFC 파일을 다시 불러오세요.");
  const input: ConstructionInput = {};
  for (const k of KEYS) { const v = body.input?.[k]; if (typeof v === "string" && TRI.has(v as Tri)) input[k] = v as Tri; }
  return reviewConstruction(body.facts, body.values || {}, input);
});
