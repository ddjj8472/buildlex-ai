export type LawArticle = {
  lawName: string;
  title: string;
  text: string;
  effectiveDate: string;
  sourceUrl: string;
  sourceType: "국가법령" | "자치법규";
};

type JsonRecord = Record<string, unknown>;

const API_ROOT = "https://www.law.go.kr/DRF";
const LAW_HOME = "https://www.law.go.kr";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    return textValue(record.content ?? record["내용"] ?? "");
  }
  return "";
}

async function getJson(url: URL): Promise<JsonRecord> {
  const response = await fetch(url, {
    headers: { "User-Agent": "con-reg-lite/0.1 educational-demo" },
    next: { revalidate: 60 * 60 * 12 },
  });
  if (!response.ok) throw new Error(`법제처 API 오류 (${response.status})`);
  return response.json() as Promise<JsonRecord>;
}

function buildSourceUrl(target: "law" | "ordin", serial: string): string {
  return target === "law"
    ? `${LAW_HOME}/법령/법령정보?lsId=${encodeURIComponent(serial)}`
    : `${LAW_HOME}/자치법규/자치법규정보?gubun=ELIS&serial=${encodeURIComponent(serial)}`;
}

function flattenNationalArticle(raw: JsonRecord, lawName: string, date: string, url: string): LawArticle | null {
  if (textValue(raw["조문여부"]) !== "조문") return null;
  const number = textValue(raw["조문번호"]);
  const branch = textValue(raw["조문가지번호"]);
  const heading = textValue(raw["조문제목"]);
  const body: string[] = [textValue(raw["조문내용"])];

  for (const paragraphValue of asArray(raw["항"] as JsonRecord | JsonRecord[] | undefined)) {
    const paragraph = asRecord(paragraphValue);
    body.push(textValue(paragraph["항내용"]));
    for (const itemValue of asArray(paragraph["호"] as JsonRecord | JsonRecord[] | undefined)) {
      const item = asRecord(itemValue);
      body.push(textValue(item["호내용"]));
      for (const subValue of asArray(item["목"] as JsonRecord | JsonRecord[] | undefined)) {
        body.push(textValue(asRecord(subValue)["목내용"]));
      }
    }
  }

  const title = `제${number}조${branch ? `의${branch}` : ""}${heading ? `(${heading})` : ""}`;
  return {
    lawName,
    title,
    text: [...new Set(body.filter(Boolean))].join("\n").slice(0, 6500),
    effectiveDate: textValue(raw["조문시행일자"]) || date,
    sourceUrl: url,
    sourceType: "국가법령",
  };
}

function flattenOrdinanceArticle(raw: JsonRecord, lawName: string, date: string, url: string): LawArticle | null {
  if (textValue(raw["조문여부"]) === "N") return null;
  const rawNumber = textValue(raw["조문번호"]);
  const displayNumber = String(Number(rawNumber.slice(0, 4) || rawNumber) || rawNumber);
  const heading = textValue(raw["조제목"]);
  const body = [textValue(raw["조내용"])];

  for (const paragraphValue of asArray(raw["항"] as JsonRecord | JsonRecord[] | undefined)) {
    const paragraph = asRecord(paragraphValue);
    body.push(textValue(paragraph["항내용"] ?? paragraph["항"]));
    for (const itemValue of asArray(paragraph["호"] as JsonRecord | JsonRecord[] | undefined)) {
      const item = asRecord(itemValue);
      body.push(textValue(item["호내용"] ?? item["호"]));
    }
  }

  return {
    lawName,
    title: `제${displayNumber}조${heading ? `(${heading})` : ""}`,
    text: [...new Set(body.filter(Boolean))].join("\n").slice(0, 6500),
    effectiveDate: date,
    sourceUrl: url,
    sourceType: "자치법규",
  };
}

export async function fetchNationalLaw(lawName: string): Promise<LawArticle[]> {
  const oc = process.env.LAW_API_OC || "test";
  const searchUrl = new URL(`${API_ROOT}/lawSearch.do`);
  searchUrl.search = new URLSearchParams({ OC: oc, target: "law", type: "JSON", query: lawName, display: "20" }).toString();
  const search = asRecord((await getJson(searchUrl))["LawSearch"]);
  const candidates = asArray(search["law"] as JsonRecord | JsonRecord[] | undefined).map(asRecord);
  const exact = candidates.find((item) => textValue(item["법령명한글"]) === lawName && textValue(item["현행연혁코드"]) === "현행")
    ?? candidates.find((item) => textValue(item["법령명한글"]) === lawName);
  if (!exact) return [];

  const mst = textValue(exact["법령일련번호"]);
  const date = textValue(exact["시행일자"]);
  const detailUrl = new URL(`${API_ROOT}/lawService.do`);
  detailUrl.search = new URLSearchParams({ OC: oc, target: "law", type: "JSON", MST: mst }).toString();
  const detail = asRecord((await getJson(detailUrl))["법령"]);
  const articles = asArray(asRecord(detail["조문"])["조문단위"] as JsonRecord | JsonRecord[] | undefined);
  const sourceUrl = buildSourceUrl("law", textValue(exact["법령ID"]) || mst);
  return articles.map((article) => flattenNationalArticle(asRecord(article), lawName, date, sourceUrl)).filter(Boolean) as LawArticle[];
}

export async function fetchLocalOrdinance(region: string): Promise<LawArticle[]> {
  const cleanRegion = region.replace(/[^가-힣\s]/g, "").trim().slice(0, 20);
  if (!cleanRegion) return [];
  const oc = process.env.LAW_API_OC || "test";
  const expectedName = `${cleanRegion} 건축 조례`;
  const searchUrl = new URL(`${API_ROOT}/lawSearch.do`);
  searchUrl.search = new URLSearchParams({ OC: oc, target: "ordin", type: "JSON", query: expectedName, display: "20" }).toString();
  const search = asRecord((await getJson(searchUrl))["OrdinSearch"]);
  const candidates = asArray(search["law"] as JsonRecord | JsonRecord[] | undefined).map(asRecord);
  const exact = candidates.find((item) => textValue(item["자치법규명"]) === expectedName)
    ?? candidates.find((item) => textValue(item["자치법규명"]).includes("건축 조례"));
  if (!exact) return [];

  const mst = textValue(exact["자치법규일련번호"]);
  const date = textValue(exact["시행일자"]);
  const lawName = textValue(exact["자치법규명"]);
  const detailUrl = new URL(`${API_ROOT}/lawService.do`);
  detailUrl.search = new URLSearchParams({ OC: oc, target: "ordin", type: "JSON", MST: mst }).toString();
  const detail = asRecord((await getJson(detailUrl))["LawService"]);
  const articles = asArray(asRecord(detail["조문"])["조"] as JsonRecord | JsonRecord[] | undefined);
  const sourceUrl = buildSourceUrl("ordin", textValue(exact["자치법규ID"]) || mst);
  return articles.map((article) => flattenOrdinanceArticle(asRecord(article), lawName, date, sourceUrl)).filter(Boolean) as LawArticle[];
}
