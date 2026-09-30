import { NextResponse } from "next/server";
import { fetchLocalOrdinance, fetchNationalLaw } from "@/lib/law-api";
import { generateLegalAnswer } from "@/lib/gemini";
import { buildSearchPlan, rankArticles } from "@/lib/search";
import { buildUnavailableAnswer } from "@/lib/answer-quality";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json() as { query?: string; region?: string };
    if (!body || typeof body.query !== "string" || (body.region !== undefined && typeof body.region !== "string")) {
      return NextResponse.json({ error: "질문과 지역은 문자열로 입력해 주세요." }, { status: 400 });
    }
    const query = body.query.trim();
    const region = body.region?.trim() || "";
    if (region.length > 20) return NextResponse.json({ error: "지역은 20자 이하로 입력해 주세요." }, { status: 400 });
    if (query.length < 4) {
      return NextResponse.json({ error: "질문을 4자 이상 입력해 주세요." }, { status: 400 });
    }
    if (query.length > 500) {
      return NextResponse.json({ error: "질문은 500자 이하로 입력해 주세요." }, { status: 400 });
    }

    const plan = buildSearchPlan(query);
    const [nationalResults, localResult] = await Promise.all([
      Promise.allSettled(plan.laws.map(fetchNationalLaw)),
      Promise.allSettled(region ? [fetchLocalOrdinance(region)] : []),
    ]);
    const nationalArticles = nationalResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const localArticles = localResult[0]?.status === "fulfilled" ? localResult[0].value : [];
    const warnings = nationalResults.flatMap((result, index) => result.status === "rejected" || !result.value.length ? [`${plan.laws[index]} 조회 실패 또는 조문 없음`] : []);
    if (region && !localArticles.length) warnings.push(`${region} 건축 조례를 확보하지 못했습니다. 지역 기준은 미확인입니다.`);
    if (plan.topics.some(topic => /용적률|부설주차장/.test(topic))) warnings.push("도시계획·주차장 조례와 별표는 이번 검색 범위에 포함되지 않습니다. 지역별 수치는 별도 확인해야 합니다.");
    const evidence = rankArticles([...nationalArticles, ...localArticles], query, plan.keywords, 8);
    if (evidence.some(article => /별표/.test(article.text))) warnings.push("검색 조문이 인용하는 별표 원문은 수집되지 않았습니다. 별표의 수치·예외는 미확인입니다.");
    if (evidence.some(article => article.text.length > 6500)) warnings.push("긴 조문 일부는 발췌하여 답변했습니다. 생략된 단서·예외는 원문 확인이 필요합니다.");

    if (!evidence.length) {
      return NextResponse.json({
        error: "관련 조문을 찾지 못했습니다. '용도변경', '건폐율', '부설주차장'처럼 법규 용어를 포함해 질문해 주세요.",
      }, { status: 404 });
    }

    let answer: string;
    let answerGenerated = true;
    try {
      answer = await generateLegalAnswer(query, region, evidence, warnings);
    } catch {
      answerGenerated = false;
      warnings.push("AI 답변 생성이 완료되지 않았습니다. 검색된 조문은 제공하지만 법규 적용 판단은 미완료입니다.");
      answer = buildUnavailableAnswer(evidence);
    }
    return NextResponse.json({
      answer,
      answerGenerated,
      warnings,
      topics: plan.topics,
      sources: evidence.map((article) => ({
        lawName: article.lawName,
        article: article.title,
        effectiveDate: article.effectiveDate,
        url: article.sourceUrl,
        sourceType: article.sourceType,
        excerpt: article.text.slice(0, 700),
      })),
      demoOc: !process.env.LAW_API_OC || process.env.LAW_API_OC === "test",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
