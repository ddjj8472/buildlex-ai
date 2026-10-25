"use client";
// BIM 법규검토 — IFC upload → 3D viewer → element-level Korean code check.
// The IFC is parsed and measured in a Web Worker (web-ifc); only the compact facts go
// to /api/bim/check, where thresholds are read from the statute corpus.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconAlert, IconBack, IconLogo } from "@/components/Icons";
import Markdown from "@/components/Markdown";
import RegionPicker from "@/components/RegionPicker";
import ValuesForm from "@/components/review/ValuesForm";
import type { BimFacts, BimIssue, BimReviewResult, BimRuleResult, EgressField, SpaceUse, Vec3 } from "@/lib/bim/types";
import type { CheckStatus, FieldKey, FieldValue, ProjectValues } from "@/lib/review/types";
import { buildBcf, type BcfTopic } from "./bcf";
import type { ViewerElement, WorkerModel, WorkerOut } from "./ifc-worker";
import type { ViewerHandle } from "./Viewer3D";

const Viewer3D = dynamic(() => import("./Viewer3D"), { ssr: false, loading: () => <div className="bim-canvas bim-loading">3D 뷰어 준비 중…</div> });

const SAMPLES = [
  { file: "/bim/sample-a-compliant.ifc", label: "샘플 A · 근린생활시설(적합)" },
  { file: "/bim/sample-b-violations.ifc", label: "샘플 B · 공동주택(위반 포함)" },
];
const STATUS: Record<CheckStatus, { ko: string; cls: string }> = {
  FAIL: { ko: "부적합", cls: "err" }, UNCLEAR: { ko: "확인 필요", cls: "warn" }, PASS: { ko: "적합", cls: "ok" }, NOT_APPLICABLE: { ko: "해당 없음", cls: "na" },
};
const SEV = { critical: "위험", major: "보통", minor: "낮음" } as const;
const MAX_MB = 300;

