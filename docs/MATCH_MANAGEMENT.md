# PROJECT V — 경기 중 감독 운영 · 하프타임 · 경기 준비

**기준일:** 2026-11-24 · **범위:** 경기 중 감독 지시(타임아웃·지시·전략 변경·자동 진행 멈춤), 하프타임 팀 토크, 경기 후 결정 요약,
경기 전 상대 분석 리포트와 경기 계획. 코드: `packages/match-runner/src/{manager,managed-session,prep}.ts`,
데스크톱 `apps/desktop/src/renderer/screens/matchday/{ManagerPanel,PrematchPanel,PostMatchSummary}.tsx`.

원칙은 엔진 전체와 같다(`docs/STAT_OUTCOME_MATRIX.md`). **감독의 어떤 결정도 결투나 라운드 결과를 직접 정하지 않는다.**
모든 지시는 둘 중 하나로만 엔진에 들어간다.

1. **코치 지시(order)** — 기존 `TeamOrder` 경로: 전략, 경제 콜.
2. **기존 수식의 라운드별 값** — `MatchEngine.setRoundInputs` (새 경로지만 `TeamMatchInputs`와 같은 수식에 같은 방식으로 합성: 배율은 곱, 델타는 합):
   쓰로잉 해저드 λ₀, 라운드 폼 σ, trading / gameSense, 리테이크·세이브·영웅 플레이 기준.

`runMatch`와 `createMatchSession`은 바뀌지 않았다(§6). 감독 계층은 새 세션 `createManagedSession`에만 있다.

## 1. 선수 상태(멘탈) — 누적과 효과

선수 i마다 상태 c_i ∈ [−1, 1] (음수 = 틸트 τ_i = max(0, −c_i), 양수 = 자신감 κ_i = max(0, c_i)).

```
c_i ← ρ·c_i + Δ_i                                    누설 적분기, ρ = 0.75 / 라운드 (반감기 ≈ 2.4라운드)
진 라운드:   Δ_i = −(1 − k_i)·(0.22 + 0.08·[킬 없이 죽음])
이긴 라운드: Δ_i = +0.12 + 0.06·[2킬 이상]
k_i = 침착함 = (clutch + consistency) / 2           평점 능력치 (평점 없으면 0.6)
```

팀 효과(T = 평균 틸트, K = 평균 자신감) — 전부 기존 수식의 값:

| 의미 | 수식 | 값 |
|---|---|---|
| 흔들리면 기복이 커진다 | 라운드 폼 (§4) | σ' = σ · (1 + 0.8·T) |
| 흔들리면 무리한 피킹, 자신감은 자세를 지킨다 | 쓰로잉 해저드 (§3.3) | λ₀' = λ₀ · exp(2·T − K) |
| 고개가 떨어지면 콜이 나빠진다 | 정보 반감기 (§2.2) | trading' = trading − 0.15·T + 0.05·K |
| | 양각 지연 (§2.1) | gameSense' = gameSense − 0.10·T |

예: 침착함 0.5인 선수가 4연패(매번 킬 없이 사망) → c ≈ −0.41. 팀 전체가 그렇다면 σ ×1.33, λ₀ ×2.3.
**상수는 전부 설계값이다** — 선수 심리에 대한 데이터는 없다. 측정으로 보정하지 않았다(§7).

## 2. 경기 중 지시

### 2.1 전술 타임아웃 — 반당 1회

- 규칙: 맵당 2회(`ROUND_RULES.tacticalTimeoutsPerTeam`). 여기에 **반당 최대 1회**(연장은 별도 반, 맵당 총량 안에서)를 더했다.
  반당 제한은 **설계 선택이며 VCT 규정으로 확인하지 않았다**(`TIMEOUT_MODEL.perHalf`).
