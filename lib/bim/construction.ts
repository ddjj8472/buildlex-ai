// 시공 단계 검토 — which construction-stage duties a building triggers, judged from the
// same measured BimFacts the design review uses.
//
// Research basis (docs: "BuildLex 시공단계 법규검토 추가 계획", v2 2026-10-29): BIM safety rule
// checking (Sulankivi·Zhang·Teizer·Eastman 2013; Guo et al. 2016) finds slab edges and holes in the
// model and ties them to the erection sequence; the KRIHS DfS–BIM proposal (2020) asks for the
// same before construction starts. LLMs alone recognise construction hazards poorly (zero-shot F1
// ≈ 0.30, ISARC 2025), so applicability is decided here by rules, never by the LLM.
// Every threshold is parsed from the statute text in the corpus and cited with the line it came
// from. Facts the design model cannot hold (public client, cranes, owner-built, contract sum, start
// date) are inputs; when one is missing the duty is "확인 필요", never silently "비대상".
import { loadNational } from "../corpus.ts";
import { cite, fmt, str } from "../review/skills/common.ts";
import type { Citation, ProjectValues } from "../review/types.ts";
import type { Chunk } from "../types.ts";
import type { BimFacts, BimIssue, ElemRef, FallLevelFact, StoreyFact, Vec3 } from "./types.ts";

export type ConstructionStatus = "대상" | "비대상" | "확인 필요";
export type ConstructionStage = "착공 전" | "시공 중" | "준공·해체";
export type Tri = "yes" | "no" | "unknown";

export type ConstructionInput = {
  /** 발주청(국가·지자체·공공기관) 발주 공사 */
  publicClient?: Tri;
  /** 건축주 직접 시공 */
  ownerBuild?: Tri;
  towerCrane?: Tri;
  piling?: Tri;
  /** 높이 10m 이상 천공기 */
  drill?: Tri;
  /** 작업발판 일체형 거푸집(갱폼·ACS 등) */
  gangForm?: Tri;
  /** 소음·진동관리법 별표 9 기계·장비(굴착기·콘크리트펌프·천공기 등)를 5일 이상 사용 */
  noisyEquip?: Tri;
  /** 공사예정금액(억원) */
  costEok?: number;
  /** 착공 예정일 YYYY-MM-DD */
  startDate?: string;
};

export type Deadline = { days: number; basis: string; date?: string };

export type ConstructionItem = {
  id: string;
  stage: ConstructionStage;
  title: string;
  status: ConstructionStatus;
  /** Why: the measured values against the parsed thresholds. */
  reason: string[];
  /** What the duty requires when it applies. */
  duty: string[];
  when?: string;
  to?: string;
  estimated?: boolean;
  deadline?: Deadline;
  citations: Citation[];
  issues: BimIssue[];
};

/** One step of the construction sequence (4D view): duties and hazards that belong to it. */
export type SequenceStep = {
  key: string;
  label: string;
  kind: "prep" | "excavation" | "foundation" | "frame" | "roof" | "completion";
  storeyId?: number;
  duties: { id: string; title: string; status: ConstructionStatus }[];
  notes: string[];
  issues: string[];
};

export type FallSummary = {
  /** Fall height that triggers protection (산업안전보건기준에 관한 규칙 제44조). */
  minDrop: number;
  levels: { storeyId: number; storey: string; z: number; edge: number; openings: number; openingPerimeter: number; openingArea: number }[];
  edgeTotal: number;
  openingCount: number;
  openingPerimeter: number;
  openingArea: number;
  source: "geometry" | "spaces";
};

export type ConstructionResult = { items: ConstructionItem[]; asked: (keyof ConstructionInput)[]; sequence: SequenceStep[]; fall?: FallSummary; route: "건축법" | "주택법"; md: string };

const chunk = (id: string): Chunk | undefined => loadNational().byId.get(id);
const lines = (t: string) => t.split("\n").map(l => l.trim()).filter(Boolean);

/** "3만" → 30000, "5천" → 5000, "1,000" → 1000 */
export function kNum(s: string): number {
  const m = s.replace(/[,\s]/g, "").match(/^(\d+(?:\.\d+)?)(만|천)?$/);
  if (!m) return NaN;
  return Number(m[1]) * (m[2] === "만" ? 10000 : m[2] === "천" ? 1000 : 1);
}

type Found = { line: string; m: RegExpMatchArray; c: Chunk };
/** First line of an article matching re (the line is kept as the citation quote). */
function find(id: string, re: RegExp): Found | null {
  const c = chunk(id);
  if (!c) return null;
  for (const l of lines(c.text)) { const m = l.match(re); if (m) return { line: l, m, c }; }
  return null;
}

// ───────────────────────────── thresholds from the statutes ─────────────────────────────

