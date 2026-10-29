"use client";
// IFC 3D viewer (three.js). Geometry comes straight from the web-ifc worker, so the same
// triangles that were measured for the checks are the ones on screen.
//   • BatchedMesh per material group → a handful of draw calls even for large models
//   • storey isolation, plan section, X-ray, rooms, element picking
//   • issue focus: ghost the model, show the offending elements solid red, fly to them
//   • overlays: walking-distance heat-map per storey, 정북 일조 사선 envelope, site boundary,
//     시공 단계 추락 방호 위치 (slab-edge guardrails and opening covers measured from the slabs)
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EgressField, SpaceUse, Vec2, Vec3 } from "@/lib/bim/types";
import type { ViewerElement, WorkerModel } from "./ifc-worker";

export type CameraState = { position: Vec3; direction: Vec3; up: Vec3; fov: number };
export type ViewerHandle = {
  fit(ids?: number[]): void;
  capture(ids: number[], at?: Vec3): Promise<{ png: Uint8Array; camera: CameraState }>;
  topView(): void;
};
export type Envelope = { low: number; ratio: number; threshold: number };
/** Fall-protection overlay: slab-edge segments [x0,y0,x1,y1,…] and opening rectangles [x,y ×4] per level. */
export type GuardOverlay = { edges: { z: number; segs: number[] }[]; openings: { z: number; corners: number[]; kind: string }[] };
export type ViewerProps = {
  ref?: Ref<ViewerHandle>;
  model: WorkerModel | null;
  spaceUse?: Map<number, SpaceUse>;
  storey: number | null;
  highlight: { ids: number[]; at?: Vec3; key: string } | null;
  xray: boolean;
  showSpaces: boolean;
  section: boolean;
  heat: EgressField | null;
  heatLimit: number;
  envelope: Envelope | null;
  guards?: GuardOverlay | null;
  onPick?: (el: ViewerElement | null) => void;
};

const KIND_COLOR: Record<string, number> = {
  wall: 0xe8e3d8, curtainwall: 0x9cc3df, slab: 0xcac5b9, roof: 0xb5ad9e, column: 0xd4cdbf, beam: 0xd4cdbf, door: 0xb08457, window: 0x9cc3df,
  stair: 0xc8b48f, stairflight: 0xc8b48f, ramp: 0xc8b48f, railing: 0x6f7782, plate: 0x9cc3df, member: 0x8a8f96, covering: 0xd8d3c7,
  furniture: 0xcdb999, proxy: 0xa9b4ae, site: 0x9fae8f, other: 0xbdbdbd, space: 0x7aa7d8,
};
const SPACE_COLOR: Partial<Record<SpaceUse, number>> = { 거실: 0x6fa8dc, 복도: 0xf2c14e, 계단실: 0xe07a5f, 홀: 0xf2c14e, 화장실: 0x81b29a, 주차: 0x8d99ae, 발코니: 0x9bc53d, 설비: 0xb8b8b8, 창고: 0xb8b8b8, 승강기: 0xe07a5f };
const GLASS = new Set(["window", "curtainwall", "plate"]);
const HIGHLIGHT = 0xd93025;

type Group = { kind: "solid" | "glass" | "space"; mesh: THREE.BatchedMesh; inst: Map<number, number>; ids: number[]; base: THREE.Color[] };
type Scene3 = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  root: THREE.Group; overlay: THREE.Group; hl: THREE.Group;
  groups: Group[]; edges: Map<number, THREE.LineSegments>; byId: Map<number, ViewerElement>;
  frame: number; dirty: boolean;
};

function elementColor(e: ViewerElement, spaceUse?: Map<number, SpaceUse>): number {
  if (e.kind === "space") return SPACE_COLOR[spaceUse?.get(e.id) || "거실"] ?? KIND_COLOR.space;
  if (e.role === "parking") return 0x6d8fb5;
  if (e.role === "landscape") return 0x86b46c;
  return KIND_COLOR[e.kind] ?? KIND_COLOR.other;
}

