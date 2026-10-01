import { runDraft } from "@/lib/review/flows/plan-review";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { ComplianceFile, SheetFindingsFile, SheetManifest } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Phase 4 — merge & filter → draft_corrections.json/.md + review_summary.json
export const POST = phaseHandler<{ manifest?: SheetManifest; findings?: SheetFindingsFile[]; state?: ComplianceFile; city?: ComplianceFile }, unknown>("보완요구서 작성", async body => {
  if (!body.manifest || !body.state || !body.city) throw new Error("manifest, state, city가 필요합니다.");
  return runDraft({ manifest: body.manifest, findings: body.findings || [], state: body.state, city: body.city });
});
