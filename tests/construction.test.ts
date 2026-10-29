import assert from "node:assert/strict";
import { test } from "node:test";
import { kNum, reviewConstruction, thresholds } from "../lib/bim/construction.ts";
import type { BimFacts, StoreyFact } from "../lib/bim/types.ts";
import type { ProjectValues } from "../lib/review/types.ts";

/** Minimal model: n storeys above (3 m each), b basements, given floor area per storey. */
function facts(o: { floors: number; below?: number; area?: number; storeyHeight?: number; use?: string; structure?: string; pilotis?: boolean }): { f: BimFacts; v: ProjectValues } {
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
  } as unknown as BimFacts;
  const v: ProjectValues = { 주용도: { value: o.use ?? "공동주택(다세대주택)", raw: "t", source: "user", confidence: "HIGH" }, 구조: { value: o.structure ?? "철근콘크리트조", raw: "t", source: "user", confidence: "HIGH" } };
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
  assert.ok(r16.items[0].reason.some(x => x.includes("2종시설물")));
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