function geometryOf(e: ViewerElement): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(e.positions, 3));
  g.setIndex(new THREE.BufferAttribute(e.indices, 1));
  g.computeVertexNormals();
  return g;
}

function boxOf(els: ViewerElement[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const e of els) { b.expandByPoint(new THREE.Vector3(...e.min)); b.expandByPoint(new THREE.Vector3(...e.max)); }
  return b;
}

function heatTexture(f: EgressField, limit: number): THREE.DataTexture {
  const data = new Uint8Array(f.nx * f.ny * 4);
  const ramp = (t: number): [number, number, number] => {
    if (t <= 0.6) { const k = t / 0.6; return [46 + (240 - 46) * k, 160 + (200 - 160) * k, 90 - 40 * k]; }
    if (t <= 1) { const k = (t - 0.6) / 0.4; return [240, 200 - 110 * k, 50 - 20 * k]; }
    return [205, 40, 40];
  };
  for (let i = 0; i < f.dist.length; i++) {
    const d = f.dist[i];
    const o = i * 4;
    if (Number.isNaN(d)) { data[o + 3] = 0; continue; }
    const [r, g, b] = d < 0 ? [150, 70, 200] : ramp(d / limit);
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 200;
  }
  const tex = new THREE.DataTexture(data, f.nx, f.ny, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function label(text: string, color = "#1f5f8b"): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(255,255,255,.92)"; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill();
  g.fillStyle = color; g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(2.2, 2.2, 1);
  return s;
}

export default function Viewer3D({ ref, model, spaceUse, storey, highlight, xray, showSpaces, section, heat, heatLimit, envelope, guards, onPick }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<Scene3 | null>(null);
  const pickRef = useRef(onPick);
  const lastFocus = useRef("");
  useEffect(() => { pickRef.current = onPick; }, [onPick]);

  const render = () => { if (S.current) S.current.dirty = true; };

  // ── renderer, camera, controls (once) ──
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = false;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(30, -40, 30);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8577, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, -60, 90);
    scene.add(sun);
    const root = new THREE.Group(), overlay = new THREE.Group(), hl = new THREE.Group();
    scene.add(root, overlay, hl);
    const s: Scene3 = { renderer, scene, camera, controls, root, overlay, hl, groups: [], edges: new Map(), byId: new Map(), frame: 0, dirty: true };
    S.current = s;
    controls.addEventListener("change", () => { s.dirty = true; });
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix(); s.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const loop = () => {
      s.frame = requestAnimationFrame(loop);
      controls.update();
      if (s.dirty) { s.dirty = false; renderer.render(scene, camera); }
    };
    loop();
    // Click (not drag) → pick
    let down: [number, number] | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const targets: THREE.Object3D[] = [...s.groups.map(g => g.mesh).filter(m => m.visible), ...s.hl.children];
      const hit = ray.intersectObjects(targets, false).find(h => {
        const cut = renderer.clippingPlanes[0];
        return !cut || cut.distanceToPoint(h.point) >= 0;
      });
      if (!hit) { pickRef.current?.(null); return; }
      const g = s.groups.find(x => x.mesh === hit.object);
      const id = g && hit.batchId !== undefined ? g.ids[hit.batchId] : (hit.object.userData.id as number | undefined);
      pickRef.current?.(id !== undefined ? s.byId.get(id) || null : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(s.frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      S.current = null;
    };
  }, []);

  // ── model ──
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    disposeTree(s.root); s.root.clear(); s.groups = []; s.edges.clear(); s.byId.clear();
    if (!model) { render(); return; }
    for (const e of model.elements) s.byId.set(e.id, e);
    const solid = model.elements.filter(e => e.kind !== "space" && !GLASS.has(e.kind));
    const glass = model.elements.filter(e => GLASS.has(e.kind));
    const spaces = model.elements.filter(e => e.kind === "space");
    const make = (kind: Group["kind"], els: ViewerElement[], material: THREE.Material): Group | null => {
      if (!els.length) return null;
      let v = 0, i = 0;
      for (const e of els) { v += e.positions.length / 3; i += e.indices.length; }
      const mesh = new THREE.BatchedMesh(els.length, v, i, material);
      mesh.perObjectFrustumCulled = true;
      const inst = new Map<number, number>(), ids: number[] = [], base: THREE.Color[] = [];
      for (const e of els) {
        const geo = geometryOf(e);
        const gid = mesh.addGeometry(geo);
        const iid = mesh.addInstance(gid);
        const c = new THREE.Color(elementColor(e, spaceUse));
        mesh.setColorAt(iid, c);
        inst.set(e.id, iid); ids[iid] = e.id; base[iid] = c;
        geo.dispose();
      }
      s.root.add(mesh);
      return { kind, mesh, inst, ids, base };
    };
    const opaque = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const glassM = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    const spaceM = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    for (const g of [make("solid", solid, opaque), make("glass", glass, glassM), make("space", spaces, spaceM)]) if (g) s.groups.push(g);
    for (const g of s.groups) if (g.kind === "space") g.mesh.renderOrder = 2;
    // Outline edges per storey (skipped for very large models).
    const tris = model.elements.reduce((a, e) => a + e.indices.length / 3, 0);
    if (tris < 400_000) {
      const per = new Map<number, number[]>();
      for (const e of solid) {
        const eg = new THREE.EdgesGeometry(geometryOf(e), 30);
        const arr = eg.getAttribute("position").array as Float32Array;
        const key = e.storey ?? -1;
        const list = per.get(key) || [];
        for (let k = 0; k < arr.length; k++) list.push(arr[k]);
        per.set(key, list);
        eg.dispose();
      }
      const lineM = new THREE.LineBasicMaterial({ color: 0x3d4146, transparent: true, opacity: 0.35 });
      for (const [key, list] of per) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(list, 3));
        const ls = new THREE.LineSegments(g, lineM);
        s.root.add(ls);
        s.edges.set(key, ls);
      }
    }
    // Site boundary + north arrow.
    if (model.boundary?.length) {
      const z = model.groundZ + 0.03;
      const pts = model.boundary.map(([x, y]) => new THREE.Vector3(x, y, z));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xc0392b, dashSize: 0.8, gapSize: 0.4 }));
      line.computeLineDistances();
      s.root.add(line);
    }
    const bb = boxOf(model.elements.filter(e => e.kind !== "space"));
    const n = new THREE.Vector3(model.north[0], model.north[1], 0).normalize();
    const anchor = new THREE.Vector3(bb.max.x + 3, bb.max.y + 3, model.groundZ + 0.05);
    s.root.add(new THREE.ArrowHelper(n, anchor, 4, 0xc0392b, 1.2, 0.8));
    const nl = label("N", "#c0392b");
    nl.position.copy(anchor.clone().add(n.clone().multiplyScalar(5.4)));
    s.root.add(nl);
    fitBox(s, bb);
    render();
  }, [model, spaceUse]);

  // ── visibility, x-ray, highlight ──
  useEffect(() => {
    const s = S.current;
    if (!s || !model) return;
    const ids = new Set(highlight?.ids || []);
    const ghost = xray || ids.size > 0;
    disposeTree(s.hl); s.hl.clear();
    const visibleEl = (e: ViewerElement | undefined) => !!e && (storey === null || e.storey === storey);
    for (const g of s.groups) {
      const m = g.mesh.material as THREE.MeshLambertMaterial;
      if (g.kind !== "space") {
        const isGlass = g.kind === "glass";
        m.transparent = ghost || isGlass; m.opacity = ghost ? 0.12 : isGlass ? 0.45 : 1; m.depthWrite = !ghost && !isGlass; m.needsUpdate = true;
      }
      g.mesh.visible = g.kind !== "space" || showSpaces;
      for (let iid = 0; iid < g.ids.length; iid++) {
        const id = g.ids[iid];
        if (id === undefined) continue;
        const e = s.byId.get(id);
        g.mesh.setVisibleAt(iid, visibleEl(e) && !ids.has(id));
        g.mesh.setColorAt(iid, g.base[iid]);
      }
    }
    for (const [key, ls] of s.edges) { ls.visible = storey === null || key === storey; (ls.material as THREE.LineBasicMaterial).opacity = ghost ? 0.08 : 0.35; }
    // Highlighted elements: solid red on top of the ghosted model.
    const red = new THREE.MeshLambertMaterial({ color: HIGHLIGHT, emissive: 0x5a0000, side: THREE.DoubleSide });
    const redSpace = new THREE.MeshLambertMaterial({ color: HIGHLIGHT, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
    for (const id of ids) {
      const e = s.byId.get(id);
      if (!e) continue;
      const mesh = new THREE.Mesh(geometryOf(e), e.kind === "space" ? redSpace : red);
      mesh.userData.id = id;
      s.hl.add(mesh);
    }
    if (highlight?.at) {
      const p = new THREE.Vector3(...highlight.at);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), new THREE.MeshBasicMaterial({ color: HIGHLIGHT, depthTest: false }));
      pin.position.copy(p); pin.renderOrder = 10;
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, p.clone().add(new THREE.Vector3(0, 0, 2.5))]), new THREE.LineBasicMaterial({ color: HIGHLIGHT, depthTest: false }));
      stem.renderOrder = 10;
      s.hl.add(pin, stem);
    }
    if (highlight && highlight.key !== lastFocus.current) {
      lastFocus.current = highlight.key;
      const els = [...ids].map(id => s.byId.get(id)).filter((x): x is ViewerElement => !!x);
      const b = els.length ? boxOf(els) : new THREE.Box3();
      if (highlight.at) b.expandByPoint(new THREE.Vector3(...highlight.at));
      if (heat && storey === heat.storeyId) {
        // Walking-distance issues: frame the whole floor so the route is visible.
        const fl = model.elements.filter(e => e.storey === storey && e.kind !== "space");
        if (fl.length) b.union(boxOf(fl));
      }
      if (!b.isEmpty()) fitBox(s, b, heat ? 1.05 : 1.6, true, 6);
    }
    if (!highlight) lastFocus.current = "";
    render();
  }, [model, storey, highlight, xray, showSpaces, heat]);

  // ── plan section ──
  useEffect(() => {
    const s = S.current;
    if (!s || !model) return;
    const st = model.storeys.find(x => x.id === storey);
    s.renderer.clippingPlanes = section && st ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), st.elevation + 1.2)] : [];
    render();
  }, [model, storey, section]);

  // ── overlays: heat-map, envelope ──
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    disposeTree(s.overlay); s.overlay.clear();
    if (model && heat) {
      const w = heat.nx * heat.cell, h = heat.ny * heat.cell;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: heatTexture(heat, heatLimit), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      plane.position.set(heat.origin[0] + w / 2, heat.origin[1] + h / 2, heat.elevation + 0.06);
      plane.renderOrder = 5;
      s.overlay.add(plane);
      // Walking route from the issue point to the stair: steepest descent on the distance field.
      const route = highlight?.at ? tracePath(heat, highlight.at) : null;
      if (route && route.length > 1) {
        const geo = new LineGeometry();
        geo.setPositions(route.flatMap(([x, y]) => [x, y, heat.elevation + 0.15]));
        const mat = new LineMaterial({ color: 0x1b1f24, linewidth: 4, worldUnits: false, depthTest: false });
        const el = host.current!;
        mat.resolution.set(el.clientWidth, el.clientHeight);
        const line = new Line2(geo, mat);
        line.renderOrder = 11;
        const end = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2e7d4f, depthTest: false }));
        const last = route[route.length - 1];
        end.position.set(last[0], last[1], heat.elevation + 0.15);
        end.renderOrder = 11;
        s.overlay.add(line, end);
      }
    }
    if (model && envelope && model.boundary?.length) s.overlay.add(envelopeMesh(model.boundary, model.north, model.groundZ, Math.max(model.height + 4, envelope.threshold + 4), envelope));
    if (model && guards) s.overlay.add(guardMesh(guards, host.current!));
    render();
  }, [model, heat, heatLimit, envelope, highlight, guards]);

  useImperativeHandle(ref, () => ({
    fit(ids?: number[]) {
      const s = S.current;
      if (!s || !model) return;
      const els = ids?.length ? ids.map(id => s.byId.get(id)).filter((x): x is ViewerElement => !!x) : model.elements.filter(e => e.kind !== "space");
      fitBox(s, boxOf(els), ids?.length ? 1.6 : 1.15);
      render();
    },
    topView() {
      const s = S.current;
      if (!s || !model) return;
      const els = model.elements.filter(e => e.kind !== "space" && (storey === null || e.storey === storey));
      const b = boxOf(els.length ? els : model.elements);
      const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.y) * 0.75 / Math.tan((s.camera.fov * Math.PI) / 360);
      s.controls.target.copy(c);
      s.camera.position.set(c.x, c.y - r * 0.001, c.z + r + size.z);
      s.camera.updateProjectionMatrix();
      render();
    },
    async capture(ids: number[], at?: Vec3) {
      const s = S.current!;
      const els = ids.map(id => s.byId.get(id)).filter((x): x is ViewerElement => !!x);
      const b = els.length ? boxOf(els) : new THREE.Box3();
      if (at) b.expandByPoint(new THREE.Vector3(...at));
      if (!b.isEmpty()) fitBox(s, b, 1.6, true, 6);
      s.controls.update();
      s.renderer.render(s.scene, s.camera);
      const blob: Blob = await new Promise(res => s.renderer.domElement.toBlob(b2 => res(b2!), "image/png"));
      const dir = new THREE.Vector3(); s.camera.getWorldDirection(dir);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.camera.quaternion);
      return { png: new Uint8Array(await blob.arrayBuffer()), camera: { position: s.camera.position.toArray() as Vec3, direction: dir.toArray() as Vec3, up: up.toArray() as Vec3, fov: s.camera.fov } };
    },
  }), [model, storey]);

  return <div ref={host} className="bim-canvas" />;
}

