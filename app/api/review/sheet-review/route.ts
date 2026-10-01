import { runSheetReview } from "@/lib/review/flows/plan-review";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { PageInput, ReviewScope, SheetManifest } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Phase 2 — one discipline group per request → one sheet_findings entry
export const POST = phaseHandler<{ group?: string; pages?: PageInput[]; manifest?: SheetManifest; scope?: ReviewScope }, unknown>("시트 검토", async body => {
  if (!body.group || !body.manifest) throw new Error("group과 manifest가 필요합니다.");
  const pages = (body.pages || []).slice(0, 4).map(p => ({ page: Number(p.page), text: String(p.text || "").slice(0, 20000), image: typeof p.image === "string" ? p.image : undefined }));
  return runSheetReview({ group: body.group, pages, manifest: body.manifest, scope: body.scope === "administrative" ? "administrative" : "full", deadlineMs: 48000 });
});
