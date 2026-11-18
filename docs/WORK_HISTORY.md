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

## 6. 다음 단계

1. PV-4 라운드 엔진 개선분과 PV-2 시나리오 v2를 통합 브랜치에 반영.
2. 공격 실행·포스트플랜트·세이브 정책 보강 → `sim:validate`로 실측 기준선 대비 개선 확인.
3. IGL에 팀 프로필·전술 KB·선수 능력치 연결, Desktop 안개 뷰·히트맵 연결.
4. 개선분이 검증되면 main에 다시 머지하고 이 문서를 갱신.
