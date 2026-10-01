import { runManifest } from "@/lib/review/flows/plan-review";
import { phaseHandler } from "@/lib/review/routes/handler";
import type { PageInput } from "@/lib/review/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Phase 1 — Extract & Map: page texts (+ title-block crops) → sheet-manifest.json
export const POST = phaseHandler<{ pages?: PageInput[]; region?: string }, unknown>("도면목록 작성", async body => {
  const pages = (Array.isArray(body.pages) ? body.pages : []).slice(0, 120).map(p => ({ page: Number(p.page), text: String(p.text || "").slice(0, 20000), titleBlock: typeof p.titleBlock === "string" ? p.titleBlock : undefined }));
  if (!pages.length) throw new Error("페이지가 없습니다.");
  return runManifest(pages, { region: typeof body.region === "string" ? body.region : undefined, deadlineMs: 40000 });
});
