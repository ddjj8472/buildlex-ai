import { listRegions } from "@/lib/corpus";

export const runtime = "nodejs";

export async function GET() {
  const regions = listRegions().map(r => ({ key: r.key, label: r.label, ordinances: r.ordinances }));
  return Response.json({ regions }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
