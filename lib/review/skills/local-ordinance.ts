// Phase 3B knowledge: 자치법규(조례). City routing tiers:
//   Tier 3 — the 시·군(or 광역) ordinance article is in the corpus and its numbers parse.
//   Tier 2 — the ordinance delegates to a 별표 whose body is not in the corpus.
//   Tier 1 — no ordinance article found → national standard only (always available).
// Ordinance values that exceed the national range are flagged (상위법 우선).
import { applicableRegions } from "../../corpus.ts";
import type { Chunk, Region } from "../../types.ts";
import type { CheckItem } from "../checklists/index.ts";
import type { CheckStatus, ComplianceItem, ProjectValues } from "../types.ts";
import { cite, fmt, isResidentialForDaylight, num, round2, str } from "./common.ts";
import { evaluateDaylight } from "./korea-building.ts";
import { daylightRule, delegatesToAppendix, landscapeTiers, squash, zoneLimit } from "./parse.ts";

const HEADINGS: Record<string, { want: RegExp; not?: RegExp; law?: RegExp }> = {
  bcr: { want: /용도지역(안|에서|안에서)?의?건폐율/, not: /경관|공장|완화|강화|기존|취락|농지|지구단위|경제자유/, law: /도시(ㆍ군)?계획조례/ },
  far: { want: /용도지역(안|에서|안에서)?의?(건폐율.?)?용적률/, not: /경관|완화|사회복지|공원|공공시설|경제자유|지구단위/, law: /도시(ㆍ군)?계획조례/ },
  daylight: { want: /일조등의확보/, law: /건축조례/ },
  landscape: { want: /대지(안)?의조경|조경면적/, not: /식재|경관지구|기준/, law: /건축조례/ },
  parking: { want: /부설주차장의?설치(기준|등|대상)?$/, not: /인근|비용|면제|개방|충돌|제한/, law: /주차장/ },
  "open-space": { want: /대지안의공지/, law: /건축조례/ },
};

/** First matching article across the 시·군·구 ordinances, then the 광역 본청's. */
export function findOrdinance(region: Region | null, kind: string): Chunk | null {
  const h = HEADINGS[kind];
  if (!h) return null;
  for (const L of applicableRegions(region)) {
    const hit = L.chunks.find(c => c.kind === "article" && h.want.test(squash(c.heading)) && !(h.not && h.not.test(squash(c.heading))) && (!h.law || h.law.test(squash(c.lawName))));
    if (hit) return hit;
  }
  return null;
}

/** Ordinance that only says "…은 「○○광역시 조례」에 따른다" → follow to the parent ordinance. */
function followsParent(c: Chunk): boolean {
  return /「[^」]*(광역시|특별시|도)[^」]*조례」에\s*따른다/.test(c.text);
}

function tierItem(check: CheckItem, over: Partial<ComplianceItem>): ComplianceItem {
  return { check_id: check.id, title: check.title, requirement: check.requirement, status: "UNCLEAR", code_confidence: check.code_confidence, citations: [], notes: [], ...over };
}

