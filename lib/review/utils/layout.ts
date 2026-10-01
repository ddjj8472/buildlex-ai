// Turn pdf.js text items into reading-order lines (top→bottom, left→right).
// Shared by the browser extractor and node tests, so it has no pdf.js import.

export type TextItem = { str: string; x: number; y: number; w: number; h: number };

/** Group items into lines by baseline, then join with spacing that reflects gaps. */
export function layoutText(items: TextItem[], pageHeight: number): string {
  // CAD exports often draw bold text twice with a tiny offset ("대지위치대지위치"); drop the copy.
  const its: TextItem[] = [];
  for (const i of items) {
    if (!i.str || !i.str.trim()) continue;
    const tol = Math.max(1.5, i.h * 0.3);
    if (its.some(j => j.str === i.str && Math.abs(j.x - i.x) < tol && Math.abs(j.y - i.y) < tol)) continue;
    its.push(i);
  }
  if (!its.length) return "";
  // pdf.js y grows upwards; convert to top-down.
  const rows = its.map(i => ({ ...i, top: pageHeight - i.y })).sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: (typeof rows)[] = [];
  for (const r of rows) {
    const tol = Math.max(2, r.h * 0.45);
    const line = lines.find(l => Math.abs(l[0].top - r.top) <= tol);
    if (line) line.push(r); else lines.push([r]);
  }
  lines.sort((a, b) => a[0].top - b[0].top);
  const text = lines.map(l => {
    l.sort((a, b) => a.x - b.x);
    let out = "";
    let end = -Infinity;
    for (const it of l) {
      const gap = it.x - end;
      const ch = Math.max(it.h * 0.5, 2);
      if (out && gap > ch * 3) out += " | ";
      else if (out && gap > ch * 0.35) out += " ";
      out += it.str;
      end = it.x + it.w;
    }
    return out.trim();
  }).filter(Boolean).join("\n");
  return undouble(text);
}

const DOUBLED = /([가-힣A-Za-z0-9./·\-]{2,}?)\1(?![가-힣])/g;
/** Pages drawn with doubled glyph runs ("위치도위치도") are collapsed — only when it is clearly systematic. */
export function undouble(text: string): string {
  const hits = [...text.matchAll(DOUBLED)].filter(m => /[가-힣]{2}/.test(m[1]));
  if (hits.length < 3) return text;
  return text.replace(DOUBLED, (all, s: string) => (/[가-힣A-Za-z]/.test(s) ? s : all));
}
