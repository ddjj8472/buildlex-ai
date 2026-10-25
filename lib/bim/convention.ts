// BuildLex_KR — the Korean regulatory property set for IFC models.
//
// Singapore's CORENET X adds country-specific data to IFC (IFC-SG) so an automated
// model checker can apply local codes. BuildLex_KR is the same idea at student-project
// scale: a handful of properties a Revit user fills once (shared parameters, exported
// with a user-defined property set mapping), plus fallbacks that read what Revit
// already exports (room names, Pset_*Common). This file is the single source of truth:
// the reader, the rules, the Revit shared-parameter file, the IFC export mapping and
// the IDS file (public/bim/*) are all generated from it.
import type { SpaceUse } from "./types.ts";

export const PSET = "BuildLex_KR";

export type KrDataType = "Text" | "Area" | "Length" | "Boolean" | "Integer";
export type KrProp = { name: string; aliases: string[]; type: KrDataType; on: ("IfcSite" | "IfcBuilding" | "IfcBuildingStorey" | "IfcSpace" | "IfcDoor" | "IfcRailing" | "IfcBuildingElementProxy")[]; desc: string; values?: string[]; required?: boolean };

export const SPACE_USES: SpaceUse[] = ["거실", "복도", "계단실", "화장실", "주차", "설비", "창고", "발코니", "홀", "승강기", "조경", "기타"];

export const KR_PROPS: KrProp[] = [
  { name: "대지위치", aliases: ["SiteAddress"], type: "Text", on: ["IfcSite"], desc: "지번 주소(시·군·구까지 있으면 조례 자동 적용)", required: true },
  { name: "용도지역", aliases: ["ZoningDistrict"], type: "Text", on: ["IfcSite"], desc: "국토계획법 용도지역, 예: 제2종일반주거지역", required: true },
  { name: "용도지구", aliases: ["ZoningOverlay"], type: "Text", on: ["IfcSite"], desc: "용도지구(있는 경우)" },
  { name: "대지면적", aliases: ["SiteArea"], type: "Area", on: ["IfcSite"], desc: "대지면적(㎡). 없으면 대지경계선(IfcSite FootPrint)으로 계산", required: true },
  { name: "전면도로폭", aliases: ["RoadWidth"], type: "Length", on: ["IfcSite"], desc: "대지가 접한 도로의 너비" },
  { name: "접도길이", aliases: ["RoadFrontage"], type: "Length", on: ["IfcSite"], desc: "대지가 도로에 접한 길이" },
  { name: "지구단위계획", aliases: ["DistrictUnitPlan"], type: "Boolean", on: ["IfcSite"], desc: "지구단위계획구역·택지지구 여부" },
  { name: "주용도", aliases: ["MainUse"], type: "Text", on: ["IfcBuilding"], desc: "건축법 시행령 별표 1 용도, 예: 공동주택(아파트), 제2종 근린생활시설", required: true },
  { name: "세대수", aliases: ["Households"], type: "Integer", on: ["IfcBuilding"], desc: "공동주택 세대수" },
  { name: "주요구조부내화", aliases: ["FireResistiveStructure"], type: "Boolean", on: ["IfcBuilding"], desc: "주요구조부가 내화구조 또는 불연재료인지(직통계단 보행거리 30m→50m)" },
  { name: "사업계획승인대상", aliases: ["HousingPlanApproval"], type: "Boolean", on: ["IfcBuilding"], desc: "주택법 사업계획승인 대상(주택건설기준 등에 관한 규정 적용)" },
  { name: "구조", aliases: ["StructureType"], type: "Text", on: ["IfcBuilding"], desc: "구조 형식, 예: 철근콘크리트조" },
  { name: "지표면표고", aliases: ["GroundLevel"], type: "Length", on: ["IfcBuilding"], desc: "높이 산정 기준 지표면(없으면 1층 바닥)" },
  { name: "피난층", aliases: ["EvacuationFloor"], type: "Boolean", on: ["IfcBuildingStorey"], desc: "직접 지상으로 통하는 출입구가 있는 층(없으면 지상 첫 층)" },
  { name: "층용도", aliases: ["StoreyUse"], type: "Text", on: ["IfcBuildingStorey"], desc: "층별 용도가 주용도와 다를 때(복합용도)" },
  { name: "실용도", aliases: ["SpaceUse"], type: "Text", on: ["IfcSpace", "IfcBuildingElementProxy"], desc: "실 분류(없으면 실 이름으로 추정)", values: [...SPACE_USES, "주차구획"], required: true },
  { name: "세대번호", aliases: ["UnitNumber"], type: "Text", on: ["IfcSpace"], desc: "공동주택 세대 번호(층별 세대수 산정)" },
  { name: "용적률제외", aliases: ["ExcludeFromFAR"], type: "Boolean", on: ["IfcSpace"], desc: "용적률 산정에서 제외하는 면적(지상 주차 등)" },
  { name: "주출입구", aliases: ["MainEntrance"], type: "Boolean", on: ["IfcDoor"], desc: "건축물 주출입구" },
  { name: "유효폭", aliases: ["ClearWidth"], type: "Length", on: ["IfcDoor"], desc: "출입문 통과 유효폭(없으면 문 폭 − 문틀 추정)" },
  { name: "난간위치", aliases: ["GuardLocation"], type: "Text", on: ["IfcRailing"], desc: "계단 / 옥상 / 노대 / 실내", values: ["계단", "옥상", "노대", "실내"] },
  { name: "주차형식", aliases: ["ParkingType"], type: "Text", on: ["IfcBuildingElementProxy"], desc: "주차구획 형식", values: ["일반형", "확장형", "장애인전용", "경형", "평행주차"] },
];

