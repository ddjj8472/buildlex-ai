// 배치도 체크리스트 — 접도, 조경, 주차, 대지 안의 공지.
import type { Checklist } from "./types.ts";

export const checklistSitePlan: Checklist = {
  key: "site-plan",
  title: "배치도",
  sheet_types: ["site", "landscape", "parking"],
  items: [
    {
      id: "3A", title: "대지와 도로의 관계(접도)", sheet_types: ["site", "cover"],
      requirement: "대지는 2미터 이상 도로에 접해야 한다. 연면적 2천㎡(공장 3천㎡) 이상이면 너비 6미터 이상 도로에 4미터 이상 접해야 한다.",
      code_basis: ["건축법#44", "건축법시행령#28"],
      code_confidence: "HIGH", visual_confidence: "MEDIUM",
      visual: "배치도의 전면도로 폭(○m 도로) 표기와 대지가 도로에 접한 길이 치수.",
      deficiencies: ["접도 길이 치수 누락", "막다른 도로·통로형 대지에서 2m 미만 접도", "대규모 건축물인데 6m 미만 도로"],
      fields: ["접도길이", "전면도로폭", "연면적"], kind: "road", section: "대지·도로",
    },
    {
      id: "3B", title: "대지의 조경", sheet_types: ["site", "landscape", "cover"],
      requirement: "면적 200㎡ 이상 대지에 건축하는 경우 조례로 정하는 기준(연면적 규모별 대지면적의 ○% 이상)에 따라 조경을 해야 한다.",
      code_basis: ["건축법#42", "건축법시행령#27"],
      code_confidence: "HIGH", visual_confidence: "MEDIUM",
      visual: "배치도·조경계획도의 조경 영역 해치와 '조경면적 ○㎡', 건축개요의 조경면적·법정 조경면적.",
      deficiencies: ["조경면적이 조례 비율 미달", "옥상조경·인공지반 조경을 전부 산입", "조경 위치 미표시"],
      fields: ["대지면적", "연면적", "조경면적", "용도지역"], kind: "landscape", section: "주차·조경",
    },
    {
      id: "3C", title: "부설주차장 설치기준", sheet_types: ["site", "parking", "cover"],
      requirement: "시설물 용도와 시설면적(또는 세대)에 따라 주차장법 시행령 별표 1과 조례가 정한 대수 이상의 부설주차장을 설치해야 한다.",
      code_basis: ["주차장법#19", "주차장법시행령#6", "주차장법시행령#별표1"],
      code_confidence: "HIGH", visual_confidence: "MEDIUM",
      visual: "건축개요의 '주차대수'(법정/계획), 배치도·주차계획도의 주차구획 번호(P1, P2…)와 규격(2.5m×5.0m 등).",
      deficiencies: ["계획 대수가 법정 대수 미달", "법정 대수 산정 근거 미표기", "조례 강화기준 미반영"],
      fields: ["주용도", "연면적", "시설면적", "주차대수", "법정주차대수_도면", "세대수"], kind: "parking", section: "주차·조경",
    },
    {
      id: "3D", title: "대지 안의 공지", sheet_types: ["site"],
      requirement: "건축선 및 인접 대지경계선으로부터 용도·규모별로 조례가 정하는 거리 이상 띄어야 한다.",
      code_basis: ["건축법#58", "건축법시행령#80의2"],
      code_confidence: "HIGH", visual_confidence: "LOW",
      visual: "배치도의 건축선·대지경계선과 외벽 사이 이격 치수.",
      deficiencies: ["이격 치수 미표기", "용도별 이격거리(별표 2) 미달"],
      fields: [], kind: "open-space", section: "대지·도로",
    },
  ],
};
