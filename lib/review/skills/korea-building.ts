// Phase 3A knowledge: national statutes (법률·시행령·시행규칙) from the offline corpus.
// Thresholds are parsed from the article text itself, never typed in from memory —
// except the 주차장법 별표 1 reference table, which is flagged as such.
import { loadNational } from "../../corpus.ts";
import { fetchAppendix } from "../../law-api.ts";
import type { CheckItem } from "../checklists/index.ts";
import type { CheckStatus, Citation, ComplianceItem, ProjectValues, SheetFinding } from "../types.ts";
import { cite, flag, fmt, isResidentialForDaylight, num, round2, str } from "./common.ts";
import { PARKING_TABLE_LABEL, parkingRuleFor, roundParking } from "./parking-table.ts";
import { daylightRule, zoneLimit } from "./parse.ts";

const chunk = (id: string) => loadNational().byId.get(id);
const cites = (ids: string[]): Citation[] => ids.map(chunk).filter(Boolean).map(c => cite(c!));

function base(check: CheckItem, over: Partial<ComplianceItem>): ComplianceItem {
  return { check_id: check.id, title: check.title, requirement: check.requirement, status: "UNCLEAR", code_confidence: check.code_confidence, citations: cites(check.code_basis), notes: [], ...over };
}

/** Phase 2 status for presence checks (worst status across sheets). */
function sheetStatus(findings: SheetFinding[], id: string): { status: CheckStatus; obs: string } {
  const f = findings.filter(x => x.check_id === id);
  if (!f.length) return { status: "UNCLEAR", obs: "해당 시트에서 판독 결과 없음" };
  const order: CheckStatus[] = ["FAIL", "UNCLEAR", "PASS", "NOT_APPLICABLE"];
  const worst = f.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
  return { status: worst.status, obs: f.map(x => `${x.sheet_id}: ${x.observation}`).join(" / ") };
}

type Ratio = { provided?: number; text: string; notes: string[] };
/** Ratio from areas (preferred) and the stated value; flags a mismatch. */
function ratio(v: ProjectValues, numKey: "건축면적" | "용적률산정용연면적", statedKey: "건폐율" | "용적률"): Ratio {
  const site = num(v, "대지면적");
  const area = num(v, numKey) ?? (numKey === "용적률산정용연면적" ? undefined : undefined);
  const stated = num(v, statedKey);
  const notes: string[] = [];
  let provided = stated;
  let text = stated !== undefined ? `도면 표기 ${fmt(stated)}%` : "표기값 없음";
  if (site && area) {
    const calc = round2((area / site) * 100);
    provided = calc;
    text = `${numKey === "건축면적" ? "건축면적" : "용적률 산정용 연면적"} ${fmt(area)}㎡ ÷ 대지면적 ${fmt(site)}㎡ = ${fmt(calc)}%`;
    if (stated !== undefined && Math.abs(stated - calc) > 0.05) notes.push(`도면 표기 ${statedKey} ${fmt(stated)}%가 산정값 ${fmt(calc)}%와 다릅니다(「건축법 시행령」 제119조 산정 기준 확인).`);
  }
  return { provided, text, notes };
}

function limitCheck(check: CheckItem, v: ProjectValues, articleId: string, r: Ratio, statedLimitKey: "건폐율_도면기준" | "용적률_도면기준"): ComplianceItem {
  const zone = str(v, "용도지역");
  const art = chunk(articleId);
  const lim = art && zone ? zoneLimit(art.text, zone) : null;
  const notes = [...r.notes];
  const stated = num(v, statedLimitKey);
  if (!zone) return base(check, { status: "UNCLEAR", notes: [...notes, "용도지역을 판독하지 못해 기준을 정할 수 없습니다."], provided: r.provided !== undefined ? { value: r.provided, unit: "%", text: r.text } : undefined });
  if (!lim || !art) return base(check, { status: "UNCLEAR", notes: [...notes, `${zone}의 시행령 기준 행을 찾지 못했습니다.`] });
  let limit = lim.value;
  let requirement = `${zone} ${check.title} ${lim.value}% 이하(시행령 상한, 조례로 더 낮게 정할 수 있음)`;
  if (stated !== undefined && stated < limit) {
    notes.push(`도면에 기준 ${stated}% 이하가 표기되어 있습니다(지구단위계획·택지 등 별도 기준 가능성). 엄격한 값을 적용했습니다.`);
    limit = stated;
    requirement += ` · 도면 표기 기준 ${stated}% 이하`;
  }
  if (flag(v, "지구단위계획")) notes.push("지구단위계획구역(또는 택지지구)으로 판독되었습니다. 지구단위계획 결정 기준을 별도로 확인해야 합니다.");
  const status: CheckStatus = r.provided === undefined ? "UNCLEAR" : r.provided > limit + 1e-9 || r.notes.length ? "FAIL" : "PASS";
  return base(check, {
    requirement, threshold: { op: "<=", value: limit, unit: "%" },
    provided: r.provided !== undefined ? { value: r.provided, unit: "%", text: r.text } : undefined,
    status, citations: [cite(art, lim.line), ...cites(check.code_basis.filter(id => id !== articleId))], notes, tier: 1,
  });
}

