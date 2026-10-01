// 표지·건축개요 체크리스트 — 건축허가 신청 설계도서의 기본 표기사항.
import type { Checklist } from "./types.ts";

export const checklistCover: Checklist = {
  key: "cover",
  title: "건축개요·표지",
  sheet_types: ["cover"],
  items: [
    {
      id: "1A", title: "설계자(건축사) 날인", sheet_types: ["cover", "area", "site", "elevation", "floor"],
      requirement: "건축허가 대상 건축물의 설계는 건축사가 하여야 하며, 설계도서에 설계자가 서명·날인한다.",
      code_basis: ["건축법#23", "건축사법#19"],
      code_confidence: "HIGH", visual_confidence: "MEDIUM",
      visual: "표제란(우측 하단) 또는 우측 띠의 '건축사', '설계자', '(인)' 표기와 날인 흔적. 사무소명·건축사명 칸이 비어 있는지 확인.",
      deficiencies: ["건축사명 칸 공란", "날인 없이 '(인)'만 인쇄", "표제란 템플릿 문구(ARCHITECT NAME) 그대로 남음"],
      fields: ["건축사날인"], kind: "presence", section: "도서 요건", administrative: true,
    },
    {
      id: "1B", title: "대지위치·지역지구 표기", sheet_types: ["cover", "site"],
      requirement: "건축계획서에 대지위치(지번), 용도지역·지구·구역을 표기한다. 적용 조례와 건폐율·용적률 한도가 이에 따라 정해진다.",
      code_basis: ["건축법시행규칙#6", "국토의계획및이용에관한법률#76"],
      code_confidence: "HIGH", visual_confidence: "HIGH",
      visual: "건축개요(대지개요) 표의 '대지위치', '지역·지구', '용도지역' 행.",
      deficiencies: ["지번 누락('일원'만 표기)", "용도지구·지구단위계획구역 누락", "용도지역 표기와 토지이용계획 불일치"],
      fields: ["대지위치", "용도지역", "용도지구", "지구단위계획"], kind: "presence", section: "도서 요건", administrative: true,
    },
    {
      id: "1C", title: "건축개요 필수 수치", sheet_types: ["cover", "area"],
      requirement: "대지면적, 건축면적, 연면적, 건폐율, 용적률, 층수, 높이, 주차대수, 조경면적 등 건축개요 수치를 표기한다.",
      code_basis: ["건축법시행규칙#6", "건축법시행령#119"],
      code_confidence: "HIGH", visual_confidence: "HIGH",
      visual: "건축개요 표의 면적·비율 행. 단위(㎡, %)와 소수 둘째 자리까지 표기되는지.",
      deficiencies: ["용적률 산정용 연면적 미표기", "층수·높이 누락", "단위 누락"],
      fields: ["대지면적", "건축면적", "연면적", "건폐율", "용적률", "지상층수", "지하층수", "높이", "주용도"], kind: "presence", section: "도서 요건", administrative: true,
    },
  ],
};
