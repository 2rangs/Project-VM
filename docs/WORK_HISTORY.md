# PROJECT V — 작업 히스토리 (Orchestration Log)

> 이 문서는 **작업 이력만** 기록한다. 코드·데이터는 아직 main에 머지하지 않았다.
> 각 작업은 세션별 브랜치(`claude/pv-*`)에 커밋·push되어 있으며, **머지는 모든 작업이 끝난 뒤 맨 마지막에** 오케스트레이터가 수행한다.
>
> - 기준 시각: 2026-11-18, 시간은 UTC
> - 기준 문서: 저장소 루트 `README.md`(마스터 프롬프트), `Handoff.md`
> - 테스트 수치는 각 세션의 보고 기준이며, 최종 통합 시 재검증한다.

---

## 1. 운영 방식

- 오케스트레이터 세션 1개가 README/Handoff를 기준으로 작업을 분해하고, 하위 세션 6개(PV-1 ~ PV-6)에 분배.
- 각 세션은 **자기 소유 경로만 수정**, 자기 브랜치에 커밋·push. 다른 브랜치는 fetch해서 읽기만 한다.
- 브랜치 간 의존성은 머지 대신 **인터페이스(의존성 역전)·구조적 미러**로 해결하고, 실제 연결은 최종 통합 때 수행.
- 작업이 끝난 세션에는 다음 작업을 즉시 할당.

| 세션 | 담당 | 브랜치 |
|---|---|---|
| PV-1 Research | 소스 레지스트리·라이선스, 게임 데이터 카탈로그, 전술 KB, 감사 | `claude/pv-research` |
| PV-2 Data | 데이터 스키마·ETL, 실측 통계, 경제 엔진, 검증 도구, 선수/팀 프로필 | `claude/pv-data` |
| PV-3 Core | 모노레포·World State·규칙, Decision/Action/Team 엔진, 통합 준비 | `claude/pv-core` |
| PV-4 Spatial | 공간·지각·교전·스킬 엔진, 라운드 시뮬레이터 | `claude/pv-spatial` |
| PV-5 MapMesh | Ascent Blender 맵 처리, NavMesh, 실측 시야 | `claude/pv-mapmesh` |
| PV-6 Replay | VRF 파서, Replay 포맷·뷰어, Desktop 앱 UI | `claude/pv-replay` |

---

## 2. 타임라인 (브랜치 커밋 기준)

### PV-1 Research — `claude/pv-research`
| 시각 | 커밋 | 내용 |
|---|---|---|
| 08:52 | `f77a3d4` | 데이터 소스 레지스트리(26항목) + 핵심 소스 검증(C9 Gameplan, vrfkit, ValoReview 등) |
| 09:02 | `010368d` | 게임 데이터 카탈로그 빌더(무기 21 / 요원 30 / 스킬 130 / 장비 4, release-13.10) |
| 09:15 | `60a1c3c` | 공식 위키 기반 스킬 비용·충전·궁극기 포인트(30/30), 실드·스파이크 상수 |
| 09:18 | `a31a449` | Riot content API UUID 교차검증(요원 30/30, 무기 21/21), API 접근 매트릭스 |
| 09:28 | `6759b5c` | 스킬 효과 명세(Ascent 메타 10요원) + 키바인드 |
| 09:35 | `18b4275` | 실측 Ascent 요원 픽률·조합 통계(VCT Reference, 153맵) |
| 09:37 | `85bee8d` | GRID(Riot Open Access) 접근 조사 |
| 09:42 | `63b942e` | 스킬 효과 명세 30요원 확장 |
| 09:50 | `96eb348` | Ascent 전술 지식 베이스(공격 8 + 수비 9 요소, PV-4 구역 그래프 기반) |
| 09:57 | `2886c81` | 전술 출처 보강 + Ascent/요원 패치 이력, 데이터 구간 권고(patch ≥ 9.x) |
| 10:04 | `313d849` | 머지 전 라이선스·개인정보·출처 감사(차단 0 / 통합 시 조치 6) |
| 10:05 | `c978c86` | 프로 선수·팀 실명 허용으로 감사 재분류(사용자 결정) |

### PV-2 Data — `claude/pv-data`
| 시각 | 커밋 | 내용 |
|---|---|---|
| 09:00 | `33b5ed7` | 소스 검증(VCT Reference, vctstats), 공통 스키마, ETL, 최소 데이터셋(실경기 2 + 합성 시나리오 10) |
| 09:03 | `fe24694` | vlr.gg ToS 제약 기록, VCT Reference 약관 판단 |
| 09:15 | `5066b33` | 실측 의사결정 prior + 검증 기준선(경제 매치업, 피스톨 전환, 세이브 미래가치 등) |
| 09:27 | `09894ea` | Economy & Ultimate Engine v0 (`packages/economy-engine`) |
| 09:37 | `3ab3b2e` | 오프닝 듀얼 prior + 시뮬레이션 Validation Harness |
| 09:46 | `fe35409` | pre-round 라운드 가치 모델(LightGBM이 베이스라인 미달 → 미채택 권고) |
| 09:56 | `0eb7010` | 선수 능력치 추정(402명, 불확실성·축소, 추정 불가 항목 null) |
| 10:04 | `923f5ce` | 팀 성향 프로필(70팀, as-of 생성) |
| 10:08 | `5b390ac` | 선수·팀 실명 매핑 커밋(사용자 결정) |

### PV-3 Core — `claude/pv-core`
| 시각 | 커밋 | 내용 |
|---|---|---|
| 08:54 | `0d58165` | pnpm/TS 모노레포, shared-types, simulation-core(시드 RNG·EventLog), game-rules, world-state |
| 09:13 | `ab5d88c` | 시나리오 로더 + SpatialQuery/ObservationProvider 인터페이스 (TASK 006) |
| 09:17 | `6ffb35d` | Belief State v0 |
| 09:24 | `21aa4c4` | Action Generator — 상황 기반 후보 생성·제약 검증·평가 (TASK 007) |
| 09:28 | `0dc4512` | Decision Debugger — 구조화 trace + CLI 리포트 (TASK 008) |
| 09:30 | `6a8efa3` | DECISION_MODEL, TEST_PLAN 문서 |
| 09:35 | `c37e11b` | 궁극기 포인트 공식값 정정(30요원) + EconomyEvaluator 인터페이스 |
| 09:39 | `6a22615` | EconomyEvaluator를 PV-2 economy-engine 계약에 정합 |
| 09:45 | `dc349b5` | Team Engine(IGL·Player Policy·팀워크) + DecisionPolicy 계약 |
| 09:49 | `7bd6d87` | Outcome Predictor(예산 제한 lookahead) |
| 09:50 | `9d7ba29` | 통합 계약 문서(DecisionPolicy/경제/교전) |
| 09:59 | `51a9541` | 통합 어댑터 + INTEGRATION_PLAN(브랜치 간 경로 충돌 0건 확인) |
| 10:10 | `fc4c492` | 로컬 통합 리허설 결과 반영(진행 중) |

