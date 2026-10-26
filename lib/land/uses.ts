// 건축물 용도(「건축법 시행령」 별표 1) and the use lists that permit or forbid them.
//
// Every zoning text in Korea names uses the same way —
//   "「건축법 시행령」 별표 1 제4호의 제2종 근린생활시설(단란주점 및 안마시술소는 제외한다)"
//   "… 제7호의 판매시설 중 같은 호 나목 및 다목에 해당하는 것으로서 … 바닥면적의 합계가 2천제곱미터 미만인 것"
// — in 국토계획법 시행령 별표 2~23, in 도시·군계획조례 (경관지구 등), and in 지구단위계획.
// So one parser reads all of them, and one matcher decides whether a project's 주용도 is
// in a list fully, only partly (조건부), or not at all.
import { koNumber, squash } from "../review/skills/parse.ts";

/** 「건축법 시행령」 별표 1 — 29 categories (제23호의2 국방·군사시설). */
export const USE_CATEGORIES: { no: string; name: string; alias: RegExp }[] = [
  { no: "1", name: "단독주택", alias: /단독주택|다중주택|다가구|공관/ },
  { no: "2", name: "공동주택", alias: /공동주택|아파트|연립주택|다세대|기숙사|도시형생활주택/ },
  { no: "3", name: "제1종 근린생활시설", alias: /제1종근린생활|1종근생|1종근린/ },
  { no: "4", name: "제2종 근린생활시설", alias: /제2종근린생활|2종근생|2종근린/ },
  { no: "5", name: "문화 및 집회시설", alias: /문화및집회|공연장|집회장|관람장|전시장|박물관|미술관|동ㆍ?식물원/ },
  { no: "6", name: "종교시설", alias: /종교시설|교회|성당|사찰|봉안당/ },
  { no: "7", name: "판매시설", alias: /판매시설|도매시장|소매시장|백화점|대형마트|쇼핑센터/ },
  { no: "8", name: "운수시설", alias: /운수시설|터미널|철도역|공항시설|항만시설/ },
  { no: "9", name: "의료시설", alias: /의료시설|병원|격리병원/ },
  { no: "10", name: "교육연구시설", alias: /교육연구|학교|초등학교|중학교|고등학교|대학|교육원|연구소|도서관/ },
  { no: "11", name: "노유자시설", alias: /노유자|어린이집|노인복지|아동복지/ },
  { no: "12", name: "수련시설", alias: /수련시설|유스호스텔|청소년수련/ },
  { no: "13", name: "운동시설", alias: /운동시설|체육관|운동장|골프/ },
  { no: "14", name: "업무시설", alias: /업무시설|오피스텔|공공업무|일반업무|금융업소/ },
  { no: "15", name: "숙박시설", alias: /숙박시설|호텔|모텔|여관|생활숙박/ },
  { no: "16", name: "위락시설", alias: /위락시설|유흥주점|카지노|무도장/ },
  { no: "17", name: "공장", alias: /^공장|공장$|제조시설/ },
  { no: "18", name: "창고시설", alias: /창고|물류센터|하역장/ },
  { no: "19", name: "위험물 저장 및 처리 시설", alias: /위험물|주유소|충전소|석유판매/ },
  { no: "20", name: "자동차 관련 시설", alias: /자동차관련|주차장|세차장|정비공장|차고/ },
  { no: "21", name: "동물 및 식물 관련 시설", alias: /동물및식물|축사|도축장|온실|작물재배/ },
  { no: "22", name: "자원순환 관련 시설", alias: /자원순환|폐기물|고물상/ },
  { no: "23", name: "교정시설", alias: /교정시설|교도소|구치소/ },
  { no: "23의2", name: "국방ㆍ군사시설", alias: /국방|군사시설/ },
  { no: "24", name: "방송통신시설", alias: /방송통신|방송국|전신전화|데이터센터/ },
  { no: "25", name: "발전시설", alias: /발전시설|발전소/ },
  { no: "26", name: "묘지 관련 시설", alias: /묘지|화장시설|봉안시설/ },
  { no: "27", name: "관광 휴게시설", alias: /관광휴게|야외음악당|휴게소/ },
  { no: "28", name: "장례시설", alias: /장례/ },
  { no: "29", name: "야영장 시설", alias: /야영장/ },
];

export type UseOf = { no?: string; name?: string; text: string; area?: number; floors?: number };

/** "제2종 근린생활시설(사무소)", "공동주택(아파트)" → category + the full text for sub-use matching. */
export function useOf(text: string, extra: { area?: number; floors?: number } = {}): UseOf {
  const t = squash(text || "");
  if (!t) return { text: "", ...extra };
  // An explicit category name wins (longest first: 제2종 근린생활시설 before 근린생활시설).
  const byName = USE_CATEGORIES.slice().sort((a, b) => b.name.length - a.name.length).find(c => t.includes(squash(c.name)));
  const hit = byName || USE_CATEGORIES.find(c => c.alias.test(t));
  return { no: hit?.no, name: hit?.name, text: t, ...extra };
}

// ───────────────────────────── use-list items ─────────────────────────────

