// 시공 단계 검토 — which construction-stage duties a building triggers, judged from the
// same measured BimFacts the design review uses.
//
// Research basis (docs: "BuildLex 시공단계 법규검토 추가 계획"): BIM safety rule checking
// (Sulankivi·Zhang·Teizer 2013; Guo et al. 2016) and the KRIHS DfS–BIM proposal (2020)
// detect fall hazards and applicability from the model before construction starts.
// As in the design review, every threshold is parsed from the statute text in the
// corpus and cited with the line it came from; the LLM never decides applicability.
// Facts the design model cannot hold (public client, cranes, owner-built) are inputs;
// when one is missing the duty is "확인 필요", never silently "비대상".
import { loadNational } from "../corpus.ts";
import { cite, fmt, str } from "../review/skills/common.ts";
import type { Citation, ProjectValues } from "../review/types.ts";
import type { Chunk } from "../types.ts";
import type { BimFacts, BimIssue, ElemRef, StoreyFact, Vec3 } from "./types.ts";

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
};

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
  citations: Citation[];
  issues: BimIssue[];
};

export type ConstructionResult = { items: ConstructionItem[]; asked: (keyof ConstructionInput)[]; md: string };

const chunk = (id: string): Chunk | undefined => loadNational().byId.get(id);
const lines = (t: string) => t.split("\n").map(l => l.trim()).filter(Boolean);

/** "3만" → 30000, "5천" → 5000, "500" → 500 */
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
  const fac = chunk("시설물의안전및유지관리에관한특별법#7");
  const facLines = fac ? lines(fac.text).filter(l => /층\s*이상\s*또는\s*연면적/.test(l)) : [];
  const facOf = (l?: string) => { const m = l?.match(/(\d+)층\s*이상\s*또는\s*연면적\s*([\d만천]+)제곱미터/); return m && l ? { floors: Number(m[1]), area: kNum(m[2]), line: l } : null; };
  const scaffold = find("건설기술진흥법시행령#101의2", /높이가\s*(\d+)미터\s*이상인\s*비계/);
  const form = find("건설기술진흥법시행령#101의2", /높이가\s*(\d+)미터\s*이상인\s*거푸집\s*및\s*동바리/);
  const shore = find("건설기술진흥법시행령#101의2", /높이가\s*(\d+)미터\s*이상인\s*흙막이\s*지보공/);
  const psmH = find("산업안전보건법시행령#42", /지상높이가\s*(\d+)미터\s*이상/);
  const psmA = find("산업안전보건법시행령#42", /연면적\s*([\d만천]+)제곱미터\s*이상인\s*건축물$/);
  const psmU = find("산업안전보건법시행령#42", /연면적\s*([\d만천]+)제곱미터\s*이상인\s*시설로서/);
  const psmD = find("산업안전보건법시행령#42", /깊이\s*(\d+)미터\s*이상인\s*굴착공사/);
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
  return {
    safetyPlan: sp ? { lo: Number(sp.m[1]), hi: Number(sp.m[2]), f: sp } : null,
    safetyDig: dig ? { depth: Number(dig.m[1]), f: dig } : null,
    safetyReno: reno ? { floors: Number(reno.m[1]), f: reno } : null,
    safetyEquip: equip,
    class1: facOf(facLines[0]), class2: facOf(facLines[1]), facChunk: fac,
    scaffold: scaffold ? { h: Number(scaffold.m[1]), f: scaffold } : null,
    form: form ? { h: Number(form.m[1]), f: form } : null,
    shore: shore ? { h: Number(shore.m[1]), f: shore } : null,
    psmHeight: psmH ? { h: Number(psmH.m[1]), f: psmH } : null,
    psmArea: psmA ? { a: kNum(psmA.m[1]), f: psmA } : null,
    psmUse: psmU ? { a: kNum(psmU.m[1]), f: psmU } : null,
    psmDig: psmD ? { d: Number(psmD.m[1]), f: psmD } : null,
    demolition: demA && demH && demF ? { a: Number(demA.m[1]), h: Number(demH.m[1]), floors: Number(demF.m[1]), f: demA } : null,
    multiUse: multi ? { a: kNum(multi.m[1]), f: multi } : null,
    multiFloors: multiF ? { floors: Number(multiF.m[1]), f: multiF } : null,
    resident: resA && resF ? { a: kNum(resA.m[1]), floors: Number(resF.m[1]), a2: kNum(resF.m[2]), f: resA, f2: resF } : null,
    residentDig: resDig ? { d: Number(resDig.m[1]), f: resDig } : null,
    midReportRc: midRc ? { every: Number(midRc.m[1]), f: midRc } : null,
    direct: direct ? { a: Number(direct.m[1]), f: direct } : null,
  };
}

