// 입지·용도 검토: zone classification, use-list parsing/matching, zoning rules, plan
// extraction verification and the V-World client (fetch mocked with the documented shapes).
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { applicableRegions, listRegions, loadNational } from "../lib/corpus.ts";
import { verifyPlan } from "../lib/land/plan-extract.ts";
import { landRules, ruleAreas, ruleDistrictPlan, ruleDistricts, ruleEducation, ruleSite, ruleZoneUse, useMatrix } from "../lib/land/rules.ts";
import { siteToValues } from "../lib/land/site.ts";
import type { SiteInfo } from "../lib/land/types.ts";
import { matchItem, matchRef, parseNumberedUseList, parseRefs, parseUseTable, USE_CATEGORIES, useOf } from "../lib/land/uses.ts";
import { lookupParcel } from "../lib/land/vworld.ts";
import { classifyZone, heightFromName, mainUseZone, makeZone, relationOf, roadWidthFromName, zoneAppendices } from "../lib/land/zones.ts";
import type { ProjectValues } from "../lib/review/types.ts";

process.env.LAW_API_OC = ""; // no live 별표 fetches in tests

const allowText = fs.readFileSync("tests/land/appendix-allow.fixture.txt", "utf8");
const denyText = fs.readFileSync("tests/land/appendix-deny.fixture.txt", "utf8");
const seoul = listRegions().find(r => r.label === "서울특별시 마포구") || listRegions().find(r => r.key.startsWith("서울특별시"))!;
const v = (o: Record<string, string | number | boolean>): ProjectValues => Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value, source: "user", confidence: "HIGH" }])) as ProjectValues;
const site = (names: string[], extra: Partial<SiteInfo> = {}): SiteInfo => ({ source: "manual", zones: names.map(n => makeZone(n, "manual")), notes: [], ...extra });

/** Simulate a corpus built with LAW_API_OC (appendix bodies indexed). */
function withAppendixBody<T>(id: string, text: string, fn: () => Promise<T>): Promise<T> {
  const c = loadNational().byId.get(id)!;
  const before = c.text;
  c.text = text;
  return fn().finally(() => { c.text = before; });
}

test("zone names: classification, road widths, heights, 용도지역 → 별표 from 시행령 제71조", () => {
  assert.equal(classifyZone("제2종일반주거지역"), "용도지역");
  assert.equal(classifyZone("자연경관지구"), "용도지구");
  assert.equal(classifyZone("개발제한구역"), "용도구역");
  assert.equal(classifyZone("지구단위계획구역"), "지구단위계획");
  assert.equal(classifyZone("중로2류(폭 15m~20m)"), "도시계획시설");
  assert.equal(classifyZone("가축사육제한구역"), "기타");
  assert.deepEqual(roadWidthFromName("소로1류(폭 10m~12m)"), [10, 12]);
  assert.equal(heightFromName("고도지구(20m이하)"), 20);
  assert.equal(heightFromName("대공방어협조구역(위탁고도:77-257m)"), undefined);
  assert.equal(mainUseZone([makeZone("도시지역", "manual"), makeZone("제3종일반주거지역", "vworld", { relation: "저촉" }), makeZone("제2종일반주거지역", "vworld", { relation: "포함" })]), "제2종일반주거지역");
  const map = zoneAppendices(loadNational().byId.get("국토의계획및이용에관한법률시행령#71")!.text);
  assert.equal(map.length, 21);
  assert.deepEqual(map.find(x => x.zone === "준주거지역"), { ...map.find(x => x.zone === "준주거지역")!, appendix: "별표7", mode: "deny" });
  assert.equal(map.find(x => x.zone === "자연녹지지역")?.appendix, "별표17");
});

