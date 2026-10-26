// 입지·용도 rules — what may be built on this land, before the building itself is checked.
//
//   Z-USE      용도지역 건축제한        국토계획법 §76①, 시행령 §71 + 별표 2~22 (+ 조례 위임분)
//   Z-DISTRICT 용도지구 건축제한        건축법 §51(방화), 시행령 §72~82 + 도시·군계획조례
//   Z-AREA     용도구역 행위제한        개발제한구역법 §12, 도시공원법 §27, 국토계획법 §81·§80의4·5
//   Z-PLAN     지구단위계획            국토계획법 §54 — 결정조서의 용도·건폐율·용적률·높이
//   Z-EDU      교육환경보호구역         교육환경보호법 §9
//   Z-SITE     대지 조건               건축법 §44(맹지), 국토계획법 §64(도시계획시설 저촉), §84(걸침)
//
// Thresholds and use lists are read from statute/ordinance text (corpus or law.go.kr),
// matched with lib/land/uses.ts, and reported with the line they came from.
import { applicableRegions, loadNational } from "../corpus.ts";
import { cite, fmt, num, str } from "../review/skills/common.ts";
import type { CheckStatus, Citation, ProjectValues } from "../review/types.ts";
import type { Chunk, Region } from "../types.ts";
import type { BimIssue, BimRuleResult, Severity } from "../bim/types.ts";
import { zoneUseTable } from "./appendix.ts";
import { frontRoad, zonesOf } from "./site.ts";
import type { DistrictPlan, LandZone, SiteInfo, UseMatrix, UseRow } from "./types.ts";
import { matchItem, parseNumberedUseList, USE_CATEGORIES, useOf, type UseItem, type UseOf } from "./uses.ts";
import { mainUseZone, squashName, USE_ZONE_RE } from "./zones.ts";

const chunk = (id: string): Chunk | undefined => loadNational().byId.get(id);
const firstLine = (c: Chunk) => c.text.split("\n").find(l => l.trim()) || "";
const citeId = (id: string, quote?: string): Citation[] => { const c = chunk(id); return c ? [cite(c, quote || firstLine(c))] : []; };
const lineWith = (c: Chunk | undefined, re: RegExp) => c?.text.split("\n").find(l => re.test(l))?.trim();

export type LandContext = {
  site?: SiteInfo;
  values: ProjectValues;
  region: Region | null;
  /** 주요구조부 내화 (BuildLex_KR or 구조) */
  fireResistive?: boolean;
  live?: boolean;
  /** 건폐율·용적률·높이 are judged by 2A·2B·4B against the plan (BIM review) — Z-PLAN only covers uses. */
  planDensityElsewhere?: boolean;
};

type Base = Pick<BimRuleResult, "check_id" | "title" | "requirement"> & Partial<BimRuleResult>;
function result(b: Base, issues: BimIssue[], checked: number): BimRuleResult {
  const status: CheckStatus = b.status ?? (issues.some(i => i.status === "FAIL") ? "FAIL" : issues.length ? "UNCLEAR" : checked ? "PASS" : "NOT_APPLICABLE");
  return { section: "입지·용도", source: "land", code_confidence: "HIGH", citations: [], notes: [], ...b, status, issues, checked };
}
function issue(rule: string, n: number, status: "FAIL" | "UNCLEAR", severity: Severity, title: string, detail: string, extra: Partial<BimIssue> = {}): BimIssue {
  return { id: `${rule}-${n}`, rule_id: rule, status, severity: status === "UNCLEAR" ? "minor" : severity, title, detail, refs: [], ...extra };
}
const verifiedQuote = (c: Chunk, quote: string, liveText?: string): Citation =>
  liveText ? { id: c.id, label: `「${c.lawName}」 ${c.articleNo}(${c.heading.replace(/\(.*$/, "")})`, quote: quote.slice(0, 240), verified: squashName(liveText).includes(squashName(quote)), sourceUrl: c.attachment || c.sourceUrl } : cite(c, quote);

function projectUse(v: ProjectValues): UseOf {
  return useOf(str(v, "주용도"), { area: num(v, "시설면적") ?? num(v, "연면적"), floors: num(v, "지상층수") });
}

// ───────────────────────────── Z-USE ─────────────────────────────

