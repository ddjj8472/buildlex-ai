// The two Revit demos on /bim (public/bim/demo-*.ifc) are exported from real Revit 2025 models with
// furniture, floor finishes, RPC people·cars·trees, walls joined to cut the floor slabs and a core
// wall modelled once over every floor. Their verdicts must not drift with that presentation detail:
// 위반안 fails exactly 정북 일조·채광창·옥상 난간, 수정안 fails nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import { before, test } from "node:test";
import * as WebIFC from "web-ifc";
import { analyze, isEntourage } from "../lib/bim/analyze.ts";
import { readIfc } from "../lib/bim/ifc-read.ts";
import { reviewBim } from "../lib/bim/rules.ts";
import type { BimFacts, ParsedModel } from "../lib/bim/types.ts";

const api = new WebIFC.IfcAPI();
const facts: Record<string, BimFacts> = {};
const models: Record<string, ParsedModel> = {};
const DEMOS = { "demo-1-violations": ["B-DAYLIGHT-WINDOW", "B-GUARD", "B-NORTH"], "demo-2-fixed": [] as string[] };

before(async () => {
  await api.Init();
  for (const name of Object.keys(DEMOS)) {
    models[name] = readIfc(api, new Uint8Array(fs.readFileSync(`public/bim/${name}.ifc`)));
    facts[name] = analyze(models[name], { file: `${name}.ifc` }).facts;
  }
});

for (const [name, expected] of Object.entries(DEMOS)) {
  test(`${name}: verdicts`, async () => {
    const r = await reviewBim({ facts: facts[name] });
    assert.deepEqual(r.rules.filter(x => x.status === "FAIL").map(x => x.check_id).sort(), expected);
  });

  test(`${name}: presentation detail does not change the measurements`, () => {
    const f = facts[name];
    // RPC people, cars and trees stand by the north boundary but are not building.
    assert.ok(models[name].elements.some(isEntourage), "demo has entourage");
    assert.ok(Math.abs(f.north.minLow!.d - 5.84) < 0.02, `정북 이격 ${f.north.minLow!.d}`);
    // Every 거실 reaches the stair through its unit door although the slab stops at the door wall.
    for (const e of f.egress) for (const s of e.spaces) {
      assert.equal(s.unreachable, 0, `${e.storey} ${s.ref.name}`);
      assert.ok(s.maxDistance! > 5 && s.maxDistance! < 15, `${e.storey} ${s.ref.name} ${s.maxDistance}`);
    }
    // Stair and lift shafts stay openings in the slab although the core walls cut the slabs.
    const upper = f.construction!.levels.filter(l => l.storey !== "1층");
    assert.equal(upper.length, 5);
    for (const l of upper) assert.deepEqual(l.openings.map(o => o.kind).sort(), ["계단", "승강로"], l.storey);
  });
}

test("수정안 has less floor area than 위반안 by the 5층 setback", () => {
  const a = facts["demo-1-violations"].building.grossFloorArea, b = facts["demo-2-fixed"].building.grossFloorArea;
  assert.ok(Math.abs(a - b - 13.4) < 0.3, `${a} − ${b}`);
});
