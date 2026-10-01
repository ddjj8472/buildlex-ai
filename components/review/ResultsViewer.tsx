"use client";
import { useMemo, useState } from "react";
import { checkById } from "@/lib/review/checklists";
import type { CheckStatus, ComplianceItem, ReviewArtifacts } from "@/lib/review/types";
import { finalItems } from "@/lib/review/utils/session";

const STATUS: Record<CheckStatus, { ko: string; cls: string }> = {
  PASS: { ko: "적합", cls: "ok" }, FAIL: { ko: "부적합", cls: "err" }, UNCLEAR: { ko: "확인 필요", cls: "warn" }, NOT_APPLICABLE: { ko: "해당 없음", cls: "na" },
};
const ACTION = { CONFIRM: "확인", VERIFY: "검증", COMPLETE: "검토자 작성" };
const TIER = { 1: "국가 기준", 2: "조례 별표 미수록", 3: "조례 본문" } as const;

function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ItemCard({ it }: { it: ComplianceItem }) {
  const s = STATUS[it.status];
  return (
    <div className={`rv-item ${s.cls}`}>
      <div className="rv-item-head">
        <span className={`rv-badge ${s.cls}`}>{s.ko}</span>
        <strong>{it.check_id} {it.title}</strong>
        {it.tier && <span className="chip">{TIER[it.tier]}</span>}
        <span className="chip">법적 신뢰도 {it.code_confidence}</span>
      </div>
      <div className="rv-item-body">
        <div><span className="rv-k">기준</span>{it.requirement}</div>
        {it.provided && <div><span className="rv-k">계획</span>{it.provided.text}</div>}
        {it.reviewer && <div><span className="rv-k">검토자</span>{it.reviewer}</div>}
        {it.notes.filter(Boolean).map((n, i) => <div key={i} className="rv-note">{n}</div>)}
        {it.citations.length > 0 && (
          <details className="rv-cites">
            <summary>근거 조문 {new Set(it.citations.map(c => c.label)).size}건</summary>
            {it.citations.map((c, i) => (
              <div key={i} className="rv-cite">
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.label}</a>
                {c.quote && <blockquote>{c.quote}</blockquote>}
                {!c.verified && <span className="rv-unverified">원문 대조 안 됨</span>}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}

export default function ResultsViewer({ artifacts }: { artifacts: ReviewArtifacts }) {
  const [tab, setTab] = useState<"letter" | "items" | "sheets" | "files">("letter");
  const draft = artifacts["draft_corrections.json"];
  const items = useMemo(() => artifacts["state_compliance.json"] && artifacts["city_compliance.json"] ? finalItems(artifacts["state_compliance.json"], artifacts["city_compliance.json"]) : [], [artifacts]);
  const summary = artifacts["review_summary.json"];
  const manifest = artifacts["sheet-manifest.json"];
  const findings = artifacts["sheet_findings.json"] || [];

  return (
    <section className="rv-results">
      {summary && (
        <div className="rv-summary">
          <div><b>{summary.corrections}</b><span>보완 요구</span></div>
          <div className="err"><b>{summary.by_status.FAIL}</b><span>부적합</span></div>
          <div className="warn"><b>{summary.by_status.UNCLEAR}</b><span>확인 필요</span></div>
          <div className="ok"><b>{summary.by_status.PASS}</b><span>적합</span></div>
          <div className="na"><b>{summary.by_status.NOT_APPLICABLE}</b><span>해당 없음</span></div>
        </div>
      )}
      <div className="tabs rv-tabs" role="tablist">
        {([["letter", "보완요구서(안)"], ["items", "항목별 결과"], ["sheets", "시트별 판독"], ["files", "산출물"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "letter" && draft && (
        <div className="rv-letter">
          {draft.items.length === 0 && <p className="empty-note">자동 검토 범위에서 보완 요구 사항이 없습니다.</p>}
          <ol>
            {draft.items.map(c => (
              <li key={c.item_number} className={`rv-corr ${c.reviewer_action.toLowerCase()}`}>
                <p>{c.description}</p>
                <div className="rv-corr-meta">
                  <span>근거: {c.code_citation.join(", ")}</span>
                  <span>도면: {c.sheet_reference.join(", ") || "-"}</span>
                  <span>법적 {c.confidence} · 판독 {c.visual_confidence}</span>
                  <span className="rv-action">{ACTION[c.reviewer_action]}</span>
                </div>
              </li>
            ))}
          </ol>
          {draft.dropped.length > 0 && <p className="rv-note">법적 근거를 확인하지 못해 제외: {draft.dropped.map(d => `${d.check_id}(${d.reason})`).join(", ")}</p>}
        </div>
      )}

      {tab === "items" && <div className="rv-items">{items.map(it => <ItemCard key={it.check_id} it={it} />)}</div>}

      {tab === "sheets" && (
        <div className="rv-sheets">
          {manifest && (
            <details open>
              <summary>도면목록 {manifest.sheets.length}장 (sheet-manifest.json)</summary>
              <table className="rv-table"><thead><tr><th>쪽</th><th>도면번호</th><th>도면명</th><th>종류</th><th>판독</th></tr></thead>
                <tbody>{manifest.sheets.map(s => <tr key={s.page}><td>{s.page}</td><td>{s.sheet_id}</td><td>{s.title}</td><td>{s.sheet_type}</td><td>{s.source}</td></tr>)}</tbody></table>
            </details>
          )}
          {findings.map(f => (
            <details key={f.group} open>
              <summary>{f.group} — {f.findings.length}건</summary>
              <table className="rv-table"><thead><tr><th>항목</th><th>도면</th><th>표기</th><th>판독</th><th>관찰</th></tr></thead>
                <tbody>{f.findings.map((x, i) => <tr key={i}><td>{x.check_id} {checkById(x.check_id)?.title}</td><td>{x.sheet_id}</td><td><span className={`rv-badge ${STATUS[x.status].cls}`}>{STATUS[x.status].ko}</span></td><td>{x.visual_confidence}</td><td>{x.observation}</td></tr>)}</tbody></table>
              {f.notes.map((n, i) => <div key={i} className="rv-note">{n}</div>)}
            </details>
          ))}
        </div>
      )}

      {tab === "files" && (
        <div className="rv-files">
          {(Object.keys(artifacts) as (keyof ReviewArtifacts)[]).map(k => (
            <button key={k} type="button" className="ghost rv-file" onClick={() => {
              const v = artifacts[k];
              download(k, typeof v === "string" ? v : JSON.stringify(v, null, 2), k.endsWith(".md") ? "text/markdown" : "application/json");
            }}>{k}</button>
          ))}
        </div>
      )}
    </section>
  );
}
