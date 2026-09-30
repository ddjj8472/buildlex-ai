import type { EvidenceView, Interpretation, QueryAnalysis, SiteFacts, StageId } from "@/lib/types";

export type StageState = { status: "pending" | "running" | "done" | "skipped" | "error"; detail?: string; ms?: number };

export type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  stages?: Partial<Record<StageId, StageState>>;
  analysis?: QueryAnalysis;
  evidence?: EvidenceView[];
  interpretations?: Interpretation[];
  notes?: { title: string; text: string }[];
  warnings?: string[];
  verify?: { ok: boolean; issues: string[] };
  evaluation?: { score: number; verdict: string; notes: string[]; retried: boolean };
  error?: string;
  done?: boolean;
  llm?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Msg[];
  facts: SiteFacts;
  region: string;
};

export const STAGES: { id: StageId; label: string }[] = [
  { id: "analyze", label: "질의 분석" },
  { id: "retrieve", label: "법령 검색" },
  { id: "expand", label: "연결 조문" },
  { id: "answer", label: "답변 생성" },
  { id: "verify", label: "인용 검증" },
  { id: "evaluate", label: "품질 평가" },
];

export const FACT_FIELDS: { key: keyof SiteFacts; label: string; placeholder: string }[] = [
  { key: "용도지역", label: "용도지역", placeholder: "예: 제2종일반주거지역" },
  { key: "건축물용도", label: "건축물 용도", placeholder: "예: 제2종 근린생활시설" },
  { key: "대지면적", label: "대지면적", placeholder: "예: 330㎡" },
  { key: "연면적", label: "연면적", placeholder: "예: 900㎡" },
  { key: "층수", label: "층수", placeholder: "예: 지상 5층" },
  { key: "도로", label: "접도 조건", placeholder: "예: 너비 6m 도로" },
  { key: "허가시점", label: "허가·착공 시점", placeholder: "예: 2017년 2월 허가" },
  { key: "기타", label: "기타", placeholder: "예: 지구단위계획구역" },
];
