// Deterministic reader for the PDF text layer: sheet number/title and the
// 건축개요 values. It is the fallback when the vision model is unavailable and
// a cross-check when it is not. Every value keeps the exact text it came from.
import type { FieldKey, FieldValue, ProjectValues, SheetEntry, SheetType } from "../types.ts";

/** "건 축 개 요" → "건축개요" (title-block letter spacing), keep other spacing. */
export function normalizeLine(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/(?<![가-힣])[가-힣](?: [가-힣](?![가-힣]))+/g, m => m.replace(/ /g, ""))
    .replace(/m²|m2(?![0-9])/g, "㎡")
    .replace(/[ \t]+/g, " ");
}

export const toNumber = (s: string) => Number(s.replace(/,/g, ""));
const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;

export const ZONE_RE = /(제\s*[123]\s*종\s*(?:전용|일반)\s*주거\s*지역|준\s*주거\s*지역|(?:중심|일반|근린|유통)\s*상업\s*지역|(?:전용|일반|준)\s*공업\s*지역|(?:보전|생산|자연)\s*녹지\s*지역|(?:보전|생산|계획)\s*관리\s*지역|농림\s*지역|자연환경\s*보전\s*지역)/;
export const normZone = (z: string) => z.replace(/\s+/g, "");

type Rule = { key: FieldKey; re: RegExp; unit?: string; pick?: (m: RegExpMatchArray, line: string) => number | string | boolean | null; when?: RegExp };

const RULES: Rule[] = [
  { key: "대지위치", re: /대지\s*위치\s*\|?\s*([^|\n]{4,60})/, pick: m => m[1].trim() },
  { key: "용도지역", re: ZONE_RE, pick: m => normZone(m[1]), when: /지역|지구|용도/ },
  { key: "용도지구", re: /((?:자연|시가지|특화)?경관|고도|방화|방재|역사문화환경보호|중요시설물보호|취락|개발진흥|특정용도제한|복합용도)지구/, pick: m => m[0] },
  { key: "지구단위계획", re: /지구단위계획|택지개발(?:예정)?지구|공공택지|택지지구/, pick: () => true },
  { key: "주용도", re: /(?:주\s*용도|^용\s*\|?\s*도)\s*\|?\s*([^|\n]*(?:시설|주택|아파트|오피스텔|업무|판매|공장|창고)[^|\n]*)/, pick: m => m[1].trim() },
  { key: "대지면적", re: new RegExp(String.raw`대지면적[^\d\n]{0,12}?${NUM}`), unit: "㎡" },
  { key: "건축면적", re: new RegExp(String.raw`건축면적[^\d\n]{0,12}?${NUM}`), unit: "㎡" },
  { key: "용적률산정용연면적", re: new RegExp(String.raw`용적률\s*산정용\s*연면적[^\d\n]{0,12}?${NUM}`), unit: "㎡" },
  { key: "연면적", re: new RegExp(String.raw`(?<!산정용\s?)(?<!지하)(?<!지상)연면적(?!:)[^\d\n]{0,12}?${NUM}`), unit: "㎡" },
  { key: "건폐율", re: new RegExp(String.raw`건폐율[^\d\n]{0,12}?${NUM}`), unit: "%" },
  { key: "건폐율_도면기준", re: new RegExp(String.raw`건폐율[^\n]*?${NUM}\s*%?[^\n]*?${NUM}\s*%\s*이하`), unit: "%", pick: m => toNumber(m[2]) },
  { key: "용적률", re: new RegExp(String.raw`용적률(?!\s*산정)[^\d\n]{0,12}?${NUM}`), unit: "%" },
  { key: "용적률_도면기준", re: new RegExp(String.raw`용적률(?!\s*산정)[^\n]*?${NUM}\s*%?[^\n]*?${NUM}\s*%\s*이하`), unit: "%", pick: m => toNumber(m[2]) },
  { key: "지상층수", re: /지상\s*(\d{1,3})\s*층/, unit: "층" },
  { key: "지하층수", re: /지하\s*(\d{1,2})\s*층/, unit: "층" },
  { key: "높이", re: new RegExp(String.raw`최고\s*높이[^\d\n]{0,8}?${NUM}\s*m(?!²)`), unit: "m" },
  { key: "정북이격_10m이하", re: new RegExp(String.raw`10\s*m\s*이하\s*(?:부분)?\)?\s*(?:정북\s*)?(?:이격\s*)?${NUM}\s*m`), unit: "m", when: /정북|이격/ },
  { key: "정북이격_10m초과", re: new RegExp(String.raw`10\s*m\s*초과\s*(?:부분)?\s*(?:정북\s*)?(?:이격\s*)?${NUM}\s*m`), unit: "m", when: /정북|이격/ },
  { key: "주차대수", re: /주차\s*대수[^\d\n]{0,10}?(\d[\d,]*)\s*대/, unit: "대" },
  { key: "주차대수", re: /자주식\s*(\d[\d,]*)\s*대/, unit: "대" },
  { key: "법정주차대수_도면", re: /법정\s*(?:주차)?\s*(?:대수)?\s*[:|]?\s*(\d[\d,]*)\s*대/, unit: "대" },
  { key: "시설면적", re: new RegExp(String.raw`시설\s*면적[^\d\n]{0,8}?${NUM}`), unit: "㎡" },
  { key: "조경면적", re: new RegExp(String.raw`조경\s*면적[^\d\n]{0,10}?${NUM}`), unit: "㎡" },
  { key: "접도길이", re: new RegExp(String.raw`접도\s*(?:길이)?[^\d\n]{0,6}?${NUM}\s*m`), unit: "m" },
  { key: "전면도로폭", re: new RegExp(String.raw`${NUM}\s*m\s*도로`), unit: "m" },
  { key: "구조", re: /(철근\s*콘크리트|철골\s*철근\s*콘크리트|철골|경량\s*철골|목)\s*조/, pick: m => m[0].replace(/\s/g, "") },
];

