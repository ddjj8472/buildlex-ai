import { extractPlan } from "@/lib/land/plan-extract";
import { phaseHandler } from "@/lib/review/routes/handler";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// 지구단위계획 결정조서 텍스트 → 건축물에 관한 계획(원문 인용 대조 통과분만).
export const POST = phaseHandler<{ text?: string; block?: string }, unknown>("지구단위계획 추출", async body => {
  if (typeof body.text !== "string") throw new Error("결정조서 텍스트가 필요합니다.");
  return extractPlan(body.text, typeof body.block === "string" ? body.block.slice(0, 40) : undefined);
});
