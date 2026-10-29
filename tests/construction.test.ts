import assert from "node:assert/strict";
import { test } from "node:test";
import { constructionFacts } from "../lib/bim/construction-facts.ts";
import { kNum, minusDays, reviewConstruction, thresholds } from "../lib/bim/construction.ts";
import type { BimFacts, ParsedElement, SpaceFact, StoreyFact } from "../lib/bim/types.ts";
import type { ProjectValues } from "../lib/review/types.ts";

/** Minimal model: n storeys above (3 m each), b basements, given floor area per storey. */
function facts(o: { floors: number; below?: number; area?: number; storeyHeight?: number; use?: string; structure?: string; pilotis?: boolean; units?: number; zone?: string; dig?: number }): { f: BimFacts; v: ProjectValues } {
  const h = o.storeyHeight ?? 3, area = o.area ?? 300, below = o.below ?? 0;
  const storeys: StoreyFact[] = [];
  for (let i = -below; i < o.floors; i++) storeys.push({ id: 100 + i, name: i < 0 ? `지하${-i}층` : `${i + 1}층`, elevation: i * h, height: h, above: i >= 0, evacuation: i === 0, floorArea: o.pilotis && i === 0 ? area * 0.2 : area, floorAreaOuter: area, habitableArea: area * 0.6, units: 1, stairCount: 1 });
  const spaces = storeys.filter(s => s.above).map(s => ({ ref: { id: s.id * 10, guid: `g${s.id}`, name: `승강기 ${s.name}`, type: "IfcSpace", storey: s.name }, storeyId: s.id, use: "승강기" as const, useSource: "name" as const, label: "승강기", area: 2.5, height: h, heightSource: "geometry" as const, perimeter: 6.4, minWidth: 1.5, windowArea: 0, windows: [], center: [5, 5, s.elevation] as [number, number, number] }));
  const gfa = storeys.reduce((a, s) => a + s.floorArea, 0);
  const f = {
    version: 1, source: { file: "t.ifc", schema: "IFC2X3", project: "t", elements: 0, triangles: 0 }, kr: {},
    site: { areaSource: "none", north: [0, 1], northSource: "default" },
    building: { groundZ: 0, height: o.floors * h + 1.2, footprintOuter: area, footprint: area, perimeter: 70, wallThickness: 0.2, areaTolerance: 0, storeysAbove: o.floors, storeysBelow: below, grossFloorArea: gfa, farFloorArea: gfa, farExcluded: [], landscape: [] },
    storeys, spaces, stairs: [], doors: [], railings: [], parking: [], egress: [], quality: [],
    north: { available: false, frontier: [], perElement: [] },
    ...(o.dig !== undefined ? { construction: { cell: 0.1, levels: [], dig: o.dig, digSource: "foundation", digRef: { id: 1, guid: "f", name: "기초", type: "IfcFooting" } } } : {}),
  } as unknown as BimFacts;
  const v: ProjectValues = { 주용도: { value: o.use ?? "공동주택(다세대주택)", raw: "t", source: "user", confidence: "HIGH" }, 구조: { value: o.structure ?? "철근콘크리트조", raw: "t", source: "user", confidence: "HIGH" } };
  if (o.units !== undefined) v.세대수 = { value: o.units, raw: "t", source: "user", confidence: "HIGH" };
  if (o.zone) v.용도지역 = { value: o.zone, raw: "t", source: "user", confidence: "HIGH" };
  return { f, v };
}
const status = (r: ReturnType<typeof reviewConstruction>, id: string) => r.items.find(i => i.id === id)?.status;
const allNo = { towerCrane: "no", piling: "no", drill: "no" } as const;

test("thresholds are read from the statute text in the corpus", () => {
  const t = thresholds();
  assert.deepEqual([t.safetyPlan?.lo, t.safetyPlan?.hi, t.safetyDig?.depth], [10, 16, 10]);
  assert.deepEqual([t.class1?.floors, t.class1?.area, t.class2?.floors, t.class2?.area], [21, 50000, 16, 30000]);
  assert.deepEqual([t.scaffold?.h, t.form?.h, t.shore?.h], [31, 5, 2]);
  assert.deepEqual([t.psmHeight?.h, t.psmArea?.a, t.psmUse?.a, t.psmDig?.d], [31, 30000, 5000, 10]);
  assert.deepEqual([t.demolition?.a, t.demolition?.h, t.demolition?.floors], [500, 12, 3]);
  assert.deepEqual([t.resident?.a, t.resident?.floors, t.resident?.a2, t.midReportRc?.every, t.direct?.a], [5000, 5, 3000, 5, 200]);
  assert.equal(kNum("3만"), 30000);
  assert.equal(kNum("5천"), 5000);
});

