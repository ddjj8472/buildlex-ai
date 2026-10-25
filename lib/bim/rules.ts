// BIM rule set "KR 건축법규 기본" — evaluates measured BimFacts against Korean statutes.
//
// Like Solibri, a rule is a parameterised template (계단 유효너비, 보행거리 …) applied to
// every matching component, producing element-level issues that the viewer can
// highlight and BCF can carry back to Revit. Unlike a hand-maintained rule file, every
// parameter is parsed from the article text in the corpus (law-parse.ts) and cited
// with the line it came from, so a law amendment changes the check on the next
// corpus build. Site-level checks (건폐율·용적률·조경·주차대수·접도) reuse the plan-review
// skills unchanged, fed with values measured from the model instead of read off sheets.
import { listRegions, loadNational, resolveRegion } from "../corpus.ts";
import { checkById } from "../review/checklists/index.ts";
import { cite, fmt, isResidentialForDaylight, num, str } from "../review/skills/common.ts";
import { evaluateDaylight, nationalCompliance } from "../review/skills/korea-building.ts";
import { cityCompliance, findOrdinance } from "../review/skills/local-ordinance.ts";
import { daylightRule } from "../review/skills/parse.ts";
import type { CheckStatus, Citation, ComplianceFile, Confidence, FieldKey, FieldValue, ProjectValues } from "../review/types.ts";
import { normZone, ZONE_RE } from "../review/utils/read-text.ts";
import { finalItems } from "../review/utils/session.ts";
import type { Chunk, Region } from "../types.ts";
import { asBool, useCategory, type UseCategory } from "./convention.ts";
import * as L from "./law-parse.ts";
import type { BimFacts, BimIssue, BimReviewResult, BimRuleResult, ElemRef, Severity, StoreyFact, Vec3 } from "./types.ts";

const chunk = (id: string): Chunk | undefined => loadNational().byId.get(id);
const cites = (...xs: [string, string?][]): Citation[] => xs.map(([id, q]) => { const c = chunk(id); return c ? cite(c, q) : null; }).filter((x): x is Citation => !!x);
const r2 = (x: number) => Math.round(x * 100) / 100;
const m = (x: number) => `${fmt(r2(x))}m`;

/** Classic plan-review checks re-used on model values (4A is replaced by the 3D 정북 rule). */
export const VALUE_CHECKS = ["2A", "2B", "3A", "3B", "3C", "4B"];

// ───────────────────────────── facts → 건축개요 values ─────────────────────────────

export function factsToValues(f: BimFacts): ProjectValues {
  const v: ProjectValues = {};
  const put = (k: FieldKey, value: FieldValue["value"] | undefined, raw: string, confidence: Confidence = "HIGH", unit?: string) => {
    if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) return;
    v[k] = { value, unit, raw, source: "bim", confidence };
  };
  const kr = f.kr;
  const s = (k: string) => (typeof kr[k] === "string" ? (kr[k] as string) : undefined);
  const n = (k: string) => (typeof kr[k] === "number" ? (kr[k] as number) : undefined);
  put("대지위치", s("대지위치"), "BuildLex_KR.대지위치");
  const zone = s("용도지역")?.match(ZONE_RE);
  put("용도지역", zone ? normZone(zone[1]) : s("용도지역"), "BuildLex_KR.용도지역");
  put("용도지구", s("용도지구"), "BuildLex_KR.용도지구");
  put("주용도", s("주용도"), "BuildLex_KR.주용도");
  put("세대수", n("세대수"), "BuildLex_KR.세대수", "HIGH", "세대");
  put("구조", s("구조"), "BuildLex_KR.구조");
  put("대지면적", f.site.area, f.site.areaSource === "property" ? "BuildLex_KR.대지면적" : "대지경계선(IfcSite FootPrint) 면적", f.site.areaSource === "property" ? "HIGH" : "MEDIUM", "㎡");
  const b = f.building;
  put("건축면적", b.footprint, `형상 측정: 외곽 ${fmt(b.footprintOuter)}㎡ → 외벽 중심선 환산(벽 두께 ${fmt(b.wallThickness)}m), ±${fmt(b.areaTolerance)}㎡`, "MEDIUM", "㎡");
  put("연면적", b.grossFloorArea, `층별 바닥면적 합계(${f.storeys.filter(x => x.floorArea > 0.5).length}개 층)`, "MEDIUM", "㎡");
  put("용적률산정용연면적", b.farFloorArea, `지상층 바닥면적 합계${b.farExcluded.length ? ` − 제외 ${b.farExcluded.map(x => `${x.label} ${fmt(x.area)}㎡`).join(", ")}` : ""}`, "MEDIUM", "㎡");
  put("지상층수", b.storeysAbove, "층(IfcBuildingStorey) 중 바닥면적이 있는 지상층", "HIGH", "층");
  put("지하층수", b.storeysBelow, "지하층(지표면 아래 평균 깊이 ≥ 층고 1/2)", "HIGH", "층");
  put("높이", b.height, `지표면부터 최상단(${b.heightRef?.name || "-"})까지`, "HIGH", "m");
  if (f.north.minLow) put("정북이격_10m이하", f.north.minLow.d, `높이 ${fmt(f.north.minLow.h)}m 지점(${f.north.minLow.ref.name})`, "HIGH", "m");
  if (f.north.minHigh) put("정북이격_10m초과", f.north.minHigh.d, `높이 ${fmt(f.north.minHigh.h)}m 지점(${f.north.minHigh.ref.name})`, "HIGH", "m");
  if (f.parking.length) put("주차대수", f.parking.length, `주차구획 요소 ${f.parking.length}개`, "HIGH", "대");
  put("조경면적", b.landscapeArea, `조경 요소 ${b.landscape.length}개의 수평투영면적`, "MEDIUM", "㎡");
  put("접도길이", n("접도길이"), "BuildLex_KR.접도길이", "HIGH", "m");
  put("전면도로폭", n("전면도로폭"), "BuildLex_KR.전면도로폭", "HIGH", "m");
  if (asBool(kr["지구단위계획"]) !== undefined) put("지구단위계획", asBool(kr["지구단위계획"]), "BuildLex_KR.지구단위계획");
  return v;
}

// ───────────────────────────── context ─────────────────────────────

type Ctx = {
  f: BimFacts;
  v: ProjectValues;
  region: Region | null;
  use: UseCategory;
  gfa: number;
  housing: { applies: boolean; note: string; citations: Citation[] };
  fire: { value: boolean | undefined; note?: string };
  floorNo: (s: StoreyFact) => number;
};