export async function ruleZoneUse(c: LandContext): Promise<BimRuleResult> {
  const zone = str(c.values, "용도지역").replace(/\s/g, "");
  const use = str(c.values, "주용도");
  const b: Base = { check_id: "Z-USE", title: "용도지역 안에서 건축할 수 있는 건축물", requirement: "용도지역별로 국토계획법 시행령 별표 2~22와 도시·군계획조례가 정한 건축물만 건축할 수 있음" };
  const art71 = chunk("국토의계획및이용에관한법률시행령#71");
  if (!zone || !USE_ZONE_RE.test(zone)) return result({ ...b, status: "UNCLEAR", citations: citeId("국토의계획및이용에관한법률#76"), notes: [zone ? `'${zone}'은 건축제한 별표가 정해진 21개 용도지역이 아닙니다(세분된 용도지역을 확인하세요).` : "용도지역을 모릅니다. 지도에서 대지를 고르거나 건축개요에 입력하세요."] }, [], 0);
  if (!use) return result({ ...b, status: "UNCLEAR", notes: ["주용도를 모릅니다. 건축개요의 '주용도'를 입력하세요(예: 제2종 근린생활시설(사무소), 공동주택(아파트))."] }, [], 0);
  const zt = await zoneUseTable(zone, { live: c.live });
  if (!zt) return result({ ...b, status: "UNCLEAR", notes: [`${zone}의 건축제한 별표를 시행령 제71조에서 찾지 못했습니다.`] }, [], 0);
  const u = projectUse(c.values);
  const ap = zt.chunk;
  const apLabel = `「국토의 계획 및 이용에 관한 법률 시행령」 ${zt.ref.appendix.replace("별표", "별표 ")}`;
  b.requirement = `${zone}: ${apLabel}에 ${zt.ref.mode === "allow" ? "규정된 건축물만 건축할 수 있음(조례 위임분 포함)" : "규정된 건축물은 건축할 수 없음"}`;
  b.citations = art71 ? [cite(art71, zt.ref.line)] : [];
  b.tier = 1;
  if (!zt.table || !ap) {
    return result({ ...b, status: "UNCLEAR", code_confidence: "MEDIUM", notes: [
      `${apLabel} 본문을 불러오지 못했습니다(코퍼스에는 제목만 수록)${zt.why ? ` — ${zt.why}` : ""}. 법제처 원문을 읽으면 자동 판정합니다.`,
      ap?.attachment ? `원문: ${ap.attachment}` : "",
      `판정 대상: ${use}${u.name ? ` → 「건축법 시행령」 별표 1 제${u.no}호 ${u.name}` : " (별표 1 용도를 특정하지 못함)"}`,
    ].filter(Boolean) }, [], 0);
  }
  if (!u.no) return result({ ...b, status: "UNCLEAR", notes: [`주용도 '${use}'를 「건축법 시행령」 별표 1 용도로 특정하지 못했습니다. '제2종 근린생활시설(사무소)'처럼 별표 1 용도명을 넣어 주세요.`] }, [], 0);
  const liveText = zt.source === "live" ? zt.table.items.map(i => i.text).join("\n") : undefined;
  const hits = zt.table.items.map(it => ({ it, m: matchItem(u, it) })).filter(x => x.m.match !== "none");
  const p1 = hits.filter(h => h.it.part === 1), p2 = hits.filter(h => h.it.part === 2);
  const full1 = p1.find(h => h.m.match === "full");
  const q = (it: UseItem) => `${it.label}. ${it.text}`.slice(0, 240);
  const cites = (xs: typeof hits) => xs.slice(0, 3).map(h => verifiedQuote(ap, q(h.it), liveText ?? (zt.source === "corpus" ? ap.text : undefined)));
  const notes = [`판정 대상: ${use} → 「건축법 시행령」 별표 1 제${u.no}호 ${u.name}`, `별표 원문 출처: ${zt.source === "live" ? "법제처 국가법령정보 Open API(실시간)" : "코퍼스"}`];
  if (u.area !== undefined) notes.push(`면적 조건은 ${num(c.values, "시설면적") ? "시설면적" : "연면적"} ${fmt(u.area)}㎡로 판단했습니다(해당 용도 바닥면적 합계 기준 — 복합용도면 직접 확인).`);
  const issues: BimIssue[] = [];
  let status: CheckStatus;
  const ordinanceNote = () => {
    const ord = c.region ? findOrdinanceArticle(c.region, /용도지역(안|에서|안에서)?의?건축제한/) : null;
    return ord ? `${ord.lawName} ${ord.articleNo}(${ord.heading})에서 조례 별표를 확인하세요${/별표/.test(ord.text) ? "(조례 별표 본문은 코퍼스 미수록)" : ""}.` : "해당 지자체 도시·군계획조례의 허용 여부를 확인하세요.";
  };
  if (zt.ref.mode === "allow") {
    if (full1) { status = "PASS"; b.citations!.push(...cites([full1])); }
    else if (p1.length) { status = "UNCLEAR"; b.citations!.push(...cites(p1)); issues.push(issue("Z-USE", 1, "UNCLEAR", "major", `${zone}: 조건부 허용`, `${p1[0].m.why || "세부 용도·규모 조건"}을 만족하면 건축할 수 있습니다.`)); }
    else if (p2.length) { status = "UNCLEAR"; b.citations!.push(...cites(p2)); b.tier = 2; issues.push(issue("Z-USE", 1, "UNCLEAR", "major", `${zone}: 도시·군계획조례로 허용 여부 결정`, `${apLabel} 제2호(조례 위임) 항목입니다. ${ordinanceNote()}${p2[0].m.why ? ` 조건: ${p2[0].m.why}` : ""}`)); }
    else {
      status = "FAIL";
      issues.push(issue("Z-USE", 1, "FAIL", "critical", `${zone}에서 ${u.name} 건축 불가`, `${apLabel}의 건축할 수 있는 건축물(조례 위임분 포함)에 ${use}가 없습니다.`));
      if (zt.table.headers.length) b.citations!.push(verifiedQuote(ap, zt.table.headers.map(h => `${h.part}. ${h.text}`).join(" / "), liveText ?? ap.text));
    }
  } else {
    if (full1) { status = "FAIL"; b.citations!.push(...cites([full1])); issues.push(issue("Z-USE", 1, "FAIL", "critical", `${zone}에서 ${u.name} 건축 불가`, `${apLabel}의 건축할 수 없는 건축물에 해당합니다.${full1.m.why ? ` (${full1.m.why})` : ""}`)); }
    else if (p1.length) { status = "UNCLEAR"; b.citations!.push(...cites(p1)); issues.push(issue("Z-USE", 1, "UNCLEAR", "major", `${zone}: 일부 금지 대상`, `${p1[0].m.why || "세부 용도"}에 따라 건축할 수 없을 수 있습니다.`)); }
    else if (p2.length) { status = "UNCLEAR"; b.citations!.push(...cites(p2)); b.tier = 2; issues.push(issue("Z-USE", 1, "UNCLEAR", "minor", `${zone}: 조례로 금지될 수 있음`, `${apLabel} 제2호(조례로 건축할 수 없는 건축물) 항목입니다. ${ordinanceNote()}`)); }
    else status = "PASS";
  }
  // 복합용도지구 can widen what a 일반주거·일반공업·계획관리 zone allows (시행령 제81조).
  if (status === "FAIL" && zonesOf(c.site, "용도지구").some(z => /복합용도지구/.test(z.name))) {
    status = "UNCLEAR";
    notes.push("복합용도지구 안이므로 시행령 제81조에 따라 조례로 추가 허용될 수 있습니다.");
    b.citations!.push(...citeId("국토의계획및이용에관한법률시행령#81"));
    for (const i of issues) { i.status = "UNCLEAR"; i.severity = "minor"; }
  }
  return result({ ...b, status, notes }, issues, 1);
}

