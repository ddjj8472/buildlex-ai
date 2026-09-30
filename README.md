# BuildLex AI v2 — 건축법령 해석 AI

건축 관련 법령과 전국 지자체 조례를 **조문 근거로** 답하는 AI 서비스입니다. 하이브리드 검색(BM25 + 시맨틱 + RRF), 국가법령정보 Open API 연계, 6단계 에이전트 파이프라인, 멀티턴 대화로 구성됩니다.

> 답변은 법률 자문이 아니며 인허가 가능성을 확정하지 않습니다.

## 무엇이 달라졌나 (v1 → v2)

| | v1 | v2 |
|---|---|---|
| 데이터 | 질문마다 법제처 API로 법령 전문을 실시간으로 받아 옴 (느리고 자주 실패) | **legalize-kr 스냅샷을 미리 색인** (국가법령 86개 파일·5,425개 조문, 전국 243개 지역 조례 454건·22,208개 조문) |
| 현행성 | 최신 공포본 = 현행으로 취급 | git 연혁에서 **오늘 시행 중인 버전**을 고르고, 시행 예정 개정은 따로 경고 |
| 검색 | 부분 문자열 일치 + 질문별 수작업 점수 | **BM25(어절 + 음절 bigram, 조문 제목 가중) × 여러 질의 변형 + 의미 검색 → RRF 융합 → AI 재순위** |
| 연결 | 없음 | 법→시행령→시행규칙 **위임 그래프(11,942개 인용 링크)**, 별표, 조례 자동 확장 |
| 검증 | 근거 번호 범위만 확인 | 근거 번호와 **인용 조문의 실제 존재 여부**를 기계적으로 검증, 품질 평가 후 **자동 재검색** |
| 화면 | 단일 폼 | 대화형 화면: 대화 기록, 6단계 진행 표시, 근거 패널, 대지 조건 기억, 다크 모드, 모바일 |

검색 정확도는 AI 없이 규칙 기반 질의 분석만 켠 상태에서 같은 코퍼스로 쟀습니다. 정답 조문이 상위 5개 안에 들어간 비율(Recall@5)입니다.

| 평가셋 | v1 알고리즘 | v2 |
|---|---|---|
| 개발셋 43문항 (`tests/gold.json`) | 0.58 | **0.84** |
| 튜닝에 쓰지 않은 검증셋 15문항 (`tests/heldout.json`) | 0.60 | **0.73** |

실서비스에서는 Gemini 질의 분석·재순위·임베딩이 더해져 수치가 더 올라가는 것이 정상입니다. 위 수치는 그 부분을 뺀 하한선입니다. 확인하려면 `npm run eval`, `npm run eval -- tests/heldout.json`을 실행하세요.

## 6단계 파이프라인

```
질문 ─▶ ① 질의 분석     일상어→법령용어 확장, 대지 조건 추출, 관련 법령 추정, 후속 질문 복원
      ─▶ ② 법령 검색     BM25(원문·확장·하위질의) + Dense → RRF(k=60) → LLM 재순위(0~3점)
      ─▶ ③ 연결 조문     인용 그래프로 상·하위 위임 조문과 별표 추가, 지역 조례(시·군·구 + 광역) 검색
                        별표 본문과 법제처 법령해석례는 Open API로 실시간 조회
      ─▶ ④ 답변 생성     ## 결론 / 근거 법령 / 세부 해석 / 추가 확인 사항, 모든 요건에 [n]
      ─▶ ⑤ 인용 검증     [n] 범위, 「법령」 제N조가 현행 조문에 실제로 있는지, 근거 밖 조문 언급
      ─▶ ⑥ 품질 평가     근거 충실성 채점 → "자동 재검색" 모드면 부족한 쟁점을 다시 검색해 재작성
```

- 키가 없으면: AI 없이 **검색 전용 모드**로 동작하고, 관련 조문 목록을 보여 줍니다.
- `MOCK_LLM=1`이면: 모의 답변으로 화면만 확인할 수 있습니다.

## 폴더 구조

