/**
 * Plan Review Flow (도면 기반 법규검토) — city-side review of a permit drawing set.
 *
 *   Phase 1  runManifest       PDF pages → sheet-manifest.json (텍스트 레이어 + 표제란 판독)
 *   Phase 2  runSheetReview    one reviewer per discipline group → sheet_findings.json
 *   Phase 3A runCompliance     national statutes → state_compliance.json
 *   Phase 3B runCompliance     ordinances (city routing tiers) → city_compliance.json
 *   Phase 4  runDraft          merge + filter → draft_corrections.json/.md + review_summary.json
 *
 * Each phase is its own request (serverless 60 s budget); the browser orchestrates and
 * keeps the artifacts. Later phases read artifacts only.
 */
import { resolveRegion, listRegions } from "../../corpus.ts";
import { generateJSON, hasLLM, isMock, type InlineImage } from "../../llm.ts";
import { checkById, checksFor, REVIEW_GROUPS, type CheckItem } from "../checklists/index.ts";
import { sheetReviewPrompt, titleBlockPrompt } from "../prompts.ts";
import { cityCompliance } from "../skills/local-ordinance.ts";
import { nationalCompliance } from "../skills/korea-building.ts";
import { FIELD_KEYS, type CheckStatus, type ComplianceFile, type ComplianceItem, type Confidence, type DraftCorrection, type DraftCorrectionsFile, type FieldKey, type FieldValue, type PageInput, type ProjectValues, type ReviewScope, type ReviewSummary, type SheetEntry, type SheetFinding, type SheetFindingsFile, type SheetManifest, type SheetType } from "../types.ts";
import { readValues, sheetFromText, classifySheet } from "../utils/read-text.ts";
import { finalItems } from "../utils/session.ts";

const visionEnabled = () => hasLLM() && !isMock();

