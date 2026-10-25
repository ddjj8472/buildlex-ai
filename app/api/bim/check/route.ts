import type { BimFacts } from "@/lib/bim/types";
import { reviewBim } from "@/lib/bim/rules";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { ProjectValues } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// BIM 법규검토: measured model facts (from the browser worker) → rule results with element-level issues.
export const POST = phaseHandler<{ facts?: BimFacts; values?: ProjectValues; region?: string }, unknown>("BIM 법규검토", async body => {
  if (!body.facts || body.facts.version !== 1) throw new Error("검토할 모델 정보가 없습니다. IFC 파일을 다시 불러오세요.");
  return reviewBim({ facts: body.facts, values: body.values || {}, region: typeof body.region === "string" && body.region ? body.region : undefined });
});