function context(f: BimFacts, v: ProjectValues, region: Region | null): Ctx {
  const use = useCategory(str(v, "주용도"));
  const units = num(v, "세대수");
  const approval = asBool(f.kr["사업계획승인대상"]);
  const h27 = chunk("주택법시행령#27");
  const ha = h27 ? L.housingApprovalUnits(h27.text) : null;
  let applies = false, note = "";
  if (use.apartment) {
    if (approval !== undefined) { applies = approval; note = `BuildLex_KR.사업계획승인대상 = ${approval ? "예" : "아니오"}`; }
    else if (units !== undefined && ha) { applies = units >= ha.units; note = `세대수 ${units}세대 ${applies ? "≥" : "<"} 사업계획승인 기준 ${ha.units}세대`; }
    else note = "세대수·사업계획승인 여부를 알 수 없어 주택건설기준 등에 관한 규정은 적용하지 않았습니다.";
  }
  const fireProp = asBool(f.kr["주요구조부내화"]);
  const fire = fireProp !== undefined ? { value: fireProp, note: `BuildLex_KR.주요구조부내화 = ${fireProp ? "예" : "아니오"}` }
    : /철근\s*콘크리트|철골\s*철근|RC|SRC/i.test(str(v, "구조")) ? { value: true, note: `구조(${str(v, "구조")})를 내화구조로 보았습니다(「피난·방화규칙」 제3조).` } : { value: undefined };
  const above = f.storeys.filter(s => s.above && s.floorArea > 0.5).sort((a, b) => a.elevation - b.elevation);
  return {
    f, v, region, use, gfa: num(v, "연면적") ?? f.building.grossFloorArea,
    housing: { applies, note, citations: applies && ha && h27 ? [cite(h27, ha.line)] : [] },
    fire,
    floorNo: s => above.findIndex(x => x.id === s.id) + 1,
  };
}

// ───────────────────────────── helpers ─────────────────────────────

type RuleBase = Pick<BimRuleResult, "check_id" | "title" | "section" | "requirement" | "code_confidence"> & Partial<BimRuleResult>;

function finish(b: RuleBase, issues: BimIssue[], checked: number): BimRuleResult {
  const status: CheckStatus = b.status ?? (issues.some(i => i.status === "FAIL") ? "FAIL" : issues.length || checked === 0 ? "UNCLEAR" : "PASS");
  return { citations: [], notes: [], source: "bim", ...b, status, issues, checked };
}

const notApplicable = (b: RuleBase, why: string): BimRuleResult => finish({ ...b, status: "NOT_APPLICABLE", notes: [why, ...(b.notes || [])] }, [], 0);

function issue(rule: string, n: number, status: BimIssue["status"], severity: Severity, title: string, detail: string, refs: ElemRef[], extra: Partial<BimIssue> = {}): BimIssue {
  return { id: `${rule}-${n}`, rule_id: rule, status, severity: status === "UNCLEAR" ? "minor" : severity, title, detail, refs, ...extra };
}

const storeyCenter = (f: BimFacts, s: StoreyFact): Vec3 => {
  const sp = f.spaces.filter(x => x.storeyId === s.id);
  if (!sp.length) return [0, 0, s.elevation];
  return [sp.reduce((a, x) => a + x.center[0], 0) / sp.length, sp.reduce((a, x) => a + x.center[1], 0) / sp.length, s.elevation];
};

// ───────────────────────────── rules ─────────────────────────────

function ruleNorth(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-NORTH", title: "정북방향 일조 이격(3D)", section: "높이·일조", requirement: "", code_confidence: "HIGH" };
  const zone = str(c.v, "용도지역");
  if (zone && !isResidentialForDaylight(zone)) return notApplicable({ ...b, requirement: "전용주거지역·일반주거지역에만 적용" }, `${zone}은 정북방향 일조 제한 대상이 아닙니다.`);
  const ord = c.region ? findOrdinance(c.region, "daylight") : null;
  const ordRule = ord ? daylightRule(ord.text) : null;
  const art = chunk("건축법시행령#86")!;
  const rule = ordRule || daylightRule(art.text);
  if (!rule) return finish({ ...b, notes: ["시행령 제86조 문구를 해석하지 못했습니다."] }, [], 0);
  const src = ordRule && ord ? ord : art;
  b.requirement = `정북방향 인접 대지경계선으로부터 높이 10m 이하 부분 ${rule.low}m 이상, 10m 초과 부분은 그 부분 높이의 ${rule.ratio === 0.5 ? "1/2" : rule.ratio} 이상`;
  b.citations = [cite(src, rule.lowLine), cite(src, rule.highLine), ...cites(["건축법#61"])];
  b.tier = ordRule ? 3 : 1;
  b.notes = [`건물 모든 정점에서 정북(${c.f.site.northSource === "model" ? "모델 TrueNorth" : "모델 +Y로 가정"}) 방향으로 대지경계선까지 거리를 계산했습니다.`, "도로·공원·하천 등에 접한 대지의 완화(시행령 제86조 단서)와 조례의 세부 예외는 반영하지 않았습니다."];
  if (!zone) b.notes.push("용도지역을 알 수 없어 전용·일반주거지역이라고 가정했습니다.");
  const n = c.f.north;
  b.params = { low: rule.low, ratio: rule.ratio, threshold: 10 };
  if (!n.available) {
    // No site boundary in the model: fall back to entered setbacks (건축개요 tab), as the plan review does.
    const low = num(c.v, "정북이격_10m이하"), high = num(c.v, "정북이격_10m초과");
    if (low !== undefined || high !== undefined) {
      const it = evaluateDaylight(checkById("4A")!, rule, { h: num(c.v, "높이"), low, high, zone: zone || "" }, b.citations!, b.tier as 1 | 3);
      const iss = it.status === "FAIL" ? [issue("B-NORTH", 1, "FAIL", "major", "정북 이격 부족(입력값)", it.notes.join(" "), [])] : [];
      return finish({ ...b, status: it.status, provided: it.provided, notes: [...b.notes!, "모델에 대지경계선이 없어 입력한 정북 이격거리로 판정했습니다."] }, iss, 1);
    }
    return finish({ ...b, notes: [...b.notes!, n.reason || "대지경계선 정보가 없습니다.", "대지경계선을 IfcSite 형상(또는 '대지경계' 요소)으로 내보내거나, 건축개요에 정북 이격거리를 입력하세요."] }, [], 0);
  }
  const worst = new Map<number, { d: number; h: number; req: number; at: Vec3; ref: ElemRef }>();
  for (const p of [...n.frontier, ...(n.perElement || [])]) {
    const req = p.h <= 10 + 1e-6 ? rule.low : p.h * rule.ratio;
    if (p.d + 1e-3 >= req) continue;
    const cur = worst.get(p.ref.id);
    if (!cur || req - p.d > cur.req - cur.d) worst.set(p.ref.id, { d: p.d, h: p.h, req, at: p.at, ref: p.ref });
  }
  const issues = [...worst.values()].sort((a, b2) => (b2.req - b2.d) - (a.req - a.d)).slice(0, 12).map((w, i) => issue("B-NORTH", i + 1, zone ? "FAIL" : "UNCLEAR", "major", `${w.ref.name}: 정북 이격 부족`, `높이 ${m(w.h)} 지점이 정북 대지경계선에서 ${m(w.d)} 떨어져 있습니다. 필요 이격 ${m(w.req)}.`, [w.ref], { at: w.at, storey: w.ref.storey, measured: m(w.d), required: `${m(w.req)} 이상` }));
  b.provided = { value: n.minHigh?.d ?? n.minLow?.d ?? 0, unit: "m", text: `10m 이하 최소 ${n.minLow ? `${m(n.minLow.d)}(높이 ${m(n.minLow.h)})` : "-"} / 10m 초과 최소 ${n.minHigh ? `${m(n.minHigh.d)}(높이 ${m(n.minHigh.h)})` : "-"}` };
  return finish(b, issues, n.frontier.length);
}

