import type { BimFacts } from "@/lib/bim/types";
import { reviewConstruction, type ConstructionInput, type Tri } from "@/lib/bim/construction";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { ProjectValues } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const TRI = new Set<Tri>(["yes", "no", "unknown"]);
const TRI_KEYS = ["publicClient", "ownerBuild", "towerCrane", "piling", "drill", "gangForm", "noisyEquip"] as const;
const VALUE_KEYS = ["주용도", "구조", "용도지역", "세대수"] as const;

// 시공 단계 검토: measured model facts + a few planning answers → construction-stage duties.
export const POST = phaseHandler<{ facts?: BimFacts; values?: ProjectValues; input?: Record<string, unknown> }, unknown>("시공 단계 검토", async body => {
  if (!body.facts || body.facts.version !== 1) throw new Error("검토할 모델 정보가 없습니다. IFC 파일을 다시 불러오세요.");
  const raw = body.input || {};
  const input: ConstructionInput = {};
  for (const k of TRI_KEYS) { const v = raw[k]; if (typeof v === "string" && TRI.has(v as Tri)) input[k] = v as Tri; }
  const cost = Number(raw.costEok);
  if (Number.isFinite(cost) && cost > 0 && cost < 1e6) input.costEok = cost;
  if (typeof raw.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)) input.startDate = raw.startDate;
  const values: ProjectValues = {};
  for (const k of VALUE_KEYS) { const v = body.values?.[k]; if (v && (typeof v.value === "string" || typeof v.value === "number")) values[k] = v; }
  return reviewConstruction(body.facts, values, input);
});
