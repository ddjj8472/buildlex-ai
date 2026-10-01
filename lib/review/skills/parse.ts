// Deterministic parsers that pull numeric standards out of article text.
// Each returns the exact line used, so the quote can be shown and verified.

export const squash = (s: string) => s.normalize("NFKC").replace(/[\sㆍ·ᆞ‧]/g, "");

/** "1천500" → 1500, "2천" → 2000, "1,100" → 1100 */
export function koNumber(s: string): number {
  const t = s.replace(/,/g, "").replace(/\s/g, "");
  const m = t.match(/^(?:(\d+)만)?(?:(\d+)천)?(\d+)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return Number.NaN;
  return (Number(m[1] || 0) * 10000) + (Number(m[2] || 0) * 1000) + Number(m[3] || 0);
}
const KNUM = String.raw`(\d+만?\d*천?\d*(?:,\d{3})*(?:\.\d+)?)`;

/**
 * Zone table line: "4. 제2종일반주거지역 : 60퍼센트 이하" or
 * "4. 제2종 일반주거지역 : 100퍼센트 이상 250퍼센트 이하. 다만, …" → upper limit.
 */
export function zoneLimit(text: string, zone: string): { value: number; line: string } | null {
  const z = squash(zone);
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*\d+\.\s*([^:：]+?)\s*[:：]\s*(.+)$/);
    if (!m || squash(m[1]) !== z) continue;
    const body = m[2].split(/다만|\.\s/)[0];
    const lim = body.match(new RegExp(String.raw`${KNUM}\s*퍼센트\s*이하`)) || body.match(new RegExp(String.raw`${KNUM}\s*퍼센트`));
    if (lim) return { value: koNumber(lim[1]), line: raw.trim() };
  }
  return null;
}

/** 정북 일조: "높이 10미터 이하인 부분: … 1.5미터 이상", "10미터 초과 … 높이의 2분의 1 이상" */
export function daylightRule(text: string): { low: number; lowLine: string; ratio: number; highLine: string } | null {
  const lines = text.split("\n");
  const lowLine = lines.find(l => /10\s*미터\s*이하/.test(l) && /미터\s*이상/.test(l));
  const highLine = lines.find(l => /10\s*미터\s*(를\s*)?초과/.test(l) && /분의/.test(l));
  if (!lowLine || !highLine) return null;
  const low = lowLine.match(/(\d+(?:\.\d+)?)\s*미터\s*이상/);
  const ratio = highLine.match(/(\d+)\s*분의\s*(\d+)/);
  if (!low || !ratio) return null;
  return { low: Number(low[1]), lowLine: lowLine.trim(), ratio: Number(ratio[2]) / Number(ratio[1]), highLine: highLine.trim() };
}

export type LandscapeTier = { minGfa: number; maxGfa: number; percent: number; line: string };
/** "연면적 1천 제곱미터 이상 2천 제곱미터 미만인 건축물 : 대지면적의 10퍼센트 이상" */
export function landscapeTiers(text: string): LandscapeTier[] {
  const out: LandscapeTier[] = [];
  for (const raw of text.split("\n")) {
    if (!/연면적/.test(raw) || !/대지면적의\s*\d+\s*퍼센트/.test(raw)) continue;
    const pct = raw.match(/대지면적의\s*(\d+(?:\.\d+)?)\s*퍼센트/);
    const head = raw.split(/[:：]/)[0];
    const ge = head.match(new RegExp(String.raw`${KNUM}\s*제곱미터\s*이상`));
    const lt = head.match(new RegExp(String.raw`${KNUM}\s*제곱미터\s*미만`));
    out.push({ minGfa: ge ? koNumber(ge[1]) : 0, maxGfa: lt ? koNumber(lt[1]) : Infinity, percent: Number(pct![1]), line: raw.trim() });
  }
  return out;
}

/** "별표 24에 따른다" style delegation with no numbers of its own. */
export function delegatesToAppendix(text: string): string | null {
  const m = text.match(/별표\s*(\d+(?:의\d+)?)\s*(?:에\s*따른다|와\s*같다|과\s*같다|에서\s*정하는)/);
  return m ? `별표 ${m[1]}` : null;
}

/** Whitespace-insensitive "quote appears in source" check. */
export const quoteIn = (quote: string, source: string) => !!quote && squash(source).includes(squash(quote));
