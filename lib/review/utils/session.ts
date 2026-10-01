// Client-safe helpers (no fs/corpus imports): routing sheets to reviewer groups,
// merging values across groups, and tracking which artifacts/phases exist.
import { REVIEW_GROUPS, type ReviewGroup } from "../checklists/index.ts";
import type { CheckStatus, ComplianceFile, ComplianceItem, Confidence, FieldKey, FieldValue, ProjectValues, ReviewArtifacts, SheetEntry, SheetFindingsFile, SheetManifest } from "../types.ts";

export const MAX_SHEETS_PER_GROUP = 3;

/** Sheets a group should look at: matching sheet types first, then pages whose text carries the group's keywords. */
export function sheetsForGroup(manifest: SheetManifest, group: ReviewGroup, max = MAX_SHEETS_PER_GROUP): SheetEntry[] {
  const scored = manifest.sheets.map(s => {
    const typeHit = group.sheet_types.includes(s.sheet_type);
    const kw = s.keywords.filter(k => group.keywords.test(k)).length;
    // Keyword hits dominate: summary tables often sit on sheets titled otherwise (e.g. 단지배치도).
    const score = (typeHit ? 2 : 0) + kw + (s.text_layer ? 0 : 0.5) - s.page * 0.001;
    return { s, score, typeHit, kw };
  }).filter(x => x.typeHit || x.kw >= 2);
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.s).sort((a, b) => a.page - b.page);
}

export function plannedGroups(manifest: SheetManifest, scope: "full" | "administrative"): { group: ReviewGroup; sheets: SheetEntry[] }[] {
  const groups = scope === "administrative" ? REVIEW_GROUPS.filter(g => g.key === "arch-a") : REVIEW_GROUPS;
  return groups.map(group => ({ group, sheets: sheetsForGroup(manifest, group) })).filter(g => g.sheets.length || g.group.key !== "structural");
}

const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/** Exact characters from the text layer beat image readings unless flagged LOW. */
const score = (v: FieldValue) => RANK[v.confidence] + (v.source === "text" && v.confidence !== "LOW" ? 3 : 0);

/** Merge values from all groups: user edits win, then text layer, then higher confidence, then earlier group. */
export function mergeValues(files: SheetFindingsFile[], user: ProjectValues = {}): ProjectValues {
  const out: ProjectValues = {};
  for (const f of files) for (const [k, v] of Object.entries(f.values) as [FieldKey, FieldValue][]) {
    const cur = out[k];
    if (!cur || score(v) > score(cur)) out[k] = v;
  }
  for (const [k, v] of Object.entries(user) as [FieldKey, FieldValue][]) if (v && v.value !== "" && v.value !== undefined) out[k] = { ...v, source: "user", confidence: "HIGH" };
  return out;
}

export const REQUIRED_ARTIFACTS: (keyof ReviewArtifacts)[] = ["sheet-manifest.json", "sheet_findings.json", "state_compliance.json", "city_compliance.json", "draft_corrections.json", "draft_corrections.md", "review_summary.json"];

export const REVIEW_PHASES = ["추출·도면목록", "시트별 검토", "국가 법령", "자치법규(조례)", "보완요구서"] as const;

/** Which phases are complete, judged only by artifacts present. */
export function detectReviewPhases(a: ReviewArtifacts): number {
  if (a["draft_corrections.json"] && a["draft_corrections.md"] && a["review_summary.json"]) return 5;
  if (a["city_compliance.json"]) return 4;
  if (a["state_compliance.json"]) return 3;
  if (a["sheet_findings.json"]?.length) return 2;
  if (a["sheet-manifest.json"]) return 1;
  return 0;
}

export function verifyArtifacts(a: ReviewArtifacts): { found: string[]; missing: string[]; allPresent: boolean } {
  const found = REQUIRED_ARTIFACTS.filter(k => a[k] !== undefined) as string[];
  const missing = REQUIRED_ARTIFACTS.filter(k => a[k] === undefined) as string[];
  return { found, missing, allPresent: !missing.length };
}

/** Final status per check: an ordinance result (tier ≥ 2) overrides the national one. */
export function finalItems(state: ComplianceFile, city: ComplianceFile): ComplianceItem[] {
  return state.items.map(n => {
    const c = city.items.find(x => x.check_id === n.check_id);
    if (!c || (c.tier ?? 1) < 2) return c && c.status === "NOT_APPLICABLE" ? { ...n, status: "NOT_APPLICABLE" as CheckStatus } : n;
    // A parsed ordinance supersedes the national-only remarks ("조례에 위임", stated-limit hints).
    const natNotes = c.tier === 3 ? n.notes.filter(x => !/^도면에 기준|조례에 위임|산정값/.test(x)) : n.notes;
    return { ...c, citations: [...c.citations, ...n.citations.filter(x => !c.citations.some(y => y.id === x.id))], notes: [...new Set([...c.notes, ...natNotes])], reviewer: c.reviewer || n.reviewer };
  });
}

