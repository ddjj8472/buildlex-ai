// Explicit provision citations in a question ("「건축법」 제19조제7항", "같은 법 시행령 제32조제2항",
// "법률 제15721호 건축법 부칙 제2조"). Lexical retrieval dilutes on long, formal questions
// (법제처 질의요지 average ~700자): the provision the asker names can rank below
// provisions that merely share vocabulary. Citations are facts, not relevance guesses,
// so they are resolved deterministically and pinned into the evidence.
import { lawKeyOf } from "./text.ts";

export type Citation = {
  /** Corpus id, e.g. 건축법#19, 건축법시행령#3의2, 건축법#별표1, 건축법#부칙15721 */
  id: string;
  /** 항 numbers named with the article (제7항 → 7). */
  paras: number[];
  /** 호 numbers named with the article (제1호 → 1). */
  items: number[];
};

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
export const circled = (n: number) => CIRCLED[n - 1] || "";

/**
 * @param text question text
 * @param lawKeys law keys present in the corpus (e.g. 건축법, 건축법시행령)
 */
export function parseCitations(text: string, lawKeys: Set<string>): Citation[] {
  const out = new Map<string, Citation>();
  const add = (id: string, para?: string, item?: string) => {
    const c = out.get(id) || { id, paras: [], items: [] };
    if (para && !c.paras.includes(Number(para))) c.paras.push(Number(para));
    if (item && !c.items.includes(Number(item))) c.items.push(Number(item));
    out.set(id, c);
  };
  const known = (k: string | undefined) => (k && lawKeys.has(k) ? k : undefined);
  const withLevel = (base: string | undefined, level?: string) => {
    if (!base) return undefined;
    const root = base.replace(/(시행령|시행규칙)$/, "");
    return level === "시행령" || level === "영" ? root + "시행령" : level === "시행규칙" || level === "규칙" ? root + "시행규칙" : level === "법" ? root : base;
  };

  // 부칙 of a named amendment: "2018년 8월 14일 법률 제15721호로 일부개정된 「건축법」",
  // "구 「건축법」(2019. 4. 23. 법률 제16380호로 일부개정되어 …)", "법률 제15721호 건축법 부칙 제2조".
  // Only when the question is about 적용례·경과조치 (otherwise the number is just history).
  if (/부칙|경과\s*조치|적용례|시행\s*(?:전|이후|후)|시행되기\s*전|개정되기\s*전|종전의?\s*규정/.test(text)) {
    const NO = String.raw`(?:법률|대통령령|국토교통부령|국토해양부령|건설교통부령)\s*제\s*(\d{3,6})\s*호`;
    const pairs: [string, string][] = [];
    for (const m of text.matchAll(new RegExp(`${NO}[^「」\\n]{0,40}?「([^」]{2,40})」`, "g"))) pairs.push([m[2], m[1]]);
    for (const m of text.matchAll(new RegExp(`「([^」]{2,40})」\\s*\\([^)]{0,40}?${NO}`, "g"))) pairs.push([m[1], m[2]]);
    for (const m of text.matchAll(new RegExp(`${NO}\\s*([가-힣]+(?:\\s?[가-힣]+)?(?:법|시행령|시행규칙))\\s*(?:일부개정법률\\s*)?부칙`, "g"))) pairs.push([m[2], m[1]]);
    for (const [name, no] of pairs) {
      const law = known(lawKeyOf(name));
      if (law) add(`${law}#부칙${Number(no)}`);
    }
  }

  // Articles: 「법령」 제N조(의M)(제N항)(제N호) / 같은 법(시행령|시행규칙) 제N조 / 같은 영 제N조 / 법 제N조, 영 제N조
  const ART = String.raw`제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?`;
  const re = new RegExp(String.raw`「([^」]{2,60})」\s*(?:${ART}|별표\s*(\d+)(?:\s*의\s*(\d+))?)?|같은\s*(법|영|규칙)\s*(시행령|시행규칙)?\s*(?:${ART}|별표\s*(\d+)(?:\s*의\s*(\d+))?)|(?<![가-힣])(법|영)\s+${ART}`, "g");
  let last: string | undefined;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      const k = known(lawKeyOf(m[1]));
      if (k) last = k;
      if (k && m[2]) add(`${k}#${Number(m[2])}${m[3] ? `의${Number(m[3])}` : ""}`, m[4], m[5]);
      else if (k && m[6]) add(`${k}#별표${Number(m[6])}${m[7] ? `의${Number(m[7])}` : ""}`);
    } else if (m[8] !== undefined) {
      const k = known(withLevel(last, m[9] || (m[8] === "법" ? "법" : m[8])));
      if (k && m[10]) add(`${k}#${Number(m[10])}${m[11] ? `의${Number(m[11])}` : ""}`, m[12], m[13]);
      else if (k && m[14]) add(`${k}#별표${Number(m[14])}${m[15] ? `의${Number(m[15])}` : ""}`);
      if (k) last = k;
    } else if (m[16] !== undefined && last) {
      const k = known(withLevel(last, m[16]));
      if (k) add(`${k}#${Number(m[17])}${m[18] ? `의${Number(m[18])}` : ""}`, m[19], m[20]);
    }
  }
  // Unbracketed law names ("건축법 시행령 제86조제1항", "주차장법 제19조"), longest name first.
  for (const m of text.matchAll(plainNameRe(lawKeys))) {
    const k = known(lawKeyOf(m[1]));
    if (k) add(`${k}#${Number(m[2])}${m[3] ? `의${Number(m[3])}` : ""}`, m[4], m[5]);
  }
  return [...out.values()];
}

let plainCache: { size: number; re: RegExp } | null = null;
function plainNameRe(lawKeys: Set<string>): RegExp {
  if (plainCache && plainCache.size === lawKeys.size) return new RegExp(plainCache.re.source, "g");
  const alt = [...lawKeys].sort((a, b) => b.length - a.length).map(k => [...k].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(String.raw`\s?`)).join("|");
  const re = new RegExp(String.raw`(?<![가-힣「])(${alt})(?![가-힣」])\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?`, "g");
  plainCache = { size: lawKeys.size, re };
  return new RegExp(re.source, "g");
}

/** 「법령명」 mentioned in the text that the corpus does not carry (answers must not rely on them). */
export function missingLaws(text: string, lawKeys: Set<string>): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/「([^」]{2,60})」/g)) {
    const name = m[1].trim();
    if (!/(법|법률|령|규칙|규정)$/.test(name)) continue;
    if (!lawKeys.has(lawKeyOf(name))) names.add(name);
  }
  return [...names];
}