/** "이 땅에 지을 수 있는 용도" — every 별표 1 category against the zone's 별표 (and district ordinances). */
export async function useMatrix(zone: string, opts: { region?: Region | null; districts?: LandZone[]; live?: boolean } = {}): Promise<UseMatrix> {
  const z = squashName(zone);
  const zt = await zoneUseTable(z, { live: opts.live });
  const out: UseMatrix = { zone: z, rows: [], notes: [] };
  if (!zt) { out.notes.push(`${z}의 건축제한 별표를 찾지 못했습니다.`); return out; }
  out.appendix = { id: zt.chunk?.id || "", label: `시행령 ${zt.ref.appendix.replace("별표", "별표 ")}`, url: zt.chunk?.attachment || zt.chunk?.sourceUrl, mode: zt.ref.mode, source: zt.source };
  const districtLists = (opts.districts || []).map(d => ({ d, items: districtUseList(opts.region || null, d.name)?.items || [] })).filter(x => x.items.length);
  for (const cat of USE_CATEGORIES) {
    const u = useOf(cat.name);
    let row: UseRow = { no: cat.no, name: cat.name, verdict: "확인", by: out.appendix.label };
    if (zt.table) {
      const hits = zt.table.items.map(it => ({ it, m: matchItem(u, it) })).filter(x => x.m.match !== "none");
      const p1 = hits.filter(h => h.it.part === 1), p2 = hits.filter(h => h.it.part === 2);
      const pick = p1[0] || p2[0];
      const txt = pick ? `${pick.it.label}. ${pick.it.text}` : undefined;
      if (zt.ref.mode === "allow") row = { ...row, verdict: p1.some(h => h.m.match === "full") ? "허용" : p1.length ? "조건" : p2.length ? "조례" : "불허", text: txt };
      else row = { ...row, verdict: p1.some(h => h.m.match === "full") ? "불허" : p1.length ? "조건" : p2.length ? "조례" : "허용", text: txt };
    }
    for (const { d, items } of districtLists) {
      const hit = items.map(it => matchItem(u, it)).find(m => m.match !== "none");
      if (hit && row.verdict !== "불허") row = { ...row, verdict: hit.match === "full" ? "불허" : "조건", by: `${row.by} · ${d.name}(조례)`, via: d.name, text: `${d.name}: ${items.find(it => matchItem(u, it).match !== "none")?.text || ""}` };
    }
    out.rows.push(row);
  }
  if (!zt.table) out.notes.push(`${out.appendix.label} 본문을 불러오지 못해 용도지역 기준은 판정하지 않았습니다('확인')${zt.why ? ` — ${zt.why}` : ""}.${districtLists.length ? " 표시된 불허·조건은 용도지구 조례에 따른 것입니다." : ""}`);
  else out.notes.push("대분류(별표 1 호) 기준 판정입니다. 세부 용도·면적·층수 조건이 있는 항목은 '조건'으로 표시합니다.");
  return out;
}

// ───────────────────────────── ordinance helpers ─────────────────────────────

function findOrdinanceArticle(region: Region, heading: RegExp, law = /도시(ㆍ군)?계획조례/): Chunk | null {
  for (const L of applicableRegions(region)) {
    const hit = L.chunks.find(ch => ch.kind === "article" && heading.test(squashName(ch.heading)) && law.test(squashName(ch.lawName)));
    if (hit) return hit;
  }
  return null;
}

/** Base district name as ordinances title it: "자연경관지구(OO)" → "자연경관지구". */
const districtBase = (name: string) => (squashName(name).match(/([가-힣]*?(?:경관|고도|방화|방재|보호|취락|개발진흥|특정용도제한|복합용도|미관)지구)/)?.[1] || squashName(name));

function districtArticles(region: Region | null, name: string): Chunk[] {
  if (!region) return [];
  const base = districtBase(name);
  const family = base.replace(/^(자연|시가지|특화|역사문화|조망가로|수변|역사문화환경|중요시설물|생태계|시가지방재|자연방재|주거|산업ㆍ?유통|관광ㆍ?휴양|복합|특정)/, "");
  const out: Chunk[] = [];
  for (const L of applicableRegions(region)) {
    for (const ch of L.chunks) {
      if (ch.kind !== "article" || !/도시(ㆍ군)?계획조례/.test(squashName(ch.lawName))) continue;
      const h = squashName(ch.heading);
      if ((h.includes(base) || (h.startsWith(family) && family !== base)) && /건축제한|건축할수|건폐율|높이/.test(h)) out.push(ch);
    }
    if (out.length) break; // the 시·군·구 ordinance first, else the 광역 one
  }
  return out;
}

function districtUseList(region: Region | null, name: string): { items: UseItem[]; art: Chunk } | null {
  for (const art of districtArticles(region, name)) {
    const items = parseNumberedUseList(art.text);
    if (items.length) return { items, art };
  }
  return null;
}

function districtLimits(arts: Chunk[]): { bcr?: number; floors?: number; height?: number; line?: string; art?: Chunk } {
  for (const art of arts) {
    for (const l of art.text.split("\n")) {
      if (!/건폐율|높이/.test(l) || !/(이하|초과하지)/.test(l)) continue;
      const bcr = l.match(/건폐율은?\s*(\d+)\s*퍼센트/);
      const floors = l.match(/높이는?\s*(\d+)\s*층\s*이하/) || l.match(/(\d+)\s*층\s*이하/);
      const height = l.match(/(\d+(?:\.\d+)?)\s*미터\s*이하/);
      if (bcr || floors || height) return { bcr: bcr ? Number(bcr[1]) : undefined, floors: floors ? Number(floors[1]) : undefined, height: height ? Number(height[1]) : undefined, line: l.trim(), art };
    }
  }
  return {};
}

