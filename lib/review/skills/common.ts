import type { Chunk } from "../../types.ts";
import type { Citation, FieldKey, ProjectValues } from "../types.ts";
import { quoteIn } from "./parse.ts";

export const num = (v: ProjectValues, k: FieldKey): number | undefined => {
  const x = v[k]?.value;
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
export const str = (v: ProjectValues, k: FieldKey): string => {
  const x = v[k]?.value;
  return typeof x === "string" ? x : typeof x === "number" ? String(x) : "";
};
export const flag = (v: ProjectValues, k: FieldKey): boolean => v[k]?.value === true || /^(true|예|있음|해당)$/i.test(String(v[k]?.value ?? ""));
export const round2 = (x: number) => Math.round(x * 100) / 100;
export const fmt = (x: number) => x.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export const labelOf = (c: Chunk) => `「${c.lawName}」 ${c.articleNo}${c.heading ? `(${c.heading})` : ""}`;

/** Build a citation; `verified` is true only if the quote is literally in the article. */
export function cite(c: Chunk, quote?: string): Citation {
  const q = (quote || c.text.split("\n").find(l => l.trim()) || "").trim().slice(0, 240);
  return { id: c.id, label: labelOf(c), quote: q, verified: quoteIn(q, c.text), sourceUrl: c.sourceUrl };
}

export const isResidentialForDaylight = (zone: string) => /(전용|일반)주거지역/.test(zone.replace(/\s/g, ""));