### PV-4 Spatial — `claude/pv-spatial`
| 시각 | 커밋 | 내용 |
|---|---|---|
| 08:49 | `d07fffb` | Ascent 좌표계(valorant-api) + 콜아웃 구역 그래프 + spatial-engine |
| 08:58 | `4a1cf0d` | 스폰 통과 금지 경로 제약, vlr.gg ToS 발견 |
| 09:10 | `83c0a77` | perception-engine(시야·청각·기억·콜아웃) |
| 09:20 | `ab3a919` | combat-engine(결정론적 교전 해결, OVR 결정론 배제 검증) |
| 09:28 | `e3a66d8` | ability-engine(연막·플래시·정찰·몰리·벽 등) |
| 09:34 | `e3ad1c5` | ability-engine을 PV-1 효과 명세에 정합 |
| 09:55 | `94fa92f` | round-simulator(결정론적 5v5 라운드 루프, 1,000라운드 ≈ 19.5ms/라운드) |
| 10:04 | `f9f274f` | round-simulator를 PV-3 DecisionPolicy 계약에 정합 |

### PV-5 MapMesh — `claude/pv-mapmesh`
| 시각 | 커밋 | 내용 |
|---|---|---|
| 09:07 | `c4fcf1b` | Ascent Blender 맵 다운로드(Playwright) + 출처 기록(원본 미커밋) |
| 09:11 | `1e67f38` | Blender 4.2 헤드리스 장면 분석 |
| 09:19 | `8eb2df8` | 충돌 메시 추출 + Blender↔게임 좌표 변환 적합 |
| 09:38 | `ee5775c` | NavMesh 생성(연결 ~27%) + 경로 보정 |
| 09:39 | `5840e6d` | handoff 문서 |
| 10:04 | `b1f3fdb` | 2.5D 보행 격자로 Ascent 22구역 중 21개 연결 |
| 10:10 | `7215c4a` | 벽 레이캐스트 기반 실측 시야 행렬 + PV-4 비교 |

### PV-6 Replay — `claude/pv-replay`
| 시각 | 커밋 | 내용 |
|---|---|---|
| 09:14 | `e3f4fda` | Linux `.vrf` 추출·정규화 파이프라인(.NET 파서 Linux 빌드, 실제 `.vrf` 해독) |
| 09:14 | `1be1247` | 파서 평가, VRF 캡처 가이드 |
| 09:27 | `205b41e` | 운동학·맵 투영 분석 |
| 09:27 | `ccf8583` | 좌표 변환 실데이터 검증(포함률 1.0), 운동학 통계, 개인정보 정리 |
| 09:46 | `d54c1b7` | replay-engine(통합 Replay 포맷) |
| 09:46 | `06b46d6` | replay-viewer(PixiJS) |
| — | 진행 중 | Electron desktop 앱 + 매니저 게임형 UI |

---

## 3. 주요 결정 사항 (이번 세션)

| 날짜 | 결정 | 근거·비고 |
|---|---|---|
| 2026-11-18 | **vlr.gg 데이터 사용 금지** | ToS가 자동 접근·재배포 금지. 스크레이퍼 미구현, 데이터 미커밋 |
| 2026-11-18 | Riot 개발 키는 콘텐츠·상태 API 용도로만 | `val/match`는 403(production 키 필요). 키는 환경 보안 저장소에 보관, 저장소에 미기록 |
| 2026-11-18 | 실측 위치(Layer B)는 자가 캡처 `.vrf` 우선 | GRID 공개 설명에 per-tick 위치 없음 |
| 2026-11-18 | pre-round ML 모델 미채택 | LightGBM이 priors/로지스틱 베이스라인을 못 이김(DECISION-005 준수) |
| 2026-11-18 | 엔진 간 좌표는 게임 world units로 통일 | 미니맵 좌표는 데이터 로드·UI 경계에서만 변환 |
| 2026-11-18 | 데이터 구간: 현재 메타 비교는 patch ≥ 9.x | Ascent 구조 안정, 메타 변동은 요원 밸런스 |
| 2026-11-18 | UI는 매니저 게임(FM/OOTP) 장르 관례 채택 + PROJECT V 고유화 | 정보전(안개) 중심 Match Day, 경제·궁극기 운영, 코치 노트. 특정 게임 외형 복제 금지 |
| 2026-11-18 | **VCT 프로 선수·팀 실명 사용** | 출시 전 내부 개발 단계. 출시 전 초상권·상표 재검토 필요. 비프로 일반인 식별자는 계속 익명 |
| 2026-11-18 | 머지는 모든 작업 완료 후 맨 마지막 | `pv-replay`는 squash 머지(과거 커밋의 일반인 식별자 제외) |

---

## 4. 사용자 조치가 필요한 항목

- **Ascent 5v5 커스텀 게임 `.vrf` 리플레이**: 완전한 실측 위치 데이터 확보용(파이프라인 준비 완료).
- **Riot 개발 키 갱신**: 24시간마다 만료. 필요 시 재입력.
- **GRID(Riot Open Access) 신청 여부**: 준비물은 `claude/pv-research`의 `docs/research/GRID_ACCESS.md`.
- **출시 전**: 프로 선수 초상권·상표, Riot 자산(맵 이미지 등) 라이선스 검토.

---

## 5. 통합 및 main 머지 (시뮬레이션 초안)

- 10:14–14:22 UTC: 사용량 제한으로 전 세션 중단 → 14:22 재개.
- 14:31 사용자 지시: "엔진 완성 → 시뮬레이션 가능한 초안 → main 머지, 최대한 빨리".
- 14:41 `claude/pv-integration` 생성(PV-3). 6개 브랜치 머지, **충돌 0건**. `pv-replay`는 squash(일반인 식별자 이력 제외).
- 이후 모든 세션이 통합 브랜치 위에서 직접 작업:

| 커밋 | 내용 |
|---|---|
| `c2eb430` | 첫 통합 상태(6개 브랜치 머지, `@pv/*` 리네임, pnpm-lock 재생성) |
| `42d5751` | `@pv/game-data` — 런타임 데이터(67팀 로스터 ≥5, 선수 1,227, 실명) (PV-1) |
| `e0ba8e8`·`d96eb23` | 매니저 게임형 데스크톱 UI + 실제 round-simulator 연결 (PV-6) |
| `d275150` | 통합 E2E 수용 테스트 + 머지 전 감사 처리(THIRD_PARTY_NOTICES) (PV-3) |
| `dea8a4c` | 스킬 커버리지 갭 분석 (PV-1) |
| `bd80480` | `sim:validate` 러너, 경기 단위 경제 API (PV-2) |
| `f9f7a09` | Replay 포맷에 팀별 perception/belief 트랙 (PV-6) |
| `c251b3a` | **`@pv/match-runner`** — 피스톨 → 하프 전환 → 13승 → OT, 경제·궁극기 이월 (PV-3) |

