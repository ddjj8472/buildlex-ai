// 대지·토지이용(입지) 검토 — shared types.
//
// A site (필지) carries every 지역·지구·구역 that applies to it, the way the official
// 토지이용계획확인서 (토지이음) lists them. Where the list comes from:
//   vworld  — 국토교통부 V-World Open API (연속지적도 + 토지이용계획 + 토지대장), server key
//   manual  — picked on the map (OSM) and typed in by the user
//   ifc     — BuildLex_KR properties in the IFC model
// The rules in lib/land/rules.ts turn it into checks next to the BIM rules.

export type ZoneKind = "용도지역" | "용도지구" | "용도구역" | "지구단위계획" | "도시계획시설" | "기타";
export type ZoneRelation = "포함" | "저촉" | "접합";

export type LandZone = {
  name: string;
  kind: ZoneKind;
  relation?: ZoneRelation;
  /** The API's own relation value when it was not recognised (shown so the user can judge). */
  relationRaw?: string;
  /** Law the designation is based on, as the API reports it (e.g. 「국토의 계획 및 이용에 관한 법률」). */
  law?: string;
  code?: string;
  /** Height in metres when the designation name carries one, e.g. 고도지구(20m이하). */
  height?: number;
  /** Planned road width range from 도시계획시설 names, e.g. 중로2류(폭 15m~20m). */
  roadWidth?: [number, number];
  source: "vworld" | "manual" | "ifc";
};

/** 지구단위계획 "건축물에 관한 계획" for the block the site belongs to (결정조서 / 시행지침). */
export type DistrictPlan = {
  name?: string;
  block?: string;
  uses?: { designated?: string[]; recommended?: string[]; allowed?: string[]; prohibited?: string[] };
  /** 건폐율 상한(%). */
  bcr?: number;
  /** 용적률(%) — 기준 / 허용 / 상한. */
  far?: { base?: number; allowed?: number; max?: number };
  /** Which 용적률 the project claims (incentives decide 허용·상한). Default: 허용, else 기준. */
  farApplied?: "base" | "allowed" | "max";
  height?: { maxM?: number; maxFloors?: number; minFloors?: number };
  /** 건축한계선 — 도로경계선 등으로부터 후퇴 거리(m). */
  setback?: number;
  notes?: string;
  /** field → verbatim quote from the source text (AI extraction keeps only verified quotes). */
  evidence?: Record<string, string>;
  source: "manual" | "ai";
};

export type SiteInfo = {
  source: "vworld" | "manual" | "ifc";
  pnu?: string;
  address?: string;
  jibun?: string;
  lon?: number;
  lat?: number;
  /** 토지대장 면적(㎡). */
  area?: number;
  /** 지목. */
  landCategory?: string;
  /** 토지특성 도로접면, e.g. 중로한면, 소로각지, 맹지. */
  roadSide?: string;
  /** Parcel outline rings in lon/lat. */
  parcel?: [number, number][][];
  zones: LandZone[];
  region?: { key: string; label: string };
  plan?: DistrictPlan;
  fetchedAt?: string;
  notes: string[];
};

export type LandConfig = { vworld: boolean; mapKey?: string; ai: boolean; lawApi: boolean };

/** One row of the "이 땅에 지을 수 있는 용도" table. */
export type UseVerdict = "허용" | "조례" | "조건" | "불허" | "확인";
/** `via`: set when a 용도지구 ordinance (not the zone's 별표) decided the verdict. */
export type UseRow = { no: string; name: string; verdict: UseVerdict; text?: string; by: string; via?: string };
export type UseMatrix = {
  zone: string;
  appendix?: { id: string; label: string; url?: string; mode: "allow" | "deny"; source: "corpus" | "live" | "none" };
  rows: UseRow[];
  notes: string[];
};
