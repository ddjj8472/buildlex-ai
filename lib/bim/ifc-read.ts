// IFC → ParsedModel with web-ifc (That Open's IFC engine, MPL-2.0).
// Runs unchanged in the browser worker and in Node tests.
//
// Frames: web-ifc streams geometry in metres, Y-up, translated toward the origin
// (COORDINATE_TO_ORIGIN). We convert everything — meshes, storey elevations, the
// site footprint — to the analysis frame: metres, Z-up, IFC project XY, same translation.
import * as WebIFC from "web-ifc";
import type { ElementKind, ParsedElement, ParsedModel, ParsedStorey, PropValue, Vec2, Vec3 } from "./types.ts";

type Api = WebIFC.IfcAPI;
type Line = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const KIND: Record<string, ElementKind> = {
  IFCWALL: "wall", IFCWALLSTANDARDCASE: "wall", IFCWALLELEMENTEDCASE: "wall", IFCCURTAINWALL: "curtainwall",
  IFCSLAB: "slab", IFCSLABSTANDARDCASE: "slab", IFCSLABELEMENTEDCASE: "slab", IFCROOF: "roof",
  IFCCOLUMN: "column", IFCCOLUMNSTANDARDCASE: "column", IFCBEAM: "beam", IFCBEAMSTANDARDCASE: "beam",
  IFCDOOR: "door", IFCDOORSTANDARDCASE: "door", IFCWINDOW: "window", IFCWINDOWSTANDARDCASE: "window",
  IFCSTAIR: "stair", IFCSTAIRFLIGHT: "stairflight", IFCRAMP: "ramp", IFCRAMPFLIGHT: "ramp", IFCRAILING: "railing",
  IFCSPACE: "space", IFCPLATE: "plate", IFCPLATESTANDARDCASE: "plate", IFCMEMBER: "member", IFCMEMBERSTANDARDCASE: "member",
  IFCCOVERING: "covering", IFCFURNISHINGELEMENT: "furniture", IFCFURNITURE: "furniture", IFCSYSTEMFURNITUREELEMENT: "furniture",
  IFCBUILDINGELEMENTPROXY: "proxy", IFCSITE: "site", IFCGEOGRAPHICELEMENT: "site",
};

const PREFIX: Record<string, number> = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 10, DECI: 0.1, CENTI: 0.01, MILLI: 0.001, MICRO: 1e-6, NANO: 1e-9 };
const CONVERSION: Record<string, number> = { FOOT: 0.3048, INCH: 0.0254, YARD: 0.9144, MILE: 1609.344, "SQUARE FOOT": 0.09290304, "SQUARE INCH": 0.00064516, "SQUARE YARD": 0.83612736 };

const val = (x: unknown): unknown => (x && typeof x === "object" && "value" in (x as object) ? (x as { value: unknown }).value : x);
const str = (x: unknown): string => { const v = val(x); return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v); };
const num = (x: unknown): number | undefined => { const v = Number(val(x)); return Number.isFinite(v) ? v : undefined; };
const ref = (x: unknown): number | undefined => { const v = val(x); return typeof v === "number" ? v : undefined; };
const refs = (x: unknown): number[] => (Array.isArray(x) ? x.map(ref).filter((n): n is number => n !== undefined) : []);

function ids(api: Api, model: number, type: number): number[] {
  const v = api.GetLineIDsWithType(model, type);
  const out: number[] = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
}

function safeLine(api: Api, model: number, id: number | undefined): Line | null {
  if (id === undefined) return null;
  try { return api.GetLine(model, id) as Line; } catch { return null; }
}