- 효과 ① 다음 라운드 지시(기존 `setOrders`). ② 선수별 틸트 회복:
  `c_i ← c_i + (0.25 + 0.35·motivating) · (0.6 + 0.4·k_i) · τ_i` — 감독의 동기부여 능력치와 선수의 침착함에 비례, 자신감은 건드리지 않는다.
  ③ 상대의 흐름을 끊는다: 상대의 양수 상태가 한 번 더 감쇠(ρ).
- 세션 상태의 `timeoutsRemaining`은 **지금 쓸 수 있는 수**(반당 제한 포함)다. 그래서 기존 UI 버튼이 엔진이 거절할 타임아웃을 내밀지 않는다.

### 2.2 지시(shout) — 바꿀 때까지 유지

| 지시 | 엔진으로 가는 길 |
|---|---|
| 템포 빠르게 | 공격 라운드마다 실행 콜. 사이트는 팀 자신의 상대 리딩으로 뽑는다: P(사이트) ∝ 1 + 3·max(0, −lean_수비(사이트)) — IGL과 같은 가중 |
| 템포 느리게 | 공격 라운드마다 `default`(라인을 잡고 근거로 결정하는 느린 플레이) |
| 리스크 과감하게 / 안전하게 | 리테이크 0.15, 공격 세이브 0.09, 영웅 0.08 기준에 ×0.6 / ×1.5, 쓰로잉 해저드 ×1.3 / ×0.75 |
| 수비 스택 | 리딩상 공격이 오는 사이트로 `stackA/B` (리딩이 없으면 A) |
| 수비 분산 | `defaultHold` |
| 보통 | 아무것도 강제하지 않음 — IGL이 판단 |

`tempo` 필드는 원래 `TeamOrder`에 있었지만 **어디에서도 읽히지 않았다.** 그래서 템포는 위처럼 구체적인 콜로 바꿔 전달한다.

### 2.3 다음 라운드 전략 변경

공격·수비 전략을 N라운드(기본 3) 동안 지정한다(타임아웃 없이 라운드 사이에 언제든). 우선순위:
타임아웃 지시 > 전략 변경 > 경기 계획(피스톨·피스톨 패배 후) > 지시(템포·수비).

**고친 결함(머지 포인트):** 지금까지 코치가 `aExecute`를 지시해도 라운드의 **목표 사이트는 IGL 자신의 오프닝 콜로 묶였다**
(`team-engine/src/policy.ts`의 `currentPlan` → `bindObjective`). 지시는 전략 라벨만 바꿨다.
이제 지시된 전략이 그 진영의 것이면 그대로 라운드의 오프닝 콜이 된다. 지시가 없으면 이전과 동일(아래 §6 해시 확인).
반사실 테스트: 같은 경기에서 공격 지시만 바꾸면 설치 사이트가 A 7회 / B 0회 ↔ A 0회 / B 10회(시드 9).

### 2.4 자동 진행 멈춤

라운드가 끝날 때 다음 라운드 전에 확인할 일이 생기면 알림이 생기고, 데스크톱은 자동 진행을 멈추고 감독 패널을 연다.

| 알림 | 조건 |
|---|---|
| 연패 | 연패가 4, 6, 8이 된 라운드 |
| 경제 붕괴 | 진 라운드 뒤 선수당 크레딧이 2,400 아래로 **떨어진 순간**(라이플+방어구 불가), 다음이 피스톨이 아닐 때 |
| 선수 틸트 | 선수의 틸트가 0.45를 **넘은 순간**. 팀 평점 상위 2명은 "핵심 선수"로 표시 |
| 하프타임 | 다음 라운드가 후반 첫 라운드 |

### 2.5 AI 감독 — 같은 레버, 자기 능력치

감독 능력치 `ManagerProfile { tactical, motivating }`(0–1, 기본 0.6).

