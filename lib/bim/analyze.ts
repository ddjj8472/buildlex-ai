// ParsedModel → BimFacts: everything the rules need, measured once on the client.
//
// Solibri's checks work on "what the model says" (properties) first and on geometry
// when the data is missing; we do the same and record which one each value came from.
// Measurements that need geometry:
//   • 건축면적·바닥면적  plan raster of the elements, corrected from the outer face to
//                        the wall centreline (건축법 시행령 제119조)
//   • 높이·층수          storey elevations and the highest building element
//   • 보행거리           Dijkstra on a plan grid sliced at 1.1 m (walls/windows block, doors open)
//   • 정북 이격          ray from every building vertex toward true north to the site boundary
//   • 계단·복도·채광·주차 per-element shapes (min-area rectangles, tread clustering, window ↔ room)
import { asBool, classifySpace, krValue, KR_PROPS } from "./convention.ts";
import { bottomFace, centerOf, components, convexHull, countCells, Grid, median, minAreaRect, perimeter, planDistance, polygonArea, rasterSegments, rasterTriangles, rayToPolygon, rectWidth, slice, walkDistances, xyPoints, type Mesh } from "./geometry.ts";
import type { BimFacts, DoorFact, EgressFact, EgressField, ElemRef, FlightFact, NorthPoint, ParkingFact, ParsedElement, ParsedModel, PropValue, RailingFact, SpaceFact, StairFact, StoreyFact, Vec2, Vec3 } from "./types.ts";

export type AnalyzeOptions = { file?: string; onProgress?: (stage: string, pct: number) => void };

const MASSING = new Set(["wall", "curtainwall", "slab", "roof", "column", "beam", "door", "window", "stairflight", "ramp", "plate", "member", "covering", "proxy"]);
const VERTICAL = new Set(["wall", "curtainwall", "column", "door", "window", "plate", "member"]);
const OBSTACLE = new Set(["wall", "curtainwall", "window", "column", "plate", "member", "railing"]);
const GUARD = new Set(["wall", "curtainwall", "railing", "plate", "member"]);

const meshOf = (e: ParsedElement): Mesh | null => (e.positions && e.indices && e.indices.length ? { positions: e.positions, indices: e.indices } : null);
const label = (e: ParsedElement) => (e.kind === "space" && e.longName && e.name && e.longName !== e.name ? `${e.longName} ${e.name}` : e.longName || e.name || e.objectType || e.ifcType);

function propNum(props: Record<string, PropValue>, ...keys: string[]): number | undefined {
  for (const k of keys) { const v = props[k]; if (typeof v === "number" && Number.isFinite(v) && v > 0) return v; }
  return undefined;
}

