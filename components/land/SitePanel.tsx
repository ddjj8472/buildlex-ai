"use client";
// 대지 선택 · 토지이용계획 · 지구단위계획 · 허용 용도.
//   V-World key on the server → click a parcel: 필지 경계, 지역·지구·구역, 토지대장 면적, 도로접면.
//   No key → OpenStreetMap + Nominatim give the address (조례 지역); 지역·지구는 직접 고름.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconAlert } from "@/components/Icons";
import RegionPicker from "@/components/RegionPicker";
import { openPdf, pageText } from "@/components/review/pdf-client";
import type { DistrictPlan, LandConfig, LandZone, SiteInfo, UseMatrix, ZoneKind } from "@/lib/land/types";
import type { MapPick } from "./SiteMap";

const SiteMap = dynamic(() => import("./SiteMap"), { ssr: false, loading: () => <div className="site-map site-map-loading">지도 준비 중…</div> });

const USE_ZONES = ["제1종전용주거지역", "제2종전용주거지역", "제1종일반주거지역", "제2종일반주거지역", "제3종일반주거지역", "준주거지역", "중심상업지역", "일반상업지역", "근린상업지역", "유통상업지역", "전용공업지역", "일반공업지역", "준공업지역", "보전녹지지역", "생산녹지지역", "자연녹지지역", "보전관리지역", "생산관리지역", "계획관리지역", "농림지역", "자연환경보전지역"];
const DISTRICTS = ["자연경관지구", "시가지경관지구", "특화경관지구", "고도지구", "방화지구", "시가지방재지구", "자연방재지구", "역사문화환경보호지구", "중요시설물보호지구", "생태계보호지구", "자연취락지구", "보호취락지구", "집단취락지구", "주거개발진흥지구", "산업ㆍ유통개발진흥지구", "특정용도제한지구", "복합용도지구"];
const AREAS = ["개발제한구역", "도시자연공원구역", "시가화조정구역", "수산자원보호구역", "도시혁신구역", "복합용도구역", "입체복합구역", "상대보호구역", "절대보호구역"];
const KIND_ORDER: ZoneKind[] = ["용도지역", "용도지구", "용도구역", "지구단위계획", "도시계획시설", "기타"];
const VERDICT_CLS = { 허용: "ok", 조례: "warn", 조건: "warn", 불허: "err", 확인: "na" } as const;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `서버 응답 오류(${res.status})` }));
  if (!res.ok || data.ok === false || data.error) throw new Error(data.error || `요청 실패(${res.status})`);
  return (data.result ?? data) as T;
}

function classify(name: string): ZoneKind {
  if (/지구단위계획/.test(name)) return "지구단위계획";
  if (USE_ZONES.includes(name)) return "용도지역";
  if (/지구$/.test(name)) return "용도지구";
  if (/구역$/.test(name)) return /보호구역/.test(name) ? "기타" : "용도구역";
  return "기타";
}

const manualZone = (name: string): LandZone => ({ name, kind: classify(name), source: "manual" });

function osmAddress(a: Record<string, string> | undefined, display?: string): string {
  if (!a) return display || "";
  const parts = [a.province || a.state, a.city, a.county || a.borough || a.city_district, a.suburb || a.quarter || a.village || a.town].filter(Boolean);
  return [...new Set(parts)].join(" ") || display || "";
}

const numOrU = (s: string) => { const n = Number(s.replace(/,/g, "")); return s.trim() && Number.isFinite(n) ? n : undefined; };
const listOf = (s: string) => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean);

type Props = { site: SiteInfo | null; onChange: (s: SiteInfo | null) => void; use?: string; compact?: boolean };