```
타임아웃: 이번 반에 남아 있고
   연패 ≥ 3 + [tactical < 0.5]          (판단력 좋은 감독은 한 라운드 먼저 끊는다)
   또는 팀 틸트 T ≥ 0.25 + 0.2·(1 − tactical)
   또는 상대 매치 포인트
리스크: 4점 이상 뒤지면 과감하게, 4점 이상 앞서면(tactical ≥ 0.4) 안전하게
템포:   3연패 이상이면 느리게 (tactical ≥ 0.5)
수비:   상대 공격 리딩의 신뢰도·편향 ≥ 0.25면 스택 (tactical ≥ 0.5)
하프타임 토크: motivating ≥ 0.5면 선수별 예상 효과 합이 가장 큰 토크, 아니면 항상 격려
```

## 3. 하프타임 팀 토크와 경기 후 요약

12라운드가 끝나면 휴식으로 모든 선수의 상태가 한 번 더 감쇠(ρ)하고, 양 팀은 13라운드 전에 한 번 토크할 수 있다(생략 가능).

```
Δ_i = (0.5 + motivating) · f(토크, 상황, 선수)
  진정시키기  f = 0.5·τ_i                                         흔들린 선수만 가라앉힘
  격려하기    f = 0.10 + 0.10·(1 − k_i)     (앞설 때 0.05)       여린 선수에게 더
  다그치기    f = 0.30·(drive_i − 0.5) − 0.30·τ_i·(1 − k_i) + s     승부욕(entryAggression) 강하면 불붙고, 흔들리는 여린 선수는 무너짐
              s = +0.08 뒤질 때, −0.04 앞설 때
  칭찬하기    f = 앞설 때 0.05 + 0.12·k_i, 팽팽할 때 0.04, 뒤질 때 −0.06
상황: 2점 이상 앞섬 / 2점 이상 뒤짐 / 그 외
```

같은 토크가 선수마다 다르게 먹힌다 — 셸에서 다그치기를 해 본 예: 다섯 명이 +0.03 ~ +0.15.

**경기 후 요약**(`ManagedSessionResult.decisions`): 양 팀 감독의 모든 결정(타임아웃·지시·전략·지시 변경·토크)에
그때의 점수·팀 틸트·자신감, **결정 전후 각 3라운드의 승수**, 3라운드 뒤 틸트, 토크의 선수별 반응을 붙인다.
화면과 문서 모두 "결정 뒤에 일어난 일"이라고 쓰고, 결정이 원인이라고 주장하지 않는다.

## 4. 경기 전 상대 분석 리포트와 경기 계획

### 4.1 리포트 (`buildOpponentReport`)

상대의 **관측 가능한 경기 기록**(`TeamGameLog`)만 읽는다. 데이터에 실제 라운드별 기록이 없어서 상대의 최근 2경기를 시뮬레이션해
필름으로 쓴다(`scoutingFilm`, 시드 고정). 분석관 수준이 검토 경기 수를 정한다(`docs/SERIES_AND_VETO.md` §4.3과 같은 모델).

| 항목 | 출처 |
|---|---|
| 선호 사이트 (공격·수비) | 이 맵 근거가 8라운드 이상이면 이 맵, 아니면 전 맵의 `siteEvidence` |
| 피스톨 습관 | 피스톨 승률, 피스톨 공격의 A 비율, 피스톨 패배 후 포스 비율 |
| 경제 습관 | 진 라운드 다음 포스 비율, 구매 라운드 중 풀바이 비율 |
| 핵심 선수 | 스카우팅 리포트의 threat (평점 + 킬 차이) → 경계 / 약점 |
| 맵 풀 | 상대 숙련도 추정(분석관 수준만큼 정확) vs 우리 숙련도 |

표본이 작으면(비율 n < 4, 사이트 근거 < 8라운드) 화면에 "근거 부족"으로 표시한다. 리포트는 **제안 계획**도 만든다
(근거가 있는 60:40 이상 편향에만 기울임, 리포트를 상대 리딩의 출발점으로, 상대가 피스톨 패배 후 자주 포스하면 우리는 세이브).

### 4.2 경기 계획 → 엔진 입력

