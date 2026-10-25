# BIM 법규검토 (/bim)

Revit에서 내보낸 IFC 모델을 웹에서 3D로 보고, 국내 건축법규로 **요소 단위** 자동 검토합니다.
문제가 있는 벽·계단·실을 3D에서 빨갛게 표시하고, BCF로 내보내 Revit에서 바로 찾을 수 있습니다.

> 자동 검토 초안입니다. 법률 자문이 아니며 인허가 가능성을 확정하지 않습니다.

---

## 1. 조사: 지금 쓰이는 BIM 법규검토 도구 (2026년 10월 기준)

| 도구 | 국가 | 입력 | 방식 | 이 프로젝트에 가져온 점 |
|---|---|---|---|---|
| **Solibri Office** (Nemetschek) | 핀란드·독일 | IFC | 매개변수가 있는 **룰 템플릿 → 룰셋**, 요소별 결과·심각도, 이슈 + 캡처 뷰, **BCF** 내보내기, IDS 검사(Rule 244), 접근 경로 검사(Rule 252) | 룰 엔진 구조 전체: 룰 = 템플릿 + 매개변수, 요소 단위 이슈, 3D 강조, BCF |
| **CORENET X** (싱가포르 정부) | 싱가포르 | **IFC-SG** | IFC에 국가별 속성(IFC-SG)을 넣고 정부 자동검토기(AMC)가 결정론적 규칙으로 검사, 2025년 10월부터 의무 | 국내 적용 방법: **BuildLex_KR 속성 세트** + Revit 내보내기 설정 파일 |
| **UpCodes** | 미국 | 2018년 Revit 플러그인 → 2026년 6월 PDF 도면 AI 검토 | 지적마다 해당 조문 연결 | 모든 결과에 조문 원문 인용(원문 대조 검증) |
| **Archistar eCheck** | 호주 (미국 Austin 시, ICC 협력) | 도면·모델 | 인허가 사전검토, 주로 용도지역(zoning) | 대지·밀도 검토(건폐율·용적률·조경·주차) |
| **KBimCode / KBimLogic** (연세대), 개방형BIM 연구단 | 한국 | IFC | 건축법 문장을 규칙 언어로 바꿔 검사 | 법령 문장 → 계산 가능한 기준값(우리는 코퍼스 원문에서 직접 파싱) |
| **AIBIM** (경북대, 2025) | 한국 | BIM | 10층 이하 2종 근생 적법성 약 90% 자동화 | 국내 대상 항목 선정 참고 |

**결론.** 미국 도구는 2026년 현재 PDF 도면 AI 검토 쪽으로 옮겨 갔습니다(UpCodes Plan Review, Archistar). *모델(IFC)* 을 규칙으로 검사하는 쪽에서 가장 앞선 것은 **Solibri의 룰 엔진**과 **싱가포르 CORENET X의 IFC 현지화**입니다. 그래서 BuildLex는

1. 엔진은 **Solibri 방식**(룰 템플릿 × 요소, 이슈·심각도·BCF),
2. 국내 적용은 **CORENET X 방식**(국가 속성 세트 + 내보내기 설정 + 정보 요건 IDS),
3. 결과 표시는 **UpCodes 방식**(조문 원문 인용)

으로 만들었습니다. 이미 있는 `/review`(PDF 도면 검토)가 UpCodes Plan Review와 같은 쪽이고, `/bim`이 Solibri·CORENET X 쪽입니다.

