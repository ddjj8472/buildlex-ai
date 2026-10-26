// Geometry helpers for the BIM checks: plan rasters, plane slices, walking-distance
// fields, oriented rectangles, polygon tests. Pure functions on typed arrays — no
// three.js, no web-ifc — so they run in the worker and in Node tests alike.
import type { Vec2, Vec3 } from "./types.ts";

export type Mesh = { positions: Float32Array; indices: Uint32Array };

export class Grid {
  readonly nx: number;
  readonly ny: number;
  constructor(readonly ox: number, readonly oy: number, readonly cell: number, maxX: number, maxY: number) {
    this.nx = Math.max(1, Math.ceil((maxX - ox) / cell));
    this.ny = Math.max(1, Math.ceil((maxY - oy) / cell));
  }
  static around(min: Vec2, max: Vec2, margin: number, cell: number): Grid {
    return new Grid(min[0] - margin, min[1] - margin, cell, max[0] + margin, max[1] + margin);
  }
  get size() { return this.nx * this.ny; }
  ix(x: number) { return Math.floor((x - this.ox) / this.cell); }
  iy(y: number) { return Math.floor((y - this.oy) / this.cell); }
  at(x: number, y: number): number { const i = this.ix(x), j = this.iy(y); return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i; }
  cx(i: number) { return this.ox + (i + 0.5) * this.cell; }
  cy(j: number) { return this.oy + (j + 0.5) * this.cell; }
}

/** Fill cells whose centres fall inside the XY projection of the triangles. */
export function rasterTriangles(g: Grid, out: Uint8Array | Int32Array, mesh: Mesh, value: number, keep?: (z0: number, z1: number, z2: number) => boolean) {
  const p = mesh.positions, idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    if (keep && !keep(p[a + 2], p[b + 2], p[c + 2])) continue;
    const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue; // vertical face → no plan area
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - g.ox) / g.cell - 0.5));
    const i1 = Math.min(g.nx - 1, Math.ceil((Math.max(ax, bx, cx) - g.ox) / g.cell - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - g.oy) / g.cell - 0.5));
    const j1 = Math.min(g.ny - 1, Math.ceil((Math.max(ay, by, cy) - g.oy) / g.cell - 0.5));
    const s = area > 0 ? 1 : -1;
    for (let j = j0; j <= j1; j++) {
      const y = g.cy(j);
      for (let i = i0; i <= i1; i++) {
        const x = g.cx(i);
        const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * s;
        const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * s;
        const w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) * s;
        if (w0 >= -1e-12 && w1 >= -1e-12 && w2 >= -1e-12) out[j * g.nx + i] = value;
      }
    }
  }
}

/** Segments where the triangles cut the horizontal plane z = h. */
export function slice(mesh: Mesh, h: number): number[] {
  const p = mesh.positions, idx = mesh.indices;
  const out: number[] = [];
  const pts: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    pts.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e] * 3, b = idx[t + ((e + 1) % 3)] * 3;
      const za = p[a + 2] - h, zb = p[b + 2] - h;
      if ((za < 0 && zb >= 0) || (za >= 0 && zb < 0)) {
        const k = za / (za - zb);
        pts.push(p[a] + (p[b] - p[a]) * k, p[a + 1] + (p[b + 1] - p[a + 1]) * k);
      }
    }
    if (pts.length >= 4) out.push(pts[0], pts[1], pts[2], pts[3]);
  }
  return out;
}

/** Mark every cell a segment passes through (dense sampling ≈ supercover). */
export function rasterSegments(g: Grid, out: Uint8Array, segs: number[], value = 1) {
  const step = g.cell / 3;
  for (let s = 0; s < segs.length; s += 4) {
    const x0 = segs[s], y0 = segs[s + 1], x1 = segs[s + 2], y1 = segs[s + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k <= n; k++) {
      const i = g.at(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
      if (i >= 0) out[i] = value;
    }
  }
}

export const countCells = (m: Uint8Array) => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };

/** Contour length of a binary mask (marching squares through cell centres). */
export function perimeter(g: Grid, m: Uint8Array): number {
  const D = Math.SQRT1_2;
  let len = 0;
  const v = (i: number, j: number) => (i >= 0 && j >= 0 && i < g.nx && j < g.ny && m[j * g.nx + i] ? 1 : 0);
  for (let j = -1; j < g.ny; j++) for (let i = -1; i < g.nx; i++) {
    const c = v(i, j) | (v(i + 1, j) << 1) | (v(i + 1, j + 1) << 2) | (v(i, j + 1) << 3);
    if (c === 0 || c === 15) continue;
    if (c === 5 || c === 10) len += 2 * D;
    else if (c === 3 || c === 6 || c === 9 || c === 12) len += 1;
    else len += D;
  }
  return len * g.cell;
}

/** Multi-source walking distance (16-neighbour moves, no corner cutting). */
export function walkDistances(g: Grid, free: Uint8Array, sources: number[]): Float32Array {
  const dist = new Float32Array(g.size).fill(Infinity);
  const heapD: number[] = [], heapI: number[] = [];
  const push = (d: number, i: number) => {
    heapD.push(d); heapI.push(i);
    let k = heapD.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heapD[p] <= heapD[k]) break; [heapD[p], heapD[k]] = [heapD[k], heapD[p]]; [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; k = p; }
  };
  const pop = (): [number, number] => {
    const d = heapD[0], i = heapI[0];
    const ld = heapD.pop()!, li = heapI.pop()!;
    if (heapD.length) {
      heapD[0] = ld; heapI[0] = li;
      let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heapD.length && heapD[l] < heapD[m]) m = l; if (r < heapD.length && heapD[r] < heapD[m]) m = r; if (m === k) break; [heapD[m], heapD[k]] = [heapD[k], heapD[m]]; [heapI[m], heapI[k]] = [heapI[k], heapI[m]]; k = m; }
    }
    return [d, i];
  };
  for (const s of sources) if (free[s] && dist[s] > 0) { dist[s] = 0; push(0, s); }
  const c = g.cell, nx = g.nx, ny = g.ny;
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && free[j * nx + i] === 1;
  const moves: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    [2, 1, Math.sqrt(5)], [1, 2, Math.sqrt(5)], [-2, 1, Math.sqrt(5)], [-1, 2, Math.sqrt(5)],
    [2, -1, Math.sqrt(5)], [1, -2, Math.sqrt(5)], [-2, -1, Math.sqrt(5)], [-1, -2, Math.sqrt(5)],
  ];
  while (heapD.length) {
    const [d, idx] = pop();
    if (d > dist[idx]) continue;
    const i = idx % nx, j = (idx - i) / nx;
    for (const [dx, dy, w] of moves) {
      const ti = i + dx, tj = j + dy;
      if (!ok(ti, tj)) continue;
      const adx = Math.abs(dx), ady = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy);
      if (adx === 1 && ady === 1 && (!ok(i + dx, j) || !ok(i, j + dy))) continue;
      if (adx === 2 && (!ok(i + sx, j) || !ok(i + sx, j + dy))) continue;
      if (ady === 2 && (!ok(i, j + sy) || !ok(i + dx, j + sy))) continue;
      // Store and queue the same float32 value, or the pop-time staleness test drops nodes.
      const nd = Math.fround(d + w * c);
      const t = tj * nx + ti;
      if (nd < dist[t]) { dist[t] = nd; push(nd, t); }
    }
  }
  return dist;
}

/** 4-connected components among marked cells. */
export function components(g: Grid, m: Uint8Array): number {
  const seen = new Uint8Array(g.size);
  let n = 0;
  const stack: number[] = [];
  for (let s = 0; s < g.size; s++) {
    if (!m[s] || seen[s]) continue;
    n++; seen[s] = 1; stack.push(s);
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % g.nx, j = (k - i) / g.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= g.nx || b >= g.ny) continue;
        const t = b * g.nx + a;
        if (m[t] && !seen[t]) { seen[t] = 1; stack.push(t); }
      }
    }
  }
  return n;
}

// ───────────────────────────── 2D shapes ─────────────────────────────

export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(s) / 2;
}