/** Units → metres per length unit and ㎡ per area unit. */
function readUnits(api: Api, model: number): { length: number; area: number } {
  let length = 1, area = 1;
  const siScale = (u: Line | null): number => (u ? PREFIX[str(u.Prefix)] ?? 1 : 1);
  for (const ua of ids(api, model, WebIFC.IFCUNITASSIGNMENT)) {
    const line = safeLine(api, model, ua);
    for (const uid of refs(line?.Units)) {
      const u = safeLine(api, model, uid);
      if (!u) continue;
      const kind = str(u.UnitType);
      let scale: number | undefined;
      if (u.type === WebIFC.IFCSIUNIT) scale = kind === "AREAUNIT" ? siScale(u) ** 2 : kind === "VOLUMEUNIT" ? siScale(u) ** 3 : siScale(u);
      else if (u.type === WebIFC.IFCCONVERSIONBASEDUNIT) {
        const mw = safeLine(api, model, ref(u.ConversionFactor));
        const comp = safeLine(api, model, ref(mw?.UnitComponent));
        const v = num(mw?.ValueComponent);
        scale = v !== undefined ? v * (kind === "AREAUNIT" ? siScale(comp) ** 2 : siScale(comp)) : CONVERSION[str(u.Name).toUpperCase()];
      }
      if (scale === undefined) continue;
      if (kind === "LENGTHUNIT") length = scale;
      if (kind === "AREAUNIT") area = scale;
    }
  }
  return { length, area };
}

const LENGTH_TYPES = /^IFC(POSITIVE|NONNEGATIVE)?LENGTHMEASURE$/;

function toProp(nominal: Line | undefined, units: { length: number; area: number }): PropValue | undefined {
  if (!nominal) return undefined;
  const t = String(nominal.name || "").toUpperCase();
  const v = nominal.value;
  if (v === undefined || v === null) return undefined;
  if (t === "IFCBOOLEAN" || t === "IFCLOGICAL") { if (v === true || v === "T" || v === ".T.") return true; if (v === false || v === "F" || v === ".F.") return false; return undefined; }
  if (typeof v === "number") return LENGTH_TYPES.test(t) ? v * units.length : t === "IFCAREAMEASURE" ? v * units.area : v;
  return String(v);
}

/** Instance + type property sets and quantity sets, keyed "Pset.Prop". */
function readProperties(api: Api, model: number, units: { length: number; area: number }): Map<number, Record<string, PropValue>> {
  const psetCache = new Map<number, Record<string, PropValue>>();
  const readPset = (pid: number): Record<string, PropValue> => {
    const hit = psetCache.get(pid);
    if (hit) return hit;
    const out: Record<string, PropValue> = {};
    const p = safeLine(api, model, pid);
    if (p) {
      const name = str(p.Name) || "Pset";
      if (p.type === WebIFC.IFCPROPERTYSET) {
        for (const id of refs(p.HasProperties)) {
          const prop = safeLine(api, model, id);
          if (!prop) continue;
          const key = `${name}.${str(prop.Name)}`;
          if (prop.type === WebIFC.IFCPROPERTYSINGLEVALUE) { const v = toProp(prop.NominalValue, units); if (v !== undefined) out[key] = v; }
          else if (prop.type === WebIFC.IFCPROPERTYENUMERATEDVALUE && Array.isArray(prop.EnumerationValues) && prop.EnumerationValues[0]) out[key] = String(val(prop.EnumerationValues[0]));
        }
      } else if (p.type === WebIFC.IFCELEMENTQUANTITY) {
        for (const id of refs(p.Quantities)) {
          const q = safeLine(api, model, id);
          if (!q) continue;
          const key = `${name}.${str(q.Name)}`;
          const n = num(q.LengthValue) ?? num(q.AreaValue) ?? num(q.VolumeValue) ?? num(q.CountValue) ?? num(q.WeightValue);
          if (n === undefined) continue;
          out[key] = q.type === WebIFC.IFCQUANTITYLENGTH ? n * units.length : q.type === WebIFC.IFCQUANTITYAREA ? n * units.area : n;
        }
      }
    }
    psetCache.set(pid, out);
    return out;
  };
  const byElement = new Map<number, Record<string, PropValue>>();
  const typeProps = new Map<number, Record<string, PropValue>>();
  for (const rid of ids(api, model, WebIFC.IFCRELDEFINESBYTYPE)) {
    const rel = safeLine(api, model, rid);
    const t = safeLine(api, model, ref(rel?.RelatingType));
    if (!rel || !t) continue;
    const props: Record<string, PropValue> = {};
    for (const pid of refs(t.HasPropertySets)) Object.assign(props, readPset(pid));
    if (str(t.Name)) props["Type.Name"] = str(t.Name);
    for (const e of refs(rel.RelatedObjects)) typeProps.set(e, props);
  }
  for (const [e, props] of typeProps) byElement.set(e, { ...props });
  for (const rid of ids(api, model, WebIFC.IFCRELDEFINESBYPROPERTIES)) {
    const rel = safeLine(api, model, rid);
    const pid = ref(rel?.RelatingPropertyDefinition);
    if (!rel || pid === undefined) continue;
    const props = readPset(pid);
    for (const e of refs(rel.RelatedObjects)) byElement.set(e, { ...(byElement.get(e) || {}), ...props });
  }
  return byElement;
}

