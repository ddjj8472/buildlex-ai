import { siteRegion } from "@/lib/land/site";
import { lookupParcel, VworldError } from "@/lib/land/vworld";
import { phaseHandler } from "@/lib/review/routes/handler";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// 필지 조회: 지도 클릭(lon/lat) · PNU · 주소 → 필지 경계 + 토지이용계획(지역·지구·구역) + 토지대장.
export const POST = phaseHandler<{ lon?: number; lat?: number; pnu?: string; address?: string }, unknown>("필지 조회", async body => {
  const lon = Number(body.lon), lat = Number(body.lat);
  const where = {
    lon: Number.isFinite(lon) ? lon : undefined, lat: Number.isFinite(lat) ? lat : undefined,
    pnu: typeof body.pnu === "string" && /^\d{19}$/.test(body.pnu) ? body.pnu : undefined,
    address: typeof body.address === "string" && body.address.trim() ? body.address.trim().slice(0, 120) : undefined,
  };
  if (where.lon !== undefined && (where.lon < 124 || where.lon > 132 || where.lat! < 33 || where.lat! > 39)) throw new VworldError("대한민국 범위 밖의 좌표입니다.");
  if (where.lon === undefined && !where.pnu && !where.address) throw new VworldError("좌표, PNU 또는 주소가 필요합니다.");
  const site = await lookupParcel(where);
  const region = siteRegion(site);
  if (region) site.region = { key: region.key, label: region.label };
  else site.notes.push("주소에서 시·군·구 조례 지역을 찾지 못했습니다. 지역을 직접 고르세요.");
  return site;
});
