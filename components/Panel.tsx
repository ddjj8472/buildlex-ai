"use client";
import { useEffect, useRef, useState } from "react";
import type { EvidenceView, SiteFacts } from "@/lib/types";
import { formatDate } from "@/lib/text";
import { IconBack, IconClose, IconExternal } from "./Icons";
import RegionPicker from "./RegionPicker";
import { FACT_FIELDS, type Msg } from "./types";

export type PanelTab = "evidence" | "refs" | "facts";

const VIA_LABEL: Record<EvidenceView["via"], string> = {
  search: "검색", expand: "위임·연결", appendix: "별표", ordinance: "조례", knowledge: "운영지식",
};

type Detail = { id: string; lawName: string; articleNo: string; heading: string; text: string; level: string; effectiveDate: string; sourceUrl: string; refs: { id: string; label: string }[]; citedBy: { id: string; label: string }[] };

function EvidenceCard({ e, open, highlight, onToggle, onOpenRelated }: { e: EvidenceView; open: boolean; highlight: boolean; onToggle: () => void; onOpenRelated: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [highlight]);
  const boxy = /[┌│├└]/.test(e.text);
  return (
    <div ref={ref} className={`ev${highlight ? " hl" : ""}`} id={`ev-${e.n}`}>
      <button type="button" className="ev-head" onClick={onToggle} aria-expanded={open}>
        <span className="num">[{e.n}]</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="ev-title">{e.lawName} {e.articleNo}{e.heading ? ` (${e.heading})` : ""}</div>
          <div className="ev-sub"><span className={`lvl ${e.level}`}>{e.level}</span><span>{VIA_LABEL[e.via]}</span><span>시행 {formatDate(e.effectiveDate)}</span>{e.upcoming && <span style={{ color: "var(--warn)" }}>· {formatDate(e.upcoming)} 개정 시행예정</span>}</div>
        </span>
      </button>
      {open && (
        <div className="ev-body">
          {e.path && <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>{e.path}</div>}
          <div className={`ev-text${boxy ? " box" : ""}`}>{e.text}</div>
          <div className="ev-actions">
            <a className="link-btn" href={e.sourceUrl} target="_blank" rel="noreferrer">국가법령정보센터 원문 <IconExternal size={13} /></a>
            {e.attachment && <a className="link-btn" href={e.attachment} target="_blank" rel="noreferrer">별표 첨부 <IconExternal size={13} /></a>}
          </div>
          {e.related.length > 0 && (
            <div className="related">
              <div className="related-title">이 조문이 인용하는 조문</div>
              {e.related.map(r => <button type="button" key={r.id} className="rel" onClick={() => onOpenRelated(r.id)}>→ {r.label}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Panel({ msg, tab, setTab, highlight, onClose, facts, setFacts, region, setRegion }: {
  msg: Msg | null; tab: PanelTab; setTab: (t: PanelTab) => void; highlight: number | null; onClose: () => void;
  facts: SiteFacts; setFacts: (f: SiteFacts) => void; region: string; setRegion: (r: string) => void;
}) {
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [stack, setStack] = useState<Detail[]>([]);
  useEffect(() => { if (highlight) setOpenIds(s => new Set(s).add(highlight)); setStack([]); }, [highlight, msg?.id]);

  const openRelated = async (id: string) => {
    const r = await fetch(`/api/article?id=${encodeURIComponent(id)}&region=${encodeURIComponent(region)}`).then(r => r.json()).catch(() => null);
    if (r?.chunk) setStack(s => [...s, { ...r.chunk, refs: r.refs, citedBy: r.citedBy }]);
  };

  const evidence = msg?.evidence || [];
  const groups: [string, EvidenceView[]][] = [
    ["검색된 조문", evidence.filter(e => e.via === "search")],
    ["위임·연결 조문 / 별표", evidence.filter(e => e.via === "expand" || e.via === "appendix")],
    ["지역 조례", evidence.filter(e => e.via === "ordinance")],
  ];
  const detail = stack.at(-1);

  return (
    <aside className="panel" aria-label="근거 패널">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className={`tab${tab === "evidence" ? " on" : ""}`} onClick={() => setTab("evidence")}>근거 조문{evidence.length ? ` ${evidence.length}` : ""}</button>
          <button type="button" role="tab" className={`tab${tab === "refs" ? " on" : ""}`} onClick={() => setTab("refs")}>해석례·운영지식</button>
          <button type="button" role="tab" className={`tab${tab === "facts" ? " on" : ""}`} onClick={() => setTab("facts")}>대지 조건</button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="패널 닫기"><IconClose /></button>
      </div>
      <div className="panel-body">
        {tab === "evidence" && detail && (
          <div>
            <button type="button" className="ghost" onClick={() => setStack(s => s.slice(0, -1))}><IconBack size={15} /> 뒤로</button>
            <div className="ev" style={{ marginTop: 8 }}>
              <div className="ev-head" style={{ cursor: "default" }}>
                <span style={{ flex: 1 }}>
                  <div className="ev-title">{detail.lawName} {detail.articleNo}{detail.heading ? ` (${detail.heading})` : ""}</div>
                  <div className="ev-sub"><span className={`lvl ${detail.level}`}>{detail.level}</span><span>시행 {formatDate(detail.effectiveDate)}</span><span>답변 근거에는 포함되지 않은 조문</span></div>
                </span>
              </div>
              <div className="ev-body">
                <div className="ev-text">{detail.text}</div>
                <div className="ev-actions"><a className="link-btn" href={detail.sourceUrl} target="_blank" rel="noreferrer">원문 <IconExternal size={13} /></a></div>
                {detail.refs.length > 0 && <div className="related"><div className="related-title">인용하는 조문</div>{detail.refs.slice(0, 12).map(r => <button type="button" key={r.id} className="rel" onClick={() => openRelated(r.id)}>→ {r.label}</button>)}</div>}
                {detail.citedBy.length > 0 && <div className="related"><div className="related-title">이 조문을 인용하는 하위·관련 조문</div>{detail.citedBy.slice(0, 12).map(r => <button type="button" key={r.id} className="rel" onClick={() => openRelated(r.id)}>← {r.label}</button>)}</div>}
              </div>
            </div>
          </div>
        )}
        {tab === "evidence" && !detail && (
          evidence.length ? groups.filter(([, l]) => l.length).map(([label, list]) => (
            <section key={label}>
              <div className="group-label"><span>{label}</span><span>{list.length}</span></div>
              {list.map(e => (
                <EvidenceCard key={e.n} e={e} open={openIds.has(e.n)} highlight={highlight === e.n}
                  onToggle={() => setOpenIds(s => { const n = new Set(s); if (n.has(e.n)) n.delete(e.n); else n.add(e.n); return n; })}
                  onOpenRelated={openRelated} />
              ))}
            </section>
          )) : <div className="empty-note">질문하면 답변에 사용된 조문이 여기에 표시됩니다.</div>
        )}
        {tab === "refs" && (
          <div>
            <div className="group-label"><span>법제처 법령해석례</span></div>
            {msg?.interpretations?.length ? msg.interpretations.map((x, i) => (
              <div className="interp" key={i}>
                <h4>{x.title}</h4>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{x.agency} · {formatDate(x.date)}</div>
                {x.question && <div className="q"><b>질의</b> {x.question.slice(0, 280)}{x.question.length > 280 ? "…" : ""}</div>}
                {x.answer && <div className="q"><b>회답</b> {x.answer.slice(0, 320)}{x.answer.length > 320 ? "…" : ""}</div>}
                <a className="link-btn" href={x.url} target="_blank" rel="noreferrer">원문 <IconExternal size={13} /></a>
              </div>
            )) : <div className="empty-note">연결된 해석례가 없습니다. 법제처 API 키(LAW_API_OC)를 설정하면 질의회신 사례를 함께 검색합니다.</div>}
            <div className="group-label"><span>운영지식 (검토 메모)</span></div>
            {msg?.notes?.length ? msg.notes.map((n, i) => (
              <div className="interp" key={i}><h4>{n.title}</h4><div className="q">{n.text}</div></div>
            )) : <div className="empty-note">관련 운영지식이 없습니다.</div>}
          </div>
        )}
        {tab === "facts" && (
          <div>
            <p className="facts-hint">대화 중 확인된 조건이 자동으로 채워집니다. 직접 입력하면 이후 질문의 검색과 답변에 반영됩니다.</p>
            <div className="field"><label>지역 (조례 검색)</label><RegionPicker value={region} onChange={setRegion} placement="down" /></div>
            {FACT_FIELDS.map(f => (
              <div className="field" key={f.key}>
                <label htmlFor={`f-${f.key}`}>{f.label}</label>
                <input id={`f-${f.key}`} value={facts[f.key] || ""} placeholder={f.placeholder} onChange={e => setFacts({ ...facts, [f.key]: e.target.value })} />
              </div>
            ))}
            <button type="button" className="ghost" onClick={() => setFacts({})}>조건 초기화</button>
          </div>
        )}
      </div>
    </aside>
  );
}
