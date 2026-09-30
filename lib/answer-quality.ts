export function cleanAnswer(text: string): string {
  return text.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/```(?:\w+)?\n?/g, "").replace(/^\s*\*\s+/gm, "• ").trim();
}

export function buildUnavailableAnswer(evidence: Array<{ lawName: string; title: string }>): string {
  return [
    "현재 판단",
    "법령 검색은 완료했지만 AI 답변을 생성하지 못해 적용 여부를 판단하지 않았습니다.",
    "",
    "검색된 조문",
    ...evidence.map((article, index) => `${index + 1}. ${article.lawName} ${article.title} [근거 ${index + 1}]`),
    "",
    "다음 확인사항",
    "조문 미리보기와 원문에서 적용 조건·단서·별표를 확인해 주세요. AI 검토가 필요하면 잠시 후 다시 검색해 주세요.",
  ].join("\n");
}

export function validateAnswer(text: string, sourceCount: number): string {
  const answer = cleanAnswer(text).replace(/\[근거\s*(\d+(?:\s*[,，]\s*(?:근거\s*)?\d+)*)\]/g, (_, group: string) =>
    (group.match(/\d+/g) || []).map(number => `[근거 ${Number(number)}]`).join(" "));
  const citations = [...answer.matchAll(/\[근거\s*(\d+)\]/g)].map(match => Number(match[1]));
  if (!citations.length || citations.some(n => n < 1 || n > sourceCount)) {
    throw new Error("답변의 근거 번호를 검증하지 못했습니다. 조문 원문을 확인하거나 다시 검색해 주세요.");
  }
  if (/\[근거[^\]]*\]/.test(answer.replace(/\[근거\s*\d+\]/g, ""))) {
    throw new Error("답변의 근거 표기가 올바르지 않습니다. 다시 검색해 주세요.");
  }
  return answer;
}