export function pointInPolygon(x: number, y: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p along unit direction d to the first polygon edge (or null). */
export function rayToPolygon(px: number, py: number, d: Vec2, poly: Vec2[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax, ey = by - ay;
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - px) * ey - (ay - py) * ex) / den;
    const u = ((ax - px) * d[1] - (ay - py) * d[0]) / den;
    if (t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = Math.max(0, t);
  }
  return best;
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [], upper: Vec2[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export type OrientedRect = { center: Vec2; u: Vec2; v: Vec2; length: number; width: number };

/** Minimum-area enclosing rectangle; `u` is the long axis. */
export function minAreaRect(points: Vec2[]): OrientedRect {
  const hull = convexHull(points);
  if (hull.length < 3) {
    const [a, b] = [hull[0] || [0, 0], hull[1] || hull[0] || [0, 0]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    return { center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u, v: [-u[1], u[0]], length: L, width: 0 };
  }
  let best: OrientedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], v: Vec2 = [-u[1], u[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) { const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1]; u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea - 1e-12) {
      bestArea = area;
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const center: Vec2 = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
      best = u1 - u0 >= v1 - v0 ? { center, u, v, length: u1 - u0, width: v1 - v0 } : { center, u: v, v: [-u[0], -u[1]] as Vec2, length: v1 - v0, width: u1 - u0 };
    }
  }
  return best!;
}

export function xyPoints(mesh: Mesh, filter?: (z: number) => boolean): Vec2[] {
  const out: Vec2[] = [];
  const p = mesh.positions;
  for (let k = 0; k < p.length; k += 3) if (!filter || filter(p[k + 2])) out.push([p[k], p[k + 1]]);
  return out;
}

/** Downward-facing faces: exact plan area and boundary length of an extruded solid. */
export function bottomFace(mesh: Mesh): { area: number; perimeter: number; z: number } {
  const p = mesh.positions, idx = mesh.indices;
  let zmin = Infinity;
  for (let k = 2; k < p.length; k += 3) zmin = Math.min(zmin, p[k]);
  let area = 0;
  const edges = new Map<string, number>();
  const key = (i: number) => `${Math.round(p[i] * 1000)},${Math.round(p[i + 1] * 1000)}`;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    if (Math.max(p[a + 2], p[b + 2], p[c + 2]) - zmin > 0.01) continue;
    const cross = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
    if (Math.abs(cross) < 1e-10) continue;
    area += Math.abs(cross) / 2;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const ku = key(u), kw = key(w);
      const k = ku < kw ? `${ku}|${kw}` : `${kw}|${ku}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let perim = 0;
  for (const [k, n] of edges) {
    if (n !== 1) continue;
    const [a, b] = k.split("|").map(s => s.split(",").map(Number));
    perim += Math.hypot(a[0] - b[0], a[1] - b[1]) / 1000;
  }
  return { area, perimeter: perim, z: zmin };
}

/** Short side of the rectangle with the same area and perimeter (exact for rectangles). */
export function rectWidth(area: number, perimeter: number): number {
  const s = perimeter / 2;
  const disc = s * s - 4 * area;
  return disc <= 0 ? Math.sqrt(area) : (s - Math.sqrt(disc)) / 2;
}

/** Distance from a point to the XY projection of a mesh (0 inside a projected triangle). */
export function planDistance(mesh: Mesh, x: number, y: number, limit: number): number {
  const p = mesh.positions, idx = mesh.indices;
  let best = Infinity;
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
    return Math.hypot(ax + dx * t - x, ay + dy * t - y);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1], cx = p[c], cy = p[c + 1];
    if (Math.min(ax, bx, cx) - limit > x || Math.max(ax, bx, cx) + limit < x || Math.min(ay, by, cy) - limit > y || Math.max(ay, by, cy) + limit < y) continue;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) > 1e-10) {
      const s = area > 0 ? 1 : -1;
      const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * s, w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * s, w2 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) * s;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) return 0;
    }
    best = Math.min(best, seg(ax, ay, bx, by), seg(bx, by, cx, cy), seg(cx, cy, ax, ay));
  }
  return best;
}

export const median = (xs: number[]): number => { if (!xs.length) return NaN; const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const centerOf = (min: Vec3, max: Vec3): Vec3 => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