function ruleEgressDistance(c: Ctx): BimRuleResult {
  const art = chunk("건축법시행령#34")!;
  const lim = L.egressLimits(art.text);
  const b: RuleBase = { check_id: "B-EGRESS-DIST", title: "직통계단까지 보행거리", section: "피난·계단", requirement: "", code_confidence: "HIGH" };
  if (!lim) return finish({ ...b, notes: ["시행령 제34조 기준을 해석하지 못했습니다."] }, [], 0);
  const tallApt = c.use.apartment && c.f.building.storeysAbove >= lim.tallFloors;
  b.requirement = `피난층 외의 층: 거실 각 부분에서 가장 가까운 직통계단까지 ${lim.base}m 이하(주요구조부 내화구조·불연재료 ${lim.fire}m${tallApt ? `, ${lim.tallFloors}층 이상 공동주택의 ${lim.tallFloors}층 이상 층 ${lim.tall}m` : ""})`;
  b.citations = [cite(art, lim.line)];
  b.notes = [c.fire.note || "주요구조부 내화 여부를 알 수 없어 기본 기준을 적용했습니다(BuildLex_KR.주요구조부내화).", `보행거리는 층 평면을 ${fmt(c.f.egress[0]?.cell ?? 0.2)}m 격자로 나눠 벽·창을 피해 문을 지나는 최단 경로로 계산했습니다(바닥 위 1.1m 단면). 계단실 출입구에 닿는 지점까지 잰 값입니다.`];
  const issues: BimIssue[] = [];
  let checked = 0, worst = 0;
  for (const e of c.f.egress) {
    const s = c.f.storeys.find(x => x.id === e.storeyId)!;
    const limitFire = tallApt && c.floorNo(s) >= lim.tallFloors ? lim.tall : lim.fire;
    const limit = c.fire.value === true ? limitFire : lim.base;
    if (e.stairs === 0) { issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${e.storey}: 직통계단 없음`, `${e.storey}에 계단이 모델링되어 있지 않습니다.`, [], { at: storeyCenter(c.f, s), storey: e.storey })); continue; }
    for (const sp of e.spaces) {
      checked++;
      if (sp.maxDistance === null) { issues.push(issue(b.check_id, issues.length + 1, "UNCLEAR", "minor", `${sp.ref.name}: 계단까지 경로 없음`, `${e.storey} ${sp.ref.name}에서 계단까지 이어지는 경로를 찾지 못했습니다. 문이나 개구부가 빠졌는지 모델을 확인하세요.`, [sp.ref], { at: sp.at, storey: e.storey })); continue; }
      worst = Math.max(worst, sp.maxDistance);
      if (sp.maxDistance > limit + 0.05) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${e.storey} ${sp.ref.name}: 보행거리 초과`, `거실의 가장 먼 지점에서 직통계단까지 보행거리 ${m(sp.maxDistance)} > ${limit}m.`, [sp.ref], { at: sp.at, storey: e.storey, measured: m(sp.maxDistance), required: `${limit}m 이하` }));
      else if (c.fire.value === undefined && sp.maxDistance > lim.base + 0.05) issues.push(issue(b.check_id, issues.length + 1, "UNCLEAR", "minor", `${e.storey} ${sp.ref.name}: 내화구조 확인 필요`, `보행거리 ${m(sp.maxDistance)} — 주요구조부가 내화구조이면 ${limitFire}m 기준으로 적합합니다.`, [sp.ref], { at: sp.at, storey: e.storey, measured: m(sp.maxDistance), required: `${lim.base}m(내화 ${limitFire}m) 이하` }));
      if (sp.unreachable > 0 && sp.maxDistance !== null && sp.unreachable / Math.max(1, sp.cells) > 0.2) b.notes!.push(`${e.storey} ${sp.ref.name}의 일부(${Math.round((sp.unreachable / sp.cells) * 100)}%)는 경로가 닿지 않았습니다.`);
    }
  }
  b.params = { limit: c.fire.value === true ? lim.fire : lim.base, base: lim.base, fire: lim.fire };
  if (!c.f.egress.length) return finish({ ...b, notes: [...b.notes, "피난층 외의 층에 거실(IfcSpace)이 없어 보행거리를 계산하지 못했습니다."] }, [], 0);
  b.provided = { value: worst, unit: "m", text: `최대 보행거리 ${m(worst)} (${c.f.egress.length}개 층, 거실 ${checked}개)` };
  return finish(b, issues, checked);
}