test("안전관리계획: 9층 아님, 10층 대상, 16층은 2종시설물로 대상; 장비 미입력은 확인 필요", () => {
  const nine = facts({ floors: 9 });
  assert.equal(status(reviewConstruction(nine.f, nine.v, allNo), "C-SAFETY-PLAN"), "비대상");
  assert.equal(status(reviewConstruction(nine.f, nine.v, {}), "C-SAFETY-PLAN"), "확인 필요");
  assert.equal(status(reviewConstruction(nine.f, nine.v, { ...allNo, towerCrane: "yes" }), "C-SAFETY-PLAN"), "대상");
  const ten = facts({ floors: 10 });
  assert.equal(status(reviewConstruction(ten.f, ten.v, allNo), "C-SAFETY-PLAN"), "대상");
  const sixteen = facts({ floors: 16 });
  const r16 = reviewConstruction(sixteen.f, sixteen.v, allNo);
  assert.equal(status(r16, "C-SAFETY-PLAN"), "대상");
  assert.ok(r16.items.find(i => i.id === "C-SAFETY-PLAN")!.reason.some(x => x.includes("2종시설물")));
});

test("굴착 깊이: 지하 3층(9m + 기초) 은 10m 이상 → 안전관리계획·유해위험방지계획서·흙막이 대상", () => {
  const b3 = facts({ floors: 5, below: 3 });
  const r = reviewConstruction(b3.f, b3.v, allNo);
  assert.equal(status(r, "C-SAFETY-PLAN"), "대상");
  assert.equal(status(r, "C-PSM"), "대상");
  assert.equal(status(r, "C-TEMP-WORKS"), "대상");
  const b1 = facts({ floors: 5, below: 1 });
  assert.equal(status(reviewConstruction(b1.f, b1.v, allNo), "C-PSM"), "비대상");
});

test("유해위험방지계획서: 높이 31m 경계, 판매시설 5천㎡", () => {
  const low = facts({ floors: 9, storeyHeight: 3.2 }); // 30.0 m
  assert.equal(status(reviewConstruction(low.f, low.v, allNo), "C-PSM"), "비대상");
  const high = facts({ floors: 10, storeyHeight: 3.2 }); // 33.2 m
  assert.equal(status(reviewConstruction(high.f, high.v, allNo), "C-PSM"), "대상");
  const shop = facts({ floors: 4, area: 1300, use: "판매시설" });
  assert.equal(status(reviewConstruction(shop.f, shop.v, allNo), "C-PSM"), "대상");
});

test("DfS: 공공 발주 + 안전관리계획(장비 외 기준) 대상만", () => {
  const ten = facts({ floors: 12 });
  assert.equal(status(reviewConstruction(ten.f, ten.v, { ...allNo, publicClient: "yes" }), "C-DFS"), "대상");
  assert.equal(status(reviewConstruction(ten.f, ten.v, { ...allNo, publicClient: "no" }), "C-DFS"), "비대상");
  assert.equal(status(reviewConstruction(ten.f, ten.v, allNo), "C-DFS"), "확인 필요");
  const five = facts({ floors: 5 });
  assert.equal(status(reviewConstruction(five.f, five.v, { towerCrane: "yes", publicClient: "yes" }), "C-DFS"), "비대상");
});

test("현장관리인·공정 사진·추락 위험·해체", () => {
  const house = facts({ floors: 5, pilotis: true });
  const r = reviewConstruction(house.f, house.v, allNo);
  assert.equal(status(r, "C-SITE-MANAGER"), "비대상"); // 공동주택은 건설사업자 시공
  assert.equal(status(r, "C-PHOTO"), "확인 필요"); // 필로티 추정
  const fall = r.items.find(i => i.id === "C-FALL")!;
  assert.equal(fall.status, "대상");
  assert.ok(fall.issues.some(i => /승강로 개구부/.test(i.title)));
  assert.ok(fall.issues.every(i => i.at));
  assert.equal(r.items.find(i => i.id === "C-DEMOLITION")!.reason[0].includes("허가 대상"), true);
  const small = facts({ floors: 1, area: 150, use: "제1종근린생활시설" });
  assert.equal(status(reviewConstruction(small.f, small.v, {}), "C-SITE-MANAGER"), "확인 필요");
  assert.equal(status(reviewConstruction(small.f, small.v, { ownerBuild: "yes" }), "C-SITE-MANAGER"), "대상");
  assert.ok(reviewConstruction(small.f, small.v, {}).items.find(i => i.id === "C-DEMOLITION")!.reason[0].includes("신고 대상"));
});

