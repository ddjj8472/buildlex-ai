// Shared types for the corpus, retrieval pipeline and UI.

export type Level = "법률" | "시행령" | "시행규칙" | "행정규칙" | "조례";

export type Chunk = {
  /** Stable id: `${lawKey}#${articleKey}` (e.g. 건축법#11, 건축법시행령#3의2, 건축법시행령#별표1). */
  id: string;
  lawKey: string;
  lawName: string;
  level: Level;
  /** "제11조", "제3조의2", "별표 1" */
  articleNo: string;
  /** Heading in parentheses, e.g. 건축허가 */
  heading: string;
  /** Chapter / section path for context. */
  path: string;
  text: string;
  kind: "article" | "appendix";
  effectiveDate: string;
  sourceUrl: string;
  /** Outgoing citations resolved to chunk ids. */
  refs: string[];
  /** Region key for ordinances. */
  region?: string;
  /** For appendices: attachment link. */
  attachment?: string;
  /** 법령MST (national) or 자치법규일련번호 for live API lookups. */
  mst?: string;
};

export type LawMeta = {
  lawKey: string;
  lawName: string;
  level: Level;
  effectiveDate: string;
  promulgated: string;
  sourceUrl: string;
  mst: string;
  parentKey?: string;
  decreeKey?: string;
  ruleKey?: string;
  region?: string;
  articleCount: number;
  /** 시행일자 of a promulgated but not yet effective amendment, if any. */
  upcoming?: string;
};

export type CorpusFile = {
  builtAt: string;
  asOf?: string;
  source: string;
  laws: LawMeta[];
  chunks: Chunk[];
};

export type Region = {
  key: string;
  label: string;
  province: string;
  city: string;
  /** Region keys whose ordinances also apply (e.g. 광역 본청). */
  parents: string[];
  ordinances: string[];
};

export type SiteFacts = Partial<{
  지역: string;
  용도지역: string;
  용도지구: string;
  건축물용도: string;
  대지면적: string;
  연면적: string;
  층수: string;
  높이: string;
  도로: string;
  허가시점: string;
  기타: string;
}>;

export type QueryAnalysis = {
  standalone: string;
  intent: string;
  legalTerms: string[];
  laws: string[];
  subQueries: string[];
  facts: SiteFacts;
  missing: string[];
  offTopic: boolean;
  source: "llm" | "rules";
  /** Why the LLM analyzer fell back to rules, if it did. */
  note?: string;
};

export type Evidence = {
  n: number;
  chunk: Chunk;
  score: number;
  via: "search" | "expand" | "appendix" | "ordinance" | "knowledge";
  reason?: string;
};

export type Interpretation = {
  title: string;
  agency: string;
  date: string;
  question: string;
  answer: string;
  url: string;
};

export type EvalMode = "none" | "check" | "auto";

export type StageId = "analyze" | "retrieve" | "expand" | "answer" | "verify" | "evaluate";

export type StreamEvent =
  | { type: "stage"; id: StageId; status: "running" | "done" | "skipped" | "error"; detail?: string; ms?: number }
  | { type: "analysis"; analysis: QueryAnalysis }
  | { type: "evidence"; evidence: EvidenceView[]; interpretations: Interpretation[]; notes: { title: string; text: string }[] }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "verify"; ok: boolean; issues: string[] }
  | { type: "evaluation"; score: number; verdict: string; notes: string[]; retried: boolean }
  | { type: "warning"; message: string }
  | { type: "done"; answer: string; llm: boolean }
  | { type: "error"; message: string };

export type EvidenceView = {
  n: number;
  id: string;
  lawName: string;
  level: Level;
  articleNo: string;
  heading: string;
  path: string;
  text: string;
  effectiveDate: string;
  sourceUrl: string;
  via: Evidence["via"];
  kind: Chunk["kind"];
  attachment?: string;
  upcoming?: string;
  related: { id: string; label: string }[];
};
