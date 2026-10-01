import { runCompliance } from "@/lib/review/flows/plan-review";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { ComplianceFile, ProjectValues, ReviewScope, SheetFinding } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Phase 3A (scope=state) / 3B (scope=city) → state_compliance.json / city_compliance.json
export const POST = phaseHandler<{ scope?: "state" | "city"; values?: ProjectValues; findings?: SheetFinding[]; region?: string; reviewScope?: ReviewScope; state?: ComplianceFile }, unknown>("법령 검증", async body => {
  return runCompliance({
    scope: body.scope === "city" ? "city" : "state", values: body.values || {}, findings: Array.isArray(body.findings) ? body.findings : [],
    region: typeof body.region === "string" ? body.region : undefined, reviewScope: body.reviewScope === "administrative" ? "administrative" : "full", state: body.state,
  });
});
