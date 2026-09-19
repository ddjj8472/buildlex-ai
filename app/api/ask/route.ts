import { NextResponse } from "next/server";
import { fetchLocalOrdinance, fetchNationalLaw } from "@/lib/law-api";
import { generateLegalAnswer } from "@/lib/gemini";
import { buildSearchPlan, rankArticles } from "@/lib/search";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; region?: string };
    const query = body.query?.trim() || "";
    const region = body.region?.trim() || "";
    if (query.length < 4) {
      return NextResponse.json({ error: "질문을 4자 이상 입력해 주세요." }, { status: 400 });
    }
    if (query.length > 500) {
      return NextResponse.json({ error: "질문은 500자 이하로 입력해 주세요." }, { status: 400 });
    }

    const plan = buildSearchPlan(query);
    const nationalResults = await Promise.allSettled(plan.laws.map(fetchNationalLaw));
    const nationalArticles = nationalResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const localArticles = region ? await fetchLocalOrdinance(region).catch(() => []) : [];
    const evidence = rankArticles([...nationalArticles, ...localArticles], query, plan.keywords, 8);

    if (!evidence.length) {
      return NextResponse.json({
        error: "관련 조문을 찾지 못했습니다. '용도변경', '건폐율', '부설주차장'처럼 법규 용어를 포함해 질문해 주세요.",
      }, { status: 404 });
    }

    const answer = await generateLegalAnswer(query, region, evidence);
    return NextResponse.json({
      answer,
      topics: plan.topics,
      sources: evidence.map((article) => ({
        lawName: article.lawName,
        article: article.title,
        effectiveDate: article.effectiveDate,
        url: article.sourceUrl,
        sourceType: article.sourceType,
      })),
      demoOc: !process.env.LAW_API_OC || process.env.LAW_API_OC === "test",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
