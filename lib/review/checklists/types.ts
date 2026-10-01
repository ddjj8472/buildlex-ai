import type { Confidence, FieldKey, SheetType } from "../types.ts";

/**
 * A checklist item is knowledge, not procedure: WHAT must appear on a sheet,
 * WHY (code basis), HOW to recognise it visually, and how confident each side is.
 * Phase 2 reads sheets against these; Phase 3 decides legal thresholds.
 */
export type CheckItem = {
  id: string;                 // "2A"
  title: string;              // "건폐율"
  sheet_types: SheetType[];   // where the evidence normally lives
  requirement: string;        // plain-language requirement
  code_basis: string[];       // corpus chunk ids (verified by tests)
  code_confidence: Confidence;
  visual_confidence: Confidence;
  /** What to look for on the sheet (fed to the vision reader). */
  visual: string;
  /** Typical deficiencies seen in permit drawings. */
  deficiencies: string[];
  /** Values the reader must extract for this check. */
  fields: FieldKey[];
  /** How Phase 3 evaluates it. */
  kind: "presence" | "bcr" | "far" | "daylight" | "parking" | "landscape" | "road" | "height" | "open-space" | "structural";
  section: "건축계획" | "대지·도로" | "주차·조경" | "높이·일조" | "구조·설비" | "도서 요건";
  /** Included in the administrative (completeness) scope. */
  administrative?: boolean;
};

export type Checklist = { key: string; title: string; sheet_types: SheetType[]; items: CheckItem[] };