export function cityCompliance(checks: CheckItem[], v: ProjectValues, region: Region | null, national: ComplianceItem[]): ComplianceItem[] {
  const out: ComplianceItem[] = [];
  const nat = (id: string) => national.find(n => n.check_id === id);
  for (const check of checks) {
    const n = nat(check.id);
    if (!region) { if (HEADINGS[check.kind]) out.push(tierItem(check, { tier: 1, status: n?.status ?? "UNCLEAR", notes: ["지역(시·군·구)을 판독하지 못해 조례를 적용하지 못했습니다. 국가 기준만 사용합니다."] })); continue; }
    if (!HEADINGS[check.kind]) continue;
    if (n?.status === "NOT_APPLICABLE") { out.push(tierItem(check, { tier: 1, status: "NOT_APPLICABLE", notes: n.notes })); continue; }
    let art = findOrdinance(region, check.kind);
    if (art && followsParent(art)) {
      const parentArt = findOrdinance({ ...region, key: region.parents[0] || region.key, parents: [] }, check.kind);
      if (parentArt && parentArt.id !== art.id) art = parentArt;
    }
    if (!art) { out.push(tierItem(check, { tier: 1, status: n?.status ?? "UNCLEAR", notes: [`${region.label} 조례에서 해당 조문을 찾지 못했습니다. 국가 기준(3A) 결과를 따릅니다.`] })); continue; }

    const zone = str(v, "용도지역");
    switch (check.kind) {
      case "bcr": case "far": {
        const lim = zone ? zoneLimit(art.text, zone) : null;
        if (!lim) {
          const app = delegatesToAppendix(art.text);
          out.push(tierItem(check, { tier: 2, status: n?.status ?? "UNCLEAR", requirement: n?.requirement ?? check.requirement, threshold: n?.threshold, provided: n?.provided, code_confidence: "MEDIUM", citations: [cite(art, art.text.split("\n")[0])], notes: [app ? `${art.lawName} ${art.articleNo}는 ${app}로 정하나 별표 본문이 코퍼스에 없습니다. 국가 상한(3A)으로 판정했으며 조례 별표 확인이 필요합니다.` : `${art.lawName} ${art.articleNo}에서 ${zone || "용도지역"} 행을 찾지 못했습니다.`] }));
          break;
        }
        const notes: string[] = [];
        let limit = lim.value;
        const natLimit = n?.threshold?.value;
        const statedStricter = n?.notes.some(x => x.startsWith("도면에 기준"));
        if (natLimit !== undefined && lim.value > natLimit && !statedStricter) { notes.push(`조례 기준 ${lim.value}%가 시행령 상한 ${natLimit}%를 초과합니다(상위법 우선 — 시행령 기준 적용).`); limit = natLimit; }
        if (natLimit !== undefined && statedStricter && natLimit < limit) { notes.push(`도면 표기 기준 ${natLimit}%가 조례 기준 ${lim.value}%보다 엄격하여 도면 기준을 적용했습니다.`); limit = natLimit; }
        const p = n?.provided?.value;
        const mismatch = n?.notes.some(x => x.includes("산정값")) ?? false;
        const status: CheckStatus = p === undefined ? "UNCLEAR" : p > limit + 1e-9 || mismatch ? "FAIL" : "PASS";
        out.push(tierItem(check, {
          tier: 3, status, requirement: `${region.label} ${zone} ${check.title} ${lim.value}% 이하`,
          threshold: { op: "<=", value: limit, unit: "%" }, provided: n?.provided,
          citations: [cite(art, lim.line)], notes: [...notes, ...(n?.notes.filter(x => x.includes("산정값")) ?? [])], code_confidence: "HIGH",
        }));
        break;
      }
      case "daylight": {
        if (zone && !isResidentialForDaylight(zone)) { out.push(tierItem(check, { tier: 1, status: "NOT_APPLICABLE" })); break; }
        const rule = daylightRule(art.text);
        if (!rule) { out.push(tierItem(check, { tier: 2, status: n?.status ?? "UNCLEAR", citations: [cite(art, art.text.split("\n")[0])], notes: ["조례 문구에서 이격 기준을 해석하지 못해 국가 기준을 따릅니다."] })); break; }
        out.push(evaluateDaylight(check, rule, { h: num(v, "높이"), low: num(v, "정북이격_10m이하"), high: num(v, "정북이격_10m초과"), zone }, [cite(art, rule.lowLine), cite(art, rule.highLine)], 3));
        break;
      }
      case "landscape": {
        const site = num(v, "대지면적"), gfa = num(v, "연면적"), provided = num(v, "조경면적");
        const notes: string[] = [];
        let pct: number | undefined; let line = "";
        const commercial = /상업지역/.test(zone) ? art.text.match(/상업지역[^.\n]*?대지면적의\s*(\d+)\s*퍼센트/) : null;
        if (commercial) { pct = Number(commercial[1]); line = art.text.split("\n").find(l => l.includes(commercial[0].slice(0, 12))) || commercial[0]; }
        else if (gfa !== undefined) {
          const tier = landscapeTiers(art.text).find(t => gfa >= t.minGfa && gfa < t.maxGfa);
          if (tier) { pct = tier.percent; line = tier.line; }
        }
        if (pct === undefined || site === undefined) {
          out.push(tierItem(check, { tier: 2, status: "UNCLEAR", citations: [cite(art, art.text.split("\n")[0])], notes: [gfa === undefined ? "연면적을 판독하지 못해 조례 구간을 정하지 못했습니다." : "조례의 연면적 구간 기준을 해석하지 못했습니다."] }));
          break;
        }
        const required = round2(site * pct / 100);
        if (/옥상|인공지반/.test(String(v.조경면적?.raw || ""))) notes.push("옥상·인공지반 조경은 산입 비율(「조경기준」)을 확인하세요.");
        const status: CheckStatus = provided === undefined ? "UNCLEAR" : provided + 1e-9 >= required ? "PASS" : "FAIL";
        out.push(tierItem(check, {
          tier: 3, status, code_confidence: "HIGH",
          requirement: `${region.label} 건축조례: ${gfa !== undefined ? `연면적 ${fmt(gfa)}㎡ → ` : ""}대지면적의 ${pct}% 이상 = ${fmt(site)}㎡ × ${pct}% = ${fmt(required)}㎡`,
          threshold: { op: ">=", value: required, unit: "㎡" },
          provided: provided !== undefined ? { value: provided, unit: "㎡", text: `조경면적 ${fmt(provided)}㎡` } : undefined,
          citations: [cite(art, line)], notes,
        }));
        break;
      }
      case "parking": {
        const app = delegatesToAppendix(art.text);
        const notes = [`${art.lawName} ${art.articleNo}는 부설주차장 설치기준을 ${app || "별표"}로 정하나 별표 본문이 코퍼스에 없습니다. 국가 기준(3A)으로 판정했으며 조례 강화·완화 기준(시행령 제6조②, 1/2 범위) 확인이 필요합니다.`];
        // Without the ordinance 별표 the only certain failure is one that survives the maximum 1/2 relaxation.
        const req = n?.threshold?.value, prov = n?.provided?.value;
        let status: CheckStatus = "UNCLEAR";
        if (req !== undefined && prov !== undefined) {
          if (prov < req * 0.5) { status = "FAIL"; notes.push(`조례로 최대 1/2 완화하더라도 ${fmt(Math.ceil(req * 0.5))}대 이상이 필요합니다.`); }
          else if (prov < req) notes.push(`국가 기준 ${fmt(req)}대에 미달(${fmt(prov)}대)합니다. 조례 완화 기준이 없으면 부적합입니다.`);
        }
        out.push(tierItem(check, { tier: 2, status, requirement: n?.requirement ?? check.requirement, threshold: n?.threshold, provided: n?.provided, citations: [cite(art, art.text.split("\n")[0])], notes, code_confidence: "MEDIUM" }));
        break;
      }
      case "open-space": {
        out.push(tierItem(check, { tier: 2, status: "UNCLEAR", citations: [cite(art, art.text.split("\n")[0])], reviewer: n?.reviewer, notes: ["조례의 이격거리 기준(용도·규모별)과 배치도 치수를 검토자가 대조해야 합니다."] }));
        break;
      }
    }
  }
  return out;
}