function toImage(dataUrl?: string): InlineImage | null {
  const m = dataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

// ───────────────────────── Phase 1: Extract & Map ─────────────────────────

export async function runManifest(pages: PageInput[], opts: { region?: string; deadlineMs?: number } = {}): Promise<SheetManifest> {
  const notes: string[] = [];
  const sheets = pages.map(p => sheetFromText(p.page, p.text));
  // Title blocks the text layer could not identify (scans, vectorised text) → vision.
  const unknown = sheets.filter(s => s.source === "fallback" || s.sheet_type === "other").map(s => pages.find(p => p.page === s.page)!).filter(p => p?.titleBlock).slice(0, 16);
  if (unknown.length && visionEnabled()) {
    try {
      const images = unknown.map(p => toImage(p.titleBlock)).filter((x): x is InlineImage => !!x);
      const r = await generateJSON<{ sheets?: { page: number; sheet_id?: string; title?: string; sheet_type?: SheetType }[] }>(titleBlockPrompt(unknown), { images, timeoutMs: opts.deadlineMs ?? 25000, maxTokens: 2048 });
      for (const v of r.sheets || []) {
        const s = sheets.find(x => x.page === v.page);
        if (!s) continue;
        if (v.sheet_id && s.source === "fallback") s.sheet_id = v.sheet_id;
        if (v.title) { s.title = v.title; s.sheet_type = v.sheet_type || classifySheet(v.title); }
        s.source = "vision";
      }
    } catch (e) { notes.push(`표제란 판독 실패: ${e instanceof Error ? e.message : String(e)} — 텍스트 기준으로 분류했습니다.`); }
  } else if (unknown.length) notes.push(`도면번호를 읽지 못한 페이지 ${unknown.length}개는 페이지 번호로 표시합니다.`);

  // Duplicate sheet ids (template title blocks) → suffix with page.
  const seen = new Map<string, number>();
  for (const s of sheets) { const n = seen.get(s.sheet_id) || 0; if (n) s.sheet_id = `${s.sheet_id}(${s.page}쪽)`; seen.set(s.sheet_id.replace(/\(\d+쪽\)$/, ""), n + 1); }

  const project: SheetManifest["project"] = {};
  for (const p of pages) {
    const v = readValues(p.text, { page: p.page });
    if (!project.address && typeof v.대지위치?.value === "string") project.address = v.대지위치.value;
    const name = p.text.match(/(?:공\s*사\s*명|사\s*업\s*명)\s*\|?\s*([^|\n]{4,60})/);
    if (!project.name && name) project.name = name[1].trim();
  }
  const region = opts.region ? listRegions().find(r => r.key === opts.region) || resolveRegion(opts.region) : resolveRegion(project.address);
  if (region) { project.region = region.key; project.regionLabel = region.label; }
  else notes.push("대지위치에서 시·군·구를 판독하지 못했습니다. 지역을 직접 선택하세요.");
  if (!pages.some(p => p.text.trim())) notes.push("텍스트 레이어가 없는 도면(스캔본)입니다. 이미지 판독에 의존합니다.");
  return { project, total_pages: pages.length, sheets, notes };
}

// ───────────────────────── Phase 2: Sheet-by-sheet review ─────────────────────────

const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function ruleFindings(checks: CheckItem[], sheets: SheetEntry[], perSheet: Map<string, ProjectValues>): SheetFinding[] {
  const out: SheetFinding[] = [];
  for (const c of checks) {
    if (!c.fields.length) continue;
    const scored = sheets.map(s => {
      const v = perSheet.get(s.sheet_id) || {};
      const have = c.fields.filter(f => v[f] !== undefined);
      return { s, v, have, typed: c.sheet_types.includes(s.sheet_type) };
    }).filter(x => x.typed || x.have.length);
    if (!scored.length) continue;
    const best = scored.sort((a, b) => b.have.length - a.have.length)[0];
    let status: CheckStatus = best.have.length ? "PASS" : "UNCLEAR";
    let observation = best.have.length ? `표기 확인: ${best.have.map(f => `${f} ${best.v[f]!.value === true ? "예" : best.v[f]!.value}${best.v[f]!.unit || ""}`).join(", ")}` : "텍스트 레이어에서 해당 표기를 찾지 못함";
    const missing = c.fields.filter(f => !best.have.includes(f));
    if (best.have.length && missing.length) observation += ` / 미확인: ${missing.join(", ")}`;
    if (c.id === "1A") {
      const stamp = String(best.v.건축사날인?.value || "");
      if (/템플릿/.test(stamp)) { status = "FAIL"; observation = `표제란 건축사명 칸에 템플릿 문구만 있음 (${stamp})`; }
      else if (stamp) observation = stamp;
    }
    out.push({ check_id: c.id, sheet_id: best.s.sheet_id, status, visual_confidence: best.have.length ? "MEDIUM" : "LOW", observation, code_ref: c.code_basis });
  }
  return out;
}

type VisionResult = { values?: Record<string, { value?: unknown; unit?: string; raw?: string; sheet_id?: string; confidence?: Confidence }>; findings?: Partial<SheetFinding>[] };

export async function runSheetReview(input: { group: string; pages: PageInput[]; manifest: SheetManifest; scope?: ReviewScope; deadlineMs?: number }): Promise<SheetFindingsFile> {
  const group = REVIEW_GROUPS.find(g => g.key === input.group);
  if (!group) throw new Error(`알 수 없는 검토 그룹: ${input.group}`);
  const allowed = new Set(checksFor(input.scope || "full").map(c => c.id));
  const checks = group.checklists.flatMap(c => c.items).filter(c => allowed.has(c.id));
  const sheets = input.pages.map(p => input.manifest.sheets.find(s => s.page === p.page)).filter((s): s is SheetEntry => !!s);
  const notes: string[] = [];

  // Text layer first (exact characters), per sheet.
  const perSheet = new Map<string, ProjectValues>();
  const values: ProjectValues = {};
  for (const p of input.pages) {
    const s = sheets.find(x => x.page === p.page);
    const v = readValues(p.text, { page: p.page, sheet_id: s?.sheet_id });
    perSheet.set(s?.sheet_id || `p${p.page}`, v);
    for (const [k, fv] of Object.entries(v) as [FieldKey, FieldValue][]) if (!values[k] || RANK[fv.confidence] > RANK[values[k]!.confidence]) values[k] = fv;
  }
  let findings = ruleFindings(checks, sheets, perSheet);

  // Vision reviewer: reads the sheet images against the checklist.
  const images = input.pages.map(p => toImage(p.image)).filter((x): x is InlineImage => !!x);
  if (images.length && visionEnabled()) {
    try {
      const prompt = sheetReviewPrompt(group.label, checks, sheets, input.pages.map(p => ({ sheet_id: sheets.find(s => s.page === p.page)?.sheet_id || `p${p.page}`, text: p.text })));
      const r = await generateJSON<VisionResult>(prompt, { images, timeoutMs: input.deadlineMs ?? 40000, maxTokens: 4096 });
      for (const [k, raw] of Object.entries(r.values || {})) {
        if (!(FIELD_KEYS as readonly string[]).includes(k) || raw?.value === undefined || raw.value === null || raw.value === "") continue;
        const key = k as FieldKey;
        const vv = typeof raw.value === "string" && /^[\d,.]+$/.test(raw.value) ? Number(raw.value.replace(/,/g, "")) : raw.value as FieldValue["value"];
        const vis: FieldValue = { value: vv, unit: raw.unit, raw: raw.raw, sheet_id: raw.sheet_id, page: sheets.find(s => s.sheet_id === raw.sheet_id)?.page, source: "vision", confidence: raw.confidence || "MEDIUM" };
        const txt = values[key];
        if (!txt) { values[key] = vis; continue; }
        const same = typeof txt.value === "number" && typeof vis.value === "number" ? Math.abs(txt.value - vis.value) < 0.011 : String(txt.value).replace(/\s/g, "") === String(vis.value).replace(/\s/g, "");
        if (same || typeof txt.value === "string" && /건축사날인|주용도|대지위치|구조/.test(key)) values[key] = { ...txt, confidence: same ? "HIGH" : txt.confidence };
        else {
          notes.push(`${key}: 텍스트 레이어 ${txt.value} / 이미지 판독 ${vis.value} — 불일치, 확인 필요`);
          values[key] = RANK[vis.confidence] >= 3 && txt.confidence !== "HIGH" ? { ...vis, confidence: "LOW" } : { ...txt, confidence: "LOW" };
        }
      }
      const vf = (r.findings || []).filter(f => f.check_id && allowed.has(f.check_id) && checks.some(c => c.id === f.check_id));
      if (vf.length) {
        const keep = findings.filter(f => !vf.some(x => x.check_id === f.check_id));
        findings = [...keep, ...vf.map(f => ({
          check_id: f.check_id!, sheet_id: f.sheet_id || sheets[0]?.sheet_id || "-",
          status: (["PASS", "FAIL", "UNCLEAR", "NOT_APPLICABLE"].includes(String(f.status)) ? f.status : "UNCLEAR") as CheckStatus,
          visual_confidence: (["HIGH", "MEDIUM", "LOW"].includes(String(f.visual_confidence)) ? f.visual_confidence : "MEDIUM") as Confidence,
          observation: String(f.observation || "").slice(0, 400), code_ref: checkById(f.check_id!)?.code_basis || [],
        }))];
      }
    } catch (e) { notes.push(`이미지 판독 실패(${e instanceof Error ? e.message : String(e)}) — 텍스트 레이어 판독 결과만 사용합니다.`); }
  } else if (!visionEnabled()) notes.push("이미지 판독 모델이 꺼져 있어 텍스트 레이어만 사용했습니다.");

  // Checks with no evidence at all still get a row, so coverage is explicit.
  for (const c of checks) if (!findings.some(f => f.check_id === c.id)) findings.push({ check_id: c.id, sheet_id: sheets[0]?.sheet_id || "-", status: "UNCLEAR", visual_confidence: "LOW", observation: sheets.length ? "해당 표기를 찾지 못함" : "해당 도면 없음", code_ref: c.code_basis });
  return { group: group.key, findings: findings.sort((a, b) => a.check_id.localeCompare(b.check_id)), values, notes };
}

// ───────────────────────── Phase 3: Code compliance ─────────────────────────

export async function runCompliance(input: { scope: "state" | "city"; values: ProjectValues; findings: SheetFinding[]; region?: string; reviewScope?: ReviewScope; state?: ComplianceFile }): Promise<ComplianceFile> {
  const checks = checksFor(input.reviewScope || "full");
  const region = input.region ? listRegions().find(r => r.key === input.region) || resolveRegion(input.region) : null;
  if (input.scope === "state") return { scope: "state", region: region?.key, items: await nationalCompliance(checks, input.values, input.findings), notes: [] };
  const national = input.state?.items || await nationalCompliance(checks, input.values, input.findings);
  return { scope: "city", region: region?.key, items: cityCompliance(checks, input.values, region, national), notes: region ? [`적용 자치법규: ${region.label}${region.parents.length ? " + 광역 조례" : ""}`] : ["지역 미지정"] };
}

// ───────────────────────── Phase 4: Merge & draft corrections ─────────────────────────

const minConf = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);

