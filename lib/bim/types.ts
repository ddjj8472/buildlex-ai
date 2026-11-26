// BIM 법규검토 (/bim) — shared types.
//
// Pipeline (Solibri-style rule checking on an IFC model, localised for Korean law
// the way Singapore's CORENET X localises IFC with IFC-SG):
//
//   browser worker   IFC bytes ─ web-ifc ─▶ ParsedModel (elements, storeys, geometry)
//                                          ─▶ analyze() ─▶ BimFacts  (measured, compact)
//                                                        ─▶ overlays (egress heat-map …, viewer only)
//   server           BimFacts + user values ─▶ rules.ts (thresholds parsed from the statute text)
//                                          ─▶ BimRuleResult[] with element-level issues
//   browser          issues ⇄ 3D viewer highlight, BCF export, 보완요구서(안)
//
// All geometry is in the "analysis frame": metres, Z up, IFC project XY axes
// (only translated toward the origin for float precision).
import type { CheckStatus, ComplianceFile, ComplianceItem, Confidence, ProjectValues } from "../review/types.ts";

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type ElementKind =
  | "wall" | "curtainwall" | "slab" | "roof" | "column" | "beam" | "door" | "window"
  | "stair" | "stairflight" | "ramp" | "railing" | "space" | "plate" | "member" | "covering"
  | "furniture" | "proxy" | "site" | "other";

export type PropValue = string | number | boolean;

export type ParsedElement = {
  id: number;
  guid: string;
  ifcType: string;
  kind: ElementKind;
  name: string;
  longName?: string;
  objectType?: string;
  predefined?: string;
  storey?: number;
  parent?: number;
  /** "Pset_WallCommon.IsExternal" → value. Lengths converted to metres, areas to ㎡. */
  props: Record<string, PropValue>;
  /** Selected direct attributes, already in metres. */
  attrs: { overallWidth?: number; overallHeight?: number; riserHeight?: number; treadLength?: number; risers?: number; treads?: number; elevation?: number };
  min: Vec3;
  max: Vec3;
  /** Triangles in the analysis frame (flat xyz). */
  positions?: Float32Array;
  indices?: Uint32Array;
};

export type ParsedStorey = { id: number; guid: string; name: string; elevation: number; props: Record<string, PropValue> };

export type ParsedModel = {
  schema: string;
  project: { name: string; description?: string; application?: string };
  /** metres per model length unit */
  lengthUnit: number;
  site?: { id: number; guid: string; name: string; props: Record<string, PropValue>; boundary?: Vec2[] };
  building?: { id: number; guid: string; name: string; props: Record<string, PropValue> };
  storeys: ParsedStorey[];
  elements: ParsedElement[];
  /** Unit vector of true north in the analysis frame XY. */
  north: Vec2;
  northSource: "model" | "default";
  /** Analysis frame = raw IFC metres + offset. */
  offset: Vec3;
  warnings: string[];
};

// ───────────────────────────── measured facts (sent to the server) ─────────────────────────────

export type ElemRef = { id: number; guid: string; name: string; type: string; storey?: string };

export type SpaceUse = "거실" | "복도" | "계단실" | "화장실" | "주차" | "설비" | "창고" | "발코니" | "홀" | "승강기" | "조경" | "기타";

export type SpaceFact = {
  ref: ElemRef;
  storeyId?: number;
  use: SpaceUse;
  useSource: "property" | "name" | "default";
  label: string;
  area: number;
  height: number;
  heightSource: "property" | "geometry";
  perimeter: number;
  /** Rectangle-equivalent short side (exact for rectangles). */
  minWidth: number;
  windowArea: number;
  windows: ElemRef[];
  /** Corridors only: 거실 on both long sides. */
  bothSidesHabitable?: boolean;
  unit?: string;
  farExcluded?: boolean;
  center: Vec3;
};

export type FlightFact = {
  ref: ElemRef;
  rise: number;
  riser?: number;
  tread?: number;
  risers?: number;
  stepSource: "attribute" | "pset" | "geometry" | "none";
  width: number;
  run: number;
  zMin: number;
  zMax: number;
  guardLeft: boolean;
  guardRight: boolean;
  center: Vec3;
};

export type StairFact = { ref: ElemRef; storeyId?: number; flights: FlightFact[]; landings: { ref: ElemRef; depth: number; width: number }[] };

