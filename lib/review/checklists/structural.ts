// 구조·설비 체크리스트 — 공학적 적정성은 판정하지 않고 검토자 확인란만 만든다.
import type { Checklist } from "./types.ts";

export const checklistStructural: Checklist = {
  key: "structural",
  title: "구조·설비",
  sheet_types: ["structural", "mep"],
  items: [
    {
      id: "5A", title: "구조 안전의 확인", sheet_types: ["structural", "cover"],
      requirement: "2층 이상(목구조 3층 이상), 연면적 200㎡ 이상 등 대상 건축물은 구조기준에 따라 구조 안전을 확인하고 착공신고 시 확인서류를 제출한다.",
      code_basis: ["건축법#48", "건축법시행령#32"],
      code_confidence: "HIGH", visual_confidence: "LOW",
      visual: "구조도 표지·구조설계 개요, 구조기술사 날인, 구조안전확인서 언급.",
      deficiencies: ["구조안전 확인 대상인데 구조도서 누락"],
      fields: ["지상층수", "연면적", "구조"], kind: "structural", section: "구조·설비",
    },
  ],
};