| 계획 항목 | 경로 |
|---|---|
| 공격 선호 사이트 (강도 1–10) | `TeamMatchInputs.standingPrior` (GamePlan: 반대 사이트 수비 의사관측) |
| 수비 대비 사이트 | `standingPrior` (그 사이트 공격 의사관측) |
| 리포트를 리딩 출발점으로 | `TeamMatchInputs.opponentPrior` (`opponentPriorFromLogs`, 관측마다 바램) |
| 템포 / 리스크 / 수비 배치 | 경기 시작 시점의 지시(§2.2) |
| 피스톨 공격 / 수비 | 1·13라운드 전략 지시 |
| 피스톨 패배 후 | 2·14라운드 경제 지시(세이브 / 포스) — 피스톨을 졌을 때만 |

**엔진 지원 대기 옵션:** 설치 위치·설치 후 운영·리테이크(engine-truth 세션, 공유 노트 `plant-plans-api.md`의 모양 그대로:
`plantPreference {A,B: auto|default|safe|open|cover|near}`, `postPlantPlans`, `retakePlans`)와 미드 장악(maps-data, 모양 미공개).
`MatchPlan.pending`에 담겨 전달되지만 **적용되지 않는다**. 세션 상태 `pendingPlanOptions`가 그 목록을 돌려주고, 화면은 비활성 상태로 보여 준다.
해당 브랜치가 합쳐지면 `prep.ts` `planTeamInputs`에서 `TeamMatchInputs`로 복사하는 것이 연결의 전부다.

## 5. 데스크톱

- **경기일 설정(상호작용 모드)**: "상대 분석 · 경기 계획" → 리포트 작성(분석관 수준) → 제안 계획 적용·수정 → 경기 시작 시 계획과 필름을 세션에 전달.
- **라이브 화면**: 오른쪽 위 "감독 지시" 버튼 → 패널: 알림, 이번 반 남은 타임아웃과 호출 버튼(기존 지시 창), 지시 3종, 다음 라운드 전략, 선수 상태(★ 핵심 선수, 틸트·흔들림·안정·자신감, 성격 태그).
  알림이 생기면 자동 진행을 멈추고 패널을 연다. 하프타임에는 팀 토크 창이 뜨고, 고르면 선수별 반응(고무됨·무반응·위축됨)을 보여 준다.
- **리뷰 탭**: "감독 결정 요약" — 양 팀 틸트 추이, 결정별 직전·직후 3라운드 승수와 틸트, 토크 반응, 경기 후 선수 상태.
- **시리즈**: 시리즈 맵도 감독 계층으로 진행된다(`SeriesSessionOptions.managed`, 시리즈 호스트가 좌석↔슬롯 변환). 시리즈 맵에는 경기 계획 패널이 없다(시리즈 설정 사용).
- 한/영 문자열: `ko.ts` / `en.ts` 끝의 `[manager]` 블록(141개 키, 자리표시자 일치는 단위 테스트로 고정).

## 6. 머지 포인트