async function parkingCheck(check: CheckItem, v: ProjectValues): Promise<ComplianceItem> {
  const use = str(v, "주용도");
  const provided = num(v, "주차대수");
  const statedMin = num(v, "법정주차대수_도면");
  const area = num(v, "시설면적") ?? num(v, "연면적");
  const rule = parkingRuleFor(use || "");
  const notes: string[] = [];
  const decree = chunk("주차장법시행령#별표1");
  let live: string | null = null;
  try { live = decree?.mst ? await fetchAppendix(decree.mst, "별표 1") : null; } catch { live = null; }
  const citations = cites(["주차장법#19", "주차장법시행령#6"]);
  let required: number | undefined;
  let requirement = "";
  let confidence: ComplianceItem["code_confidence"] = "MEDIUM";

  const liveLine = live && rule.per ? live.split(/\n|(?=\d+\.\s)/).find(l => new RegExp(rule.label.split(/[,·]/)[0].replace(/\s/g, "\\s*")).test(l) && /제곱미터당\s*1대/.test(l)) : null;
  const livePer = liveLine?.match(/시설면적\s*(\d+)\s*제곱미터당\s*1대/);
  if (livePer && area) {
    const per = Number(livePer[1]);
    required = roundParking(area / per);
    requirement = `${rule.label}: 시설면적 ${per}㎡당 1대 → ${fmt(area)}㎡ ÷ ${per} = ${required}대 이상`;
    confidence = "HIGH";
    if (decree) citations.push({ id: decree.id, label: "「주차장법 시행령」 별표 1", quote: liveLine!.trim().slice(0, 200), verified: true, sourceUrl: decree.sourceUrl });
  } else if (rule.per && area) {
    required = roundParking(area / rule.per);
    requirement = `${rule.label}: 시설면적 ${rule.per}㎡당 1대 → ${fmt(area)}㎡ ÷ ${rule.per} = ${required}대 이상`;
    notes.push(`${PARKING_TABLE_LABEL}을 사용했습니다. 별표 개정 여부를 원문으로 확인하세요.`);
    if (decree) citations.push({ id: decree.id, label: PARKING_TABLE_LABEL, quote: `${rule.label}: 시설면적 ${rule.per}제곱미터당 1대`, verified: false, sourceUrl: decree.sourceUrl });
  } else if (rule.note) {
    requirement = `${rule.label}: ${rule.note}`;
    citations.push(...cites(["주택건설기준등에관한규정#27"]).slice(0, /공동|아파트/.test(use) ? 1 : 0));
  }
  if (!num(v, "시설면적") && area && rule.per) notes.push("시설면적 대신 연면적으로 산정했습니다(주차장 면적 제외 여부 확인).");
  if (statedMin !== undefined) {
    notes.push(`도면에 법정(최소) 주차대수 ${fmt(statedMin)}대가 표기되어 있습니다.`);
    if (required === undefined || statedMin > required) { required = statedMin; requirement = requirement ? `${requirement} · 도면 표기 법정 대수 ${fmt(statedMin)}대` : `도면 표기 법정 주차대수 ${fmt(statedMin)}대 이상`; }
  }
  if (!use) notes.push("주용도를 판독하지 못했습니다.");
  const status: CheckStatus = provided === undefined || required === undefined ? "UNCLEAR" : provided >= required ? "PASS" : "FAIL";
  return base(check, {
    requirement: requirement || check.requirement, code_confidence: confidence,
    threshold: required !== undefined ? { op: ">=", value: required, unit: "대" } : undefined,
    provided: provided !== undefined ? { value: provided, unit: "대", text: `계획 주차대수 ${fmt(provided)}대` } : undefined,
    status, citations, notes, tier: 1,
  });
}