export function runDraft(input: { manifest: SheetManifest; findings: SheetFindingsFile[]; state: ComplianceFile; city: ComplianceFile }): { draft: DraftCorrectionsFile; md: string; summary: ReviewSummary } {
  const items = finalItems(input.state, input.city);
  const allFindings = input.findings.flatMap(f => f.findings);
  const corrections: DraftCorrection[] = [];
  const dropped: DraftCorrectionsFile["dropped"] = [];
  for (const it of items) {
    const check = checkById(it.check_id)!;
    const f = allFindings.filter(x => x.check_id === it.check_id);
    const visual = f.length ? f.map(x => x.visual_confidence).reduce(minConf) : "LOW";
    const sheetsRef = [...new Set(f.map(x => x.sheet_id))];
    const verified = it.citations.filter(c => c.verified);
    if (it.status === "PASS" || it.status === "NOT_APPLICABLE") continue;
    if (!it.citations.length) { dropped.push({ check_id: it.check_id, reason: "법적 근거 조문을 확인하지 못함" }); continue; }
    let action: DraftCorrection["reviewer_action"] = "CONFIRM";
    let description: string;
    if (it.reviewer) { action = "COMPLETE"; description = `[검토자: ${it.reviewer}]`; }
    else if (it.status === "FAIL") {
      const plan = it.provided ? ` / 계획: ${it.provided.text}` : "";
      const why = it.notes.filter(Boolean).join(" ");
      description = `${check.title} — 기준: ${it.requirement}${plan}.${why ? ` ${why}` : ""} 기준에 적합하도록 도서를 보완하시기 바랍니다.`;
    } else {
      action = "VERIFY";
      description = `[확인 필요] ${check.title}: ${it.notes.join(" ") || "판독 또는 기준 확인이 필요합니다."}${it.provided ? ` (${it.provided.text})` : ""}`;
    }
    let confidence: Confidence = !verified.length ? "LOW" : it.code_confidence;
    if (it.tier === 2) confidence = minConf(confidence, "MEDIUM");
    if (visual === "LOW" && action === "CONFIRM") { action = "VERIFY"; description = `[판독 확인] ${description}`; }
    corrections.push({
      item_number: corrections.length + 1, check_id: it.check_id, section: check.section, description,
      code_citation: [...new Set(it.citations.map(c => c.label))], sheet_reference: sheetsRef, confidence, visual_confidence: visual, reviewer_action: action,
    });
  }
  const draft: DraftCorrectionsFile = { project: input.manifest.project, items: corrections, dropped, generated_at: new Date().toISOString() };
  const by_status = { PASS: 0, FAIL: 0, UNCLEAR: 0, NOT_APPLICABLE: 0 } as Record<CheckStatus, number>;
  for (const it of items) by_status[it.status]++;
  const by_confidence = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<Confidence, number>;
  const reviewer_actions = { CONFIRM: 0, VERIFY: 0, COMPLETE: 0 } as ReviewSummary["reviewer_actions"];
  for (const c of corrections) { by_confidence[c.confidence]++; reviewer_actions[c.reviewer_action]++; }
  const types = [...new Set(input.manifest.sheets.map(s => s.sheet_type))];
  const expected: SheetType[] = ["cover", "area", "site", "floor", "elevation", "section"];
  const summary: ReviewSummary = {
    checks_total: items.length, by_status, corrections: corrections.length, by_confidence, reviewer_actions,
    coverage: { sheet_types: types, missing_sheet_types: expected.filter(t => !types.includes(t)) },
    tiers: input.city.items.map(i => ({ check_id: i.check_id, tier: i.tier ?? 1 })),
  };
  return { draft, md: correctionsMarkdown(draft, items, summary), summary };
}