export function thresholds() {
  const sp = find("건설기술진흥법시행령#98", /^4\.\s*(\d+)층\s*이상\s*(\d+)층\s*미만인\s*건축물/);
  const dig = find("건설기술진흥법시행령#98", /지하\s*(\d+)미터\s*이상을\s*굴착/);
  const reno = find("건설기술진흥법시행령#98", /(\d+)층\s*이상인\s*건축물의\s*리모델링\s*또는\s*해체/);
  const equip = find("건설기술진흥법시행령#98", /^5\.\s*「건설기계관리법」/);
  const spReview = find("건설기술진흥법시행령#98", /제출받은\s*날부터\s*(\d+)일\s*이내/);
  const fac = chunk("시설물의안전및유지관리에관한특별법#7");
  const facLines = fac ? lines(fac.text).filter(l => /층\s*이상\s*또는\s*연면적/.test(l)) : [];
  const facOf = (l?: string) => { const m = l?.match(/(\d+)층\s*이상\s*또는\s*연면적\s*([\d만천]+)제곱미터/); return m && l ? { floors: Number(m[1]), area: kNum(m[2]), line: l } : null; };
  const scaffold = find("건설기술진흥법시행령#101의2", /높이가\s*(\d+)미터\s*이상인\s*비계/);
  const form = find("건설기술진흥법시행령#101의2", /높이가\s*(\d+)미터\s*이상인\s*거푸집\s*및\s*동바리/);
  const formDeck = find("건설기술진흥법시행령#101의2", /작업발판\s*일체형\s*거푸집/);
  const shore = find("건설기술진흥법시행령#101의2", /높이가\s*(\d+)미터\s*이상인\s*흙막이\s*지보공/);
  const psmH = find("산업안전보건법시행령#42", /지상높이가\s*(\d+)미터\s*이상/);
  const psmA = find("산업안전보건법시행령#42", /연면적\s*([\d만천]+)제곱미터\s*이상인\s*건축물$/);
  const psmU = find("산업안전보건법시행령#42", /연면적\s*([\d만천]+)제곱미터\s*이상인\s*시설로서/);
  const psmD = find("산업안전보건법시행령#42", /깊이\s*(\d+)미터\s*이상인\s*굴착공사/);
  const psmDue = find("산업안전보건법시행규칙#42", /건설공사\s*유해위험방지계획서[\s\S]*?(전날)까지/);
  const demA = find("건축물관리법#30", /연면적\s*(\d+)제곱미터\s*미만/);
  const demH = find("건축물관리법#30", /높이가\s*(\d+)미터\s*미만/);
  const demF = find("건축물관리법#30", /(\d+)개\s*층\s*이하/);
  const multi = find("건축법시행령#2", /바닥면적의\s*합계가\s*([\d만천]+)제곱미터\s*이상인\s*건축물$/);
  const multiF = find("건축법시행령#2", /^나\.\s*(\d+)층\s*이상인\s*건축물$/);
  const resA = find("건축법시행령#19", /^1\.\s*바닥면적의\s*합계가\s*([\d만천]+)\s*제곱미터\s*이상인\s*건축공사/);
  const resF = find("건축법시행령#19", /연속된\s*(\d+)개\s*층[^\n]*?바닥면적의\s*합계가\s*([\d만천]+)\s*제곱미터/);
  const resDig = find("건축법시행령#19", /깊이\s*(\d+)미터\s*이상의\s*토지\s*굴착공사/);
  const midRc = find("건축법시행령#19", /지상\s*(\d+)개\s*층마다\s*상부\s*슬래브배근/);
  const direct = find("건설산업기본법#41", /연면적이\s*(\d+)제곱미터를\s*초과하는\s*건축물/);
  const startDue = find("건축법#21", /신고를\s*받은\s*날부터\s*(\d+)일\s*이내/);
  // v2 — 소규모안전관리계획, 지하안전평가, 특정공사, 비산먼지, 품질, 주택법 경로, 안전보건총괄책임자
  const small = find("건설기술진흥법시행령#101의5", /(\d+)층\s*이상\s*(\d+)층\s*미만인\s*건축물의\s*건설공사/);
  const smallUse = (re: RegExp) => { const f = find("건설기술진흥법시행령#101의5", re); const m = f?.line.match(/연면적\s*([\d,만천]+)\s*제곱미터\s*이상/); return f && m ? { a: kNum(m[1]), f } : null; };
  const smallHousing = smallUse(/별표\s*1\s*제2호의\s*공동주택/);
  const smallNeighbor = smallUse(/근린생활시설/);
  const smallFactory = smallUse(/공장$/);
  const smallStorage = smallUse(/창고$/);
  const smallReview = find("건설기술진흥법시행령#101의5", /제출받은\s*날부터\s*(\d+)일\s*이내/);
  const ug = find("지하안전관리에관한특별법시행령#13", /가\s*(\d+)미터\s*이상인\s*굴착공사를\s*수반하는\s*사업/);
  const ugSmall = find("지하안전관리에관한특별법시행령#23", /굴착깊이가\s*(\d+)미터\s*이상\s*(\d+)미터\s*미만/);
  const noise = find("소음진동관리법시행규칙#21", /연면적이\s*([\d,만천]+)\s*제곱미터\s*이상인\s*건축물의\s*건축공사/);
  const noiseDays = find("소음진동관리법시행규칙#21", /기계ㆍ장비를\s*(\d+)일\s*이상\s*사용하는\s*공사/);
  const noiseZone = find("소음진동관리법시행규칙#21", /영\s*제2조제2항에\s*따른\s*지역에서\s*시행되는\s*공사/);
  const noiseResidential = find("소음진동관리법시행령#2", /주거지역/);
  const noiseDue = find("소음진동관리법#22", /받은\s*날부터\s*(\d+)일\s*이내/);
  const dustRule = find("대기환경보전법시행규칙#57", /별표\s*13의\s*사업/);
  const dustDue = find("대기환경보전법시행규칙#58", /건설공사의\s*경우에는\s*착공\s*전/);
  const qPlan = find("건설기술진흥법시행령#89", /다중이용\s*건축물의\s*건설공사로서\s*연면적이\s*([\d,만천]+)제곱미터\s*이상/);
  const qTest = find("건설기술진흥법시행령#89", /연면적이\s*([\d,만천]+)제곱미터\s*이상인\s*건축물의\s*건축공사/);
  const housing = find("주택법시행령#27", /공동주택:\s*(\d+)세대/);
  const housing50 = find("주택법시행령#27", /(\d+)세대로\s*한다/);
  const housingStart = find("주택법#16", /신고를\s*받은\s*날부터\s*(\d+)일\s*이내/);
  const head = find("산업안전보건법시행령#52", /총공사금액이\s*(\d+)억원\s*이상인\s*건설업/);
  return {
    safetyPlan: sp ? { lo: Number(sp.m[1]), hi: Number(sp.m[2]), f: sp } : null,
    safetyDig: dig ? { depth: Number(dig.m[1]), f: dig } : null,
    safetyReno: reno ? { floors: Number(reno.m[1]), f: reno } : null,
    safetyEquip: equip,
    safetyReview: spReview ? { days: Number(spReview.m[1]), f: spReview } : null,
    class1: facOf(facLines[0]), class2: facOf(facLines[1]), facChunk: fac,
    scaffold: scaffold ? { h: Number(scaffold.m[1]), f: scaffold } : null,
    form: form ? { h: Number(form.m[1]), f: form } : null,
    formDeck,
    shore: shore ? { h: Number(shore.m[1]), f: shore } : null,
    psmHeight: psmH ? { h: Number(psmH.m[1]), f: psmH } : null,
    psmArea: psmA ? { a: kNum(psmA.m[1]), f: psmA } : null,
    psmUse: psmU ? { a: kNum(psmU.m[1]), f: psmU } : null,
    psmDig: psmD ? { d: Number(psmD.m[1]), f: psmD } : null,
    psmDue,
    demolition: demA && demH && demF ? { a: Number(demA.m[1]), h: Number(demH.m[1]), floors: Number(demF.m[1]), f: demA } : null,
    multiUse: multi ? { a: kNum(multi.m[1]), f: multi } : null,
    multiFloors: multiF ? { floors: Number(multiF.m[1]), f: multiF } : null,
    resident: resA && resF ? { a: kNum(resA.m[1]), floors: Number(resF.m[1]), a2: kNum(resF.m[2]), f: resA, f2: resF } : null,
    residentDig: resDig ? { d: Number(resDig.m[1]), f: resDig } : null,
    midReportRc: midRc ? { every: Number(midRc.m[1]), f: midRc } : null,
    direct: direct ? { a: Number(direct.m[1]), f: direct } : null,
    startDue: startDue ? { days: Number(startDue.m[1]), f: startDue } : null,
    small: small ? { lo: Number(small.m[1]), hi: Number(small.m[2]), f: small } : null,
    smallHousing, smallNeighbor, smallFactory, smallStorage,
    smallReview: smallReview ? { days: Number(smallReview.m[1]), f: smallReview } : null,
    underground: ug ? { d: Number(ug.m[1]), f: ug } : null,
    undergroundSmall: ugSmall ? { lo: Number(ugSmall.m[1]), hi: Number(ugSmall.m[2]), f: ugSmall } : null,
    noise: noise ? { a: kNum(noise.m[1]), f: noise } : null,
    noiseDays: noiseDays ? { days: Number(noiseDays.m[1]), f: noiseDays } : null,
    noiseZone, noiseResidential,
    noiseDue: noiseDue ? { days: Number(noiseDue.m[1]), f: noiseDue } : null,
    dustRule, dustDue,
    qualityPlan: qPlan ? { a: kNum(qPlan.m[1]), f: qPlan } : null,
    qualityTest: qTest ? { a: kNum(qTest.m[1]), f: qTest } : null,
    housing: housing ? { units: Number(housing.m[1]), f: housing } : null,
    housing50: housing50 ? { units: Number(housing50.m[1]), f: housing50 } : null,
    housingStart: housingStart ? { days: Number(housingStart.m[1]), f: housingStart } : null,
    safetyHead: head ? { eok: Number(head.m[1]), f: head } : null,
  };
}

/**
 * 비산먼지 발생사업(대기환경보전법 시행규칙 별표 13): the corpus has the 별표 title only (its body
 * is a PDF), so the threshold comes from the 별표 as quoted in 환경부 「비산먼지 관리 매뉴얼」 and is
 * cited as "원문 대조 안 됨".
 */
export const DUST = {
  area: 1000,
  quote: "건축물축조공사: 건축물의 증·개축 및 재축을 포함하며, 연면적 1,000제곱미터 이상인 공사만 해당한다",
  fence: "공사장 경계에는 높이 1.8m(공사장 부지 경계선으로부터 50m 이내에 주거·상가 건물이 있는 곳은 3m) 이상의 방진벽",
  source: "https://m.korea.kr/expertWeb/resources/files/data/document_file/2017/%EB%B9%84%EC%82%B0%EB%A8%BC%EC%A7%80%20%EA%B4%80%EB%A6%AC%20%EB%A7%A4%EB%89%B4%EC%96%BC(2017%EB%85%84).pdf",
};

// Use lists in 산업안전보건법 시행령 제42조③1다 and 건축법 시행령 제2조17가 (matched on 주용도).
const PSM_USE = /문화\s*및\s*집회|판매시설|운수시설|종교시설|종합병원|관광\s*숙박|지하도\s*상가|냉동|냉장/;
const MULTI_USE = /문화\s*및\s*집회|종교시설|판매시설|여객|종합병원|관광\s*숙박/;
const HOUSING = /공동주택|아파트|연립|다세대|기숙사/;
const NEIGHBOR = /근린생활/;

// ───────────────────────────── measured quantities ─────────────────────────────

type Measures = {
  floors: number; below: number; height: number; gfa: number; use: string; apartment: boolean; housing: boolean;
  /** Excavation depth below grade (m); 0 when there is no basement. */
  dig: number; digEstimated: boolean; digNote: string;
  maxStoreyHeight: number; maxStoreyName: string;
  pilotis: boolean; groundFloor?: StoreyFact;
  structure: string;
  units: number; unitsSource: "속성" | "실" | "없음";
  zone: string;
};

function measures(f: BimFacts, v: ProjectValues): Measures {
  const b = f.building;
  const use = str(v, "주용도") || String(f.kr["주용도"] ?? "");
  const lowest = [...f.storeys].sort((a, c) => a.elevation - c.elevation)[0];
  const cf = f.construction;
  // Excavation: bottom of the modelled foundation (pits excluded), else the lowest floor + 1.0 m assumed.
  let dig = 0, digEstimated = false, digNote = "지하층 없음";
  if (cf && cf.digSource === "foundation" && (b.storeysBelow > 0 || cf.dig >= 2)) { dig = cf.dig; digNote = `기초 하단 기준 ${fmt(cf.dig)}m(${cf.digRef?.name ?? "기초"})`; }
  else if (b.storeysBelow > 0 && lowest) {
    dig = Math.max(0, b.groundZ - lowest.elevation) + 1.0; digEstimated = true;
    digNote = `최하층 바닥 + 기초 1.0m 가정 ≈ ${fmt(Math.round(dig * 100) / 100)}m`;
  }
  const above = f.storeys.filter(s => s.above && s.floorArea > 0.5).sort((a, c) => a.elevation - c.elevation);
  const tallest = [...f.storeys].filter(s => s.floorArea > 0.5).sort((a, c) => c.height - a.height)[0];
  const ground = above[0];
  const upper = above.slice(1).map(s => s.floorArea).sort((a, c) => a - c);
  const median = upper.length ? upper[Math.floor(upper.length / 2)] : 0;
  const unitsProp = Number(str(v, "세대수") || f.kr["세대수"] || 0);
  const unitsRooms = f.storeys.reduce((a, s) => a + (s.units || 0), 0);
  return {
    floors: b.storeysAbove, below: b.storeysBelow, height: b.height, gfa: b.grossFloorArea, use,
    apartment: /아파트/.test(use), housing: HOUSING.test(use),
    dig: Math.round(dig * 100) / 100, digEstimated, digNote,
    maxStoreyHeight: tallest?.height ?? 0, maxStoreyName: tallest?.name ?? "",
    // 필로티 추정: the ground floor encloses under half of a typical upper floor.
    pilotis: !!ground && upper.length >= 2 && median > 0 && ground.floorArea < median * 0.5,
    groundFloor: ground,
    structure: str(v, "구조") || String(f.kr["구조"] ?? ""),
    units: unitsProp > 0 ? unitsProp : unitsRooms, unitsSource: unitsProp > 0 ? "속성" : unitsRooms > 0 ? "실" : "없음",
    zone: str(v, "용도지역") || String(f.kr["용도지역"] ?? ""),
  };
}

