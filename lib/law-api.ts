// 국가법령정보 Open API (law.go.kr/DRF) — used live for what the offline
// corpus does not carry: 별표 본문 and 법령해석례(질의회신). Every call is
// optional, time-boxed and cached; failures degrade to links, never to guesses.
import type { Interpretation } from "./types.ts";

const API = "https://www.law.go.kr/DRF";
const OC = () => process.env.LAW_API_OC || "";
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 1000 * 60 * 60 * 12;

type J = Record<string, unknown>;
const rec = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
function txt(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(txt).filter(Boolean).join("\n");
  if (v && typeof v === "object") return txt((v as J).content ?? (v as J)["내용"] ?? "");
  return "";
}
const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

async function getJSON(params: Record<string, string>, timeoutMs = 7000): Promise<J> {
  const endpoint = params.endpoint;
  const q = new URLSearchParams({ OC: OC(), type: "JSON", ...params });
  q.delete("endpoint");
  const url = `${API}/${endpoint}?${q}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value as J;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "buildlex-ai/2.0", Referer: "https://www.law.go.kr/" } });
  if (!res.ok) throw new Error(`law.go.kr ${res.status}`);
  const text = await res.text();
  if (text.trim().startsWith("<")) throw new Error("law.go.kr returned HTML (점검 또는 인증 오류)");
  const value = JSON.parse(text) as J;
  cache.set(url, { at: Date.now(), value });
  return value;
}

export const lawApiEnabled = () => !!OC();

/** 별표 본문 by 법령MST + 별표 번호 ("별표 1", "별표 1의2"). */
export async function fetchAppendix(mst: string, articleNo: string): Promise<string | null> {
  if (!lawApiEnabled() || !mst) return null;
  const m = articleNo.match(/별표\s*(\d+)(?:의(\d+))?/);
  if (!m) return null;
  const data = await getJSON({ endpoint: "lawService.do", target: "law", MST: mst });
  const units = arr(rec(rec(data["법령"])["별표"])["별표단위"] as J | J[] | undefined);
  const unit = units.map(rec).find(u => Number(txt(u["별표번호"])) === Number(m[1]) && Number(txt(u["별표가지번호"]) || 0) === Number(m[2] || 0) && /별표|^$/.test(txt(u["별표구분"])));
  const body = unit ? strip(txt(unit["별표내용"])) : "";
  return body || null;
}

/** 법령해석례(법제처 질의회신) search. */
export async function searchInterpretations(query: string, limit = 3): Promise<Interpretation[]> {
  if (!lawApiEnabled()) return [];
  const data = await getJSON({ endpoint: "lawSearch.do", target: "expc", query, display: String(Math.max(limit * 2, 6)) });
  const items = arr(rec(data["Expc"])["expc"] as J | J[] | undefined).map(rec).slice(0, limit);
  const out: Interpretation[] = [];
  await Promise.all(items.map(async it => {
    const id = txt(it["법령해석례일련번호"]);
    let question = "", answer = "";
    try {
      const d = rec((await getJSON({ endpoint: "lawService.do", target: "expc", ID: id }, 5000))["ExpcService"]);
      question = strip(txt(d["질의요지"]));
      answer = strip(txt(d["회답"]));
    } catch { /* keep list entry only */ }
    const link = txt(it["법령해석례상세링크"]);
    out.push({
      title: strip(txt(it["안건명"])),
      agency: txt(it["회신기관명"]) || "법제처",
      date: txt(it["회신일자"]),
      question: question.slice(0, 1200),
      answer: answer.slice(0, 1500),
      url: link ? new URL(link.replace(/OC=[^&]*&?/, ""), "https://www.law.go.kr").toString() : `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=${id}`,
    });
  }));
  return out.filter(x => x.title);
}