function tracePath(f: EgressField, at: Vec3): [number, number][] | null {
  const idx = (i: number, j: number) => (i < 0 || j < 0 || i >= f.nx || j >= f.ny ? -1 : j * f.nx + i);
  const ok = (k: number) => k >= 0 && f.dist[k] >= 0 && Number.isFinite(f.dist[k]);
  let i = Math.floor((at[0] - f.origin[0]) / f.cell), j = Math.floor((at[1] - f.origin[1]) / f.cell);
  if (!ok(idx(i, j))) {
    let best = -1;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const k = idx(i + di, j + dj); if (ok(k) && (best < 0 || f.dist[k] > f.dist[best])) best = k; }
    if (best < 0) return null;
    i = best % f.nx; j = (best - i) / f.nx;
  }
  const moves = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2]];
  const pts: [number, number][] = [];
  for (let step = 0; step < 4000; step++) {
    pts.push([f.origin[0] + (i + 0.5) * f.cell, f.origin[1] + (j + 0.5) * f.cell]);
    const d = f.dist[idx(i, j)];
    if (d <= 1e-6) break;
    let bi = -1, bj = -1, bd = d;
    for (const [di, dj] of moves) { const k = idx(i + di, j + dj); if (ok(k) && f.dist[k] < bd - 1e-6) { bd = f.dist[k]; bi = i + di; bj = j + dj; } }
    if (bi < 0) break;
    i = bi; j = bj;
  }
  // String-pull: keep only the points needed for straight, unobstructed segments.
  const clear = (a: [number, number], b: [number, number]) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (f.cell / 3));
    for (let k = 1; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
      if (!ok(idx(Math.floor((x - f.origin[0]) / f.cell), Math.floor((y - f.origin[1]) / f.cell)))) return false;
    }
    return true;
  };
  const out: [number, number][] = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !clear(pts[a], pts[b])) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