/** Look up a BuildLex_KR value by Korean name or English alias. */
export function krValue(props: Record<string, string | number | boolean>, name: string): string | number | boolean | undefined {
  const def = KR_PROPS.find(p => p.name === name);
  for (const key of [name, ...(def?.aliases || [])]) {
    const v = props[`${PSET}.${key}`];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

export const asBool = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") { if (/^(true|t|yes|y|예|1|있음|해당)$/i.test(v.trim())) return true; if (/^(false|f|no|n|아니오|0|없음|미해당)$/i.test(v.trim())) return false; }
  if (typeof v === "number") return v !== 0;
  return undefined;
};

/**
 * Space classification from the room name when 실용도 is not set.
 * Revit exports the room *number* as IfcSpace.Name and the room *name* as LongName.
 */
const USE_RULES: [SpaceUse, RegExp][] = [
  ["계단실", /계단|stair/i],
  ["승강기", /승강기|엘리베이터|elev|lift/i],
  ["복도", /복도|통로|corridor|hallway|passage/i],
  ["홀", /홀|로비|전실|부속실|현관|lobby|hall|vestibule|entrance/i],
  ["화장실", /화장실|욕실|샤워|탈의|toilet|wc|restroom|bath|lavatory/i],
  ["주차", /주차|차고|parking|garage/i],
  ["설비", /기계실|전기실|설비|발전기|펌프|\beps\b|\btps\b|피트|\bpit\b|덕트|샤프트|shaft|mechanical|electrical|ps실/i],
  ["창고", /창고|수납|드레스|팬트리|다용도|storage|closet/i],
  ["발코니", /발코니|노대|테라스|베란다|balcony|terrace|veranda/i],
  ["조경", /조경|정원|식재|landscape|garden/i],
  ["거실", /거실|침실|방|안방|서재|사무|회의|교실|병실|객실|주방|식당|라운지|매장|점포|상가|근린|세대|학원|열람|강의|진료|작업|living|bed|office|room|kitchen|dining|class|shop|store|unit|studio/i],
];

export function classifySpace(name: string, longName?: string, prop?: string): { use: SpaceUse; source: "property" | "name" | "default" } {
  if (prop) {
    const p = String(prop).trim();
    const hit = SPACE_USES.find(u => p === u) || (/주차/.test(p) ? "주차" : undefined) || USE_RULES.find(([, re]) => re.test(p))?.[0];
    if (hit) return { use: hit, source: "property" };
  }
  for (const text of [longName, name]) {
    if (!text) continue;
    const hit = USE_RULES.find(([, re]) => re.test(text));
    if (hit) return { use: hit[0], source: "name" };
  }
  // Unknown rooms are treated as 거실 — the conservative choice for egress and ceiling checks.
  return { use: "거실", source: "default" };
}

/** Building use categories that the rules branch on (건축법 시행령 별표 1). */
export type UseCategory = {
  apartment: boolean;   // 공동주택
  detached: boolean;    // 단독주택(다중·다가구 포함)
  multiHouse: boolean;  // 다중주택·다가구주택
  officetel: boolean;
  elementary: boolean;
  secondary: boolean;
  kindergarten: boolean;
  assembly: boolean;    // 문화 및 집회(공연장·집회장·관람장), 종교, 장례
  sales: boolean;       // 판매
  medical: boolean;
  lodging: boolean;
  academy: boolean;     // 학원·독서실
  factory: boolean;     // 공장·창고 등 (반자높이 적용 제외)
  label: string;
};

export function useCategory(use: string): UseCategory {
  const u = (use || "").replace(/\s/g, "");
  return {
    apartment: /공동주택|아파트|연립|다세대|기숙사|도시형생활주택/.test(u),
    detached: /단독주택|다중주택|다가구|공관/.test(u),
    multiHouse: /다중주택|다가구/.test(u),
    officetel: /오피스텔/.test(u),
    elementary: /초등학교/.test(u),
    secondary: /중학교|고등학교|중ㆍ고|중·고/.test(u),
    kindergarten: /유치원/.test(u),
    assembly: /공연장|집회장|관람장|문화및집회|종교|장례/.test(u),
    sales: /판매/.test(u),
    medical: /의료|병원|의원/.test(u),
    lodging: /숙박|호텔|객실/.test(u),
    academy: /학원|독서실/.test(u),
    factory: /공장|창고|위험물|동물및식물|자원순환|묘지/.test(u),
    label: use || "용도 미상",
  };
}
