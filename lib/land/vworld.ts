// 국토교통부 V-World Open API (server side). Endpoints and response shapes follow the
// V-World developer docs and two open-source clients that verified them against live
// keys (cadastral-mcp, MIT; ToJIDAEJANG QGIS plugin, MIT):
//   2D데이터  req/data  LP_PA_CBND_BUBUN (연속지적도 — 필지 경계·지번·PNU)
//   국가중점  ned/data/getLandUseAttr (토지이용계획 — 지역·지구·구역 목록)
//             ned/data/ladfrlList     (토지대장 — 지목·면적)
//             ned/data/getLandCharacteristics (토지특성 — 도로접면 등, 있으면 사용)
//   검색      req/address getCoord (주소 → 좌표·PNU)
// The key is registered for a service URL; 2D데이터·국가중점 calls must send the same
// URL as `domain` (VWORLD_DOMAIN) or V-World answers INCORRECT_KEY.
import { makeZone, relationOf } from "./zones.ts";
import type { LandZone, SiteInfo } from "./types.ts";

const KEY = () => process.env.VWORLD_API_KEY || process.env.VWORLD_KEY || "";
const DOMAIN = () => process.env.VWORLD_DOMAIN || "";
export const vworldEnabled = () => !!KEY();

type J = Record<string, unknown>;
const rec = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});

export class VworldError extends Error {}

function url(base: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, key: KEY() });
  if (DOMAIN()) q.set("domain", DOMAIN());
  return `${base}?${q}`;
}

async function getJSON(u: string, timeoutMs = 7000): Promise<J> {
  const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "buildlex-ai/2.0" } });
  const text = await res.text();
  if (!res.ok) throw new VworldError(`V-World HTTP ${res.status}`);
  let json: J;
  try { json = JSON.parse(text) as J; } catch { throw new VworldError("V-World 응답을 해석하지 못했습니다(키·도메인 설정 확인)."); }
  const r = rec(json.response);
  const err = rec(r.error || json.error);
  if (r.status === "ERROR" || err.code) throw new VworldError(`V-World ${String(err.code || "ERROR")}: ${String(err.text || err.message || "요청 실패")}`);
  return json;
}

/** First array of objects anywhere in the payload (NED responses nest them under varying keys). */
export function fieldList(v: unknown, depth = 0): J[] {
  if (depth > 5 || !v || typeof v !== "object") return [];
  if (Array.isArray(v)) return v.length && typeof v[0] === "object" ? (v as J[]) : [];
  const o = v as J;
  for (const k of ["field", "features", "items"]) {
    const x = o[k];
    if (Array.isArray(x)) return x as J[];
    if (x && typeof x === "object") return [x as J];
  }
  for (const val of Object.values(o)) {
    const found = fieldList(val, depth + 1);
    if (found.length) return found;
  }
  return [];
}

type Feature = { pnu: string; addr: string; jibun: string; rings: [number, number][][] };

function featureOf(f: J): Feature | null {
  const p = rec(f.properties);
  const g = rec(f.geometry);
  const coords = g.coordinates as unknown;
  const rings: [number, number][][] = [];
  if (g.type === "Polygon" && Array.isArray(coords)) rings.push(...(coords as [number, number][][]));
  else if (g.type === "MultiPolygon" && Array.isArray(coords)) for (const poly of coords as [number, number][][][]) rings.push(...poly);
  const pnu = String(p.pnu || "");
  return pnu ? { pnu, addr: String(p.addr || ""), jibun: String(p.jibun || ""), rings } : null;
}

const inside = (x: number, y: number, ring: [number, number][]) => {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
};

const DATA = "https://api.vworld.kr/req/data";

