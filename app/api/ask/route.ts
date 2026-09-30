import { NextResponse } from "next/server";
import { fetchLocalOrdinance, fetchNationalLaw } from "@/lib/law-api";
import { generateLegalAnswer } from "@/lib/gemini";
import { buildSearchPlan, rankArticles } from "@/lib/search";
import { buildUnavailableAnswer } from "@/lib/answer-quality";
import { enrichSearchPlan } from "@/lib/query-analysis";

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

    const plan = await enrichSearchPlan(query, buildSearchPlan(query));
    const [nationalResults, localResult] = await Promise.all([
      Promise.allSettled(plan.laws.map(fetchNationalLaw)),
      Promise.allSettled(region ? [fetchLocalOrdinance(region)] : []),
    ]);
    const nationalArticles = nationalResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const localArticles = localResult[0]?.status === "fulfilled" ? localResult[0].value : [];
    const warnings = nationalResults.flatMap((result, index) => result.status === "rejected" || !result.value.length ? [`${plan.laws[index]} 조회 실패 또는 조문 없음`] : []);
    if (region && !localArticles.length) warnings.push(`${region} 건축 조례를 확보하지 못했습니다. 지역 기준은 미확인입니다.`);
    if (plan.topics.some(topic => /용적률|부설주차장/.test(topic))) warnings.push("도시계획·주차장 조례는 이번 검색 범위에 포함되지 않습니다. 지역별 수치는 별도 확인해야 합니다.");
    const allArticles = [...nationalArticles, ...localArticles];
    const evidence = rankArticles(allArticles, query, plan.keywords, 12);
    // Resolve appendix dependencies from selected provisions, rather than
    // treating a cross-reference as evidence of its unseen contents.
    for (const article of [...evidence]) {
      for (const match of article.text.matchAll(/별표\s*(\d+)(?:의\s*(\d+))?/g)) {
        const appendix = allArticles.find(a => a.lawName === article.lawName && a.kind === "appendix" && a.title.startsWith(`별표 ${Number(match[1])}${match[2] ? `의${Number(match[2])}` : ""} `));
        if (appendix && !evidence.includes(appendix)) evidence.push(appendix);
        if (!appendix) warnings.push(`${article.lawName} 별표 ${match[1]} 본문을 확보하지 못했습니다. 해당 별표의 세부 기준은 미확인입니다.`);
      }
    }
    if (evidence.some(article => article.text.length > 24000)) warnings.push("매우 긴 근거의 일부를 발췌했습니다. 생략된 조건·예외는 원문 확인이 필요합니다.");

    if (!evidence.length) {
      return NextResponse.json({
        error: "관련 조문을 찾지 못했습니다. '용도변경', '건폐율', '부설주차장'처럼 법규 용어를 포함해 질문해 주세요.",
      }, { status: 404 });
    }

    let answer: string;
    let answerGenerated = true;
    try {
      answer = await generateLegalAnswer(query, region, evidence, warnings);
    } catch (error) {
      answerGenerated = false;
      const message = error instanceof Error ? error.message : "응답 실패";
      const reason = /timeout|abort/i.test(message) ? "응답 제한시간 초과" : /429|quota|resource exhausted/i.test(message) ? "AI 이용량 제한" : /근거/.test(message) ? "근거 표시 검증 실패" : /중단|길어/.test(message) ? "답변 길이 제한" : "AI 응답 오류";
      warnings.push(`AI 답변 생성 미완료: ${reason}. 검색 근거는 보존했으며 법규 적용 판단은 미완료입니다.`);
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
      version: "2026-09-30-intent-and-housing-v2",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
