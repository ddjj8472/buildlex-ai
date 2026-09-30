export function cleanAnswer(text: string): string {
  return text.replace(/\*\*|__/g, "").replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/```(?:\w+)?\n?/g, "").replace(/^\s*\*\s+/gm, "• ").trim();
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
