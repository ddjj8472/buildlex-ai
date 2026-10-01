"use client";
// Plan-review orchestrator. The browser runs the phases in order, keeps every
// artifact, and only ever sends each phase what it needs (page images go to Phase 2 only).
import Link from "next/link";
import { useRef, useState } from "react";
import { IconAlert, IconBack, IconLogo } from "@/components/Icons";
import RegionPicker from "@/components/RegionPicker";
import type { ComplianceFile, DraftCorrectionsFile, FieldKey, FieldValue, PageInput, ProjectValues, ReviewArtifacts, ReviewScope, ReviewSummary, SheetFindingsFile, SheetManifest } from "@/lib/review/types";
import { sheetFromText } from "@/lib/review/utils/read-text";
import { detectReviewPhases, mergeValues, plannedGroups } from "@/lib/review/utils/session";
import { openPdf, pageImage, pageText, titleBlock, type PdfDoc } from "./pdf-client";
import ProgressPhases from "./ProgressPhases";
import ResultsViewer from "./ResultsViewer";
import ValuesForm from "./ValuesForm";

type Log = { at: number; text: string; kind?: "warn" | "err" };
const MAX_PAGES = 120;
const SAMPLES = [
  { file: "/samples/case-a-compliant.pdf", label: "가상 도면 A (적합 예시)" },
  { file: "/samples/case-b-violations.pdf", label: "가상 도면 B (위반 포함)" },
];

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/review/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `서버 응답 오류(${res.status})` }));
  if (!res.ok || !data.ok) throw new Error(data.error || `요청 실패(${res.status})`);
  return data.result as T;
}

