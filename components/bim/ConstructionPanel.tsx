"use client";
// 시공 단계 탭 — construction-stage duties judged from the measured model (lib/bim/construction.ts).
// A few planning facts the design model cannot hold are asked here; until answered the
// affected duties stay "확인 필요". Two views: by stage (착공 전 / 시공 중 / 준공·해체) and the
// construction sequence (4D: 굴착 → 기초 → 층별 골조 → 지붕 → 준공) with fall-protection lines in 3D.
import { useEffect, useMemo, useState } from "react";
import { IconAlert } from "@/components/Icons";
import type { ConstructionInput, ConstructionItem, ConstructionResult, ConstructionStatus, SequenceStep, Tri } from "@/lib/bim/construction";
import type { BimFacts, BimIssue } from "@/lib/bim/types";
import type { ProjectValues } from "@/lib/review/types";
import type { GuardOverlay } from "./Viewer3D";

const CLS: Record<ConstructionStatus, string> = { "대상": "do", "확인 필요": "warn", "비대상": "na" };
const STAGES = ["착공 전", "시공 중", "준공·해체"] as const;
type TriKey = "publicClient" | "ownerBuild" | "towerCrane" | "piling" | "drill" | "gangForm" | "noisyEquip";
const QUESTIONS: { key: TriKey; label: string; hint: string }[] = [
  { key: "publicClient", label: "공공(발주청) 발주", hint: "국가·지자체·공공기관이 발주하는 공사 — 설계안전성검토 판정" },
  { key: "ownerBuild", label: "건축주 직접 시공", hint: "소규모 건축물을 건설사업자 없이 짓는 경우 — 현장관리인 판정" },
  { key: "towerCrane", label: "타워크레인 사용", hint: "안전관리계획 대상(건설기술진흥법 시행령 제98조①5)" },
  { key: "piling", label: "항타·항발기 사용", hint: "안전관리계획 대상(같은 호)" },
  { key: "drill", label: "10m 이상 천공기 사용", hint: "안전관리계획 대상(같은 호)" },
  { key: "gangForm", label: "갱폼·ACS 등 작업발판 일체형 거푸집", hint: "가설구조물 구조안전 확인 대상(시행령 제101조의2①2)" },
  { key: "noisyEquip", label: "굴착기·콘크리트펌프 등 5일 이상 사용", hint: "소음·진동관리법 시행규칙 별표 9 장비 — 특정공사 사전신고 판정" },
];
const KIND_LABEL: Record<SequenceStep["kind"], string> = { prep: "준비", excavation: "굴착", foundation: "기초", frame: "골조", roof: "지붕", completion: "준공" };

