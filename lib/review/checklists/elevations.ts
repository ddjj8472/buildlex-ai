// 입면·단면도 체크리스트 — 일조 등을 위한 높이 제한, 높이·층수.
import type { Checklist } from "./types.ts";

export const checklistElevations: Checklist = {
  key: "elevations",
  title: "입면·단면도",
  sheet_types: ["elevation", "section", "site"],
  items: [
    {
      id: "4A", title: "일조 등의 확보를 위한 높이 제한(정북방향)", sheet_types: ["section", "elevation", "site"],
      requirement: "전용·일반주거지역에서는 정북방향 인접 대지경계선으로부터 높이 10m 이하 부분은 1.5m 이상, 10m 초과 부분은 해당 부분 높이의 1/2 이상 띄어야 한다(조례로 달리 정한 경우 그에 따름).",
      code_basis: ["건축법#61", "건축법시행령#86"],
      code_confidence: "HIGH", visual_confidence: "MEDIUM",
      visual: "단면도·배치도의 정북방향 사선, 대지경계선으로부터의 이격 치수(10m 이하/초과 부분 구분), 최고높이.",
      deficiencies: ["10m 초과 부분 이격이 높이의 1/2 미달", "정북 방향 표시 누락", "사선 미표기"],
      fields: ["용도지역", "높이", "정북이격_10m이하", "정북이격_10m초과"], kind: "daylight", section: "높이·일조",
    },
    {
      id: "4B", title: "높이·층수(가로구역·지구단위계획)", sheet_types: ["elevation", "section", "cover"],
      requirement: "가로구역별 최고높이, 지구단위계획·고도지구 등에서 정한 높이·층수 제한을 지켜야 한다. 일반 지역에는 국가 법령상 일률적 층수 제한이 없다.",
      code_basis: ["건축법#60", "국토의계획및이용에관한법률#52", "건축법시행령#119"],
      code_confidence: "MEDIUM", visual_confidence: "HIGH",
      visual: "입면도 최고높이 치수, 층수 표기, 건축개요의 '가로구역별 최고높이' 또는 지구단위계획 기준.",
      deficiencies: ["지구단위계획 최고층수 초과", "높이 산정 기준(지표면) 불명확"],
      fields: ["높이", "지상층수", "지구단위계획"], kind: "height", section: "높이·일조",
    },
  ],
};