// ───────────────────────────── Z-DISTRICT ─────────────────────────────

export function ruleDistricts(c: LandContext): BimRuleResult {
  const fromSite = zonesOf(c.site, "용도지구");
  const typed = str(c.values, "용도지구").split(/[,、/]/).map(s => s.trim()).filter(Boolean).filter(n => !fromSite.some(z => squashName(z.name) === squashName(n)));
  const districts: LandZone[] = [...fromSite, ...typed.map(n => ({ name: n, kind: "용도지구" as const, source: "manual" as const }))];
  const b: Base = { check_id: "Z-DISTRICT", title: "용도지구 안의 건축제한", requirement: "용도지구별 건축제한(건축법 제51조, 국토계획법 시행령 제72조~제82조, 도시·군계획조례)" };
  if (!districts.length) return result({ ...b, status: "NOT_APPLICABLE", citations: citeId("국토의계획및이용에관한법률#37"), notes: ["대지에 지정된 용도지구가 없습니다(토지이용계획 기준)."] }, [], 0);
  const u = projectUse(c.values);
  const h = num(c.values, "높이"), floors = num(c.values, "지상층수");
  const site = num(c.values, "대지면적"), ba = num(c.values, "건축면적");
  const bcr = site && ba ? Math.round((ba / site) * 10000) / 100 : undefined;
  const issues: BimIssue[] = [];
  const citations: Citation[] = [];
  const notes: string[] = [];
  let n = 0;
  const add = (st: "FAIL" | "UNCLEAR", sev: Severity, title: string, detail: string, extra: Partial<BimIssue> = {}) => issues.push(issue("Z-DISTRICT", ++n, st, sev, title, detail, extra));
  for (const d of districts) {
    const name = squashName(d.name);
    if (/방화지구/.test(name)) {
      const a51 = chunk("건축법#51");
      if (a51) citations.push(cite(a51, firstLine(a51)));
      citations.push(...citeId("건축법시행령#58"));
      if (c.fireResistive === false) add("FAIL", "critical", "방화지구: 주요구조부·지붕·외벽 내화구조 아님", "방화지구 안에서는 주요구조부와 지붕·외벽을 내화구조로 해야 합니다(연면적 30㎡ 미만 단층 부속건축물 등 시행령 제58조 예외 제외).", { measured: "내화구조 아님", required: "내화구조" });
      else if (c.fireResistive === undefined) add("UNCLEAR", "major", "방화지구: 내화구조 여부 확인", "주요구조부 내화 여부(BuildLex_KR.주요구조부내화)를 알 수 없습니다.");
      else notes.push("방화지구: 주요구조부 내화구조로 보았습니다. 인접대지경계선에 접하는 외벽 창문 방화설비(「피난·방화규칙」 제23조②)는 별도 확인하세요.");
      continue;
    }
    if (/고도지구/.test(name)) {
      const a74 = chunk("국토의계획및이용에관한법률시행령#74");
      if (a74) citations.push(cite(a74, firstLine(a74)));
      const limit = d.height ?? c.site?.plan?.height?.maxM;
      if (limit === undefined) add("UNCLEAR", "major", `${d.name}: 최고높이 확인`, "고도지구의 최고높이는 도시·군관리계획으로 정합니다. 결정 높이를 지구단위계획 입력란의 최고높이에 넣으면 판정합니다.");
      else if (h === undefined) add("UNCLEAR", "minor", `${d.name}: 건물 높이 미확인`, `최고높이 ${fmt(limit)}m와 비교할 건물 높이가 없습니다.`);
      else if (h > limit + 1e-6) add("FAIL", "critical", `${d.name}: 최고높이 초과`, `건물 높이 ${fmt(h)}m > 고도지구 최고높이 ${fmt(limit)}m.`, { measured: `${fmt(h)}m`, required: `${fmt(limit)}m 이하` });
      else notes.push(`${d.name}: 높이 ${fmt(h)}m ≤ ${fmt(limit)}m.`);
      continue;
    }
    if (/자연취락지구|보호취락지구/.test(name)) {
      const ap = chunk(/보호/.test(name) ? "국토의계획및이용에관한법률시행령#별표23의2" : "국토의계획및이용에관한법률시행령#별표23");
      citations.push(...citeId("국토의계획및이용에관한법률시행령#78"));
      notes.push(`${d.name}: 건축할 수 있는 건축물은 시행령 ${ap?.articleNo || "별표 23"}에 따릅니다${ap?.attachment ? ` (${ap.attachment})` : ""}. 별표 본문 확인이 필요합니다.`);
      add("UNCLEAR", "major", `${d.name}: 허용 건축물 확인`, `시행령 제78조 — ${ap?.articleNo || "별표 23"}의 허용 건축물과 대조하세요.`);
      continue;
    }
    if (/집단취락지구/.test(name)) { citations.push(...citeId("국토의계획및이용에관한법률시행령#78")); add("UNCLEAR", "major", `${d.name}: 개발제한구역법 적용`, "집단취락지구의 건축제한은 개발제한구역법령에 따릅니다."); continue; }
    if (/개발진흥지구/.test(name)) { citations.push(...citeId("국토의계획및이용에관한법률시행령#79")); add("UNCLEAR", "major", `${d.name}: 지구단위계획·개발계획 확인`, "개발진흥지구는 지구단위계획 또는 개발계획에 맞게 건축해야 합니다(시행령 제79조)."); continue; }
    if (/복합용도지구/.test(name)) { citations.push(...citeId("국토의계획및이용에관한법률시행령#81")); notes.push(`${d.name}: 용도지역에서 허용되는 건축물 외에 조례로 추가 허용(시행령 제81조) — 완화 지구입니다.`); continue; }
    // 경관·방재·보호·특정용도제한·기타(조례) 지구: the ordinance decides.
    const nat = /경관/.test(name) ? "#72" : /방재/.test(name) ? "#75" : /보호지구/.test(name) ? "#76" : /특정용도제한/.test(name) ? "#80" : "#82";
    const natArt = chunk(`국토의계획및이용에관한법률시행령${nat}`);
    if (natArt) citations.push(cite(natArt, firstLine(natArt)));
    const arts = districtArticles(c.region, d.name);
    if (!arts.length) { add("UNCLEAR", "major", `${d.name}: 조례 건축제한 확인`, `${c.region ? `${c.region.label} 도시·군계획조례에서` : "지역을 몰라"} ${districtBase(d.name)} 건축제한 조문을 찾지 못했습니다.`); continue; }
    const list = districtUseList(c.region, d.name);
    const lim = districtLimits(arts);
    if (/보호지구/.test(name)) {
      const a = arts[0];
      citations.push(cite(a, firstLine(a)));
      add("UNCLEAR", "major", `${d.name}: 조례 허용 건축물 확인`, `보호지구 안에서는 조례가 정한 건축물만 건축할 수 있습니다(${a.lawName} ${a.articleNo}).`);
      continue;
    }
    if (list && u.no) {
      const hit = list.items.map(it => ({ it, m: matchItem(u, it) })).find(x => x.m.match !== "none");
      if (hit) {
        citations.push(cite(list.art, `${hit.it.label}. ${hit.it.text}`));
        add(hit.m.match === "full" ? "FAIL" : "UNCLEAR", "critical", `${d.name}: 건축할 수 없는 용도`, `${list.art.lawName} ${list.art.articleNo} 제${hit.it.label}호 — ${hit.it.text.slice(0, 120)}${hit.m.why ? ` (${hit.m.why})` : ""}`);
      } else notes.push(`${d.name}: 금지 용도(${list.art.lawName} ${list.art.articleNo})에 해당하지 않습니다.`);
    } else if (list && !u.no) add("UNCLEAR", "minor", `${d.name}: 주용도 미확인`, "주용도를 몰라 조례 금지 용도와 대조하지 못했습니다.");
    if (lim.art && lim.line) {
      citations.push(cite(lim.art, lim.line));
      if (lim.bcr !== undefined) {
        if (bcr === undefined) add("UNCLEAR", "minor", `${d.name}: 건폐율 미확인`, `조례 건폐율 ${lim.bcr}% 이하와 비교할 값이 없습니다.`);
        else if (bcr > lim.bcr + 1e-6) add("FAIL", "major", `${d.name}: 건폐율 초과`, `건폐율 ${fmt(bcr)}% > ${lim.bcr}% (${lim.art.lawName} ${lim.art.articleNo}).`, { measured: `${fmt(bcr)}%`, required: `${lim.bcr}% 이하` });
      }
      if (lim.floors !== undefined && floors !== undefined && floors > lim.floors) add("FAIL", "major", `${d.name}: 층수 초과`, `지상 ${floors}층 > ${lim.floors}층 이하.`, { measured: `${floors}층`, required: `${lim.floors}층 이하` });
      if (lim.height !== undefined && h !== undefined && h > lim.height + 1e-6) add("FAIL", "major", `${d.name}: 높이 초과`, `높이 ${fmt(h)}m > ${lim.height}m 이하.`, { measured: `${fmt(h)}m`, required: `${lim.height}m 이하` });
      notes.push("조례의 완화 단서(위원회 심의 등)는 반영하지 않았습니다.");
    }
  }
  const dedup = citations.filter((x, i) => citations.findIndex(y => y.id === x.id && y.quote === x.quote) === i);
  return result({ ...b, citations: dedup, notes: [`대상 용도지구: ${districts.map(d => d.name).join(", ")}`, ...notes], tier: issues.some(i => /조례/.test(i.detail)) ? 3 : 1 }, issues, districts.length);
}

