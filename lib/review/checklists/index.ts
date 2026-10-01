import { checklistArea } from "./area.ts";
import { checklistCover } from "./cover.ts";
import { checklistElevations } from "./elevations.ts";
import { checklistSitePlan } from "./site-plan.ts";
import { checklistStructural } from "./structural.ts";
import type { CheckItem, Checklist } from "./types.ts";
import type { SheetType } from "../types.ts";

export type { CheckItem, Checklist } from "./types.ts";

export const CHECKLISTS: Checklist[] = [checklistCover, checklistArea, checklistSitePlan, checklistElevations, checklistStructural];
export const ALL_CHECKS: CheckItem[] = CHECKLISTS.flatMap(c => c.items);
export const checkById = (id: string) => ALL_CHECKS.find(c => c.id === id);

/**
 * Phase 2 reviewer groups (one model call each, 3 in flight).
 * Grouped by discipline so a group sees every sheet its checks need.
 */
export type ReviewGroup = { key: string; label: string; sheet_types: SheetType[]; checklists: Checklist[]; keywords: RegExp };

export const REVIEW_GROUPS: ReviewGroup[] = [
  { key: "arch-a", label: "건축개요·면적", sheet_types: ["cover", "area"], checklists: [checklistCover, checklistArea], keywords: /건폐율|용적률|대지면적|건축면적|연면적|건축개요|대지개요|설계개요/ },
  { key: "site-civil", label: "배치·주차·조경", sheet_types: ["site", "landscape", "parking"], checklists: [checklistSitePlan], keywords: /배치도|주차|조경|도로|접도/ },
  { key: "arch-b", label: "입면·단면", sheet_types: ["elevation", "section"], checklists: [checklistElevations], keywords: /입면|단면|정북|일조|최고높이|사선/ },
  { key: "structural", label: "구조·설비", sheet_types: ["structural", "mep"], checklists: [checklistStructural], keywords: /구조|기초|골조|구조계산/ },
];

export function checksFor(scope: "full" | "administrative"): CheckItem[] {
  return scope === "administrative" ? ALL_CHECKS.filter(c => c.administrative) : ALL_CHECKS;
}
