import { listRegions, resolveRegion } from "@/lib/corpus";
import { useMatrix } from "@/lib/land/rules";
import type { LandZone } from "@/lib/land/types";
import { phaseHandler } from "@/lib/review/routes/handler";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// "이 땅에 지을 수 있는 용도": 별표 1 용도 29종 × 용도지역 별표(+ 용도지구 조례).
export const POST = phaseHandler<{ zone?: string; region?: string; districts?: LandZone[] }, unknown>("허용 용도 조회", async body => {
  if (!body.zone) throw new Error("용도지역이 필요합니다.");
  const region = body.region ? listRegions().find(r => r.key === body.region) || resolveRegion(body.region) : null;
  return useMatrix(body.zone, { region, districts: Array.isArray(body.districts) ? body.districts.slice(0, 20) : [] });
});