/** Read 건축개요 values from one page. First hit per key wins (tables list the subject block first). */
export function readValues(text: string, at: { page: number; sheet_id?: string }): ProjectValues {
  const out: ProjectValues = {};
  const lines = text.split("\n").map(normalizeLine);
  for (const rule of RULES) {
    if (out[rule.key]) continue;
    for (const line of lines) {
      if (rule.when && !rule.when.test(line)) continue;
      const m = line.match(rule.re);
      if (!m) continue;
      const v = rule.pick ? rule.pick(m, line) : toNumber(m[1]);
      if (v === null || v === "" || (typeof v === "number" && !Number.isFinite(v))) continue;
      const fv: FieldValue = { value: v, unit: rule.unit, raw: line.slice(0, 160), page: at.page, sheet_id: at.sheet_id, source: "text", confidence: /\|/.test(line) ? "HIGH" : "MEDIUM" };
      out[rule.key] = fv;
      break;
    }
  }
  // Stated minimum parking ("1,015대 이상") — the largest stated minimum is the binding one.
  const mins = [...text.normalize("NFKC").matchAll(/(\d[\d,]*)\s*대\s*이상/g)].map(m => toNumber(m[1]));
  if (!out.법정주차대수_도면 && mins.length) out.법정주차대수_도면 = { value: Math.max(...mins), unit: "대", raw: `도면 표기 최소 대수 ${mins.join(", ")}대 이상`, page: at.page, sheet_id: at.sheet_id, source: "text", confidence: "MEDIUM" };
  // Architect stamp: name present vs template placeholder.
  const flat = lines.join(" ");
  if (/건축사/.test(flat)) {
    const placeholder = /ARCHITECT NAME/i.test(flat) && !/건축사사무소/.test(flat);
    out.건축사날인 = { value: placeholder ? "건축사명 칸 템플릿 문구만 확인" : /\(인\)|날인/.test(flat) ? "건축사 표기 및 (인) 칸 확인" : "건축사 표기 확인", raw: flat.match(/[^|]{0,30}건축사[^|]{0,30}/)?.[0]?.trim(), page: at.page, sheet_id: at.sheet_id, source: "text", confidence: "MEDIUM" };
  }
  return out;
}

