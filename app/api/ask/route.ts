import { NextResponse } from "next/server";
import { fetchLocalOrdinance, fetchNationalLaw } from "@/lib/law-api";
import { generateLegalAnswer } from "@/lib/gemini";
import { buildSearchPlan } from "@/lib/search";
import { buildUnavailableAnswer } from "@/lib/answer-quality";
import { findOfficialCases } from "@/lib/official-cases";
import { selectEvidence } from "@/lib/evidence";

export const runtime = "nodejs";
export const maxDuration = 90;

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
    const localKinds = ["건축 조례"];
    if (plan.topics.includes("공동주택 공용시설·행위허가")) localKinds.push("주택 조례");
    if (plan.topics.some(t => /용도지역|용적률/.test(t))) localKinds.push("도시계획 조례");
    if (plan.topics.includes("부설주차장")) localKinds.push("주차장 설치 및 관리 조례");
    const [nationalResults, localResult] = await Promise.all([
      Promise.allSettled(plan.laws.map(fetchNationalLaw)),
      Promise.allSettled(region ? localKinds.map(kind => fetchLocalOrdinance(region, kind)) : []),
    ]);
    const nationalArticles = nationalResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const localArticles = localResult.flatMap(result => result.status === "fulfilled" ? result.value : []);
    const warnings = nationalResults.flatMap((result, index) => result.status === "rejected" || !result.value.length ? [`${plan.laws[index]} 조회 실패 또는 조문 없음`] : []);
    localResult.forEach((result, i) => {
      if (result.status === "rejected" || !result.value.length) warnings.push(`${region} ${localKinds[i]}를 확보하지 못했습니다. 해당 지역 기준은 미확인입니다.`);
    });
    const cases = findOfficialCases(query, region);
    if (cases.length) warnings.push("유사한 공식 회답 사례를 함께 확인했습니다. 과거 회신과 현재 법령을 구분하여 개별 대상지 조건을 검토해야 합니다.");
    const evidence = selectEvidence([...nationalArticles, ...localArticles], query, plan.keywords, cases);
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
    } catch (error) {
      answerGenerated = false;
      const message = error instanceof Error ? error.message : "";
      const serviceReason = /quota|RESOURCE_EXHAUSTED|429|rate.limit/i.test(message)
        ? "Gemini API 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
        : /timeout|aborted|시간/i.test(message) || (error instanceof Error && error.name === "TimeoutError")
          ? "Gemini 답변 또는 근거 재검토가 제한 시간 안에 완료되지 않았습니다."
          : /재검토/.test(message) ? "AI 근거 재검토를 완료하지 못했습니다."
            : /MAX_TOKENS|길어|중단/.test(message) ? "AI 생성이 중단되어 완전한 답변을 제공하지 않았습니다."
              : "AI 답변 생성이 완료되지 않았습니다.";
      const validationFailed = error instanceof Error && /검증|원문에 없는|근거에 없는|근거 없는|형식 오류/.test(error.message);
      warnings.push(validationFailed
        ? `AI 답변의 근거 문구·수치 검증을 통과하지 못해 판단을 표시하지 않았습니다. ${error instanceof Error ? error.message : "검증 실패"}. 검색된 원문을 확인해 주세요.`
        : `${serviceReason} 검색된 조문은 제공하지만 법규 적용 판단은 미완료입니다.`);
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
        dateLabel: article.dateLabel,
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