/** 4×4 column-major multiply of a point. */
const mul = (m: number[], x: number, y: number, z: number): Vec3 => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

export type ReadOptions = { onProgress?: (stage: string, pct: number) => void };

export function readIfc(api: Api, bytes: Uint8Array, opts: ReadOptions = {}): ParsedModel {
  const report = opts.onProgress || (() => {});
  report("IFC 파일 해석", 0);
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 12 });
  if (model < 0) throw new Error("IFC 파일을 열 수 없습니다.");
  try {
    return readOpen(api, model, report);
  } finally {
    api.CloseModel(model);
  }
}

function readOpen(api: Api, model: number, report: (stage: string, pct: number) => void): ParsedModel {
  const warnings: string[] = [];
  const schema = api.GetModelSchema(model);
  const units = readUnits(api, model);

  report("속성 읽기", 0.05);
  const props = readProperties(api, model, units);

  // Spatial structure
  const storeyOf = new Map<number, number>();
  const parentOf = new Map<number, number>();
  const storeyIds = new Set(ids(api, model, WebIFC.IFCBUILDINGSTOREY));
  for (const rid of ids(api, model, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const rel = safeLine(api, model, rid);
    const s = ref(rel?.RelatingStructure);
    if (s === undefined || !storeyIds.has(s)) continue;
    for (const e of refs(rel?.RelatedElements)) storeyOf.set(e, s);
  }
  for (const rid of ids(api, model, WebIFC.IFCRELAGGREGATES)) {
    const rel = safeLine(api, model, rid);
    const p = ref(rel?.RelatingObject);
    if (p === undefined) continue;
    for (const c of refs(rel?.RelatedObjects)) { parentOf.set(c, p); if (storeyIds.has(p)) storeyOf.set(c, p); }
  }
  const storeyFor = (id: number): number | undefined => {
    let cur: number | undefined = id;
    for (let i = 0; i < 8 && cur !== undefined; i++) { const s = storeyOf.get(cur); if (s !== undefined) return s; cur = parentOf.get(cur); }
    return undefined;
  };

  // Geometry
  report("형상 생성", 0.1);
  const elements = new Map<number, ParsedElement>();
  const chunks = new Map<number, { pos: Float32Array[]; idx: Uint32Array[] }>();
  const take = (mesh: WebIFC.FlatMesh) => {
    const id = mesh.expressID;
    const geoms = mesh.geometries;
    let c = chunks.get(id);
    if (!c) { c = { pos: [], idx: [] }; chunks.set(id, c); }
    for (let i = 0; i < geoms.size(); i++) {
      const pg = geoms.get(i);
      const geo = api.GetGeometry(model, pg.geometryExpressID);
      const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
      const ix = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
      const M = pg.flatTransformation;
      const n = v.length / 6;
      const pos = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const x = v[k * 6], y = v[k * 6 + 1], z = v[k * 6 + 2];
        // web-ifc output (Y-up) → analysis (Z-up): (x, y, z) → (x, -z, y)
        pos[k * 3] = M[0] * x + M[4] * y + M[8] * z + M[12];
        pos[k * 3 + 1] = -(M[2] * x + M[6] * y + M[10] * z + M[14]);
        pos[k * 3 + 2] = M[1] * x + M[5] * y + M[9] * z + M[13];
      }
      c.pos.push(pos);
      c.idx.push(new Uint32Array(ix));
      geo.delete?.();
    }
  };
  api.StreamAllMeshes(model, (mesh, index, total) => {
    take(mesh);
    if (index % 200 === 0) report("형상 생성", 0.1 + 0.6 * (index / Math.max(1, total)));
  });
  // Rooms are not part of StreamAllMeshes. (StreamMeshes is broken in the 0.0.78 browser
  // build — its wrapper passes 4 arguments to a 3-argument binding — so stream by type.)
  const spaceIds = ids(api, model, WebIFC.IFCSPACE);
  if (spaceIds.length) api.StreamAllMeshesWithTypes(model, [WebIFC.IFCSPACE], mesh => take(mesh));

  // The origin shift is fixed once geometry has been generated — read it only now.
  const C = api.GetCoordinationMatrix(model);
  const toA = (x: number, y: number, z: number): Vec3 => { const r = mul(C, x * units.length, z * units.length, -y * units.length); return [r[0], -r[2], r[1]]; };
  const worldZ = (placement: number | undefined): number | undefined => {
    if (placement === undefined) return undefined;
    try { const m = api.GetWorldTransformMatrix(model, placement); return toA(m[12], m[13], m[14])[2]; } catch { return undefined; }
  };
  const storeys: ParsedStorey[] = [...storeyIds].map(id => {
    const s = safeLine(api, model, id)!;
    const el = worldZ(ref(s.ObjectPlacement)) ?? toA(0, 0, num(s.Elevation) ?? 0)[2];
    return { id, guid: str(s.GlobalId), name: str(s.Name) || str(s.LongName) || `층 ${id}`, elevation: el, props: props.get(id) || {} };
  }).sort((a, b) => a.elevation - b.elevation);

  const projectLine = safeLine(api, model, ids(api, model, WebIFC.IFCPROJECT)[0]);
  const app = safeLine(api, model, ids(api, model, WebIFC.IFCAPPLICATION)[0]);
  const siteId = ids(api, model, WebIFC.IFCSITE)[0];
  const siteLine = safeLine(api, model, siteId);
  const buildingId = ids(api, model, WebIFC.IFCBUILDING)[0];
  const buildingLine = safeLine(api, model, buildingId);

  // True north from the 3D model context.
  let north: Vec2 = [0, 1];
  let northSource: ParsedModel["northSource"] = "default";
  for (const cid of ids(api, model, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT)) {
    const c = safeLine(api, model, cid);
    if (!c || (str(c.ContextType) && !/model/i.test(str(c.ContextType)))) continue;
    const dir = safeLine(api, model, ref(c.TrueNorth));
    const r = Array.isArray(dir?.DirectionRatios) ? dir!.DirectionRatios.map((x: unknown) => num(x) ?? 0) : null;
    if (r && Math.hypot(r[0], r[1]) > 1e-9) { const l = Math.hypot(r[0], r[1]); north = [r[0] / l, r[1] / l]; northSource = "model"; break; }
  }

  // Site footprint (IfcSite FootPrint curve), in the site's placement.
  let boundary: Vec2[] | undefined;
  if (siteLine) {
    try { boundary = siteFootprint(api, model, siteLine, toA); } catch (e) { warnings.push(`대지경계선 해석 실패: ${e instanceof Error ? e.message : String(e)}`); }
  }


  report("요소 정리", 0.72);
  for (const [id, c] of chunks) {
    const line = safeLine(api, model, id);
    if (!line) continue;
    const typeName = api.GetNameFromTypeCode(line.type) || "";
    const upper = typeName.toUpperCase();
    let kind: ElementKind = KIND[upper] || "other";
    const predefined = str(line.PredefinedType);
    if (kind === "slab" && predefined === "ROOF") kind = "roof";
    let total = 0, totalIdx = 0;
    for (const p of c.pos) total += p.length;
    for (const p of c.idx) totalIdx += p.length;
    const positions = new Float32Array(total);
    const indices = new Uint32Array(totalIdx);
    let o = 0, oi = 0;
    for (let i = 0; i < c.pos.length; i++) {
      positions.set(c.pos[i], o);
      const base = o / 3;
      const src = c.idx[i];
      for (let k = 0; k < src.length; k++) indices[oi + k] = src[k] + base;
      o += c.pos[i].length; oi += src.length;
    }
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < positions.length; k += 3) for (let j = 0; j < 3; j++) { const q = positions[k + j]; if (q < min[j]) min[j] = q; if (q > max[j]) max[j] = q; }
    if (!Number.isFinite(min[0])) continue;
    const L = units.length;
    const attrs: ParsedElement["attrs"] = {};
    if (num(line.OverallWidth) !== undefined) attrs.overallWidth = num(line.OverallWidth)! * L;
    if (num(line.OverallHeight) !== undefined) attrs.overallHeight = num(line.OverallHeight)! * L;
    if (num(line.RiserHeight) !== undefined) attrs.riserHeight = num(line.RiserHeight)! * L;
    if (num(line.TreadLength) !== undefined) attrs.treadLength = num(line.TreadLength)! * L;
    if (num(line.NumberOfRisers) !== undefined) attrs.risers = num(line.NumberOfRisers);
    if (num(line.NumberOfTreads) !== undefined) attrs.treads = num(line.NumberOfTreads);
    elements.set(id, {
      id, guid: str(line.GlobalId), ifcType: typeName.replace(/^IFC/i, "Ifc"), kind,
      name: str(line.Name), longName: str(line.LongName) || undefined, objectType: str(line.ObjectType) || undefined, predefined: predefined || undefined,
      storey: storeyFor(id), parent: parentOf.get(id), props: props.get(id) || {}, attrs, min, max, positions, indices,
    });
  }
  chunks.clear();

  // Aggregates without own geometry (IfcStair, IfcCurtainWall, IfcRoof) still matter for grouping.
  for (const [child, p] of parentOf) {
    if (elements.has(p) || !elements.has(child) || storeyIds.has(p)) continue;
    const line = safeLine(api, model, p);
    if (!line) continue;
    const typeName = api.GetNameFromTypeCode(line.type) || "";
    const kind = KIND[typeName.toUpperCase()];
    if (!kind || kind === "site" || kind === "space") continue;
    const kids = [...parentOf].filter(([, q]) => q === p).map(([c2]) => elements.get(c2)).filter((x): x is ParsedElement => !!x);
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const k of kids) for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], k.min[j]); max[j] = Math.max(max[j], k.max[j]); }
    elements.set(p, { id: p, guid: str(line.GlobalId), ifcType: typeName.replace(/^IFC/i, "Ifc"), kind, name: str(line.Name), objectType: str(line.ObjectType) || undefined, predefined: str(line.PredefinedType) || undefined, storey: storeyFor(p), parent: parentOf.get(p), props: props.get(p) || {}, attrs: {}, min, max });
  }

  if (!storeys.length) warnings.push("층(IfcBuildingStorey)이 없습니다.");
  if (!spaceIds.length) warnings.push("실(IfcSpace)이 없습니다. Revit IFC 내보내기에서 '룸 내보내기'를 켜야 실 단위 검토(피난거리·복도·반자높이·채광)를 할 수 있습니다.");

  report("요소 정리", 0.78);
  return {
    schema,
    project: { name: str(projectLine?.LongName) || str(projectLine?.Name) || "", description: str(projectLine?.Description) || undefined, application: app ? `${str(app.ApplicationFullName)} ${str(app.Version)}`.trim() : undefined },
    lengthUnit: units.length,
    site: siteLine ? { id: siteId, guid: str(siteLine.GlobalId), name: str(siteLine.Name), props: props.get(siteId) || {}, boundary } : undefined,
    building: buildingLine ? { id: buildingId, guid: str(buildingLine.GlobalId), name: str(buildingLine.Name), props: props.get(buildingId) || {} } : undefined,
    storeys,
    elements: [...elements.values()],
    north, northSource, offset: toA(0, 0, 0), warnings,
  };
}