// ───────────────────────────── Z-AREA ─────────────────────────────

const AREA_RULES: { re: RegExp; id: string; label: string; status: "FAIL" | "UNCLEAR"; detail: string }[] = [
  { re: /개발제한구역/, id: "개발제한구역의지정및관리에관한특별조치법#12", label: "개발제한구역", status: "FAIL", detail: "개발제한구역에서는 건축물의 건축이 원칙적으로 금지되고, 제12조①각 호의 시설만 허가를 받아 건축할 수 있습니다." },
  { re: /도시자연공원구역/, id: "도시공원및녹지등에관한법률#27", label: "도시자연공원구역", status: "FAIL", detail: "도시자연공원구역에서는 건축이 원칙적으로 금지되고, 제27조①각 호의 행위만 허가를 받아 할 수 있습니다." },
  { re: /시가화조정구역/, id: "국토의계획및이용에관한법률#81", label: "시가화조정구역", status: "FAIL", detail: "시가화조정구역에서는 제81조②각 호(농림어업용 건축물, 마을공동시설 등)만 허가를 받아 할 수 있습니다." },
  { re: /도시혁신구역/, id: "국토의계획및이용에관한법률#80의4", label: "도시혁신구역", status: "UNCLEAR", detail: "용도·건폐율·용적률·높이는 도시혁신계획으로 따로 정합니다." },
  { re: /복합용도구역/, id: "국토의계획및이용에관한법률#80의5", label: "복합용도구역", status: "UNCLEAR", detail: "용도·규모는 복합용도계획으로 따로 정합니다." },
  { re: /입체복합구역/, id: "국토의계획및이용에관한법률#40의5", label: "도시·군계획시설입체복합구역", status: "UNCLEAR", detail: "도시·군계획시설과 함께 설치하는 건축물의 기준은 해당 계획으로 정합니다." },
  { re: /수산자원보호구역/, id: "국토의계획및이용에관한법률#40", label: "수산자원보호구역", status: "UNCLEAR", detail: "행위제한은 「수산자원관리법」에 따릅니다(코퍼스 미수록)." },
];