const STATUS_KO: Record<CheckStatus, string> = { PASS: "적합", FAIL: "부적합", UNCLEAR: "확인 필요", NOT_APPLICABLE: "해당 없음" };
const ACTION_KO = { CONFIRM: "확인", VERIFY: "검증", COMPLETE: "검토자 작성" };

export function correctionsMarkdown(d: DraftCorrectionsFile, items: ComplianceItem[], s: ReviewSummary): string {
  const p = d.project;
  const lines = [
    `# 건축허가 도서 보완요구서(안)`,
    ``,
    `- 사업명: ${p.name || "-"}`,
    `- 대지위치: ${p.address || "-"}`,
    `- 적용 자치법규: ${p.regionLabel || "지역 미지정(국가 기준만 적용)"}`,
    `- 작성: BuildLex AI 자동 검토 초안 — 검토자 확인 전 문서`,
    ``,
    `## 보완 요구 사항`,
    ``,
  ];
  if (!d.items.length) lines.push("자동 검토 범위에서 보완 요구 사항이 없습니다.", "");
  for (const c of d.items) {
    lines.push(`${c.item_number}. ${c.description}`);
    lines.push(`   - 근거: ${c.code_citation.join(", ")}`);
    lines.push(`   - 관련 도면: ${c.sheet_reference.join(", ") || "-"} · 법적 신뢰도 ${c.confidence} · 판독 신뢰도 ${c.visual_confidence} · 검토자 조치: ${ACTION_KO[c.reviewer_action]}`);
    lines.push("");
  }
  lines.push(`## 항목별 검토 결과`, ``, `| 항목 | 판정 | 기준 | 계획 |`, `|---|---|---|---|`);
  for (const it of items) lines.push(`| ${it.check_id} ${it.title} | ${STATUS_KO[it.status]} | ${(it.requirement || "").replace(/\|/g, "/")} | ${it.provided?.text?.replace(/\|/g, "/") || "-"} |`);
  lines.push("", `## 요약`, ``, `- 검토 항목 ${s.checks_total}개: 적합 ${s.by_status.PASS}, 부적합 ${s.by_status.FAIL}, 확인 필요 ${s.by_status.UNCLEAR}, 해당 없음 ${s.by_status.NOT_APPLICABLE}`);
  if (s.coverage.missing_sheet_types.length) lines.push(`- 제출 도서에서 확인되지 않은 도면 종류: ${s.coverage.missing_sheet_types.join(", ")}`);
  if (d.dropped.length) lines.push(`- 법적 근거 미확인으로 제외: ${d.dropped.map(x => x.check_id).join(", ")}`);
  lines.push("", "> 이 문서는 자동 검토 초안입니다. 판정은 도면 판독값과 코퍼스에 수록된 법령·조례 원문에 근거하며, 지구단위계획·심의 조건 등 수록되지 않은 기준은 반영되지 않습니다.");
  return lines.join("\n");
}