const TYPE_RULES: [SheetType, RegExp][] = [
  ["area", /면적\s*(표|산출|산정|개요)|층별\s*(면적|개요)|동별\s*(면적|개요)/],
  ["cover", /표지|건축\s*개요|설계\s*개요|대지\s*개요|도면\s*목록|위치도|토지이용계획/],
  ["site", /배치도|대지\s*종횡단|인동\s*거리|대지\s*현황/],
  ["landscape", /조경\s*(계획|배치|평면)/],
  ["parking", /주차\s*(계획|배치|평면)/],
  ["section", /단면도|사선도|일조/],
  ["elevation", /입면도/],
  ["floor", /평면도/],
  ["structural", /구조\s*(도|평면|일반|계산)|기초\s*(평면|상세)|골조/],
  ["mep", /기계|전기|소방|설비|위생|통신/],
];

export function classifySheet(title: string): SheetType {
  for (const [t, re] of TYPE_RULES) if (re.test(title)) return t;
  return "other";
}

const ID_RE = /\b([A-Z]{1,3}\d{0,2}-?\d{2,4}(?:-\d{1,3})?)\b/;

/** Sheet number and title from the title block text (bottom of the reading order). */
export function readSheetIdentity(text: string): { sheet_id?: string; title?: string } {
  const lines = text.split("\n").map(normalizeLine);
  let sheet_id: string | undefined;
  let title: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const idm = l.match(/도면\s*번호\s*\|?\s*(?:SHEET\s*NO\.?)?\s*\|?\s*([A-Z]{1,3}\d{0,2}-?\d{2,4}(?:-\d{1,3})?)?/i);
    if (idm) sheet_id = idm[1] || lines.slice(i + 1, i + 3).map(x => x.match(ID_RE)?.[1]).find(Boolean) || sheet_id;
    const tm = l.match(/도면\s*명\s*\|?\s*(?:SUBJECT\s*TITLE)?\s*\|?\s*(.*)$/i);
    if (tm) {
      const rest = tm[1].replace(/SUBJECT\s*TITLE/i, "").replace(/^\|\s*/, "").trim();
      title = rest || lines.slice(i + 1, i + 3).find(x => /[가-힣]{2}/.test(x) && !/도면번호|축척|일자/.test(x))?.trim() || title;
    }
  }
  if (!sheet_id) {
    const all = [...text.matchAll(new RegExp(ID_RE, "g"))].map(m => m[1]).filter(s => /-/.test(s));
    sheet_id = all.at(-1);
  }
  return { sheet_id, title: title?.replace(/\s*\|.*$/, "").trim() };
}

const KEYWORDS = ["건폐율", "용적률", "대지면적", "건축면적", "연면적", "주차", "조경", "정북", "일조", "접도", "도로", "최고높이", "건축개요", "대지개요", "설계개요", "면적표"];
export function pageKeywords(text: string): string[] {
  const n = text.split("\n").map(normalizeLine).join(" ");
  return KEYWORDS.filter(k => n.includes(k));
}

export function sheetFromText(page: number, text: string): SheetEntry {
  const { sheet_id, title } = readSheetIdentity(text);
  const t = title || "";
  let type = classifySheet(t);
  const kw = pageKeywords(text);
  if (type === "other" && kw.some(k => /건축개요|대지개요|설계개요/.test(k))) type = "cover";
  return {
    sheet_id: sheet_id || `p${page}`, title: t || `${page}쪽`, page, sheet_type: type,
    discipline: type === "structural" ? "구조" : type === "mep" ? "기계·전기·소방" : type === "landscape" ? "조경" : "건축",
    text_layer: text.trim().length > 20, keywords: kw, source: sheet_id || title ? "text" : "fallback",
  };
}