- **15:05 main 머지** (오케스트레이터가 직접 재현 검증 후):
  - `pnpm -r typecheck` 전 패키지 통과
  - core 128 pass / 4 todo, 패키지별 테스트 전부 통과(spatial 21, perception 17, combat 15, ability 18, round-simulator 16, economy 31, replay 14, game-data 7, match-runner 8)
  - 실제 경기 실행: `pnpm --filter @pv/match-runner sim:match --teamA 1001 --teamB 1034 --map ascent --seed 42` → Team Heretics 13–11 NRG, 약 2.4초
  - 비밀정보·자격증명·원본 `.blend`/`.vrf` 0건

### 초안의 알려진 한계 (main 머지 시점)
- **시간 초과 라운드 과다**: 예시 경기 24라운드 중 19라운드가 timeExpired(실측 약 3%). 공격 정책의 진입·실행이 약함. 포스트플랜트·세이브 행동 미구현.
- PV-4의 라운드 엔진 개선(실측 navgraph, 스킬 실사용, 스파이크 줍기, 검증 4/7 통과 — `claude/pv-spatial` `37cfea6`)은 아직 통합 브랜치에 반영 전.
- PV-2 시나리오 v2(게임 좌표 + zoneId, `ea024f6`) 통합 브랜치 반영 전.
- 팀 프로필·전술 KB·선수 능력치를 TeamDecisionPolicy가 아직 소비하지 않음(데이터는 포함됨).
- Desktop 안개 뷰·Belief 히트맵은 포맷만 정의됨(라운드 엔진 출력 대기).

### 2차 main 머지 (19:35 UTC)
- 15:19–19:32 UTC: 사용량 제한으로 PV-2/3/4 중단 → 재개.
- 반영: 실팀 레이팅 연결(`1de265a`), Desktop Match Day ← `@pv/match-runner`(`ac29350`), PV-4 라운드 엔진 개선 통합(`a53dca9`: 실측 간선, 라운드 내 스킬, 스파이크 줍기), `runMatchRound` API(`eec2bf7`), 실제 `buildBelief`(`c6d8c61`), `AbilityInventory` 계약(`11fb43d`), 시나리오 v2 + v1 호환(`431fe87`, `8a0ea8f`).
- 검증: typecheck clean, core 128 pass / 4 todo, round-simulator 25, match-runner 10, 전 패키지 통과, 비밀 0건.
- **품질 측정(Team Heretics vs NRG, seed 42/7/99):** 53라운드 중 timeExpired 46(≈87%) — 개선 없음. PV-4 ScriptedPolicy는 검증 4/7을 통과하므로, **TeamDecisionPolicy의 공격 실행(진입·설치) 부재**가 원인으로 추정. 최우선 과제로 지정.

### 3차 main 머지 (19:45 UTC) — timeExpired 해결
- 원인(PV-3 진단): TeamDecisionPolicy가 500ms마다 명령을 재추첨해 설치(4s)·해체(7s)가 매번 중단됨. 스파이크 캐리어·해체 담당이 행동을 끝까지 유지하도록 수정(`717750f`/`b739123`). 교전 파라미터는 변경 없음.
- 같이 반영: economy-engine 소스 exports(`8aab3e1`), `sim:batch` 20경기 검증 러너 + 기준 스냅샷(`b71cb76`, `docs/research/SIM_BASELINE_2026-11-18.md`).
- 오케스트레이터 재현(20경기·428R, `npx tsx tools/data-validator/scripts/sim-batch.mts --matches 20`):

| 지표 | 수정 전 | 수정 후 | 실측 |
|---|---|---|---|
| time_expired | 61.8% | 0% | 4.3% |
| elimination | — | 61.7% | 71.4% |
| defuse | 0% | 38.3% | 16.0% |
| bomb_detonated | 0.4% | 0% | 8.2% |
| 공격 승률 | 19.7% | 61.7% | 50.9% |
| 공격 오프닝 듀얼 | 68.6% | 75.0% | 43.7% |
| judged 통과 | 0/9 | 2/8 | — |

- 남은 편향: 모든 라운드에서 설치가 일어남(수비의 설치 전 저지 0, 폭발 0), 공격 오프닝 듀얼 과다 → 수비 정책의 홀드·프리에임 부재가 유력. 다음 과제.

### 4차 main 머지 (20:00 UTC) — 수비 보정, 안개 뷰
- 수비 홀드 보정(PV-3, `6be42c6`): 홀드 전략에서 수비수가 앵커를 이탈해 pre-aim 우위를 버리던 문제 수정(교전 파라미터 불변).
- Desktop 안개 뷰 + Belief 히트맵(PV-6, `8e9886d`), `recordPerception`(PV-4 `565b6f6`, match-runner `7a7a847`), `traceCommands` 진단(`177ae9c`), suppress·대시(`9683421`), `sim:batch --compare`(PV-2 `2cfe277`).
- 오케스트레이터 재현(20경기·445R, `--compare` 기준 스냅샷):

| 지표 | 기준(수정 전) | 현재 | 실측 | 판정 |
|---|---|---|---|---|
| elimination | 0.377 | 0.710 | 0.714 | ✅ |
| time_expired | 0.618 | 0.034 | 0.043 | ✅ |
| economy full/full | 0.237 | 0.487 | 0.500 | ✅ |
| 공격 승률 | 0.197 | 0.587 | 0.509 | ❌ |
| 공격 오프닝 듀얼 | 0.686 | 0.575 | 0.437 | ❌ |
| defuse | 0.000 | 0.256 | 0.160 | ❌ |
| bomb_detonated | 0.004 | 0.000 | 0.082 | ❌ |

- judged 통과 0/9 → **3/8**.

### 5차 main 머지 (20:47 UTC) — 엔진 현실화
- `runMatchRound` 이전(선수별 skills·로드아웃·요원/스킬/궁극기, 스킬은 `enableAbilities` 기본 off), 수비 hold-facing + `aimZone`, 피커 이점(210ms) + 교전 재보정(hitChanceScale 0.50, Scripted 오프닝 0.450), 타깃 존 스킬, 몰리 = 통과 가능 + 피해 + 경로 비용(`visibleHazards`), engagement/command trace, 경기 후 리뷰 화면.
- 오케스트레이터 재현(20경기·409R): judged **3/8**(time_expired 0.044, 오프닝 듀얼 0.474, pistol 0.475 통과). 공격 승률 0.619, elimination 0.853, 폭발 0.
- **판명된 사실:** 공격 0.62는 정책이 아니라 **sim 시나리오 구조**(유틸 없는 5v2) 때문 — Scripted vs Scripted도 0.633. 스킬 on에서 "시전하는 쪽이 진다"(시전이 행동 전체를 점유) → 엔진 시전 모델 현실화(windup만 점유) 진행 중.

