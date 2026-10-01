"use client";
// Browser-side page extraction (the drawing PDF never leaves the browser whole):
//   - text layer per page → reading-order lines
//   - title-block crop (lower-right) for sheets the text layer cannot identify
//   - full-page JPEG for the few sheets each reviewer group needs
import { layoutText, type TextItem } from "@/lib/review/utils/layout";

// pdf.js 3.11.174 (Apache-2.0), self-hosted so the review page has no CDN dependency.
const PDFJS = "/vendor/pdfjs";

type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: { str: string; transform: number[]; width: number; height: number }[] }>;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
};
export type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
type PdfLib = { GlobalWorkerOptions: { workerSrc: string }; getDocument(o: { data: ArrayBuffer }): { promise: Promise<PdfDoc> } };

let loading: Promise<PdfLib> | null = null;
function lib(): Promise<PdfLib> {
  const w = window as unknown as { pdfjsLib?: PdfLib };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${PDFJS}/pdf.min.js`;
    s.onload = () => { const l = (window as unknown as { pdfjsLib: PdfLib }).pdfjsLib; l.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`; resolve(l); };
    s.onerror = () => { loading = null; reject(new Error("PDF 엔진을 불러오지 못했습니다(네트워크 확인).")); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function openPdf(file: File | ArrayBuffer): Promise<PdfDoc> {
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  return (await lib()).getDocument({ data }).promise;
}

export async function pageText(doc: PdfDoc, n: number): Promise<{ text: string; width: number; height: number }> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = tc.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.hypot(i.transform[2], i.transform[3]) || i.height }));
  page.cleanup();
  return { text: layoutText(items, vp.height), width: vp.width, height: vp.height };
}

async function renderCanvas(doc: PdfDoc, n: number, targetWidth: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

function jpeg(c: HTMLCanvasElement, maxBytes: number): string {
  for (const q of [0.78, 0.66, 0.55, 0.45]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length * 0.75 <= maxBytes) return url;
  }
  return c.toDataURL("image/jpeg", 0.38);
}

/** Full page for the vision reviewer (≈1 MB budget per page). */
export async function pageImage(doc: PdfDoc, n: number, width = 2000, maxBytes = 1_000_000): Promise<string> {
  return jpeg(await renderCanvas(doc, n, width), maxBytes);
}

/** Lower-right title block (Korean drawing sets put 도면번호/도면명 there, or in a right strip). */
export async function titleBlock(doc: PdfDoc, n: number): Promise<string> {
  const full = await renderCanvas(doc, n, 1600);
  const w = Math.round(full.width * 0.3), h = Math.round(full.height * 0.42);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(full, full.width - w, full.height - h, w, h, 0, 0, w, h);
  return jpeg(c, 120_000);
}
