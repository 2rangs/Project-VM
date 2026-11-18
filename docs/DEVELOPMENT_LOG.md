# PROJECT V — DEVELOPMENT LOG (2026-11-18 오케스트레이션 세션)

**작성:** PV-1 Research (9차 종합) · 전 브랜치 커밋 로그·handoff를 **읽기 전용**으로 정리.
브랜치별 차수(phase/pass)·커밋 해시·핵심 결과·**음성 결과(negative)**를 기록. 사실은 커밋/handoff 확인분만.

> **진행 중(이 로그 이후 갱신 예정):** PV-2 7차, PV-3 리허설, PV-4 7차, PV-5 2차, PV-6 4차.

---

## PV-1 Research (`claude/pv-research`, tip `c978c86`, 12 커밋)
| 차수 | 커밋 | 결과 |
|---|---|---|
| 1 | `f77a3d4` | 데이터 소스 레지스트리 + 핵심 5저장소 검증(C9/vrfkit/ValoReview/VRP/VWR) |
| 2 | `010368d` | 게임 데이터 카탈로그 빌더·스키마(무기21/요원30/스킬130) |
| 3 | `60a1c3c` | 스킬/장비 수치 공식 위키 소싱(궁극 30/30) |
| — | `a31a449` | Riot content API UUID 교차검증(30/30·21/21), match 403 기록 |
| 4 | `6759b5c` | Ability Effect Spec(Ascent 10요원) |
| 5 | `18b4275`·`85bee8d`·`63b942e` | 실 Ascent 조합통계(VCT Reference) · GRID 조사 · 효과 30요원(119/120) |
| 6 | `96eb348` | Ascent 전술 KB(navgraph 검증) + Astra Nebula 보강(120/120) |
| 7 | `2886c81` | 전술 출처 보강 + 패치/메타 이력 + 데이터구간 권고(patch≥9.x) |
| 8 | `313d849`·`c978c86` | 사전 통합 감사(라이선스·개인정보·출처) + 실명 정책 반영 |
- **음성:** GRID per-tick 위치 없음; Riot match API 403; vrfkit 빌드 환경차단; 실명 미발견(합성/라벨뿐).

## PV-2 Data (`claude/pv-data`, tip `0eb7010`, 7 커밋) — **7차 진행 중**
| phase | 커밋 | 결과 |
|---|---|---|
| 1 | `33b5ed7` | 소스 검증, 공통 스키마, ETL(data-collector)+검증기(data-validator) |
| — | `fe24694` | vlr.gg ToS 제약 + VCT Reference 약관 판단 기록 |
| 2 | `5066b33` | 실 VCT 데이터 기반 의사결정 prior + 검증 baseline |
| 3 | `09894ea` | Economy & Ultimate Engine v0(packages/economy-engine) |
| 4 | `3ab3b2e` | 오프닝 듀얼 전투 prior + 시뮬 검증 하네스 |
| 5 | `fe35409` | 선-라운드 라운드가치 모델(baseline+LightGBM+ONNX seam) |
| 6 | `0eb7010` | 선수 능력치 추정(불확실성·shrinkage·honest null) |
- **핵심:** VCT Reference L2(DuckDB, Layer A). 실 경기 정규화(754737 GF, 754730).
- **음성:** vlr.gg 위치 추출은 ToS로 **미구현**; Layer B는 **명시 합성 데이터**로 대체.

## PV-3 Simulation Core (`claude/pv-core`, tip `9d7ba29`, 11 커밋) — **리허설 진행 중**
| phase | 커밋 | 결과 |
|---|---|---|
| P0 | `0d58165` | 모노레포 스캐폴드(shared-types/simulation-core/game-rules/world-state, 45 테스트) |
| T006 | `ab5d88c` | 시나리오 로더 + SpatialQuery/ObservationProvider seam |
| — | `6ffb35d` | decision-engine: Belief State v0 + DecisionContext |
| T007 | `21aa4c4` | action-generator: 상황기반 후보 생성·평가 |
| T008 | `0dc4512` | decision-debugger: 구조적 trace + CLI |
| 2 | `6a8efa3` | DECISION_MODEL + TEST_PLAN + phase-2 handoff |
| 3A | `c37e11b`·`6a22615` | game-rules 궁극값 검증 + EconomyEvaluator seam(PV-2 정합) |
| 3A | `dc349b5` | team-engine: IGL + player policy + DecisionPolicy 계약 |
| 3B | `7bd6d87` | outcome-predictor: 예산 제한 제한적 전방탐색 v0 |
- **음성:** Electron 앱 없음; spatial-engine은 PV-4 소관(core에 없음).

## PV-4 Spatial (`claude/pv-spatial`, tip `94fa92f`, 7 커밋) — **7차 진행 중**
| ver | 커밋 | 결과 |
|---|---|---|
| v0/v1 | `d07fffb`·`4a1cf0d` | Ascent 공간 모델 + spatial-engine(navgraph) + vlr ToS 확인 |
| v2 | `83c0a77` | perception-engine(vision/hearing/memory/comms, 17) |
| v3 | `ab3a919` | combat-engine(결정적 듀얼, 15) |
| v4/4.1 | `e3a66d8`·`e3ad1c5` | ability-engine(18) + PV-1 ability-effect 스키마 정합 |
| v5 | `94fa92f` | round-simulator(결정적 5v5 라운드 루프, 9) — 5패키지 80 테스트 |
- **음성:** vlr.gg 2D 위치는 ToS로 사용 불가(확인); navgraph는 수동근사(노드만 valorant-api 실측).

## PV-5 Map Mesh (`claude/pv-mapmesh`, tip `5840e6d`, 5 커밋) — **2차 진행 중**
| 커밋 | 결과 |
|---|---|
| `c4fcf1b` | Ascent Blender 맵 다운로드(Playwright, 326MB SHA확인) + provenance |
| `1e67f38` | Blender 4.2 헤드리스 장면 분석 |
| `8eb2df8` | 충돌 메시 추출 + Blender↔게임 좌표변환(RMS 6.6m) |
| `ee5775c` | NavMesh 빌드(recast-navigation-js) + 경로 보정 |
| `5840e6d` | handoff |
- **음성:** NavMesh 연결성 한계 기록; 원시 .blend/.bin은 gitignore.

## PV-6 Replay (`claude/pv-replay`, tip `06b46d6`, 6 커밋) — **4차 진행 중**
| 커밋 | 결과 |
|---|---|
| `e3f4fda` | Linux .vrf extract→normalize 파이프라인 + 합성 테스트 7종 |
| `1be1247` | 파서 평가(§8.2) + vrf 캡처 가이드 |
| `205b41e` | kinematics + 맵 투영 분석 |
| `ccf8583` | Ascent 캡처 kinematics + 좌표검증 + **개인정보 스크럽** |
| `d54c1b7` | 통합 리플레이 포맷 + replay-engine |
| `06b46d6` | 독립 PixiJS 리플레이 뷰어 + handoff |
- **핵심:** ValorantReplayParser Linux 빌드, `.vrf` 2개 L3 디코드(3001 movement). ProfileName 익명화(player_N).
- **음성:** vrfkit cargo 빌드 환경차단; .NET 바이너리·실 .vrf·decode-full 미커밋.

---
*전 브랜치 미머지 상태. 통합은 오케스트레이터가 수행. 커밋 해시는 2026-11-18 tip 기준.*