// ───────────────────────────── items ─────────────────────────────

const yes = (t?: Tri) => t === "yes";
const known = (t?: Tri) => t === "yes" || t === "no";
const c = (x: { f: Found } | Found | null | undefined): Citation[] => (x ? ["f" in x ? x.f : x] : []).map(y => cite(y.c, y.line));

function item(p: Omit<ConstructionItem, "issues" | "citations"> & { citations?: Citation[]; issues?: BimIssue[] }): ConstructionItem {
  return { citations: [], issues: [], ...p };
}

/** YYYY-MM-DD minus n calendar days (no timezone drift). */
export function minusDays(date: string, n: number): string | undefined {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function reviewConstruction(f: BimFacts, v: ProjectValues, input: ConstructionInput = {}): ConstructionResult {
  const t = thresholds();
  const M = measures(f, v);
  const items: ConstructionItem[] = [];
  const asked = new Set<keyof ConstructionInput>();
  const nf = (x: number) => fmt(Math.round(x * 100) / 100);
  const due = (days: number | undefined, basis: string): Deadline | undefined => (days === undefined ? undefined : { days, basis, date: input.startDate ? minusDays(input.startDate, days) : undefined });

  // ── 주택법 경로: 사업계획승인 대상 공동주택이면 착공·감리·준공 절차가 주택법으로 바뀜.
  let route: ConstructionResult["route"] = "건축법";
  {
    const th = t.housing?.units, th50 = t.housing50?.units;
    let status: ConstructionStatus = "비대상";
    let reason: string[];
    if (!M.housing) reason = [`주용도 ${M.use || "미상"} — 공동주택이 아니어서 주택건설사업계획승인 기준(공동주택 ${th ?? "?"}세대)과 무관합니다.`];
    else if (!M.units) { status = "확인 필요"; reason = [`세대수를 모델에서 읽지 못했습니다(BuildLex_KR.세대수 또는 실의 세대번호). ${th ?? "?"}세대 이상이면 주택법 사업계획승인 대상입니다.`]; }
    else if (th && M.units >= (th50 ?? Infinity) ) { status = "대상"; route = "주택법"; reason = [`공동주택 ${M.units}세대(${M.unitsSource}) ≥ ${th50}세대`]; }
    else if (th && M.units >= th) {
      if (/연립|다세대/.test(M.use) && th50) { status = "확인 필요"; reason = [`${M.use} ${M.units}세대(${M.unitsSource}) — ${th}세대 이상이지만, 단지형 연립·다세대로서 세대별 전용 30㎡ 이상·진입도로 6m 이상이면 기준이 ${th50}세대입니다.`]; }
      else { status = "대상"; route = "주택법"; reason = [`공동주택 ${M.units}세대(${M.unitsSource}) ≥ ${th}세대`]; }
    } else reason = [`공동주택 ${M.units}세대(${M.unitsSource}) < ${th ?? "?"}세대 — 건축법 허가 절차`];
    items.push(item({
      id: "C-HOUSING", stage: "착공 전", title: "주택건설사업계획승인(주택법 경로)", status, reason,
      duty: ["사업계획승인을 받으면 건축허가 등이 의제되고(주택법 제19조), 착공신고는 사업계획승인권자에게 합니다(제16조).", "감리자는 사업계획승인권자가 지정하고(제43조), 공사를 마치면 사용승인 대신 사용검사를 받습니다(제49조).", "도시형 생활주택은 건축법 제25조 공사감리를 따릅니다(제43조① 단서).", "주택 외의 시설과 주택을 한 건물에 짓는 주상복합 등 시행령 제27조④의 경우는 사업계획승인 대신 건축허가를 받을 수 있습니다."],
      when: "건축허가 단계", to: "사업계획승인권자(시·도지사 또는 시장·군수)",
      citations: [...cites("주택법#15"), ...c(t.housing), ...(status === "확인 필요" && th50 ? c(t.housing50) : [])],
    }));
  }
  const housingRoute = route === "주택법";

  // 1·2종 시설물 (시설물안전법 제7조) — feeds 안전관리계획 1호.
  const cls = t.class1 && (M.floors >= t.class1.floors || M.gfa >= t.class1.area) ? "1종"
    : t.class2 && (M.floors >= t.class2.floors || M.gfa >= t.class2.area) ? "2종" : null;

  // 가설구조물 (건설기술진흥법 시행령 제101조의2) — estimated from the model + the formwork answer.
  const temp: string[] = [];
  if (t.scaffold && M.height >= t.scaffold.h) temp.push(`외부 비계 높이 ≈ 건물 높이 ${nf(M.height)}m ≥ ${t.scaffold.h}m`);
  if (t.form && M.maxStoreyHeight >= t.form.h) temp.push(`최고 층고 ${nf(M.maxStoreyHeight)}m(${M.maxStoreyName}) ≥ 거푸집·동바리 ${t.form.h}m`);
  if (t.shore && M.dig >= t.shore.h) temp.push(`굴착 깊이 ${M.digEstimated ? "≈ " : ""}${nf(M.dig)}m ≥ 흙막이 지보공 ${t.shore.h}m`);
  if (yes(input.gangForm)) temp.push("작업발판 일체형 거푸집(갱폼·ACS 등) 사용");
  if (!known(input.gangForm) && M.floors >= 10) asked.add("gangForm");

  // ── 지하안전평가 / 소규모 지하안전평가
  {
    const big = t.underground?.d, lo = t.undergroundSmall?.lo, hi = t.undergroundSmall?.hi;
    let status: ConstructionStatus = "비대상", title = "지하안전평가";
    const reason: string[] = [];
    if (big !== undefined && M.dig >= big) { status = "대상"; reason.push(`굴착 깊이 ${M.digNote} ≥ ${big}m`); }
    else if (lo !== undefined && hi !== undefined && M.dig >= lo && M.dig < hi) { status = "대상"; title = "소규모 지하안전평가"; reason.push(`굴착 깊이 ${M.digNote} — ${lo}m 이상 ${hi}m 미만`); }
    else reason.push(`굴착 깊이 ${M.digNote} — 소규모 지하안전평가 기준 ${lo ?? "?"}m 미만`);
    if (status === "대상" && M.digEstimated) reason.push("기초가 모델에 없어 굴착 깊이를 가정했습니다. 집수정·엘리베이터 피트·정화조 굴착은 깊이에서 제외합니다.");
    items.push(item({
      id: "C-UNDERGROUND", stage: "착공 전", title, status, reason,
      duty: [title === "지하안전평가" ? "건축허가(승인) 요청 때 지하안전평가서를 첨부해 제출하고, 허가권자는 허가 전에 국토교통부장관과 협의합니다." : "건축허가(승인) 요청 때 소규모 지하안전평가서를 첨부해 제출합니다.", "착공 후에는 착공후지하안전조사를 하고 결과를 국토교통부장관과 승인기관에 통보합니다(법 제20조)."],
      when: "건축허가 신청 때 / 착공 후 조사", to: "승인기관(허가권자) → 국토교통부장관", estimated: status === "대상" && M.digEstimated,
      citations: [...cites("지하안전관리에관한특별법#14"), ...c(t.underground), ...c(t.undergroundSmall), ...(status === "대상" ? cites("지하안전관리에관한특별법#20") : [])],
    }));
  }

  // ── 안전관리계획
  {
    const why: string[] = [];
    if (cls) why.push(`${cls}시설물(지상 ${M.floors}층, 연면적 ${nf(M.gfa)}㎡)`);
    if (t.safetyPlan && M.floors >= t.safetyPlan.lo && M.floors < t.safetyPlan.hi) why.push(`지상 ${M.floors}층 — ${t.safetyPlan.lo}층 이상 ${t.safetyPlan.hi}층 미만`);
    if (t.safetyDig && M.dig >= t.safetyDig.depth) why.push(`지하 굴착 ${M.digEstimated ? "≈ " : ""}${nf(M.dig)}m ≥ ${t.safetyDig.depth}m`);
    if (temp.length) why.push(`가설구조물 사용(${temp.length}종, 아래 항목)`);
    const equip = [yes(input.towerCrane) && "타워크레인", yes(input.piling) && "항타·항발기", yes(input.drill) && "높이 10m 이상 천공기"].filter(Boolean) as string[];
    if (equip.length) why.push(`건설기계 사용: ${equip.join(", ")}`);
    const equipKnown = known(input.towerCrane) && known(input.piling) && known(input.drill);
    if (!equipKnown && !why.length) (["towerCrane", "piling", "drill"] as const).forEach(k => asked.add(k));
    const status: ConstructionStatus = why.length ? "대상" : equipKnown ? "비대상" : "확인 필요";
    const reason = why.length ? why : [
      `지상 ${M.floors}층(기준 ${t.safetyPlan?.lo ?? "?"}층 이상 ${t.safetyPlan?.hi ?? "?"}층 미만), 굴착 ${M.digNote}(기준 ${t.safetyDig?.depth ?? "?"}m), 1·2종 시설물 아님`,
      ...(equipKnown ? [] : ["타워크레인·항타기·천공기 사용 계획을 입력하면 판정이 확정됩니다."]),
    ];
    items.push(item({
      id: "C-SAFETY-PLAN", stage: "착공 전", title: "건설공사 안전관리계획", status, reason,
      duty: ["안전관리계획을 수립해 착공 전에 발주자(민간 공사는 인·허가기관)의 승인을 받아야 합니다.", "공정별 안전점검계획, 주변 안전대책, 안전관리비 집행계획 등을 포함합니다(시행령 제99조).", "유해위험방지계획서 대상이면 두 계획을 통합해 작성할 수 있습니다.", "준공하면 안전점검 종합보고서를 발주청(민간 공사는 인·허가기관)에 제출합니다(법 제62조⑦)."],
      when: "착공 전 승인", to: "발주자 또는 인·허가기관",
      estimated: why.some(w => w.includes("≈")),
      deadline: status !== "비대상" ? due(t.safetyReview?.days, `검토 결과 통보 ${t.safetyReview?.days ?? "?"}일 이내(시행령 제98조③)`) : undefined,
      citations: [...cites("건설기술진흥법#62"), ...c(t.safetyPlan), ...c(t.safetyDig), ...(cls && t.facChunk ? [cite(t.facChunk, (cls === "1종" ? t.class1 : t.class2)!.line)] : []), ...(equip.length ? c(t.safetyEquip) : []), ...c(t.safetyReview)],
    }));
  }
  const safetyPlan = items.find(i => i.id === "C-SAFETY-PLAN")!;

  // ── 소규모안전관리계획 (안전관리계획 대상이 아닌 2층 이상 10층 미만 공동주택·근생·공장·창고)
  {
    const s = t.small;
    const crit = HOUSING.test(M.use) ? t.smallHousing : NEIGHBOR.test(M.use) ? t.smallNeighbor : /공장/.test(M.use) ? t.smallFactory : /창고/.test(M.use) ? t.smallStorage : null;
    const inRange = !!s && M.floors >= s.lo && M.floors < s.hi;
    const meets = inRange && !!crit && M.gfa >= crit.a;
    let status: ConstructionStatus, reason: string[];
    if (!meets) {
      status = "비대상";
      reason = [!s ? "기준 조문을 읽지 못했습니다." : !inRange ? `지상 ${M.floors}층 — ${s.lo}층 이상 ${s.hi}층 미만이 아닙니다.` : !crit ? `주용도 ${M.use || "미상"} — 공동주택·근린생활시설·공장·창고가 아닙니다.` : `연면적 ${nf(M.gfa)}㎡ < ${fmt(crit.a)}㎡`];
    } else if (safetyPlan.status === "대상") { status = "비대상"; reason = ["안전관리계획 대상이라 그 계획으로 갈음합니다(소규모안전관리계획은 안전관리계획 대상이 아닌 공사에 적용)."]; }
    else if (safetyPlan.status === "확인 필요") { status = "확인 필요"; reason = [`지상 ${M.floors}층, ${M.use} 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(crit!.a)}㎡ — 타워크레인 등을 쓰면 안전관리계획, 아니면 소규모안전관리계획 대상입니다.`]; }
    else { status = "대상"; reason = [`지상 ${M.floors}층(${s!.lo}층 이상 ${s!.hi}층 미만), ${M.use} 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(crit!.a)}㎡`]; }
    items.push(item({
      id: "C-SMALL-PLAN", stage: "착공 전", title: "소규모안전관리계획", status, reason,
      duty: ["건설공사 개요, 비계 설치계획, 안전시설물 설치계획을 담은 소규모안전관리계획을 착공 전에 발주자(민간 공사는 인·허가기관)에게 제출해 승인받습니다.", "국토교통부는 2025년 미수립 시 과태료 신설을 발표했습니다."],
      when: "착공 전 승인", to: "발주자 또는 인·허가기관",
      deadline: status !== "비대상" ? due(t.smallReview?.days, `검토 결과 통보 ${t.smallReview?.days ?? "?"}일 이내(시행령 제101조의5②)`) : undefined,
      citations: [...cites("건설기술진흥법#62의2"), ...c(s), ...(crit ? c(crit) : []), ...cites("건설기술진흥법시행령#101의6")],
    }));
  }

  // ── 설계안전성검토 (DfS) — 안전관리계획 대상 중 건설기계 사용만으로 대상인 공사는 제외(시행령 제75조의2①).
  {
    const byCriteria = safetyPlan.status === "대상" && safetyPlan.reason.some(r => !r.startsWith("건설기계"));
    let status: ConstructionStatus, reason: string[];
    if (!byCriteria) { status = "비대상"; reason = ["층수·굴착·시설물 종류·가설구조물 기준으로는 안전관리계획 대상이 아닙니다.", "건설기계 사용만으로 안전관리계획 대상이 되는 공사는 설계안전성검토에서 제외됩니다."]; }
    else if (input.publicClient === "no") { status = "비대상"; reason = ["민간 발주 공사 — 설계안전성검토는 발주청이 의뢰하는 제도입니다."]; }
    else if (input.publicClient === "yes") { status = "대상"; reason = ["발주청 발주 + 안전관리계획 대상 공사의 실시설계"]; }
    else { status = "확인 필요"; reason = ["안전관리계획 대상입니다. 발주청(공공) 발주인지 입력하면 확정됩니다."]; asked.add("publicClient"); }
    items.push(item({
      id: "C-DFS", stage: "착공 전", title: "설계안전성검토(DfS)", status, reason,
      duty: ["실시설계 때 시공 중 위험요소와 저감대책을 담은 설계안전검토보고서를 국토안전관리원에 제출해 검토받습니다.", "검토 결과는 착공 전에 국토교통부장관에게 제출합니다."],
      when: "실시설계 중, 착공 전 결과 제출", to: "국토안전관리원",
      citations: cites("건설기술진흥법시행령#75의2"),
    }));
  }

  // ── 가설구조물 구조적 안전성 확인
  items.push(item({
    id: "C-TEMP-WORKS", stage: "착공 전", title: "가설구조물 구조안전 확인", status: temp.length ? "대상" : asked.has("gangForm") ? "확인 필요" : "비대상",
    reason: temp.length ? temp : [`건물 높이 ${nf(M.height)}m, 최고 층고 ${nf(M.maxStoreyHeight)}m, 굴착 ${M.digNote} — 비계 ${t.scaffold?.h ?? "?"}m·거푸집 ${t.form?.h ?? "?"}m·흙막이 ${t.shore?.h ?? "?"}m 기준 미만`, asked.has("gangForm") ? "10층 이상 — 갱폼·ACS 같은 작업발판 일체형 거푸집을 쓰는지 입력하면 확정됩니다." : "브라켓 비계·작업발판 일체형 거푸집 등 공법으로 대상이 되는 경우는 시공계획으로 확인하세요."],
    duty: ["시공 전에 관계전문가(시공사에 고용되지 않은 기술사)가 서명한 구조계산서와 시공상세도면을 공사감독자·건설사업관리기술인에게 제출합니다."],
    when: "해당 가설구조물 시공 전", to: "공사감독자 또는 건설사업관리기술인", estimated: temp.some(x => x.includes("≈")),
    citations: [...c(t.scaffold), ...c(t.form), ...(yes(input.gangForm) || asked.has("gangForm") ? c(t.formDeck) : []), ...c(t.shore)],
  }));

  // ── 유해위험방지계획서
  {
    const why: string[] = [];
    if (t.psmHeight && M.height >= t.psmHeight.h) why.push(`지상높이 ${nf(M.height)}m ≥ ${t.psmHeight.h}m`);
    if (t.psmArea && M.gfa >= t.psmArea.a) why.push(`연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.psmArea.a)}㎡`);
    if (t.psmUse && M.gfa >= t.psmUse.a && PSM_USE.test(M.use)) why.push(`${M.use} 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.psmUse.a)}㎡`);
    if (t.psmDig && M.dig >= t.psmDig.d) why.push(`굴착 깊이 ${M.digEstimated ? "≈ " : ""}${nf(M.dig)}m ≥ ${t.psmDig.d}m`);
    items.push(item({
      id: "C-PSM", stage: "착공 전", title: "건설공사 유해위험방지계획서", status: why.length ? "대상" : "비대상",
      reason: why.length ? why : [`지상높이 ${nf(M.height)}m(기준 ${t.psmHeight?.h ?? "?"}m), 연면적 ${nf(M.gfa)}㎡(기준 ${fmt(t.psmArea?.a ?? NaN)}㎡), 굴착 ${M.digNote}(기준 ${t.psmDig?.d ?? "?"}m) — 모두 미만`],
      duty: ["건설안전 분야 자격자의 의견을 들어 작성하고, 착공 전날까지 한국산업안전보건공단에 2부 제출해 심사를 받습니다.", "안전관리계획 대상이면 통합 작성할 수 있습니다."],
      when: "착공 전날까지", to: "한국산업안전보건공단", estimated: why.some(w => w.includes("≈")),
      deadline: why.length ? due(t.psmDue ? 1 : undefined, "착공 전날까지(시행규칙 제42조③)") : undefined,
      citations: [...cites("산업안전보건법#42"), ...c(t.psmHeight), ...c(t.psmArea), ...c(t.psmDig), ...c(t.psmDue)],
    }));
  }

  // ── 품질관리계획 / 품질시험계획
  {
    const multi = (t.multiFloors && M.floors >= t.multiFloors.floors) || (t.multiUse && M.gfa >= t.multiUse.a && MULTI_USE.test(M.use));
    let status: ConstructionStatus = "비대상", title = "품질관리계획·품질시험계획", reason: string[];
    if (multi && t.qualityPlan && M.gfa >= t.qualityPlan.a) { status = "대상"; title = "품질관리계획"; reason = [`다중이용 건축물 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.qualityPlan.a)}㎡`]; }
    else if (t.qualityTest && M.gfa >= t.qualityTest.a) { status = "대상"; title = "품질시험계획"; reason = [`건축공사 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.qualityTest.a)}㎡`]; }
    else reason = [`연면적 ${nf(M.gfa)}㎡ < 품질시험계획 기준 ${fmt(t.qualityTest?.a ?? NaN)}㎡`];
    items.push(item({
      id: "C-QUALITY", stage: "착공 전", title, status, reason,
      duty: [title === "품질관리계획" ? "KS Q ISO 9001 체계에 맞춘 품질관리계획을 수립해 발주자(민간 공사는 인·허가기관)의 승인을 받고, 계획에 따라 품질시험·검사를 합니다." : "공종별 시험 종목·방법·횟수를 담은 품질시험계획을 수립해 발주자(민간 공사는 인·허가기관)의 승인을 받고, 계획에 따라 품질시험·검사를 합니다.", "건설사업자·주택건설등록업자의 의무입니다(법 제55조)."],
      when: "착공 전 승인", to: "발주자 또는 인·허가기관",
      citations: [...cites("건설기술진흥법#55"), ...c(status === "대상" && title === "품질관리계획" ? t.qualityPlan : t.qualityTest)],
    }));
  }

  // ── 특정공사 사전신고 (소음·진동관리법)
  {
    const days = t.noiseDays?.days ?? 5;
    const big = !!t.noise && M.gfa >= t.noise.a;
    const residential = /주거지역/.test(M.zone);
    let status: ConstructionStatus, reason: string[];
    if (!big && !residential) { status = "비대상"; reason = [`연면적 ${nf(M.gfa)}㎡ < ${fmt(t.noise?.a ?? NaN)}㎡${M.zone ? `, ${M.zone}` : ", 용도지역 미상"} — 규모·지역 기준에 해당하지 않습니다.`, ...(M.zone ? [] : ["학교·종합병원·공동주택 등의 부지경계에서 50m 이내이면 규모와 관계없이 대상입니다(영 제2조②)."])]; }
    else {
      const why = [big ? `건축공사 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.noise!.a)}㎡` : `${M.zone} — 영 제2조②의 지역`];
      if (input.noisyEquip === "yes") { status = "대상"; reason = [...why, `별표 9 기계·장비(굴착기·콘크리트펌프·천공기 등) ${days}일 이상 사용`]; }
      else if (input.noisyEquip === "no") { status = "비대상"; reason = [...why, `별표 9 기계·장비를 ${days}일 이상 쓰지 않음`]; }
      else { status = "확인 필요"; reason = [...why, `굴착기·콘크리트펌프·천공기 등 별표 9 장비를 ${days}일 이상 쓰는지 입력하면 확정됩니다(골조 공사는 대부분 해당).`]; asked.add("noisyEquip"); }
    }
    items.push(item({
      id: "C-NOISE", stage: "착공 전", title: "특정공사 사전신고(소음·진동)", status, reason,
      duty: ["공사 개요·공사장 위치도·방음·방진시설 설치명세 및 도면·소음·진동 저감대책을 첨부해 착공 전에 신고합니다.", "도급 공사는 발주자로부터 최초로 공사를 도급받은 자가 신고합니다."],
      when: "착공 전", to: "시장·군수·구청장",
      deadline: status !== "비대상" ? due(t.noiseDue?.days ?? 1, t.noiseDue ? `착공 전 신고, 수리 통지 ${t.noiseDue.days}일 이내(법 제22조③)` : "착공 전까지(시행규칙 제21조②)") : undefined,
      citations: [...cites("소음진동관리법#22"), ...c(t.noiseDays), ...c(t.noise), ...(residential ? [...c(t.noiseZone), ...c(t.noiseResidential)] : [])],
    }));
  }

  // ── 비산먼지 발생사업 신고 (대기환경보전법)
  {
    const big = M.gfa >= DUST.area;
    const appendix = chunk("대기환경보전법시행규칙#별표13");
    items.push(item({
      id: "C-DUST", stage: "착공 전", title: "비산먼지 발생사업 신고", status: big ? "대상" : "비대상",
      reason: [big ? `건축물축조공사 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(DUST.area)}㎡` : `연면적 ${nf(M.gfa)}㎡ < ${fmt(DUST.area)}㎡`, "기준값은 시행규칙 별표 13(PDF)에 있어 환경부 「비산먼지 관리 매뉴얼」의 별표 인용으로 판정했습니다."],
      duty: ["비산먼지 발생사업 신고서를 착공 전에 제출하고(건축법 착공신고와 함께 낼 수 있음), 별표 14의 억제시설을 설치합니다.", `${DUST.fence}을 설치합니다(별표 14).`],
      when: "착공 전", to: "시장·군수·구청장",
      deadline: big ? due(1, "착공 전(시행규칙 제58조①)") : undefined,
      citations: [...cites("대기환경보전법#43"), ...c(t.dustRule), ...c(t.dustDue), ...(appendix ? [{ ...cite(appendix, DUST.quote), sourceUrl: DUST.source }] : [])],
    }));
  }

  // ── 안전보건총괄책임자 (산업안전보건법 제62조, 공사금액)
  {
    const th = t.safetyHead?.eok;
    let status: ConstructionStatus, reason: string[];
    if (input.costEok === undefined || !(input.costEok > 0)) { status = "확인 필요"; reason = [`공사예정금액을 입력하면 판정합니다(총공사금액 ${th ?? "?"}억원 이상 건설업).`]; asked.add("costEok"); }
    else if (th !== undefined && input.costEok >= th) { status = "대상"; reason = [`공사예정금액 ${fmt(input.costEok)}억원 ≥ ${th}억원`]; }
    else { status = "비대상"; reason = [`공사예정금액 ${fmt(input.costEok)}억원 < ${th ?? "?"}억원`]; }
    items.push(item({
      id: "C-SAFETY-HEAD", stage: "착공 전", title: "안전보건총괄책임자 지정", status, reason,
      duty: ["도급인은 사업장의 안전보건관리책임자를 안전보건총괄책임자로 지정해 도급인·관계수급인 근로자의 산업재해 예방 업무를 총괄하게 합니다.", "지정하면 건설기술진흥법상 안전총괄책임자를 둔 것으로 봅니다(법 제62조②)."],
      when: "착공 전 지정", to: "도급인(시공사)",
      citations: [...cites("산업안전보건법#62"), ...c(t.safetyHead)],
    }));
  }

  // ── 착공신고
  {
    const days = housingRoute ? t.housingStart?.days : t.startDue?.days;
    items.push(item({
      id: "C-START", stage: "착공 전", title: housingRoute ? "착공신고(주택법)" : "착공신고", status: "대상",
      reason: [housingRoute ? "주택법 사업계획승인 대상 — 공사를 시작하려면 사업계획승인권자에게 신고합니다." : "건축허가를 받거나 건축신고를 한 건축물은 모두 해당합니다."],
      duty: housingRoute
        ? ["공사 착수 신고를 사업계획승인권자에게 하고, 승인받은 날부터 5년 이내에 공사를 시작해야 합니다(제16조①).", `사업계획승인권자는 ${days ?? "?"}일 이내에 수리 여부를 통지합니다.`]
        : ["공사 착수 전 허가권자에게 공사계획을 신고합니다(공사감리자·시공자 함께 서명).", "허가 대상 건축물은 설계·감리·시공 계약서 사본을 첨부합니다.", `허가권자는 ${days ?? "?"}일 이내 수리 여부를 통지하며, 통지가 없으면 수리된 것으로 봅니다.`],
      when: "공사 착수 전", to: housingRoute ? "사업계획승인권자" : "허가권자(시·군·구청장)",
      deadline: due(days, housingRoute ? `신고수리 통지 ${days}일 이내(주택법 제16조③)` : `신고수리 통지 ${days}일 이내(건축법 제21조③)`),
      citations: housingRoute ? [...cites("주택법#16"), ...c(t.housingStart)] : [...cites("건축법#21"), ...c(t.startDue)],
    }));
  }

  // ── 공사감리 · 상주감리 · 감리중간보고
  {
    const multi = (t.multiFloors && M.floors >= t.multiFloors.floors) || (t.multiUse && M.gfa >= t.multiUse.a && MULTI_USE.test(M.use));
    const reason: string[] = [];
    if (housingRoute) reason.push("주택법 사업계획승인 대상 — 사업계획승인권자가 「건축사법」·「건설기술 진흥법」상 감리자격자를 감리자로 지정합니다(국가·지자체·LH 등이 사업주체면 제외).");
    else reason.push(multi ? "다중이용 건축물 — 건설엔지니어링사업자(또는 건설사업관리기술인을 배치한 건축사)를 감리자로 지정" : "건축허가 대상 건축물 — 건축사를 공사감리자로 지정");
    const res: string[] = [];
    if (!housingRoute && t.resident) {
      if (M.gfa >= t.resident.a) res.push(`바닥면적 합계 ${nf(M.gfa)}㎡ ≥ ${fmt(t.resident.a)}㎡`);
      const run = M.floors + M.below;
      if (run >= t.resident.floors && M.gfa >= t.resident.a2) res.push(`연속 ${run}개 층 · ${nf(M.gfa)}㎡ ≥ ${t.resident.floors}개 층 · ${fmt(t.resident.a2)}㎡`);
      if (M.apartment) res.push("아파트 건축공사");
      reason.push(res.length ? `상주감리 대상: ${res.join(", ")}` : `상주감리 비대상(바닥면적 합계 ${nf(M.gfa)}㎡, 연속 ${M.floors + M.below}개 층)`);
      if (!res.length && t.residentDig && M.dig >= t.residentDig.d) reason.push(`굴착 ${M.digEstimated ? "≈ " : ""}${nf(M.dig)}m ≥ ${t.residentDig.d}m — 굴착공사 기간 건축·토목 분야 건축사보 상주`);
    }
    if (/철근\s*콘크리트|RC/i.test(M.structure) && t.midReportRc && !housingRoute) {
      reason.push(`감리중간보고 시점(철근콘크리트조): ${midReports(M.floors, t.midReportRc.every).join(" → ")}`);
    }
    items.push(item({
      id: "C-SUPERVISION", stage: "시공 중", title: housingRoute ? "주택건설공사 감리(주택법)" : "공사감리·상주감리", status: "대상", reason,
      duty: housingRoute
        ? ["감리자는 시공 확인, 품질·안전 관리 지도, 설계도서대로 시공하는지 확인하고 업무 수행 상황을 사업계획승인권자에게 보고합니다(제44조).", "도시형 생활주택은 건축법 제25조 공사감리를 따릅니다."]
        : ["감리일지를 기록하고, 정해진 공정마다 감리중간보고서를, 완료 후 감리완료보고서를 건축주에게 제출합니다.", "위반 사항은 시정·재시공을 요청하고 따르지 않으면 허가권자에게 보고합니다."],
      when: "착공~준공", to: housingRoute ? "사업계획승인권자" : "건축주 → 허가권자",
      citations: housingRoute ? cites("주택법#43", "주택법#44") : [...cites("건축법#25", ["건축법시행령#19", t.resident?.f.line]), ...c(t.midReportRc)],
    }));
  }

  // ── 시공자 제한 · 현장관리인
  {
    const mustContractor = (t.direct && M.gfa > t.direct.a) || M.housing;
    let status: ConstructionStatus, reason: string[];
    if (mustContractor) { status = "비대상"; reason = [`${M.housing ? "공동주택" : `연면적 ${nf(M.gfa)}㎡ > ${t.direct?.a}㎡`} — 건설사업자가 시공해야 하는 건축물이라 현장관리인 지정 조항(건축주 직접 시공)은 해당하지 않습니다.`]; }
    else if (input.ownerBuild === "yes") { status = "대상"; reason = ["건설사업자 시공 의무가 없는 소규모 건축물을 건축주가 직접 시공"]; }
    else if (input.ownerBuild === "no") { status = "비대상"; reason = ["건설사업자에게 도급"]; }
    else { status = "확인 필요"; reason = ["소규모 건축물입니다. 건축주가 직접 시공하는지 입력하면 확정됩니다."]; asked.add("ownerBuild"); }
    items.push(item({
      id: "C-SITE-MANAGER", stage: "시공 중", title: "현장관리인 지정", status, reason,
      duty: ["건설기술인 1명을 현장관리인으로 지정해 공정·안전 관리를 맡기고, 건축주 승낙 없이 현장을 떠날 수 없습니다.", "허가권자가 공사감리자를 지정합니다(건축법 제25조②)."],
      when: "착공 전 지정", to: "건축주",
      citations: [...cites("건축법#24"), ...c(t.direct)],
    }));
  }

  // ── 공정 사진·동영상
  {
    const multi = (t.multiFloors && M.floors >= t.multiFloors.floors) || (t.multiUse && M.gfa >= t.multiUse.a && MULTI_USE.test(M.use));
    let status: ConstructionStatus, reason: string[];
    if (multi) { status = "대상"; reason = ["다중이용 건축물"]; }
    else if (M.pilotis && M.floors >= 3) { status = "확인 필요"; reason = [`1층 바닥면적 ${nf(M.groundFloor!.floorArea)}㎡가 위층의 절반 미만 — 3층 이상 필로티형식 건축물로 추정됩니다.`, "하층부가 상층부와 다른 구조형식이면 대상입니다(기초 철근배치, 전이 부재 철근배치 때 촬영)."]; }
    else { status = "비대상"; reason = ["다중이용·특수구조·3층 이상 필로티형식 건축물이 아닙니다(모델 기준)."]; }
    items.push(item({
      id: "C-PHOTO", stage: "시공 중", title: "공정 사진·동영상 촬영", status, reason,
      duty: ["정해진 공정에 다다를 때마다 사진·동영상을 촬영·보관해 건축주·감리자·허가권자가 확인할 수 있게 합니다."],
      when: "해당 공정 도달 시", to: "공사시공자", estimated: status === "확인 필요",
      citations: cites("건축법시행령#18의2"),
    }));
  }

  // ── 추락 위험 지점 (BIM)
  const { item: fallItem, summary: fall } = fallHazards(f, M);
  items.push(fallItem);

  // ── 사용승인 / 사용검사
  items.push(item({
    id: "C-COMPLETION", stage: "준공·해체", title: housingRoute ? "사용검사(주택법)" : "사용승인", status: "대상",
    reason: [housingRoute ? "주택법 사업계획승인을 받은 주택건설사업은 완료 후 사용검사를 받아야 사용할 수 있습니다(사용승인 등은 의제)." : "허가·신고 건축물은 공사 완료 후 사용승인을 받아야 사용할 수 있습니다."],
    duty: [
      ...(housingRoute ? ["사업주체가 시장·군수·구청장의 사용검사를 받으며, 입주예정자 과반수가 요청하면 사용검사 전 현장점검에 따라야 합니다."] : ["감리완료보고서와 공사완료도서를 첨부해 사용승인을 신청합니다.", "허가권자는 설계도서대로 시공했는지 검사한 뒤 사용승인서를 내줍니다."]),
      ...(safetyPlan.status === "대상" ? ["안전관리계획 대상 공사이므로 안전점검 종합보고서를 함께 제출합니다(건설기술진흥법 제62조⑦)."] : []),
    ],
    when: "공사 완료 후", to: housingRoute ? "시장·군수·구청장" : "허가권자",
    citations: housingRoute ? cites("주택법#49") : cites("건축법#22"),
  }));

  // ── 해체 (향후)
  if (t.demolition) {
    const d = t.demolition;
    const small = M.gfa < d.a && M.height < d.h && M.floors + M.below <= d.floors;
    items.push(item({
      id: "C-DEMOLITION", stage: "준공·해체", title: "향후 해체 시 허가·신고", status: "대상",
      reason: [small ? `연면적 ${nf(M.gfa)}㎡ < ${d.a}㎡, 높이 ${nf(M.height)}m < ${d.h}m, ${M.floors + M.below}개 층 ≤ ${d.floors}개 층 — 전체 해체 시 신고 대상` : `연면적 ${nf(M.gfa)}㎡, 높이 ${nf(M.height)}m, ${M.floors + M.below}개 층 — 신고 기준(${d.a}㎡·${d.h}m·${d.floors}개 층 미만)을 넘어 해체 허가 대상`],
      duty: ["해체계획서를 첨부해 허가(또는 신고)하며, 허가 대상은 건축사·기술사 등이 작성·서명한 해체계획서가 필요합니다.", "주변에 버스 정류장·횡단보도 등 조례로 정한 시설이 있으면 소규모라도 허가 대상입니다."],
      when: "해체 착수 전", to: "허가권자",
      citations: [cite(d.f.c, d.f.line)],
    }));
  }

  const order: (keyof ConstructionInput)[] = ["publicClient", "ownerBuild", "towerCrane", "piling", "drill", "gangForm", "noisyEquip", "costEok"];
  const result: ConstructionResult = { items, asked: order.filter(k => asked.has(k)), sequence: [], fall, route, md: "" };
  result.sequence = sequence(f, M, items, t);
  result.md = constructionMarkdown(result, input);
  return result;
}

function midReports(floors: number, every: number): string[] {
  return [...new Set(["기초 철근배치 완료", ...Array.from({ length: Math.floor(floors / every) }, (_, i) => `지상 ${(i + 1) * every}층 상부 슬래브배근 완료`), "지붕슬래브배근 완료"])];
}

function cites(...xs: (string | [string, string | undefined])[]): Citation[] {
  return xs.map(x => { const [id, q] = Array.isArray(x) ? x : [x, undefined]; const ch = chunk(id); return ch ? cite(ch, q) : null; }).filter((x): x is Citation => !!x);
}

// ───────────────────────────── fall hazards ─────────────────────────────

/** Fall height that triggers protection: 산업안전보건기준에 관한 규칙 제44조(추락할 위험이 있는 높이 2미터 이상의 장소). */
function minDrop(): { h: number; f: Found | null } {
  const f = find("산업안전보건기준에관한규칙#44", /추락할\s*위험이\s*있는\s*높이\s*(\d+)미터\s*이상의\s*장소/);
  return { h: f ? Number(f.m[1]) : 2, f };
}

/**
 * Places where a worker can fall while the frame is going up. With slab geometry from the
 * worker (facts.construction): every slab edge at least 2 m above ground and every slab opening
 * over a drop of 2 m or more, with guardrail length and cover area per level. Without it (older
 * clients): one marker per floor and the stair/lift rooms. Rule basis: 산업안전보건기준에 관한 규칙
 * 제42조(추락의 방지), 제43조(개구부 등의 방호), 제44조(높이 2m 이상), 제13조(안전난간의 구조).
 */
function fallHazards(f: BimFacts, M: Measures): { item: ConstructionItem; summary?: FallSummary } {
  const drop = minDrop();
  const guard = find("산업안전보건기준에관한규칙#13", /상부\s*난간대는[^\n]*?(\d+)센티미터\s*이상/);
  const toe = find("산업안전보건기준에관한규칙#13", /발끝막이판은[^\n]*?(\d+)센티미터\s*이상/);
  const issues: BimIssue[] = [];
  const g = f.building.groundZ;
  const cf = f.construction;
  let n = 0;
  let summary: FallSummary | undefined;
  const rnd = (x: number) => Math.round(x * 10) / 10;

  if (cf && cf.levels.length) {
    const lv: FallSummary["levels"] = [];
    const top = cf.levels.at(-1);
    for (const L of cf.levels) {
      const edge = L.edgeDrop >= drop.h ? L.edgeLength : 0;
      const ops = L.openings.filter(o => o.drop >= drop.h);
      if (!edge && !ops.length) continue;
      const roof = L === top && cf.levels.length > 1;
      if (edge) issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: L.edgeDrop >= 10 ? "critical" : "major", title: `${L.storey} ${roof ? "옥상" : "슬래브"} 단부`, detail: `바닥 높이 ${fmt(rnd(L.edgeDrop))}m, 단부 길이 ${fmt(Math.round(L.edgeLength))}m — ${roof ? "옥상 난간(파라펫) 설치 전" : "골조 공사 중"} 안전난간 또는 추락방호망`, refs: [], at: edgePoint(L), storey: L.storey, measured: `${fmt(Math.round(L.edgeLength))}m` });
      for (const o of ops) {
        const label = o.kind === "승강로" ? "승강로 개구부" : o.kind === "계단" ? "계단실 개구부" : "바닥 개구부";
        const how = o.kind === "승강로" ? "승강기 설치 전까지 덮개 또는 안전난간·수직형 추락방망, 개구부 표시" : o.kind === "계단" ? "계단 설치 전 덮개 또는 안전난간" : "덮개(뒤집히거나 떨어지지 않게 고정) 또는 안전난간";
        issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: o.kind === "승강로" || o.drop >= 6 ? "critical" : "major", title: `${L.storey} ${label}`, detail: `${fmt(o.width)}×${fmt(o.length)}m(${fmt(o.area)}㎡), 아래로 ${fmt(rnd(o.drop))}m — ${how}`, refs: o.ref ? [o.ref] : [], at: [o.center[0], o.center[1], L.z], storey: L.storey, measured: `둘레 ${fmt(o.perimeter)}m` });
      }
      lv.push({ storeyId: L.storeyId, storey: L.storey, z: L.z, edge: Math.round(edge * 10) / 10, openings: ops.length, openingPerimeter: Math.round(ops.reduce((a, o) => a + o.perimeter, 0) * 10) / 10, openingArea: Math.round(ops.reduce((a, o) => a + o.area, 0) * 10) / 10 });
    }
    // Excavation edge while the basement is dug (흙막이 상부).
    if (M.dig >= drop.h && M.below > 0) issues.unshift({ id: "C-FALL-0", rule_id: "C-FALL", status: "UNCLEAR", severity: "critical", title: "굴착 단부(흙막이 상부)", detail: `굴착 깊이 ${M.digEstimated ? "≈ " : ""}${fmt(M.dig)}m, 둘레 약 ${fmt(Math.round(f.building.perimeter))}m — 굴착 기간 흙막이 상부 안전난간·추락방호망`, refs: cf.digRef ? [cf.digRef] : [], at: [...edgePoint(cf.levels[0]).slice(0, 2), g] as Vec3, storey: cf.levels[0].storey });
    summary = {
      minDrop: drop.h, levels: lv, source: "geometry",
      edgeTotal: Math.round(lv.reduce((a, x) => a + x.edge, 0)),
      openingCount: lv.reduce((a, x) => a + x.openings, 0),
      openingPerimeter: Math.round(lv.reduce((a, x) => a + x.openingPerimeter, 0)),
      openingArea: Math.round(lv.reduce((a, x) => a + x.openingArea, 0) * 10) / 10,
    };
  } else {
    // Fallback without slab geometry: one marker per floor + stair/lift rooms.
    const levels = f.storeys.filter(s => s.floorArea > 0.5 && s.elevation - g >= drop.h).sort((a, b) => a.elevation - b.elevation);
    const topLevel = levels.at(-1);
    for (const s of levels) {
      const sp = f.spaces.filter(x => x.storeyId === s.id);
      const cx = sp.length ? sp.reduce((a, x) => a + x.center[0], 0) / sp.length : 0;
      const cy = sp.length ? sp.reduce((a, x) => a + x.center[1], 0) / sp.length : 0;
      issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: "major", title: `${s.name} 슬래브 단부`, detail: `바닥 높이 ${fmt(rnd(s.elevation - g))}m, 외곽 둘레 약 ${fmt(Math.round(f.building.perimeter))}m — 골조 공사 중 안전난간 또는 추락방호망`, refs: [], at: [cx, cy, s.elevation], storey: s.name });
      for (const x of sp.filter(x => x.use === "계단실" || x.use === "승강기")) {
        const ref: ElemRef = x.ref;
        issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: x.use === "승강기" ? "critical" : "major", title: `${s.name} ${x.use === "승강기" ? "승강로" : "계단실"} 개구부`, detail: `${fmt(rnd(x.area))}㎡ — ${x.use === "승강기" ? "승강기 설치 전까지 승강로 개구부 덮개·안전난간, 개구부 표시" : "계단 설치 전 개구부 덮개 또는 안전난간"}`, refs: [ref], at: x.center, storey: s.name });
      }
    }
    if (topLevel && f.storeys.some(s => s.elevation > topLevel.elevation)) {
      const roof = f.storeys.filter(s => s.elevation > topLevel.elevation).sort((a, b) => b.elevation - a.elevation)[0];
      issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: "critical", title: `${roof.name} 옥상 단부`, detail: `높이 ${fmt(rnd(roof.elevation - g))}m — 옥상 난간 설치 전 안전난간·추락방호망`, refs: [], at: [issues.at(-1)?.at?.[0] ?? 0, issues.at(-1)?.at?.[1] ?? 0, roof.elevation], storey: roof.name });
    }
  }

  const openingsN = issues.filter(i => /개구부/.test(i.title)).length;
  const reason = !issues.length ? [`높이 ${drop.h}m 이상 바닥이 없습니다.`]
    : summary ? [
      `높이 ${drop.h}m 이상 슬래브 단부 ${summary.levels.filter(x => x.edge > 0).length}개 층(안전난간 약 ${fmt(summary.edgeTotal)}m), 바닥 개구부 ${summary.openingCount}곳(둘레 ${fmt(summary.openingPerimeter)}m, 덮개 면적 ${fmt(summary.openingArea)}㎡)을 슬래브 형상에서 찾았습니다.`,
      "개구부 덮개와 안전난간 중 무엇을 쓸지는 규칙이 정하지 않으므로 두 물량을 모두 보여 줍니다. 단변 0.2m 미만 구멍(슬리브 등)은 제외했습니다.",
      "추락은 건설업 사망사고의 51.2%(2024, 국토교통부)입니다.",
    ] : [`높이 ${drop.h}m 이상 슬래브 단부 ${issues.length - openingsN}곳, 계단실·승강로 개구부 ${openingsN}곳을 실 정보로 찾았습니다(슬래브 형상 분석 없는 이전 형식).`, "추락은 건설업 사망사고의 51.2%(2024, 국토교통부)입니다."];
  return {
    summary,
    item: item({
      id: "C-FALL", stage: "시공 중", title: "추락 위험 지점(BIM)", status: issues.length ? "대상" : "비대상", reason,
      duty: [`단부·개구부에는 안전난간, 울타리, 수직형 추락방망 또는 덮개를 설치하고 어두운 곳에서도 보이게 개구부임을 표시합니다(제43조).`, guard ? `안전난간은 상부 난간대 ${guard.m[1]}cm 이상, 중간 난간대, 발끝막이판 ${toe ? toe.m[1] : 10}cm 이상, 100kg 이상 하중에 견디는 구조로 합니다(제13조).` : "안전난간 구조 기준(산업안전보건기준에 관한 규칙 제13조)을 따릅니다.", "골조가 올라가는 순서대로 설치하고, 벽·계단·승강기 문이 들어선 뒤에 해체합니다."],
      when: "골조 공사 중", to: "사업주(시공사)",
      citations: [...(drop.f ? [cite(drop.f.c, drop.f.line)] : []), ...cites("산업안전보건기준에관한규칙#43"), ...(guard ? [cite(guard.c, guard.line)] : [])],
      issues,
      estimated: !summary,
    }),
  };
}