export function ruleAreas(c: LandContext): BimRuleResult {
  const b: Base = { check_id: "Z-AREA", title: "용도구역 안의 행위제한", requirement: "개발제한구역·도시자연공원구역·시가화조정구역 등에서는 법령이 허용한 행위만 할 수 있음" };
  const areas = zonesOf(c.site, "용도구역");
  if (!areas.length) return result({ ...b, status: "NOT_APPLICABLE", notes: ["대지에 지정된 용도구역이 없습니다(토지이용계획 기준)."] }, [], 0);
  const issues: BimIssue[] = [];
  const citations: Citation[] = [];
  areas.forEach((a, i) => {
    const rule = AREA_RULES.find(r => r.re.test(squashName(a.name)));
    if (!rule) { issues.push(issue("Z-AREA", i + 1, "UNCLEAR", "major", `${a.name}: 행위제한 확인`, "해당 구역의 근거 법령을 확인하세요.")); return; }
    const art = chunk(rule.id);
    if (art) citations.push(cite(art, firstLine(art)));
    issues.push(issue("Z-AREA", i + 1, rule.status, "critical", `${rule.label}${a.relation === "저촉" ? "(일부 저촉)" : ""}`, rule.detail + (a.relation === "저촉" ? " 대지 일부만 걸쳐 있으니 걸친 부분의 위치를 확인하세요." : "")));
  });
  return result({ ...b, citations, notes: [`대상 용도구역: ${areas.map(a => a.name).join(", ")}`] }, issues, areas.length);
}

// ───────────────────────────── Z-PLAN ─────────────────────────────

const planHasValues = (p?: DistrictPlan) => !!p && (p.bcr !== undefined || !!p.far?.base || !!p.far?.allowed || !!p.far?.max || !!p.height?.maxM || !!p.height?.maxFloors || !!(p.uses && Object.values(p.uses).some(x => x?.length)));

export function planFar(p: DistrictPlan): { value?: number; label: string } {
  const f = p.far || {};
  const pick = p.farApplied || (f.allowed ? "allowed" : f.base ? "base" : f.max ? "max" : undefined);
  const value = pick ? f[pick] : undefined;
  return { value, label: pick === "base" ? "기준용적률" : pick === "allowed" ? "허용용적률" : pick === "max" ? "상한용적률" : "용적률" };
}

function useListHit(u: UseOf, list: string[] | undefined): string | undefined {
  if (!list?.length || !u.text) return undefined;
  return list.find(entry => {
    const e = useOf(entry);
    const s = squashName(entry);
    if (e.no && u.no === e.no && (s.replace(squashName(e.name || ""), "").length < 2 || u.text.includes(s.replace(squashName(e.name || ""), "").replace(/[()]/g, "")))) return true;
    return s.length >= 2 && u.text.includes(s);
  });
}