function ruleTwoStairs(c: Ctx): BimRuleResult {
  const art = chunk("건축법시행령#34")!;
  const items = L.twoStairItems(art.text);
  const b: RuleBase = { check_id: "B-EGRESS-COUNT", title: "직통계단 2개소 이상", section: "피난·계단", requirement: "용도·층·거실 바닥면적에 따라 직통계단 2개소 이상(시행령 제34조②)", code_confidence: "HIGH" };
  const item = (no: number) => items.find(x => x.no === no);
  if (items.length < 5) return finish({ ...b, notes: ["시행령 제34조② 각 호를 해석하지 못했습니다."] }, [], 0);
  const issues: BimIssue[] = [];
  const used = new Set<number>();
  const notes: string[] = [];
  let checked = 0;
  for (const s of c.f.storeys) {
    if (s.evacuation || s.floorArea <= 0.5 || s.habitableArea <= 0) continue;
    const u = useCategory(s.use || str(c.v, "주용도"));
    const no = c.floorNo(s);
    let it = undefined as L.TwoStairItem | undefined, threshold = Infinity;
    const units = s.units || c.f.spaces.filter(x => x.storeyId === s.id && x.use === "거실").length;
    if (!s.above) { it = item(5); threshold = it!.area; }
    else if (u.assembly) { it = item(1); threshold = it!.area; }
    else if ((u.multiHouse || u.academy || u.sales || u.medical || u.lodging) && no >= (item(2)!.minFloor ?? 3)) { it = item(2); threshold = it!.area; }
    else if ((u.apartment && units > 4) || u.officetel) { it = item(3); threshold = it!.area; }
    else if (no >= (item(4)!.minFloor ?? 3)) { it = item(4); threshold = it!.area; }
    if (!it) continue;
    checked++;
    if (s.habitableArea + 1e-6 < threshold) continue;
    used.add(it.no);
    if (s.stairCount < 2) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${s.name}: 직통계단 ${s.stairCount}개소`, `${s.name} 거실 바닥면적 합계 ${fmt(s.habitableArea)}㎡ ≥ ${fmt(threshold)}㎡(제34조②${it.no}호) — 직통계단 2개소 이상이 필요합니다.`, [], { at: storeyCenter(c.f, s), storey: s.name, measured: `${s.stairCount}개소`, required: "2개소 이상" }));
    else notes.push(`${s.name}: 거실 ${fmt(s.habitableArea)}㎡, 직통계단 ${s.stairCount}개소`);
  }
  b.citations = [...used].map(no => cite(art, item(no)!.line));
  if (!used.size) return notApplicable({ ...b, citations: [cite(art, items[3].line)] }, `거실 바닥면적이 2개소 기준에 이르는 층이 없습니다(${c.f.storeys.filter(s => !s.evacuation && s.habitableArea > 0).map(s => `${s.name} ${fmt(s.habitableArea)}㎡`).join(", ") || "해당 층 없음"}).`);
  b.notes = [...notes, "같은 계단실 안의 경간은 1개소로 셉니다. 두 직통계단 사이 거리 기준(「피난·방화규칙」 제8조)은 검토하지 않았습니다."];
  return finish(b, issues, checked);
}

function scopeGate(c: Ctx, b: RuleBase): BimRuleResult | null {
  const a48 = chunk("건축법시행령#48")!;
  const sc = L.corridorScope(a48.text);
  if (sc && c.gfa <= sc.gfa) return notApplicable({ ...b, citations: [cite(a48, sc.line)] }, `연면적 ${fmt(c.gfa)}㎡ ≤ ${sc.gfa}㎡로 계단·복도 기준(시행령 제48조①) 적용 대상이 아닙니다.`);
  return null;
}

function stairRequiredWidth(c: Ctx, s: StoreyFact | undefined): { width: number; why: string; line?: string } {
  const a15 = chunk("건축물의피난방화구조등의기준에관한규칙#15")!;
  const w = L.stairWidths(a15.text);
  if (c.use.elementary && w.elementary) return { width: w.elementary.width, why: "초등학교 계단", line: w.elementary.line };
  if (c.use.secondary && w.secondary) return { width: w.secondary.width, why: "중·고등학교 계단", line: w.secondary.line };
  if ((c.use.assembly || c.use.sales) && w.assembly) return { width: w.assembly.width, why: "문화·집회·판매시설 계단", line: w.assembly.line };
  if (s && s.above && w.upper) {
    const up = c.f.storeys.filter(x => x.above && x.elevation > s.elevation + 0.1).reduce((a, x) => a + x.habitableArea, 0);
    if (up >= w.upper.area) return { width: w.upper.width, why: `바로 위층부터 최상층까지 거실 ${fmt(up)}㎡ ≥ ${w.upper.area}㎡`, line: w.upper.line };
    return { width: w.other?.width ?? 0.6, why: `위층 거실 ${fmt(up)}㎡ < ${w.upper.area}㎡`, line: w.other?.line };
  }
  if (s && !s.above && w.basement) {
    const bs = c.f.storeys.filter(x => !x.above).reduce((a, x) => a + x.habitableArea, 0);
    if (bs >= w.basement.area) return { width: w.basement.width, why: `지하층 거실 ${fmt(bs)}㎡ ≥ ${w.basement.area}㎡`, line: w.basement.line };
  }
  return { width: w.other?.width ?? 0.6, why: "그 밖의 계단", line: w.other?.line };
}

function ruleStairWidth(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-STAIR-WIDTH", title: "계단·계단참 유효너비", section: "피난·계단", requirement: "용도와 위층 거실 면적에 따라 계단 및 계단참 유효너비 0.6~1.5m 이상", code_confidence: "HIGH" };
  const gate = scopeGate(c, b);
  if (gate) return gate;
  if (!c.f.stairs.length) return finish({ ...b, notes: ["모델에 계단(IfcStairFlight)이 없습니다."] }, [], 0);
  const a15 = chunk("건축물의피난방화구조등의기준에관한규칙#15")!;
  const a16 = chunk("주택건설기준등에관한규정#16");
  const hs = c.housing.applies && a16 ? L.housingStair(a16.text) : null;
  const issues: BimIssue[] = [];
  const lines = new Set<string>();
  let checked = 0, minReq = Infinity, maxReq = 0;
  for (const st of c.f.stairs) {
    const s = c.f.storeys.find(x => x.id === st.storeyId);
    const r = stairRequiredWidth(c, s);
    let req = r.width, why = r.why;
    if (r.line) lines.add(r.line);
    if (hs && hs.width > req) { req = hs.width; why = `${why}; 주택건설기준 공동 계단 ${hs.width}m`; }
    minReq = Math.min(minReq, req); maxReq = Math.max(maxReq, req);
    for (const fl of st.flights) {
      checked++;
      if (fl.width + 0.005 < req) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${st.ref.storey || ""} ${fl.ref.name}: 유효너비 부족`.trim(), `계단 너비 ${m(fl.width)} < ${m(req)} (${why}).`, [fl.ref], { at: fl.center, storey: st.ref.storey, measured: m(fl.width), required: `${m(req)} 이상` }));
    }
    for (const ld of st.landings) {
      checked++;
      if (ld.depth + 0.005 < req) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${st.ref.storey || ""} ${ld.ref.name}: 계단참 너비 부족`.trim(), `계단참 유효너비 ${m(ld.depth)} < ${m(req)}.`, [ld.ref], { storey: st.ref.storey, measured: m(ld.depth), required: `${m(req)} 이상` }));
    }
  }
  b.requirement = minReq === maxReq ? `계단 및 계단참 유효너비 ${m(minReq)} 이상` : `계단 및 계단참 유효너비 ${m(minReq)}~${m(maxReq)} 이상(층별)`;
  b.citations = [...[...lines].map(l => cite(a15, l)), ...(hs && a16 ? [cite(a16, hs.line), ...c.housing.citations] : [])];
  b.notes = ["유효너비는 계단 경간 형상의 폭(진행 방향에 수직)으로 쟀습니다. 손잡이 돌출은 반영하지 않았습니다.", ...(c.housing.note ? [c.housing.note] : [])];
  const widths = c.f.stairs.flatMap(s => s.flights.map(f => f.width));
  b.provided = widths.length ? { value: Math.min(...widths), unit: "m", text: `최소 계단 너비 ${m(Math.min(...widths))}` } : undefined;
  return finish(b, issues, checked);
}

function ruleStairStep(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-STAIR-STEP", title: "계단 단높이·단너비", section: "피난·계단", requirement: "", code_confidence: "HIGH" };
  const a15 = chunk("건축물의피난방화구조등의기준에관한규칙#15")!;
  const w = L.stairWidths(a15.text);
  const a16 = chunk("주택건설기준등에관한규정#16");
  const hs = c.housing.applies && a16 ? L.housingStair(a16.text) : null;
  const limits: { riser: number; tread: number; label: string; cite: Citation }[] = [];
  if (c.use.elementary && w.elementary) limits.push({ riser: w.elementary.riser, tread: w.elementary.tread, label: "초등학교", cite: cite(a15, w.elementary.line) });
  if (c.use.secondary && w.secondary) limits.push({ riser: w.secondary.riser, tread: w.secondary.tread, label: "중·고등학교", cite: cite(a15, w.secondary.line) });
  if (hs && a16) limits.push({ riser: hs.riser, tread: hs.tread, label: "공동주택 공동 계단", cite: cite(a16, hs.line) });
  if (!limits.length) return notApplicable({ ...b, requirement: "학교·공동주택(주택건설기준 적용) 계단만 단높이·단너비 기준이 있음", citations: [cite(a15, w.other?.line || a15.text.split("\n")[0])] }, `${c.use.label}에는 「피난·방화규칙」상 단높이·단너비 기준이 없습니다.${c.housing.note ? ` ${c.housing.note}` : ""}`);
  const riserMax = Math.min(...limits.map(x => x.riser)), treadMin = Math.max(...limits.map(x => x.tread));
  b.requirement = `단높이 ${fmt(riserMax * 100)}cm 이하, 단너비 ${fmt(treadMin * 100)}cm 이상 (${limits.map(x => x.label).join(", ")})`;
  b.citations = [...limits.map(x => x.cite), ...c.housing.citations];
  const issues: BimIssue[] = [];
  let checked = 0;
  for (const st of c.f.stairs) for (const fl of st.flights) {
    checked++;
    if (fl.riser === undefined || fl.tread === undefined) { issues.push(issue(b.check_id, issues.length + 1, "UNCLEAR", "minor", `${fl.ref.name}: 단 치수 정보 없음`, "단높이·단너비 속성이 없고 형상으로도 추정하지 못했습니다.", [fl.ref], { at: fl.center, storey: st.ref.storey })); continue; }
    const bad: string[] = [];
    if (fl.riser > riserMax + 0.002) bad.push(`단높이 ${fmt(r2(fl.riser * 100))}cm > ${fmt(riserMax * 100)}cm`);
    if (fl.tread + 0.002 < treadMin) bad.push(`단너비 ${fmt(r2(fl.tread * 100))}cm < ${fmt(treadMin * 100)}cm`);
    if (bad.length) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${st.ref.storey || ""} ${fl.ref.name}: 단 치수 부적합`.trim(), bad.join(", ") + (fl.stepSource === "geometry" ? " (형상에서 추정)" : ""), [fl.ref], { at: fl.center, storey: st.ref.storey, measured: `${fmt(r2(fl.riser * 100))} / ${fmt(r2(fl.tread * 100))}cm`, required: `≤${fmt(riserMax * 100)} / ≥${fmt(treadMin * 100)}cm` }));
  }
  return finish(b, issues, checked);
}

