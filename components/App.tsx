"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvalMode, SiteFacts, StreamEvent } from "@/lib/types";
import { IconAlert, IconBook, IconCheck, IconClose, IconInfo, IconLogo, IconMenu, IconMoon, IconPanel, IconPlus, IconSend, IconSliders, IconStop, IconSun, IconTrash } from "./Icons";
import Markdown from "./Markdown";
import Panel, { type PanelTab } from "./Panel";
import RegionPicker from "./RegionPicker";
import { STAGES, type Conversation, type Msg } from "./types";

const STORE = "bl-conversations-v2";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const SAMPLES = [
  { tag: "대지·밀도", q: "제2종 일반주거지역 대지에 제2종 근린생활시설을 지을 때 건폐율·용적률과 인접 대지경계선 이격거리는 어떻게 되나요?" },
  { tag: "용도변경", q: "근린생활시설 2층 사무소를 학원으로 용도변경하려면 허가를 받아야 하나요, 신고만 하면 되나요?" },
  { tag: "피난·방화", q: "지상 6층 업무시설에서 직통계단과 피난계단은 어떤 기준으로 설치해야 하나요?" },
  { tag: "공동주택", q: "아파트 단지 지상 주차장에 전기차 충전시설을 설치하려면 행위허가 대상인가요?" },
];

const COVERAGE = ["건축법·시행령·시행규칙", "국토계획법 3단", "주차장법 3단", "주택법·주택건설기준", "공동주택관리법", "피난·방화규칙", "구조·설비기준", "장애인편의법", "소방시설법", "녹색건축법", "전국 243개 지자체 건축·도시계획·주차장 조례"];

function load(): Conversation[] {
  try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; }
}
function save(list: Conversation[]) {
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 40))); } catch { /* quota or private mode */ }
}

function StagePill({ label, st }: { label: string; st?: { status: string; detail?: string; ms?: number } }) {
  const status = st?.status || "pending";
  return (
    <span className={`stage ${status}`} title={st?.detail || ""}>
      <span className="dot">{status === "running" ? <span className="spin" /> : status === "done" ? <IconCheck size={13} /> : status === "error" ? <IconAlert size={13} /> : <span style={{ width: 6, height: 6, borderRadius: 9, background: "currentColor", opacity: .5 }} />}</span>
      {label}{st?.ms !== undefined && status === "done" ? <span style={{ opacity: .6 }}>{(st.ms / 1000).toFixed(1)}s</span> : null}
    </span>
  );
}

function About({ onClose }: { onClose: () => void }) {
  const steps = [
    ["질의 분석", "일상어를 법령 용어로 바꾸고, 대지 조건과 관련 법령을 추출합니다."],
    ["법령 검색", "BM25(형태소·음절) + 의미 검색을 RRF로 융합하고 AI가 재순위합니다."],
    ["연결 조문", "법률→시행령→시행규칙 위임 조문, 별표, 지역 조례를 따라갑니다."],
    ["답변 생성", "검색된 조문만 근거로 결론·근거·해석·확인사항을 작성합니다."],
    ["인용 검증", "근거 번호와 인용 조문이 실제 존재하는지 기계적으로 확인합니다."],
    ["품질 평가", "근거 충실성을 채점하고, 부족하면 자동으로 재검색합니다."],
  ];
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="시스템 소개">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div><h2>BuildLex AI</h2><p className="lead">건축 법령을 조문 근거로 해석하는 AI 검색 서비스</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기"><IconClose /></button>
        </div>
        <h3>6단계 에이전트 파이프라인</h3>
        <div className="flow">{steps.map(([t, d], i) => <div className="flow-step" key={t}><span className="n">0{i + 1}</span><b>{t}</b>{d}</div>)}</div>
        <h3>데이터</h3>
        <ul>
          <li>국가법령: legalize-kr(국가법령정보센터 공개 데이터의 Git 스냅샷)에서 건축 관련 법령 86개 파일을 조문 단위로 색인</li>
          <li>자치법규: 전국 시·군·구 및 광역 본청의 건축 조례·도시계획 조례·주차장 조례</li>
          <li>별표 본문·법령해석례: 국가법령정보 Open API 실시간 조회(API 키 설정 시)</li>
        </ul>
        <h3>유의사항</h3>
        <ul>
          <li>답변은 법률 자문이 아니며 인허가 가능성을 확정하지 않습니다. 최종 판단은 관할 허가권자에게 확인하세요.</li>
          <li>현행 조문 기준입니다. 과거 허가·착공 건은 부칙 경과조치와 연혁 법령을 확인해야 합니다.</li>
        </ul>
      </div>
    </div>
  );
}

