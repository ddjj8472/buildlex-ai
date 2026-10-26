import { lawApiEnabled } from "@/lib/law-api";
import { hasLLM } from "@/lib/llm";
import { vworldEnabled } from "@/lib/land/vworld";
import type { LandConfig } from "@/lib/land/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the site picker can use. The map key is a separate, domain-locked V-World key
// that is safe to hand to the browser (VWORLD_MAP_KEY); the data key never leaves the server.
export function GET() {
  const cfg: LandConfig = { vworld: vworldEnabled(), mapKey: process.env.VWORLD_MAP_KEY || undefined, ai: hasLLM(), lawApi: lawApiEnabled() };
  return Response.json(cfg);
}