출처: [Solibri 25.12 릴리스](https://www.solibri.com/articles/release-highlights-release-25-12-0), [Solibri Model Checker 리뷰(AECbytes)](https://aecbytes.com/review/2018/SolibriModelChecker.html), [BCA CORENET X FAQ](https://www1.bca.gov.sg/regulatory-info/building-control/corenet-x/corenet-x-faq/new-data-requirements-and-technology), [UpCodes AI(2018)](https://www.constructiondive.com/news/ai-program-spell-checks-a-bim-models-code-compliance/526126/), [UpCodes Plan Review(2026.10)](https://www.prnewswire.com/news-releases/upcodes-ai-reviews-1-300-plan-sets-identifying-more-than-180-000-potential-issues-302906417.html), [Austin–Archistar](https://www.bdcnetwork.com/codes-and-standards/news/55237400/austin-texas-adopts-ai-driven-building-permit-software), [ICC–Archistar](https://www.iccsafe.org/about/periodicals-and-newsroom/international-code-council-collaborates-with-archistar-to-modernize-permitting-and-accelerate-housing-development), [KBimCode(ISARC 2016)](https://www.iaarc.org/publications/2016_proceedings_of_the_33rd_isarc_auburn_usa/kbimcode_based_applications_for_the_representation_definition_and_evaluation_of_building_permit_rules.html), [AIBIM 세미나(건축사신문 2025.3)](https://www.ancnews.kr/news/articleView.html?idxno=18725), [buildingSMART IDS](https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specifications-ids/)

## 2. 3D 뷰어: web-ifc + three.js

| 후보 | 판단 |
|---|---|
| **web-ifc** (That Open Engine의 IFC 엔진, MPL-2.0) + **three.js** | **채택.** 브라우저에서 IFC를 직접 읽음. 검토에 쓰는 삼각형과 화면의 삼각형이 같아서, 측정한 요소를 그대로 강조할 수 있음 |
| @thatopen/components 3.x | 기능은 많지만 형상을 Fragments 형식으로 바꿔 워커 안에 숨김 → 검토용 형상을 따로 한 번 더 읽어야 함(2배 시간). API 변경도 잦음 |
| xeokit | 성능 좋음. **AGPL** 라이선스 |
| Autodesk APS Viewer | 클라우드 변환·계정·비용 필요, 학생 프로젝트에 과함 |

뷰어 기능: 층 분리, 평면 보기, 1.2 m 평면 단면, X-ray, 실(룸) 색상 표시, 요소 클릭 속성 보기, 이슈 클릭 시 문제 요소만 빨간색 + 카메라 이동, **보행거리 히트맵과 최단 경로**, **정북 일조 사선(허용 높이 경계면)**, 대지경계선·진북 표시. `BatchedMesh`로 그려서 큰 모델도 draw call이 몇 개뿐입니다.

## 3. 구조

```
브라우저(Web Worker)                         서버(/api/bim/check)                       브라우저
IFC ─ web-ifc ─▶ ParsedModel ─ analyze() ─▶ BimFacts ─▶ rules.ts ──────────────▶ 요소 단위 이슈
 (파일은 서버로 안 감)        면적·높이·보행거리·    (측정값 요약)   기준값 = 코퍼스의 현행 조문 파싱    3D 강조 · BCF · 보완요구서
                              정북 이격·계단 치수…                  조례(시·군·구 → 광역) 자동 적용
```

| 파일 | 역할 |
|---|---|
| `lib/bim/ifc-read.ts` | web-ifc로 단위·층·실·속성(인스턴스+타입 Pset/Qto)·형상·대지경계·진북 읽기 |
| `lib/bim/analyze.ts` | 측정: 건축면적(외곽 → 외벽 중심선 환산), 층별 바닥면적, 높이·층수, 실 분류, 창↔실 연결, 계단 경간(단·폭·난간), 복도 양옆 거실, 주차구획, 보행거리(격자 최단경로), 정북 이격(정점 → 진북 광선) |
| `lib/bim/geometry.ts` | 평면 래스터, 평면 절단, 16방향 다익스트라, 최소 외접 직사각형, 볼록 껍질 |
| `lib/bim/law-parse.ts` | 조문 원문에서 기준값 파싱(30 m·50 m, 1.2 m, 18/26 cm, 1/10 …) |
| `lib/bim/rules.ts` | 룰셋 "KR 건축법규 기본", 조례 적용, 보완요구서(안) |
| `lib/bim/convention.ts` | BuildLex_KR 속성 정의(단일 출처), 실 이름 → 용도 분류 |
| `components/bim/*` | 워커, 3D 뷰어, 화면, BCF 내보내기 |

## 4. 검토 항목 (룰셋 "KR 건축법규 기본")

| ID | 항목 | 근거(코퍼스에서 기준값을 읽는 조문) | 모델에서 재는 방법 |
|---|---|---|---|
| 2A | 건폐율 | 국토계획법 시행령 §84, 도시계획 조례 | 1 m 넘는 부분의 수평투영 → 외벽 중심선 환산 ÷ 대지면적 |
| 2B | 용적률 | 국토계획법 시행령 §85, 도시계획 조례 | 지상층 바닥면적 합(지상 주차 제외) ÷ 대지면적 |
| 3A | 접도 | 건축법 §44, 시행령 §28 | BuildLex_KR 접도길이·전면도로폭 |
| 3B | 조경 | 건축법 §42, 건축 조례 | '조경' 요소 수평투영 |
| 3C | 주차대수 | 주차장법 §19, 시행령 §6·별표 1, 주차장 조례 | 주차구획 요소 개수 |
| B-NORTH | 정북 일조 이격(3D) | 시행령 §86, 건축 조례 | **모든 정점**에서 진북 방향으로 대지경계선까지 거리, 높이별 기준 |
| B-EGRESS-DIST | 직통계단까지 보행거리 | 시행령 §34① (30 m / 내화 50 m / 16층↑ 공동주택 40 m) | 바닥 위 1.1 m 단면, 벽·창은 막고 문은 통과, 거실 각 지점 → 가장 가까운 계단 |
| B-EGRESS-COUNT | 직통계단 2개소 | 시행령 §34② 1~5호 | 층별 거실 면적 × 용도, 계단실 개수 |
| B-STAIR-WIDTH | 계단·계단참 유효너비 | 피난방화규칙 §15②, 주택건설기준 §16① | 경간 폭(오름 방향에 수직), 계단참 깊이 |
| B-STAIR-STEP | 단높이·단너비 | 피난방화규칙 §15②1·2(학교), 주택건설기준 §16①(공동주택) | IfcStairFlight 속성 → Pset → 디딤판 높이 군집 |
| B-STAIR-LANDING | 계단참 간격·너비 | 피난방화규칙 §15①1(3 m), 주택건설기준 §16②1(2 m) | 경간 상승 높이 |
| B-STAIR-GUARD | 계단 양옆 난간 | 피난방화규칙 §15①2 | 경간 양옆 0.3 m 안의 벽·난간 |
| B-CORRIDOR | 복도 유효너비 | 피난방화규칙 §15의2 표 | 복도 실의 등가 직사각형 폭, 양옆 실 용도 |
| B-CEILING | 거실 반자높이 | 피난방화규칙 §16, 시행령 §50 | 실 높이(또는 FinishCeilingHeight) |
| B-DAYLIGHT-WINDOW | 채광·환기 창 면적 | 시행령 §51①, 피난방화규칙 §17 | 창 폭×높이를 창 양쪽 실에 합산 |
| B-GUARD | 옥상·노대 난간 높이 | 시행령 §40①, 주택건설기준 §18② | Pset_RailingCommon.Height 또는 형상 |
| B-DOOR | 주출입구 유효폭 | 편의법 시행규칙 별표 1 (본문 미수록 → 내장값, 원문 대조 표시) | 문 폭 − 문틀 추정, 또는 유효폭 속성 |
| B-PARKING-STALL | 주차구획 크기 | 주차장법 시행규칙 §3① 표 | 주차구획 요소의 최소 외접 직사각형 |

모든 기준값은 `npm run corpus`로 만든 코퍼스의 **오늘 시행 중인 조문**에서 읽습니다. 법이 바뀌면 코퍼스를 다시 만드는 것만으로 검토 기준이 바뀝니다. 인용문은 조문 원문에 실제로 있는지 기계적으로 대조해 `verified`로 표시합니다.

## 5. 국내 법규 적용 방안 — BuildLex_KR

싱가포르가 IFC에 IFC-SG 속성을 더한 것처럼, 국내 검토에 필요한데 Revit이 기본으로 내보내지 않는 정보만 `BuildLex_KR` 속성 세트로 추가합니다. 나머지는 Revit 기본 내보내기(룸 이름, 벽 '외부' 기능, 계단 단 치수, 문 폭, 난간 높이)를 그대로 씁니다.

| 대상 | 속성 | 쓰임 |
|---|---|---|
| 대지(IfcSite) | 대지위치, 용도지역, 용도지구, 대지면적, 전면도로폭, 접도길이, 지구단위계획 | 조례 지역, 건폐율·용적률·일조 기준 |
| 건물(IfcBuilding) | 주용도, 세대수, 주요구조부내화, 사업계획승인대상, 구조, 지표면표고 | 계단·복도·채광 기준 분기, 보행거리 30/50 m, 주택건설기준 적용 |
| 층(IfcBuildingStorey) | 피난층, 층용도 | 피난층 제외, 복합용도 |
| 실(IfcSpace) | 실용도, 세대번호, 용적률제외 | 거실/복도/계단실 구분, 층별 세대수 |
| 문 | 주출입구, 유효폭 | 출입구 폭 |
| 난간 | 난간위치(계단/옥상/노대/실내) | 난간 높이 기준 |
| 주차구획 | 실용도=주차구획, 주차형식 | 구획 크기 기준 |

속성이 없어도 동작합니다. 실용도는 실 이름(거실·침실·복도·계단실…)으로 추정하고, 모르는 실은 보수적으로 거실로 봅니다. 어떤 값을 어디서 가져왔는지(속성/형상/추정)는 결과와 "모델 정보" 탭에 표시됩니다.

배포 파일(모두 `scripts/make-bim-kit.ts`가 `lib/bim/convention.ts`에서 생성):

- `public/bim/BuildLex_KR_SharedParameters.txt` — Revit 공유 매개변수 파일
- `public/bim/BuildLex_KR_IFC_PropertySets.txt` — Revit IFC 내보내기 "사용자 정의 속성 세트" 매핑
- `public/bim/buildlex-kr.ids` — buildingSMART **IDS 1.0** 정보 요건(스키마 검증 통과, Solibri·BIMcollab·ifctester로 모델 사전 점검 가능)

## 6. Revit 2025 작업 순서

1. **공유 매개변수 추가**: 관리 → 공유 매개변수 → `BuildLex_KR_SharedParameters.txt` 열기 → 관리 → 프로젝트 매개변수에서 아래처럼 바인딩
   - 프로젝트 정보: 대지위치, 용도지역, 대지면적, 주용도, 세대수, 주요구조부내화 … (IfcSite·IfcBuilding 값으로 나갑니다)
   - 룸: 실용도, 세대번호, 용적률제외 / 문: 주출입구, 유효폭 / 난간: 난간위치 / 주차: 실용도, 주차형식 / 레벨: 피난층, 층용도
2. **룸 배치와 이름**: 모든 실에 룸을 두고 이름을 "거실·침실·복도·계단실·화장실…"로 씁니다. 룸 상한을 천장(또는 위층 슬래브 아래)까지 맞추면 반자높이가 정확해집니다.
3. **외벽 지정**: 외벽 유형의 *기능*을 "외부"로 둡니다(→ `Pset_WallCommon.IsExternal`).
4. **대지경계**: 대지경계(속성선)를 IfcSite 외곽으로 내보내거나, 얇은 바닥/일반 모델로 대지 모양을 그리고 이름을 **"대지경계"**로 둡니다. 둘 다 없으면 건축개요 탭에 정북 이격거리를 직접 입력하세요.
5. **진북**: 관리 → 위치 → 진북 회전을 맞추고 공유 좌표로 내보내면 TrueNorth가 들어갑니다(없으면 +Y를 정북으로 봅니다).
6. **IFC 내보내기**: 파일 → 내보내기 → IFC → 설정 수정
   - IFC 버전: IFC4 Reference View 또는 IFC2x3 Coordination View 2.0
   - 추가 콘텐츠: **룸 내보내기** 켜기
   - 속성 세트: Revit 공통 속성 세트, 기본 수량(Base Quantities) 켜기, **사용자 정의 속성 세트** = `BuildLex_KR_IFC_PropertySets.txt`
7. (선택) 내보낸 IFC를 `buildlex-kr.ids`로 사전 점검 → `/bim`에 업로드.
8. 결과 탭에서 이슈를 고치고, **BCF 이슈(.bcfzip)** 를 받아 BIMcollab Zoom / BCF Manager로 Revit에서 열면 해당 요소로 이동합니다.

RevitCortex MCP를 쓰는 경우 `add_shared_parameter`, `ifc_export_with_configuration` 도구로 1·6단계를 Claude에게 맡길 수 있습니다.

## 7. 측정 정확도와 한계

- 면적은 평면 래스터(최대 1,500칸)로 재고 외벽 중심선으로 환산합니다. 정밀도(±㎡)를 함께 표시합니다. 처마 1 m 후퇴, 발코니 1.5 m 제외, 옥탑 1/8 규정은 반영하지 않았습니다.
- 보행거리는 0.2 m 격자 16방향 최단경로로, 실제 직선 경로보다 최대 약 3% 길게 나옵니다(안전 측). 계단실 출입구에 닿는 지점까지 잽니다.
- 정북 이격은 도로·공원 등에 접한 대지의 완화(시행령 §86 단서)를 반영하지 않았습니다.
- 지구단위계획, 심의 조건, 방화구획, 피난계단 구조, 소방 등은 아직 범위 밖입니다.
- 브라우저에서 여는 IFC는 300 MB 이하로 제한했습니다.

## 8. 개발

```bash
npm install                    # postinstall이 web-ifc.wasm을 public/vendor/web-ifc로 복사
npm run dev                    # http://localhost:3000/bim
npm test                       # tests/bim.test.ts 포함
python3 scripts/make-test-ifc.py   # 샘플 IFC 2종 + 정답값 (pip install ifcopenshell)
npx tsx scripts/make-bim-kit.ts    # Revit 키트·IDS 재생성
```

새 규칙 추가: `lib/bim/law-parse.ts`에 조문 파서 → `lib/bim/rules.ts`에 `ruleXxx(c)` 추가 → 측정값이 더 필요하면 `analyze.ts`와 `BimFacts`에 추가 → 샘플 모델·테스트 갱신.
