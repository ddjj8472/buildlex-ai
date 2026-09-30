import { findChunk, loadNational } from "@/lib/corpus";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const region = url.searchParams.get("region") || undefined;
  const c = findChunk(id, region);
  if (!c) return Response.json({ error: "조문을 찾을 수 없습니다." }, { status: 404 });
  const n = loadNational();
  const label = (x: { lawName: string; articleNo: string; heading: string }) => `${x.lawName} ${x.articleNo}${x.heading ? `(${x.heading})` : ""}`;
  const refs = c.refs.map(r => findChunk(r, region)).filter(Boolean).map(r => ({ id: r!.id, label: label(r!) }));
  const citedBy = (n.citedBy.get(c.id) || []).map(r => n.byId.get(r)).filter(Boolean).slice(0, 20).map(r => ({ id: r!.id, label: label(r!) }));
  return Response.json({ chunk: c, refs, citedBy });
}