test("별표 1 category names agree with the ordinance corpus", () => {
  const seen = new Map<string, Set<string>>();
  for (const r of listRegions().slice(0, 60)) for (const L of applicableRegions(r)) for (const c of L.chunks) {
    for (const m of c.text.matchAll(/별표\s*1\s*제(\d+)호(?:의(\d+))?의\s*([가-힣ㆍ·\s]{2,18}?)(?=\s*(?:중|\(|로서|으로서|,|$|\n|에\s))/g)) {
      const no = m[1] + (m[2] ? `의${m[2]}` : "");
      (seen.get(no) || seen.set(no, new Set()).get(no)!).add(m[3].replace(/[\sㆍ·]/g, ""));
    }
  }
  let checked = 0;
  for (const c of USE_CATEGORIES) {
    const names = [...(seen.get(c.no) || [])].filter(n => !/목$|^[가-하]목|업소$|건축물$|^같은/.test(n));
    if (!names.length) continue;
    checked++;
    const want = c.name.replace(/[\sㆍ·]/g, "");
    assert.ok(names.some(n => n.length >= 2 && (want.includes(n) || n.includes(want))), `제${c.no}호 ${c.name} vs ${names.join("/")}`);
  }
  assert.ok(checked >= 15, `checked ${checked}`);
});

test("use lists: 별표 format (allow / deny, flattened text), ordinance lists, matching", () => {
  const A = parseUseTable(allowText, "allow");
  assert.equal(A.items.filter(i => i.part === 1).length, 6);
  assert.equal(A.items.filter(i => i.part === 2).length, 9);
  const D = parseUseTable(denyText, "deny");
  assert.deepEqual(D.items.map(i => `${i.part}${i.label}`), ["1가", "1나", "1다", "1라", "1마", "2가", "2나"]);
  const verdict = (use: string, area?: number) => {
    const u = useOf(use, { area });
    const hits = A.items.map(it => ({ it, m: matchItem(u, it) })).filter(x => x.m.match !== "none");
    return hits.map(h => `${h.it.part}:${h.m.match}`).join(",") || "none";
  };
  assert.equal(verdict("공동주택(아파트)"), "1:full");
  assert.equal(verdict("제2종 근린생활시설(사무소)"), "2:full");
  assert.equal(verdict("제2종 근린생활시설(단란주점)"), "none");
  assert.equal(verdict("판매시설(상점)", 1500), "2:partial");
  assert.equal(verdict("판매시설(상점)", 2500), "none");
  assert.equal(verdict("교육연구시설(학원)"), "2:full");
  assert.equal(verdict("공장"), "none");
  const u = useOf("숙박시설(생활숙박시설)");
  assert.equal(matchItem(u, D.items[2]).match, "partial"); // 생활숙박시설은 조건부 제외
  assert.equal(matchItem(useOf("숙박시설(일반숙박시설)"), D.items[2]).match, "full");
  const art = applicableRegions(listRegions().find(r => r.key.startsWith("서울특별시") && /본청/.test(r.key))!)[0].chunks.find(c => c.heading === "자연경관지구 안에서의 건축제한")!;
  const L = parseNumberedUseList(art.text);
  assert.ok(L.length >= 15);
  assert.ok(L.some(it => matchItem(useOf("공장"), it).match === "full"));
  assert.ok(!L.some(it => matchItem(useOf("제2종 근린생활시설(사무소)"), it).match !== "none"));
  // Narrowing phrases: "(…에 한정한다)", "…를 초과하는 것", "다만, …" — structure only, no statute text.
  const [ltd] = parseRefs("제21호의 동물 및 식물 관련 시설(축사ㆍ도축장에 한정한다)");
  assert.equal(ltd.only, "축사ㆍ도축장");
  assert.equal(matchRef(useOf("동물 및 식물 관련 시설"), ltd).match, "partial");
  assert.equal(matchRef(useOf("동물 및 식물 관련 시설(작물 재배사)"), ltd).match, "none");
  assert.equal(matchRef(useOf("동물 및 식물 관련 시설(도축장)"), ltd).match, "full");
  const [big] = parseRefs("제18호의 창고시설로서 해당 용도에 쓰이는 바닥면적의 합계가 500제곱미터를 초과하는 것");
  assert.deepEqual(big.areaMin, { value: 500, strict: true });
  assert.equal(matchRef(useOf("창고시설", { area: 300 }), big).match, "none");
  assert.equal(matchRef(useOf("창고시설", { area: 800 }), big).match, "full");
  assert.equal(matchRef(useOf("창고시설"), big).match, "partial");
  // A pointer to another 별표 of the same decree is not 「건축법 시행령」 별표 1 제2호(공동주택).
  const xr = parseRefs("별표 4 제2호차목 및 카목의 공장");
  assert.equal(xr.length, 1);
  assert.equal(xr[0].no, "17");
  assert.equal(xr[0].crossRef, "별표 4 제2호차목 및 카목");
  assert.equal(matchRef(useOf("공장(인쇄업)"), xr[0]).match, "partial");
  assert.equal(parseRefs("「건축법 시행령」 별표 1 제17호의 공장")[0].crossRef, undefined);
  const [rg] = parseRefs("「건축법 시행령」 별표 1 제21호가목부터 라목까지의 규정에 따른 시설");
  assert.equal(rg.no, "21");
  assert.equal(matchRef(useOf("동물 및 식물 관련 시설"), rg).match, "partial");
  const [pv] = parseRefs("제15호의 숙박시설. 다만, 위원회 심의를 거친 것은 그러하지 아니하다.");
  assert.equal(pv.proviso, true);
  assert.equal(matchRef(useOf("숙박시설(일반숙박시설)"), pv).match, "partial");
});

test("Z-USE: verdicts from the 별표 text, and an honest UNCLEAR without it", async () => {
  const none = await ruleZoneUse({ values: v({ 용도지역: "제2종일반주거지역", 주용도: "공장" }), region: null, live: false });
  assert.equal(none.status, "UNCLEAR");
  assert.match(none.notes.join(" "), /LAW_API_OC/);
  await withAppendixBody("국토의계획및이용에관한법률시행령#별표5", allowText, async () => {
    const run = (use: string, extra: Record<string, number> = {}) => ruleZoneUse({ values: v({ 용도지역: "제2종일반주거지역", 주용도: use, ...extra }), region: seoul, live: false });
    assert.equal((await run("공동주택(아파트)")).status, "PASS");
    const r2 = await run("제2종 근린생활시설(사무소)");
    assert.equal(r2.status, "UNCLEAR");
    assert.equal(r2.tier, 2);
    const f = await run("공장");
    assert.equal(f.status, "FAIL");
    assert.ok(f.citations.length >= 1);
    const m = await useMatrix("제2종일반주거지역", { live: false });
    const row = (no: string) => m.rows.find(r => r.no === no)!.verdict;
    assert.equal(row("1"), "허용");
    assert.equal(row("4"), "조례");
    assert.equal(row("17"), "불허");
    assert.equal(row("7"), "조례");
    assert.equal(row("10"), "조건");
  });
  await withAppendixBody("국토의계획및이용에관한법률시행령#별표7", denyText, async () => {
    const r = await ruleZoneUse({ values: v({ 용도지역: "준주거지역", 주용도: "위락시설" }), region: null, live: false });
    assert.equal(r.status, "FAIL");
    assert.equal((await ruleZoneUse({ values: v({ 용도지역: "준주거지역", 주용도: "업무시설(오피스텔)" }), region: null, live: false })).status, "PASS");
  });
});

test("Z-DISTRICT / Z-AREA / Z-EDU / Z-SITE", () => {
  const seoulMain = listRegions().find(r => r.key.startsWith("서울특별시") && /본청/.test(r.key)) || seoul;
  const d = ruleDistricts({ site: site(["자연경관지구", "방화지구", "고도지구(20m이하)"]), values: v({ 주용도: "공장", 지상층수: 5, 높이: 25 }), region: seoulMain, fireResistive: false });
  assert.equal(d.status, "FAIL");
  const titles = d.issues.map(i => i.title).join(" | ");
  assert.match(titles, /자연경관지구: 건축할 수 없는 용도/);
  assert.match(titles, /자연경관지구: 층수 초과/);
  assert.match(titles, /방화지구/);
  assert.match(titles, /고도지구.*최고높이 초과/);
  assert.equal(ruleDistricts({ site: site([]), values: v({}), region: null }).status, "NOT_APPLICABLE");
  assert.equal(ruleAreas({ site: site(["개발제한구역"]), values: v({}), region: null }).status, "FAIL");
  assert.equal(ruleAreas({ site: site(["도시혁신구역"]), values: v({}), region: null }).status, "UNCLEAR");
  assert.equal(ruleEducation({ site: site(["상대보호구역"]), values: v({ 주용도: "숙박시설" }), region: null }).status, "UNCLEAR");
  assert.equal(ruleEducation({ site: site(["절대보호구역"]), values: v({ 주용도: "위락시설(유흥주점)" }), region: null }).status, "FAIL");
  assert.equal(ruleEducation({ site: site(["상대보호구역"]), values: v({ 주용도: "공동주택" }), region: null }).status, "PASS");
  assert.equal(ruleSite({ site: site([], { roadSide: "맹지" }), values: v({}), region: null }).status, "FAIL");
  const s2 = site(["제2종일반주거지역", "제3종일반주거지역", "소로2류(폭 8m~10m)"]);
  s2.zones[2].relation = "저촉";
  const r = ruleSite({ site: s2, values: v({}), region: null });
  assert.equal(r.status, "UNCLEAR");
  assert.equal(r.issues.length, 2);
});

test("Z-PLAN: 지구단위계획 uses and density, and site → values", () => {
  const s = site(["제2종일반주거지역", "지구단위계획구역", "중로1류(폭 20m~25m)"], { area: 1000, address: "서울특별시 마포구 상암동 1", plan: { source: "manual", bcr: 50, far: { base: 180, allowed: 200, max: 230 }, height: { maxFloors: 4 }, uses: { prohibited: ["숙박시설", "제2종 근린생활시설 중 단란주점"] } } });
  s.zones[2].relation = "접합";
  const ok = ruleDistrictPlan({ site: s, values: v({ 주용도: "공동주택(아파트)", 대지면적: 1000, 건축면적: 450, 용적률산정용연면적: 1900, 지상층수: 4 }), region: null });
  assert.equal(ok.status, "PASS");
  const bad = ruleDistrictPlan({ site: s, values: v({ 주용도: "숙박시설(일반숙박시설)", 대지면적: 1000, 건축면적: 550, 용적률산정용연면적: 2100, 지상층수: 5 }), region: null });
  assert.equal(bad.status, "FAIL");
  assert.equal(bad.issues.filter(i => i.status === "FAIL").length, 4);
  const empty = ruleDistrictPlan({ site: site(["지구단위계획구역"]), values: v({}), region: null });
  assert.equal(empty.status, "UNCLEAR");
  const vals = siteToValues(s);
  assert.equal(vals.용도지역?.value, "제2종일반주거지역");
  assert.equal(vals.전면도로폭?.value, 20);
  assert.equal(vals.지구단위계획?.value, true);
  assert.equal(vals.대지면적?.value, 1000);
});

test("plan extraction keeps only values quoted from the source", () => {
  const text = "가구번호 D3 획지 2. 건폐율 60% 이하, 용적률: 기준 200%, 허용 230%, 상한 250%. 최고높이 30m 이하. 불허용도: 숙박시설, 위락시설";
  const r = verifyPlan({ bcr: 60, far_base: 200, far_allowed: 230, far_max: 300, height_max_m: 30, uses: { prohibited: ["숙박시설", "위락시설", "공장"] },
    evidence: { bcr: "건폐율 60% 이하", far_base: "용적률: 기준 200%", far_allowed: "허용 230%", far_max: "상한 300%", height_max_m: "최고높이 30m 이하" } }, text);
  assert.equal(r.plan.bcr, 60);
  assert.equal(r.plan.far?.allowed, 230);
  assert.equal(r.plan.far?.max, undefined); // quote not in the text
  assert.deepEqual(r.plan.uses?.prohibited, ["숙박시설", "위락시설"]);
  assert.ok(r.dropped.includes("far_max") && r.dropped.some(x => x.includes("공장")));
});

test("V-World client: parcel + 토지이용계획 + 토지대장 (mocked responses)", async () => {
  const real = globalThis.fetch;
  process.env.VWORLD_API_KEY = "test-key";
  process.env.VWORLD_DOMAIN = "https://example.app";
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes("LP_PA_CBND_BUBUN")) return json({ response: { status: "OK", record: { total: 1, current: 1 }, page: { total: 1, current: 1 }, result: { featureCollection: { features: [{ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[[[126.89, 37.57], [126.891, 37.57], [126.891, 37.571], [126.89, 37.571], [126.89, 37.57]]]] }, properties: { pnu: "1144012700116010000", addr: "서울특별시 마포구 상암동 1601", jibun: "1601 대" } }] } } } });
    if (u.includes("getLandUseAttr")) return json({ landUses: { field: [
      { prposAreaDstrcCodeNm: "도시지역", cnflcAt: "1" }, { prposAreaDstrcCodeNm: "제2종일반주거지역", cnflcAt: "1", lawNm: "국토의 계획 및 이용에 관한 법률" },
      { prposAreaDstrcCodeNm: "지구단위계획구역", cnflcAt: "1" }, { prposAreaDstrcCodeNm: "중로2류(폭 15m~20m)", cnflcAt: "3" }, { prposAreaDstrcCodeNm: "가축사육제한구역", cnflcAt: "1" },
    ], totalCount: "5" } });
    if (u.includes("ladfrlList")) return json({ ladfrlVOList: { ladfrlVOList: [{ lndcgrCodeNm: "대", lndpclAr: "1104.3", ldCodeNm: "서울특별시 마포구 상암동" }] } });
    if (u.includes("getLandCharacteristics")) return json({ landCharacteristicss: { field: [{ roadSideCodeNm: "중로한면", lndpclAr: "1104.3" }] } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  try {
    const s = await lookupParcel({ lon: 126.8905, lat: 37.5705 });
    assert.equal(s.pnu, "1144012700116010000");
    assert.equal(s.area, 1104.3);
    assert.equal(s.landCategory, "대");
    assert.equal(s.roadSide, "중로한면");
    assert.deepEqual(s.zones.map(z => z.kind), ["용도지역", "용도지역", "지구단위계획", "도시계획시설", "기타"]);
    assert.equal(s.zones[3].relation, "접합");
    assert.ok(calls.every(u => u.includes("key=test-key") && u.includes("domain=https")));
    const rules = await landRules({ site: s, values: siteToValues(s), region: seoul, live: false });
    assert.equal(rules.length, 6);
    assert.equal(rules.find(r => r.check_id === "Z-PLAN")?.status, "UNCLEAR");
    globalThis.fetch = (async () => new Response(JSON.stringify({ response: { status: "ERROR", error: { code: "INCORRECT_KEY", text: "인증키 정보가 올바르지 않습니다." } } }), { status: 200 })) as typeof fetch;
    await assert.rejects(() => lookupParcel({ lon: 126.89, lat: 37.57 }), /INCORRECT_KEY/);
  } finally {
    globalThis.fetch = real;
    process.env.VWORLD_API_KEY = "";
    process.env.VWORLD_DOMAIN = "";
  }
});

test("토지이용계획 relation: V-World '접함' and codes", () => {
  assert.equal(relationOf("접함"), "접합");
  assert.equal(relationOf("", "3"), "접합");
  assert.equal(relationOf("포함", "1"), "포함");
  assert.equal(relationOf("저촉"), "저촉");
  assert.equal(relationOf("", ""), undefined);
});