/** A point on the longest exterior edge segment of a level (for the viewer marker). */
function edgePoint(L: FallLevelFact): Vec3 {
  let best = -1, at: Vec3 = [0, 0, L.z];
  for (let k = 0; k + 3 < L.edges.length; k += 4) {
    const [x0, y0, x1, y1] = L.edges.slice(k, k + 4);
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > best) { best = len; at = [(x0 + x1) / 2, (y0 + y1) / 2, L.z]; }
  }
  return at;
}

// ───────────────────────────── construction sequence (4D view) ─────────────────────────────

type T = ReturnType<typeof thresholds>;

/**
 * The order the building goes up — 착공 준비 → 굴착·흙막이 → 기초 → 층별 골조 → 지붕 → 준공 —
 * with each duty and hazard placed where it falls. Durations are not estimated (no statutory basis);
 * the 4D link is the order and the floor, as in Sulankivi et al. (2013).
 */
function sequence(f: BimFacts, M: Measures, items: ConstructionItem[], t: T): SequenceStep[] {
  const by = (id: string) => items.find(i => i.id === id);
  const duty = (id: string) => { const i = by(id); return i && i.status !== "비대상" ? [{ id: i.id, title: i.title, status: i.status }] : []; };
  const fall = by("C-FALL");
  const steps: SequenceStep[] = [];
  steps.push({ key: "prep", label: "허가·착공 준비", kind: "prep", duties: items.filter(i => i.stage === "착공 전" && i.status !== "비대상").map(i => ({ id: i.id, title: i.title, status: i.status })), notes: [], issues: [] });
  if (M.below > 0 || M.dig >= 2) {
    const notes: string[] = [`굴착 깊이 ${M.digNote}`];
    if (t.shore && M.dig >= t.shore.h) notes.push(`흙막이 지보공 ${t.shore.h}m 이상 — 시공 전 관계전문가 구조안전 확인`);
    if (t.residentDig && M.dig >= t.residentDig.d) notes.push(`굴착 ${t.residentDig.d}m 이상 — 굴착 기간 건축사보 상주(건축법 시행령 제19조)`);
    const ug = by("C-UNDERGROUND");
    if (ug?.status === "대상") notes.push("착공후지하안전조사 실시·통보");
    steps.push({ key: "dig", label: "굴착·흙막이", kind: "excavation", duties: [...duty("C-UNDERGROUND"), ...duty("C-TEMP-WORKS")], notes, issues: fall?.issues.filter(i => i.id === "C-FALL-0").map(i => i.id) ?? [] });
  }
  const rc = /철근\s*콘크리트|RC/i.test(M.structure);
  steps.push({ key: "foundation", label: "기초", kind: "foundation", duties: [], notes: rc ? ["감리중간보고: 기초 철근배치 완료"] : [], issues: [] });
  const g = f.building.groundZ;
  const storeys = [...f.storeys].filter(s => s.floorArea > 0.5 || f.construction?.levels.some(l => l.storeyId === s.id)).sort((a, b) => a.elevation - b.elevation);
  const top = storeys.at(-1);
  let scaffoldNoted = false;
  let aboveIdx = 0;
  for (const s of storeys) {
    const isRoof = s === top && storeys.length > 1 && !s.habitableArea && s.floorArea < (storeys[storeys.length - 2]?.floorArea ?? 0) * 0.6;
    const notes: string[] = [];
    if (s.above) aboveIdx++;
    if (t.form && s.height >= t.form.h && !isRoof) notes.push(`층고 ${fmt(s.height)}m — 거푸집·동바리 ${t.form.h}m 이상 구조안전 확인`);
    const topZ = s === top ? Math.max(s.elevation + (isRoof ? 0 : s.height) - g, M.height) : s.elevation + s.height - g;
    if (t.scaffold && !scaffoldNoted && topZ >= t.scaffold.h) { notes.push(`외부 비계 높이 ${t.scaffold.h}m 도달 — 비계 구조안전 확인 대상 구간`); scaffoldNoted = true; }
    if (rc && t.midReportRc && s.above && !isRoof && aboveIdx % t.midReportRc.every === 0) notes.push(`감리중간보고: 지상 ${aboveIdx}층 상부 슬래브배근 완료`);
    if (rc && isRoof) notes.push("감리중간보고: 지붕슬래브배근 완료");
    const issues = fall?.issues.filter(i => i.storey === s.name && i.id !== "C-FALL-0").map(i => i.id) ?? [];
    steps.push({ key: `s${s.id}`, label: isRoof ? `${s.name} (지붕)` : `${s.name} 골조`, kind: isRoof ? "roof" : "frame", storeyId: s.id, duties: [], notes, issues });
  }
  steps.push({ key: "done", label: "마감·준공", kind: "completion", duties: duty("C-COMPLETION"), notes: [by("C-SAFETY-PLAN")?.status === "대상" ? "안전점검 종합보고서 제출" : "", "외부 비계·안전난간 해체(벽·난간·승강기 문 설치 후)"].filter(Boolean), issues: [] });
  return steps;
}