### 6차 main 머지 (21:05 UTC) — 스킬 on 기반(기본 off)
- 시전 모델 현실화(windupMs만 점유, PV-4 `782030d`), 희소 시전·타깃 연막·포스트플랜트 컨테스트(PV-3 `ae69560`), 수비 셋업 3종(PV-2 `f2b6c21`, 스킬 on 전용 적용 `4b5017a`), `sim-batch --abilities`.
- 기본값(스킬 off): judged 3/8, 공격 0.619 — 5차와 동일.
- 스킬 on(옵트인): 공격 1% → 0.41(셋업 off) / 0.25(셋업 on, 오프닝 0.469 PASS), defuse 0.160 PASS. **공격 0.45–0.56과 judged 3/8 동시 충족은 미달** — 셋업 가중·유틸 위력·공격 실행 유틸의 공동 튜닝 과제로 남김.

- **추가 발견(PV-3, `1867674`):** 스파이크 폭발(bomb_detonated)이 스킬 on/off·모든 정책 변경에서 0(실측 0.082). 정책이 아니라 시뮬레이터 구조(설치 후 스파이크 타이머 vs 리테이크 타이밍) 문제로 추정 → 스킬 on 공격 승률 상한의 핵심 원인. **다음 스프린트 1순위(PV-4).**

### 7차 main 머지 (2026-11-19 02:05 UTC) — 한글화 + 전술 타임아웃
- 사용자 요청: 한글화, 타임아웃(상대 포함 총 4번) 때 지시.
- 데스크톱 한국어 기본(ko/en 전환, `apps/desktop/docs/GLOSSARY_KO.md`) — PV-6 `a506649`, 수정 `a9ad382`(전멸 표기, 한국어 줄바꿈, 내부명 제거).
- 전술 타임아웃: 팀당 2회(합계 4회), 라운드 사이에만. `createMatchSession`(state/callTimeout/setOrders/playNextRound) — PV-3 `23feb83`. 지시(전략·경제 콜·템포·역할)를 IGL이 실제로 따름, AI 상대도 3연패·매치포인트에 타임아웃. 인터랙티브 경기일 UI(지시 패널, 리뷰의 타임아웃 기록) — PV-6 `f5ec700`.
- 검증: typecheck clean, core 130/4 todo, match-runner 19, round-sim 49, desktop 단위 통과, sim-batch 기본값 불변(judged 3/8).

### 8차 main 머지 (2026-11-19) — 스파이크 폭발 0 해결
- 원인: 설치 후 수비가 상황과 무관하게 항상 리테이크(`commitDefuser`) → 설치 라운드는 해체 또는 공격 전멸로만 끝나 폭발이 구조적으로 0.
- 수정(`packages/team-engine/src/policy.ts`): 리테이크 가능성 판단 추가 — (a) 이동+해체 7s가 폭발 타이머보다 길면, (b) 수비 1명 vs 공격 4명 이상이면 해체를 포기하고 수비 스폰으로 세이브. RNG 미사용(결정적), 매 결정마다 재평가.
- 임계값 스윕(20경기): 1v3+ 12.8%, 1v4+ 9.0%, 3명 열세 24% → 실측 8.2%에 가장 가까운 1v4+ 채택.
- 오케스트레이터 재현(20경기·410R): bomb_detonated 0.000 → **0.090 ✅**(실측 0.082), judged **3/8 → 4/8**, 공격 승률 0.617(불변 수준), time_expired·오프닝·피스톨 PASS 유지. 스킬 on: judged 1/8 → 2/9.
- 검증: typecheck clean, 전체 133 통과/4 todo(팀엔진 +3 테스트).
- 남은 편향: elimination 0.761(실측 0.714), defuse 0.102(0.160), 공격 승률 0.617(0.509) — 리테이크 교전에서 공격 우위가 큼(5v3 설치 후 공격 승 ≈98%).

### 9차 main 머지 (2026-11-19) — 리테이크 밸런스, 능력치 기반 상황 수식, 경기 전 옵션
- 사용자 요청: 리테이크 교전 밸런스 / 양각·쓰로잉·정보 없는 영역 먹기 반영 / 인원 많은 쪽이 유리해야 함 / 능력치별 결과 케이스 정의 / 풋볼매니저 엔진식 / 검증된 수식 적용 / 계수는 경기 전 옵션, 팀·선수별 최소 쓰로잉률.
- 원인: 설치 후 수비가 한 명씩 달려 들어가 프리에임 중인 공격에 각개격파(설치 후 결투 공격 83%, 공격 1 vs 수비 3에서도 공격 63%).
- 변경(수식 명세: `docs/STAT_OUTCOME_MATRIX.md`):
  - 협동 리테이크(시야 밖 구역에 집결 후 동시 진입), 세이브 시 은신, 세이브 콜 유지 — `team-engine/policy.ts`.
  - 양각 = 힉-하이먼 법칙, 정보 = 지수 감쇠, 클러치 보정, 결투 피해 누적 옵션 — `round-simulator/situational.ts`, `simulator.ts`.
  - 리테이크/세이브 = 란체스터 제곱 법칙, 쓰로잉 = 비례위험 모델(성향 기반, 최소 쓰로잉률 하한).
  - 실제 선수 평점 → 전술 능력치(gameSense/trading/clutch)·성향 프로필·라운드 폼(정규분포, 압박 라운드 클러치) — `match-runner/teams.ts`, `match.ts`.
  - 공격의 설치 후 홀드를 기본 모드에도 적용(이전엔 스킬 on 전용).
  - 경기 전 옵션 `MatchConfig.tuning`, `MatchConfig.minThrowRates`.
- 검증(기본값, 160경기·3,289R, 시드 1–160): judged **4/8 → 8/8**. 공격 승률 0.617 → 0.543(실측 0.509), 해체 0.102 → 0.182(0.160), 폭발 0.059(0.082), 전멸 0.724(0.714), 오프닝 0.447(0.437), 피스톨 0.463(0.500).
  - 표준 20경기(시드 1–20)는 7/8 — 피스톨 라운드 40개 표본에서 0.425.
  - 설치 시점 인원별 공격 승률: 1v3 0.29 · 2v3 0.47 · 3v3 0.63 · 4v3 0.78 · 5v3 0.92.
  - 스킬 on(60경기): judged 4/10, 공격 22.9% — 여전히 수비 우세.
- 테스트: typecheck clean, core 142/4 todo, round-simulator 56, match-runner 26.
- 남은 과제: 공격 1 vs 수비 2에서 공격 0.61(소모전 미적용 영향), 스킬로 진입 저지, 연막 통과 모델(플래시 없이 뚫으면 도박), 스킬 on 균형.

