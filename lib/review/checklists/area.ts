// 면적표 체크리스트 — 건폐율·용적률과 면적 산정.
import type { Checklist } from "./types.ts";

export const checklistArea: Checklist = {
  key: "area",
  title: "면적표·밀도",
  sheet_types: ["area", "cover"],
  items: [
    {
      id: "2A", title: "건폐율", sheet_types: ["area", "cover", "site"],
      requirement: "건폐율(건축면적/대지면적)은 용도지역별로 시행령 범위 안에서 도시·군계획조례가 정한 비율 이하여야 한다. 표기값은 산정값과 일치해야 한다.",
      code_basis: ["국토의계획및이용에관한법률#77", "국토의계획및이용에관한법률시행령#84", "건축법#55"],
      code_confidence: "HIGH", visual_confidence: "HIGH",
      visual: "건축개요·면적표의 '건축면적', '대지면적', '건폐율' 행. 괄호 안 '법정 ○○% 이하' 같은 기준 표기도 함께 읽는다.",
      deficiencies: ["건폐율 표기값과 건축면적/대지면적 계산값 불일치", "조례 기준 초과", "지구단위계획 기준(더 엄격)을 놓침"],
      fields: ["대지면적", "건축면적", "건폐율", "건폐율_도면기준"], kind: "bcr", section: "건축계획",
    },
    {
      id: "2B", title: "용적률", sheet_types: ["area", "cover", "site"],
      requirement: "용적률(용적률 산정용 연면적/대지면적)은 시행령 범위 안에서 도시·군계획조례가 정한 비율 이하여야 한다. 지하층·지상 주차용 면적 등은 산정에서 제외한다.",
      code_basis: ["국토의계획및이용에관한법률#78", "국토의계획및이용에관한법률시행령#85", "건축법#56", "건축법시행령#119"],
      code_confidence: "HIGH", visual_confidence: "HIGH",
      visual: "'용적률 산정용 연면적'(지상층 바닥면적 합계)과 '용적률' 행, 층별 면적표의 '산입/제외' 구분.",
      deficiencies: ["지하층을 용적률에 산입하거나 지상 주차면적을 누락", "조례 기준 초과", "표기값과 계산값 불일치"],
      fields: ["대지면적", "연면적", "용적률산정용연면적", "용적률", "용적률_도면기준"], kind: "far", section: "건축계획",
    },
  ],
};