// Use lists in 산업안전보건법 시행령 제42조③1다 and 건축법 시행령 제2조17가 (matched on 주용도).
const PSM_USE = /문화\s*및\s*집회|판매시설|운수시설|종교시설|종합병원|관광\s*숙박|지하도\s*상가|냉동|냉장/;
const MULTI_USE = /문화\s*및\s*집회|종교시설|판매시설|여객|종합병원|관광\s*숙박/;

// ───────────────────────────── measured quantities ─────────────────────────────

type Measures = {
  floors: number; below: number; height: number; gfa: number; use: string; apartment: boolean; housing: boolean;
  /** Estimated excavation depth below grade (m); 0 when there is no basement. */
  dig: number; digEstimated: boolean;
  maxStoreyHeight: number; maxStoreyName: string;
  pilotis: boolean; groundFloor?: StoreyFact;
  structure: string;
};

function measures(f: BimFacts, v: ProjectValues): Measures {
  const b = f.building;
  const use = str(v, "주용도") || String(f.kr["주용도"] ?? "");
  const lowest = [...f.storeys].sort((a, c) => a.elevation - c.elevation)[0];
  // Excavation = grade to the lowest floor + an assumed 1.0 m for the foundation and blinding.
  const dig = b.storeysBelow > 0 && lowest ? Math.max(0, b.groundZ - lowest.elevation) + 1.0 : 0;
  const above = f.storeys.filter(s => s.above && s.floorArea > 0.5).sort((a, c) => a.elevation - c.elevation);
  const tallest = [...f.storeys].filter(s => s.floorArea > 0.5).sort((a, c) => c.height - a.height)[0];
  const ground = above[0];
  const upper = above.slice(1).map(s => s.floorArea).sort((a, c) => a - c);
  const median = upper.length ? upper[Math.floor(upper.length / 2)] : 0;
  return {
    floors: b.storeysAbove, below: b.storeysBelow, height: b.height, gfa: b.grossFloorArea, use,
    apartment: /아파트/.test(use), housing: /공동주택|아파트|연립|다세대|기숙사/.test(use),
    dig, digEstimated: b.storeysBelow > 0,
    maxStoreyHeight: tallest?.height ?? 0, maxStoreyName: tallest?.name ?? "",
    // 필로티 추정: the ground floor encloses under half of a typical upper floor.
    pilotis: !!ground && upper.length >= 2 && median > 0 && ground.floorArea < median * 0.5,
    groundFloor: ground,
    structure: str(v, "구조") || String(f.kr["구조"] ?? ""),
  };
}

// ───────────────────────────── items ─────────────────────────────

const yes = (t?: Tri) => t === "yes";
const known = (t?: Tri) => t === "yes" || t === "no";
const c = (x: { f: Found } | Found | null | undefined): Citation[] => (x ? ["f" in x ? x.f : x] : []).map(y => cite(y.c, y.line));

function item(p: Omit<ConstructionItem, "issues" | "citations"> & { citations?: Citation[]; issues?: BimIssue[] }): ConstructionItem {
  return { citations: [], issues: [], ...p };
}

