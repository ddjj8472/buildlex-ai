// Numeric standards for the BIM rules, parsed from the article text in the corpus —
// the same rule the plan review follows: thresholds come from the statute as it is
// in force today, never typed in from memory. Each parser returns the exact line it
// read so the citation quote can be shown and verified against the article.

const lines = (t: string) => t.split("\n").map(l => l.trim()).filter(Boolean);
const n = (s: string | undefined) => (s === undefined ? NaN : Number(s));

/** Paragraph ⓝ of an article (from its circled number to the next one). */
export function paragraph(text: string, mark: string): string {
  const marks = "①②③④⑤⑥⑦⑧⑨⑩";
  const i = text.indexOf(mark);
  if (i < 0) return "";
  const nextMark = marks[marks.indexOf(mark) + 1];
  const j = nextMark ? text.indexOf(nextMark, i + 1) : -1;
  return text.slice(i, j < 0 ? undefined : j);
}

/** 건축법 시행령 제34조① — 직통계단까지 보행거리. */
export function egressLimits(text: string): { base: number; fire: number; tallFloors: number; tall: number; line: string } | null {
  const line = lines(text).find(l => /보행거리가\s*\d+\s*미터/.test(l));
  if (!line) return null;
  const base = line.match(/보행거리가\s*(\d+)\s*미터\s*이하/);
  const fire = line.match(/보행거리가\s*(\d+)\s*미터\s*\(\s*층수가\s*(\d+)\s*층\s*이상인\s*공동주택의\s*경우[^)]*?(\d+)\s*미터\s*\)/);
  if (!base || !fire) return null;
  return { base: n(base[1]), fire: n(fire[1]), tallFloors: n(fire[2]), tall: n(fire[3]), line };
}

export type TwoStairItem = { no: number; area: number; altArea?: number; minFloor?: number; basement?: boolean; line: string };
/** 건축법 시행령 제34조② 각 호 — 직통계단 2개소 이상 대상. */
export function twoStairItems(text: string): TwoStairItem[] {
  const out: TwoStairItem[] = [];
  for (const l of lines(paragraph(text, "②"))) {
    const m = l.match(/^(\d+)\.\s/);
    if (!m) continue;
    const areas = [...l.matchAll(/(\d+)\s*제곱미터/g)].map(x => n(x[1]));
    const main = [...l.matchAll(/(\d+)\s*제곱미터\s*(?:\([^)]*\)\s*)?이상인\s*것/g)].pop();
    const alt = l.match(/각각\s*(\d+)\s*제곱미터/);
    const floor = l.match(/(\d+)\s*층\s*이상의\s*층/);
    if (!areas.length) continue;
    out.push({ no: n(m[1]), area: main ? n(main[1]) : areas[areas.length - 1], altArea: alt ? n(alt[1]) : undefined, minFloor: floor ? n(floor[1]) : undefined, basement: /지하층/.test(l.slice(0, 12)), line: l });
  }
  return out;
}

/** 피난·방화규칙 제15조① 1호(계단참), 2호(난간). */
export function stairBasics(text: string): { landingRise: number; landingWidth: number; landingLine: string; guardRise: number; guardLine: string } | null {
  const ls = lines(text);
  const landingLine = ls.find(l => /미터를\s*넘는\s*계단에는[^\n]*계단참/.test(l));
  const guardLine = ls.find(l => /미터를\s*넘는\s*계단\s*및\s*계단참의\s*양옆/.test(l));
  const lm = landingLine?.match(/높이가\s*([\d.]+)\s*미터를\s*넘는\s*계단에는[^\n]*?유효너비\s*(\d+)\s*센티미터/);
  const gm = guardLine?.match(/높이가\s*([\d.]+)\s*미터를\s*넘는/);
  if (!lm || !gm) return null;
  return { landingRise: n(lm[1]), landingWidth: n(lm[2]) / 100, landingLine: landingLine!, guardRise: n(gm[1]), guardLine: guardLine! };
}