### 10차 (2026-11-19, 브랜치 `claude/remaining-work-final-push-fa1459`) — Continuous Tactical Intelligence 1차
- 사용자 요청: 상황을 이해·기억·예측·대응하는 연속 판단 구조. 전술 목록 추가가 아니라 범용 연결 구조. 이후 방향: FM급 매치 엔진 완성에 집중.
- 감사에서 찾은 구조적 한계(상세 `docs/CONTINUOUS_TACTICAL_INTELLIGENCE.md` §1): 계획이 0.5초마다 재추첨됨 / 전략이 실행과 무관(40경기 설치 전부 B) / 경제가 0 고정이라 IGL이 항상 에코 판단 / 사건이 관측을 만들지 않음 / 소리가 판단에 안 쓰임 / 라운드 간 기억 미사용.
- 구현: 사격 단서 계층(소리·탄 궤적, 무기 `tracerVisible`), 단서 신뢰도 → 정보 가중치·사이트 판단, 지속 계획 + 사유 있는 수정, 계획의 목표 사이트·페이크·집결·진입 단계, 느린 플레이와 근거 기반 전환, 떨어진 스파이크 회수, 라운드 간 상대 모델(디리클레 + 망각 + 패턴 인식), 실제 경제·라운드 번호 전달, 코너 기하에서 유도한 앵글 어드밴티지, 라운드 기록의 판단 근거(`RoundRecord.decisions`).
- 검증: 반사실 테스트 11종·결정론 통과. 테스트 core 168/4 todo, round-simulator 66, match-runner 32.
- **밸런스 후퇴**: 160경기 judged 8/8 → 5/8. 통과: 공격 승률 0.529, 오프닝, 풀바이, 폭발, 시간 초과. 실패: 전멸 0.829(실측 0.714), 해체 0.108(0.160), 피스톨 0.419(0.500). 이전 8/8은 전략 계층이 죽은 상태에서 맞춘 값이었음.
- 성능: 160경기 62초 → 75초.

### 11차 (2026-11-19, 브랜치 `claude/balance-recovery-031c13`) — 밸런스 복구
- 목표: 전술 계층을 유지한 채 기본 모드를 실측 기준선에 다시 맞춤. 수치 보정이 아니라 빠져 있던 행동을 모델링.
- 측정으로 확인한 원인(상세 `docs/CONTINUOUS_TACTICAL_INTELLIGENCE.md` §5.4): B 리테이크가 공격 시야선(마켓)을 가로질러 들어가 결투 0.91로 짐 / 공격이 치지 않기로 한 사이트를 통과해 로테이션 / 페이크가 사이트 시야선에 서 있음(결투 0.14) / 러커가 차례로 떨어져 나감 / 공격이 진 라운드를 끝까지 던짐(시간 초과 0.008).
  - “수비가 스택하면 공격 0.10–0.20”은 선택 편향이었음(설치 전 수비는 `aggroPush` 외에는 움직이지 않음).
- 구현(`team-engine/policy.ts`, `igl.ts`, `match-runner/setup.ts`; 수식 `docs/STAT_OUTCOME_MATRIX.md` §3.2·3.3·3.5·3.6):
  리테이크 최소 노출 접근, 공격 이동의 최소 노출 경로(직행 vs 자기 스폰 경유)와 계획 사이트에서만 설치, 시야 밖 페이크와 도착 후 조준, 지정 러커, 공격 세이브(란체스터 × 무기 가치, 옵션 `saveMinWeaponValue`), 수비의 출구 킬 추격(쓰로잉 해저드의 세 번째 자세).
- 검증(기본값, 160경기·3,388R): judged **5/8 → 7/8**. 전멸 0.829 → 0.685, 해체 0.108 → 0.173, 폭발 0.055 → 0.097, 시간 초과 0.008 → 0.045, 공격 승률 0.529 → 0.521, 오프닝 0.465 → 0.461, 풀바이 0.537 → 0.518. 설치 시점 인원별 공격 승률은 공격 인원에 대해 단조 증가.
- **미해결: 피스톨 0.419 → 0.397**(기준 0.45–0.55). 결투 해상도 문제(이동 중 클래식 0.315)로 판단 — 시뮬레이터 제안은 §5.4에 기록, 이 브랜치에서는 `round-simulator`를 수정하지 않음.
- 테스트: typecheck clean, core 192/4 todo(반사실 테스트 24종 추가 `team-engine/test/balance-recovery.test.ts`), round-simulator 66, match-runner 32.
- 하지 않은 것: 수비 오프닝 공격성의 성향·정보 기반 선택, 읽은 사이트로의 설치 전 로테이션 집결, 수적 열세 앵커의 후퇴.

### 11차 (2026-11-19, 브랜치 `claude/series-veto-dc09f7`) — 시리즈 · 맵 밴픽 · 맵 숙련도 · 스카우팅
- 사용자 요청: 맵 밴픽과 디사이더 맵 적용, 팀·선수 조합에 따른 맵 숙련도, 상대가 강하면 지더라도 카운터 전략은 구현 가능하게.
- 구현(상세 `docs/SERIES_AND_VETO.md`):
  - 시리즈 Bo1/Bo3/Bo5 `runSeries` + 단계별 `createSeriesSession`(사람/AI 밴픽, 맵 단위·라운드 단위 진행). 밴픽 포맷은 데이터(스텝 배열), VCT 룰북 §4.6.7–4.6.10 프리셋.
  - 맵 숙련도 `M = 0.5·전적 + 0.3·연속성 + 0.2·조합 적합`(수축·불확실성 포함) → 쓰로잉 해저드·폼 σ·trading/gameSense·패턴 인식의 **팀별 값**. 승률 보너스 없음.
  - 스카우팅: 상대의 관측 가능한 경기 기록 → (a) 상대 모델 사전 근거(`OpponentModel.seed`), (b) 상대 맵 숙련도 추정 → AI 밴픽. 분석관 수준·로스터 판단력이 질을 정함.
  - 팀의 게임 플랜(사이트 성향)을 경기 전 옵션으로 추가.
- 제약: **모든 맵은 Ascent 지형에서 시뮬레이션**(그 맵의 숙련도만 적용). 맵별 승패 데이터가 커밋본에 없어 결과 항은 중립. 조합 통계는 Ascent·Lotus만.
- 머지 포인트: `opponent-model.ts`(seed), `match.ts`(`teamInputs`, `series`, formSkills 1줄), 두 `index.ts`, `game-data/src/index.ts`.
- 검증: `runMatch` 변경 전후 해시 동일. 반사실 테스트·결정론 통과. 효과 크기는 문서 §6.1.
- 측정(시드 1–200): 숙련도 차 −0.25/0/+0.25 → 맵 승률 54.0/57.5/61.0%(각 ±7). 스카우팅 on/off → 초반 오프닝 콜은 달라지나 시리즈 승률 28.5% → 29.0%로 **검출 불가**(±6.3), 습관을 깬 상대에겐 13.0% → 12.5%.
- 실데이터 반영(사용자 승인으로 VCT Reference DuckDB 다운로드, 미커밋): `map-history.json`(2025 이후 팀별 맵 경기·승수·선수별 맵 출전, 46팀), 풀 9개 맵의 조합 통계. 실측 "픽한 팀의 픽 맵 승률" 53.6%(2,348맵) vs 시뮬 54.5% ±4.9(400맵). 실전적 적용 후 스카우팅 on/off 재측정: 시리즈 20.0% → 19.0%(여전히 검출 불가).
- 데스크톱: 시리즈 · 밴픽 화면(설정·밴픽 보드·맵별 숙련도/스카우팅/추천·시리즈 스코어보드·요약, ko/en), 맵은 기존 경기일 화면으로 진행. `desktop-decisions` 브랜치를 머지한 위에 구현. 단위 40, 엔진 계약 3, 기존 e2e, 시리즈 e2e(Bo3 한/영) 통과.