| 파일 | 변경 |
|---|---|
| `packages/team-engine/src/policy.ts` | `currentPlan`: 그 진영의 지시 전략을 오프닝 콜로 사용(3줄) + `strategySide` 헬퍼 |
| `packages/match-runner/src/match.ts` | `[manager]` 표시: `setRoundInputs`, `traitsFor`, `perTeamTuning`; `policyTuningFor`/`formSigmaFor`가 라운드 값과 합성; `makeRoster` 두 곳과 폼의 clutch가 `traitsFor` 사용 |
| `packages/match-runner/src/team-inputs.ts` | `RoundTeamInputs` 타입 |
| `packages/match-runner/src/series.ts` | `SeriesSessionOptions.managed/managers/plans`, `SeriesGameSession.managed` |
| `packages/match-runner/src/index.ts` | export 추가 |
| `apps/desktop/src/shared/ipc.ts` | `prematchReport` 채널, `SessionCommand`에 `setShouts/setStrategy/teamTalk`, `SessionState.manager?`, `SessionResultSummary.manager?`, `SessionStartRequest.plan?/scouting?`, `PvBridge` 4개 메서드 |
| `apps/desktop/src/main/index.ts` | `prematchScript`, `IPC.prematchReport` 핸들러 |
| `apps/desktop/src/preload/index.ts`, `src/renderer/platform.ts` | 브리지 메서드 4개 (브라우저 스텁 포함) |
| `apps/desktop/scripts/match-session.mts` | `createManagedSession`으로 교체, 새 명령 3개, 상태·결과에 `manager` |
| `apps/desktop/scripts/series-session.mts` | `managed: true`, 새 명령 3개(좌석↔슬롯 변환), 상태·결과에 `manager` |
| `apps/desktop/src/renderer/useMatchSession.ts` | `managerResult`, `talkReactions`, `setShouts/setStrategy/teamTalk` |
| `apps/desktop/src/renderer/screens/matchday/LiveMatch.tsx` | 선택적 prop `managerOverlay` 1개, 렌더 1줄 |
| `apps/desktop/src/renderer/screens/MatchDayScreen.tsx` | 계획·리포트 상태, 자동 진행 멈춤 effect, 계획 패널 토글, `managerOverlay`, 리뷰에 결정 요약 |
| `apps/desktop/src/renderer/i18n/{ko,en}.ts` | 파일 끝 `[manager]` 블록 |
| `apps/desktop/package.json` | `test:unit`에 `manager-view.test.ts` |
| `apps/desktop/test/e2e.electron.test.mjs`, `e2e.series.test.mjs` | 리포트·계획, 감독 패널, 결정 요약 단계 추가 |

새 파일: `packages/match-runner/src/{manager,managed-session,prep}.ts`, `test/management.test.ts`;
`apps/desktop/scripts/{prematch,manager-view}.mts`, `src/shared/manager.ts`, `src/renderer/matchday/manager.ts`,
`src/renderer/screens/matchday/{ManagerPanel,PrematchPanel,PostMatchSummary}.tsx`, `manager.css`, `test/manager-view.test.ts`.

**`runMatch`는 그대로다:** 5경기 전체 기록 해시가 main(7073bac)의 엔진 파일과 이 작업의 엔진 파일에서 같다
(`packages/match-runner/scripts/match-signature.mts` → `e8da5918…bd32f1`).

**데스크톱 패키징(desktop-decisions 진행 중)과의 관계:** 그 작업은 `scripts/*.mts`를 번들 엔진 호스트(`src/engine/host.ts`)로 옮긴다.
옮길 때 `match-session`의 새 명령 3개와 `manager` 투영(`scripts/manager-view.mts`), `scripts/prematch.mts`도 함께 옮겨야 한다.

## 7. 검증과 남은 것

- 테스트: `packages/match-runner/test/management.test.ts` 14개(공식, 성격·능력치 의존, 지시→설치 사이트 반사실, 반당 타임아웃,
  하프타임 1회, 계획→1·2라운드, 결정 로그, 결정론, AI 감독 능력치별 차이, 리포트). 데스크톱 `test/manager-view.test.ts` 8개.
- **측정하지 않은 것:** 감독 계층이 승률에 주는 효과(예: AI 감독 tactical 0.9 vs 0.1, 틸트 모델 on/off)는 수백 경기 배치가 필요해
  이번에는 돌리지 않았다. 틸트 모델은 지는 팀을 더 흔들어 눈덩이 효과를 만들 수 있다 — 밸런스 판정(160경기)은 `runMatch` 기준이라 영향이 없지만,
  상호작용 경기와 시리즈 맵의 결과 분포는 그만큼 다를 수 있다.
- 원핫 경기(한 번에 시뮬레이션)는 여전히 `runMatch`라 감독 계층이 없다.
- 상대 리포트의 필름은 시뮬레이션이다(실제 라운드별 데이터 없음).
