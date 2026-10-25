/// <reference lib="webworker" />
// IFC parsing + measurement off the main thread. The model never leaves the browser:
// only the compact BimFacts go to the server for the legal check.
import * as WebIFC from "web-ifc";
import { analyze } from "@/lib/bim/analyze";
import { readIfc } from "@/lib/bim/ifc-read";
import type { BimFacts, EgressField, ParsedElement, ParsedStorey, Vec2, Vec3 } from "@/lib/bim/types";

export type ViewerElement = Pick<ParsedElement, "id" | "guid" | "ifcType" | "kind" | "name" | "longName" | "objectType" | "storey" | "parent" | "props" | "min" | "max"> & { positions: Float32Array; indices: Uint32Array; role?: "parking" | "landscape" };
export type WorkerModel = { elements: ViewerElement[]; storeys: ParsedStorey[]; boundary?: Vec2[]; north: Vec2; offset: Vec3; groundZ: number; height: number; project: string; application?: string };
export type WorkerOut =
  | { type: "progress"; stage: string; pct: number }
  | { type: "done"; model: WorkerModel; facts: BimFacts; fields: EgressField[]; ms: number }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let api: WebIFC.IfcAPI | null = null;

ctx.onmessage = async (e: MessageEvent<{ type: "open"; buffer: ArrayBuffer; name: string }>) => {
  if (e.data?.type !== "open") return;
  const t0 = performance.now();
  const post = (m: WorkerOut, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);
  try {
    if (!api) {
      post({ type: "progress", stage: "IFC 엔진 준비", pct: 0 });
      api = new WebIFC.IfcAPI();
      api.SetWasmPath("/vendor/web-ifc/", true);
      await api.Init(undefined, true);
      api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF);
    }
    const report = (stage: string, pct: number) => post({ type: "progress", stage, pct });
    const parsed = readIfc(api, new Uint8Array(e.data.buffer), { onProgress: (s, p) => report(s, p * 0.8) });
    const { facts, fields } = analyze(parsed, { file: e.data.name, onProgress: (s, p) => report(s, 0.8 + 0.2 * p) });
    const parking = new Set(facts.parking.map(p => p.ref.id));
    const landscape = new Set(facts.building.landscape.map(p => p.id));
    const elements: ViewerElement[] = [];
    const transfer: Transferable[] = [];
    for (const el of parsed.elements) {
      if (!el.positions || !el.indices || !el.indices.length) continue;
      elements.push({
        id: el.id, guid: el.guid, ifcType: el.ifcType, kind: el.kind, name: el.name, longName: el.longName, objectType: el.objectType,
        storey: el.storey, parent: el.parent, props: el.props, min: el.min, max: el.max, positions: el.positions, indices: el.indices,
        role: parking.has(el.id) ? "parking" : landscape.has(el.id) ? "landscape" : undefined,
      });
      transfer.push(el.positions.buffer, el.indices.buffer);
    }
    for (const f of fields) transfer.push(f.dist.buffer);
    post({
      type: "done", facts, fields, ms: performance.now() - t0,
      model: { elements, storeys: parsed.storeys, boundary: parsed.site?.boundary, north: parsed.north, offset: parsed.offset, groundZ: facts.building.groundZ, height: facts.building.height, project: parsed.project.name, application: parsed.project.application },
    }, transfer);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
