// Where the 별표 text comes from, in order:
//   1. the corpus — when it was built with LAW_API_OC, appendix bodies are indexed
//   2. 국가법령정보 Open API (law.go.kr/DRF) at request time, cached
//   3. nothing — the check stays "확인 필요" with a link to the official 별표 file
// No 별표 content is typed into the code base.
import { loadNational } from "../corpus.ts";
import { fetchAppendix, lawApiEnabled } from "../law-api.ts";
import type { Chunk } from "../types.ts";
import { zoneAppendices, type ZoneAppendix, squashName } from "./zones.ts";
import { parseUseTable, type UseTable } from "./uses.ts";

const DECREE = "국토의계획및이용에관한법률시행령";
const cache = new Map<string, { text: string; source: "corpus" | "live" } | null>();

/** True when the chunk carries more than the "[별표 N] 제목" line. */
export const hasBody = (c: Chunk) => c.text.replace(/^\[별표[^\]]*\]\s*/, "").length > c.heading.length + 40;

export async function appendixText(id: string, opts: { live?: boolean; timeoutMs?: number } = {}): Promise<{ text: string; source: "corpus" | "live"; chunk: Chunk } | null> {
  const chunk = loadNational().byId.get(id);
  if (!chunk) return null;
  if (hasBody(chunk)) return { text: chunk.text, source: "corpus", chunk };
  if (opts.live === false || !lawApiEnabled() || !chunk.mst) return null;
  if (cache.has(id)) { const hit = cache.get(id); return hit ? { ...hit, chunk } : null; }
  try {
    const text = await Promise.race([
      fetchAppendix(chunk.mst, chunk.articleNo),
      new Promise<null>(res => setTimeout(() => res(null), opts.timeoutMs ?? 9000)),
    ]);
    const v = text && text.length > 60 ? { text, source: "live" as const } : null;
    cache.set(id, v);
    return v ? { ...v, chunk } : null;
  } catch {
    return null;
  }
}

export function zoneAppendixOf(zone: string): ZoneAppendix | undefined {
  const art = loadNational().byId.get(`${DECREE}#71`);
  if (!art) return undefined;
  const z = squashName(zone);
  return zoneAppendices(art.text).find(x => x.zone === z);
}

export type ZoneTable = { zone: string; ref: ZoneAppendix; chunk?: Chunk; table?: UseTable; source: "corpus" | "live" | "none" };

/** 용도지역 → its 별표 (시행령 제71조①) → parsed use table, when the text is available. */
export async function zoneUseTable(zone: string, opts: { live?: boolean } = {}): Promise<ZoneTable | null> {
  const ref = zoneAppendixOf(zone);
  if (!ref) return null;
  const id = `${DECREE}#${ref.appendix}`;
  const got = await appendixText(id, opts);
  const chunk = got?.chunk || loadNational().byId.get(id);
  if (!got) return { zone, ref, chunk, source: "none" };
  const table = parseUseTable(got.text, ref.mode);
  return { zone, ref, chunk, table: table.items.length ? table : undefined, source: table.items.length ? got.source : "none" };
}