export async function parcelAtPoint(lon: number, lat: number): Promise<Feature | null> {
  const json = await getJSON(url(DATA, { service: "data", version: "2.0", request: "GetFeature", data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${lon} ${lat})`, crs: "EPSG:4326", format: "json", size: "10", geometry: "true", attribute: "true" }));
  const feats = fieldList(rec(rec(json.response).result).featureCollection).map(featureOf).filter((x): x is Feature => !!x);
  return feats.find(f => f.rings.some(r => inside(lon, lat, r))) || feats[0] || null;
}

export async function parcelByPnu(pnu: string): Promise<Feature | null> {
  const json = await getJSON(url(DATA, { service: "data", version: "2.0", request: "GetFeature", data: "LP_PA_CBND_BUBUN", attrFilter: `pnu:=:${pnu}`, crs: "EPSG:4326", format: "json", size: "1", geometry: "true", attribute: "true" }));
  return fieldList(rec(rec(json.response).result).featureCollection).map(featureOf).find(Boolean) || null;
}

export async function geocode(address: string): Promise<{ lon: number; lat: number; pnu?: string; text: string } | null> {
  const parcelLike = /\d+(-\d+)?\s*(번지)?$/.test(address.trim()) && /(동|리|가)\s*\d/.test(address);
  for (const type of parcelLike ? ["PARCEL", "ROAD"] : ["ROAD", "PARCEL"]) {
    try {
      const json = await getJSON(url("https://api.vworld.kr/req/address", { service: "address", request: "getCoord", version: "2.0", crs: "epsg:4326", type, format: "json", address, refine: "true", simple: "false" }), 6000);
      const r = rec(json.response);
      const pt = rec(rec(r.result).point);
      const x = Number(pt.x), y = Number(pt.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const refined = rec(r.refined);
        const pnu = String(rec(refined.structure).level4LC || "");
        return { lon: x, lat: y, pnu: /^\d{19}$/.test(pnu) ? pnu : undefined, text: String(refined.text || address) };
      }
    } catch { /* try the other address type */ }
  }
  return null;
}

const NED = "https://api.vworld.kr/ned/data";

export async function landUses(pnu: string): Promise<LandZone[]> {
  const json = await getJSON(url(`${NED}/getLandUseAttr`, { pnu, format: "json", numOfRows: "200", pageNo: "1" }));
  const seen = new Set<string>();
  const out: LandZone[] = [];
  for (const f of fieldList(json.landUses ?? json)) {
    const name = String(f.prposAreaDstrcCodeNm || "").trim();
    if (!name) continue;
    const relation = relationOf(f.cnflcAtNm ?? f.cnflcAt);
    const key = `${name}|${relation || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(makeZone(name, "vworld", { relation, code: f.prposAreaDstrcCode ? String(f.prposAreaDstrcCode) : undefined, law: f.lawNm ? String(f.lawNm) : undefined }));
  }
  return out;
}

export async function landRegister(pnu: string): Promise<{ area?: number; category?: string } | null> {
  const json = await getJSON(url(`${NED}/ladfrlList`, { pnu, format: "json", numOfRows: "10", pageNo: "1" }));
  const it = fieldList(json.ladfrlVOList ?? json)[0];
  if (!it) return null;
  const area = Number(String(it.lndpclAr ?? "").replace(/,/g, ""));
  return { area: area > 0 ? area : undefined, category: it.lndcgrCodeNm ? String(it.lndcgrCodeNm) : undefined };
}

export async function landCharacteristics(pnu: string): Promise<{ roadSide?: string; area?: number; category?: string } | null> {
  const year = new Date().getFullYear();
  for (const stdrYear of [String(year), String(year - 1)]) {
    try {
      const json = await getJSON(url(`${NED}/getLandCharacteristics`, { pnu, stdrYear, format: "json", numOfRows: "10", pageNo: "1" }), 6000);
      const it = fieldList(json)[0];
      if (!it) continue;
      const area = Number(String(it.lndpclAr ?? "").replace(/,/g, ""));
      return { roadSide: it.roadSideCodeNm ? String(it.roadSideCodeNm) : undefined, area: area > 0 ? area : undefined, category: it.lndcgrCodeNm ? String(it.lndcgrCodeNm) : undefined };
    } catch { /* optional data */ }
  }
  return null;
}

/** Everything about one parcel, in parallel. Optional parts fail soft into notes. */
export async function lookupParcel(where: { lon?: number; lat?: number; pnu?: string; address?: string }): Promise<SiteInfo> {
  if (!vworldEnabled()) throw new VworldError("V-World API 키(VWORLD_API_KEY)가 설정되지 않았습니다.");
  const notes: string[] = [];
  let lon = where.lon, lat = where.lat, pnu = where.pnu;
  let address = where.address;
  if (!pnu && address && (lon === undefined || lat === undefined)) {
    const g = await geocode(address);
    if (!g) throw new VworldError("주소를 찾지 못했습니다. 지번 또는 도로명 주소를 확인하세요.");
    lon = g.lon; lat = g.lat; pnu = g.pnu; address = g.text;
  }
  const parcel = pnu ? await parcelByPnu(pnu) : lon !== undefined && lat !== undefined ? await parcelAtPoint(lon, lat) : null;
  if (!parcel) throw new VworldError("이 위치에서 필지를 찾지 못했습니다(도로·하천이거나 지적도 밖).");
  pnu = parcel.pnu;
  const [zones, reg, chr] = await Promise.all([
    landUses(pnu).catch(e => { notes.push(`토지이용계획 조회 실패: ${e instanceof Error ? e.message : e}`); return [] as LandZone[]; }),
    landRegister(pnu).catch(e => { notes.push(`토지대장 조회 실패: ${e instanceof Error ? e.message : e}`); return null; }),
    landCharacteristics(pnu).catch(() => null),
  ]);
  if (lon === undefined || lat === undefined) {
    const ring = parcel.rings[0] || [];
    lon = ring.reduce((a, p) => a + p[0], 0) / Math.max(1, ring.length);
    lat = ring.reduce((a, p) => a + p[1], 0) / Math.max(1, ring.length);
  }
  return {
    source: "vworld", pnu, address: parcel.addr || address, jibun: parcel.jibun, lon, lat,
    area: reg?.area ?? chr?.area, landCategory: reg?.category ?? chr?.category, roadSide: chr?.roadSide,
    parcel: parcel.rings, zones, fetchedAt: new Date().toISOString(), notes,
  };
}