function ruleLanding(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-STAIR-LANDING", title: "계단참 설치 간격·너비", section: "피난·계단", requirement: "", code_confidence: "HIGH" };
  const gate = scopeGate(c, b);
  const a15 = chunk("건축물의피난방화구조등의기준에관한규칙#15")!;
  const bs = L.stairBasics(a15.text);
  const a16 = chunk("주택건설기준등에관한규정#16");
  const hs = c.housing.applies && a16 ? L.housingStair(a16.text) : null;
  if (gate && !hs) return gate;
  if (!bs) return finish({ ...b, notes: ["「피난·방화규칙」 제15조①을 해석하지 못했습니다."] }, [], 0);
  const every = hs?.landingRise ? Math.min(bs.landingRise, hs.landingRise) : bs.landingRise;
  b.requirement = `높이 ${fmt(every)}m를 넘는 계단은 ${fmt(every)}m 이내마다 너비 ${m(Math.max(bs.landingWidth, hs?.landingWidth ?? 0))} 이상의 계단참`;
  b.citations = [cite(a15, bs.landingLine), ...(hs?.landingLine && a16 ? [cite(a16, hs.landingLine), ...c.housing.citations] : [])];
  b.notes = hs ? ["주택건설기준: 각 동 출입구 계단은 1층에 한정하여 2.5m 이내마다 계단참을 둘 수 있습니다(반영함)."] : [];
  const issues: BimIssue[] = [];
  let checked = 0;
  for (const st of c.f.stairs) {
    const s = c.f.storeys.find(x => x.id === st.storeyId);
    for (const fl of st.flights) {
      checked++;
      const housingLimit = hs?.landingRise !== undefined ? (s?.evacuation ? 2.5 : hs.landingRise) : Infinity;
      const limit = Math.min(gate ? Infinity : bs.landingRise, housingLimit);
      if (fl.rise > limit + 0.01) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${st.ref.storey || ""} ${fl.ref.name}: 계단참 없이 ${m(fl.rise)} 상승`.trim(), `한 경간이 계단참 없이 ${m(fl.rise)} 올라갑니다. ${fmt(limit)}m 이내마다 계단참이 필요합니다${limit < bs.landingRise ? "(주택건설기준)" : ""}.`, [fl.ref], { at: fl.center, storey: st.ref.storey, measured: m(fl.rise), required: `${fmt(limit)}m 이내마다 계단참` }));
    }
    for (const ld of st.landings) {
      checked++;
      const need = Math.max(bs.landingWidth, hs?.landingWidth ?? 0);
      if (ld.depth + 0.005 < need) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${ld.ref.name}: 계단참 너비 부족`, `계단참 너비 ${m(ld.depth)} < ${m(need)}.`, [ld.ref], { storey: st.ref.storey, measured: m(ld.depth), required: `${m(need)} 이상` }));
    }
  }
  if (!checked) return finish({ ...b, notes: [...b.notes, "모델에 계단이 없습니다."] }, [], 0);
  return finish(b, issues, checked);
}

function ruleGuardSides(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-STAIR-GUARD", title: "계단 양옆 난간", section: "피난·계단", requirement: "", code_confidence: "MEDIUM" };
  const gate = scopeGate(c, b);
  if (gate) return gate;
  const a15 = chunk("건축물의피난방화구조등의기준에관한규칙#15")!;
  const bs = L.stairBasics(a15.text);
  if (!bs) return finish({ ...b, notes: ["「피난·방화규칙」 제15조①2를 해석하지 못했습니다."] }, [], 0);
  b.requirement = `높이 ${fmt(bs.guardRise)}m를 넘는 계단 및 계단참의 양옆에 난간(벽 포함)`;
  b.citations = [cite(a15, bs.guardLine)];
  b.notes = ["경간 양옆 0.3m 안에 벽·난간·커튼월 요소가 있는지 평면에서 확인했습니다."];
  const issues: BimIssue[] = [];
  let checked = 0;
  for (const st of c.f.stairs) {
    const total = Math.max(...st.flights.map(f => f.zMax)) - Math.min(...st.flights.map(f => f.zMin));
    if (total <= bs.guardRise) continue;
    for (const fl of st.flights) {
      checked++;
      const missing = [!fl.guardLeft && "왼쪽", !fl.guardRight && "오른쪽"].filter(Boolean);
      if (missing.length) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${st.ref.storey || ""} ${fl.ref.name}: 난간 없음(${missing.join("·")})`.trim(), `오르는 방향 기준 ${missing.join("·")} 옆에 난간이나 벽이 없습니다.`, [fl.ref], { at: fl.center, storey: st.ref.storey }));
    }
  }
  if (!checked) return notApplicable(b, "대상 계단이 없습니다.");
  return finish(b, issues, checked);
}

function ruleCorridor(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-CORRIDOR", title: "복도 유효너비", section: "복도·실", requirement: "", code_confidence: "HIGH" };
  const gate = scopeGate(c, b);
  if (gate) return gate;
  const a = chunk("건축물의피난방화구조등의기준에관한규칙#15의2")!;
  const t = L.corridorTable(a.text);
  const corridors = c.f.spaces.filter(s => s.use === "복도");
  if (!corridors.length) return notApplicable({ ...b, requirement: "용도·거실 면적별 복도 유효너비" }, "복도로 분류된 실이 없습니다.");
  const issues: BimIssue[] = [];
  const used = new Set<string>();
  let checked = 0, minW = Infinity;
  for (const sp of corridors) {
    const s = c.f.storeys.find(x => x.id === sp.storeyId);
    let pair: [number, number] | undefined, label = "", line = "";
    if ((c.use.elementary || c.use.secondary || c.use.kindergarten) && t.school) { pair = t.school; label = "유치원·학교"; line = t.lines[0]; }
    else if ((c.use.apartment || c.use.officetel) && t.housing) { pair = t.housing; label = "공동주택·오피스텔"; line = t.lines.find(l => /공동주택/.test(l)) || ""; }
    else if (t.large && s && s.habitableArea >= t.large.area) { pair = [c.use.medical && t.large.medical ? t.large.medical : t.large.both, t.large.other]; label = `층 거실 ${fmt(s.habitableArea)}㎡ ≥ ${t.large.area}㎡`; line = t.lines[t.lines.length - 1]; }
    if (!pair) continue;
    checked++;
    used.add(line);
    const req = sp.bothSidesHabitable ? pair[0] : pair[1];
    minW = Math.min(minW, sp.minWidth);
    if (sp.minWidth + 0.01 < req) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${sp.ref.storey || ""} ${sp.ref.name}: 복도 너비 부족`.trim(), `복도 너비 ${m(sp.minWidth)} < ${m(req)} (${label}, ${sp.bothSidesHabitable ? "양옆에 거실" : "그 밖의 복도"}).`, [sp.ref], { at: sp.center, storey: sp.ref.storey, measured: m(sp.minWidth), required: `${m(req)} 이상` }));
  }
  if (!checked) return notApplicable({ ...b, requirement: "용도·거실 면적별 복도 유효너비" }, "복도 너비 기준이 적용되는 용도·규모가 아닙니다(학교·공동주택·오피스텔, 또는 층 거실 200㎡ 이상).");
  b.requirement = "양옆에 거실이 있는 복도/그 밖의 복도 유효너비(표)";
  b.citations = [...used].filter(Boolean).map(l => cite(a, l));
  b.notes = ["복도 너비는 같은 면적·둘레의 직사각형 폭으로 환산했습니다. '양옆에 거실'은 복도 양쪽 0.45m 바깥의 실 용도로 판단했습니다."];
  b.provided = { value: minW, unit: "m", text: `최소 복도 너비 ${m(minW)}` };
  return finish(b, issues, checked);
}

