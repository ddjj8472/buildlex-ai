# 실제 민원(법제처 해석례 60건) 평가 — 이어하기 메모

- q0~q4.js: 사이트(브라우저 콘솔)에서 /api/ask 에 holdout 붙여 60건 돌리는 러너. 결과는 Blob 다운로드.
- 기준(main, 수정 전): 결론 일치 36/56, 핵심 조문 검색 47/56, 생성 실패 2건 (결과: 사용자 Downloads/buildlex_minwon_run1.json)
- ret_eval.mts: 오프라인 검색 재현 (`npx tsx scripts/eval-minwon/ret_eval.mts`) — 수정 후 46 → 55/56
- bim-check.ts: IFC 로컬 BIM 검토 (`npx tsx scripts/eval-minwon/bim-check.ts <ifc>`)

## 남은 일
1. PR #3 프리뷰(또는 머지 후 프로덕션)에서 60건 재실행 → run1과 비교 채점
2. 결과 보고 후 필요 시 반복 수정
3. IFC 측정: Documents/BuildLex_Demo/BuildLex_Demo_1_위반안.ifc → FAIL 3, _2_수정안.ifc → FAIL 0 확인 (사이트 /bim + 로컬)
