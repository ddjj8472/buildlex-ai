// 시공 단계용 형상 측정 — slab edges, slab openings and excavation depth, measured in the
// worker from the same triangles as the design review (lib/bim/analyze.ts calls this).
//
// Method (Sulankivi·Zhang·Teizer·Eastman 2013, "BIM-based automated safety checking"): for each
// floor level, raster the slabs whose top lies at that level, flood the empty plan from the grid
// border; empty cells the flood cannot reach are holes in the slab (shafts, stair openings, voids),
// and slab cells that touch the flooded outside are the slab edge. While the frame is going up
// both are open fall hazards until walls, stairs, doors or parapets close them, which is why the
// final design's walls are deliberately not treated as protection.
import { Grid, minAreaRect, perimeter, rasterTriangles, type Mesh } from "./geometry.ts";
import type { ConstructionFacts, ElemRef, FallLevelFact, OpeningFact, ParsedElement, SpaceFact, StoreyFact, Vec2 } from "./types.ts";

const meshOf = (e: ParsedElement): Mesh | null => (e.positions && e.indices && e.indices.length ? { positions: e.positions, indices: e.indices } : null);
const r2 = (x: number) => Math.round(x * 100) / 100;
/** Smallest opening that needs protection: KCS 21 70 10 requires a cover where the short side is 200 mm or more. */
export const MIN_OPENING = 0.2;

export type ConstructionInputs = {
  elements: ParsedElement[];
  storeys: StoreyFact[];
  groundZ: number;
  spaces: SpaceFact[];
  ref: (e: ParsedElement) => ElemRef;
};

export function isFoundation(e: ParsedElement): boolean {
  return /^IfcFooting$/i.test(e.ifcType) || (e.kind === "slab" && /BASESLAB/i.test(e.predefined || ""));
}

function isFloorSlab(e: ParsedElement, byId: Map<number, ParsedElement>): boolean {
  if (e.kind !== "slab" && e.kind !== "roof") return false;
  if (/LANDING/i.test(e.predefined || "") || /참|landing/i.test(e.name)) return false;
  if (e.parent !== undefined && byId.get(e.parent)?.kind === "stair") return false;
  return !!meshOf(e);
}

