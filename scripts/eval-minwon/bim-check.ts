// Local run of the /bim review on one IFC file (demo verification).
import fs from "node:fs";
import * as WebIFC from "web-ifc";
import { analyze } from "./lib/bim/analyze.ts";
import { readIfc } from "./lib/bim/ifc-read.ts";
import { reviewBim } from "./lib/bim/rules.ts";

const file = process.argv[2];
const api = new WebIFC.IfcAPI();
await api.Init();
const model = readIfc(api, new Uint8Array(fs.readFileSync(file)));
const { facts } = analyze(model, { file });
const f = facts as any;
console.log("north", f.site.north, f.site.northSource, "siteArea", f.site.area, f.site.areaSource, "boundary pts", f.site.boundary?.length);
console.log("kr", JSON.stringify(f.kr ?? f.project ?? {}));
console.log("storeys", f.storeys.map((s: any) => `${s.name}:${s.floorArea}㎡ units${s.units} stairs${s.stairCount}${s.evacuation ? " 피난층" : ""}`).join(" | "));
console.log("railings", f.railings.map((r: any) => `${r.ref.storey}/${r.where}/${r.height}`).join(" "));
console.log("parking", f.parking.map((p: any) => `${p.width}x${p.length}`).join(" "), "landscape", f.landscapeArea ?? f.building?.landscapeArea);
console.log("quality", JSON.stringify(f.quality ?? []));
const r = await reviewBim({ facts });
console.log("region", JSON.stringify(r.region));
for (const x of r.rules as any[]) {
  console.log(`[${x.status}] ${x.check_id} ${x.title} — ${x.requirement || ""}`.slice(0, 200));
  for (const i of (x.issues || []).slice(0, 4)) console.log(`     · ${i.status} ${i.title} ${i.measured ? `(${i.measured} / ${i.required})` : ""}`);
  if (x.status !== "PASS" && x.notes) console.log("       notes:", String(x.notes.join(" / ")).slice(0, 220), x.provided !== undefined ? `provided=${x.provided}` : "");
}
console.log("summary", JSON.stringify(r.summary ?? {}));
console.log("values", Object.entries(r.values).map(([k, v]: any) => `${k}=${v.value}`).join(", "));
for (const e of (f.egress || [])) console.log("egress", JSON.stringify(e).slice(0, 300));
console.log("spaces", f.spaces.map((s: any) => `${s.storey ?? s.storeyId}:${s.ref.name}/${s.name ?? s.longName ?? ""}/${s.use}/${s.area}`).join(" ").slice(0, 3000));
console.log("doors", f.doors.map((d: any) => `${d.ref.storey}:${d.ref.name.slice(0, 30)} w${d.width}${d.main ? " MAIN" : ""}`).join(" | ").slice(0, 3000));