function ruleCeiling(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-CEILING", title: "거실 반자높이", section: "복도·실", requirement: "", code_confidence: "HIGH" };
  const a = chunk("건축물의피난방화구조등의기준에관한규칙#16")!;
  const cr = L.ceilingRule(a.text);
  if (c.use.factory) return notApplicable(b, "공장·창고 등은 거실 반자높이 기준(시행령 제50조) 적용 대상이 아닙니다.");
  if (!cr) return finish({ ...b, notes: ["제16조를 해석하지 못했습니다."] }, [], 0);
  b.requirement = `거실 반자높이 ${m(cr.min)} 이상${cr.hall && c.use.assembly ? `(관람실·집회실 ${cr.hall.area}㎡ 이상 ${cr.hall.min}m)` : ""}`;
  b.citations = [cite(a, cr.line), ...cites(["건축법시행령#50"]), ...(cr.hall && c.use.assembly ? [cite(a, cr.hall.line)] : [])];
  b.notes = ["실(IfcSpace) 높이를 반자높이로 보았습니다. Revit 룸의 상한을 천장 아래로 맞추거나 천장을 룸 경계로 두면 정확합니다."];
  const rooms = c.f.spaces.filter(s => s.use === "거실");
  const issues: BimIssue[] = [];
  for (const sp of rooms) {
    const need = cr.hall && c.use.assembly && sp.area >= cr.hall.area ? cr.hall.min : cr.min;
    if (sp.height + 0.005 < need) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "major", `${sp.ref.storey || ""} ${sp.ref.name}: 반자높이 ${m(sp.height)}`.trim(), `거실 반자높이 ${m(sp.height)} < ${m(need)}${sp.heightSource === "geometry" ? " (실 형상 높이)" : ""}.`, [sp.ref], { at: sp.center, storey: sp.ref.storey, measured: m(sp.height), required: `${m(need)} 이상` }));
  }
  if (!rooms.length) return finish({ ...b, notes: [...b.notes!, "거실로 분류된 실이 없습니다."] }, [], 0);
  b.provided = { value: Math.min(...rooms.map(r => r.height)), unit: "m", text: `최저 거실 높이 ${m(Math.min(...rooms.map(r => r.height)))}` };
  return finish(b, issues, rooms.length);
}

function ruleWindows(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-DAYLIGHT-WINDOW", title: "거실 채광·환기 창 면적", section: "채광·환기", requirement: "", code_confidence: "HIGH" };
  const a = chunk("건축물의피난방화구조등의기준에관한규칙#17")!;
  const wr = L.windowRatios(a.text);
  const a51 = chunk("건축법시행령#51")!;
  const scope = c.f.spaces.filter(s => s.use === "거실" && ((c.use.detached || c.use.apartment) || (c.use.elementary || c.use.secondary ? /교실/.test(s.label) : false) || (c.use.medical && /병실/.test(s.label)) || (c.use.lodging && /객실/.test(s.label))));
  if (!scope.length) return notApplicable({ ...b, requirement: "단독·공동주택 거실, 학교 교실, 병실, 숙박 객실", citations: [cite(a51, a51.text.split("\n")[0])] }, `${c.use.label}의 거실은 채광·환기 창 기준(시행령 제51조①) 대상이 아닙니다.`);
  if (!wr) return finish({ ...b, notes: ["제17조를 해석하지 못했습니다."] }, [], 0);
  b.requirement = `채광 창 면적 ≥ 거실 바닥면적 × ${fmt(wr.light)}, 환기 창 면적 ≥ × ${fmt(wr.vent)}`;
  b.citations = [cite(a51, a51.text.split("\n")[0]), cite(a, wr.lightLine), cite(a, wr.ventLine)];
  b.notes = ["창(IfcWindow)의 폭×높이를 창 양쪽 실에 산입했습니다. 환기는 여닫을 수 있는 부분만 인정되므로 창호 형식을 확인하세요.", "조명장치(별표 1의3)·기계환기장치를 설치하면 예외입니다."];
  const issues: BimIssue[] = [];
  for (const sp of scope) {
    const need = sp.area * wr.light;
    if (sp.windowArea + 0.005 < need) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "major", `${sp.ref.storey || ""} ${sp.ref.name}: 창 면적 부족`.trim(), `창 면적 ${fmt(r2(sp.windowArea))}㎡ < 바닥면적 ${fmt(sp.area)}㎡ × ${fmt(wr.light)} = ${fmt(r2(need))}㎡${sp.windowArea + 0.005 < sp.area * wr.vent ? " (환기 기준도 미달)" : ""}.`, [sp.ref, ...sp.windows], { at: sp.center, storey: sp.ref.storey, measured: `${fmt(r2(sp.windowArea))}㎡`, required: `${fmt(r2(need))}㎡ 이상` }));
  }
  return finish(b, issues, scope.length);
}