test("v2 thresholds: 소규모안전관리계획·지하안전평가·특정공사·품질·주택법·안전보건총괄책임자·처리기간", () => {
  const t = thresholds();
  assert.deepEqual([t.small?.lo, t.small?.hi, t.smallHousing?.a, t.smallNeighbor?.a, t.smallFactory?.a, t.smallStorage?.a], [2, 10, 1000, 1000, 1000, 5000]);
  assert.deepEqual([t.underground?.d, t.undergroundSmall?.lo, t.undergroundSmall?.hi], [20, 10, 20]);
  assert.deepEqual([t.noise?.a, t.noiseDays?.days, t.noiseDue?.days], [1000, 5, 4]);
  assert.deepEqual([t.qualityTest?.a, t.qualityPlan?.a], [660, 30000]);
  assert.deepEqual([t.housing?.units, t.housing50?.units, t.housingStart?.days], [30, 50, 20]);
  assert.equal(t.safetyHead?.eok, 20);
  assert.deepEqual([t.safetyReview?.days, t.smallReview?.days, t.startDue?.days], [20, 15, 3]);
  assert.ok(t.psmDue && t.dustRule && t.dustDue && t.formDeck);
});

test("소규모안전관리계획: 2~9층 공동주택 1,000㎡ 경계, 10층은 안전관리계획으로", () => {
  const at = (floors: number, area: number, input = allNo as Record<string, string>) => { const x = facts({ floors, area }); return status(reviewConstruction(x.f, x.v, input), "C-SMALL-PLAN"); };
  assert.equal(at(5, 200), "대상"); // 5층 × 200㎡ = 1,000㎡
  assert.equal(at(5, 199.8), "비대상"); // 999㎡
  assert.equal(at(9, 120), "대상");
  assert.equal(at(1, 2000), "비대상");
  assert.equal(at(10, 200), "비대상");
  assert.equal(at(5, 300, {}), "확인 필요"); // 장비 미입력 → 안전관리계획/소규모 미정
  const shop = facts({ floors: 3, area: 400, use: "제2종근린생활시설" });
  assert.equal(status(reviewConstruction(shop.f, shop.v, allNo), "C-SMALL-PLAN"), "대상");
  const office = facts({ floors: 3, area: 400, use: "업무시설" });
  assert.equal(status(reviewConstruction(office.f, office.v, allNo), "C-SMALL-PLAN"), "비대상");
});

test("지하안전평가: 기초 하단 기준 굴착 9.9 / 10 / 20m", () => {
  const r = (dig: number) => reviewConstruction(facts({ floors: 5, below: 2, dig }).f, facts({ floors: 5, below: 2, dig }).v, allNo).items.find(i => i.id === "C-UNDERGROUND")!;
  assert.equal(r(9.9).status, "비대상");
  assert.deepEqual([r(10).status, r(10).title], ["대상", "소규모 지하안전평가"]);
  assert.deepEqual([r(20).status, r(20).title], ["대상", "지하안전평가"]);
  assert.ok(!r(12).estimated);
});

test("주택법 경로: 29 / 30세대 아파트, 30세대 다세대는 확인 필요, 50세대 대상", () => {
  const run = (units: number, use = "공동주택(아파트)") => { const x = facts({ floors: 6, units, use }); return reviewConstruction(x.f, x.v, allNo); };
  assert.equal(run(29).route, "건축법");
  const r30 = run(30);
  assert.equal(r30.route, "주택법");
  assert.equal(r30.items.find(i => i.id === "C-COMPLETION")!.title, "사용검사(주택법)");
  assert.match(r30.items.find(i => i.id === "C-SUPERVISION")!.title, /주택법/);
  assert.equal(status(run(30, "공동주택(다세대주택)"), "C-HOUSING"), "확인 필요");
  assert.equal(run(50, "공동주택(다세대주택)").route, "주택법");
  const none = facts({ floors: 6, use: "공동주택(아파트)" });
  none.f.storeys.forEach(x => (x.units = 0));
  assert.equal(status(reviewConstruction(none.f, none.v, allNo), "C-HOUSING"), "확인 필요");
});