export default function SitePanel({ site, onChange, use, compact }: Props) {
  const [cfg, setCfg] = useState<LandConfig | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [center, setCenter] = useState<MapPick | undefined>();
  const [matrix, setMatrix] = useState<UseMatrix | null>(null);
  const [planText, setPlanText] = useState("");
  const [planMsg, setPlanMsg] = useState("");
  const [showPlan, setShowPlan] = useState(false);
  const siteRef = useRef(site);
  useEffect(() => { siteRef.current = site; }, [site]);

  useEffect(() => { fetch("/api/land/config").then(r => r.json()).then(setCfg).catch(() => setCfg({ vworld: false, ai: false, lawApi: false })); }, []);

  const update = useCallback((patch: Partial<SiteInfo>) => {
    const cur = siteRef.current || { source: "manual" as const, zones: [], notes: [] };
    onChange({ ...cur, ...patch });
  }, [onChange]);

  async function regionFor(text: string): Promise<SiteInfo["region"]> {
    try { const r = await post<{ region: SiteInfo["region"] | null }>("/api/land/region", { text }); return r.region || undefined; } catch { return undefined; }
  }

  async function pick(p: MapPick) {
    setError(""); setCenter(undefined);
    if (cfg?.vworld) {
      setBusy("필지·토지이용계획 조회 중…");
      try {
        const s = await post<SiteInfo>("/api/land/lookup", { lon: p.lon, lat: p.lat });
        onChange({ ...s, plan: siteRef.current?.plan });
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setBusy(""); }
      return;
    }
    setBusy("주소 확인 중(OpenStreetMap)…");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lon}&zoom=18&addressdetails=1&accept-language=ko`);
      const j = await r.json();
      const address = osmAddress(j.address, j.display_name);
      const region = await regionFor(address);
      const cur = siteRef.current;
      onChange({ source: "manual", lon: p.lon, lat: p.lat, address, region, zones: cur?.zones || [], plan: cur?.plan, notes: ["V-World 키가 없어 지적·토지이용계획은 자동 조회하지 않았습니다. 토지이음(eum.go.kr)의 토지이용계획확인서를 보고 지역·지구를 고르세요."] });
    } catch (e) { setError(`주소 조회 실패: ${e instanceof Error ? e.message : e}`); }
    finally { setBusy(""); }
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setError("");
    if (cfg?.vworld) {
      setBusy("주소 검색 중…");
      try { const s = await post<SiteInfo>("/api/land/lookup", { address: q }); onChange({ ...s, plan: siteRef.current?.plan }); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setBusy(""); }
      return;
    }
    setBusy("주소 검색 중(OpenStreetMap)…");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=1&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!j?.[0]) throw new Error("주소를 찾지 못했습니다.");
      const p = { lon: Number(j[0].lon), lat: Number(j[0].lat) };
      setCenter(p);
      await pick(p);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }

  // 허용 용도 table follows the 용도지역 and 지구.
  const zone = useMemo(() => site?.zones.find(z => z.kind === "용도지역" && USE_ZONES.some(u => z.name.replace(/\s/g, "").includes(u)) && z.relation !== "접합")?.name.replace(/\s/g, "").match(/(제[123]종(전용|일반)주거|준주거|중심상업|일반상업|근린상업|유통상업|전용공업|일반공업|준공업|보전녹지|생산녹지|자연녹지|보전관리|생산관리|계획관리|농림|자연환경보전)지역/)?.[0], [site]);
  const districtKey = (site?.zones || []).filter(z => z.kind === "용도지구").map(z => z.name).join("|");
  useEffect(() => {
    if (!zone) { setMatrix(null); return; }
    let alive = true;
    post<UseMatrix>("/api/land/uses", { zone, region: site?.region?.key, districts: site?.zones.filter(z => z.kind === "용도지구") })
      .then(m => { if (alive) setMatrix(m); }).catch(() => { if (alive) setMatrix(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, site?.region?.key, districtKey]);

  const zones = site?.zones || [];
  const inPlan = zones.some(z => z.kind === "지구단위계획") || !!site?.plan;
  const removeZone = (i: number) => update({ zones: zones.filter((_, k) => k !== i) });
  const addZone = (name: string) => { if (name && !zones.some(z => z.name === name)) update({ zones: [...zones, manualZone(name)] }); };
  const setUseZone = (name: string) => update({ zones: [...zones.filter(z => !(z.kind === "용도지역" && z.source !== "vworld")), ...(name ? [manualZone(name)] : [])] });
  const plan: DistrictPlan = site?.plan || { source: "manual" };
  const setPlan = (p: Partial<DistrictPlan>) => update({ plan: { ...plan, ...p, source: p.source || (plan.source === "ai" ? "ai" : "manual") } });

  async function extract(textIn?: string) {
    const text = (textIn ?? planText).trim();
    if (!text) return;
    setPlanMsg("AI로 결정조서를 읽는 중…");
    try {
      const r = await post<{ plan: DistrictPlan; dropped: string[]; kept: string[] }>("/api/land/plan", { text, block: plan.block });
      update({ plan: { ...plan, ...Object.fromEntries(Object.entries(r.plan).filter(([, v]) => v !== undefined)), source: "ai" } as DistrictPlan });
      setPlanMsg(`채운 항목 ${r.kept.length}개${r.dropped.length ? ` · 원문에서 확인되지 않아 버린 값 ${r.dropped.length}개(${r.dropped.slice(0, 4).join(", ")}${r.dropped.length > 4 ? "…" : ""})` : ""}. 원문과 대조하세요.`);
    } catch (e) { setPlanMsg(e instanceof Error ? e.message : String(e)); }
  }
  async function planPdf(f: File) {
    setPlanMsg("PDF에서 글자 추출 중…");
    try {
      const doc = await openPdf(f);
      const pages: string[] = [];
      for (let i = 1; i <= Math.min(doc.numPages, 40); i++) pages.push((await pageText(doc, i)).text);
      await doc.destroy().catch(() => {});
      const text = pages.join("\n");
      if (text.replace(/\s/g, "").length < 50) { setPlanMsg("PDF에 글자 레이어가 없습니다(스캔본). 내용을 붙여넣어 주세요."); return; }
      setPlanText(text.slice(0, 60000));
      await extract(text);
    } catch (e) { setPlanMsg(e instanceof Error ? e.message : String(e)); }
  }

  const fields = (
    <div className="site-plan-grid">
      <label>구역명<input value={plan.name || ""} onChange={e => setPlan({ name: e.target.value || undefined })} placeholder="예: 상암택지 지구단위계획" /></label>
      <label>획지·가구<input value={plan.block || ""} onChange={e => setPlan({ block: e.target.value || undefined })} placeholder="예: D3-2" /></label>
      <label>건폐율(%)<input inputMode="decimal" value={plan.bcr ?? ""} onChange={e => setPlan({ bcr: numOrU(e.target.value) })} /></label>
      <label>기준용적률(%)<input inputMode="decimal" value={plan.far?.base ?? ""} onChange={e => setPlan({ far: { ...plan.far, base: numOrU(e.target.value) } })} /></label>
      <label>허용용적률(%)<input inputMode="decimal" value={plan.far?.allowed ?? ""} onChange={e => setPlan({ far: { ...plan.far, allowed: numOrU(e.target.value) } })} /></label>
      <label>상한용적률(%)<input inputMode="decimal" value={plan.far?.max ?? ""} onChange={e => setPlan({ far: { ...plan.far, max: numOrU(e.target.value) } })} /></label>
      <label>적용 용적률<select value={plan.farApplied || ""} onChange={e => setPlan({ farApplied: (e.target.value || undefined) as DistrictPlan["farApplied"] })}><option value="">자동(허용→기준)</option><option value="base">기준</option><option value="allowed">허용</option><option value="max">상한(인센티브)</option></select></label>
      <label>최고높이(m)<input inputMode="decimal" value={plan.height?.maxM ?? ""} onChange={e => setPlan({ height: { ...plan.height, maxM: numOrU(e.target.value) } })} /></label>
      <label>최고층수<input inputMode="numeric" value={plan.height?.maxFloors ?? ""} onChange={e => setPlan({ height: { ...plan.height, maxFloors: numOrU(e.target.value) } })} /></label>
      <label>최저층수<input inputMode="numeric" value={plan.height?.minFloors ?? ""} onChange={e => setPlan({ height: { ...plan.height, minFloors: numOrU(e.target.value) } })} /></label>
      <label>건축한계선(m)<input inputMode="decimal" value={plan.setback ?? ""} onChange={e => setPlan({ setback: numOrU(e.target.value) })} /></label>
      <label className="wide">불허용도<input value={(plan.uses?.prohibited || []).join(", ")} onChange={e => setPlan({ uses: { ...plan.uses, prohibited: listOf(e.target.value) } })} placeholder="쉼표로 구분: 숙박시설, 위락시설, 제2종 근린생활시설 중 단란주점" /></label>
      <label className="wide">허용·권장용도<input value={[...(plan.uses?.allowed || []), ...(plan.uses?.recommended || [])].join(", ")} onChange={e => setPlan({ uses: { ...plan.uses, allowed: listOf(e.target.value), recommended: undefined } })} placeholder="쉼표로 구분" /></label>
      <label className="wide">지정용도<input value={(plan.uses?.designated || []).join(", ")} onChange={e => setPlan({ uses: { ...plan.uses, designated: listOf(e.target.value) } })} placeholder="예: 1층 판매시설" /></label>
    </div>
  );

  return (
    <div className={`site-panel${compact ? " compact" : ""}`}>
      <div className="site-search">
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void search(); }} placeholder="주소·지번 검색 (예: 서울 마포구 상암동 1601)" aria-label="주소 검색" />
        <button type="button" className="ghost" onClick={() => void search()} disabled={!!busy}>검색</button>
        <span className={`site-mode ${cfg?.vworld ? "on" : ""}`} title={cfg?.vworld ? "국토교통부 V-World로 지적·토지이용계획을 자동 조회합니다." : "V-World 키가 없어 지도(OSM)와 주소만 자동이고, 지역·지구는 직접 고릅니다."}>{cfg ? (cfg.vworld ? "토지이용계획 자동 조회" : "수동 모드(OSM)") : "…"}</span>
      </div>
      <SiteMap mapKey={cfg?.mapKey} parcel={site?.parcel} marker={site?.lon !== undefined && site?.lat !== undefined ? { lon: site.lon, lat: site.lat } : undefined} center={center} onPick={p => void pick(p)} />
      <p className="rv-help site-tip">{busy || "지도를 눌러 대지를 고르세요."}</p>
      {error && <div className="rv-error"><IconAlert size={16} /> {error}</div>}

      {site && (
        <div className="site-info">
          <div className="site-facts">
            <div><span>주소</span><b>{site.address || "-"}</b></div>
            {site.pnu && <div><span>PNU</span><b className="mono">{site.pnu}</b></div>}
            {site.landCategory && <div><span>지목</span><b>{site.landCategory}</b></div>}
            {site.area && <div><span>토지대장 면적</span><b>{site.area.toLocaleString()}㎡</b></div>}
            {site.roadSide && <div><span>도로접면</span><b>{site.roadSide}</b></div>}
            <div className="site-region"><span>조례 지역</span><RegionPicker value={site.region?.label || ""} onChange={async label => update({ region: label ? await regionFor(label) : undefined })} placement="down" /></div>
          </div>

          <h4>지역·지구·구역 <small>{site.source === "vworld" ? "토지이용계획(V-World)" : "직접 입력"}</small></h4>
          <div className="site-zones">
            {KIND_ORDER.map(kind => {
              const list = zones.map((z, i) => ({ z, i })).filter(x => x.z.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind} className="site-zone-row">
                  <span className="site-zone-kind">{kind}</span>
                  <div className="site-chips">
                    {list.map(({ z, i }) => (
                      <span key={`${z.name}-${i}`} className={`chip site-chip k-${kind}`} title={z.law || ""}>
                        {z.name}{z.relation && z.relation !== "포함" ? <em>{z.relation === "접합" ? "접함" : z.relation}</em> : z.source === "vworld" && !z.relation ? <em title={z.relationRaw ? `토지이용계획 값: ${z.relationRaw}` : "포함·저촉·접함 구분 없음"}>구분 없음</em> : null}
                        <button type="button" aria-label={`${z.name} 삭제`} onClick={() => removeZone(i)}>×</button>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {!zones.length && <p className="rv-help">아직 지역·지구가 없습니다. 아래에서 고르세요.</p>}
          </div>
          <div className="site-add">
            <select value="" onChange={e => setUseZone(e.target.value)} aria-label="용도지역"><option value="">용도지역 선택…</option>{USE_ZONES.map(z => <option key={z}>{z}</option>)}</select>
            <select value="" onChange={e => addZone(e.target.value)} aria-label="용도지구 추가"><option value="">용도지구 추가…</option>{DISTRICTS.map(z => <option key={z}>{z}</option>)}</select>
            <select value="" onChange={e => addZone(e.target.value)} aria-label="구역 추가"><option value="">용도구역·보호구역 추가…</option>{AREAS.map(z => <option key={z}>{z}</option>)}</select>
            <label className="bim-toggle"><input type="checkbox" checked={zones.some(z => z.kind === "지구단위계획")} onChange={e => e.target.checked ? addZone("지구단위계획구역") : update({ zones: zones.filter(z => z.kind !== "지구단위계획") })} /> 지구단위계획구역</label>
          </div>
          {site.notes.map((n, i) => <div key={i} className="rv-note">{n}</div>)}

          {(inPlan || showPlan) ? (
            <details className="site-plan" open={inPlan}>
              <summary>지구단위계획 — 건축물에 관한 계획 {plan.source === "ai" && <span className="chip">AI 추출</span>}</summary>
              <p className="rv-help">결정조서·시행지침에서 이 대지가 속한 획지의 값을 넣으세요. 입력한 값은 용도지역 기준보다 우선 적용됩니다(국토계획법 제54조).</p>
              {fields}
              <div className="site-plan-ai">
                <textarea value={planText} onChange={e => setPlanText(e.target.value)} placeholder="결정조서·시행지침 내용을 붙여넣으면 AI가 위 칸을 채웁니다(원문에서 확인된 값만)." rows={3} />
                <div className="site-plan-actions">
                  <label className={`ghost bim-reload${!cfg?.ai ? " disabled" : ""}`}>결정조서 PDF<input type="file" accept="application/pdf,.pdf" disabled={!cfg?.ai} onChange={e => { const f = e.target.files?.[0]; if (f) void planPdf(f); e.target.value = ""; }} /></label>
                  <button type="button" className="ghost" disabled={!cfg?.ai || !planText.trim()} onClick={() => void extract()}>AI로 채우기</button>
                  {!cfg?.ai && <span className="rv-help" style={{ margin: 0 }}>AI 키가 없어 직접 입력만 됩니다.</span>}
                </div>
                {planMsg && <div className="rv-note">{planMsg}</div>}
              </div>
            </details>
          ) : (
            <button type="button" className="ghost" onClick={() => setShowPlan(true)}>지구단위계획 입력</button>
          )}

          {matrix && (
            <details className="site-matrix" open={!compact}>
              <summary>이 땅에 지을 수 있는 용도 — {matrix.zone} {matrix.appendix && <small>({matrix.appendix.label}, {matrix.appendix.source === "live" ? "법제처 원문" : matrix.appendix.source === "corpus" ? "코퍼스" : "원문 미수록"})</small>}</summary>
              {use && <p className="rv-help">이 프로젝트 주용도: <b>{use}</b></p>}
              <div className="site-matrix-grid">
                {matrix.rows.map(r => (
                  <div key={r.no} className={`site-use ${VERDICT_CLS[r.verdict]}`} title={r.text || r.by}>
                    <span className={`rv-badge ${VERDICT_CLS[r.verdict]}`}>{r.verdict}</span>
                    <span>{r.no}. {r.name}{r.via && <small className="site-use-via"> · {r.via}</small>}</span>
                  </div>
                ))}
              </div>
              {matrix.notes.map((n, i) => <div key={i} className="rv-note">{n}</div>)}
              {matrix.appendix?.url && <a className="site-link" href={matrix.appendix.url} target="_blank" rel="noreferrer">{matrix.appendix.label} 원문</a>}
            </details>
          )}
          <div className="site-actions">
            <button type="button" className="ghost" onClick={() => { onChange(null); setMatrix(null); }}>대지 지우기</button>
            <a className="ghost" href="https://www.eum.go.kr" target="_blank" rel="noreferrer">토지이음에서 토지이용계획 확인</a>
          </div>
        </div>
      )}
    </div>
  );
}
