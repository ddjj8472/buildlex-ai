// Plan review (도면 기반 법규검토) — artifact schemas.
// Mirrors the city-side plan-review flow: each phase writes one artifact,
// and later phases read only artifacts (never the raw model chatter).
//
//   Phase 1  sheet-manifest.json      — 도면번호 ↔ 페이지, 도면 종류
//   Phase 2  sheet_findings.json      — 시트별 체크리스트 판독 결과
//   Phase 3A state_compliance.json    — 국가 법령(법·시행령·시행규칙) 기준 검증
//   Phase 3B city_compliance.json     — 자치법규(조례) 기준 검증
//   Phase 4  draft_corrections.json/.md + review_summary.json — 보완요구서(안)

export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type CheckStatus = "PASS" | "FAIL" | "UNCLEAR" | "NOT_APPLICABLE";
export type ReviewScope = "full" | "administrative";

/** Sheet types used to route sheets to checklists (Korean permit drawing sets). */
export type SheetType =
  | "cover"      // 표지·건축개요·설계개요·도면목록
  | "area"       // 면적표·면적산출·층별개요
  | "site"       // 배치도·단지배치도·대지종횡단
  | "floor"      // 평면도
  | "elevation"  // 입면도
  | "section"    // 단면도
  | "landscape"  // 조경계획도
  | "parking"    // 주차계획도
  | "structural" // 구조도
  | "mep"        // 기계·전기·소방·설비
  | "other";

export type PageInput = {
  page: number;
  /** Reading-order text from the PDF text layer ("" for scans). */
  text: string;
  /** JPEG data URL of the full page (sent only to Phase 2). */
  image?: string;
  /** JPEG data URL of the title-block crop (lower-right), for Phase 1. */
  titleBlock?: string;
  width?: number;
  height?: number;
};

export type SheetEntry = {
  sheet_id: string;
  title: string;
  page: number;
  sheet_type: SheetType;
  discipline: "건축" | "구조" | "기계·전기·소방" | "조경" | "토목" | "기타";
  text_layer: boolean;
  /** Keywords found on the page (used for routing pages that carry tables). */
  keywords: string[];
  source: "text" | "vision" | "fallback";
};

export type SheetManifest = {
  project: { name?: string; address?: string; region?: string; regionLabel?: string };
  total_pages: number;
  sheets: SheetEntry[];
  notes: string[];
};

/** Values read from drawings. Keys are the Korean field names below. */
export const FIELD_KEYS = [
  "대지위치", "용도지역", "용도지구", "주용도", "세대수",
  "대지면적", "건축면적", "건폐율", "건폐율_도면기준",
  "연면적", "용적률산정용연면적", "용적률", "용적률_도면기준",
  "지상층수", "지하층수", "높이",
  "정북이격_10m이하", "정북이격_10m초과",
  "주차대수", "법정주차대수_도면", "시설면적",
  "조경면적", "접도길이", "전면도로폭",
  "지구단위계획", "건축사날인", "구조",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export type FieldValue = {
  value: number | string | boolean;
  unit?: string;
  /** Exact text the value was read from. */
  raw?: string;
  sheet_id?: string;
  page?: number;
  source: "text" | "vision" | "user";
  confidence: Confidence;
};
export type ProjectValues = Partial<Record<FieldKey, FieldValue>>;

export type SheetFinding = {
  check_id: string;
  sheet_id: string;
  status: CheckStatus;
  visual_confidence: Confidence;
  /** What was actually seen on the sheet (evidence). */
  observation: string;
  code_ref: string[];
};

export type SheetFindingsFile = {
  group: string;
  findings: SheetFinding[];
  values: ProjectValues;
  notes: string[];
};

/** A requirement as written in a statute/ordinance, verified against the corpus text. */
export type Citation = {
  id: string;
  label: string;   // 「건축법 시행령」 제86조
  quote: string;   // verbatim line from the article
  verified: boolean;
  sourceUrl?: string;
};

export type ComplianceItem = {
  check_id: string;
  title: string;
  /** "법정 기준" in plain words, e.g. "건폐율 60% 이하". */
  requirement: string;
  threshold?: { op: "<=" | ">="; value: number; unit: string };
  provided?: { value: number; unit: string; text: string };
  status: CheckStatus;
  code_confidence: Confidence;
  citations: Citation[];
  /** City routing tier: 3 = 조례 본문 확인, 2 = 조례 위임은 있으나 본문(별표) 미수록, 1 = 국가 기준만. */
  tier?: 1 | 2 | 3;
  notes: string[];
  /** Reviewer blank instead of an assessment (structural, judgement items). */
  reviewer?: string;
};

export type ComplianceFile = {
  scope: "state" | "city";
  region?: string;
  items: ComplianceItem[];
  notes: string[];
};

export type ReviewerAction = "CONFIRM" | "VERIFY" | "COMPLETE";

export type DraftCorrection = {
  item_number: number;
  check_id: string;
  section: "건축계획" | "대지·도로" | "주차·조경" | "높이·일조" | "구조·설비" | "도서 요건";
  description: string;
  code_citation: string[];
  sheet_reference: string[];
  confidence: Confidence;
  visual_confidence: Confidence;
  reviewer_action: ReviewerAction;
};

export type DraftCorrectionsFile = {
  project: SheetManifest["project"];
  items: DraftCorrection[];
  dropped: { check_id: string; reason: string }[];
  generated_at: string;
};

export type ReviewSummary = {
  checks_total: number;
  by_status: Record<CheckStatus, number>;
  corrections: number;
  by_confidence: Record<Confidence, number>;
  reviewer_actions: Record<ReviewerAction, number>;
  coverage: { sheet_types: SheetType[]; missing_sheet_types: SheetType[] };
  tiers: { check_id: string; tier: 1 | 2 | 3 }[];
};

export type ReviewArtifacts = {
  "sheet-manifest.json"?: SheetManifest;
  "sheet_findings.json"?: SheetFindingsFile[];
  "state_compliance.json"?: ComplianceFile;
  "city_compliance.json"?: ComplianceFile;
  "draft_corrections.json"?: DraftCorrectionsFile;
  "draft_corrections.md"?: string;
  "review_summary.json"?: ReviewSummary;
};