export type DoorFact = { ref: ElemRef; width: number; height: number; clearWidth?: number; external: boolean; main: boolean; center: Vec3 };

export type RailingFact = { ref: ElemRef; height?: number; heightSource: "pset" | "geometry" | "none"; where: "계단" | "옥상" | "노대" | "실내" | "기타"; whereSource: "property" | "inferred"; center: Vec3 };

export type ParkingFact = { ref: ElemRef; kind: "일반형" | "확장형" | "장애인전용" | "경형" | "평행주차"; width: number; length: number; center: Vec3 };

export type StoreyFact = {
  id: number;
  name: string;
  elevation: number;
  height: number;
  above: boolean;
  evacuation: boolean;
  floorArea: number;
  floorAreaOuter: number;
  habitableArea: number;
  units: number;
  stairCount: number;
  use?: string;
};

export type EgressSpace = { ref: ElemRef; maxDistance: number | null; at: Vec3; unreachable: number; cells: number };
export type EgressFact = { storeyId: number; storey: string; spaces: EgressSpace[]; stairs: number; cell: number };

export type NorthPoint = { h: number; d: number; at: Vec3; ref: ElemRef };
export type NorthFact = {
  available: boolean;
  reason?: string;
  /** Pareto front of (high h, small d) — decides pass/fail for any monotone rule. */
  frontier: NorthPoint[];
  /** Worst vertex of each element under the standard rule (1.5 m / h÷2 above 10 m), for issue lists. */
  perElement: NorthPoint[];
  minLow?: NorthPoint;
  minHigh?: NorthPoint;
};

export type BimFacts = {
  version: 1;
  source: { file: string; schema: string; project: string; application?: string; elements: number; triangles: number };
  /** BuildLex_KR values on IfcSite / IfcBuilding (lengths in metres). */
  kr: Record<string, PropValue>;
  site: { area?: number; areaSource: "property" | "boundary" | "none"; boundary?: Vec2[]; north: Vec2; northSource: "model" | "default" };
  building: {
    groundZ: number;
    height: number;
    heightRef?: ElemRef;
    footprintOuter: number;
    footprint: number;
    perimeter: number;
    wallThickness: number;
    /** ± plan-raster precision of the area figures (perimeter × cell / 2). */
    areaTolerance: number;
    storeysAbove: number;
    storeysBelow: number;
    grossFloorArea: number;
    farFloorArea: number;
    farExcluded: { label: string; area: number }[];
    landscapeArea?: number;
    landscape: ElemRef[];
  };
  storeys: StoreyFact[];
  spaces: SpaceFact[];
  stairs: StairFact[];
  doors: DoorFact[];
  railings: RailingFact[];
  parking: ParkingFact[];
  egress: EgressFact[];
  north: NorthFact;
  quality: { level: "info" | "warn"; text: string }[];
};

// ───────────────────────────── viewer-only overlays ─────────────────────────────

export type EgressField = {
  storeyId: number;
  elevation: number;
  origin: Vec2;
  cell: number;
  nx: number;
  ny: number;
  /** metres; NaN = not walkable, -1 = walkable but unreachable */
  dist: Float32Array;
};

// ───────────────────────────── rule results ─────────────────────────────

export type Severity = "critical" | "major" | "minor";

export type BimIssue = {
  id: string;
  rule_id: string;
  status: Exclude<CheckStatus, "PASS" | "NOT_APPLICABLE">;
  severity: Severity;
  title: string;
  detail: string;
  refs: ElemRef[];
  at?: Vec3;
  storey?: string;
  measured?: string;
  required?: string;
};

export type BimRuleResult = ComplianceItem & {
  section: "입지·용도" | "대지·밀도" | "높이·일조" | "피난·계단" | "복도·실" | "채광·환기" | "난간·출입구" | "주차·조경";
  source: "bim" | "values" | "land";
  issues: BimIssue[];
  checked: number;
  /** Parsed thresholds the viewer reuses for overlays (e.g. 정북 사선, 보행거리 색상). */
  params?: Record<string, number>;
};

export type BimReviewResult = {
  region?: { key: string; label: string };
  values: ProjectValues;
  rules: BimRuleResult[];
  state: ComplianceFile;
  city: ComplianceFile;
  summary: { total: number; by_status: Record<CheckStatus, number>; issues: number; critical: number; by_confidence: Record<Confidence, number> };
  md: string;
  generated_at: string;
};