function siteFootprint(api: Api, model: number, site: Line, toA: (x: number, y: number, z: number) => Vec3): Vec2[] | undefined {
  const shape = safeLine(api, model, ref(site.Representation));
  if (!shape) return undefined;
  let W: number[] | null = null;
  try { W = api.GetWorldTransformMatrix(model, ref(site.ObjectPlacement)!); } catch { W = null; }
  const loops: Vec2[][] = [];
  const point2 = (pid: number): [number, number] | null => {
    const p = safeLine(api, model, pid);
    const c = Array.isArray(p?.Coordinates) ? p!.Coordinates.map((x: unknown) => num(x) ?? 0) : null;
    return c ? [c[0], c[1]] : null;
  };
  const curve = (id: number, depth = 0) => {
    const c = safeLine(api, model, id);
    if (!c || depth > 4) return;
    if (c.type === WebIFC.IFCPOLYLINE) { const pts = refs(c.Points).map(point2).filter((x): x is [number, number] => !!x); if (pts.length >= 3) loops.push(pts); }
    else if (c.type === WebIFC.IFCINDEXEDPOLYCURVE) {
      const list = safeLine(api, model, ref(c.Points));
      const coords = Array.isArray(list?.CoordList) ? list!.CoordList.map((row: unknown[]) => row.map(x => num(x) ?? 0)) : [];
      if (coords.length >= 3) loops.push(coords.map((r: number[]) => [r[0], r[1]] as Vec2));
    } else if (c.type === WebIFC.IFCGEOMETRICCURVESET || c.type === WebIFC.IFCGEOMETRICSET) for (const e of refs(c.Elements)) curve(e, depth + 1);
    else if (c.type === WebIFC.IFCCOMPOSITECURVE) {
      const pts: Vec2[] = [];
      for (const sid of refs(c.Segments)) { const seg = safeLine(api, model, sid); const pc = safeLine(api, model, ref(seg?.ParentCurve)); if (pc?.type === WebIFC.IFCPOLYLINE) for (const p of refs(pc.Points)) { const q = point2(p); if (q) pts.push(q); } }
      if (pts.length >= 3) loops.push(pts);
    }
  };
  for (const rid of refs(shape.Representations)) {
    const rep = safeLine(api, model, rid);
    if (!rep) continue;
    const ident = str(rep.RepresentationIdentifier), type = str(rep.RepresentationType);
    if (!/footprint/i.test(ident) && !/curve|geometriccurveset|geometricset/i.test(type)) continue;
    for (const it of refs(rep.Items)) curve(it);
  }
  if (!loops.length) return undefined;
  const area = (l: Vec2[]) => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const best = loops.sort((a, b) => area(b) - area(a))[0];
  const out = best.map(([x, y]) => { const w = W ? mul(W, x, y, 0) : [x, y, 0]; const a = toA(w[0], w[1], w[2]); return [a[0], a[1]] as Vec2; });
  // Drop a closing duplicate point.
  if (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}