### 12차 (2026-11-19, 브랜치 `claude/footstep-noise-belief`, `c05c196` 기준) — 발소리와 소음 읽기
- 사용자 요청: 걷기/달리기, 달리면 소리(범위 = 스파이크 폭발 범위), 상대가 듣고 정보로 판단 — 소리가 많으면 러시(지원 요청), 혹은 페이크.
- 세계 규칙: 달리는 선수의 발소리는 폭발 반경 안의 모든 적에게 들림(3D 거리, 벽 통과), 러너 1명당 구역 수준 단서 1개, 신뢰도 `1 − d/R`. `game-rules`에 `SPIKE_RULES.blastRadiusM` 추가 — **위키는 "폭발 반경 ≈ 오디오 범위"만 적고 수치가 없어 50 m는 manual-approx(`verified: false`)**. 이전의 사운드 그래프 경로는 로비에서 아무 소리도 전달하지 않았고 아군 발소리도 단서로 섞였음.
- 이동 선택: 의도(quiet/fast/loud) × 들리는지 × 시계 여유로 걷기/달리기 결정(`team-engine/movement.ts`). 집결은 조용히, 진입은 달려서, 페이크는 2명이 일부러 달려서 쇼. `player-policy.ts`의 고정 규칙 제거.
- 소음 읽기: hit/show/none 상태에 대한 베이즈 갱신(이항·베르누이 우도, 상대 모델의 사이트 성향·페이크 비율, 시계상 페이크 가능성, decisionMaking에 따른 반영 강도) → 믿음에 비례한 로테이션(`team-engine/hit-belief.ts`). `igl.ts`의 임계값 기반 수비 로테이션 대체. 계획 수정 기록에 사유. 상대 모델에 페이크 비율 추가.
- 같이 고친 것: 느린 플레이의 사이트 결정 시계를 맵에서 유도(고정 40초에서는 러커가 합류하기 전에 4명이 진입) — 시간 초과 감소.
- 검증(기본값, 160경기·3,454R): 기존 8개 지표 **7/8 유지**(리포트는 에코 vs 풀바이가 추가되어 8/9). 공격 승률 0.521 → 0.499, 전멸 0.685 → 0.696, 해체 0.173 → 0.182, 폭발 0.097 → 0.093, 시간 초과 0.045 → 0.029, 오프닝 0.461 → 0.461, 풀바이 0.518 → 0.492, 피스톨 0.397 → 0.388(여전히 실패).
  - 페이크 643라운드: 27.5%에서 로테이터 1명을 끌어냄(2명 이상은 0%), 끌어낸 라운드 공격 승률 0.537 vs 0.444. 정직한 실행 2,088라운드: 스택 콜이 첫 킬 전에 100%(중앙값 6.1초 앞) — 다만 도착은 그보다 늦어 첫 교전 시 사이트 위 수비가 3명 이상인 경우는 0%(30경기 측정).
- 테스트: typecheck clean, core 246/4 todo(`noise-reading.test.ts` 28종), round-simulator 101(`footsteps.test.ts` 6종), match-runner 32, perception-engine 22.
- 범위 밖 수정: `match-runner/src/setup.ts`·`match.ts`(구역 좌표·반경 주입, `shownSite` 전달) 최소 수정. `round-simulator/src/simulator.ts`는 `stepMovement` 밖 2줄(지각 파라미터 주입).
- 남은 것: 공격의 소음 읽기, 반경·우도 수치의 실측 검증, 접촉 전에 도착하는 로테이션.

### 13차 main 머지 (2026-11-20) — 통합: 전술 지능 · 밸런스 · 스킬 · 11개 맵 · 시리즈/밴픽 · 경기 화면 · 발소리 · 보행 경로
- 합친 브랜치: desktop-decisions, balance-recovery, ability-realism, maps-data(맵 데이터 + 보행 경로), series-veto, matchday-uiux, footstep-noise-belief.
- 통합 중 수정: `policy.ts` 세이브 지시와 스킬 계획 연결, 데스크톱 8개 파일 충돌(경기 옵션·밴픽·라이브 화면 공존), 라이브 화면에서 시리즈 복귀 버튼, 시리즈 e2e가 전체 라운드 재생을 따르도록.
- 검증(160경기·3,449R, 시드 1–160): judged **7/9**. 공격 승률 0.507(실측 0.509), 해체 0.189, 폭발 0.108, 시간 초과 0.030. 실패: 전멸 0.674(0.714, 허용 경계), 피스톨 0.438(0.500).
- 테스트: typecheck clean, core 252/4 todo, round-simulator 107, match-runner 62, spatial-engine 213(+11 로컬 격자 필요로 skip), ability-engine 21, 데스크톱 단위 40·엔진 3·e2e·시리즈 e2e(Bo3, ko/en) 통과.
- 알려진 한계: 선수 위치(`p.position`)는 여전히 구역 단위이고 화면 궤적만 보행 경로를 따름(이동 엔진 개편 과제로 이관), 13개 연결은 직선 근사(텔레포터·집라인 등), 스킬 on 모드 공격 과다(0.695), 피스톨 라운드, 계획 변경 사유 영어, Ascent 외 맵은 Ascent 지형으로 플레이.

### 14차 main 머지 (2026-11-23) — 이동 엔진 개편(실제 맵 경로 위의 연속 위치)
- 합친 브랜치: `claude/nav-engine`(`0f2fa75`).
- 내용(상세 `docs/research/NAVIGATION_ENGINE.md`): 맵별 내비게이션 로드맵(`<map>.nav.json`, 점·선분만, 사용자 결정으로 커밋 — 지오메트리·격자·.glb 미커밋), `Navigator.findPath`(SUCCESS/UNREACHABLE/INVALID_*, 직선 대체 없음), 구역 그래프 전략 경로 → 기하 경로 → 이동 실행기(`p.position`의 유일한 작성자), 집결 후 진입·대기열, 정면으로 마주친 두 이동자의 교착 해소, Ascent 위치 기반 시야(`vis.json`), 이동 시간 판단 = 경로 비용, 팀 믿음 기반 의도별 경로 선택, 라이브 화면 내비게이션 디버그 보기, 이동 사격 정지 시간(속도·이동 능력치), 공격 세이브 기준 별도 튜너블.
- 검증(160경기·3,383R, 시드 1–160, 통합 브랜치에서 재측정): judged **8/8**. 공격 승률 0.521, 피스톨 0.528, 전멸 0.704, 해체 0.148, 폭발 0.106, 시간 초과 0.042. 세션 보고: 시드 161–, 321– 구간도 8/8.
- 테스트: core 259/4 todo, round-simulator 121, match-runner 70, spatial-engine 265(+22 skip), ability-engine 21, combat-engine 21, 데스크톱 typecheck·build·단위·엔진·e2e·시리즈 e2e 통과.
- 남은 한계: 위치 기반 시야는 Ascent만(타 맵은 구역 시야), 13개 직선 연결(텔레포터·로프 등), 스킬 on 모드 공격 과다, 계획 변경 사유 현지화, 스카우팅 효과 검출 불가.

