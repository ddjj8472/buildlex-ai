import { listRegions, resolveRegion } from "@/lib/corpus";
import { landRules } from "@/lib/land/rules";
import { siteRegion, siteToValues } from "@/lib/land/site";
import type { SiteInfo } from "@/lib/land/types";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { FieldKey, FieldValue, ProjectValues } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// 대지 사전검토 (모델 없이): 토지이용계획 + 주용도 → 입지·용도 규칙.
export const POST = phaseHandler<{ site?: SiteInfo; values?: ProjectValues; region?: string }, unknown>("대지 사전검토", async body => {
  if (!body.site || !Array.isArray(body.site.zones)) throw new Error("대지 정보가 필요합니다.");
  const values: ProjectValues = { ...siteToValues(body.site) };
  for (const [k, v] of Object.entries(body.values || {}) as [FieldKey, FieldValue][]) if (v && v.value !== "" && v.value !== undefined) values[k] = { ...v, source: "user", confidence: "HIGH" };
  const region = body.region ? listRegions().find(r => r.key === body.region) || resolveRegion(body.region) : siteRegion(body.site);
  return { region: region ? { key: region.key, label: region.label } : undefined, values, rules: await landRules({ site: body.site, values, region }) };
});