/** Evaluate every check against national law. Pure except for the optional live 별표 call. */
export async function nationalCompliance(checks: CheckItem[], v: ProjectValues, findings: SheetFinding[]): Promise<ComplianceItem[]> {
  const out: ComplianceItem[] = [];
  for (const check of checks) {
    switch (check.kind) {
      case "presence": {
        const s = sheetStatus(findings, check.id);
        out.push(base(check, { status: s.status, provided: undefined, notes: [s.obs] }));
        break;
      }
      case "bcr": out.push(limitCheck(check, v, "국토의계획및이용에관한법률시행령#84", ratio(v, "건축면적", "건폐율"), "건폐율_도면기준")); break;
      case "far": out.push(limitCheck(check, v, "국토의계획및이용에관한법률시행령#85", ratio(v, "용적률산정용연면적", "용적률"), "용적률_도면기준")); break;
      case "daylight": {
        const zone = str(v, "용도지역");
        if (zone && !isResidentialForDaylight(zone)) { out.push(base(check, { status: "NOT_APPLICABLE", notes: [`${zone}은 전용·일반주거지역이 아니어서 정북방향 일조 제한 대상이 아닙니다.`] })); break; }
        const art = chunk("건축법시행령#86")!;
        const rule = daylightRule(art.text);
        const h = num(v, "높이"), low = num(v, "정북이격_10m이하"), high = num(v, "정북이격_10m초과");
        if (!rule) { out.push(base(check, { notes: ["시행령 제86조 기준 문구를 해석하지 못했습니다."] })); break; }
        out.push(evaluateDaylight(check, rule, { h, low, high, zone }, [cite(art, rule.lowLine), cite(art, rule.highLine), ...cites(["건축법#61"])], 1));
        break;
      }
      case "road": {
        const front = num(v, "접도길이"), width = num(v, "전면도로폭"), gfa = num(v, "연면적");
        const factory = /공장/.test(str(v, "주용도"));
        const big = gfa !== undefined && gfa >= (factory ? 3000 : 2000);
        const art44 = chunk("건축법#44")!, art28 = chunk("건축법시행령#28")!;
        const needFront = big ? 4 : 2;
        const notes: string[] = [];
        let status: CheckStatus = front === undefined ? "UNCLEAR" : front >= needFront ? "PASS" : "FAIL";
        if (big) {
          if (width === undefined) { notes.push("전면도로 너비를 판독하지 못했습니다."); if (status === "PASS") status = "UNCLEAR"; }
          else if (width < 6) { status = "FAIL"; notes.push(`연면적 ${fmt(gfa!)}㎡로 너비 6m 이상 도로 요건 대상이나 도로 너비 ${fmt(width)}m입니다.`); }
        }
        const line28 = art28.text.split("\n").find(l => /6미터/.test(l)) || "";
        out.push(base(check, {
          requirement: big ? `연면적 ${fmt(gfa!)}㎡ → 너비 6m 이상 도로에 4m 이상 접도` : "2m 이상 도로에 접도",
          threshold: { op: ">=", value: needFront, unit: "m" },
          provided: front !== undefined ? { value: front, unit: "m", text: `접도길이 ${fmt(front)}m${width ? `, 전면도로 ${fmt(width)}m` : ""}` } : undefined,
          status, notes, tier: 1,
          citations: [cite(art44, art44.text.split("\n")[0]), ...(big ? [cite(art28, line28)] : [])],
        }));
        break;
      }
      case "landscape": {
        const site = num(v, "대지면적");
        const zone = str(v, "용도지역");
        const art42 = chunk("건축법#42")!, art27 = chunk("건축법시행령#27")!;
        if (site !== undefined && site < 200) { out.push(base(check, { status: "NOT_APPLICABLE", notes: ["대지면적 200㎡ 미만으로 조경 의무 대상이 아닙니다."], citations: [cite(art42, art42.text.split("\n")[0])] })); break; }
        if (/녹지지역/.test(zone)) { out.push(base(check, { status: "NOT_APPLICABLE", notes: ["녹지지역 건축물은 조경 조치를 하지 않을 수 있습니다."], citations: [cite(art27, art27.text.split("\n").find(l => /녹지지역/.test(l)) || "")] })); break; }
        const provided = num(v, "조경면적");
        out.push(base(check, {
          requirement: "면적 200㎡ 이상 대지 — 조경 비율은 해당 지방자치단체 건축조례로 정함",
          provided: provided !== undefined ? { value: provided, unit: "㎡", text: `조경면적 ${fmt(provided)}㎡` } : undefined,
          status: "UNCLEAR", notes: ["국가 법령은 조례에 위임 — 조례 기준(3B)으로 판정합니다."], tier: 1,
          citations: [cite(art42, art42.text.split("\n")[0])],
        }));
        break;
      }
      case "parking": out.push(await parkingCheck(check, v)); break;
      case "height": {
        if (flag(v, "지구단위계획")) out.push(base(check, { status: "UNCLEAR", reviewer: "지구단위계획(또는 택지지구) 결정도서의 최고높이·층수 기준과 입면도 최고높이를 대조하세요.", notes: ["지구단위계획 기준은 코퍼스에 없어 자동 판정하지 않습니다."] }));
        else out.push(base(check, { status: "NOT_APPLICABLE", notes: ["국가 법령상 일률적인 층수·높이 상한은 없습니다. 가로구역별 최고높이·고도지구 지정 여부는 토지이용계획확인서로 확인하세요."] }));
        break;
      }
      case "open-space": out.push(base(check, { status: "UNCLEAR", reviewer: "건축선·인접 대지경계선으로부터의 이격거리를 시행령 별표 2 및 건축조례 기준과 대조하세요.", notes: ["배치도 이격 치수 판독은 신뢰도가 낮아 검토자 확인으로 남깁니다."] })); break;
      case "structural": {
        const floors = num(v, "지상층수"), gfa = num(v, "연면적");
        const applies = (floors !== undefined && floors >= 2) || (gfa !== undefined && gfa >= 200);
        if (!applies && floors !== undefined && gfa !== undefined) out.push(base(check, { status: "NOT_APPLICABLE", notes: ["1층·연면적 200㎡ 미만으로 판독되었습니다(높이·용도 요건은 별도 확인)."] }));
        else out.push(base(check, { status: "UNCLEAR", reviewer: "구조 안전 확인 대상입니다. 구조도서·구조안전확인서(구조기술사 날인 여부)를 확인하세요.", notes: [floors !== undefined ? `지상 ${floors}층` : "", gfa !== undefined ? `연면적 ${fmt(gfa)}㎡` : ""].filter(Boolean) }));
        break;
      }
    }
  }
  return out;
}