export function reviewConstruction(f: BimFacts, v: ProjectValues, input: ConstructionInput = {}): ConstructionResult {
  const t = thresholds();
  const M = measures(f, v);
  const items: ConstructionItem[] = [];
  const asked = new Set<keyof ConstructionInput>();
  const nf = (x: number) => fmt(Math.round(x * 100) / 100);

  // 1·2종 시설물 (시설물안전법 제7조) — feeds 안전관리계획 1호.
  const cls = t.class1 && (M.floors >= t.class1.floors || M.gfa >= t.class1.area) ? "1종"
    : t.class2 && (M.floors >= t.class2.floors || M.gfa >= t.class2.area) ? "2종" : null;

  // 가설구조물 (건설기술진흥법 시행령 제101조의2) — estimated from the model.
  const temp: string[] = [];
  if (t.scaffold && M.height >= t.scaffold.h) temp.push(`외부 비계 높이 ≈ 건물 높이 ${nf(M.height)}m ≥ ${t.scaffold.h}m`);
  if (t.form && M.maxStoreyHeight >= t.form.h) temp.push(`최고 층고 ${nf(M.maxStoreyHeight)}m(${M.maxStoreyName}) ≥ 거푸집·동바리 ${t.form.h}m`);
  if (t.shore && M.dig >= t.shore.h) temp.push(`굴착 깊이 ≈ ${nf(M.dig)}m ≥ 흙막이 지보공 ${t.shore.h}m`);

  // ── 안전관리계획
  {
    const why: string[] = [];
    if (cls) why.push(`${cls}시설물(지상 ${M.floors}층, 연면적 ${nf(M.gfa)}㎡)`);
    if (t.safetyPlan && M.floors >= t.safetyPlan.lo && M.floors < t.safetyPlan.hi) why.push(`지상 ${M.floors}층 — ${t.safetyPlan.lo}층 이상 ${t.safetyPlan.hi}층 미만`);
    if (t.safetyDig && M.dig >= t.safetyDig.depth) why.push(`지하 굴착 ≈ ${nf(M.dig)}m ≥ ${t.safetyDig.depth}m`);
    if (temp.length) why.push(`가설구조물 사용(${temp.length}종, 아래 항목)`);
    const equip = [yes(input.towerCrane) && "타워크레인", yes(input.piling) && "항타·항발기", yes(input.drill) && "높이 10m 이상 천공기"].filter(Boolean) as string[];
    if (equip.length) why.push(`건설기계 사용: ${equip.join(", ")}`);
    const equipKnown = known(input.towerCrane) && known(input.piling) && known(input.drill);
    if (!equipKnown) (["towerCrane", "piling", "drill"] as const).forEach(k => asked.add(k));
    const status: ConstructionStatus = why.length ? "대상" : equipKnown ? "비대상" : "확인 필요";
    const reason = why.length ? why : [
      `지상 ${M.floors}층(기준 ${t.safetyPlan?.lo ?? "?"}층 이상 ${t.safetyPlan?.hi ?? "?"}층 미만), 굴착 ${M.below ? `≈ ${nf(M.dig)}m` : "지하층 없음"}(기준 ${t.safetyDig?.depth ?? "?"}m), 1·2종 시설물 아님`,
      ...(equipKnown ? [] : ["타워크레인·항타기·천공기 사용 계획을 입력하면 판정이 확정됩니다."]),
    ];
    items.push(item({
      id: "C-SAFETY-PLAN", stage: "착공 전", title: "건설공사 안전관리계획", status, reason,
      duty: ["안전관리계획을 수립해 착공 전에 발주자(민간 공사는 인·허가기관)의 승인을 받아야 합니다.", "공정별 안전점검계획, 주변 안전대책, 안전관리비 집행계획 등 7개 항목을 포함합니다(시행령 제99조).", "유해위험방지계획서 대상이면 두 계획을 통합해 작성할 수 있습니다."],
      when: "착공 전 승인", to: "발주자 또는 인·허가기관",
      estimated: why.some(w => w.includes("≈")),
      citations: [...cites("건설기술진흥법#62"), ...c(t.safetyPlan), ...c(t.safetyDig), ...(cls && t.facChunk ? [cite(t.facChunk, (cls === "1종" ? t.class1 : t.class2)!.line)] : []), ...(equip.length ? c(t.safetyEquip) : [])],
    }));
  }
  const safetyPlan = items[0];

  // ── 설계안전성검토 (DfS) — 안전관리계획 대상 중 건설기계 사용만으로 대상인 공사는 제외(시행령 제75조의2①).
  {
    const byCriteria = safetyPlan.reason.length > 0 && safetyPlan.status === "대상" && safetyPlan.reason.some(r => !r.startsWith("건설기계"));
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
    id: "C-TEMP-WORKS", stage: "착공 전", title: "가설구조물 구조안전 확인", status: temp.length ? "대상" : "비대상",
    reason: temp.length ? temp : [`건물 높이 ${nf(M.height)}m, 최고 층고 ${nf(M.maxStoreyHeight)}m, 굴착 ${M.below ? `≈ ${nf(M.dig)}m` : "지하층 없음"} — 비계 ${t.scaffold?.h ?? "?"}m·거푸집 ${t.form?.h ?? "?"}m·흙막이 ${t.shore?.h ?? "?"}m 기준 미만`, "브라켓 비계·작업발판 일체형 거푸집 등 공법으로 대상이 되는 경우는 시공계획으로 확인하세요."],
    duty: ["시공 전에 관계전문가(시공사에 고용되지 않은 기술사)가 서명한 구조계산서와 시공상세도면을 공사감독자·건설사업관리기술인에게 제출합니다."],
    when: "해당 가설구조물 시공 전", to: "공사감독자 또는 건설사업관리기술인", estimated: temp.length > 0,
    citations: [...c(t.scaffold), ...c(t.form), ...c(t.shore)],
  }));

  // ── 유해위험방지계획서
  {
    const why: string[] = [];
    if (t.psmHeight && M.height >= t.psmHeight.h) why.push(`지상높이 ${nf(M.height)}m ≥ ${t.psmHeight.h}m`);
    if (t.psmArea && M.gfa >= t.psmArea.a) why.push(`연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.psmArea.a)}㎡`);
    if (t.psmUse && M.gfa >= t.psmUse.a && PSM_USE.test(M.use)) why.push(`${M.use} 연면적 ${nf(M.gfa)}㎡ ≥ ${fmt(t.psmUse.a)}㎡`);
    if (t.psmDig && M.dig >= t.psmDig.d) why.push(`굴착 깊이 ≈ ${nf(M.dig)}m ≥ ${t.psmDig.d}m`);
    items.push(item({
      id: "C-PSM", stage: "착공 전", title: "건설공사 유해위험방지계획서", status: why.length ? "대상" : "비대상",
      reason: why.length ? why : [`지상높이 ${nf(M.height)}m(기준 ${t.psmHeight?.h ?? "?"}m), 연면적 ${nf(M.gfa)}㎡(기준 ${fmt(t.psmArea?.a ?? NaN)}㎡), 굴착 ${M.below ? `≈ ${nf(M.dig)}m` : "지하층 없음"}(기준 ${t.psmDig?.d ?? "?"}m) — 모두 미만`],
      duty: ["건설안전 분야 자격자의 의견을 들어 작성하고, 착공 전날까지 한국산업안전보건공단에 2부 제출해 심사를 받습니다.", "안전관리계획 대상이면 통합 작성할 수 있습니다."],
      when: "착공 전날까지", to: "한국산업안전보건공단", estimated: why.some(w => w.includes("≈")),
      citations: [...cites("산업안전보건법#42"), ...c(t.psmHeight), ...c(t.psmArea), ...c(t.psmDig), ...cites(["산업안전보건법시행규칙#42", "공단에 2부를 제출"])],
    }));
  }

  // ── 착공신고
  items.push(item({
    id: "C-START", stage: "착공 전", title: "착공신고", status: "대상",
    reason: ["건축허가를 받거나 건축신고를 한 건축물은 모두 해당합니다."],
    duty: ["공사 착수 전 허가권자에게 공사계획을 신고합니다(공사감리자·시공자 함께 서명).", "허가 대상 건축물은 설계·감리·시공 계약서 사본을 첨부합니다.", "허가권자는 3일 이내 수리 여부를 통지하며, 통지가 없으면 수리된 것으로 봅니다."],
    when: "공사 착수 전", to: "허가권자(시·군·구청장)",
    citations: cites("건축법#21"),
  }));

  // ── 공사감리 · 상주감리 · 감리중간보고
  {
    const multi = (t.multiFloors && M.floors >= t.multiFloors.floors) || (t.multiUse && M.gfa >= t.multiUse.a && MULTI_USE.test(M.use));
    const reason = [multi ? "다중이용 건축물 — 건설엔지니어링사업자(또는 건설사업관리기술인을 배치한 건축사)를 감리자로 지정" : "건축허가 대상 건축물 — 건축사를 공사감리자로 지정"];
    const res: string[] = [];
    if (t.resident) {
      if (M.gfa >= t.resident.a) res.push(`바닥면적 합계 ${nf(M.gfa)}㎡ ≥ ${fmt(t.resident.a)}㎡`);
      const run = M.floors + M.below;
      if (run >= t.resident.floors && M.gfa >= t.resident.a2) res.push(`연속 ${run}개 층 · ${nf(M.gfa)}㎡ ≥ ${t.resident.floors}개 층 · ${fmt(t.resident.a2)}㎡`);
    }
    if (M.apartment) res.push("아파트 건축공사");
    reason.push(res.length ? `상주감리 대상: ${res.join(", ")}` : `상주감리 비대상(바닥면적 합계 ${nf(M.gfa)}㎡, 연속 ${M.floors + M.below}개 층)`);
    if (!res.length && t.residentDig && M.dig >= t.residentDig.d) reason.push(`굴착 ≈ ${nf(M.dig)}m ≥ ${t.residentDig.d}m — 굴착공사 기간 건축·토목 분야 건축사보 상주`);
    if (/철근\s*콘크리트|RC/i.test(M.structure) && t.midReportRc) {
      const every = t.midReportRc.every;
      const steps = ["기초 철근배치 완료", ...Array.from({ length: Math.floor(M.floors / every) }, (_, i) => `지상 ${(i + 1) * every}층 상부 슬래브배근 완료`), "지붕슬래브배근 완료"];
      reason.push(`감리중간보고 시점(철근콘크리트조): ${[...new Set(steps)].join(" → ")}`);
    }
    items.push(item({
      id: "C-SUPERVISION", stage: "시공 중", title: "공사감리·상주감리", status: "대상", reason,
      duty: ["감리일지를 기록하고, 정해진 공정마다 감리중간보고서를, 완료 후 감리완료보고서를 건축주에게 제출합니다.", "위반 사항은 시정·재시공을 요청하고 따르지 않으면 허가권자에게 보고합니다."],
      when: "착공~준공", to: "건축주 → 허가권자",
      citations: [...cites("건축법#25", ["건축법시행령#19", t.resident?.f.line]), ...c(t.midReportRc)],
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
  items.push(fallHazards(f, M));

  // ── 사용승인
  items.push(item({
    id: "C-COMPLETION", stage: "준공·해체", title: "사용승인", status: "대상",
    reason: ["허가·신고 건축물은 공사 완료 후 사용승인을 받아야 사용할 수 있습니다."],
    duty: ["감리완료보고서와 공사완료도서를 첨부해 사용승인을 신청합니다.", "허가권자는 설계도서대로 시공했는지 검사한 뒤 사용승인서를 내줍니다."],
    when: "공사 완료 후", to: "허가권자",
    citations: cites("건축법#22"),
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

  const order: (keyof ConstructionInput)[] = ["publicClient", "ownerBuild", "towerCrane", "piling", "drill"];
  const result: ConstructionResult = { items, asked: order.filter(k => asked.has(k)), md: "" };
  result.md = constructionMarkdown(result);
  return result;
}

function cites(...xs: (string | [string, string | undefined])[]): Citation[] {
  return xs.map(x => { const [id, q] = Array.isArray(x) ? x : [x, undefined]; const ch = chunk(id); return ch ? cite(ch, q) : null; }).filter((x): x is Citation => !!x);
}

// ───────────────────────────── fall hazards ─────────────────────────────

/**
 * Places where a worker can fall while the frame is going up: every slab edge at or
 * above 2 m and every shaft (stair, lift) that is an open hole until its stair or doors
 * are in. Rule basis: 산업안전보건기준에 관한 규칙 제43조(개구부 방호) and 제13조(안전난간).
 */
function fallHazards(f: BimFacts, M: Measures): ConstructionItem {
  const issues: BimIssue[] = [];
  const g = f.building.groundZ;
  const levels = f.storeys.filter(s => s.floorArea > 0.5 && s.elevation - g >= 2).sort((a, b) => a.elevation - b.elevation);
  const top = levels.at(-1);
  let n = 0;
  for (const s of levels) {
    const sp = f.spaces.filter(x => x.storeyId === s.id);
    const cx = sp.length ? sp.reduce((a, x) => a + x.center[0], 0) / sp.length : 0;
    const cy = sp.length ? sp.reduce((a, x) => a + x.center[1], 0) / sp.length : 0;
    const at: Vec3 = [cx, cy, s.elevation];
    issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: "major", title: `${s.name} 슬래브 단부`, detail: `바닥 높이 ${fmt(Math.round((s.elevation - g) * 10) / 10)}m, 외곽 둘레 약 ${fmt(Math.round(f.building.perimeter))}m — 골조 공사 중 안전난간 또는 추락방호망`, refs: [], at, storey: s.name });
    for (const x of sp.filter(x => x.use === "계단실" || x.use === "승강기")) {
      const ref: ElemRef = x.ref;
      issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: x.use === "승강기" ? "critical" : "major", title: `${s.name} ${x.use === "승강기" ? "승강로" : "계단실"} 개구부`, detail: `${fmt(Math.round(x.area * 10) / 10)}㎡ — ${x.use === "승강기" ? "승강기 설치 전까지 승강로 개구부 덮개·안전난간, 개구부 표시" : "계단 설치 전 개구부 덮개 또는 안전난간"}`, refs: [ref], at: x.center, storey: s.name });
    }
  }
  if (top && f.storeys.some(s => s.elevation > top.elevation)) {
    // roof level above the last occupied floor
    const roof = f.storeys.filter(s => s.elevation > top.elevation).sort((a, b) => b.elevation - a.elevation)[0];
    issues.push({ id: `C-FALL-${++n}`, rule_id: "C-FALL", status: "UNCLEAR", severity: "critical", title: `${roof.name} 옥상 단부`, detail: `높이 ${fmt(Math.round((roof.elevation - g) * 10) / 10)}m — 옥상 난간 설치 전 안전난간·추락방호망`, refs: [], at: [issues.at(-1)?.at?.[0] ?? 0, issues.at(-1)?.at?.[1] ?? 0, roof.elevation], storey: roof.name });
  }
  const guard = find("산업안전보건기준에관한규칙#13", /상부\s*난간대는[^\n]*?(\d+)센티미터\s*이상/);
  return item({
    id: "C-FALL", stage: "시공 중", title: "추락 위험 지점(BIM)", status: issues.length ? "대상" : "비대상",
    reason: issues.length ? [`높이 2m 이상 슬래브 단부 ${levels.length}개 층, 계단실·승강로 개구부 ${issues.filter(i => /개구부/.test(i.title)).length}곳을 모델에서 찾았습니다.`, "추락은 건설 사망사고 1위 유형입니다(국토연구원 WP 20-01)."] : ["높이 2m 이상 바닥이 없습니다."],
    duty: [`개구부·단부에는 안전난간, 울타리, 수직형 추락방망 또는 덮개를 설치하고 개구부임을 표시합니다.`, guard ? `안전난간은 상부 난간대 ${guard.m[1]}cm 이상, 중간 난간대, 발끝막이판 10cm 이상, 100kg 하중에 견디는 구조로 합니다.` : "안전난간 구조 기준(산업안전보건기준에 관한 규칙 제13조)을 따릅니다."],
    when: "골조 공사 중", to: "사업주(시공사)",
    citations: [...cites("산업안전보건기준에관한규칙#43"), ...(guard ? [cite(guard.c, guard.line)] : [])],
    issues,
    estimated: true,
  });
}

// ───────────────────────────── report ─────────────────────────────

export function constructionMarkdown(r: ConstructionResult): string {
  const out = ["## 시공 단계 검토", "", "| 단계 | 항목 | 판정 | 시기 | 근거 |", "|---|---|---|---|---|"];
  for (const i of r.items) out.push(`| ${i.stage} | ${i.title} | ${i.status}${i.estimated ? "(추정 포함)" : ""} | ${i.when || "-"} | ${[...new Set(i.citations.map(x => x.label))].join(", ") || "-"} |`);
  out.push("");
  for (const i of r.items.filter(x => x.status !== "비대상")) {
    out.push(`### ${i.title} — ${i.status}`, "", ...i.reason.map(x => `- ${x}`), ...i.duty.map(x => `- 할 일: ${x}`), "");
    for (const iss of i.issues.slice(0, 20)) out.push(`- [${iss.storey || ""}] ${iss.title}: ${iss.detail}`);
    if (i.issues.length) out.push("");
  }
  if (r.asked.length) out.push(`> 입력하면 판정이 확정되는 항목: ${r.asked.map(k => INPUT_LABEL[k]).join(", ")}`);
  return out.join("\n");
}

export const INPUT_LABEL: Record<keyof ConstructionInput, string> = {
  publicClient: "공공(발주청) 발주 공사", ownerBuild: "건축주 직접 시공", towerCrane: "타워크레인 사용", piling: "항타·항발기 사용", drill: "높이 10m 이상 천공기 사용",
};
