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
const cache = new Map<string, { text: string; source: "corpus" | "live" }>();
const failed = new Map<string, { at: number; why: string }>();
const RETRY_MS = 5 * 60 * 1000;

/** True when the chunk carries more than the "[별표 N] 제목" line. */
export const hasBody = (c: Chunk) => c.text.replace(/^\[별표[^\]]*\]\s*/, "").length > c.heading.length + 40;

/** Why the last live fetch of this 별표 failed (shown to the user instead of a generic note). */
export const appendixFailure = (id: string) => failed.get(id)?.why;

export async function appendixText(id: string, opts: { live?: boolean; timeoutMs?: number } = {}): Promise<{ text: string; source: "corpus" | "live"; chunk: Chunk } | null> {
  const chunk = loadNational().byId.get(id);
  if (!chunk) return null;
  if (hasBody(chunk)) return { text: chunk.text, source: "corpus", chunk };
  if (opts.live === false || !lawApiEnabled() || !chunk.mst) return null;
  const hit = cache.get(id);
  if (hit) return { ...hit, chunk };
  const f = failed.get(id);
  if (f && Date.now() - f.at < RETRY_MS) return null;
  const timeoutMs = opts.timeoutMs ?? 20000;
  try {
    const text = await fetchAppendix(chunk.mst, chunk.articleNo, timeoutMs);
    if (!text || text.length <= 60) { failed.set(id, { at: Date.now(), why: "법제처 응답에 해당 별표 본문이 없습니다" }); return null; }
    const v = { text, source: "live" as const };
    cache.set(id, v);
    failed.delete(id);
    return { ...v, chunk };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const why = /abort|timeout/i.test(msg) ? `법제처 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다` : `법제처 조회 실패: ${msg.slice(0, 120)}`;
    failed.set(id, { at: Date.now(), why });
    return null;
  }
}

export function zoneAppendixOf(zone: string): ZoneAppendix | undefined {
  const art = loadNational().byId.get(`${DECREE}#71`);
  if (!art) return undefined;
  const z = squashName(zone);
  return zoneAppendices(art.text).find(x => x.zone === z);
}

export type ZoneTable = { zone: string; ref: ZoneAppendix; chunk?: Chunk; table?: UseTable; source: "corpus" | "live" | "none"; why?: string };

/** 용도지역 → its 별표 (시행령 제71조①) → parsed use table, when the text is available. */
export async function zoneUseTable(zone: string, opts: { live?: boolean } = {}): Promise<ZoneTable | null> {
  const ref = zoneAppendixOf(zone);
  if (!ref) return null;
  const id = `${DECREE}#${ref.appendix}`;
  const got = await appendixText(id, opts);
  const chunk = got?.chunk || loadNational().byId.get(id);
  if (!got) {
    const why = !lawApiEnabled() ? "LAW_API_OC(법제처 Open API 키)가 없습니다" : opts.live === false ? undefined : appendixFailure(id);
    return { zone, ref, chunk, source: "none", why };
  }
  const table = parseUseTable(got.text, ref.mode);
  if (!table.items.length) return { zone, ref, chunk, source: "none", why: "별표 본문은 받았지만 건축물 목록 형식을 읽지 못했습니다" };
  return { zone, ref, chunk, table, source: got.source };
}