function download(name: string, data: Blob | string, type = "application/json") {
  const blob = typeof data === "string" ? new Blob([data], { type: `${type};charset=utf-8` }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export default function BimDashboard() {
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; pct: number } | null>(null);
  const [error, setError] = useState("");
  const [model, setModel] = useState<WorkerModel | null>(null);
  const [facts, setFacts] = useState<BimFacts | null>(null);
  const [fields, setFields] = useState<EgressField[]>([]);
  const [result, setResult] = useState<BimReviewResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [values, setValues] = useState<ProjectValues>({});
  const [dirty, setDirty] = useState(false);
  const [region, setRegion] = useState("");
  const [tab, setTab] = useState<"rules" | "values" | "report" | "model">("rules");
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [storey, setStorey] = useState<number | null>(null);
  const [xray, setXray] = useState(false);
  const [showSpaces, setShowSpaces] = useState(false);
  const [section, setSection] = useState(false);
  const [heatOn, setHeatOn] = useState(false);
  const [envOn, setEnvOn] = useState(false);
  const [sel, setSel] = useState<{ ids: number[]; at?: Vec3; key: string } | null>(null);
  const [picked, setPicked] = useState<ViewerElement | null>(null);
  const [exporting, setExporting] = useState("");
  const [timing, setTiming] = useState(0);
  const worker = useRef<Worker | null>(null);
  const viewer = useRef<ViewerHandle>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const check = useCallback(async (f: BimFacts, v: ProjectValues, reg: string) => {
    setChecking(true); setError("");
    try {
      const res = await fetch("/api/bim/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts: f, values: v, region: reg || undefined }) });
      const data = await res.json().catch(() => ({ error: `서버 응답 오류(${res.status})` }));
      if (!res.ok || !data.ok) throw new Error(data.error || `요청 실패(${res.status})`);
      const r = data.result as BimReviewResult;
      setResult(r); setValues(r.values); setDirty(false);
      setOpen(Object.fromEntries(r.rules.filter(x => x.status === "FAIL").slice(0, 2).map(x => [x.check_id, true])));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setChecking(false); }
  }, []);

  async function load(source: File | { url: string; name: string }) {
    setBusy(true); setError(""); setResult(null); setModel(null); setFacts(null); setFields([]); setSel(null); setPicked(null); setStorey(null); setHeatOn(false); setEnvOn(false);
    const name = source instanceof File ? source.name : source.name;
    setFileName(name);
    try {
      if (source instanceof File && source.size > MAX_MB * 1e6) throw new Error(`${(source.size / 1e6).toFixed(0)}MB — ${MAX_MB}MB 이하 IFC만 브라우저에서 열 수 있습니다.`);
      setProgress({ stage: "파일 읽기", pct: 0 });
      const buffer = source instanceof File ? await source.arrayBuffer() : await (await fetch(source.url)).arrayBuffer();
      if (!new TextDecoder().decode(buffer.slice(0, 64)).includes("ISO-10303-21")) throw new Error("IFC(STEP) 파일이 아닙니다. Revit에서 '내보내기 → IFC'로 저장한 .ifc 파일을 올려 주세요.");
      if (!worker.current) worker.current = new Worker(new URL("./ifc-worker.ts", import.meta.url), { type: "module" });
      const w = worker.current;
      const out = await new Promise<Extract<WorkerOut, { type: "done" }>>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<WorkerOut>) => {
          if (e.data.type === "progress") setProgress({ stage: e.data.stage, pct: e.data.pct });
          else if (e.data.type === "done") resolve(e.data);
          else reject(new Error(e.data.message));
        };
        w.onerror = e => reject(new Error(e.message || "IFC 처리 중 오류"));
        w.postMessage({ type: "open", buffer, name }, [buffer]);
      });
      setModel(out.model); setFacts(out.facts); setFields(out.fields); setTiming(out.ms);
      setProgress({ stage: "법령 기준 검토", pct: 1 });
      await check(out.facts, {}, region);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); setProgress(null); }
  }

  const spaceUse = useMemo(() => new Map<number, SpaceUse>((facts?.spaces || []).map(s => [s.ref.id, s.use])), [facts]);
  const storeyName = useMemo(() => new Map((model?.storeys || []).map(s => [s.id, s.name])), [model]);
  const storeyByName = useMemo(() => new Map((model?.storeys || []).map(s => [s.name, s.id])), [model]);
  const rule = (id: string) => result?.rules.find(r => r.check_id === id);
  const egressRule = rule("B-EGRESS-DIST"), northRule = rule("B-NORTH");
  const heat = heatOn && storey !== null ? fields.find(f => f.storeyId === storey) || null : null;
  const heatLimit = egressRule?.params?.limit ?? 30;
  const envelope = envOn && northRule?.params ? { low: northRule.params.low, ratio: northRule.params.ratio, threshold: northRule.params.threshold } : envOn ? { low: 1.5, ratio: 0.5, threshold: 10 } : null;
  const issuesByElement = useMemo(() => {
    const m = new Map<number, BimIssue[]>();
    for (const r of result?.rules || []) for (const i of r.issues) for (const ref of i.refs) m.set(ref.id, [...(m.get(ref.id) || []), i]);
    return m;
  }, [result]);

  function focusIssue(r: BimRuleResult, i: BimIssue) {
    setSel({ ids: i.refs.map(x => x.id), at: i.at, key: i.id });
    const sid = i.storey ? storeyByName.get(i.storey) : undefined;
    if (r.check_id === "B-EGRESS-DIST" && sid !== undefined) { setStorey(sid); setHeatOn(true); return; }
    if (r.check_id === "B-NORTH") { setStorey(null); setEnvOn(true); return; }
    // Keep an isolated storey only if the issue is on it.
    if (storey !== null && sid !== storey) setStorey(sid ?? null);
  }
  function focusRule(r: BimRuleResult) {
    const ids = [...new Set(r.issues.flatMap(i => i.refs.map(x => x.id)))];
    setOpen(o => ({ ...o, [r.check_id]: !o[r.check_id] }));
    if (ids.length) setSel({ ids, key: `rule-${r.check_id}-${Date.now()}` });
  }

  async function exportBcf() {
    if (!result || !model || !viewer.current) return;
    setExporting("BCF 스냅샷 생성 중…");
    const prev = { sel, storey, heatOn, envOn };
    setStorey(null); setHeatOn(false); setEnvOn(false);
    try {
      const topics: BcfTopic[] = [];
      const list = result.rules.flatMap(r => r.issues.filter(i => i.status === "FAIL" || i.refs.length).map(i => ({ r, i }))).slice(0, 60);
      for (const { r, i } of list) {
        const ids = i.refs.map(x => x.id);
        setSel({ ids, at: i.at, key: `bcf-${i.id}` });
        await new Promise(res => setTimeout(res, 60));
        const shot = await viewer.current.capture(ids, i.at);
        topics.push({ rule: r, issue: i, snapshot: shot.png, camera: shot.camera });
      }
      download(`${fileName.replace(/\.ifc$/i, "") || "model"}-buildlex.bcfzip`, buildBcf(topics, { project: model.project, file: fileName, offset: [model.offset[0], model.offset[1], model.offset[2]] }));
    } catch (e) { setError(`BCF 내보내기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSel(prev.sel); setStorey(prev.storey); setHeatOn(prev.heatOn); setEnvOn(prev.envOn); setExporting(""); }
  }

  const editValue = (k: FieldKey, fv: FieldValue | undefined) => { setDirty(true); setValues(cur => { const next = { ...cur }; if (fv) next[k] = fv; else delete next[k]; return next; }); };
  const rules = (result?.rules || []).filter(r => !onlyProblems || r.status === "FAIL" || r.status === "UNCLEAR");
  const sections = [...new Set(rules.map(r => r.section))];

  return (
    <div className="rv-shell bim-shell">
      <header className="rv-top">
        <Link href="/" className="ghost rv-back"><IconBack size={16} /> 법령 질의</Link>
        <div className="rv-brand"><span className="brand-mark"><IconLogo size={17} /></span><div><div className="brand-name">BIM 법규검토</div><div className="brand-sub">IFC 3D 뷰어 · 요소 단위 국내 법규 자동 검토</div></div></div>
        <nav className="bim-nav">
          <Link href="/review" className="ghost">도면(PDF) 검토</Link>
          <a className="ghost" href="https://github.com/ddjj8472/buildlex-ai/blob/main/docs/bim-review.md" target="_blank" rel="noreferrer">Revit 설정 가이드</a>
        </nav>
      </header>

      {!model && (
        <main className="rv-main">
          <section className="rv-card">
            <h2>IFC 모델 불러오기</h2>
            <p className="rv-help">Revit에서 <b>파일 → 내보내기 → IFC</b>로 저장한 .ifc 파일을 올리세요(IFC2x3·IFC4). 파일은 브라우저 안에서만 열리고, 서버에는 측정값 요약만 전송됩니다.</p>
            <div className="rv-upload">
              <label className={`rv-drop${busy ? " disabled" : ""}`}>
                <input type="file" accept=".ifc,application/x-step,application/ifc" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} />
                <span>{fileName && busy ? `불러오는 중: ${fileName}` : "IFC 파일 선택"}</span>
              </label>
              <div className="rv-samples">{SAMPLES.map(s => <button key={s.file} type="button" className="ghost" disabled={busy} onClick={() => void load({ url: s.file, name: s.file.split("/").pop()! })}>{s.label}</button>)}</div>
            </div>
            <div className="rv-options"><div className="rv-opt"><span>지역(선택)</span><RegionPicker value={region} onChange={setRegion} placement="down" /></div><span className="rv-help" style={{ margin: 0 }}>비우면 모델의 대지위치로 조례를 찾습니다.</span></div>
            {progress && (
              <div className="bim-progress" aria-live="polite">
                <div className="bim-bar"><span style={{ width: `${Math.round(progress.pct * 100)}%` }} /></div>
                <span>{progress.stage} · {Math.round(progress.pct * 100)}%</span>
              </div>
            )}
            {error && <div className="rv-error"><IconAlert size={16} /> {error}</div>}
          </section>
          <section className="rv-card bim-how">
            <h2>검토 방식</h2>
            <ol className="bim-steps">
              <li><b>IFC 해석</b><span>web-ifc(That Open Engine)로 형상·속성·층 구조를 읽습니다.</span></li>
              <li><b>측정</b><span>건축면적·바닥면적, 높이, 계단 치수, 복도 폭, 창 면적, 직통계단까지 보행거리, 정북 이격을 3D 형상에서 계산합니다.</span></li>
              <li><b>법령 대조</b><span>기준값은 현행 건축법·시행령·피난방화규칙·주택건설기준·주차장법 원문과 지자체 조례에서 읽어 옵니다.</span></li>
              <li><b>요소 단위 결과</b><span>문제 요소를 3D에서 강조하고, BCF로 내보내 Revit에서 바로 찾을 수 있습니다.</span></li>
            </ol>
          </section>
        </main>
      )}

      {model && (
        <main className="bim-work">
          <section className="bim-view rv-card">
            <div className="bim-toolbar">
              <select value={storey ?? ""} onChange={e => { setStorey(e.target.value === "" ? null : Number(e.target.value)); setSel(null); }} aria-label="층 선택">
                <option value="">전체 층</option>
                {model.storeys.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="ghost" onClick={() => viewer.current?.fit()}>맞춤</button>
              <button type="button" className="ghost" onClick={() => viewer.current?.topView()}>평면</button>
              <label className="bim-toggle"><input type="checkbox" checked={xray} onChange={e => setXray(e.target.checked)} /> X-ray</label>
              <label className="bim-toggle"><input type="checkbox" checked={showSpaces} onChange={e => setShowSpaces(e.target.checked)} /> 실</label>
              <label className="bim-toggle" title="층을 고르면 바닥 위 1.2m에서 자릅니다"><input type="checkbox" checked={section} disabled={storey === null} onChange={e => setSection(e.target.checked)} /> 단면</label>
              <label className="bim-toggle" title="층을 고르면 직통계단까지 보행거리를 색으로 보여 줍니다"><input type="checkbox" checked={heatOn} disabled={!fields.length} onChange={e => { setHeatOn(e.target.checked); if (e.target.checked && storey === null && fields[0]) setStorey(fields[0].storeyId); }} /> 보행거리</label>
              <label className="bim-toggle" title="정북방향 일조 사선(허용 높이 경계)"><input type="checkbox" checked={envOn} disabled={!model.boundary} onChange={e => setEnvOn(e.target.checked)} /> 정북 사선</label>
              {sel && <button type="button" className="ghost" onClick={() => setSel(null)}>강조 해제</button>}
            </div>
            <div className="bim-stage">
              <Viewer3D ref={viewer} model={model} spaceUse={spaceUse} storey={storey} highlight={sel} xray={xray} showSpaces={showSpaces} section={section} heat={heat} heatLimit={heatLimit} envelope={envelope} onPick={setPicked} />
              {heat && <div className="bim-legend"><span className="g" />0m<span className="y" />{Math.round(heatLimit * 0.6)}m<span className="r" />{heatLimit}m 초과<span className="p" />경로 없음</div>}
              {picked && (
                <div className="bim-pick">
                  <div className="bim-pick-head"><b>{picked.longName ? `${picked.longName} ${picked.name}` : picked.name || picked.ifcType}</b><button type="button" className="ghost" onClick={() => setPicked(null)}>닫기</button></div>
                  <div className="bim-pick-meta">{picked.ifcType}{picked.storey !== undefined ? ` · ${storeyName.get(picked.storey) || ""}` : ""} · <code>{picked.guid}</code></div>
                  {(issuesByElement.get(picked.id) || []).map(i => <div key={i.id} className={`bim-pick-issue ${i.status === "FAIL" ? "err" : "warn"}`}>{i.title}: {i.detail}</div>)}
                  <table className="rv-table"><tbody>{Object.entries(picked.props).sort(([a], [b]) => (b.startsWith("BuildLex") ? 1 : 0) - (a.startsWith("BuildLex") ? 1 : 0)).slice(0, 18).map(([k, v]) => <tr key={k}><th>{k.replace(/^Pset_|^Qto_/, "")}</th><td>{typeof v === "number" ? Math.round(v * 1000) / 1000 : String(v)}</td></tr>)}</tbody></table>
                </div>
              )}
              {exporting && <div className="bim-busy">{exporting}</div>}
            </div>
            <div className="bim-foot">
              <span>{fileName} · {facts?.source.schema} · 요소 {facts?.source.elements.toLocaleString()}개 · {(timing / 1000).toFixed(1)}초</span>
              <label className={`ghost bim-reload${busy ? " disabled" : ""}`}>다른 IFC 열기<input type="file" accept=".ifc" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ""; }} /></label>
            </div>
          </section>

          <section className="bim-panel rv-card">
            {result && (
              <div className="rv-summary bim-summary">
                <div className="err"><b>{result.summary.by_status.FAIL}</b><span>부적합</span></div>
                <div className="warn"><b>{result.summary.by_status.UNCLEAR}</b><span>확인 필요</span></div>
                <div className="ok"><b>{result.summary.by_status.PASS}</b><span>적합</span></div>
                <div className="na"><b>{result.summary.by_status.NOT_APPLICABLE}</b><span>해당 없음</span></div>
                <div><b>{result.summary.critical}</b><span>위험 이슈</span></div>
              </div>
            )}
            <div className="tabs rv-tabs" role="tablist">
              {([["rules", "검토 결과"], ["values", "건축개요"], ["report", "보완요구서"], ["model", "모델 정보"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {checking && <div className="rv-help"><span className="caret" /> 법령 기준으로 검토하는 중…</div>}
            {error && <div className="rv-error"><IconAlert size={16} /> {error}</div>}

            {tab === "rules" && result && (
              <div className="bim-rules">
                <div className="bim-rules-head">
                  <span className="rv-help" style={{ margin: 0 }}>{result.region ? `적용 조례: ${result.region.label}` : "지역 미지정 — 국가 기준만 적용"}</span>
                  <label className="bim-toggle"><input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> 문제 항목만</label>
                </div>
                {!rules.length && <p className="empty-note">부적합·확인 필요 항목이 없습니다.</p>}
                {sections.map(sec => (
                  <div key={sec} className="bim-section">
                    <h3>{sec}</h3>
                    {rules.filter(r => r.section === sec).map(r => (
                      <div key={r.check_id} className={`rv-item ${STATUS[r.status].cls}`}>
                        <button type="button" className="bim-rule-head" onClick={() => focusRule(r)} aria-expanded={!!open[r.check_id]}>
                          <span className={`rv-badge ${STATUS[r.status].cls}`}>{STATUS[r.status].ko}</span>
                          <strong>{r.title}</strong>
                          {r.issues.length > 0 && <span className="chip">{r.issues.length}건</span>}
                          {r.tier === 3 && <span className="chip">조례</span>}
                          {r.source === "bim" && r.checked > 0 && <span className="bim-count">{r.checked}개 검토</span>}
                        </button>
                        {open[r.check_id] && (
                          <div className="rv-item-body">
                            <div><span className="rv-k">기준</span>{r.requirement}</div>
                            {r.provided && <div><span className="rv-k">모델</span>{r.provided.text}</div>}
                            {r.issues.length > 0 && (
                              <ul className="bim-issues">
                                {r.issues.map(i => (
                                  <li key={i.id}>
                                    <button type="button" className={`bim-issue${sel?.key === i.id ? " on" : ""}`} onClick={() => focusIssue(r, i)}>
                                      <span className={`bim-sev ${i.severity}`}>{i.status === "FAIL" ? SEV[i.severity] : "확인"}</span>
                                      <span><b>{i.title}</b><small>{i.detail}</small></span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {r.notes.filter(Boolean).map((n, k) => <div key={k} className="rv-note">{n}</div>)}
                            {r.citations.length > 0 && (
                              <details className="rv-cites">
                                <summary>근거 조문 {new Set(r.citations.map(c => c.label)).size}건</summary>
                                {r.citations.map((c, k) => (
                                  <div key={k} className="rv-cite">
                                    <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.label}</a>
                                    {c.quote && <blockquote>{c.quote}</blockquote>}
                                    {!c.verified && <span className="rv-unverified">원문 대조 안 됨</span>}
                                  </div>
                                ))}
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {tab === "values" && (
              <div>
                <p className="rv-help">모델에서 읽고 잰 값입니다. 모델에 없는 값(용도지역, 도로 등)을 채우거나 고친 뒤 다시 검토하세요.</p>
                <ValuesForm values={values} onChange={editValue} disabled={checking} />
                <div className="rv-actions">
                  <div className="rv-opt"><span>지역</span><RegionPicker value={region} onChange={r => { setRegion(r); setDirty(true); }} placement="up" /></div>
                  <button type="button" className="primary" disabled={checking || !facts} onClick={() => facts && void check(facts, values, region)}>{dirty ? "수정값으로 다시 검토" : "다시 검토"}</button>
                </div>
              </div>
            )}

            {tab === "report" && result && (
              <div className="bim-report">
                <div className="rv-files">
                  <button type="button" className="ghost rv-file" disabled={!!exporting} onClick={() => void exportBcf()}>BCF 이슈 (.bcfzip)</button>
                  <button type="button" className="ghost rv-file" onClick={() => download("bim-corrections.md", result.md, "text/markdown")}>보완요구서 (.md)</button>
                  <button type="button" className="ghost rv-file" onClick={() => download("bim-review.json", JSON.stringify({ facts, result }, null, 2))}>검토 결과 (.json)</button>
                </div>
                <p className="rv-help">BCF 파일은 Revit(BIMcollab Zoom·Revizto·BCF Manager 플러그인), Solibri, Navisworks에서 열면 문제 요소가 선택된 시점으로 이동합니다.</p>
                <Markdown text={result.md.replace(/^\|.*$/gm, "").replace(/`/g, "")} max={0} onCite={() => {}} />
              </div>
            )}

            {tab === "model" && facts && (
              <div className="bim-model">
                <table className="rv-table">
                  <tbody>
                    <tr><th>프로젝트</th><td>{facts.source.project || "-"}</td></tr>
                    <tr><th>작성 프로그램</th><td>{facts.source.application || "-"}</td></tr>
                    <tr><th>스키마</th><td>{facts.source.schema}</td></tr>
                    <tr><th>대지면적</th><td>{facts.site.area ? `${facts.site.area.toLocaleString()}㎡ (${facts.site.areaSource === "property" ? "속성" : facts.site.areaSource === "boundary" ? "대지경계선" : "-"})` : "없음"}</td></tr>
                    <tr><th>건축면적</th><td>{facts.building.footprint.toLocaleString()}㎡ (외곽 {facts.building.footprintOuter.toLocaleString()}㎡, 벽 두께 {facts.building.wallThickness}m, ±{facts.building.areaTolerance}㎡)</td></tr>
                    <tr><th>연면적</th><td>{facts.building.grossFloorArea.toLocaleString()}㎡</td></tr>
                    <tr><th>높이·층수</th><td>{facts.building.height}m · 지상 {facts.building.storeysAbove} / 지하 {facts.building.storeysBelow}</td></tr>
                    <tr><th>실 / 계단 / 문</th><td>{facts.spaces.length} / {facts.stairs.reduce((a, s) => a + s.flights.length, 0)}경간 / {facts.doors.length}</td></tr>
                    <tr><th>진북</th><td>{facts.site.northSource === "model" ? "모델 TrueNorth" : "없음(+Y를 정북으로 가정)"}</td></tr>
                  </tbody>
                </table>
                <h3 className="bim-subhead">층별</h3>
                <table className="rv-table">
                  <thead><tr><th>층</th><th>바닥면적</th><th>거실</th><th>계단</th><th></th></tr></thead>
                  <tbody>{facts.storeys.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.floorArea.toLocaleString()}㎡</td><td>{s.habitableArea.toLocaleString()}㎡</td><td>{s.stairCount}</td><td>{s.evacuation ? "피난층" : s.above ? "" : "지하"}</td></tr>)}</tbody>
                </table>
                {facts.quality.length > 0 && <><h3 className="bim-subhead">모델 정보 점검</h3>{facts.quality.map((q, i) => <div key={i} className="rv-note">{q.text}</div>)}</>}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
