import type { LawArticle } from "./law-api";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

function formatEvidence(articles: LawArticle[]): string {
  return articles.map((article, index) => [
    `[근거 ${index + 1}] ${article.lawName} ${article.title}`,
    `시행일: ${article.effectiveDate}`,
    article.text,
  ].join("\n")).join("\n\n---\n\n");
}

export async function generateLegalAnswer(
  query: string,
  region: string,
  evidence: LawArticle[],
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const prompt = `당신은 대한민국 건축법규 검색 보조자입니다. 아래 검색된 현행 조문만 근거로 답하십시오.

[엄격한 원칙]
1. 검색 근거에 없는 조문 번호, 수치, 예외를 추측하지 마십시오.
2. 결론 / 적용 근거 / 추가 확인사항 순서로 간결한 한국어 존댓말로 작성하십시오.
3. 근거를 쓸 때 반드시 '[근거 n]'을 표시하십시오.
4. 지역 조례, 용도지역, 건축물 용도·규모 등 정보가 부족하면 무엇을 더 확인해야 하는지 명시하십시오.
5. 법률 자문이나 허가 가능성을 확정하지 말고, 관할 허가권자 확인이 필요하다고 알리십시오.

[질문]
${query}

[입력 지역]
${region || "미입력"}

[검색된 현행 조문]
${formatEvidence(evidence)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 1400 },
    }),
  });
  const payload = await response.json() as GeminiResponse;
  if (!response.ok) throw new Error(payload.error?.message || `Gemini API 오류 (${response.status})`);
  const answer = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!answer) throw new Error("Gemini가 빈 응답을 반환했습니다.");
  return answer;
}
