export type LawTopic = {
  id: string;
  label: string;
  triggers: string[];
  keywords: string[];
  laws: string[];
};

export const CORE_LAWS = [
  "건축법",
  "건축법 시행령",
  "건축법 시행규칙",
];

export const LAW_TOPICS: LawTopic[] = [
  {
    id: "permit",
    label: "허가·신고·용도변경",
    triggers: ["허가", "신고", "용도변경", "대수선", "증축", "신축", "사용승인"],
    keywords: ["건축허가", "건축신고", "용도변경", "대수선", "사용승인"],
    laws: CORE_LAWS,
  },
  {
    id: "zoning",
    label: "용도지역·건폐율·용적률",
    triggers: ["용도지역", "용도지구", "용도구역", "건폐율", "용적률", "개발행위"],
    keywords: ["용도지역", "건폐율", "용적률", "개발행위허가"],
    laws: [
      "국토의 계획 및 이용에 관한 법률",
      "국토의 계획 및 이용에 관한 법률 시행령",
      "국토의 계획 및 이용에 관한 법률 시행규칙",
      ...CORE_LAWS,
    ],
  },
  {
    id: "parking",
    label: "부설주차장",
    triggers: ["주차", "주차장", "주차대수", "부설주차장"],
    keywords: ["부설주차장", "설치기준", "주차단위구획"],
    laws: ["주차장법", "주차장법 시행령", "주차장법 시행규칙", ...CORE_LAWS],
  },
  {
    id: "escape",
    label: "피난·방화·마감",
    triggers: ["피난", "방화", "내화", "마감재", "계단", "방화구획", "출구"],
    keywords: ["피난시설", "방화구획", "내화구조", "마감재료", "직통계단"],
    laws: ["건축물의 피난ㆍ방화구조 등의 기준에 관한 규칙", ...CORE_LAWS],
  },
  {
    id: "structure",
    label: "구조안전",
    triggers: ["구조", "내진", "구조안전", "하중", "구조계산"],
    keywords: ["구조안전", "내진능력", "구조계산", "설계하중"],
    laws: ["건축물의 구조기준 등에 관한 규칙", ...CORE_LAWS],
  },
  {
    id: "site",
    label: "대지·도로·높이",
    triggers: ["도로", "접도", "대지", "일조", "높이", "이격", "조경"],
    keywords: ["대지와 도로", "접도", "일조", "높이제한", "대지의 조경"],
    laws: CORE_LAWS,
  },
];

export const SCOPE_LABELS = [
  "건축법 3단",
  "국토계획법 3단",
  "주차장법 3단",
  "피난·방화 규칙",
  "구조기준 규칙",
  "입력 지역 건축 조례",
];