function ruleGuards(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-GUARD", title: "옥상·노대 난간 높이", section: "난간·출입구", requirement: "", code_confidence: "HIGH" };
  const a40 = chunk("건축법시행령#40")!;
  const rg = L.roofGuard(a40.text);
  const a18 = chunk("주택건설기준등에관한규정#18");
  const hg = c.housing.applies && a18 ? L.housingGuard(a18.text) : null;
  if (!rg) return finish({ ...b, notes: ["시행령 제40조를 해석하지 못했습니다."] }, [], 0);
  b.requirement = `옥상광장·2층 이상 노대 난간 높이 ${m(rg.height)} 이상${hg ? `, 주택 난간 ${m(hg.height)}(내부 계단 ${m(hg.interior)}) 이상` : ""}`;
  b.citations = [cite(a40, rg.line), ...(hg && a18 ? [cite(a18, hg.line), ...c.housing.citations] : [])];
  const issues: BimIssue[] = [];
  let checked = 0;
  for (const r of c.f.railings) {
    const s = c.f.storeys.find(x => x.name === r.ref.storey);
    let need: number | undefined, why = "";
    if (r.where === "옥상") { need = rg.height; why = "옥상"; }
    else if (r.where === "노대" && s && c.floorNo(s) >= 2) { need = rg.height; why = "2층 이상 노대"; }
    if (hg) {
      if (r.where === "계단") { need = Math.max(need ?? 0, hg.interior); why = why || "주택 내부 계단"; }
      else { need = Math.max(need ?? 0, hg.height); why = why || "주택 난간"; }
    }
    if (need === undefined) continue;
    checked++;
    if (r.height === undefined) { issues.push(issue(b.check_id, issues.length + 1, "UNCLEAR", "minor", `${r.ref.name}: 높이 정보 없음`, "난간 높이(Pset_RailingCommon.Height)가 없습니다.", [r.ref], { at: r.center, storey: r.ref.storey })); continue; }
    if (r.height + 0.005 < need) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "critical", `${r.ref.storey || ""} ${r.ref.name}: 난간 높이 ${m(r.height)}`.trim(), `${why} 난간 높이 ${m(r.height)} < ${m(need)}.`, [r.ref], { at: r.center, storey: r.ref.storey, measured: m(r.height), required: `${m(need)} 이상` }));
  }
  b.notes = ["난간 위치는 BuildLex_KR.난간위치가 있으면 그 값을, 없으면 계단·옥상·발코니와의 위치 관계로 판단했습니다."];
  if (!checked) return notApplicable(b, "옥상·노대 난간(또는 주택 난간)이 모델에 없습니다.");
  return finish(b, issues, checked);
}

function ruleDoors(c: Ctx): BimRuleResult {
  const REQ = 0.9;
  const ch = chunk("장애인노인임산부등의편의증진보장에관한법률시행규칙#별표1");
  const b: RuleBase = { check_id: "B-DOOR", title: "주출입구 통과 유효폭", section: "난간·출입구", requirement: `주출입구(문) 통과 유효폭 ${REQ}m 이상`, code_confidence: "MEDIUM" };
  b.citations = ch ? [{ id: ch.id, label: "「장애인·노인·임산부 등의 편의증진 보장에 관한 법률 시행규칙」 별표 1 (내장 기준값 — 원문 대조 필요)", quote: `출입구(문)의 통과유효폭은 ${REQ}미터 이상`, verified: false, sourceUrl: ch.sourceUrl }] : [];
  b.notes = ["편의법 시행규칙 별표 1 본문이 코퍼스에 없어 내장 기준값을 썼습니다. 편의시설 설치 대상 시설(시행령 별표 1)인지도 확인하세요.", "유효폭 속성(BuildLex_KR.유효폭)이 없으면 문 폭에서 문틀 0.1m를 뺀 값으로 추정했습니다."];
  const evac = new Set(c.f.storeys.filter(s => s.evacuation).map(s => s.name));
  let doors = c.f.doors.filter(d => d.main);
  if (!doors.length) doors = c.f.doors.filter(d => d.external && evac.has(d.ref.storey || ""));
  if (!doors.length) return finish({ ...b, notes: [...b.notes, "주출입구(BuildLex_KR.주출입구 또는 피난층 외부 문)를 찾지 못했습니다."] }, [], 0);
  const issues: BimIssue[] = [];
  for (const d of doors) {
    const clear = d.clearWidth ?? d.width - 0.1;
    if (d.width + 0.005 < REQ) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "major", `${d.ref.name}: 유효폭 부족`, `문 폭 ${m(d.width)}(문틀 포함)이 이미 ${m(REQ)}보다 좁습니다.`, [d.ref], { at: d.center, storey: d.ref.storey, measured: m(d.width), required: `${m(REQ)} 이상` }));
    else if (clear + 0.005 < REQ) issues.push(issue(b.check_id, issues.length + 1, "UNCLEAR", "minor", `${d.ref.name}: 유효폭 확인`, `문 폭 ${m(d.width)}, 추정 유효폭 ${m(clear)} — 문틀을 뺀 실제 통과폭을 확인하세요.`, [d.ref], { at: d.center, storey: d.ref.storey, measured: m(clear), required: `${m(REQ)} 이상` }));
  }
  return finish(b, issues, doors.length);
}

function ruleParking(c: Ctx): BimRuleResult {
  const b: RuleBase = { check_id: "B-PARKING-STALL", title: "주차단위구획 크기", section: "주차·조경", requirement: "", code_confidence: "HIGH" };
  const a = chunk("주차장법시행규칙#3")!;
  const t = L.parkingStalls(a.text);
  if (!c.f.parking.length) return notApplicable({ ...b, requirement: "주차구획 형식별 너비·길이" }, "주차구획 요소가 모델에 없습니다.");
  b.requirement = `일반형 ${t.일반형 ? `${t.일반형.width}×${t.일반형.length}m` : "-"}, 확장형 ${t.확장형 ? `${t.확장형.width}×${t.확장형.length}m` : "-"}, 장애인전용 ${t.장애인전용 ? `${t.장애인전용.width}×${t.장애인전용.length}m` : "-"} 이상`;
  const used = new Set<string>();
  const issues: BimIssue[] = [];
  for (const p of c.f.parking) {
    const req = t[p.kind];
    if (!req) continue;
    used.add(req.line);
    const bad = [p.width + 0.005 < req.width && `너비 ${m(p.width)} < ${m(req.width)}`, p.length + 0.005 < req.length && `길이 ${m(p.length)} < ${m(req.length)}`].filter(Boolean);
    if (bad.length) issues.push(issue(b.check_id, issues.length + 1, "FAIL", "major", `${p.ref.name}(${p.kind}): 구획 크기 부족`, bad.join(", ") + ".", [p.ref], { at: p.center, storey: p.ref.storey, measured: `${m(p.width)}×${m(p.length)}`, required: `${m(req.width)}×${m(req.length)} 이상` }));
  }
  b.citations = [...used].map(l => cite(a, l));
  b.notes = ["주차구획 요소의 최소 외접 직사각형으로 너비·길이를 쟀습니다. 형식은 BuildLex_KR.주차형식 또는 이름(장애인·확장·경형)으로 판단했습니다."];
  return finish(b, issues, c.f.parking.length);
}

// ───────────────────────────── review ─────────────────────────────