function fitBox(s: Scene3, box: THREE.Box3, pad = 1.15, instant = true, minR = 1.5) {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, minR) * pad;
  const dist = r / Math.sin((s.camera.fov * Math.PI) / 360);
  const dir = new THREE.Vector3(0.62, -0.9, 0.75).normalize();
  s.controls.target.copy(c);
  s.camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
  s.camera.near = Math.max(0.05, dist / 500); s.camera.far = dist * 50;
  s.camera.updateProjectionMatrix();
  if (instant) s.controls.update();
  s.dirty = true;
}

/** 정북 일조 사선: from each north-facing boundary edge, the allowed building envelope
 *  measured southward along true north (height 0 until `low`, 10 m until 10·ratio, then d / ratio). */
function envelopeMesh(boundary: Vec2[], north: Vec2, groundZ: number, top: number, env: Envelope): THREE.Group {
  const g = new THREE.Group();
  const area = boundary.reduce((a, p, i) => { const q = boundary[(i + 1) % boundary.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const ccw = area > 0;
  const prof: [number, number][] = [[env.low, 0], [env.low, env.threshold], [env.threshold * env.ratio, env.threshold], [top * env.ratio, top]];
  const mat = new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const lineM = new THREE.LineBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.7 });
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (L < 0.5) continue;
    const out = ccw ? [ey / L, -ex / L] : [-ey / L, ex / L];
    if (out[0] * north[0] + out[1] * north[1] < 0.25) continue;
    const pos: number[] = [];
    const at = (p: Vec2, d: number, z: number) => [p[0] - north[0] * d, p[1] - north[1] * d, groundZ + z];
    for (let k = 0; k < prof.length - 1; k++) {
      const [d0, z0] = prof[k], [d1, z1] = prof[k + 1];
      const p00 = at(a, d0, z0), p01 = at(b, d0, z0), p10 = at(a, d1, z1), p11 = at(b, d1, z1);
      pos.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 6;
    g.add(mesh);
    for (const p of [a, b]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(prof.map(([d, z]) => new THREE.Vector3(...at(p, d, z)))), lineM));
  }
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse(x => {
    if (x instanceof THREE.BatchedMesh) { x.dispose(); return; }
    const m = x as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const map = (mm as THREE.MeshBasicMaterial).map;
      if (map) map.dispose();
      mm.dispose();
    }
  });
}