export function constructionFacts(p: ConstructionInputs): ConstructionFacts {
  const byId = new Map(p.elements.map(e => [e.id, e]));
  const slabs = p.elements.filter(e => isFloorSlab(e, byId));
  const flights = p.elements.filter(e => e.kind === "stairflight" || (e.kind === "ramp" && /FLIGHT/i.test(e.ifcType)));
  const levelsSorted = [...p.storeys].sort((a, b) => a.elevation - b.elevation);

  // ── excavation depth: bottom of the largest foundation (or lowest slab); small pits excluded
  //    (집수정·엘리베이터 피트는 굴착깊이에서 제외 — 건설기술진흥법 시행령 제98조①2, 지하안전법 시행령 제13조①1).
  const footprintArea = (e: ParsedElement) => Math.max(0, e.max[0] - e.min[0]) * Math.max(0, e.max[1] - e.min[1]);
  const found = p.elements.filter(e => isFoundation(e) && meshOf(e));
  const lowest = levelsSorted[0];
  const lowSlabs = lowest ? slabs.filter(e => Math.abs(e.max[2] - lowest.elevation) <= 0.4) : [];
  const cands = (found.length ? found : lowSlabs).filter(e => e.min[2] < p.groundZ - 0.05);
  let dig = 0, digSource: ConstructionFacts["digSource"] = "none", digRef: ElemRef | undefined;
  if (cands.length) {
    const big = Math.max(...cands.map(footprintArea));
    const main = cands.filter(e => footprintArea(e) >= big * 0.25);
    const deepest = main.reduce((a, b) => (b.min[2] < a.min[2] ? b : a));
    dig = r2(Math.max(0, p.groundZ - deepest.min[2]));
    digSource = found.length ? "foundation" : "slab";
    digRef = p.ref(deepest);
  }

  if (!slabs.length) return { cell: 0, levels: [], dig, digSource, digRef };

  // One plan grid for every level (fine enough for 0.2 m openings, bounded size).
  const lo: Vec2 = [Infinity, Infinity], hi: Vec2 = [-Infinity, -Infinity];
  for (const e of slabs) { lo[0] = Math.min(lo[0], e.min[0]); lo[1] = Math.min(lo[1], e.min[1]); hi[0] = Math.max(hi[0], e.max[0]); hi[1] = Math.max(hi[1], e.max[1]); }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const cell = Math.min(0.2, Math.max(0.08, extent / 500));
  // Margin off by a fraction of a cell so cell centres never sit exactly on round model coordinates
  // (a centre on a slab edge would count for both sides and bias areas by half a cell).
  const g = Grid.around(lo, hi, 1 + cell * 0.37, cell);
  const nx = g.nx, ny = g.ny;

  const levels: FallLevelFact[] = [];
  levelsSorted.forEach((s, i) => {
    const z = s.elevation;
    const on = slabs.filter(e => e.max[2] >= z - 0.35 && e.max[2] <= z + 0.35);
    if (!on.length) return;
    const raw = new Uint8Array(g.size);
    for (const e of on) rasterTriangles(g, raw, meshOf(e)!, 1);
    const M = close(raw, nx, ny);
    let slabCells = 0;
    for (let k = 0; k < M.length; k++) if (M[k]) slabCells++;
    if (!slabCells) return;

    // Outside = empty cells connected to the grid border.
    const outside = new Uint8Array(g.size);
    const stack: number[] = [];
    const seed = (k: number) => { if (!M[k] && !outside[k]) { outside[k] = 1; stack.push(k); } };
    for (let a = 0; a < nx; a++) { seed(a); seed((ny - 1) * nx + a); }
    for (let b = 0; b < ny; b++) { seed(b * nx); seed(b * nx + nx - 1); }
    flood(stack, outside, k => !M[k], nx, ny);

    // Holes = empty cells the outside flood never reached.
    const holeId = new Int32Array(g.size).fill(-1);
    const holes: number[][] = [];
    for (let k = 0; k < g.size; k++) {
      if (M[k] || outside[k] || holeId[k] >= 0) continue;
      const cells: number[] = [];
      const st = [k];
      holeId[k] = holes.length;
      while (st.length) {
        const q = st.pop()!;
        cells.push(q);
        const a = q % nx, b = (q - a) / nx;
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = a + da, y = b + db;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          const t = y * nx + x;
          if (!M[t] && !outside[t] && holeId[t] < 0) { holeId[t] = holes.length; st.push(t); }
        }
      }
      holes.push(cells);
    }

    // Exterior edge: outline of the slab with its holes filled (marching squares runs through cell
    // centres, so add the half cell on each side: +4·cell for a closed outline).
    const filled = new Uint8Array(g.size);
    for (let k = 0; k < g.size; k++) filled[k] = M[k] || !outside[k] ? 1 : 0;
    const edgeLength = perimeter(g, filled) + 4 * cell;
    const edges = boundarySegments(g, k => filled[k] === 1);

    const below = levelsSorted.slice(0, i).reverse().find(x => x.elevation < z - 0.5);
    const openings: OpeningFact[] = [];
    for (const cells of holes) {
      const area = cells.length * cell * cell;
      if (area < MIN_OPENING * MIN_OPENING) continue;
      const pts: Vec2[] = [];
      for (const k of cells) { const a = k % nx, b = (k - a) / nx; pts.push([g.cx(a), g.cy(b)]); }
      const rect = minAreaRect(pts);
      const width = rect.width + cell, length = rect.length + cell;
      if (width < MIN_OPENING) continue;
      const mask = new Uint8Array(g.size);
      for (const k of cells) mask[k] = 1;
      const [cx, cy] = rect.center;
      const hw = width / 2, hl = length / 2;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([su, sv]) => [r2(cx + rect.u[0] * hl * su + rect.v[0] * hw * sv), r2(cy + rect.u[1] * hl * su + rect.v[1] * hw * sv)]);
      // What fills it in the finished building tells what it is.
      const inside = (x: number, y: number, pad: number) => {
        const du = (x - cx) * rect.u[0] + (y - cy) * rect.u[1], dv = (x - cx) * rect.v[0] + (y - cy) * rect.v[1];
        return Math.abs(du) <= hl + pad && Math.abs(dv) <= hw + pad;
      };
      const levelIds = new Set([s.id, below?.id].filter((x): x is number => x !== undefined));
      const sp = p.spaces.filter(x => x.storeyId !== undefined && levelIds.has(x.storeyId) && (x.use === "승강기" || x.use === "계단실") && inside(x.center[0], x.center[1], 0.3));
      const lift = sp.find(x => x.use === "승강기");
      const stairRoom = sp.find(x => x.use === "계단실");
      const flight = flights.find(f => f.min[2] < z + 0.3 && f.max[2] > z - (s.height || 3) && inside((f.min[0] + f.max[0]) / 2, (f.min[1] + f.max[1]) / 2, 0.5));
      const kind: OpeningFact["kind"] = lift ? "승강로" : stairRoom || flight ? "계단" : "기타";
      openings.push({
        center: [r2(cx), r2(cy)], corners, area: r2(area), width: r2(width), length: r2(length),
        perimeter: r2(perimeter(g, mask) + 4 * cell), kind,
        ref: lift?.ref ?? stairRoom?.ref ?? (flight ? p.ref(flight) : undefined),
        drop: r2(below ? z - below.elevation : 0),
      });
    }
    levels.push({
      storeyId: s.id, storey: s.name, z: r2(z), edgeDrop: r2(z - p.groundZ), slabArea: r2(slabCells * cell * cell),
      edgeLength: r2(edgeLength), edges, openings: openings.sort((a, b) => b.area - a.area).slice(0, 40),
    });
  });
  return { cell: r2(cell * 1000) / 1000, levels, dig, digSource, digRef };
}