export default function ConstructionPanel(props: { facts: BimFacts; values: ProjectValues; selKey?: string; onFocus: (i: BimIssue) => void; onResult?: (r: ConstructionResult) => void; onGuards?: (g: GuardOverlay | null) => void; onStorey?: (id: number | null) => void }) {
  const { facts, values, selKey, onFocus, onResult, onGuards, onStorey } = props;
  const [input, setInput] = useState<ConstructionInput>({});
  const [cost, setCost] = useState("");
  const [result, setResult] = useState<ConstructionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ "C-FALL": true });
  const [view, setView] = useState<"stage" | "sequence">("stage");
  const [guardsOn, setGuardsOn] = useState(true);
  const [step, setStep] = useState<string | null>(null);
  const valuesKey = useMemo(() => JSON.stringify({ u: values.주용도?.value, s: values.구조?.value, z: values.용도지역?.value, n: values.세대수?.value }), [values]);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      fetch("/api/bim/construction", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ facts, values: { 주용도: values.주용도, 구조: values.구조, 용도지역: values.용도지역, 세대수: values.세대수 }, input }) })
        .then(async res => { const d = await res.json().catch(() => ({ error: `서버 응답 오류(${res.status})` })); if (!res.ok || !d.ok) throw new Error(d.error || `요청 실패(${res.status})`); return d.result as ConstructionResult; })
        .then(r => { setResult(r); onResult?.(r); })
        .catch(e => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!ctrl.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, valuesKey, input]);

  // Fall-protection lines for the 3D viewer: slab edges and openings that drop 2 m or more.
  const selectedStorey = view === "sequence" && step ? result?.sequence.find(s => s.key === step)?.storeyId : undefined;
  useEffect(() => {
    const cf = facts.construction;
    if (!onGuards) return;
    if (!guardsOn || !cf?.levels.length || !result?.fall) { onGuards(null); return; }
    const min = result.fall.minDrop;
    const lv = cf.levels.filter(l => selectedStorey === undefined || l.storeyId === selectedStorey);
    onGuards({
      edges: lv.filter(l => l.edgeDrop >= min).map(l => ({ z: l.z, segs: l.edges })),
      openings: lv.flatMap(l => l.openings.filter(o => o.drop >= min).map(o => ({ z: l.z, corners: o.corners, kind: o.kind }))),
    });
  }, [facts, guardsOn, result, selectedStorey, onGuards]);
  useEffect(() => () => onGuards?.(null), [onGuards]);

  const set = (k: TriKey, v: Tri) => setInput(cur => ({ ...cur, [k]: v }));
  const counts = result ? (["대상", "확인 필요", "비대상"] as const).map(s => [s, result.items.filter(i => i.status === s).length] as const) : [];
  const asked = new Set(result?.asked || []);
  const issueById = useMemo(() => new Map((result?.items || []).flatMap(i => i.issues).map(i => [i.id, i])), [result]);

  return (
    <div className="bim-cs">
      <p className="rv-help">이 건물을 지을 때 생기는 안전·환경·절차 의무입니다. 층수·높이·연면적·굴착 깊이·세대수·슬래브 단부와 개구부는 모델에서 읽고, 기준값은 건설기술진흥법·산업안전보건법·지하안전법·소음진동관리법·대기환경보전법·주택법·건축법 원문에서 읽습니다.</p>
      <details className="bim-cs-q" open={!result || result.asked.length > 0}>
        <summary>공사 계획 정보 <small>모델에 없는 정보 — 모르면 '모름'으로 두세요</small></summary>
        {QUESTIONS.map(q => (
          <div key={q.key} className="bim-cs-row" title={q.hint}>
            <span className={asked.has(q.key) ? "need" : ""}>{q.label}</span>
            <div className="seg" role="group" aria-label={q.label}>
              {([["yes", "예"], ["no", "아니오"], ["unknown", "모름"]] as const).map(([v, l]) => (
                <button key={v} type="button" className={(input[q.key] ?? "unknown") === v ? "on" : ""} onClick={() => set(q.key, v)}>{l}</button>
              ))}
            </div>
          </div>
        ))}
        <div className="bim-cs-row" title="산업안전보건법 시행령 제52조: 총공사금액 20억원 이상이면 안전보건총괄책임자 지정">
          <span className={asked.has("costEok") ? "need" : ""}>공사예정금액</span>
          <span className="bim-cs-field"><input type="number" inputMode="decimal" min={0} step={0.1} value={cost} placeholder="예: 35" onChange={e => setCost(e.target.value)} onBlur={() => setInput(cur => ({ ...cur, costEok: Number(cost) > 0 ? Number(cost) : undefined }))} aria-label="공사예정금액(억원)" /> 억원</span>
        </div>
        <div className="bim-cs-row" title="입력하면 법정 처리기간으로 제출 권장일을 계산합니다">
          <span>착공 예정일</span>
          <span className="bim-cs-field"><input type="date" value={input.startDate || ""} onChange={e => setInput(cur => ({ ...cur, startDate: e.target.value || undefined }))} aria-label="착공 예정일" /></span>
        </div>
      </details>
      {busy && <div className="rv-help"><span className="caret" /> 시공 단계 의무를 판정하는 중…</div>}
      {error && <div className="rv-error"><IconAlert size={16} /> {error}</div>}
      {result && (
        <>
          <div className="bim-cs-count">
            {counts.map(([s, n]) => <span key={s} className={`rv-badge ${CLS[s]}`}>{s} {n}</span>)}
            <span className="chip" title="공동주택 세대수로 정해지는 인허가 경로">절차: {result.route}</span>
          </div>
          <div className="bim-cs-bar">
            <div className="seg" role="tablist" aria-label="보기">
              <button type="button" className={view === "stage" ? "on" : ""} onClick={() => { setView("stage"); setStep(null); onStorey?.(null); }}>단계별</button>
              <button type="button" className={view === "sequence" ? "on" : ""} onClick={() => setView("sequence")}>공정 순서</button>
            </div>
            {facts.construction?.levels.length ? <label className="bim-toggle"><input type="checkbox" checked={guardsOn} onChange={e => setGuardsOn(e.target.checked)} /> 3D 추락 방호 위치</label> : null}
          </div>

          {view === "stage" && STAGES.map(stage => (
            <div key={stage} className="bim-section">
              <h3>{stage}</h3>
              {result.items.filter(i => i.stage === stage).map(i => <Item key={i.id} i={i} open={!!open[i.id]} toggle={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))} selKey={selKey} onFocus={onFocus} fall={i.id === "C-FALL" ? result.fall : undefined} />)}
            </div>
          ))}

          {view === "sequence" && (
            <ol className="bim-seq">
              {result.sequence.map(s => (
                <li key={s.key} className={`bim-seq-step ${s.kind}${step === s.key ? " on" : ""}`}>
                  <button type="button" className="bim-seq-head" onClick={() => { const next = step === s.key ? null : s.key; setStep(next); onStorey?.(next ? s.storeyId ?? null : null); }}>
                    <span className="bim-seq-kind">{KIND_LABEL[s.kind]}</span>
                    <strong>{s.label}</strong>
                    {s.issues.length > 0 && <span className="chip warn">추락 위험 {s.issues.length}</span>}
                  </button>
                  {(s.duties.length > 0 || s.notes.length > 0 || (step === s.key && s.issues.length > 0)) && (
                    <div className="bim-seq-body">
                      {s.duties.map(d => {
                        const it = result.items.find(x => x.id === d.id);
                        return <div key={d.id} className="bim-seq-duty"><span className={`rv-badge ${CLS[d.status]}`}>{d.status}</span> {d.title}{it?.deadline?.date ? <small> · {it.deadline.date}까지 권장</small> : it?.when ? <small> · {it.when}</small> : null}</div>;
                      })}
                      {s.notes.map((n, k) => <div key={k} className="rv-note">{n}</div>)}
                      {step === s.key && s.issues.length > 0 && (
                        <ul className="bim-issues">
                          {s.issues.map(id => issueById.get(id)).filter((x): x is BimIssue => !!x).map(x => (
                            <li key={x.id}><button type="button" className={`bim-issue${selKey === x.id ? " on" : ""}`} onClick={() => onFocus(x)}><span className={`bim-sev ${x.severity}`}>{x.severity === "critical" ? "위험" : "주의"}</span><span><b>{x.title}</b><small>{x.detail}</small></span></button></li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="rv-help bim-cs-foot">공사 기간(일수)은 법정 근거가 없어 계산하지 않습니다. 착공 예정일을 넣으면 처리기간 기준으로 제출 권장일만 계산합니다.</p>
        </>
      )}
    </div>
  );
}

function Item({ i, open, toggle, selKey, onFocus, fall }: { i: ConstructionItem; open: boolean; toggle: () => void; selKey?: string; onFocus: (x: BimIssue) => void; fall?: ConstructionResult["fall"] }) {
  const ask = `/?q=${encodeURIComponent(`${i.title} 대상 기준과 절차를 알려줘`)}`;
  return (
    <div className={`rv-item ${CLS[i.status]}`}>
      <button type="button" className="bim-rule-head" onClick={toggle} aria-expanded={open}>
        <span className={`rv-badge ${CLS[i.status]}`}>{i.status}</span>
        <strong>{i.title}</strong>
        {i.estimated && <span className="chip">추정 포함</span>}
        {i.issues.length > 0 && <span className="chip">{i.issues.length}곳</span>}
        {i.deadline?.date ? <span className="bim-count">{i.deadline.date}까지</span> : i.when ? <span className="bim-count">{i.when}</span> : null}
      </button>
      {open && (
        <div className="rv-item-body">
          {i.reason.map((r, k) => <div key={k}><span className="rv-k">{k === 0 ? "판정" : ""}</span>{r}</div>)}
          {i.status !== "비대상" && i.duty.map((d, k) => <div key={`d${k}`}><span className="rv-k">{k === 0 ? "할 일" : ""}</span>{d}</div>)}
          {i.status !== "비대상" && i.to && <div><span className="rv-k">제출처</span>{i.to}</div>}
          {i.status !== "비대상" && i.deadline && <div><span className="rv-k">기한</span>{i.deadline.date ? `${i.deadline.date}까지 제출 권장 (착공 ${i.deadline.days}일 전)` : `착공 ${i.deadline.days}일 전까지 제출 권장 — 착공 예정일을 넣으면 날짜로 계산합니다`} · {i.deadline.basis}</div>}
          {fall && fall.levels.length > 0 && (
            <table className="rv-table bim-cs-qty">
              <thead><tr><th>층</th><th>단부 안전난간</th><th>개구부</th><th>개구부 둘레</th><th>덮개 면적</th></tr></thead>
              <tbody>
                {fall.levels.map(l => <tr key={l.storeyId}><td>{l.storey}</td><td>{l.edge ? `${l.edge.toLocaleString()}m` : "-"}</td><td>{l.openings || "-"}</td><td>{l.openingPerimeter ? `${l.openingPerimeter}m` : "-"}</td><td>{l.openingArea ? `${l.openingArea}㎡` : "-"}</td></tr>)}
                <tr className="sum"><td>합계</td><td>{fall.edgeTotal.toLocaleString()}m</td><td>{fall.openingCount}</td><td>{fall.openingPerimeter}m</td><td>{fall.openingArea}㎡</td></tr>
              </tbody>
            </table>
          )}
          {i.issues.length > 0 && (
            <ul className="bim-issues">
              {i.issues.map(x => (
                <li key={x.id}>
                  <button type="button" className={`bim-issue${selKey === x.id ? " on" : ""}`} onClick={() => onFocus(x)}>
                    <span className={`bim-sev ${x.severity}`}>{x.severity === "critical" ? "위험" : "주의"}</span>
                    <span><b>{x.title}</b><small>{x.detail}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {i.citations.length > 0 && (
            <details className="rv-cites">
              <summary>근거 조문 {new Set(i.citations.map(c => c.label)).size}건</summary>
              {i.citations.map((c, k) => (
                <div key={k} className="rv-cite">
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.label}</a>
                  {c.quote && <blockquote>{c.quote}</blockquote>}
                  {!c.verified && <span className="rv-unverified">원문 대조 안 됨</span>}
                </div>
              ))}
            </details>
          )}
          <a className="bim-cs-ask" href={ask} target="_blank" rel="noreferrer">이 제도를 법령 AI에게 묻기 →</a>
        </div>
      )}
    </div>
  );
}