test("품질시험계획 660㎡, 특정공사·비산먼지 1,000㎡, 안전보건총괄책임자 20억", () => {
  const at = (area: number, input: Record<string, unknown> = allNo, o: Record<string, unknown> = {}) => { const x = facts({ floors: 3, area: area / 3, ...o }); return reviewConstruction(x.f, x.v, input); };
  assert.equal(status(at(659), "C-QUALITY"), "비대상");
  assert.equal(status(at(660), "C-QUALITY"), "대상");
  assert.equal(at(660).items.find(i => i.id === "C-QUALITY")!.title, "품질시험계획");
  assert.equal(status(at(999), "C-DUST"), "비대상");
  assert.equal(status(at(1000), "C-DUST"), "대상");
  assert.ok(at(1000).items.find(i => i.id === "C-DUST")!.citations.some(c => !c.verified && /별표 13/.test(c.label)));
  assert.equal(status(at(1000), "C-NOISE"), "확인 필요");
  assert.equal(status(at(1000, { ...allNo, noisyEquip: "yes" }), "C-NOISE"), "대상");
  assert.equal(status(at(500, allNo), "C-NOISE"), "비대상");
  assert.equal(status(at(500, allNo, { zone: "제2종일반주거지역" }), "C-NOISE"), "확인 필요");
  assert.equal(status(at(500), "C-SAFETY-HEAD"), "확인 필요");
  assert.equal(status(at(500, { ...allNo, costEok: 19.9 }), "C-SAFETY-HEAD"), "비대상");
  assert.equal(status(at(500, { ...allNo, costEok: 20 }), "C-SAFETY-HEAD"), "대상");
});

test("착공 예정일 → 제출 권장일(처리기간), 날짜 계산", () => {
  assert.equal(minusDays("2026-03-01", 1), "2026-02-28");
  assert.equal(minusDays("2027-01-05", 20), "2026-12-16");
  const x = facts({ floors: 12, area: 400 });
  const r = reviewConstruction(x.f, x.v, { ...allNo, startDate: "2026-12-01" });
  const d = (id: string) => r.items.find(i => i.id === id)!.deadline?.date;
  assert.equal(d("C-SAFETY-PLAN"), "2026-11-11");
  assert.equal(d("C-PSM"), "2026-11-30");
  assert.equal(d("C-START"), "2026-11-28");
  assert.ok(r.md.includes("2026-11-11까지 권장"));
});

test("공정 순서: 굴착 → 기초 → 층별 골조 → 지붕 → 준공, 감리중간보고 5개 층마다", () => {
  const x = facts({ floors: 10, below: 1, area: 300, dig: 5 });
  const r = reviewConstruction(x.f, x.v, allNo);
  const kinds = r.sequence.map(s => s.kind);
  assert.deepEqual([kinds[0], kinds[1], kinds[2], kinds.at(-1)], ["prep", "excavation", "foundation", "completion"]);
  assert.equal(r.sequence.filter(s => s.kind === "frame").length, 11);
  assert.ok(r.sequence.some(s => s.notes.some(n => n.includes("지상 5층 상부 슬래브배근"))));
  assert.ok(r.sequence.some(s => s.notes.some(n => n.includes("비계 구조안전"))));
  assert.ok(r.sequence[0].duties.some(d => d.id === "C-SAFETY-PLAN"));
});