// ───────────────────────────── report ─────────────────────────────

export function constructionMarkdown(r: ConstructionResult, input: ConstructionInput = {}): string {
  const out = ["## 시공 단계 검토", "", `절차 경로: ${r.route}${input.startDate ? ` · 착공 예정일 ${input.startDate}` : ""}`, "", "| 단계 | 항목 | 판정 | 시기 | 근거 |", "|---|---|---|---|---|"];
  for (const i of r.items) out.push(`| ${i.stage} | ${i.title} | ${i.status}${i.estimated ? "(추정 포함)" : ""} | ${i.deadline?.date ? `${i.deadline.date}까지 권장` : i.when || "-"} | ${[...new Set(i.citations.map(x => x.label))].join(", ") || "-"} |`);
  out.push("");
  for (const i of r.items.filter(x => x.status !== "비대상")) {
    out.push(`### ${i.title} — ${i.status}`, "", ...i.reason.map(x => `- ${x}`), ...i.duty.map(x => `- 할 일: ${x}`));
    if (i.deadline) out.push(`- 기한: ${i.deadline.date ? `${i.deadline.date}까지 제출 권장(착공 ${i.deadline.days}일 전)` : `착공 ${i.deadline.days}일 전까지 제출 권장`} — ${i.deadline.basis}`);
    out.push("");
    for (const iss of i.issues.slice(0, 30)) out.push(`- [${iss.storey || ""}] ${iss.title}: ${iss.detail}`);
    if (i.issues.length) out.push("");
  }
  if (r.fall) {
    out.push("### 추락 방호 물량(골조 공사 중)", "", "| 층 | 단부 안전난간(m) | 개구부(곳) | 개구부 둘레(m) | 덮개 면적(㎡) |", "|---|---|---|---|---|");
    for (const l of r.fall.levels) out.push(`| ${l.storey} | ${fmt(l.edge)} | ${l.openings} | ${fmt(l.openingPerimeter)} | ${fmt(l.openingArea)} |`);
    out.push(`| 합계 | ${fmt(r.fall.edgeTotal)} | ${r.fall.openingCount} | ${fmt(r.fall.openingPerimeter)} | ${fmt(r.fall.openingArea)} |`, "");
  }
  if (r.sequence.length) {
    out.push("### 공정 순서", "");
    r.sequence.forEach((s, k) => out.push(`${k + 1}. ${s.label}${s.duties.length ? ` — ${s.duties.map(d => d.title).join(", ")}` : ""}${s.notes.length ? ` · ${s.notes.join(" · ")}` : ""}${s.issues.length ? ` · 추락 위험 ${s.issues.length}곳` : ""}`));
    out.push("");
  }
  if (r.asked.length) out.push(`> 입력하면 판정이 확정되는 항목: ${r.asked.map(k => INPUT_LABEL[k]).join(", ")}`);
  return out.join("\n");
}

export const INPUT_LABEL: Record<keyof ConstructionInput, string> = {
  publicClient: "공공(발주청) 발주 공사", ownerBuild: "건축주 직접 시공", towerCrane: "타워크레인 사용", piling: "항타·항발기 사용", drill: "높이 10m 이상 천공기 사용",
  gangForm: "작업발판 일체형 거푸집(갱폼·ACS)", noisyEquip: "특정건설기계 5일 이상 사용", costEok: "공사예정금액", startDate: "착공 예정일",
};