export function analyze(model: ParsedModel, opts: AnalyzeOptions = {}): { facts: BimFacts; fields: EgressField[] } {
  const report = opts.onProgress || (() => {});
  const quality: BimFacts["quality"] = model.warnings.map(text => ({ level: "warn" as const, text }));
  const byId = new Map(model.elements.map(e => [e.id, e]));
  const storeyById = new Map(model.storeys.map(s => [s.id, s]));
  const ref = (e: ParsedElement): ElemRef => ({ id: e.id, guid: e.guid, name: label(e), type: e.ifcType, storey: e.storey !== undefined ? storeyById.get(e.storey)?.name : undefined });
  const kr = (name: string, props: Record<string, PropValue> | undefined) => (props ? krValue(props, name) : undefined);

  // ── project values (BuildLex_KR on site / building) ──
  const krOut: Record<string, PropValue> = {};
  for (const p of KR_PROPS) {
    if (!p.on.includes("IfcSite") && !p.on.includes("IfcBuilding")) continue;
    const v = kr(p.name, p.on.includes("IfcSite") ? model.site?.props : model.building?.props) ?? kr(p.name, model.building?.props) ?? kr(p.name, model.site?.props);
    if (v !== undefined) krOut[p.name] = p.type === "Boolean" ? asBool(v) ?? v : v;
  }

  // ── storeys, ground, heights ──
  const storeys = model.storeys;
  // 지표면: BuildLex_KR.지표면표고, else the 피난층 / first storey at or above IFC ±0.
  const evacFlag = storeys.filter(s => asBool(krValue(s.props, "피난층")) === true);
  const raw = (z: number) => z - model.offset[2];
  const groundStorey = evacFlag[0] || storeys.find(s => raw(s.elevation) >= -0.5) || storeys[0];
  const groundZ = typeof krOut["지표면표고"] === "number" ? (krOut["지표면표고"] as number) + model.offset[2] : groundStorey?.elevation ?? 0;
  const storeyHeight = (i: number) => (i < storeys.length - 1 ? storeys[i + 1].elevation - storeys[i].elevation : 3);

  // ── element groups ──
  const isParking = (e: ParsedElement) => e.kind !== "space" && (String(krValue(e.props, "실용도") || "").includes("주차구획") || /주차\s*구획|주차면|parking\s*(space|stall|spot)|^parking/i.test(`${e.name} ${e.objectType || ""} ${e.props["Type.Name"] || ""}`));
  const isLandscape = (e: ParsedElement) => /조경/.test(String(krValue(e.props, "실용도") || "")) || (e.kind !== "space" && e.kind !== "site" && /조경|식재|잔디|정원|landscape|planting|lawn/i.test(`${e.name} ${e.objectType || ""}`));
  const isBoundary = (e: ParsedElement) => /대지경계|대지\s*경계|site\s*boundary|property\s*line/i.test(`${krValue(e.props, "실용도") || ""} ${e.name} ${e.objectType || ""}`);
  const elements = model.elements.filter(e => meshOf(e));
  const massing = elements.filter(e => MASSING.has(e.kind) && !isParking(e) && !isLandscape(e) && !isBoundary(e));
  const spacesEl = elements.filter(e => e.kind === "space");
  if (!massing.length) throw new Error("건축 요소(벽·슬래브 등)의 형상을 찾지 못했습니다.");

  // Plan grid for areas: fine cells, bounded size.
  const bmin: Vec2 = [Infinity, Infinity], bmax: Vec2 = [-Infinity, -Infinity];
  for (const e of [...massing, ...spacesEl]) { bmin[0] = Math.min(bmin[0], e.min[0]); bmin[1] = Math.min(bmin[1], e.min[1]); bmax[0] = Math.max(bmax[0], e.max[0]); bmax[1] = Math.max(bmax[1], e.max[1]); }
  const extent = Math.max(bmax[0] - bmin[0], bmax[1] - bmin[1]);
  const areaGrid = Grid.around(bmin, bmax, 1, Math.min(0.25, Math.max(0.03, extent / 1500)));

  // Exterior wall thickness → centreline correction.
  const extWalls = elements.filter(e => e.kind === "wall" && asBool(e.props["Pset_WallCommon.IsExternal"]) === true);
  const thick = extWalls.map(w => propNum(w.props, "Qto_WallBaseQuantities.Width") ?? minAreaRect(xyPoints(meshOf(w)!)).width).filter(t => t > 0.03 && t < 1.5);
  const t = thick.length ? median(thick) : 0;
  if (!extWalls.length) quality.push({ level: "info", text: "외벽 구분(Pset_WallCommon.IsExternal)이 없어 건축면적·바닥면적을 외벽 바깥면 기준으로 계산했습니다(중심선 환산 생략)." });
  const centreline = (outer: number, per: number) => (t > 0 && outer > 0 ? Math.max(0, outer - per * (t / 2) + 4 * (t / 2) ** 2) : outer);

  report("면적 산정", 0.8);
  // 건축면적: plan projection of the parts higher than 1 m above ground (시행령 제119조①2 다목1).
  const fp = new Uint8Array(areaGrid.size);
  for (const e of massing) if (e.max[2] > groundZ + 1.0) rasterTriangles(areaGrid, fp, meshOf(e)!, 1, (a, b, c) => Math.max(a, b, c) > groundZ + 1.0);
  const fpOuter = countCells(fp) * areaGrid.cell ** 2;
  const fpPer = perimeter(areaGrid, fp);

  // 층별 바닥면적: vertical elements + rooms of each storey.
  const storeyFacts: StoreyFact[] = [];
  const spaceFacts: SpaceFact[] = [];
  const spacesByStorey = new Map<number, ParsedElement[]>();
  for (const s of spacesEl) if (s.storey !== undefined) spacesByStorey.set(s.storey, [...(spacesByStorey.get(s.storey) || []), s]);
  const qtoStorey = (id: number) => propNum(storeyById.get(id)?.props || {}, "Qto_BuildingStoreyBaseQuantities.GrossFloorArea");
  storeys.forEach((s, i) => {
    const m = new Uint8Array(areaGrid.size);
    for (const e of elements) if (e.storey === s.id && (VERTICAL.has(e.kind) || e.kind === "space")) rasterTriangles(areaGrid, m, meshOf(e)!, 1);
    let outer = countCells(m) * areaGrid.cell ** 2;
    let area = centreline(outer, perimeter(areaGrid, m));
    const q = qtoStorey(s.id);
    if (q) { area = q; outer = Math.max(outer, q); }
    const h = storeyHeight(i);
    storeyFacts.push({
      id: s.id, name: s.name, elevation: s.elevation, height: h,
      above: groundZ - s.elevation < h / 2 - 1e-6, evacuation: false,
      floorArea: round(area, 2), floorAreaOuter: round(outer, 2), habitableArea: 0, units: 0, stairCount: 0,
      use: krValue(s.props, "층용도") ? String(krValue(s.props, "층용도")) : undefined,
    });
  });
  const occupied = storeyFacts.filter(s => s.floorArea > 0.5);
  for (const s of storeyFacts) s.evacuation = evacFlag.length ? evacFlag.some(e => e.id === s.id) : s.id === groundStorey?.id;

  // ── spaces ──
  report("실 분석", 0.83);
  for (const e of spacesEl) {
    const mesh = meshOf(e)!;
    const cls = classifySpace(e.name, e.longName, krValue(e.props, "실용도") as string | undefined);
    const bf = bottomFace(mesh);
    const area = propNum(e.props, "Qto_SpaceBaseQuantities.NetFloorArea", "Qto_SpaceBaseQuantities.GrossFloorArea", "BaseQuantities.NetFloorArea") ?? bf.area;
    const per = propNum(e.props, "Qto_SpaceBaseQuantities.NetPerimeter", "Qto_SpaceBaseQuantities.GrossPerimeter") ?? bf.perimeter;
    const hProp = propNum(e.props, "Qto_SpaceBaseQuantities.FinishCeilingHeight", "Pset_SpaceCommon.FinishCeilingHeight", "Qto_SpaceBaseQuantities.Height");
    const st = e.storey !== undefined ? storeyFacts.find(s => s.id === e.storey) : undefined;
    const farEx = asBool(krValue(e.props, "용적률제외")) ?? (cls.use === "주차" ? true : undefined);
    spaceFacts.push({
      ref: ref(e), storeyId: e.storey, use: cls.use, useSource: cls.source, label: label(e),
      area: round(area, 3), height: round(hProp ?? e.max[2] - e.min[2], 3), heightSource: hProp ? "property" : "geometry",
      perimeter: round(per, 3), minWidth: round(rectWidth(area, per), 3), windowArea: 0, windows: [],
      unit: krValue(e.props, "세대번호") ? String(krValue(e.props, "세대번호")) : undefined,
      farExcluded: farEx || undefined, center: [(e.min[0] + e.max[0]) / 2, (e.min[1] + e.max[1]) / 2, st ? st.elevation : e.min[2]],
    });
  }
  const unclassified = spaceFacts.filter(s => s.useSource === "default");
  if (unclassified.length) quality.push({ level: "warn", text: `실 ${unclassified.length}개는 이름으로 용도를 알 수 없어 거실로 보고 검토했습니다(예: ${unclassified.slice(0, 4).map(s => s.label).join(", ")}). BuildLex_KR.실용도를 입력하면 정확해집니다.` });
  for (const s of storeyFacts) {
    const hab = spaceFacts.filter(x => x.storeyId === s.id && x.use === "거실");
    s.habitableArea = round(hab.reduce((a, x) => a + x.area, 0), 2);
    s.units = new Set(hab.map(x => x.unit).filter(Boolean)).size;
  }

  // Per-storey room label rasters (window ↔ room, corridor neighbours, egress).
  const coarse = Math.max(0.2, extent / 400);
  const planGrid = Grid.around(bmin, bmax, 1.5, coarse);
  const labels = new Map<number, Int32Array>();
  for (const s of storeyFacts) {
    const sp = spaceFacts.map((f, k) => ({ f, k })).filter(x => x.f.storeyId === s.id);
    if (!sp.length) continue;
    const lab = new Int32Array(planGrid.size).fill(-1);
    // Larger rooms first so small rooms drawn later win where they overlap.
    for (const { f, k } of sp.sort((a, b) => b.f.area - a.f.area)) rasterTriangles(planGrid, lab, meshOf(byId.get(f.ref.id)!)!, k);
    labels.set(s.id, lab);
  }
  const labelAt = (storeyId: number | undefined, x: number, y: number) => {
    if (storeyId === undefined) return -1;
    const lab = labels.get(storeyId);
    const i = planGrid.at(x, y);
    return lab && i >= 0 ? lab[i] : -1;
  };

  // ── windows → rooms (채광) ──
  for (const w of elements.filter(e => e.kind === "window")) {
    const mesh = meshOf(w)!;
    const r = minAreaRect(xyPoints(mesh));
    const width = w.attrs.overallWidth ?? r.length;
    const height = w.attrs.overallHeight ?? w.max[2] - w.min[2];
    const [cx, cy] = r.center;
    const hit = new Set<number>();
    for (const sgn of [1, -1]) for (const d of [0.3, 0.5, 0.75]) {
      const k = labelAt(w.storey, cx + r.v[0] * d * sgn, cy + r.v[1] * d * sgn);
      if (k >= 0) { hit.add(k); break; }
    }
    for (const k of hit) { spaceFacts[k].windowArea = round(spaceFacts[k].windowArea + width * height, 3); spaceFacts[k].windows.push(ref(w)); }
  }

  // ── corridors: 거실 on both long sides? ──
  for (const f of spaceFacts) {
    if (f.use !== "복도") continue;
    const e = byId.get(f.ref.id)!;
    const r = minAreaRect(xyPoints(meshOf(e)!));
    let both = 0, n = 0;
    for (let k = 1; k <= 8; k++) {
      const s = (k / 9 - 0.5) * r.length;
      const px = r.center[0] + r.u[0] * s, py = r.center[1] + r.u[1] * s;
      const side = (sgn: number) => { const d = r.width / 2 + 0.45; const q = labelAt(f.storeyId, px + r.v[0] * d * sgn, py + r.v[1] * d * sgn); return q >= 0 && spaceFacts[q].use === "거실"; };
      n++; if (side(1) && side(-1)) both++;
    }
    f.bothSidesHabitable = both / n >= 0.5;
  }

  // ── stairs ──
  report("계단 분석", 0.86);
  const guards = elements.filter(e => GUARD.has(e.kind));
  const flights = elements.filter(e => e.kind === "stairflight" || (e.kind === "ramp" && e.ifcType.toUpperCase().includes("FLIGHT")));
  const groups = new Map<number, ParsedElement[]>();
  for (const f of flights) { const key = f.parent !== undefined && byId.get(f.parent)?.kind === "stair" ? f.parent : f.id; groups.set(key, [...(groups.get(key) || []), f]); }
  const stairs: StairFact[] = [];
  for (const [key, fl] of groups) {
    const owner = byId.get(key)!;
    const flightsF: FlightFact[] = fl.map(f => flightFact(f, ref(f), guards.filter(g => g.id !== f.id)));
    const landings = elements.filter(e => e.kind === "slab" && e.parent === key && (e.predefined === "LANDING" || /참|landing/i.test(e.name))).map(l => { const r = minAreaRect(xyPoints(meshOf(l)!)); return { ref: ref(l), depth: round(r.width, 3), width: round(r.length, 3) }; });
    stairs.push({ ref: ref(owner), storeyId: owner.storey ?? fl[0].storey, flights: flightsF, landings });
  }
  const noStep = stairs.flatMap(s => s.flights).filter(f => f.stepSource === "geometry");
  if (noStep.length) quality.push({ level: "info", text: `계단 경간 ${noStep.length}개는 단높이·단너비 속성이 없어 형상에서 추정했습니다.` });

  // ── doors ──
  const doors: DoorFact[] = elements.filter(e => e.kind === "door").map(d => {
    const r = minAreaRect(xyPoints(meshOf(d)!));
    const external = asBool(d.props["Pset_DoorCommon.IsExternal"]) ?? false;
    const main = asBool(krValue(d.props, "주출입구")) ?? false;
    const clear = krValue(d.props, "유효폭");
    return { ref: ref(d), width: round(d.attrs.overallWidth ?? r.length, 3), height: round(d.attrs.overallHeight ?? d.max[2] - d.min[2], 3), clearWidth: typeof clear === "number" ? round(clear, 3) : undefined, external, main, center: centerOf(d.min, d.max) };
  });

  // ── railings ──
  const topOccupied = occupied.length ? occupied[occupied.length - 1] : undefined;
  const railings: RailingFact[] = elements.filter(e => e.kind === "railing").map(r => {
    const st = r.storey !== undefined ? storeyFacts.find(s => s.id === r.storey) : storeyFacts.find(s => byId.get(r.parent ?? -1)?.storey === s.id);
    const hp = propNum(r.props, "Pset_RailingCommon.Height");
    const base = st && Math.abs(r.min[2] - st.elevation) < 0.3 ? st.elevation : r.min[2];
    const where0 = krValue(r.props, "난간위치");
    let where: RailingFact["where"] = "기타";
    let whereSource: RailingFact["whereSource"] = "inferred";
    if (typeof where0 === "string" && /계단|옥상|노대|실내/.test(where0)) { where = (where0.match(/계단|옥상|노대|실내/)![0]) as RailingFact["where"]; whereSource = "property"; }
    else if (r.parent !== undefined && byId.get(r.parent)?.kind === "stair") where = "계단";
    else if (flights.some(f => overlaps(f, r, 0.4))) where = "계단";
    else if (st && topOccupied && st.elevation > topOccupied.elevation + 0.5) where = "옥상";
    else if (spaceFacts.some(s => s.use === "발코니" && s.storeyId === r.storey && overlaps(byId.get(s.ref.id)!, r, 0.3))) where = "노대";
    else if (asBool(r.props["Pset_RailingCommon.IsExternal"]) && st && st.above && !st.evacuation) where = "노대";
    else where = "실내";
    return { ref: ref(r), height: hp !== undefined ? round(hp, 3) : where === "계단" ? undefined : round(r.max[2] - base, 3), heightSource: hp !== undefined ? "pset" : where === "계단" ? "none" : "geometry", where, whereSource, center: centerOf(r.min, r.max) };
  });

  // ── parking ──
  const parking: ParkingFact[] = elements.filter(isParking).map(p => {
    const r = minAreaRect(xyPoints(meshOf(p)!));
    const kindProp = String(krValue(p.props, "주차형식") || "");
    const text = `${kindProp} ${p.name} ${p.objectType || ""} ${p.props["Type.Name"] || ""}`;
    const kind: ParkingFact["kind"] = /장애인|accessible|disab/i.test(text) ? "장애인전용" : /확장/.test(text) ? "확장형" : /경형|compact/i.test(text) ? "경형" : /평행|parallel/i.test(text) ? "평행주차" : "일반형";
    return { ref: ref(p), kind, width: round(r.width, 3), length: round(r.length, 3), center: centerOf(p.min, p.max) };
  });

  // ── building totals ──
  let top = -Infinity, topEl: ParsedElement | undefined;
  for (const e of massing) if (e.max[2] > top) { top = e.max[2]; topEl = e; }
  const above = storeyFacts.filter(s => s.above && s.floorArea > 0.5);
  const below = storeyFacts.filter(s => !s.above && s.floorArea > 0.5);
  const gfa = storeyFacts.reduce((a, s) => a + s.floorArea, 0);
  const farExcluded = spaceFacts.filter(s => s.farExcluded && storeyFacts.find(x => x.id === s.storeyId)?.above).map(s => ({ label: `${s.ref.storey || ""} ${s.label}`.trim(), area: s.area }));
  const farArea = above.reduce((a, s) => a + s.floorArea, 0) - farExcluded.reduce((a, x) => a + x.area, 0);
  const landscapeEls = elements.filter(isLandscape);
  let landscapeArea: number | undefined;
  if (landscapeEls.length) {
    const m = new Uint8Array(areaGrid.size);
    for (const e of landscapeEls) rasterTriangles(areaGrid, m, meshOf(e)!, 1);
    const big = landscapeEls.some(e => e.max[0] > areaGrid.ox + areaGrid.nx * areaGrid.cell || e.min[0] < areaGrid.ox || e.max[1] > areaGrid.oy + areaGrid.ny * areaGrid.cell || e.min[1] < areaGrid.oy);
    if (big) {
      // Landscape outside the building grid: measure on its own grid.
      const lmin: Vec2 = [Infinity, Infinity], lmax: Vec2 = [-Infinity, -Infinity];
      for (const e of landscapeEls) { lmin[0] = Math.min(lmin[0], e.min[0]); lmin[1] = Math.min(lmin[1], e.min[1]); lmax[0] = Math.max(lmax[0], e.max[0]); lmax[1] = Math.max(lmax[1], e.max[1]); }
      const lg = Grid.around(lmin, lmax, 0.5, Math.min(0.25, Math.max(0.03, Math.max(lmax[0] - lmin[0], lmax[1] - lmin[1]) / 1500)));
      const lm = new Uint8Array(lg.size);
      for (const e of landscapeEls) rasterTriangles(lg, lm, meshOf(e)!, 1);
      landscapeArea = round(countCells(lm) * lg.cell ** 2, 2);
    } else landscapeArea = round(countCells(m) * areaGrid.cell ** 2, 2);
  }

  // ── site ──
  // IfcSite FootPrint first; otherwise an element named/classified 대지경계 (convex outline).
  const boundaryEl = elements.find(isBoundary);
  const boundary = model.site?.boundary || (boundaryEl ? convexHull(xyPoints(meshOf(boundaryEl)!)) : undefined);
  if (!model.site?.boundary && boundaryEl) quality.push({ level: "info", text: `대지경계선을 '${label(boundaryEl)}' 요소의 외곽(볼록 다각형)으로 잡았습니다.` });
  const siteAreaProp = typeof krOut["대지면적"] === "number" ? (krOut["대지면적"] as number) : propNum(model.site?.props || {}, "Qto_SiteBaseQuantities.GrossArea", "Pset_SiteCommon.TotalArea");
  const site: BimFacts["site"] = {
    area: siteAreaProp ?? (boundary ? round(polygonArea(boundary), 2) : undefined),
    areaSource: siteAreaProp !== undefined ? "property" : boundary ? "boundary" : "none",
    boundary, north: model.north, northSource: model.northSource,
  };
  if (!boundary) quality.push({ level: "warn", text: "대지경계선(IfcSite FootPrint)이 없어 정북방향 일조 이격을 3D로 검토할 수 없습니다. 대지경계를 IfcSite 형상으로 내보내거나 이격거리를 직접 입력하세요." });
  if (model.northSource === "default") quality.push({ level: "info", text: "모델에 진북(TrueNorth) 정보가 없어 모델 +Y 방향을 정북으로 보았습니다." });

  // ── egress (직통계단까지 보행거리) ──
  report("피난 보행거리", 0.9);
  const fields: EgressField[] = [];
  const egress: EgressFact[] = [];
  const stairFlights = elements.filter(e => e.kind === "stairflight" || e.kind === "ramp");
  for (const s of storeyFacts) {
    const rooms = spaceFacts.map((f, k) => ({ f, k })).filter(x => x.f.storeyId === s.id);
    const lab = labels.get(s.id);
    // Stairs serving this floor: flights touching the floor level, plus 계단실 rooms.
    const srcMask = new Uint8Array(planGrid.size);
    for (const f of stairFlights) if (f.min[2] <= s.elevation + 0.6 && f.max[2] >= s.elevation - 0.2) rasterTriangles(planGrid, srcMask, meshOf(f)!, 1);
    if (lab) for (const { f, k } of rooms) if (f.use === "계단실") for (let i = 0; i < lab.length; i++) if (lab[i] === k) srcMask[i] = 1;
    s.stairCount = components(planGrid, srcMask);
    if (!lab || s.evacuation || !rooms.some(x => x.f.use === "거실")) continue;
    const zs = s.elevation + 1.1;
    const walk = new Uint8Array(planGrid.size);
    for (let i = 0; i < walk.length; i++) if (lab[i] >= 0 || srcMask[i]) walk[i] = 1;
    for (const e of elements) if (e.kind === "slab" && e.max[2] >= s.elevation - 0.35 && e.max[2] <= s.elevation + 0.25) rasterTriangles(planGrid, walk, meshOf(e)!, 1, (a, b, c) => Math.max(a, b, c) >= s.elevation - 0.35);
    const blocked = new Uint8Array(planGrid.size);
    for (const e of elements) if (OBSTACLE.has(e.kind) && e.min[2] < zs && e.max[2] > zs && !(e.kind === "railing" && stairFlights.some(f => overlaps(f, e, 0.4)))) rasterSegments(planGrid, blocked, slice(meshOf(e)!, zs));
    const free = new Uint8Array(planGrid.size);
    const sources: number[] = [];
    for (let i = 0; i < free.length; i++) { free[i] = walk[i] && !blocked[i] ? 1 : 0; if (srcMask[i] && free[i]) sources.push(i); }
    const dist = sources.length ? walkDistances(planGrid, free, sources) : new Float32Array(planGrid.size).fill(Infinity);
    const spaces = rooms.filter(x => x.f.use === "거실").map(({ f, k }) => {
      let maxD = -1, at = -1, unreachable = 0, cells = 0;
      for (let i = 0; i < lab.length; i++) {
        if (lab[i] !== k || !free[i]) continue;
        cells++;
        const d = dist[i];
        if (!Number.isFinite(d)) { unreachable++; continue; }
        if (d > maxD) { maxD = d; at = i; }
      }
      const ix = at % planGrid.nx, iy = (at - ix) / planGrid.nx;
      return { ref: f.ref, maxDistance: maxD >= 0 ? round(maxD, 2) : null, at: (at >= 0 ? [planGrid.cx(ix), planGrid.cy(iy), s.elevation + 0.05] : f.center) as Vec3, unreachable, cells };
    });
    egress.push({ storeyId: s.id, storey: s.name, spaces, stairs: s.stairCount, cell: round(planGrid.cell, 3) });
    const field = new Float32Array(planGrid.size);
    for (let i = 0; i < field.length; i++) field[i] = !free[i] || !(lab[i] >= 0 || srcMask[i]) ? NaN : Number.isFinite(dist[i]) ? dist[i] : -1;
    fields.push({ storeyId: s.id, elevation: s.elevation, origin: [planGrid.ox, planGrid.oy], cell: planGrid.cell, nx: planGrid.nx, ny: planGrid.ny, dist: field });
  }
  if (!spacesEl.length) quality.push({ level: "warn", text: "실이 없어 보행거리·복도·반자높이·채광 검토를 건너뜁니다." });

  // ── 정북방향 이격 (3D) ──
  report("정북 일조 이격", 0.95);
  const north: BimFacts["north"] = { available: false, frontier: [], perElement: [] };
  if (boundary && boundary.length >= 3) {
    const pts: NorthPoint[] = [];
    const seen = new Set<string>();
    for (const e of massing) {
      if (e.max[2] <= groundZ + 0.01) continue;
      const p = e.positions!;
      const r = ref(e);
      for (let k = 0; k < p.length; k += 3) {
        const h = p[k + 2] - groundZ;
        if (h <= 0.01) continue;
        const key = `${e.id},${Math.round(p[k] * 100)},${Math.round(p[k + 1] * 100)},${Math.round(p[k + 2] * 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = rayToPolygon(p[k], p[k + 1], model.north, boundary);
        if (d === null) continue;
        pts.push({ h: round(h, 3), d: round(d, 3), at: [p[k], p[k + 1], p[k + 2]], ref: r });
      }
    }
    if (pts.length) {
      north.available = true;
      const low = pts.filter(x => x.h <= 10 + 1e-6), high = pts.filter(x => x.h > 10 + 1e-6);
      // Ties go to the higher point (the more demanding one).
      const pick = (xs: NorthPoint[]) => xs.reduce((a, b) => (b.d < a.d - 1e-6 || (Math.abs(b.d - a.d) <= 1e-6 && b.h > a.h) ? b : a));
      north.minLow = low.length ? pick(low) : undefined;
      north.minHigh = high.length ? pick(high) : undefined;
      const worstOf = new Map<number, { p: NorthPoint; slack: number }>();
      for (const q of pts) {
        const slack = q.d - (q.h <= 10 ? 1.5 : q.h / 2);
        const cur = worstOf.get(q.ref.id);
        if (!cur || slack < cur.slack) worstOf.set(q.ref.id, { p: q, slack });
      }
      north.perElement = [...worstOf.values()].sort((a, b) => a.slack - b.slack).slice(0, 60).map(x => x.p);
      // Pareto front: no other point is both higher and closer to the boundary.
      const sorted = pts.slice().sort((a, b) => b.h - a.h || a.d - b.d);
      let best = Infinity;
      for (const q of sorted) if (q.d < best - 1e-6) { north.frontier.push(q); best = q.d; if (north.frontier.length >= 80) break; }
    } else north.reason = "건물 정점에서 정북 방향으로 대지경계선을 찾지 못했습니다.";
  } else north.reason = "대지경계선이 없습니다.";

  const triangles = elements.reduce((a, e) => a + (e.indices?.length || 0) / 3, 0);
  const facts: BimFacts = {
    version: 1,
    source: { file: opts.file || "", schema: model.schema, project: model.project.name, application: model.project.application, elements: model.elements.length, triangles },
    kr: krOut,
    site,
    building: {
      groundZ: round(groundZ, 3), height: round(top - groundZ, 3), heightRef: topEl ? ref(topEl) : undefined,
      footprintOuter: round(fpOuter, 2), footprint: round(centreline(fpOuter, fpPer), 2), perimeter: round(fpPer, 2), wallThickness: round(t, 3), areaTolerance: round(fpPer * areaGrid.cell / 2, 2),
      storeysAbove: above.length, storeysBelow: below.length,
      grossFloorArea: round(gfa, 2), farFloorArea: round(farArea, 2), farExcluded,
      landscapeArea, landscape: landscapeEls.map(ref),
    },
    storeys: storeyFacts, spaces: spaceFacts, stairs, doors, railings, parking, egress, north, quality,
  };
  report("완료", 1);
  return { facts, fields };
}

function overlaps(a: ParsedElement, b: ParsedElement, pad: number): boolean {
  return a.min[0] - pad <= b.max[0] && a.max[0] + pad >= b.min[0] && a.min[1] - pad <= b.max[1] && a.max[1] + pad >= b.min[1] && a.min[2] - pad <= b.max[2] && a.max[2] + pad >= b.min[2];
}

function round(x: number, d: number) { const k = 10 ** d; return Math.round(x * k) / k; }

/** Straight flight: rise/run/width from geometry; risers & treads from attributes, Pset or tread clustering. */
function flightFact(f: ParsedElement, r: ElemRef, guards: ParsedElement[]): FlightFact {
  const mesh = { positions: f.positions!, indices: f.indices! };
  const p = mesh.positions, idx = mesh.indices;
  // Up-facing faces = treads (and the landing at the top, if modelled with the flight).
  const levels: number[] = [];
  const byLevel = new Map<number, [number, number, number]>(); // z → [Σ area·x, Σ area·y, Σ area]
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12 || nz / len < 0.95) continue;
    const lv = Math.round(p[a + 2] * 200) / 200;
    levels.push(lv);
    const w = len / 2, acc = byLevel.get(lv) || [0, 0, 0];
    acc[0] += w * (p[a] + p[b] + p[c]) / 3; acc[1] += w * (p[a + 1] + p[b + 1] + p[c + 1]) / 3; acc[2] += w;
    byLevel.set(lv, acc);
  }
  // Direction of ascent: from the area-weighted centre of the lowest tread level to the highest one.
  let dir: Vec2 | null = null;
  if (byLevel.size >= 2) {
    const ks = [...byLevel.keys()].sort((a, b) => a - b);
    const lo = byLevel.get(ks[0])!, hi = byLevel.get(ks[ks.length - 1])!;
    const dx = hi[0] / hi[2] - lo[0] / lo[2], dy = hi[1] / hi[2] - lo[1] / lo[2];
    const L = Math.hypot(dx, dy);
    if (L > 0.05) dir = [dx / L, dy / L];
  }
  const pts = xyPoints(mesh);
  const rect = minAreaRect(pts);
  if (!dir) dir = rect.u;
  const perp: Vec2 = [-dir[1], dir[0]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of pts) { const u = x * dir[0] + y * dir[1], v = x * perp[0] + y * perp[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const width = v1 - v0, run = u1 - u0;
  const rise = f.max[2] - f.min[2];
  const uniq = [...new Set(levels)].sort((a, b) => a - b);
  let riser = f.attrs.riserHeight, tread = f.attrs.treadLength, risers = f.attrs.risers;
  let stepSource: FlightFact["stepSource"] = riser && tread ? "attribute" : "none";
  if (!riser || !tread) {
    const pr = propNum(f.props, "Pset_StairFlightCommon.RiserHeight"), pt = propNum(f.props, "Pset_StairFlightCommon.TreadLength"), pn = propNum(f.props, "Pset_StairFlightCommon.NumberOfRiser");
    if (pr && pt) { riser = pr; tread = pt; risers = pn ?? risers; stepSource = "pset"; }
  }
  if ((!riser || !tread) && uniq.length >= 3) {
    const diffs = uniq.slice(1).map((z, i) => z - uniq[i]).filter(d => d > 0.05 && d < 0.3);
    if (diffs.length) {
      riser = median(diffs);
      risers = Math.round(rise / riser);
      tread = risers > 1 ? run / Math.max(1, risers - 1) : undefined;
      stepSource = "geometry";
    }
  }
  // Guards: sample points just outside each side and look for a wall or railing within 0.3 m.
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const near = guards.filter(g => overlaps(f, g, 0.5)).map(g => ({ positions: g.positions!, indices: g.indices! })).filter(m => m.positions && m.indices);
  const side = (sgn: number) => {
    let hits = 0;
    for (let k = 1; k <= 5; k++) {
      const u = u0 + (run * k) / 6, v = cv + sgn * (width / 2 + 0.05);
      const x = dir![0] * u + perp[0] * v, y = dir![1] * u + perp[1] * v;
      if (near.some(m => planDistance(m, x, y, 0.35) <= 0.3)) hits++;
    }
    return hits >= 3;
  };
  const center: Vec3 = [dir[0] * cu + perp[0] * cv, dir[1] * cu + perp[1] * cv, (f.min[2] + f.max[2]) / 2];
  const rr = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 1000) / 1000);
  return { ref: r, rise: rr(rise)!, riser: rr(riser), tread: rr(tread), risers, stepSource, width: rr(width)!, run: rr(run)!, zMin: f.min[2], zMax: f.max[2], guardLeft: side(1), guardRight: side(-1), center };
}