export default function App() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [evalMode, setEvalMode] = useState<EvalMode>("check");
  const [busy, setBusy] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("evidence");
  const [panelMsgId, setPanelMsgId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [about, setAbout] = useState(false);
  const [draftRegion, setDraftRegion] = useState("");
  const [draftFacts, setDraftFacts] = useState<SiteFacts>({});
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setConvs(load());
    try { const t = localStorage.getItem("bl-theme"); if (t === "light" || t === "dark") setTheme(t); } catch { /* ignore */ }
    try { const m = localStorage.getItem("bl-eval"); if (m === "none" || m === "check" || m === "auto") setEvalMode(m); } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (convs.length || localStorage.getItem(STORE)) save(convs); }, [convs]);

  const active = convs.find(c => c.id === activeId) || null;
  const region = active ? active.region : draftRegion;
  const facts = active ? active.facts : draftFacts;

  const setRegion = (r: string) => active ? setConvs(cs => cs.map(c => c.id === active.id ? { ...c, region: r } : c)) : setDraftRegion(r);
  const setFacts = (f: SiteFacts) => active ? setConvs(cs => cs.map(c => c.id === active.id ? { ...c, facts: f } : c)) : setDraftFacts(f);

  const panelMsg = useMemo(() => {
    if (!active) return null;
    const ai = active.messages.filter(m => m.role === "assistant");
    return ai.find(m => m.id === panelMsgId) || ai.at(-1) || null;
  }, [active, panelMsgId]);

  const toggleTheme = () => {
    const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("bl-theme", next); } catch { /* ignore */ }
  };

  const patchMsg = useCallback((convId: string, msgId: string, fn: (m: Msg) => Msg) => {
    setConvs(cs => cs.map(c => c.id !== convId ? c : { ...c, updatedAt: Date.now(), messages: c.messages.map(m => m.id === msgId ? fn(m) : m) }));
  }, []);

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    let conv = active;
    if (!conv) {
      conv = { id: uid(), title: q.slice(0, 40), createdAt: Date.now(), updatedAt: Date.now(), messages: [], facts: draftFacts, region: draftRegion };
      setConvs(cs => [conv!, ...cs]);
      setActiveId(conv.id);
    }
    const history = [] as { q: string; a?: string }[];
    for (let i = 0; i < conv.messages.length; i++) {
      const m = conv.messages[i];
      if (m.role === "user") history.push({ q: m.text, a: conv.messages[i + 1]?.role === "assistant" ? conv.messages[i + 1].text : undefined });
    }
    const userMsg: Msg = { id: uid(), role: "user", text: q, createdAt: Date.now() };
    const aiMsg: Msg = { id: uid(), role: "assistant", text: "", createdAt: Date.now(), stages: {}, warnings: [] };
    const convId = conv.id;
    setConvs(cs => cs.map(c => c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, userMsg, aiMsg] } : c));
    setPanelMsgId(aiMsg.id);
    setHighlight(null);
    setBusy(true);
    scrollDown();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, region: conv.region, facts: conv.facts, history: history.slice(-3), evalMode }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `오류 ${res.status}` }));
        throw new Error(err.error || `오류 ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          const ev = JSON.parse(line.slice(5)) as StreamEvent;
          handle(convId, aiMsg.id, ev);
        }
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      patchMsg(convId, aiMsg.id, m => ({ ...m, done: true, error: aborted ? "사용자가 중단했습니다." : e instanceof Error ? e.message : "오류가 발생했습니다." }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      patchMsg(convId, aiMsg.id, m => ({ ...m, done: true, stages: Object.fromEntries(Object.entries(m.stages || {}).map(([k, v]) => [k, v?.status === "running" ? { ...v, status: "error" } : v])) }));
    }
  };

  const handle = (convId: string, msgId: string, ev: StreamEvent) => {
    switch (ev.type) {
      case "stage":
        patchMsg(convId, msgId, m => ({ ...m, stages: { ...m.stages, [ev.id]: { status: ev.status, detail: ev.detail, ms: ev.ms } } }));
        break;
      case "analysis":
        patchMsg(convId, msgId, m => ({ ...m, analysis: ev.analysis }));
        setConvs(cs => cs.map(c => {
          if (c.id !== convId) return c;
          const merged = { ...c.facts };
          for (const [k, v] of Object.entries(ev.analysis.facts)) if (v && k !== "지역" && !merged[k as keyof SiteFacts]) merged[k as keyof SiteFacts] = v;
          return { ...c, facts: merged, region: c.region || ev.analysis.facts.지역 || "" };
        }));
        break;
      case "evidence":
        patchMsg(convId, msgId, m => ({ ...m, evidence: ev.evidence, interpretations: ev.interpretations, notes: ev.notes }));
        if (window.innerWidth > 1180) setPanelOpen(true);
        break;
      case "delta":
        patchMsg(convId, msgId, m => ({ ...m, text: m.text + ev.text }));
        scrollDown();
        break;
      case "reset":
        patchMsg(convId, msgId, m => ({ ...m, text: "" }));
        break;
      case "warning":
        patchMsg(convId, msgId, m => ({ ...m, warnings: [...new Set([...(m.warnings || []), ev.message])] }));
        break;
      case "verify":
        patchMsg(convId, msgId, m => ({ ...m, verify: { ok: ev.ok, issues: ev.issues } }));
        break;
      case "evaluation":
        patchMsg(convId, msgId, m => ({ ...m, evaluation: ev }));
        break;
      case "done":
        patchMsg(convId, msgId, m => ({ ...m, done: true, llm: ev.llm, text: ev.answer || m.text }));
        break;
      case "error":
        patchMsg(convId, msgId, m => ({ ...m, error: ev.message }));
        break;
    }
  };

  const openCite = (msg: Msg, n: number) => {
    setPanelMsgId(msg.id);
    setPanelTab("evidence");
    setHighlight(null);
    requestAnimationFrame(() => setHighlight(n));
    setPanelOpen(true);
  };

  const newChat = () => { setActiveId(null); setSideOpen(false); setPanelOpen(false); setDraftFacts({}); setDraftRegion(""); taRef.current?.focus(); };
  const remove = (id: string) => { setConvs(cs => cs.filter(c => c.id !== id)); if (activeId === id) setActiveId(null); };

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, [input]);

  const composer = (
    <div className={`composer-wrap${active ? " docked" : ""}`}>
      <form className="composer" onSubmit={e => { e.preventDefault(); ask(input); }}>
        <textarea ref={taRef} rows={1} value={input} onChange={e => setInput(e.target.value)} placeholder={active ? "이어서 질문하세요 (대지 조건은 기억됩니다)" : "건축 법령에 대해 질문하세요. 예: 대지 안의 공지 기준은?"}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input); } }} aria-label="질문 입력" />
        <div className="composer-bar">
          <RegionPicker value={region} onChange={setRegion} />
          <button type="button" className={`pill${Object.values(facts).some(Boolean) ? " on" : ""}`} onClick={() => { setPanelTab("facts"); setPanelOpen(true); }}><IconSliders size={15} /><span className="hide-sm">대지 조건</span></button>
          <div className="seg" role="radiogroup" aria-label="품질 평가 모드">
            {([["none", "평가 없음"], ["check", "평가 후 확인"], ["auto", "자동 재검색"]] as [EvalMode, string][]).map(([k, l]) => (
              <button type="button" key={k} role="radio" aria-checked={evalMode === k} className={evalMode === k ? "on" : ""} onClick={() => { setEvalMode(k); try { localStorage.setItem("bl-eval", k); } catch { /* ignore */ } }}>{l}</button>
            ))}
          </div>
          {busy
            ? <button type="button" className="send stop" onClick={() => abortRef.current?.abort()} aria-label="중단"><IconStop /></button>
            : <button type="submit" className="send" disabled={!input.trim()} aria-label="질문 보내기"><IconSend /></button>}
        </div>
      </form>
      <div className="hint">답변은 법률 자문이 아니며 인허가 가능성을 확정하지 않습니다. 근거 번호를 눌러 원문을 확인하세요.</div>
    </div>
  );

  return (
    <div className={`shell${panelOpen ? " with-panel" : ""}`}>
      <div className={`backdrop${sideOpen ? " show" : ""}`} onClick={() => setSideOpen(false)} />
      <nav className={`sidebar${sideOpen ? " open" : ""}`} aria-label="대화 목록">
        <div className="brand">
          <div className="brand-mark"><IconLogo size={19} /></div>
          <div><div className="brand-name">BuildLex AI</div><div className="brand-sub">건축법령 해석 AI</div></div>
        </div>
        <button type="button" className="new-chat" onClick={newChat}><IconPlus size={16} /> 새 질문</button>
        <a className="side-link" href="/review"><IconSliders size={15} /> 도면 법규검토</a>
        <div className="side-label">최근 대화</div>
        <div className="conv-list">
          {convs.length === 0 && <div className="empty-note" style={{ textAlign: "left", padding: "4px 10px" }}>대화 기록은 이 브라우저에만 저장됩니다.</div>}
          {convs.map(c => (
            <div key={c.id} className={`conv${c.id === activeId ? " active" : ""}`} role="button" tabIndex={0}
              onClick={() => { setActiveId(c.id); setSideOpen(false); setPanelMsgId(null); }} onKeyDown={e => { if (e.key === "Enter") { setActiveId(c.id); setSideOpen(false); } }}>
              <span className="conv-title">{c.title}</span>
              <button type="button" className="conv-del" onClick={e => { e.stopPropagation(); remove(c.id); }} aria-label="대화 삭제"><IconTrash size={14} /></button>
            </div>
          ))}
        </div>
        <div className="side-foot">
          <button type="button" className="ghost" onClick={() => setAbout(true)}><IconInfo size={15} /> 시스템 소개</button>
          <button type="button" className="ghost" onClick={toggleTheme}>{theme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />} 화면 모드</button>
        </div>
      </nav>

      <main className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setSideOpen(true)} aria-label="메뉴"><IconMenu /></button>
          <div className="topbar-title">{active ? active.title : "인공지능 건축법령"}</div>
          {active && region && <span className="pill on hide-sm" style={{ pointerEvents: "none" }}>{region}</span>}
          <button type="button" className="icon-btn" onClick={() => setPanelOpen(o => !o)} aria-label="근거 패널"><IconPanel /></button>
        </header>

        <div className="scroll" ref={scrollRef}>
          {!active ? (
            <div className="hero">
              <div className="hero-eyebrow">ARCHITECTURE · REGULATION · AI</div>
              <h1>건축 법령, 조문 근거로 답합니다</h1>
              <p>법률·시행령·시행규칙과 지자체 조례를 함께 검색하고, 모든 답변에 원문 조문 번호를 붙입니다.</p>
              {composer}
              <div className="samples">
                {SAMPLES.map(s => <button type="button" key={s.q} className="sample" onClick={() => ask(s.q)}><span className="sample-tag">{s.tag}</span>{s.q}</button>)}
              </div>
              <div className="coverage">{COVERAGE.map(c => <span className="chip" key={c}>{c}</span>)}</div>
            </div>
          ) : (
            <div className="thread">
              {active.messages.map(m => m.role === "user" ? (
                <div className="msg-user" key={m.id}><div className="bubble">{m.text}</div></div>
              ) : (
                <div className="msg-ai" key={m.id}>
                  <div className="pipeline">{STAGES.map(s => <StagePill key={s.id} label={s.label} st={m.stages?.[s.id]} />)}</div>
                  {m.analysis && m.analysis.legalTerms.length > 0 && (
                    <div className="stage-detail">검색어: {m.analysis.legalTerms.slice(0, 8).join(" · ")}</div>
                  )}
                  {(m.text || m.error) && (
                    <div className="answer">
                      {m.text && <Markdown text={m.text} max={m.evidence?.length || 0} onCite={n => openCite(m, n)} streaming={!m.done && m.stages?.answer?.status === "running"} />}
                      {m.error && <div className="notice err"><IconAlert size={16} />{m.error}</div>}
                    </div>
                  )}
                  {!m.text && !m.error && !m.done && <div className="empty-note" style={{ textAlign: "left" }}>근거 조문을 찾는 중입니다…</div>}
                  {m.warnings && m.warnings.length > 0 && m.done && (
                    <div className="notice warn"><IconAlert size={16} /><ul>{m.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>
                  )}
                  {(m.verify || m.evaluation || m.evidence?.length) && (
                    <div className="meta-row">
                      {m.verify && <span className={`badge ${m.verify.ok ? (m.verify.issues.length ? "warn" : "ok") : "err"}`} title={m.verify.issues.join("\n")}>{m.verify.ok ? <IconCheck size={14} /> : <IconAlert size={14} />}{m.verify.ok ? (m.verify.issues.length ? "인용 확인 · 참고사항 있음" : "인용 검증 통과") : "인용 확인 필요"}</span>}
                      {m.evaluation && <span className={`badge ${m.evaluation.score >= 80 ? "ok" : m.evaluation.score >= 60 ? "warn" : "err"}`} title={[m.evaluation.verdict, ...m.evaluation.notes].join("\n")}>품질 {m.evaluation.score}점{m.evaluation.retried ? " · 재검색함" : ""}</span>}
                      {m.evidence && m.evidence.length > 0 && <button type="button" className="badge" onClick={() => { setPanelMsgId(m.id); setPanelTab("evidence"); setPanelOpen(true); }}><IconBook size={14} /> 근거 조문 {m.evidence.length}건</button>}
                    </div>
                  )}
                  {m.verify && m.verify.issues.length > 0 && (
                    <div className={`notice ${m.verify.ok ? "warn" : "err"}`}><IconAlert size={16} /><ul>{m.verify.issues.map(i => <li key={i}>{i}</li>)}</ul></div>
                  )}
                  {m.evidence && m.evidence.length > 0 && (
                    <div className="src-strip">
                      {m.evidence.slice(0, 10).map(e => (
                        <button type="button" key={e.n} className="src-card" onClick={() => openCite(m, e.n)}>
                          <span className="t"><span className="num">[{e.n}]</span> {e.articleNo} {e.heading}</span>
                          <span className="s"><span className={`lvl ${e.level}`} style={{ marginRight: 5 }}>{e.level}</span>{e.lawName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {active && composer}
      </main>

      {panelOpen && (
        <Panel msg={panelMsg} tab={panelTab} setTab={setPanelTab} highlight={highlight} onClose={() => setPanelOpen(false)}
          facts={facts} setFacts={setFacts} region={region} setRegion={setRegion} />
      )}
      {about && <About onClose={() => setAbout(false)} />}
    </div>
  );
}
