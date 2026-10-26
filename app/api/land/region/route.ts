import { resolveRegion } from "@/lib/corpus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free-text address (e.g. from OpenStreetMap reverse geocoding) → 조례 지역.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const r = typeof body.text === "string" ? resolveRegion(body.text.slice(0, 200)) : null;
  return Response.json({ region: r ? { key: r.key, label: r.label } : null });
}
