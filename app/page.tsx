"use client";

import { FormEvent, useState } from "react";
import { SCOPE_LABELS } from "@/data/law-scope";

type Source = {
  lawName: string;
  article: string;
  effectiveDate: string;
  url: string;
  sourceType: string;
};

type Result = {
  answer: string;
  topics: string[];
  sources: Source[];
  demoOc?: boolean;
};

const EXAMPLES = [
  "제2종 일반주거지역에서 건폐율과 용적률은 어떻게 확인하나요?",
  "건축허가와 건축신고는 어떤 기준으로 구분되나요?",
  "근린생활시설을 음식점으로 용도변경할 때 무엇을 확인해야 하나요?",
];

function formatDate(date: string) {
  return /^\d{8}$/.test(date) ? `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6)}` : date;
}

export default function Home() {
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [region, setRegion] = useState("용인시");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, region }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "검색 중 오류가 발생했습니다.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "검색 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <nav className="nav">
        <a className="brand" href="#top" aria-label="BuildLex AI 홈">
          <span className="brandMark">BL</span>
          <span>BuildLex <b>AI</b></span>
        </a>
        <span className="status"><i /> 법제처 현행법령 연동</span>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow">ARCHITECTURE × REGULATION × AI</div>
        <h1>건축법규를<br /><span>근거부터</span> 찾습니다.</h1>
        <p className="lead">질문을 분석해 관련 현행 조문을 먼저 검색하고,<br className="desktop" /> 검색된 근거 안에서만 AI가 답변합니다.</p>

        <form className="searchCard" onSubmit={submit}>
          <div className="fieldRow">
            <label className="regionField">
              <span>적용 지역</span>
              <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="예: 용인시" maxLength={20} />
            </label>
            <label className="queryField">
              <span>법규 질문</span>
              <textarea value={query} onChange={(event) => setQuery(event.target.value)} rows={3} maxLength={500} placeholder="건축허가, 용도변경, 건폐율 등을 질문해 보세요." />
            </label>
          </div>
          <div className="searchFooter">
            <span>지역을 입력하면 해당 건축 조례도 함께 검색합니다.</span>
            <button disabled={loading || query.trim().length < 4}>
              {loading ? <><i className="spinner" /> 조문 검색 중</> : <>근거 검색하기 <b>→</b></>}
            </button>
          </div>
        </form>

        <div className="examples" aria-label="예시 질문">
          <span>예시</span>
          {EXAMPLES.map((example, index) => (
            <button key={example} onClick={() => setQuery(example)}>{index + 1}. {example}</button>
          ))}
        </div>
      </section>

      {error && <section className="notice error"><b>검색을 완료하지 못했습니다.</b><span>{error}</span></section>}

      {result && (
        <section className="resultSection" aria-live="polite">
          <div className="resultHeader">
            <div>
              <span className="kicker">SEARCH RESULT</span>
              <h2>법규 검토 결과</h2>
            </div>
            <div className="topicTags">{result.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
          </div>

          <div className="resultGrid">
            <article className="answerCard">
              <div className="cardLabel"><span>AI</span> 근거 기반 답변</div>
              <div className="answerText">{result.answer}</div>
              <div className="disclaimer">교육용 검색 보조 결과입니다. 실제 인허가 판단은 대상지 조건과 최신 조례를 바탕으로 관할 허가권자에게 확인하세요.</div>
            </article>

            <aside className="sourceCard">
              <div className="cardLabel"><span>{result.sources.length}</span> 확인한 조문</div>
              <ol>
                {result.sources.map((source, index) => (
                  <li key={`${source.lawName}-${source.article}-${index}`}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      <small>{source.sourceType} · 시행 {formatDate(source.effectiveDate)}</small>
                      <strong>{source.lawName}</strong>
                      <span>{source.article} <b>↗</b></span>
                    </a>
                  </li>
                ))}
              </ol>
              {result.demoOc && <p className="demoBadge">현재 법제처 발표용 OC를 사용 중입니다.</p>}
            </aside>
          </div>
        </section>
      )}

      <section className="scopeSection">
        <div>
          <span className="kicker">MVP SCOPE</span>
          <h2>발표에 필요한 범위만<br />명확하게 담았습니다.</h2>
        </div>
        <div className="scopeGrid">
          {SCOPE_LABELS.map((label, index) => (
            <div className="scopeItem" key={label}><span>{String(index + 1).padStart(2, "0")}</span><b>{label}</b></div>
          ))}
        </div>
      </section>

      <footer>
        <span>BuildLex AI · 교육용 MVP</span>
        <span>법령 데이터: 국가법령정보센터</span>
      </footer>
    </main>
  );
}
