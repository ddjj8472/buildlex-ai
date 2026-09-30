// Korean-aware tokenizer for BM25 without a morphological analyzer.
// Two token families are produced:
//   w:<stem>   word stems with trailing particles/endings removed
//   b:<xy>     character bigrams inside each Hangul word (spacing-robust)
// Bigrams make "대지안의공지" and "대지 안의 공지" match; stems keep
// precision for exact legal terms.

const PARTICLES = [
  "으로부터", "에서부터", "으로서는", "으로써", "으로서", "에서는", "에게서", "이라도", "이거나", "이라는",
  "에서", "에게", "까지", "부터", "보다", "처럼", "마다", "이나", "이며", "이고", "으로", "라도", "하고",
  "에는", "에도", "로는", "로서", "로써", "과는", "와는", "이란", "라는", "인지", "인가", "한가", "은지", "는지",
  "하는", "하여", "해야", "하면", "되는", "되나요", "하나요", "인가요", "되면", "할때", "할",
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "만", "요",
];

const STOP = new Set([
  "경우", "관련", "대한", "대해", "어떻게", "무엇", "알려", "알려줘", "궁금", "궁금합니다", "있나요", "없나요",
  "되나요", "하나요", "인가요", "가능", "여부", "해당", "그", "이", "저", "것", "수", "등", "및", "또는",
  "때", "제", "조", "항", "호", "목", "우리", "지금", "혹시", "좀", "어떤", "있는", "없는", "하는", "되는",
]);

export function normalize(text: string): string {
  return text
    .replace(/[ㆍ·‧•・ᆞ]/g, " ")
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*|\\\./g, " ")
    .replace(/[┌┐└┘├┤┬┴┼─│]/g, " ")
    .toLowerCase();
}

export function stem(word: string): string {
  for (const p of PARTICLES) {
    if (word.length - p.length >= 2 && word.endsWith(p)) return word.slice(0, -p.length);
  }
  return word;
}

export function words(text: string): string[] {
  return normalize(text)
    .replace(/[^0-9a-z가-힣㎡%]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of words(text)) {
    const w = stem(raw);
    if (!STOP.has(w) && !STOP.has(raw) && (w.length >= 2 || /\d/.test(w))) out.push("w:" + w);
    if (/[가-힣]/.test(raw)) {
      const h = w.replace(/[^가-힣]/g, "");
      for (let i = 0; i + 1 < h.length; i++) out.push("b:" + h.slice(i, i + 2));
    }
  }
  return out;
}

/** Compact form used for substring checks ("대지 안의 공지" -> "대지안의공지"). */
export function compact(text: string): string {
  return normalize(text).replace(/[^0-9a-z가-힣]/g, "");
}
