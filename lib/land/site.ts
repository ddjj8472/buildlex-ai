// Site (필지) → 건축개요 values used by the existing checks, and helpers shared by the rules.
import { listRegions, resolveRegion } from "../corpus.ts";
import type { FieldKey, FieldValue, ProjectValues } from "../review/types.ts";
import type { Region } from "../types.ts";
import type { LandZone, SiteInfo } from "./types.ts";
import { mainUseZone, roadSideWidth } from "./zones.ts";

export function siteRegion(site: SiteInfo | undefined, fallback?: string): Region | null {
  if (site?.region?.key) return listRegions().find(r => r.key === site.region!.key) || null;
  return resolveRegion(site?.address) || (fallback ? resolveRegion(fallback) : null);
}

/** The road the site fronts, from the 접합 도시계획시설 도로 or the 토지특성 도로접면. */
export function frontRoad(site: SiteInfo): { width?: number; text?: string; landlocked: boolean } {
  const roads = site.zones.filter(z => z.kind === "도시계획시설" && z.roadWidth && z.relation === "접합");
  if (roads.length) {
    const best = roads.slice().sort((a, b) => b.roadWidth![0] - a.roadWidth![0])[0];
    return { width: best.roadWidth![0], text: `${best.name} 접함(도시계획도로, 폭 하한 ${best.roadWidth![0]}m)`, landlocked: false };
  }
  const rs = roadSideWidth(site.roadSide);
  return { width: rs.min, text: rs.label ? `토지특성 도로접면: ${rs.label}` : undefined, landlocked: rs.landlocked };
}

/**
 * Values the site provides. Priority when merging (rules.ts): user edits > 토지이용계획(site) > IFC.
 * The official list wins over a model property for 용도지역·대지위치; 대지면적 from the 토지대장
 * is the legal area before deductions, so it is used only when the model has none.
 */
export function siteToValues(site: SiteInfo): ProjectValues {
  const v: ProjectValues = {};
  const src = site.source === "vworld" ? "토지이용계획(V-World)" : site.source === "ifc" ? "IFC BuildLex_KR" : "대지 정보(직접 입력)";
  const put = (k: FieldKey, value: FieldValue["value"] | undefined, raw: string, unit?: string, confidence: FieldValue["confidence"] = "HIGH") => {
    if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) return;
    v[k] = { value, unit, raw, source: "land", confidence };
  };
  put("대지위치", site.address, src);
  const zone = mainUseZone(site.zones);
  put("용도지역", zone, `${src}: ${site.zones.filter(z => z.kind === "용도지역").map(z => z.name).join(", ")}`);
  const districts = site.zones.filter(z => z.kind === "용도지구").map(z => z.name);
  if (districts.length) put("용도지구", districts.join(", "), src);
  if (site.zones.some(z => z.kind === "지구단위계획") || site.plan) put("지구단위계획", true, `${src}: 지구단위계획구역`);
  if (site.area) put("대지면적", site.area, `토지대장 면적${site.jibun ? ` (${site.jibun})` : ""}`, "㎡", "MEDIUM");
  const road = frontRoad(site);
  if (road.width) put("전면도로폭", road.width, road.text || src, "m", "MEDIUM");
  return v;
}

export const zonesOf = (site: SiteInfo | undefined, kind: LandZone["kind"]) => (site?.zones || []).filter(z => z.kind === kind && z.relation !== "접합");