export type UseRef = {
  no: string;
  /** "가" when the text names a 목 (제2호가목의 아파트). */
  mok?: string;
  name: string;
  /** Text after "중" — only these parts of the category qualify. */
  only?: string;
  exclude: string[];
  /** Excluded only under conditions the text states (e.g. 생활숙박시설로서 …). */
  excludeIf?: string[];
  areaLimit?: { value: number; strict: boolean };
  /** "…합계가 1천제곱미터를 초과하는 것": only uses larger than this. */
  areaMin?: { value: number; strict: boolean };
  floorsLimit?: number;
  /** The item carries a "다만, …" proviso (exceptions the text spells out). */
  proviso?: boolean;
};
export type UseItem = { part: 1 | 2; label: string; text: string; refs: UseRef[] };
export type UseTable = { mode: "allow" | "deny"; items: UseItem[]; headers: { part: 1 | 2; text: string }[] };

/** Put each "1." / "가." / "1)" item on its own line (API text sometimes arrives flattened). */
export function unflatten(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+(?=(?:[1-9]\d?\.|[가-하]\.|\d{1,2}\))\s)/g, "\n")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
}

const WORDS = (s: string) => s.split(/\s*(?:[,ㆍ·및]|와|과|또는|그밖에|그 밖에)\s*/).map(x => squash(x).replace(/(시설|업|소|점)$/, m => m)).filter(x => x.length >= 2);

