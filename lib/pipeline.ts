// Six-agent pipeline: 질의분석 → 법령검색 → 연결확장 → 답변생성 → 인용검증 → 품질평가(자동 재검색)
import fs from "node:fs";
import path from "node:path";
import { ruleAnalysis } from "./analyze-rules.ts";
import { findChunk, loadNational, resolveRegion } from "./corpus.ts";
import { fetchAppendix, lawApiEnabled, searchInterpretations } from "./law-api.ts";
import { FALLBACK_MODELS, FAST_MODEL, MODEL, generateJSON, hasLLM, isMock, streamText } from "./llm.ts";
import { answerPrompt, analysisPrompt, evaluationPrompt, rerankPrompt, type Note, type Turn } from "./prompts.ts";
import { hybridSearch, type Reranker } from "./search.ts";
import { lawKeyOf, formatDate } from "./text.ts";
import type { EvalMode, Evidence, EvidenceView, Interpretation, QueryAnalysis, SiteFacts, StageId, StreamEvent } from "./types.ts";
import { verifyAnswer } from "./verify.ts";

export type AskInput = {
  query: string;
  region?: string;
  facts?: SiteFacts;
  history?: Turn[];
  evalMode?: EvalMode;
  signal?: AbortSignal;
};

type Emit = (e: StreamEvent) => void;

let notesCache: (Note & { tags: string })[] | null = null;
function loadNotes() {
  if (!notesCache) {
    const file = path.join(process.cwd(), "data", "knowledge", "notes.json");
    notesCache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  }
  return notesCache!;
}

export function matchNotes(text: string, evidenceIds: string[]): Note[] {
  return loadNotes().filter(n => new RegExp(n.tags).test(text) || n.refs.some(r => evidenceIds.includes(r))).slice(0, 3);
}

/** 법령해석례: search with the leading legal term, keep items whose title shares the query's terms. */
async function relevantInterpretations(a: QueryAnalysis): Promise<Interpretation[]> {
  const terms = [...new Set([...a.legalTerms, ...a.standalone.split(/\s+/)])].map(t => t.replace(/\s+/g, "")).filter(t => t.length >= 2).slice(0, 14);
  const key = a.legalTerms[0] || a.standalone.slice(0, 20);
  const list = await searchInterpretations(key, 8);
  const scored = list
    .map(x => ({ x, s: terms.filter(t => x.title.replace(/\s+/g, "").includes(t)).length + terms.filter(t => (x.question || "").replace(/\s+/g, "").includes(t)).length * 0.5 }))
    .filter(v => v.s >= 1.5)
    .sort((p, q) => q.s - p.s);
  return scored.slice(0, 3).map(v => v.x);
}