export type StairWidthRules = {
  elementary?: { width: number; riser: number; tread: number; line: string };
  secondary?: { width: number; riser: number; tread: number; line: string };
  assembly?: { width: number; line: string };
  upper?: { area: number; width: number; line: string };
  basement?: { area: number; width: number; line: string };
  other?: { width: number; line: string };
};
/** 피난·방화규칙 제15조② — 계단·계단참 유효너비, 학교 계단 단높이·단너비. */
export function stairWidths(text: string): StairWidthRules {
  const p = lines(paragraph(text, "②"));
  const out: StairWidthRules = {};
  const cm = (l: string, re: RegExp) => { const m = l.match(re); return m ? n(m[1]) / 100 : NaN; };
  const school = (l: string) => ({ width: cm(l, /유효너비는\s*(\d+)\s*센티미터/), riser: cm(l, /단높이는\s*(\d+)\s*센티미터/), tread: cm(l, /단너비는\s*(\d+)\s*센티미터/), line: l });
  const four = p.findIndex(l => /^4\.\s/.test(l));
  for (const l of p) {
    if (/^1\.\s*초등학교/.test(l)) out.elementary = school(l);
    else if (/^2\.\s*중/.test(l)) out.secondary = school(l);
    else if (/^3\.\s*문화/.test(l)) out.assembly = { width: cm(l, /유효너비를\s*(\d+)\s*센티미터/), line: l };
    else if (/^5\.\s*기타/.test(l)) out.other = { width: cm(l, /유효너비를\s*(\d+)\s*센티미터/), line: l };
  }
  if (four >= 0) {
    const width = cm(p[four], /유효너비[는를]\s*(\d+)\s*센티미터/);
    const ga = p.slice(four + 1, four + 3).find(l => /^가\./.test(l));
    const na = p.slice(four + 1, four + 3).find(l => /^나\./.test(l));
    const area = (l?: string) => (l ? n(l.match(/(\d+)\s*제곱미터\s*이상/)?.[1]) : NaN);
    if (ga) out.upper = { area: area(ga), width, line: p[four] };
    if (na) out.basement = { area: area(na), width, line: p[four] };
  }
  return out;
}

/** 주택건설기준 등에 관한 규정 제16조 — 공동으로 사용하는 계단, 계단참. */
export function housingStair(text: string): { width: number; riser: number; tread: number; line: string; landingRise?: number; landingWidth?: number; landingLine?: string } | null {
  const ls = lines(text);
  const row = ls.find(l => /공동으로\s*사용하는\s*계단/.test(l));
  const nums = row ? [...row.matchAll(/(\d+)\s*(?:이상|이하)/g)].map(m => n(m[1])) : [];
  if (!row || nums.length < 3) return null;
  const ll = ls.find(l => /미터를\s*넘는\s*계단\(세대내계단을\s*제외한다\)/.test(l));
  const lm = ll?.match(/높이\s*([\d.]+)\s*미터를\s*넘는[^\n]*?([\d.]+)\s*미터[^\n]*?너비\s*(\d+)\s*센티미터/);
  return { width: nums[0] / 100, riser: nums[1] / 100, tread: nums[2] / 100, line: row, landingRise: lm ? n(lm[2]) : undefined, landingWidth: lm ? n(lm[3]) / 100 : undefined, landingLine: ll };
}

/** 피난·방화규칙 제15조의2① 표 — 복도 유효너비. */
export function corridorTable(text: string): { school?: [number, number]; housing?: [number, number]; large?: { area: number; both: number; other: number; medical?: number }; lines: string[] } {
  const ls = lines(text);
  const meters = (l: string) => [...l.matchAll(/([\d.]+)\s*미터\s*이상/g)].map(m => n(m[1]));
  const out: ReturnType<typeof corridorTable> = { lines: [] };
  const s = ls.find(l => /유치원/.test(l) && /미터/.test(l));
  if (s) { const m = meters(s); if (m.length >= 2) { out.school = [m[0], m[1]]; out.lines.push(s); } }
  const h = ls.find(l => /공동주택.?오피스텔/.test(l) && /미터/.test(l));
  if (h) { const m = meters(h); if (m.length >= 2) { out.housing = [m[0], m[1]]; out.lines.push(h); } }
  const i = ls.findIndex(l => /거실의\s*바닥면적/.test(l) && /미터/.test(l));
  if (i >= 0) {
    const m = meters(ls[i]);
    const next = ls[i + 1] || "";
    const area = next.match(/(\d+)\s*제곱미터/);
    const med = next.match(/복도\s*([\d.]+)\s*미터/);
    if (m.length >= 2 && area) { out.large = { area: n(area[1]), both: m[0], other: m[1], medical: med ? n(med[1]) : undefined }; out.lines.push(ls[i]); }
  }
  return out;
}

