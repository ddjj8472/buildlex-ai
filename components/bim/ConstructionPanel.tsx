"use client";
// 시공 단계 탭 — construction-stage duties judged from the measured model (lib/bim/construction.ts).
// A few planning facts the design model cannot hold are asked here; until answered the
// affected duties stay "확인 필요".
import { useEffect, useMemo, useState } from "react";
import { IconAlert } from "@/components/Icons";
import type { ConstructionInput, ConstructionItem, ConstructionResult, ConstructionStatus, Tri } from "@/lib/bim/construction";
import type { BimFacts, BimIssue } from "@/lib/bim/types";
import type { ProjectValues } from "@/lib/review/types";

const CLS: Record<ConstructionStatus, string> = { "대상": "do", "확인 필요": "warn", "비대상": "na" };
const STAGES = ["착공 전", "시공 중", "준공·해체"] as const;
const QUESTIONS: { key: keyof ConstructionInput; label: string; hint: string }[] = [
  { key: "publicClient", label: "공공(발주청) 발주", hint: "국가·지자체·공공기관이 발주하는 공사 — 설계안전성검토 판정" },
  { key: "ownerBuild", label: "건축주 직접 시공", hint: "소규모 건축물을 건설사업자 없이 짓는 경우 — 현장관리인 판정" },
  { key: "towerCrane", label: "타워크레인 사용", hint: "안전관리계획 대상(건설기술진흥법 시행령 제98조①5)" },
  { key: "piling", label: "항타·항발기 사용", hint: "안전관리계획 대상(같은 호)" },
  { key: "drill", label: "10m 이상 천공기 사용", hint: "안전관리계획 대상(같은 호)" },
];

export default function ConstructionPanel(props: { facts: BimFacts; values: ProjectValues; selKey?: string; onFocus: (i: BimIssue) => void; onResult?: (r: ConstructionResult) => void }) {
  const { facts, values, selKey, onFocus, onResult } = props;
  const [input, setInput] = useState<ConstructionInput>({});
  const [result, setResult] = useState<ConstructionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ "C-FALL": true });
  const valuesKey = useMemo(() => JSON.stringify({ u: values.주용도?.value, s: values.구조?.value }), [values]);

  useEffect(() => {
    const ctrl = new AbortController();
    setBusy(true); setError("");
    fetch("/api/bim/construction", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ facts, values: { 주용도: values.주용도, 구조: values.구조 }, input }) })
      .then(async res => { const d = await res.json().catch(() => ({ error: `서버 응답 오류(${res.status})` })); if (!res.ok || !d.ok) throw new Error(d.error || `요청 실패(${res.status})`); return d.result as ConstructionResult; })
      .then(r => { setResult(r); onResult?.(r); })
      .catch(e => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!ctrl.signal.aborted) setBusy(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, valuesKey, input]);

  const set = (k: keyof ConstructionInput, v: Tri) => setInput(cur => ({ ...cur, [k]: v }));
  const counts = result ? (["대상", "확인 필요", "비대상"] as const).map(s => [s, result.items.filter(i => i.status === s).length] as const) : [];

  return (
    <div className="bim-cs">
      <p className="rv-help">이 건물을 지을 때 생기는 안전·절차 의무입니다. 층수·높이·연면적·지하 깊이는 모델에서 읽고, 기준값은 건설기술진흥법·산업안전보건법·건축법 원문에서 읽습니다.</p>
      <div className="bim-cs-q">
        {QUESTIONS.map(q => (
          <div key={q.key} className="bim-cs-row" title={q.hint}>
            <span className={result?.asked.includes(q.key) ? "need" : ""}>{q.label}</span>
            <div className="seg" role="group" aria-label={q.label}>
              {([["yes", "예"], ["no", "아니오"], ["unknown", "모름"]] as const).map(([v, l]) => (
                <button key={v} type="button" className={(input[q.key] ?? "unknown") === v ? "on" : ""} onClick={() => set(q.key, v)}>{l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {busy && <div className="rv-help"><span className="caret" /> 시공 단계 의무를 판정하는 중…</div>}
      {error && <div className="rv-error"><IconAlert size={16} /> {error}</div>}
      {result && (
        <>
          <div className="bim-cs-count">{counts.map(([s, n]) => <span key={s} className={`rv-badge ${CLS[s]}`}>{s} {n}</span>)}</div>
          {STAGES.map(stage => (
            <div key={stage} className="bim-section">
              <h3>{stage}</h3>
              {result.items.filter(i => i.stage === stage).map(i => <Item key={i.id} i={i} open={!!open[i.id]} toggle={() => setOpen(o => ({ ...o, [i.id]: !o[i.id] }))} selKey={selKey} onFocus={onFocus} />)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Item({ i, open, toggle, selKey, onFocus }: { i: ConstructionItem; open: boolean; toggle: () => void; selKey?: string; onFocus: (x: BimIssue) => void }) {
  return (
    <div className={`rv-item ${CLS[i.status]}`}>
      <button type="button" className="bim-rule-head" onClick={toggle} aria-expanded={open}>
        <span className={`rv-badge ${CLS[i.status]}`}>{i.status}</span>
        <strong>{i.title}</strong>
        {i.estimated && <span className="chip">추정 포함</span>}
        {i.issues.length > 0 && <span className="chip">{i.issues.length}곳</span>}
        {i.when && <span className="bim-count">{i.when}</span>}
      </button>
      {open && (
        <div className="rv-item-body">
          {i.reason.map((r, k) => <div key={k}><span className="rv-k">{k === 0 ? "판정" : ""}</span>{r}</div>)}
          {i.status !== "비대상" && i.duty.map((d, k) => <div key={`d${k}`}><span className="rv-k">{k === 0 ? "할 일" : ""}</span>{d}</div>)}
          {i.status !== "비대상" && i.to && <div><span className="rv-k">제출처</span>{i.to}</div>}
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
        </div>
      )}
    </div>
  );
}