async function stage<T>(emit: Emit, id: StageId, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> {
  const t = Date.now();
  emit({ type: "stage", id, status: "running" });
  try {
    const r = await fn();
    emit({ type: "stage", id, status: "done", ms: Date.now() - t, detail: detail?.(r) });
    return r;
  } catch (e) {
    emit({ type: "stage", id, status: "error", ms: Date.now() - t, detail: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

async function analyze(input: AskInput): Promise<QueryAnalysis> {
  const base = ruleAnalysis(input.query, input.history, input.facts);
  if (!hasLLM() || isMock()) return base;
  const national = loadNational();
  const names = [...new Set(national.corpus.laws.map(l => l.lawName))];
  try {
    const raw = await generateJSON<Partial<QueryAnalysis>>(analysisPrompt(input.query, input.history || [], input.facts || {}, names), { timeoutMs: 10000, signal: input.signal });
    const validLaws = (raw.laws || []).filter(n => typeof n === "string" && national.laws.has(lawKeyOf(n)));
    const cleanFacts = Object.fromEntries(Object.entries(raw.facts || {}).filter(([, v]) => typeof v === "string" && v.trim())) as SiteFacts;
    return {
      standalone: typeof raw.standalone === "string" && raw.standalone.length > 3 ? raw.standalone : base.standalone,
      intent: typeof raw.intent === "string" ? raw.intent : "",
      legalTerms: [...new Set([...(raw.legalTerms || []).filter(t => typeof t === "string").slice(0, 10), ...base.legalTerms])].slice(0, 16),
      laws: [...new Set([...validLaws, ...base.laws])],
      subQueries: (raw.subQueries || []).filter(q => typeof q === "string").slice(0, 3),
      facts: { ...base.facts, ...cleanFacts },
      missing: (raw.missing || base.missing).filter(x => typeof x === "string").slice(0, 3),
      offTopic: raw.offTopic === true,
      source: "llm",
    };
  } catch (e) {
    return { ...base, note: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
}

const llmReranker = (signal?: AbortSignal, onError?: (m: string) => void): Reranker => async (query, candidates) => {
  try { return await rerankOnce(query, candidates, signal); }
  catch (e) { onError?.((e instanceof Error ? e.message : String(e)).slice(0, 120)); return null; }
};

async function rerankOnce(query: string, candidates: Parameters<Reranker>[1], signal?: AbortSignal) {
  const items = candidates.map(c => ({ id: c.id, label: `${c.lawName} ${c.articleNo}(${c.heading})`, text: c.text.slice(0, 380).replace(/\s+/g, " ") }));
  const res = await generateJSON<{ scores: Record<string, number> }>(rerankPrompt(query, items), { model: FAST_MODEL, timeoutMs: 10000, signal });
  const m = new Map<string, number>();
  for (const [id, s] of Object.entries(res.scores || {})) if (typeof s === "number") m.set(id, Math.max(0, Math.min(3, s)));
  return m;
}

export function toView(e: Evidence, region?: string): EvidenceView {
  const c = e.chunk;
  const related = c.refs.slice(0, 8).map(id => {
    const r = findChunk(id, region);
    return r ? { id, label: `${r.lawName} ${r.articleNo}${r.heading ? `(${r.heading})` : ""}` } : null;
  }).filter((x): x is { id: string; label: string } => !!x);
  return {
    n: e.n, id: c.id, lawName: c.lawName, level: c.level, articleNo: c.articleNo, heading: c.heading, path: c.path,
    text: c.text, effectiveDate: c.effectiveDate, sourceUrl: c.sourceUrl, via: e.via, kind: c.kind, attachment: c.attachment, related,
    upcoming: loadNational().laws.get(c.lawKey)?.upcoming,
  };
}

function extractiveAnswer(evidence: Evidence[], analysis: QueryAnalysis, reason = "AI 답변 생성이 설정되지 않아(GEMINI_API_KEY 없음) 검색된 관련 조문만 제시합니다. 아래 근거 조문의 원문을 확인해 주십시오."): string {
  const top = evidence.slice(0, 6);
  const lines = top.map(e => `- ${e.chunk.lawName} ${e.chunk.articleNo}${e.chunk.heading ? `(${e.chunk.heading})` : ""}: ${e.chunk.text.replace(/\s+/g, " ").slice(0, 160)}… [${e.n}]`);
  return [
    "## 결론",
    reason,
    "## 근거 법령",
    ...lines,
    "## 추가 확인 사항",
    ...(analysis.missing.length ? analysis.missing.map((m, i) => `${i + 1}. ${m}`) : ["1. 대상지의 용도지역·건축물 용도·규모를 확인하십시오."]),
  ].join("\n");
}

function* mockAnswer(evidence: Evidence[], analysis: QueryAnalysis): Generator<string> {
  const e = evidence.slice(0, 4);
  const text = [
    "## 결론",
    `(모의 응답) 질문하신 사항은 ${e[0] ? `${e[0].chunk.lawName} ${e[0].chunk.articleNo}` : "관련 조문"}을 중심으로 판단합니다 [1]. 세부 기준은 연결된 시행령·조례에 따라 달라질 수 있습니다${e[1] ? " [2]" : ""}.`,
    "## 근거 법령",
    ...e.map(x => `- 「${x.chunk.lawName}」 ${x.chunk.articleNo}(${x.chunk.heading || "조문"}): ${x.chunk.text.replace(/\s+/g, " ").slice(0, 90)}… [${x.n}]`),
    "## 세부 해석",
    "1. 모의 모드에서는 실제 해석을 생성하지 않습니다. 인터페이스 확인용 문장입니다 [1].",
    "## 추가 확인 사항",
    ...(analysis.missing.length ? analysis.missing : ["대상지 용도지역"]).map((m, i) => `${i + 1}. ${m}`),
  ].join("\n");
  for (const piece of text.match(/[\s\S]{1,24}/g) || []) yield piece;
}

export async function runPipeline(input: AskInput, emit: Emit): Promise<void> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const evalMode = input.evalMode || "none";
  const region = resolveRegion(input.facts?.지역 || input.region);

  // 1. 질의 분석
  const analysis = await stage(emit, "analyze", () => analyze(input), a => `${a.source === "llm" ? "AI" : "규칙"} 분석 · 검색어 ${a.legalTerms.length}개 · 관련 법령 ${a.laws.length}개`);
  const effRegion = region || resolveRegion(analysis.facts.지역);
  if (effRegion) analysis.facts.지역 = effRegion.label;
  emit({ type: "analysis", analysis });
  if (analysis.note) emit({ type: "warning", message: `AI 질의 분석 대신 규칙 분석을 사용했습니다: ${analysis.note}` });
  if (analysis.offTopic) {
    for (const s of ["건축 행정 및 법령과 관련된 질문에 답변할 수 있습니다. ", "건축허가, 용도변경, 건폐율, 주차, 피난 기준처럼 구체적으로 질문해 주세요."]) emit({ type: "delta", text: s });
    for (const id of ["retrieve", "expand", "answer", "verify", "evaluate"] as StageId[]) emit({ type: "stage", id, status: "skipped" });
    emit({ type: "done", answer: "", llm: hasLLM() });
    return;
  }

  const warnings: string[] = [];
  let interpretations: Interpretation[] = [];

  const retrieve = async (a: QueryAnalysis) => {
    const [{ evidence, debug }, interp] = await Promise.all([
      hybridSearch(a, { region: effRegion, rerank: hasLLM() && !isMock() && elapsed() < 18000 ? llmReranker(input.signal, m => warnings.push(`AI 재순위 생략: ${m}`)) : undefined }),
      lawApiEnabled() ? relevantInterpretations(a).catch(() => []) : Promise.resolve([]),
    ]);
    interpretations = interp;
    if (debug.dense === "unavailable") warnings.push("의미 검색(임베딩) 색인이 없어 키워드·법률용어 확장 검색만 사용했습니다.");
    return { evidence, debug };
  };

  // 2. 법령 검색
  let { evidence, debug } = await stage(emit, "retrieve", () => retrieve(analysis),
    r => `${r.debug.lists.length}개 검색 목록 RRF 융합${r.debug.reranked ? " · AI 재순위" : ""} · ${r.evidence.filter(e => e.via === "search").length}건`);

  // 3. 연결 확장 (위임 조문, 별표 본문, 조례)
  const expandStage = async () => {
    let fetched = 0;
    for (const e of evidence.filter(x => x.chunk.kind === "appendix" && x.chunk.text.length < x.chunk.heading.length + 40)) {
      const body = await fetchAppendix(e.chunk.mst || "", e.chunk.articleNo).catch(() => null);
      if (body) { e.chunk = { ...e.chunk, text: `[${e.chunk.articleNo}] ${e.chunk.heading}\n${body}` }; fetched++; }
      else warnings.push(`${e.chunk.lawName} ${e.chunk.articleNo} 본문은 원문(첨부) 확인이 필요합니다.`);
    }
    if (!effRegion && analysis.missing.some(m => m.includes("지역"))) warnings.push("지역이 지정되지 않아 조례를 검색하지 않았습니다.");
    const laws = loadNational().laws;
    const pending = [...new Set(evidence.map(e => laws.get(e.chunk.lawKey)).filter(l => l?.upcoming).map(l => `${l!.lawName}(${formatDate(l!.upcoming!)} 시행)`))];
    if (pending.length) warnings.push(`시행 예정 개정이 있습니다: ${pending.slice(0, 4).join(", ")}. 답변은 현재 시행 중인 조문 기준입니다.`);
    return { fetched };
  };
  await stage(emit, "expand", expandStage, r => {
    const exp = evidence.filter(e => e.via === "expand").length;
    const ord = evidence.filter(e => e.via === "ordinance").length;
    return `위임·연결 조문 ${exp}건 · 조례 ${ord}건 · 별표 본문 ${r.fetched}건`;
  });
  let notes = matchNotes(`${analysis.standalone} ${analysis.legalTerms.join(" ")}`, evidence.map(e => e.chunk.id));
  emit({ type: "evidence", evidence: evidence.map(e => toView(e, effRegion?.key)), interpretations, notes: notes.map(n => ({ title: n.title, text: n.text })) });
  for (const w of warnings) emit({ type: "warning", message: w });

  const generate = async (): Promise<string> => {
    let answer = "";
    if (isMock()) {
      for (const d of mockAnswer(evidence, analysis)) { answer += d; emit({ type: "delta", text: d }); await new Promise(r => setTimeout(r, 12)); }
    } else if (!hasLLM()) {
      answer = extractiveAnswer(evidence, analysis);
      emit({ type: "delta", text: answer });
    } else {
      const prompt = answerPrompt({ query: input.query, analysis, region: effRegion?.label || "", evidence, interpretations, notes, warnings, history: input.history || [] });
      // Retry transient overload (429/503) with backoff, then fall back to other models,
      // and finally to an extractive answer so the retrieved evidence is never lost.
      const models = [...new Set([MODEL, ...FALLBACK_MODELS])];
      let lastError = "";
      for (const [i, model] of models.flatMap(m => [m, m]).entries()) {
        if (elapsed() > 44000) break;
        if (i > 0) await new Promise(r => setTimeout(r, 600 * i));
        try {
          if (answer) { emit({ type: "reset" }); answer = ""; }
          for await (const d of streamText(prompt, { model, signal: input.signal, timeoutMs: Math.max(10000, 52000 - elapsed()) })) { answer += d; emit({ type: "delta", text: d }); }
          if (answer.trim()) {
            if (model !== MODEL) emit({ type: "warning", message: `기본 모델이 혼잡해 ${model} 모델로 답변했습니다.` });
            return answer;
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          if (input.signal?.aborted || !/\b(404|429|500|502|503|504)\b|NOT_FOUND|UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|fetch failed/i.test(lastError)) break;
        }
      }
      if (answer) emit({ type: "reset" });
      answer = extractiveAnswer(evidence, analysis, `AI 모델이 일시적으로 응답하지 않아(${/429|RESOURCE_EXHAUSTED/.test(lastError) ? "이용량 제한" : "서버 혼잡"}) 검색된 근거 조문만 먼저 제시합니다. 잠시 후 다시 질문해 주세요.`);
      emit({ type: "delta", text: answer });
      emit({ type: "warning", message: "AI 답변 생성에 실패해 근거 조문 목록으로 대신했습니다." });
    }
    return answer;
  };

  // 4. 답변 생성
  let answer = await stage(emit, "answer", generate, a => `${a.length.toLocaleString()}자`);

  // 5. 인용 검증
  let check = await stage(emit, "verify", async () => verifyAnswer(answer, evidence), v => v.ok ? "인용 번호·조문 실존 확인" : `확인 필요 ${v.issues.length}건`);
  emit({ type: "verify", ok: check.ok, issues: check.issues });

  // 6. 품질 평가 / 자동 재검색
  if (evalMode === "none" || !hasLLM() || elapsed() > 42000) {
    emit({ type: "stage", id: "evaluate", status: "skipped", detail: evalMode === "none" ? "평가 없음 모드" : !hasLLM() ? "AI 키 없음" : "응답 시간 제한으로 생략" });
  } else try {
    const judge = async () => isMock()
      ? { score: 82, verdict: "모의 평가", issues: [], retryQueries: [] as string[] }
      : await generateJSON<{ score: number; verdict: string; issues: string[]; retryQueries: string[] }>(evaluationPrompt(input.query, answer, evidence), { timeoutMs: Math.max(5000, Math.min(15000, 52000 - elapsed())), signal: input.signal });
    let ev = await stage(emit, "evaluate", judge, r => `${r.score}점`);
    let retried = false;
    if (evalMode === "auto" && elapsed() < 26000 && (ev.score < 70 || !check.ok) && (ev.retryQueries?.length || !check.ok)) {
      retried = true;
      emit({ type: "warning", message: `품질 점수 ${ev.score}점 — 추가 검색 후 답변을 다시 작성합니다.` });
      const a2: QueryAnalysis = { ...analysis, subQueries: [...(ev.retryQueries || []), ...analysis.subQueries].slice(0, 3) };
      ({ evidence, debug } = await stage(emit, "retrieve", () => retrieve(a2), r => `재검색 · ${r.evidence.length}건`));
      await stage(emit, "expand", expandStage, () => "재확장");
      notes = matchNotes(`${a2.standalone} ${a2.legalTerms.join(" ")}`, evidence.map(e => e.chunk.id));
      emit({ type: "evidence", evidence: evidence.map(e => toView(e, effRegion?.key)), interpretations, notes: notes.map(n => ({ title: n.title, text: n.text })) });
      emit({ type: "reset" });
      answer = await stage(emit, "answer", generate, a => `재작성 ${a.length.toLocaleString()}자`);
      check = await stage(emit, "verify", async () => verifyAnswer(answer, evidence), v => v.ok ? "재검증 통과" : `확인 필요 ${v.issues.length}건`);
      emit({ type: "verify", ok: check.ok, issues: check.issues });
      ev = await stage(emit, "evaluate", judge, r => `재평가 ${r.score}점`);
    }
    emit({ type: "evaluation", score: ev.score, verdict: ev.verdict, notes: ev.issues || [], retried });
  } catch {
    // Evaluation is advisory: a failure here must not discard the answer.
  }
  void debug;
  emit({ type: "done", answer, llm: hasLLM() });
}