export function ruleDistrictPlan(c: LandContext): BimRuleResult {
  const inZone = (c.site?.zones || []).some(z => z.kind === "지구단위계획" && z.relation !== "접합") || c.values.지구단위계획?.value === true;
  const p = c.site?.plan;
  const b: Base = { check_id: "Z-PLAN", title: "지구단위계획 적합성", requirement: "지구단위계획구역에서는 지구단위계획에 맞게 건축해야 함(용도·건폐율·용적률·높이 등)" };
  const a54 = chunk("국토의계획및이용에관한법률#54");
  b.citations = a54 ? [cite(a54, firstLine(a54))] : [];
  if (!inZone && !planHasValues(p)) return result({ ...b, status: "NOT_APPLICABLE", notes: ["지구단위계획구역이 아닙니다(토지이용계획 기준)."] }, [], 0);
  if (!planHasValues(p)) return result({ ...b, status: "UNCLEAR", notes: ["지구단위계획구역입니다. 결정조서·시행지침의 '건축물에 관한 계획'(허용·불허용도, 건폐율, 용적률, 최고높이)을 대지 정보의 지구단위계획란에 입력하거나 결정조서 PDF를 올려 AI로 채우세요."] }, [issue("Z-PLAN", 1, "UNCLEAR", "critical", "지구단위계획 내용 미입력", "용도지역 기준이 아니라 지구단위계획 기준이 우선합니다. 계획 내용이 없어 대지·밀도·높이 판정의 근거가 부족합니다.")], 1);
  const plan = p!;
  const u = projectUse(c.values);
  const issues: BimIssue[] = [];
  const notes: string[] = [plan.name ? `지구단위계획: ${plan.name}${plan.block ? ` (${plan.block})` : ""}` : "지구단위계획 입력값 기준", plan.source === "ai" ? "결정조서에서 AI로 추출한 값입니다(원문 인용 대조 통과분만). 반드시 원문과 대조하세요." : "직접 입력한 값입니다."];
  let n = 0;
  const add = (st: "FAIL" | "UNCLEAR", sev: Severity, title: string, detail: string, extra: Partial<BimIssue> = {}) => issues.push(issue("Z-PLAN", ++n, st, sev, title, detail, extra));
  const use = str(c.values, "주용도");
  if (plan.uses) {
    const bad = useListHit(u, plan.uses.prohibited);
    if (bad) add("FAIL", "critical", "지구단위계획 불허용도", `주용도 '${use}'가 불허용도 '${bad}'에 해당합니다.`);
    const allowed = [...(plan.uses.designated || []), ...(plan.uses.allowed || []), ...(plan.uses.recommended || [])];
    if (!bad && allowed.length && !useListHit(u, allowed)) add("UNCLEAR", "major", "지구단위계획 허용용도 확인", `주용도 '${use || "미입력"}'가 지정·권장·허용용도(${allowed.slice(0, 6).join(", ")}${allowed.length > 6 ? " …" : ""})에 보이지 않습니다. 계획의 용도 규정(허용 외 금지 여부)을 확인하세요.`);
    if (plan.uses.designated?.length) notes.push(`지정용도: ${plan.uses.designated.join(", ")} — 층·위치 지정 여부를 도면과 대조하세요.`);
  }
  if (c.planDensityElsewhere) {
    notes.push("건폐율·용적률·높이는 2A·2B·4B 항목에서 지구단위계획 기준으로 판정합니다.");
    if (plan.setback !== undefined) add("UNCLEAR", "minor", "건축한계선 확인", `건축한계선 ${plan.setback}m 후퇴 — 배치도에서 도로경계선으로부터의 외벽 이격을 확인하세요.`);
    return result({ ...b, notes, code_confidence: plan.source === "ai" ? "MEDIUM" : "HIGH", tier: 3 }, issues, 1);
  }
  const site = num(c.values, "대지면적"), ba = num(c.values, "건축면적"), farArea = num(c.values, "용적률산정용연면적") ?? num(c.values, "연면적");
  const bcr = site && ba ? Math.round((ba / site) * 10000) / 100 : num(c.values, "건폐율");
  const far = site && farArea ? Math.round((farArea / site) * 10000) / 100 : num(c.values, "용적률");
  if (plan.bcr !== undefined) {
    if (bcr === undefined) add("UNCLEAR", "minor", "건폐율 미확인", `지구단위계획 건폐율 ${plan.bcr}% 이하와 비교할 값이 없습니다.`);
    else if (bcr > plan.bcr + 1e-6) add("FAIL", "critical", "지구단위계획 건폐율 초과", `건폐율 ${fmt(bcr)}% > ${plan.bcr}%.`, { measured: `${fmt(bcr)}%`, required: `${plan.bcr}% 이하` });
    else notes.push(`건폐율 ${fmt(bcr)}% ≤ ${plan.bcr}%.`);
  }
  const pf = planFar(plan);
  if (pf.value !== undefined) {
    if (far === undefined) add("UNCLEAR", "minor", "용적률 미확인", `${pf.label} ${pf.value}% 이하와 비교할 값이 없습니다.`);
    else if (far > pf.value + 1e-6) add("FAIL", "critical", `지구단위계획 ${pf.label} 초과`, `용적률 ${fmt(far)}% > ${pf.label} ${pf.value}%.${plan.far?.max && pf.label !== "상한용적률" ? ` (상한 ${plan.far.max}%까지는 공공기여 등 인센티브 조건)` : ""}`, { measured: `${fmt(far)}%`, required: `${pf.value}% 이하` });
    else notes.push(`용적률 ${fmt(far)}% ≤ ${pf.label} ${pf.value}%.`);
  }
  const h = num(c.values, "높이"), floors = num(c.values, "지상층수");
  if (plan.height?.maxM !== undefined) {
    if (h === undefined) add("UNCLEAR", "minor", "높이 미확인", `최고높이 ${plan.height.maxM}m와 비교할 값이 없습니다.`);
    else if (h > plan.height.maxM + 1e-6) add("FAIL", "critical", "지구단위계획 최고높이 초과", `높이 ${fmt(h)}m > ${plan.height.maxM}m.`, { measured: `${fmt(h)}m`, required: `${plan.height.maxM}m 이하` });
  }
  if (plan.height?.maxFloors !== undefined && floors !== undefined && floors > plan.height.maxFloors) add("FAIL", "critical", "지구단위계획 최고층수 초과", `지상 ${floors}층 > ${plan.height.maxFloors}층.`, { measured: `${floors}층`, required: `${plan.height.maxFloors}층 이하` });
  if (plan.height?.minFloors !== undefined && floors !== undefined && floors < plan.height.minFloors) add("FAIL", "major", "지구단위계획 최저층수 미달", `지상 ${floors}층 < ${plan.height.minFloors}층.`, { measured: `${floors}층`, required: `${plan.height.minFloors}층 이상` });
  if (plan.setback !== undefined) add("UNCLEAR", "minor", "건축한계선 확인", `건축한계선 ${plan.setback}m 후퇴 — 배치도에서 도로경계선으로부터의 외벽 이격을 확인하세요.`);
  const a46 = chunk("국토의계획및이용에관한법률시행령#46");
  if (a46) b.citations!.push(cite(a46, firstLine(a46)));
  return result({ ...b, notes, code_confidence: plan.source === "ai" ? "MEDIUM" : "HIGH", tier: 3 }, issues, 1);
}

// ───────────────────────────── Z-EDU ─────────────────────────────

const EDU_KEYS: { re: RegExp; line: RegExp }[] = [
  { re: /숙박|호텔|모텔|여관|생활숙박/, line: /숙박업/ },
  { re: /위락|유흥주점|단란주점/, line: /단란주점영업\s*및\s*유흥주점영업/ },
  { re: /노래연습/, line: /노래연습장업/ },
  { re: /게임|PC방|인터넷컴퓨터/, line: /게임제공업/ },
  { re: /장례|화장시설|봉안/, line: /화장시설/ },
  { re: /도축/, line: /도축업/ },
  { re: /가축시장/, line: /가축시장/ },
  { re: /폐기물|자원순환|고물상/, line: /폐기물처리시설/ },
  { re: /위험물|충전소|가스/, line: /고압가스/ },
  { re: /화약|총포/, line: /총포\s*또는\s*화약류/ },
  { re: /경마|경륜|경정|장외/, line: /경마장/ },
  { re: /카지노/, line: /카지노업/ },
  { re: /무도/, line: /무도학원/ },
  { re: /레미콘/, line: /레미콘/ },
  { re: /정신재활|중독/, line: /중독자재활시설/ },
];