### 15차 main 머지 (2026-11-23) — 10개 맵 시야 표 · 생성 선수/스태프
- 합친 브랜치: `claude/nav-engine`(`3aadf2d`), `claude/loving-meninsky-767c08`(`c73e72d`, `75e2764`).
- 시야: Ascent 외 10개 맵의 `<map>.vis.json`(지점 쌍당 1비트, 라이선스 감사 §2.0b에 기록). `MatchConfig.geometry: "own"`(옵트인)으로 맵을 자기 지형·로드맵·시야로 시뮬레이션. 기본값은 여전히 Ascent 지형.
  - 자기 지형 60경기씩: 공격 승률 0.39(Haven)–0.575(Sunset). Haven 수비 0.61, Split·Sunset 전멸 비율 0.36·0.46. 원인은 전술 계층(수비 배치·조준 구역·설치 후 위치)이 Ascent 것이라는 점 — 맵별 전술 데이터, Haven C 사이트, Haven/Pearl 원본 데이터 수정이 필요(`docs/research/NAVIGATION_ENGINE.md` §7.5).
- 생성 선수·스태프(`packages/career`, 상세 `docs/GENERATED_PEOPLE.md`): 역할 평균 프로필 × 잠재력 × 나이 곡선 + 노이즈로 능력치 생성, CA/PA, 지역별 국적 분포, 오리지널 이름·핸들(실존 핸들 1,227개와 충돌 금지), 코치·분석관·스카우트, `advanceSeason`(성장·쇠퇴·은퇴·유입·영입), 저장/불러오기, `MatchConfig.rosters`(미지정 시 기존과 바이트 동일). 데스크톱 스카우팅 화면(신규 유망주·FA·스태프, ko/en).
- 검증(Ascent 160경기·3,383R): judged **8/8**, 공격 0.521, 피스톨 0.528 — 14차와 동일.
- 테스트: core 259/4 todo, career 15, round-simulator 121, match-runner 86, spatial-engine 278(+22 skip), ability-engine 21, combat-engine 21, 데스크톱 typecheck·build·단위·엔진·e2e·시리즈 e2e 통과(e2e는 부하 중 스크린샷 타임아웃이 있어 단독 재실행으로 통과).
- 남은 것: 맵별 전술 데이터, 경기일·시리즈가 커리어 월드 로스터·스태프를 아직 쓰지 않음, 계약·연봉·이적 없음, 성장 상수 미보정.

### 16차 main 머지 (2026-11-23) — 최종 통합과 정리(작업 일시 정지)
- 별도 세션이 `claude/final-merge`로 nav-engine·club-ops·career-shell·sim-batch-real-rosters·matchday-uiux를 합쳐 main `5e35ff8`에 푸시.
- 이 통합 세션이 그 위에 빠진 커밋을 합침: career-shell(테스트·`CAREER_MODE.md`·인계서, e2e 진입점을 시작 메뉴로), club-ops(재정·이적·훈련 화면, 계약 패널, 인계서), nav-engine(`27bac33` 리테이크 위치).
- **정정:** 13–15차의 "8/8"은 `sim-batch` 팀 id 버그로 **평균 선수 미러 경기**였다(`6bfb689`). 실제 로스터: 6/8, 공격 0.460(시드 1–160) / 0.484(161–320). 이 정리 시점 측정(시드 1–160): 6/8, 공격 0.455, 피스톨 0.444. 데스크톱 e2e·시리즈·커리어·구단 운영 e2e 통과.
- 문서: `docs/HANDOFF.md`(현재 상태 정본으로 재작성), `docs/DEVELOPMENT_PROCESS.md`(신규), `docs/research/STATUS_AUDIT_2026-11-23.md`(독립 진단, 신규).
- 미완성 브랜치: `claude/nav-engine` `11ec870`(Haven/Pearl 원본 데이터 수정, 미검증).

### 17차 main 머지 (2026-11-23) — 커리어+구단 운영 통합 · 11개 맵 3D · 오리지널 모델 · 경기 화면
- 합친 브랜치: `claude/festive-brattain-042f51`(`0918e78`), `claude/serene-goldberg-b05635`(`9692d0b`), `claude/matchday-uiux-efc023`(`10028ee`).
- 커리어: 구단 운영이 `registerCareerHook`로 커리어 달력 위에서 동작(받은메일·달력·팀 전력 하나로), 감독 팀 로스터 자동 변경 제거, 경기 전 라인업 선택, 준비도 R = (1 − 0.25·max(0, 피로 − 0.3))·(1 − 0.08·(1 − 샤프니스)), 선수별 K/D·맵 연습이 경기에 반영, AI 시즌은 보정된 빠른 시뮬이 기본.
- 모델링: 11개 맵 웹 GLB(저장소 밖 `~/ProjectV-assets/maps/glb`, 맵 좌표 보정·바닥/시야 일치 확인), 스키닝된 오리지널 선수·무기 모델, 엔진 트랙 기반 애니메이션 상태·시선·옆걸음, 1인칭 리그, 맵별 조명. 메시·GLB·.blend는 미커밋.
- 경기 화면: 엔진이 판정한 시야 표시(없으면 근사로 표시), 킬 배너 소리(선택), 오리지널 아이콘 세트, VCT 로고 로딩 엠블럼(로컬·gitignore, 대체 그림 있음 — 상표, 내부용).
- 검증: 엔진 변경 없음(실제 로스터 6/8, 공격 0.455 유지). 루트 259, career 49, round-simulator 121, match-runner 87(+1 기존 실패: Bind own geometry, 맵 세션 담당), spatial-engine 278, 데스크톱 typecheck·build·unit 61·matchday 49·engine 4, e2e·시리즈·커리어·구단 운영 e2e 통과(커리어 e2e는 영입 → 라인업 → 시즌 종료 → 계약 만료 → 다음 시즌까지).

