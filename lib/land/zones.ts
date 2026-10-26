// Classifying the designation names a 토지이용계획 lists (V-World getLandUseAttr returns
// them as free text: "제2종일반주거지역", "지구단위계획구역", "중로2류(폭 15m~20m)",
// "대공방어협조구역(위탁고도:77-257m)" …) and mapping 용도지역 to the 별표 that governs
// what may be built there. The 용도지역 → 별표 table is read from 국토계획법 시행령 제71조①
// in the corpus, not typed in.
import type { LandZone, ZoneKind, ZoneRelation } from "./types.ts";

export const squashName = (s: string) => s.normalize("NFKC").replace(/[\s·ㆍ‧]/g, "");

/** The 21 용도지역 that carry a 건축제한 별표 (시행령 제71조①). */
export const USE_ZONE_RE = /(제[123]종전용주거|제[123]종일반주거|준주거|중심상업|일반상업|근린상업|유통상업|전용공업|일반공업|준공업|보전녹지|생산녹지|자연녹지|보전관리|생산관리|계획관리|농림|자연환경보전)지역/;
/** Parent classes the API also lists (도시지역, 주거지역 …) — informative only. */
const ZONE_PARENT_RE = /^(도시|관리|주거|상업|공업|녹지|전용주거|일반주거)지역$/;
export const DISTRICT_RE = /(경관|고도|방화|방재|보호|취락|개발진흥|특정용도제한|복합용도|미관)지구/;
const AREA_RE = /(개발제한구역|도시자연공원구역|시가화조정구역|수산자원보호구역|도시혁신구역|복합용도구역|입체복합구역|입지규제최소구역)/;
const PLAN_RE = /지구단위계획/;
const FACILITY_RE = /^(광로|대로|중로|소로)\s*\d*\s*류|^(도로|공원|녹지|광장|주차장|학교|유원지|하천|철도)(\(|$|\s)|\(폭\s*[\d.]+\s*m/;

export function classifyZone(name: string): ZoneKind {
  const n = squashName(name);
  if (PLAN_RE.test(n)) return "지구단위계획";
  if (AREA_RE.test(n)) return "용도구역";
  if (USE_ZONE_RE.test(n) && !/지구|구역/.test(n.replace(USE_ZONE_RE, ""))) return "용도지역";
  if (ZONE_PARENT_RE.test(n)) return "용도지역";
  if (DISTRICT_RE.test(n) && !/구역|권역/.test(n)) return "용도지구";
  if (FACILITY_RE.test(name.trim())) return "도시계획시설";
  return "기타";
}

/** "고도지구(20m이하)", "최고고도지구 28m" → 20 / 28. Only for designations whose name is about height. */
export function heightFromName(name: string): number | undefined {
  if (!/고도지구|최고높이|높이제한/.test(name)) return undefined;
  const m = name.match(/(\d+(?:\.\d+)?)\s*(?:m|미터)(?!\s*[~\-])/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  return v > 0 && v < 1000 ? v : undefined;
}

/** "중로2류(폭 15m~20m)" → [15, 20]; "소로3류(폭 8m 미만)" → [0, 8]. */
export function roadWidthFromName(name: string): [number, number] | undefined {
  const r = name.match(/폭\s*([\d.]+)\s*m?\s*[~\-]\s*([\d.]+)\s*m/);
  if (r) return [Number(r[1]), Number(r[2])];
  const lt = name.match(/폭\s*([\d.]+)\s*m\s*미만/);
  if (lt) return [0, Number(lt[1])];
  const ge = name.match(/폭\s*([\d.]+)\s*m\s*이상/);
  if (ge) return [Number(ge[1]), Infinity];
  return undefined;
}

export function relationOf(v: unknown): ZoneRelation | undefined {
  const s = String(v ?? "").trim();
  if (s === "1" || /포함/.test(s)) return "포함";
  if (s === "2" || /저촉/.test(s)) return "저촉";
  if (s === "3" || /접합/.test(s)) return "접합";
  return undefined;
}

export function makeZone(name: string, source: LandZone["source"], extra: Partial<LandZone> = {}): LandZone {
  const clean = name.replace(/\s+/g, " ").trim();
  return { name: clean, kind: classifyZone(clean), height: heightFromName(clean), roadWidth: roadWidthFromName(clean), source, ...extra };
}

/** The 용도지역 that governs: a 포함 one first, then any; 21-zone names only. */
export function mainUseZone(zones: LandZone[]): string | undefined {
  const cands = zones.filter(z => z.kind === "용도지역" && USE_ZONE_RE.test(squashName(z.name)));
  const pick = cands.find(z => z.relation !== "저촉" && z.relation !== "접합") || cands[0];
  const m = pick ? squashName(pick.name).match(USE_ZONE_RE) : null;
  return m ? m[0] : undefined;
}

/** 토지특성 도로접면 → minimum road width implied (토지특성조사요령 구분). */
export function roadSideWidth(roadSide?: string): { min?: number; landlocked: boolean; label?: string } {
  if (!roadSide) return { landlocked: false };
  const s = roadSide.replace(/\s/g, "");
  if (/맹지/.test(s)) return { landlocked: true, label: "맹지(도로에 접하지 않음)" };
  if (/광대/.test(s)) return { min: 25, landlocked: false, label: "광대로(25m 이상)" };
  if (/중로/.test(s)) return { min: 12, landlocked: false, label: "중로(12m 이상 25m 미만)" };
  if (/소로/.test(s)) return { min: 8, landlocked: false, label: "소로(8m 이상 12m 미만)" };
  if (/세로\(?가|세각\(?가/.test(s)) return { min: undefined, landlocked: false, label: "세로(자동차 통행 가능, 8m 미만)" };
  if (/세로\(?불|세각\(?불/.test(s)) return { min: undefined, landlocked: false, label: "세로(자동차 통행 불가)" };
  return { landlocked: false, label: roadSide };
}

export type ZoneAppendix = { zone: string; appendix: string; mode: "allow" | "deny"; line: string };

/** 시행령 제71조① "1. 제1종전용주거지역안에서 건축할 수 있는 건축물 : 별표 2에 규정된 건축물". */
export function zoneAppendices(article71: string): ZoneAppendix[] {
  const out: ZoneAppendix[] = [];
  for (const raw of article71.split("\n")) {
    const m = raw.match(/^\s*\d+\.\s*(.+?지역)\s*안에서\s*건축할\s*수\s*(있는|없는)\s*건축물\s*[:：]\s*별표\s*(\d+(?:의\d+)?)/);
    if (m) out.push({ zone: squashName(m[1]), appendix: `별표${m[3]}`, mode: m[2] === "있는" ? "allow" : "deny", line: raw.trim() });
  }
  return out;
}