export function ruleEducation(c: LandContext): BimRuleResult {
  const zones = (c.site?.zones || []).filter(z => /(절대|상대)보호구역|교육환경보호구역/.test(squashName(z.name)) && z.relation !== "접합");
  const b: Base = { check_id: "Z-EDU", title: "교육환경보호구역 금지시설", requirement: "교육환경보호구역에서는 교육환경보호법 제9조 각 호의 시설을 설치할 수 없음(상대보호구역은 심의로 일부 예외)" };
  if (!zones.length) return result({ ...b, status: "NOT_APPLICABLE" }, [], 0);
  const art = chunk("교육환경보호에관한법률#9");
  const use = squashName(str(c.values, "주용도"));
  const issues: BimIssue[] = [];
  const citations: Citation[] = art ? [cite(art, firstLine(art))] : [];
  const absolute = zones.some(z => /절대/.test(z.name));
  for (const k of EDU_KEYS) {
    if (!k.re.test(use)) continue;
    const l = lineWith(art, k.line);
    if (l && art) citations.push(cite(art, l));
    issues.push(issue("Z-EDU", issues.length + 1, absolute ? "FAIL" : "UNCLEAR", "critical", `${zones.map(z => z.name).join("·")}: 금지시설 해당 가능`, `${l ? l.slice(0, 160) : "제9조 금지시설"}${absolute ? "" : " — 상대보호구역은 교육환경보호위원회 심의로 예외가 가능한 항목이 있습니다."}`));
  }
  return result({ ...b, citations, notes: [`대상: ${zones.map(z => z.name).join(", ")}`, "건물 용도 기준 대조입니다. 입점 업종(노래연습장, PC방, 담배자동판매기 등)은 영업 신고 단계에서 따로 확인하세요."] }, issues, 1);
}

// ───────────────────────────── Z-SITE ─────────────────────────────

export function ruleSite(c: LandContext): BimRuleResult {
  const b: Base = { check_id: "Z-SITE", title: "대지 조건(도로 접함·도시계획시설·용도지역 걸침)", requirement: "대지는 도로에 접해야 하고(건축법 제44조), 도시·군계획시설 부지에는 그 시설이 아닌 건축물을 지을 수 없음(국토계획법 제64조)" };
  const site = c.site;
  if (!site) return result({ ...b, status: "NOT_APPLICABLE", notes: ["대지를 선택하지 않았습니다."] }, [], 0);
  const issues: BimIssue[] = [];
  const citations: Citation[] = [];
  const notes: string[] = [];
  const road = frontRoad(site);
  if (road.landlocked) {
    citations.push(...citeId("건축법#44"));
    issues.push(issue("Z-SITE", issues.length + 1, "FAIL", "critical", "맹지(도로에 접하지 않음)", "토지특성의 도로접면이 '맹지'입니다. 건축물의 대지는 2m 이상 도로에 접해야 합니다(진입도로 확보·통로 공지 예외 확인)."));
  } else if (road.text) notes.push(`접한 도로: ${road.text}`);
  const facilities = site.zones.filter(z => z.kind === "도시계획시설" && (z.relation === "저촉" || z.relation === "포함"));
  if (facilities.length) {
    citations.push(...citeId("국토의계획및이용에관한법률#64"));
    const a119 = chunk("건축법시행령#119");
    const l = lineWith(a119, /도시ㆍ군계획시설인\s*도로ㆍ공원/);
    if (a119 && l) citations.push(cite(a119, l));
    issues.push(issue("Z-SITE", issues.length + 1, "UNCLEAR", "major", `도시·군계획시설 ${facilities.map(f => f.name).join(", ")} ${facilities.some(f => f.relation === "저촉") ? "저촉" : "포함"}`, "시설 부지에는 그 시설이 아닌 건축물을 지을 수 없고, 도로·공원 등에 포함된 부분은 대지면적에서 제외합니다. 저촉 범위를 도면에서 확인하세요."));
  }
  const zonesUse = site.zones.filter(z => z.kind === "용도지역" && USE_ZONE_RE.test(squashName(z.name)) && z.relation !== "접합");
  const distinct = [...new Set(zonesUse.map(z => squashName(z.name).match(USE_ZONE_RE)![0]))];
  if (distinct.length > 1) {
    citations.push(...citeId("국토의계획및이용에관한법률#84"), ...citeId("국토의계획및이용에관한법률시행령#94"));
    issues.push(issue("Z-SITE", issues.length + 1, "UNCLEAR", "major", `둘 이상의 용도지역에 걸침: ${distinct.join(", ")}`, "가장 작은 부분이 330㎡ 이하이면 건폐율·용적률은 가중평균, 그 밖의 건축제한은 가장 넓은 부분의 용도지역을 적용합니다(국토계획법 제84조). 각 부분 면적을 확인하세요."));
    notes.push(`판정에는 '${mainUseZone(site.zones)}'을(를) 썼습니다.`);
  }
  const others = site.zones.filter(z => z.kind === "기타" && z.relation !== "접합").map(z => z.name);
  if (others.length) notes.push(`그 밖의 법령에 따른 지역·지구: ${others.join(", ")} — 해당 법령의 행위제한(높이·용도 등)을 확인하세요.`);
  const heightZones = site.zones.filter(z => /대공방어|비행안전|비행장|고도제한/.test(z.name) && z.relation !== "접합");
  if (heightZones.length) issues.push(issue("Z-SITE", issues.length + 1, "UNCLEAR", "minor", `높이 협의 대상: ${heightZones.map(z => z.name).join(", ")}`, "군사기지법 등에 따라 일정 높이 이상은 관계기관 협의가 필요합니다(코퍼스 미수록 법령)."));
  return result({ ...b, citations, notes }, issues, 1);
}

// ───────────────────────────── entry ─────────────────────────────

export async function landRules(c: LandContext): Promise<BimRuleResult[]> {
  return [await ruleZoneUse(c), ruleDistricts(c), ruleAreas(c), ruleDistrictPlan(c), ruleEducation(c), ruleSite(c)];
}