/** Read the use references out of one item line. */
export function parseRefs(line: string): UseRef[] {
  const out: UseRef[] = [];
  const re = /제(\d+)호(?:의(\d+))?(?:\s*([가-하])목)?(?:의|에\s*따른)\s*/g;
  const hits = [...line.matchAll(re)];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const start = h.index! + h[0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index! : line.length;
    let seg = line.slice(start, end);
    // A later "제N호의" that only continues a sentence about the same category is rare; segments are independent.
    const no = h[1] + (h[2] ? `의${h[2]}` : "");
    const nameM = seg.match(/^([^(,.중「」]+?)(?=\s*(?:중\s|\(|,|\.|으로서|로서|에\s*해당|및\s*같은|$))/);
    const name = (nameM ? nameM[1] : seg.split(/[ (]/)[0]).replace(/\s*(?:및|와|과)$/, "").trim();
    seg = seg.slice(name.length);
    const exclude: string[] = [];
    const excludeIf: string[] = [];
    for (const m of seg.matchAll(/\(([^()]*?)(?:은|는|을|를)?\s*제외(?:한다|하며|하고|한)?[^)]*\)/g)) {
      const body = m[1].replace(/\s*(?:은|는)$/, "");
      // "(생활숙박시설로서 … 건축하는 것은 제외한다)": only conditionally excluded.
      const head = body.split(/으로서|로서|인\s*경우|의\s*경우|중\s/)[0];
      (head.length < body.length ? excludeIf : exclude).push(...WORDS(head));
    }
    const onlyM = seg.match(/^\s*중\s*(.+?)(?=\s*(?:으로서|로서|에\s*해당하는|\(|$))/);
    // "(축사ㆍ가축시설ㆍ도축장ㆍ도계장에 한정한다)" narrows the category like "중 …" does.
    const limitM = seg.match(/^\s*\(([^()]+?)(?:에|으로|로)\s*한정(?:한다|하며|하고|된다)?[^)]*\)/) || seg.match(/^\s*\(([^()]+?)만\s*해당(?:한다)?\)/);
    const area = seg.match(/(?:바닥면적|연면적)(?:의)?\s*합계가\s*([\d,]+만?[\d,]*천?[\d,]*)\s*제곱미터\s*(?:를|을)?\s*(미만|이하|초과|이상)/);
    const below = area && /미만|이하/.test(area[2]);
    const floors = seg.match(/(\d+)\s*층\s*이하/);
    out.push({
      no, mok: h[3], name: name || "",
      only: onlyM ? onlyM[1].replace(/같은\s*호\s*/, "").trim() : limitM ? limitM[1].trim() : undefined,
      exclude, excludeIf: excludeIf.length ? excludeIf : undefined,
      areaLimit: area && below ? { value: koNumber(area[1]), strict: area[2] === "미만" } : undefined,
      areaMin: area && !below ? { value: koNumber(area[1]), strict: area[2] === "초과" } : undefined,
      floorsLimit: floors ? Number(floors[1]) : undefined,
      proviso: /다만\s*[,，]/.test(seg) || undefined,
    });
  }
  return out;
}

/** Parse a 별표 / 조례 use list. `mode` comes from the citing article (제71조①: 있는/없는). */
export function parseUseTable(text: string, mode: "allow" | "deny"): UseTable {
  const lines = unflatten(text).split("\n");
  const items: UseItem[] = [];
  const headers: UseTable["headers"] = [];
  let part: 1 | 2 | 0 = 0;
  let cur: UseItem | null = null;
  for (const l of lines) {
    const top = l.match(/^([12])\.\s*(.*)$/);
    if (top && /건축할\s*수|건축물/.test(top[2])) {
      // "1." = what the statute itself decides, "2." = what it delegates to the 도시·군계획조례.
      part = Number(top[1]) as 1 | 2;
      headers.push({ part, text: top[2] });
      cur = null;
      continue;
    }
    if (!part) continue;
    const it = l.match(/^([가-하])\.\s*(.*)$/);
    if (it) {
      cur = { part, label: it[1], text: it[2], refs: parseRefs(it[2]) };
      items.push(cur);
    } else if (cur && /^(\d{1,2}\)|\(\d+\))/.test(l)) {
      // Sub-items refine the lettered item (e.g. 1) … 2) …) — keep the text for conditions.
      cur.text += " " + l;
      const more = parseRefs(l);
      if (more.length && !cur.refs.length) cur.refs = more;
    } else if (cur) cur.text += " " + l;
  }
  return { mode, items, headers };
}

/** Ordinance articles list forbidden uses as numbered lines ("1. 「건축법 시행령」 별표 1 제4호의 …"). */
export function parseNumberedUseList(text: string): UseItem[] {
  const out: UseItem[] = [];
  const para1 = text.split(/\n\s*②/)[0];
  for (const l of unflatten(para1).split("\n")) {
    const m = l.match(/^(\d{1,2})\.\s*(.*)$/);
    if (!m || !/별표\s*1/.test(m[2])) continue;
    out.push({ part: 1, label: m[1], text: m[2], refs: parseRefs(m[2]) });
  }
  return out;
}

export type Match = "full" | "partial" | "none";

/** Does the project's use fall within this reference? */
export function matchRef(u: UseOf, r: UseRef): { match: Match; why: string } {
  if (!u.no || u.no !== r.no) return { match: "none", why: "" };
  const t = u.text;
  if (r.exclude.some(x => x && t.includes(x))) return { match: "none", why: `${r.exclude.join("·")} 제외` };
  const reasons: string[] = [];
  let partial = false;
  const condEx = r.excludeIf?.find(x => x && t.includes(x));
  if (condEx) { partial = true; reasons.push(`${condEx}은(는) 조건에 따라 제외`); }
  if (r.only && /해당하지\s*아니하는|제외한\s*것/.test(r.only)) {
    // "중 제1호마목에 해당하지 아니하는 것" — the rest of the category; part-1 matches are found separately.
  } else if (r.only) {
    const words = WORDS(r.only.replace(/(?:에\s*해당하는\s*것|해당하는\s*것|인\s*것)$/, "")).filter(w => !/^(같은|목|해당)/.test(w));
    const mokOnly = /^[가-하]목/.test(r.only);
    const hit = words.some(w => t.includes(w));
    // A project that names its sub-use ("제2종 근린생활시설(사무소)") is outside an "중 단란주점" item;
    // one that names only the category cannot be decided.
    const specific = t.replace(squash(u.name || ""), "").length >= 2;
    if (!hit && specific && !mokOnly) return { match: "none", why: `${r.name} 중 ${r.only}에 해당하지 않음` };
    if (!hit) { partial = true; reasons.push(`${r.name} 중 ${r.only}만 해당`); }
  }
  if (r.mok) {
    // "제2호가목의 아파트": the 목 name must appear in the project's use.
    if (!t.includes(squash(r.name))) return { match: "none", why: "" };
  }
  if (r.areaLimit) {
    if (u.area === undefined) { partial = true; reasons.push(`바닥면적 ${r.areaLimit.value.toLocaleString()}㎡ ${r.areaLimit.strict ? "미만" : "이하"} 조건`); }
    else if (r.areaLimit.strict ? u.area >= r.areaLimit.value : u.area > r.areaLimit.value) return { match: "none", why: `바닥면적 ${u.area.toLocaleString()}㎡가 ${r.areaLimit.value.toLocaleString()}㎡ ${r.areaLimit.strict ? "미만" : "이하"} 조건을 넘음` };
  }
  if (r.areaMin) {
    const { value, strict } = r.areaMin;
    if (u.area === undefined) { partial = true; reasons.push(`면적 ${value.toLocaleString()}㎡ ${strict ? "초과" : "이상"}인 것만 해당`); }
    else if (strict ? u.area <= value : u.area < value) return { match: "none", why: `면적 ${u.area.toLocaleString()}㎡ — ${value.toLocaleString()}㎡ ${strict ? "초과" : "이상"}인 것만 해당` };
  }
  if (r.floorsLimit) {
    if (u.floors === undefined) { partial = true; reasons.push(`${r.floorsLimit}층 이하 조건`); }
    else if (u.floors > r.floorsLimit) return { match: "none", why: `${u.floors}층 > ${r.floorsLimit}층 이하 조건` };
  }
  if (r.proviso) { partial = true; reasons.push("단서(다만) 예외 있음"); }
  return { match: partial ? "partial" : "full", why: reasons.join(", ") };
}

export function matchItem(u: UseOf, it: UseItem): { match: Match; why: string } {
  let best: { match: Match; why: string } = { match: "none", why: "" };
  for (const r of it.refs) {
    const m = matchRef(u, r);
    if (m.match === "full") return m;
    if (m.match === "partial" && best.match === "none") best = m;
  }
  return best;
}