// 안전난간 at the slab edge (중간대 0.45 m, 상부 0.9 m — 산업안전보건기준에 관한 규칙 제13조) and
// opening covers, drawn as screen-space lines so they stay readable at any zoom.
function guardMesh(g: GuardOverlay, el: HTMLElement) {
  const group = new THREE.Group();
  const res = new THREE.Vector2(el.clientWidth || 1, el.clientHeight || 1);
  const rail: number[] = [];
  for (const lv of g.edges) for (let k = 0; k + 3 < lv.segs.length; k += 4) {
    const [x0, y0, x1, y1] = lv.segs.slice(k, k + 4);
    for (const h of [0.45, 0.9]) rail.push(x0, y0, lv.z + h, x1, y1, lv.z + h);
  }
  if (rail.length) {
    const geo = new LineSegmentsGeometry(); geo.setPositions(rail);
    const mat = new LineMaterial({ color: 0xf28c28, linewidth: 2.5, worldUnits: false, transparent: true, opacity: 0.95 });
    mat.resolution.copy(res);
    const line = new LineSegments2(geo, mat); line.renderOrder = 9; group.add(line);
  }
  const outline: number[] = [];
  for (const o of g.openings) {
    const c = o.corners, z = o.z + 0.05;
    for (let k = 0; k < 4; k++) { const a = k * 2, b = ((k + 1) % 4) * 2; outline.push(c[a], c[a + 1], z, c[b], c[b + 1], z); }
    const shape = new THREE.Shape([0, 1, 2, 3].map(k => new THREE.Vector2(c[k * 2], c[k * 2 + 1])));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: o.kind === "승강로" ? 0xd93025 : 0xf28c28, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    fill.position.z = z; fill.renderOrder = 8; group.add(fill);
  }
  if (outline.length) {
    const geo = new LineSegmentsGeometry(); geo.setPositions(outline);
    const mat = new LineMaterial({ color: 0xd93025, linewidth: 3, worldUnits: false });
    mat.resolution.copy(res);
    const line = new LineSegments2(geo, mat); line.renderOrder = 10; group.add(line);
  }
  return group;
}