// ── geometry: slab edge and opening from synthetic slabs ──
function slabEl(id: number, rects: [number, number, number, number][], z: number, extra: Partial<ParsedElement> = {}): ParsedElement {
  const pos: number[] = [], idx: number[] = [];
  for (const [x0, y0, x1, y1] of rects) {
    const b = pos.length / 3;
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const xs = rects.flatMap(r => [r[0], r[2]]), ys = rects.flatMap(r => [r[1], r[3]]);
  return { id, guid: `g${id}`, ifcType: "IfcSlab", kind: "slab", name: `slab${id}`, props: {}, attrs: {}, min: [Math.min(...xs), Math.min(...ys), z - 0.2], max: [Math.max(...xs), Math.max(...ys), z], positions: new Float32Array(pos), indices: new Uint32Array(idx), ...extra };
}

test("시공 형상: 슬래브 단부 길이·개구부 크기·승강로 분류·기초 굴착 깊이", () => {
  const frame: [number, number, number, number][] = [[0, 0, 10, 4], [0, 7, 10, 10], [0, 4, 4, 7], [6, 4, 10, 7]]; // 10×10 m, 2×3 m hole
  const ground = slabEl(1, [[0, 0, 10, 10]], 0);
  const second = slabEl(2, frame, 3);
  const footing = { ...slabEl(3, [[-0.5, -0.5, 10.5, 10.5]], -10.5), ifcType: "IfcFooting", kind: "other" as const };
  const storeys: StoreyFact[] = [
    { id: 10, name: "1층", elevation: 0, height: 3, above: true, evacuation: true, floorArea: 100, floorAreaOuter: 100, habitableArea: 60, units: 0, stairCount: 1 },
    { id: 11, name: "2층", elevation: 3, height: 3, above: true, evacuation: false, floorArea: 94, floorAreaOuter: 94, habitableArea: 60, units: 0, stairCount: 1 },
  ];
  const lift = { ref: { id: 99, guid: "s", name: "승강기", type: "IfcSpace" }, storeyId: 10, use: "승강기", center: [5, 5.5, 0] } as unknown as SpaceFact;
  const cf = constructionFacts({ elements: [ground, second, footing], storeys, groundZ: 0, spaces: [lift], ref: e => ({ id: e.id, guid: e.guid, name: e.name, type: e.ifcType }) });
  assert.equal(cf.digSource, "foundation");
  near(cf.dig, 10.7, 0.01, "dig"); // footing bottom −10.7
  const l2 = cf.levels.find(l => l.storeyId === 11)!;
  near(l2.edgeLength, 40, 0.6, "edge length");
  near(l2.slabArea, 94, 1.5, "slab area");
  assert.equal(l2.openings.length, 1);
  const o = l2.openings[0];
  assert.equal(o.kind, "승강로");
  near(o.width, 2, 0.12, "opening width");
  near(o.length, 3, 0.12, "opening length");
  near(o.area, 6, 0.5, "opening area");
  near(o.perimeter, 10, 0.6, "opening perimeter");
  near(o.drop, 3, 1e-6, "drop");
  assert.ok(l2.edges.length >= 16 && l2.edges.length <= 32, `edges simplified to a square (${l2.edges.length / 4} segments)`);
  // Fed to the rules: one edge issue + one opening issue on 2층, quantities summed.
  const x = facts({ floors: 2, area: 100 });
  x.f.construction = cf;
  x.f.building.groundZ = 0;
  const r = reviewConstruction(x.f, x.v, allNo);
  const fall = r.items.find(i => i.id === "C-FALL")!;
  assert.ok(fall.issues.some(i => /^2층 (슬래브|옥상) 단부$/.test(i.title)));
  assert.ok(fall.issues.some(i => i.title === "2층 승강로 개구부" && i.severity === "critical"));
  near(r.fall!.edgeTotal, 40, 1, "edge total");
  assert.equal(r.fall!.openingCount, 1);
});

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} ≠ ${b} (±${tol})`);

test("demo-3 high-rise IFC: excavation, openings and the 주택법 route come from the model", async () => {
  const fs = await import("node:fs");
  const WebIFC = await import("web-ifc");
  const { readIfc } = await import("../lib/bim/ifc-read.ts");
  const { analyze } = await import("../lib/bim/analyze.ts");
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const { facts: f } = analyze(readIfc(api, new Uint8Array(fs.readFileSync("public/bim/demo-3-highrise.ifc"))), { file: "demo-3-highrise.ifc" });
  const c = f.construction!;
  assert.equal(c.digSource, "foundation");
  assert.ok(Math.abs(c.dig - 11.5) < 0.05, `dig ${c.dig}`);
  const above = c.levels.filter(l => l.edgeDrop >= 2);
  assert.equal(above.length, 12); // 2층 … 지붕층
  for (const l of above) {
    assert.deepEqual(l.openings.map(o => o.kind).sort(), ["계단", "승강로"]);
    assert.ok(Math.abs(l.edgeLength - 90) < 1, `${l.storey} edge ${l.edgeLength}`);
  }
  const r = reviewConstruction(f, {}, {});
  const st = (id: string) => r.items.find(i => i.id === id)?.status;
  assert.equal(r.route, "주택법");
  assert.equal(st("C-HOUSING"), "대상");
  assert.equal(st("C-UNDERGROUND"), "대상");
  assert.equal(st("C-SAFETY-PLAN"), "대상");
  assert.equal(st("C-SMALL-PLAN"), "비대상");
  assert.equal(r.fall?.source, "geometry");
  assert.ok(r.sequence.some(s => s.kind === "excavation"));
});
