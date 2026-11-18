# PROJECT V — 두 번째 맵 확장 준비 (NEXT_MAP_PREP.md)

**작성:** PV-1 Research (10차) · **기준일:** 2026-11-18

> **DECISION-009 준수:** 엔진 구현은 계속 **Ascent만** 대상이다. 이 문서는 공통 엔진 검증 후 **즉시 확장**할 수 있도록
> 2순위 맵의 **데이터·지식 계층만** 미리 준비한 것이다. 엔진·좌표·navgraph·메시는 포함하지 않는다.

## 1. 후보 선정 — **Lotus** (근거)
2순위 맵으로 **Lotus**를 선정. 근거(전부 검증 데이터):

| 기준 | Lotus | 비고 |
|---|---|---|
| 현재 맵 풀(≥13.x 국제전 출전) | ✅ 15맵 | 현재 풀: Abyss·Ascent·Haven·Lotus·Split·Summit·Sunset |
| 국제전 데이터량(총/최근) | 총 **145** / ≥9.x **89** / ≥11.x **48** | 확립된 맵 중 상위(Haven 165 다음). 충분한 표본 |
| Blender 접근성(README §10.1 11맵) | ✅ 포함 | PV-5 파이프라인 재사용 가능(Summit/Corrode는 11맵 외) |
| valorant-api 콜아웃 수 | **28** (A12/B4/C10) | 후보 중 최다(Haven 21, Sunset 17) → 풍부한 공간 구조 |
| 구조 다양성 | **3사이트(A/B/C)** | Ascent(2사이트+미드)와 달라 엔진 일반화 검증에 유리 |

**차점:** Haven(3사이트, 총 165맵, 최근 10). Lotus가 최근 출전·콜아웃 수·메타 적합성에서 우위.
**제외:** Summit(최근 18로 최다지만 신규맵이라 총량 적고 Blender 11맵 외), Icebox/Bind/Breeze/Fracture/Pearl(≥13.x 국제전 출전 0 = 현재 풀 밖).

## 2. 준비한 산출물 (Lotus)
기존 Ascent 파이프라인을 **맵 파라미터**로 그대로 실행(코드 변경 없음 — 빌더는 이미 `--map` 지원).

| 산출물 | 파일 | 상태 |
|---|---|---|
| 조합 통계 | `datasets/derived/comps/lotus-comps.json` | ✅ 실데이터(290 team-maps, Wilson CI). 공용 스키마(`ascent-comps.schema.json`) 통과 |
| 패치 이력 | `datasets/derived/meta/lotus-patch-history.json` | ✅ 맵 업데이트 15건 + 데이터구간 권고(≥9.x=89맵). 요원 밸런스는 전역(공용) 참조 |
| 전술 KB | `datasets/derived/tactics/lotus-tactics.skeleton.json` (+ `lotus-zone-vocabulary.json`) | 🟡 **골격만**. 구역 어휘는 **valorant-api 콜아웃 임시 ID**(navgraph 아님) |

**Lotus 통계 하이라이트(실측):** 공수 **atk 52.4% / def 47.6%**(Ascent와 반대로 **공격 우세**).
픽: Omen 94%·Raze 71%·Fade 68%·Viper 63%·Killjoy 40%. 최빈 조합 fade·killjoy·omen·raze·viper(73맵).
구조 안정(리워크 없음); 고유 기믹: **회전문(A/C)·로프 어센더**.

## 3. ⚠ 임시 구역 어휘 (중요)
`lotus-zone-vocabulary.json`의 `zoneTempIds`(예: `a-main`,`c-site`,`b-pillars`)는 **valorant-api 콜아웃 이름 기반
임시값**이다. **PV-4가 Lotus navgraph를 아직 만들지 않았으므로**, 전술 골격의 `zonesTemp`는 **navgraph 생성 후
실제 zone ID로 매핑 필요**(`needsPV4Navgraph: true`). 임시 ID로 좌표·경로·시간을 지어내지 않았다.

## 4. 다른 세션 인계 작업 (Lotus 확장 시)
| 담당 | 작업 | 선행 |
|---|---|---|
| **PV-4 Spatial** | Lotus 좌표계 + navgraph(zone/edge/sightline) 생성 → 임시 어휘를 실 zone ID로 교체 | valorant-api Lotus 콜아웃(28), PV-5 메시 |
| **PV-5 Map Mesh** | Lotus `.blend` 다운로드(🔒 사용자/Drive) → 충돌·보행 메시 → NavMesh | README §10.1 Lotus 링크, PV-5 파이프라인 |
| **PV-1 Research** | navgraph 확정 후 `lotus-tactics.json` 정식 작성(utilityRequirements/route/risks, 출처) + 효과 명세 재사용(전역) | PV-4 navgraph |
| **PV-2 Data** | priors에 `map_name='Lotus'` 필터(현재 메타는 patch≥9.0) 적용 — **PV-2 소유, 권고만** | lotus-comps / lotus-patch-history |
| **PV-3 Core** | 엔진은 Ascent 검증 후 확장(DECISION-009). 맵 비의존 로직 우선 | 공통 엔진 검증 |

## 5. 재생성
```bash
# DB(미커밋) 받기
curl -fSL https://vct-reference.com/dataset/vct.duckdb -o /tmp/vct.duckdb
# Lotus 조합 통계 (동일 빌더, --map)
python tools/catalog-builder/build_ascent_comps.py --db /tmp/vct.duckdb --map Lotus --out datasets/derived/comps/lotus-comps.json
pytest tools/catalog-builder -q   # Lotus 검증 + Ascent 회귀(동일 결과) 포함
```
회귀 테스트(`test_ascent_comps_regression_if_db`)가 **맵 파라미터화로 Ascent 결과가 바뀌지 않음**을 확인(DB 있을 때).