/** Morphological close (dilate then erode, 3×3) — joins slabs that meet at a joint or a sliver gap. */
function close(m: Uint8Array, nx: number, ny: number): Uint8Array {
  const pass = (src: Uint8Array, want: number) => {
    const out = new Uint8Array(src.length);
    for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
      let hit = want === 1 ? 0 : 1;
      for (let db = -1; db <= 1 && hit !== want; db++) for (let da = -1; da <= 1; da++) {
        const x = a + da, y = b + db;
        const v = x < 0 || y < 0 || x >= nx || y >= ny ? 0 : src[y * nx + x];
        if (v === want) { hit = want; break; }
      }
      out[b * nx + a] = hit;
    }
    return out;
  };
  return pass(pass(m, 1), 0);
}

function flood(stack: number[], mark: Uint8Array, ok: (k: number) => boolean, nx: number, ny: number) {
  while (stack.length) {
    const k = stack.pop()!;
    const a = k % nx, b = (k - a) / nx;
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = a + da, y = b + db;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      const t = y * nx + x;
      if (!mark[t] && ok(t)) { mark[t] = 1; stack.push(t); }
    }
  }
}

/**
 * Outline of a region as simplified segments [x0,y0,x1,y1,…] for drawing: cell-edge boundary
 * traced into closed loops (region on the left), then Ramer–Douglas–Peucker with a tolerance of
 * 1.5 cells so a rotated or curved slab edge becomes straight lines instead of a staircase.
 */
export function boundarySegments(g: Grid, inRegion: (k: number) => boolean, tol = g.cell * 1.5): number[] {
  const nx = g.nx, ny = g.ny;
  const at = (a: number, b: number) => a >= 0 && b >= 0 && a < nx && b < ny && inRegion(b * nx + a);
  // Directed unit edges between lattice vertices (a,b) with the region on the left.
  const next = new Map<number, number[]>();
  const vid = (a: number, b: number) => b * (nx + 1) + a;
  const add = (a0: number, b0: number, a1: number, b1: number) => { const k = vid(a0, b0); const l = next.get(k); if (l) l.push(vid(a1, b1)); else next.set(k, [vid(a1, b1)]); };
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    if (!at(a, b)) continue;
    if (!at(a, b - 1)) add(a, b, a + 1, b);         // bottom edge, left→right
    if (!at(a + 1, b)) add(a + 1, b, a + 1, b + 1); // right edge, upward
    if (!at(a, b + 1)) add(a + 1, b + 1, a, b + 1); // top edge, right→left
    if (!at(a - 1, b)) add(a, b + 1, a, b);         // left edge, downward
  }
  const out: number[] = [];
  const xy = (v: number): Vec2 => { const a = v % (nx + 1), b = (v - a) / (nx + 1); return [g.ox + a * g.cell, g.oy + b * g.cell]; };
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop: number[] = [start];
      let v = next.get(start)!.pop()!;
      let guard = 0;
      while (v !== start && guard++ < 1e6) {
        loop.push(v);
        const l = next.get(v);
        if (!l || !l.length) break;
        v = l.pop()!;
      }
      const pts = simplify(loop.map(xy), tol);
      for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; out.push(r2(p[0]), r2(p[1]), r2(q[0]), r2(q[1])); }
    }
  }
  return out;
}

/** RDP on a closed ring: split at the two farthest-apart vertices, simplify each half. */
function simplify(ring: Vec2[], tol: number): Vec2[] {
  if (ring.length <= 4) return ring;
  let far = 0, best = -1;
  for (let k = 1; k < ring.length; k++) { const d = Math.hypot(ring[k][0] - ring[0][0], ring[k][1] - ring[0][1]); if (d > best) { best = d; far = k; } }
  const rdp = (pts: Vec2[]): Vec2[] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    let idx = -1, dmax = 0;
    for (let k = 1; k < pts.length - 1; k++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[k][1]) - (a[0] - pts[k][0]) * (b[1] - a[1])) / L;
      if (d > dmax) { dmax = d; idx = k; }
    }
    if (dmax <= tol) return [a, b];
    const l = rdp(pts.slice(0, idx + 1)), r = rdp(pts.slice(idx));
    return [...l.slice(0, -1), ...r];
  };
  const h1 = rdp(ring.slice(0, far + 1)), h2 = rdp([...ring.slice(far), ring[0]]);
  return [...h1.slice(0, -1), ...h2.slice(0, -1)];
}