const VALUE_SECTION: Record<string, BimRuleResult["section"]> = { "2A": "대지·밀도", "2B": "대지·밀도", "3A": "대지·밀도", "3B": "주차·조경", "3C": "주차·조경", "4B": "높이·일조" };

export async function reviewBim(input: { facts: BimFacts; values?: ProjectValues; region?: string }): Promise<BimReviewResult> {
  const f = input.facts;
  const merged: ProjectValues = { ...factsToValues(f) };
  for (const [k, val] of Object.entries(input.values || {}) as [FieldKey, FieldValue][]) {
    if (val && val.value !== "" && val.value !== undefined) merged[k] = { ...val, source: "user", confidence: "HIGH" };
    else delete merged[k];
  }
  const region = input.region ? listRegions().find(r => r.key === input.region) || resolveRegion(input.region) : resolveRegion(str(merged, "대지위치"));
  const c = context(f, merged, region);

  // Site-level checks through the plan-review skills.
  const checks = VALUE_CHECKS.map(id => checkById(id)!).filter(Boolean);
  const state: ComplianceFile = { scope: "state", region: region?.key, items: await nationalCompliance(checks, merged, []), notes: [] };
  const city: ComplianceFile = { scope: "city", region: region?.key, items: cityCompliance(checks, merged, region, state.items), notes: region ? [`적용 자치법규: ${region.label}`] : ["지역 미지정"] };
  const tol = f.building.areaTolerance;
  const valueRules: BimRuleResult[] = finalItems(state, city).map(it => {
    const refs: ElemRef[] = it.check_id === "3C" ? f.parking.map(p => p.ref) : it.check_id === "3B" ? f.building.landscape : [];
    const issues: BimIssue[] = it.status === "FAIL" || it.status === "UNCLEAR"
      ? [issue(it.check_id, 1, it.status, it.status === "FAIL" ? "major" : "minor", it.title, [it.provided ? `계획 ${it.provided.text}` : "", ...it.notes].filter(Boolean).join(" ") || it.requirement, refs, { measured: it.provided?.text, required: it.threshold ? `${it.threshold.op === "<=" ? "≤" : "≥"} ${fmt(it.threshold.value)}${it.threshold.unit}` : undefined })]
      : [];
    const notes = (it.check_id === "2A" || it.check_id === "2B") && tol > 0 ? [...it.notes, `면적은 형상 측정값입니다(래스터 정밀도 ±${fmt(tol)}㎡).`] : it.notes;
    return { ...it, notes, section: VALUE_SECTION[it.check_id] || "대지·밀도", source: "values" as const, issues, checked: it.status === "NOT_APPLICABLE" ? 0 : 1 };
  });

  const bimRules = [ruleNorth, ruleEgressDistance, ruleTwoStairs, ruleStairWidth, ruleStairStep, ruleLanding, ruleGuardSides, ruleCorridor, ruleCeiling, ruleWindows, ruleGuards, ruleDoors, ruleParking].map(fn => fn(c));
  const order = ["대지·밀도", "높이·일조", "피난·계단", "복도·실", "채광·환기", "난간·출입구", "주차·조경"];
  const rules = [...valueRules, ...bimRules].sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));

  const by_status = { PASS: 0, FAIL: 0, UNCLEAR: 0, NOT_APPLICABLE: 0 } as Record<CheckStatus, number>;
  const by_confidence = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Confidence, number>;
  for (const r of rules) { by_status[r.status]++; if (r.status === "FAIL" || r.status === "UNCLEAR") by_confidence[r.citations.some(x => x.verified) ? r.code_confidence : "LOW"]++; }
  const issues = rules.flatMap(r => r.issues);
  const summary = { total: rules.length, by_status, issues: issues.length, critical: issues.filter(i => i.severity === "critical" && i.status === "FAIL").length, by_confidence };
  const result: BimReviewResult = { region: region ? { key: region.key, label: region.label } : undefined, values: merged, rules, state, city, summary, md: "", generated_at: new Date().toISOString() };
  result.md = bimMarkdown(f, result);
  return result;
}

const STATUS_KO: Record<CheckStatus, string> = { PASS: "적합", FAIL: "부적합", UNCLEAR: "확인 필요", NOT_APPLICABLE: "해당 없음" };

export function bimMarkdown(f: BimFacts, r: BimReviewResult): string {
  const v = r.values;
  const out = [
    "# BIM 법규검토 보완요구서(안)",
    "",
    `- 모델: ${f.source.project || "-"} (${f.source.file || "IFC"}, ${f.source.schema}${f.source.application ? `, ${f.source.application}` : ""})`,
    `- 대지위치: ${str(v, "대지위치") || "-"} · 용도지역: ${str(v, "용도지역") || "-"} · 주용도: ${str(v, "주용도") || "-"}`,
    `- 적용 자치법규: ${r.region?.label || "지역 미지정(국가 기준만 적용)"}`,
    `- 규모: 지상 ${f.building.storeysAbove}층 / 지하 ${f.building.storeysBelow}층, 높이 ${fmt(f.building.height)}m, 건축면적 ${fmt(f.building.footprint)}㎡, 연면적 ${fmt(f.building.grossFloorArea)}㎡`,
    "- 작성: BuildLex AI BIM 자동 검토 초안 — 검토자 확인 전 문서",
    "",
    "## 보완 요구 사항",
    "",
  ];
  let n = 0;
  for (const rule of r.rules) {
    if (rule.status !== "FAIL" && rule.status !== "UNCLEAR") continue;
    out.push(`### ${++n}. ${rule.title} — ${STATUS_KO[rule.status]}`, "", `- 기준: ${rule.requirement}`, `- 근거: ${[...new Set(rule.citations.map(c => c.label))].join(", ") || "-"}`);
    for (const i of rule.issues.slice(0, 20)) {
      const ids = i.refs.slice(0, 3).map(x => `${x.name}${x.guid ? ` \`${x.guid}\`` : ""}`).join(", ");
      out.push(`- [${STATUS_KO[i.status]}] ${i.title}: ${i.detail}${ids ? ` (요소: ${ids})` : ""}`);
    }
    if (rule.issues.length > 20) out.push(`- … 외 ${rule.issues.length - 20}건`);
    out.push("");
  }
  if (!n) out.push("자동 검토 범위에서 보완 요구 사항이 없습니다.", "");
  out.push("## 항목별 결과", "", "| 분야 | 항목 | 판정 | 기준 | 검토 대상 |", "|---|---|---|---|---|");
  for (const rule of r.rules) out.push(`| ${rule.section} | ${rule.title} | ${STATUS_KO[rule.status]} | ${rule.requirement.replace(/\|/g, "/")} | ${rule.checked || "-"} |`);
  if (f.quality.length) { out.push("", "## 모델 정보 점검", ""); for (const q of f.quality) out.push(`- ${q.text}`); }
  out.push("", "> 자동 검토 초안입니다. 기준값은 코퍼스에 수록된 현행 법령·조례 원문에서 읽었고, 측정값은 IFC 형상과 속성에서 계산했습니다. 지구단위계획·심의 조건 등 수록되지 않은 기준과 모델에 없는 정보는 반영되지 않습니다.");
  return out.join("\n");
}