```
app/                 Next.js 화면 + API (/api/ask SSE 스트리밍, /api/search, /api/article, /api/regions)
components/          App(대화), Panel(근거·해석례·대지조건), Markdown(인용 칩), RegionPicker
lib/
  tokenize.ts        한국어 토크나이저 (조사 제거 어절 + 음절 bigram)
  bm25.ts            typed-array 역색인 BM25 (본문/제목 2필드)
  corpus.ts          코퍼스 로딩, 조문 → 700자 패시지 분할 색인, 지역 조례 샤드
  search.ts          하이브리드 검색, RRF, 재순위, 위임 그래프 확장, 조례 검색
  dense.ts           Gemini 임베딩 (int8 양자화 저장, 코사인)
  analyze-rules.ts   규칙 기반 질의 분석, 대지 조건 추출
  lexicon.ts         일상어→법령용어 사전, 주제→법령 힌트
  pipeline.ts        6단계 에이전트 오케스트레이션
  prompts.ts         에이전트별 프롬프트
  verify.ts          인용 검증 (환각 게이트)
  law-api.ts         국가법령정보 Open API (별표 본문, 법령해석례)
data/
  law-list.ts        색인 대상 법령 목록 / 조례 종류
  index/             빌드된 코퍼스 (national.json, ord/*.json, regions.json, embeddings-*)
  knowledge/notes.json  운영지식 메모 (검토 후 추가·수정)
scripts/
  fetch-sources.sh   legalize-kr / ordinance-kr 원본 받기
  build-corpus.ts    조문 파싱, 현행 버전 선택, 인용 그래프 생성
  embed.ts           의미 검색 색인 생성 (증분)
  eval-retrieval.ts  검색 정확도 평가
docs/refresh-corpus.workflow.yml       매주 코퍼스 자동 갱신 (.github/workflows로 옮겨 사용)
```

## 실행

```bash
npm install
cp .env.example .env.local        # GEMINI_API_KEY, LAW_API_OC 입력
npm run dev                       # http://localhost:3000
```

코퍼스(`data/index`)는 저장소에 포함되어 있습니다. 새로 만들려면 다음을 실행합니다.

```bash
bash scripts/fetch-sources.sh ../sources
LEGALIZE_DIR=../sources/legalize-kr ORDINANCE_DIR=../sources/ordinance-kr LAW_API_OC=발급키 npm run corpus
GEMINI_API_KEY=... npm run embed  # 선택: 의미 검색 색인 (약 5,400개 조문)
npm test && npm run eval
```

`LAW_API_OC`를 넣고 corpus를 빌드하면 **별표 본문까지 색인**됩니다(권장). 예를 들어 건축법 시행령 별표 1(용도별 건축물의 종류)이 여기에 해당합니다. 키가 없으면 별표는 제목만 색인되고, 답변할 때 API로 조회하거나 첨부 링크로 안내합니다.

## Vercel 배포

1. 이 저장소를 Vercel에 Import합니다. Framework는 Next.js입니다.
2. Environment Variables에 다음을 넣습니다. 키는 `NEXT_PUBLIC_` 접두어 없이 서버 전용으로 둡니다.
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`
   - `LAW_API_OC`
   - (선택) `GEMINI_FAST_MODEL`
3. `/api/ask`는 `maxDuration = 60`입니다. 자동 재검색 모드는 시간이 더 걸릴 수 있으니, 가능하면 Pro 플랜에서 더 긴 실행 시간을 쓰세요.
4. 코퍼스 파일은 `next.config.ts`의 `outputFileTracingIncludes`로 서버 함수에 포함됩니다(약 45MB).

매주 코퍼스 자동 갱신: `docs/refresh-corpus.workflow.yml`을 GitHub 웹에서 `.github/workflows/refresh-corpus.yml`로 옮기고, Actions 시크릿(`LAW_API_OC`, `GEMINI_API_KEY`)을 등록하세요. 매주 코퍼스를 새로 빌드해 커밋하고, Vercel이 자동으로 다시 배포합니다. (워크플로 파일은 토큰 권한 문제로 웹 화면에서 추가해야 합니다.)

## 확장 방법

- **법령 추가**: `data/law-list.ts`에 legalize-kr 폴더명을 추가한 뒤 `npm run corpus`를 실행합니다.
- **운영지식**: `data/knowledge/notes.json`에 `{id, title, tags(정규식), text, refs}`를 추가합니다. 전문가 검토를 거친 내용만 넣으세요. 답변에서는 "(운영지식)"으로 표시되고, 법적 근거 번호로는 쓰이지 않습니다.
- **평가셋**: `tests/gold.json`에 `{q, gold:[조문 id]}`를 추가합니다. 조문 id 형식은 `법령키#조번호`입니다(예: `건축법시행령#3의2`, `주차장법시행령#별표1`).
- **동의어**: `lib/lexicon.ts`에 일반적인 어휘 대응만 추가합니다. 특정 질문의 답을 넣지 않습니다.

## 데이터 출처

- 법령·자치법규 원문: 국가법령정보센터. legalize-kr의 Git 스냅샷(https://github.com/legalize-kr)을 거쳐 받습니다. 법령은 저작권법 제7조에 따라 보호받지 않는 저작물입니다.