export function evaluateDaylight(check: CheckItem, rule: { low: number; ratio: number }, d: { h?: number; low?: number; high?: number; zone: string }, citations: Citation[], tier: 1 | 2 | 3): ComplianceItem {
  const notes: string[] = [];
  let status: CheckStatus = "UNCLEAR";
  const reqHigh = d.h !== undefined ? round2(d.h * rule.ratio) : undefined;
  if (d.low !== undefined && d.low < rule.low) { status = "FAIL"; notes.push(`높이 10m 이하 부분 이격 ${fmt(d.low)}m < ${rule.low}m`); }
  if (d.h !== undefined && d.h > 10) {
    if (d.high === undefined) notes.push("10m 초과 부분 이격거리를 판독하지 못했습니다.");
    else if (d.high + 1e-9 < reqHigh!) { status = "FAIL"; notes.push(`10m 초과 부분 이격 ${fmt(d.high)}m < 최고높이 ${fmt(d.h)}m × ${rule.ratio} = ${fmt(reqHigh!)}m`); }
    else if (status !== "FAIL" && d.low !== undefined) status = "PASS";
  } else if (d.h !== undefined && d.low !== undefined && status !== "FAIL") status = "PASS";
  return {
    check_id: check.id, title: check.title,
    requirement: `정북방향 인접 대지경계선으로부터 10m 이하 부분 ${rule.low}m 이상, 10m 초과 부분 높이의 ${rule.ratio === 0.5 ? "1/2" : rule.ratio} 이상`,
    threshold: reqHigh !== undefined && d.h! > 10 ? { op: ">=", value: reqHigh, unit: "m" } : { op: ">=", value: rule.low, unit: "m" },
    provided: d.high !== undefined || d.low !== undefined ? { value: d.high ?? d.low!, unit: "m", text: `10m 이하 ${d.low !== undefined ? fmt(d.low) + "m" : "?"} / 10m 초과 ${d.high !== undefined ? fmt(d.high) + "m" : "?"} (최고높이 ${d.h !== undefined ? fmt(d.h) + "m" : "?"})` } : undefined,
    status, code_confidence: check.code_confidence, citations, tier, notes,
  };
}
