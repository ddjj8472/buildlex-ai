// Prompts for the plan-review subagents (Phase 1 title blocks, Phase 2 sheet review).
// Phase 3 and 4 are deterministic: thresholds come from the corpus text, not the model.
import type { CheckItem } from "./checklists/index.ts";
import { FIELD_KEYS, type SheetEntry } from "./types.ts";

export const REVIEW_SYSTEM = `당신은 건축허가 도서를 허가권자(지자체 건축과) 입장에서 검토하는 보조 검토자입니다.
원칙:
- 오탐 금지. 보이지 않는 것은 추측하지 말고 UNCLEAR로 둡니다.
- 수치는 도면에 적힌 그대로 읽고, 읽은 원문(raw)을 함께 적습니다. 계산은 하지 않습니다(계산은 코드가 합니다).
- 구조·설비 등 공학적 적정성은 판정하지 않습니다.
- 판독 신뢰도(visual_confidence)를 항상 보고합니다: HIGH=선명한 표·문자, MEDIUM=작은 글씨·배치 해석 필요, LOW=추정.`;

export function titleBlockPrompt(pages: { page: number; text: string }[]): string {
  return `${REVIEW_SYSTEM}

이미지들은 건축 도면 각 페이지의 표제란(우측 하단)입니다. 순서대로 페이지 번호는 ${pages.map(p => p.page).join(", ")} 입니다.
각 페이지의 도면번호(예: A-101, A01-201)와 도면명(예: 배치도, 설계개요)을 읽어 주세요.
sheet_type은 cover(표지·건축개요·설계개요·도면목록·위치도) | area(면적표·면적산출) | site(배치도·대지종횡단) | floor | elevation | section | landscape | parking | structural | mep | other 중 하나입니다.

JSON만 출력: {"sheets":[{"page":번호,"sheet_id":"A-101","title":"배치도","sheet_type":"site"}]}`;
}

export function sheetReviewPrompt(group: string, checks: CheckItem[], sheets: SheetEntry[], texts: { sheet_id: string; text: string }[]): string {
  const checklist = checks.map(c => `### ${c.id} ${c.title}
- 요건: ${c.requirement}
- 찾을 위치: ${c.visual}
- 흔한 누락·오류: ${c.deficiencies.join("; ")}
- 읽을 값: ${c.fields.join(", ") || "(없음)"}`).join("\n\n");
  const textBlock = texts.map(t => `[${t.sheet_id} 텍스트 레이어 — 순서가 섞일 수 있음]\n${t.text.slice(0, 3500)}`).join("\n\n");
  return `${REVIEW_SYSTEM}

검토 그룹: ${group}
첨부 이미지는 다음 시트입니다(순서대로): ${sheets.map(s => `${s.sheet_id}(${s.title}, ${s.page}쪽)`).join(", ")}

## 체크리스트
${checklist}

## 텍스트 레이어(참고용, 이미지가 우선)
${textBlock || "(텍스트 레이어 없음 — 스캔 도면)"}

## 출력
1) values: 아래 키 중 도면에서 확인되는 것만. 숫자 필드는 숫자(콤마 없이), 단위는 unit에.
   키: ${FIELD_KEYS.join(", ")}
   - 건폐율_도면기준/용적률_도면기준: 도면에 "○○% 이하"처럼 적힌 기준값
   - 법정주차대수_도면: 도면에 적힌 법정(최소) 주차대수
   - 용도지구: 경관·고도·방화·방재·보호·취락·개발진흥지구 등 「국토계획법」상 용도지구 명칭만(없으면 생략)
   - 지구단위계획: 지구단위계획구역·택지개발지구 표기가 있으면 true
   - 건축사날인: 날인/서명 상태를 짧은 문장으로
2) findings: 체크리스트 항목마다 시트별 1건. status는 PASS(요소가 있고 표기가 일관됨) | FAIL(요소 누락·표기 모순) | UNCLEAR(판독 불가) | NOT_APPLICABLE.
   이 단계의 PASS/FAIL은 "도면 표기"에 대한 것입니다. 법정 기준 충족 여부는 다음 단계에서 법령으로 판정합니다.

JSON만 출력:
{"values":{"대지면적":{"value":330,"unit":"㎡","raw":"대지면적 330.00㎡","sheet_id":"A-001","confidence":"HIGH"}},
 "findings":[{"check_id":"2A","sheet_id":"A-001","status":"PASS","visual_confidence":"HIGH","observation":"건축면적 205.00㎡, 건폐율 62.12% 표기"}]}`;
}