### 18차 main 머지 (2026-11-23) — 엔진 정합성 1단계: 시야 하나로, 위치 기반 스모크·설치, 실제 로스터 재보정
- 합친 브랜치: `claude/peaceful-agnesi-b01f91` @ `2e2a7bf`(engine-truth 1–6단계, 상세 `docs/ENGINE_TRUTH.md`).
- 내용: 검증 리포트 전용 지표 + sim-batch 실제 로스터 확인 테스트, 플래시·정찰·트레이서·크로스파이어가 `vision.ts`와 같은 위치 LOS 사용 + 틱별 시야 기록, 스모크는 착탄 지점 볼륨으로 차단, 설치는 사이트 다각형·해체는 거리, 사망자 스팟 해제, 설치 후 가드가 리테이크 진입로를 봄, 듀얼 피해 이월 0.4(실제 로스터 시드 1–160 적합).
- 검증(실제 로스터, 이 통합 세션 재측정, 시드 1–160): **8/8**, 공격 0.501, 피스톨 0.463, 전멸 0.686, 해체 0.185, 폭발 0.082, 시간 초과 0.047. 세션 보고: 시드 161–320 7/8(0.485), 321–480 8/8(0.507). 스킬 on: 3/8, 공격 0.281(수비 쏠림, 원인은 ENGINE_TRUTH.md) — 기본 OFF 유지.
- 함께 고친 것: 커리어 저장이 겹칠 때 `.tmp` 이름 충돌(ENOENT) → 슬롯별 순차 쓰기, 커리어 e2e가 자동 저장을 기다림(3/3 연속 통과).
- 테스트: core 259/4 todo, career 49, round-simulator 128, match-runner 87(+1 기존 실패: Bind own geometry), spatial-engine 278, ability-engine 21, combat-engine 21, perception-engine 27, 데스크톱 typecheck·build·unit 61·matchday 49·engine 4, e2e·시리즈·커리어·구단 운영 e2e 통과.

### 19차 main 머지 (2026-11-23) — 11개 맵 데이터·전술 완료, 시선·소리 모델(기본 OFF) · 개인 경제는 보류
- 합친 브랜치: `claude/peaceful-agnesi-b01f91`(`7daae91`, 시선 모델 `--gaze`·소리 디테일 `--sound`, 둘 다 기본 OFF), `claude/nav-engine`(`f8d905b`, 11개 맵 끊긴 구역 0, 시야 표, 전술, `<map>.objects.json`, Bind own geometry 테스트 수정).
- **보류: `claude/epic-mahavira-18c91b`(개인 경제).** 함께 합치면 실제 로스터 기존 8개 지표가 **6/8**(전멸 0.661, 해체 0.204)로 떨어짐. 경제만 뺀 같은 조합은 8/8(공격 0.501)로 main과 동일 → 원인은 경제. 경제는 엔진 재보정 전 기반에서 만들어져 현재 엔진에서 다시 맞춰야 함(경제 세션에 전달). 포스 승률 0.10 → 0.26–0.31 등 개선은 브랜치에 있음.
- 검증(실제 로스터, 시드 1–160, 이 통합 세션 측정): **8/8**, 공격 0.501(경제 제외 조합). 맵별 자기 지형: 공격 승률은 11개 맵 모두 범위, 라운드 종료 비율은 Breeze만 범위 → `geometry: "own"`은 옵트인 유지(`NAVIGATION_ENGINE.md` §7.6).
- 시선 모델을 켜면 공격 0.25–0.36(피커스 어드밴티지 상수와 이중 계산) — 지글·리피크·각쪼개기·정지 시간과 함께 재보정 후 기본 적용 예정(`ENGINE_TRUTH.md` §7–9).
- 테스트: core 263/4 todo, round-simulator 134, match-runner 90(Bind own 통과), spatial-engine 407, combat-engine 27, perception-engine 27→32, 데스크톱 typecheck·build·unit·matchday·engine 통과. e2e 4종은 경제 포함 조합에서 통과(데스크톱 차이는 경제의 3줄뿐).

### 20차 main 머지 (2026-11-23) — 개인 경제 v1.1
- 합친 브랜치: `claude/epic-mahavira-18c91b` @ `1ed75c7`(19차에서 보류된 개인 경제를 현재 엔진 위에서 재보정, 상세 `docs/ECONOMY_MODEL.md`).
- 내용: 선수별 크레딧(승리 보상·연패 사다리·킬 200·설치 300·상한 9000), 생존자 무기·실드 유지, 라운드 뒤 더 좋은 무기 줍기, 드랍(부자 → 가난한 동료, 에이스 우선), 팀 구매 계획 = 이번 라운드 + 2라운드 앞을 본 맵 승리 기대값 최대화(풀/포스·하프·라이트 에코·에코·보너스), 궁극기 포인트 이월과 구매 영향, 라운드 기록에 선수별 구매·드랍·줍기·계획 평가.
- 검증(실제 로스터, 시드 1–160, 이 통합 세션 재측정): 기존 8개 **8/8**, 공격 0.503, 피스톨 0.463, 전멸 0.677, 해체 0.194, 폭발 0.090, 시간 초과 0.039. 경제 셀 포함 13/15(실패: 세미 vs 에코 0.981 > 0.953, 그리고 1개). 세션 보고: 시드 161–320 7/8(피스톨, 경제 이전부터), 공격 0.489.
- 테스트: core 264/4 todo, career 49, round-simulator 134, match-runner 100, spatial-engine 407, combat-engine 27, perception-engine 32, economy-engine 38, 데스크톱 typecheck·build·unit 61·matchday 49·engine 4, e2e·시리즈·커리어·구단 운영 e2e 통과.
- 남은 것: 에코 라운드가 거의 못 이김(에코 플레이 EC-04, 엔진 쪽), 피스톨 승자가 2라운드에 SMG 대신 라이플, 궁극기 오브 위치(맵 데이터) 미연결, 라운드 중 무기 줍기 이벤트 없음.

### 21차 main 머지 (2026-11-24) — 매치데이 UI-1…UI-6, 선수별 경제 표시
- 합친 브랜치: `claude/matchday-uiux-efc023` @ `6d2e31e`(데스크톱만, 엔진 변경 없음 → 160경기 배치 생략).
- 내용: 핸드오프 UI-1…UI-6(통신 제외), 경기 화면에 선수별 크레딧·유지 무기·드랍·궁극기 포인트와 팀 구매 이유, 듀얼 표시, 일시정지 중 계산 생략과 전술 맵에서 3D 캔버스 정리(측정상 다른 병목 없음: 프레임 0.05ms, 타임라인 44ms).
- 테스트: 데스크톱 typecheck·build·unit 61·matchday 54·engine 4, e2e·시리즈·커리어·구단 운영 e2e 통과(이 통합 세션 재실행).

## 6. 다음 단계

1. PV-4 라운드 엔진 개선분과 PV-2 시나리오 v2를 통합 브랜치에 반영.
2. 공격 실행·포스트플랜트·세이브 정책 보강 → `sim:validate`로 실측 기준선 대비 개선 확인.
3. IGL에 팀 프로필·전술 KB·선수 능력치 연결, Desktop 안개 뷰·히트맵 연결.
4. 개선분이 검증되면 main에 다시 머지하고 이 문서를 갱신.