/** Run tasks with at most `n` in flight (rolling window). */
async function rolling<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export default function ReviewDashboard() {
  const [fileName, setFileName] = useState("");
  const [region, setRegion] = useState("");
  const [scope, setScope] = useState<ReviewScope>("full");
  const [pauseForValues, setPauseForValues] = useState(true);
  const [artifacts, setArtifacts] = useState<ReviewArtifacts>({});
  const [values, setValues] = useState<ProjectValues>({});
  const [busy, setBusy] = useState(false);
  const [awaitingValues, setAwaitingValues] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<Log[]>([]);
  const started = useRef(0);
  const docRef = useRef<PdfDoc | null>(null);
  const artRef = useRef<ReviewArtifacts>({});

  const say = (text: string, kind?: Log["kind"]) => setLog(l => [...l, { at: Date.now() - started.current, text, kind }]);
  const put = <K extends keyof ReviewArtifacts>(k: K, v: ReviewArtifacts[K]) => { artRef.current = { ...artRef.current, [k]: v }; setArtifacts(artRef.current); };
  const phase = detectReviewPhases(artifacts);

  async function start(source: File | { url: string; name: string }) {
    setBusy(true); setError(""); setLog([]); setArtifacts({}); artRef.current = {}; setValues({}); setAwaitingValues(false);
    started.current = Date.now();
    try {
      // Phase 1 — Extract & Map
      const name = source instanceof File ? source.name : source.name;
      setFileName(name);
      say(`PDF 열기: ${name}`);
      const buf = source instanceof File ? await source.arrayBuffer() : await (await fetch(source.url)).arrayBuffer();
      await docRef.current?.destroy().catch(() => {});
      const doc = await openPdf(buf);
      docRef.current = doc;
      const n = Math.min(doc.numPages, MAX_PAGES);
      if (doc.numPages > MAX_PAGES) say(`${doc.numPages}쪽 중 앞 ${MAX_PAGES}쪽만 검토합니다.`, "warn");
      const pages: PageInput[] = [];
      for (let i = 1; i <= n; i++) {
        const t = await pageText(doc, i);
        pages.push({ page: i, text: t.text, width: t.width, height: t.height });
      }
      const withText = pages.filter(p => p.text.trim().length > 20).length;
      say(`텍스트 레이어 ${withText}/${n}쪽 추출`);
      const unknown = pages.filter(p => { const s = sheetFromText(p.page, p.text); return s.source === "fallback" || s.sheet_type === "other"; }).slice(0, 16);
      for (const p of unknown) p.titleBlock = await titleBlock(doc, p.page);
      if (unknown.length) say(`표제란 이미지 ${unknown.length}장 준비(도면번호 판독용)`);
      const manifest = await post<SheetManifest>("manifest", { pages: pages.map(p => ({ page: p.page, text: p.text, titleBlock: p.titleBlock })), region: region || undefined });
      put("sheet-manifest.json", manifest);
      say(`도면목록: ${manifest.sheets.length}장 · ${manifest.project.regionLabel || "지역 미판독"}`);
      manifest.notes.forEach(x => say(x, "warn"));

      // Phase 2 — Sheet-by-sheet review (discipline groups, 3 in flight)
      const plan = plannedGroups(manifest, scope);
      const imageCache = new Map<number, Promise<string>>();
      const img = (page: number) => { if (!imageCache.has(page)) imageCache.set(page, pageImage(doc, page)); return imageCache.get(page)!; };
      const files = await rolling(plan, 3, async ({ group, sheets }) => {
        say(`[${group.label}] ${sheets.length ? sheets.map(s => s.sheet_id).join(", ") : "해당 도면 없음"} 검토 시작`);
        const groupPages = await Promise.all(sheets.map(async s => ({ page: s.page, text: pages.find(p => p.page === s.page)?.text || "", image: await img(s.page) })));
        try {
          const r = await post<SheetFindingsFile>("sheet-review", { group: group.key, pages: groupPages, manifest, scope });
          say(`[${group.label}] 판독 ${r.findings.length}건, 값 ${Object.keys(r.values).length}개`);
          r.notes.forEach(x => say(`[${group.label}] ${x}`, "warn"));
          return r;
        } catch (e) {
          say(`[${group.label}] 실패: ${e instanceof Error ? e.message : e}`, "err");
          return { group: group.key, findings: [], values: {}, notes: [`검토 실패: ${e instanceof Error ? e.message : e}`] } as SheetFindingsFile;
        }
      });
      put("sheet_findings.json", files);
      const merged = mergeValues(files);
      setValues(merged);
      if (pauseForValues) { setAwaitingValues(true); say("판독값을 확인·수정한 뒤 [법령 검증 계속]을 누르세요."); return; }
      await finish(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      say(e instanceof Error ? e.message : String(e), "err");
    } finally { setBusy(false); }
  }

  async function finish(v: ProjectValues) {
    setBusy(true); setAwaitingValues(false); setError("");
    try {
      const a = artRef.current;
      const manifest = a["sheet-manifest.json"]!;
      const files = a["sheet_findings.json"] || [];
      const findings = files.flatMap(f => f.findings);
      const regionKey = region || manifest.project.region;
      say("국가 법령 기준 검증(3A)");
      const state = await post<ComplianceFile>("compliance", { scope: "state", values: v, findings, region: regionKey, reviewScope: scope });
      put("state_compliance.json", state);
      say(`자치법규(조례) 검증(3B): ${manifest.project.regionLabel || region || "지역 미지정"}`);
      const city = await post<ComplianceFile>("compliance", { scope: "city", values: v, findings, region: regionKey, reviewScope: scope, state });
      put("city_compliance.json", city);
      say("보완요구서(안) 작성(4)");
      const r = await post<{ draft: DraftCorrectionsFile; md: string; summary: ReviewSummary }>("draft", { manifest, findings: files, state, city });
      put("draft_corrections.json", r.draft); put("draft_corrections.md", r.md); put("review_summary.json", r.summary);
      say(`완료: 보완 요구 ${r.summary.corrections}건 (${((Date.now() - started.current) / 1000).toFixed(0)}초)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      say(e instanceof Error ? e.message : String(e), "err");
    } finally { setBusy(false); }
  }

  const editValue = (k: FieldKey, fv: FieldValue | undefined) => setValues(cur => { const next = { ...cur }; if (fv) next[k] = fv; else delete next[k]; return next; });
  const done = phase >= 5;

  return (
    <div className="rv-shell">
      <header className="rv-top">
        <Link href="/" className="ghost rv-back"><IconBack size={16} /> 법령 질의</Link>
        <div className="rv-brand"><span className="brand-mark"><IconLogo size={17} /></span><div><div className="brand-name">도면 법규검토</div><div className="brand-sub">건축허가 도서 자동 검토 · 보완요구서 초안</div></div></div>
      </header>

      <main className="rv-main">
        <section className="rv-card">
          <h2>1. 도면 업로드</h2>
          <p className="rv-help">PDF는 브라우저에서 페이지별로 처리되며, 검토에 필요한 몇 장의 이미지와 텍스트만 서버로 전송됩니다.</p>
          <div className="rv-upload">
            <label className={`rv-drop${busy ? " disabled" : ""}`}>
              <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void start(f); e.target.value = ""; }} />
              <span>{fileName ? `선택됨: ${fileName}` : "도면 PDF 선택"}</span>
            </label>
            <div className="rv-samples">
              {SAMPLES.map(s => <button key={s.file} type="button" className="ghost" disabled={busy} onClick={() => void start({ url: s.file, name: s.label })}>{s.label}</button>)}
            </div>
          </div>
          <div className="rv-options">
            <div className="rv-opt"><span>지역(선택)</span><RegionPicker value={region} onChange={setRegion} placement="down" /></div>
            <label className="rv-opt"><span>검토 범위</span>
              <select value={scope} disabled={busy} onChange={e => setScope(e.target.value as ReviewScope)}>
                <option value="full">전체 검토</option>
                <option value="administrative">도서 요건만(표지·개요)</option>
              </select>
            </label>
            <label className="rv-opt rv-check"><input type="checkbox" checked={pauseForValues} disabled={busy} onChange={e => setPauseForValues(e.target.checked)} /> 판독값 확인 후 진행</label>
          </div>
        </section>

        {(log.length > 0 || busy) && (
          <section className="rv-card">
            <ProgressPhases current={awaitingValues ? 2 : phase} failed={!!error} paused={awaitingValues || (!busy && phase < 5)} />
            <ul className="rv-log" aria-live="polite">
              {log.map((l, i) => <li key={i} className={l.kind}><time>{(l.at / 1000).toFixed(1)}s</time>{l.text}</li>)}
              {busy && <li className="rv-working"><span className="caret" /> 처리 중…</li>}
            </ul>
            {error && <div className="rv-error"><IconAlert size={16} /> {error}</div>}
          </section>
        )}

        {(awaitingValues || (artifacts["sheet_findings.json"] && !done && !busy)) && (
          <section className="rv-card">
            <h2>2. 판독값 확인</h2>
            <p className="rv-help">도면에서 읽은 값입니다. 틀리거나 비어 있는 값을 고친 뒤 검증을 계속하세요. 수정한 값은 판독 신뢰도 HIGH로 처리됩니다.</p>
            <ValuesForm values={values} onChange={editValue} disabled={busy} />
            <div className="rv-actions">
              <button type="button" className="primary" disabled={busy} onClick={() => void finish(values)}>법령 검증 계속</button>
            </div>
          </section>
        )}

        {done && (
          <section className="rv-card">
            <h2>3. 검토 결과</h2>
            <ResultsViewer artifacts={artifacts} />
            <div className="rv-actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => { setAwaitingValues(true); }}>판독값 고쳐서 다시 검증</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
