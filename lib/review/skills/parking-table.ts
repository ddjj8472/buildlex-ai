// 「주차장법 시행령」 별표 1 (부설주차장 설치기준) — reference copy for when the
// corpus holds only the 별표 title and the live 법제처 API is unavailable.
// It is marked MEDIUM code confidence and always routed to reviewer VERIFY,
// because 별표 amendments and 조례 강화·완화(시행령 제6조②, 1/2 범위) apply.
// The live API text, when available, wins (see korea-building.ts).

export type ParkingRule = { use: RegExp; label: string; per?: number; note?: string };

export const PARKING_TABLE_LABEL = "「주차장법 시행령」 별표 1 (내장 기준표 — 법제처 원문 대조 필요)";

export const PARKING_RULES: ParkingRule[] = [
  { use: /위락/, label: "위락시설", per: 100 },
  { use: /문화\s*및\s*집회|종교|판매|운수|의료|운동시설|업무시설|방송국|장례/, label: "문화·집회, 종교, 판매, 운수, 의료, 운동, 업무시설 등", per: 150 },
  { use: /제[12]종\s*근린|근린생활|숙박/, label: "제1종·제2종 근린생활시설, 숙박시설", per: 200 },
  { use: /공동주택|아파트|연립|다세대|다가구|오피스텔/, label: "다가구주택·공동주택·오피스텔", note: "「주택건설기준 등에 관한 규정」 제27조제1항(세대·전용면적 기준)에 따름" },
  { use: /단독주택/, label: "단독주택", note: "시설면적 50㎡ 초과 150㎡ 이하 1대, 150㎡ 초과 시 1대 + (시설면적-150㎡)/100㎡" },
  { use: /수련|공장|발전/, label: "수련시설, 공장, 발전시설", per: 350 },
  { use: /창고/, label: "창고시설", per: 400 },
  { use: /기숙사/, label: "학생용 기숙사", per: 400 },
  { use: /.*/, label: "그 밖의 건축물", per: 300 },
];

/** 별표 1 비고: 산정 결과 소수점 이하 첫째 자리가 0.5 이상이면 1대로 본다. */
export const roundParking = (x: number) => (x - Math.floor(x) >= 0.5 ? Math.ceil(x) : Math.floor(x));

export function parkingRuleFor(use: string): ParkingRule {
  return PARKING_RULES.find(r => r.use.test(use)) || PARKING_RULES[PARKING_RULES.length - 1];
}