/** 피난·방화규칙 제16조 — 거실 반자높이. */
export function ceilingRule(text: string): { min: number; line: string; hall?: { area: number; min: number; line: string } } | null {
  const ls = lines(text);
  const l1 = ls.find(l => /^①/.test(l));
  const m1 = l1?.match(/높이를\s*([\d.]+)\s*미터\s*이상/);
  if (!m1) return null;
  const l2 = ls.find(l => /^②/.test(l));
  const m2 = l2?.match(/바닥면적이\s*(\d+)\s*제곱미터\s*이상인\s*것의\s*반자의\s*높이는[^\n]*?(\d+)\s*미터/);
  return { min: n(m1[1]), line: l1!, hall: m2 ? { area: n(m2[1]), min: n(m2[2]), line: l2! } : undefined };
}

/** 피난·방화규칙 제17조 — 채광(①)·환기(②) 창 면적 비율. */
export function windowRatios(text: string): { light: number; vent: number; lightLine: string; ventLine: string } | null {
  const ls = lines(text);
  const ll = ls.find(l => /^①/.test(l) && /채광/.test(l));
  const vl = ls.find(l => /^②/.test(l) && /환기/.test(l));
  const frac = (l?: string) => { const m = l?.match(/바닥면적의\s*(\d+)\s*분의\s*(\d+)\s*이상/); return m ? n(m[2]) / n(m[1]) : NaN; };
  if (!ll || !vl) return null;
  return { light: frac(ll), vent: frac(vl), lightLine: ll, ventLine: vl };
}

/** 건축법 시행령 제40조① — 옥상광장·노대 난간 높이. */
export function roofGuard(text: string): { height: number; line: string } | null {
  const l = lines(text).find(x => /^①/.test(x) && /난간/.test(x));
  const m = l?.match(/높이\s*([\d.]+)\s*미터\s*이상의\s*난간/);
  return m ? { height: n(m[1]), line: l! } : null;
}

/** 주택건설기준 등에 관한 규정 제18조②1 — 난간 높이(내부계단 완화). */
export function housingGuard(text: string): { height: number; interior: number; line: string } | null {
  const l = lines(text).find(x => /난간의\s*높이/.test(x));
  const m = l?.match(/(\d+)\s*센티미터\s*이상[^\n]*?(\d+)\s*센티미터\s*이상/);
  return m ? { height: n(m[1]) / 100, interior: n(m[2]) / 100, line: l! } : null;
}

export type StallKind = "일반형" | "확장형" | "장애인전용" | "경형" | "평행주차";
/** 주차장법 시행규칙 제3조① — 주차단위구획(평행주차 외 / 평행주차 일반형). */
export function parkingStalls(text: string): Partial<Record<StallKind, { width: number; length: number; line: string }>> {
  const out: Partial<Record<StallKind, { width: number; length: number; line: string }>> = {};
  const split = text.search(/2\.\s*평행주차형식\s*외의\s*경우/);
  if (split < 0) return out;
  const row = (seg: string, kind: string) => {
    const l = lines(seg).find(x => new RegExp(`│\\s*${kind}\\s*│`).test(x));
    const m = l?.match(/([\d.]+)\s*미터\s*이상\s*│\s*([\d.]+)\s*미터\s*이상/);
    return m ? { width: n(m[1]), length: n(m[2]), line: l! } : undefined;
  };
  const parallel = text.slice(0, split), other = text.slice(split);
  for (const k of ["일반형", "확장형", "장애인전용", "경형"] as const) { const r = row(other, k); if (r) out[k] = r; }
  const p = row(parallel, "일반형");
  if (p) out.평행주차 = p;
  return out;
}

/** 건축법 시행령 제48조① — 계단·복도 기준 적용 규모. */
export function corridorScope(text: string): { gfa: number; line: string } | null {
  const l = lines(text).find(x => /^①/.test(x));
  const m = l?.match(/연면적\s*(\d+)\s*제곱미터를\s*초과/);
  return m ? { gfa: n(m[1]), line: l! } : null;
}

/** 주택법 시행령 제27조① 2호 — 사업계획승인 대상 공동주택 세대수. */
export function housingApprovalUnits(text: string): { units: number; line: string } | null {
  const l = lines(text).find(x => /^2\.\s*공동주택\s*:/.test(x));
  const m = l?.match(/공동주택\s*:\s*(\d+)\s*세대/);
  return m ? { units: n(m[1]), line: l! } : null;
}
