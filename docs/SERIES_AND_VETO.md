# PROJECT V — 시리즈 · 맵 밴픽 · 맵 숙련도 · 스카우팅

**기준일:** 2026-11-19 · **범위:** 단일 맵 엔진(`runMatch`) 위의 시리즈 계층. 코드: `packages/match-runner/src/{series,veto,mastery,scouting,team-inputs}.ts`.

> ⚠ **임시 제약 — 모든 맵은 Ascent 지형에서 시뮬레이션된다.** 엔진이 가진 공간 데이터는 Ascent뿐이다.
> 시리즈의 각 게임은 **그 맵의 숙련도·스카우팅·밴픽**이 적용된 채 Ascent 지형에서 진행된다.
> 맵 ID는 데이터로 끝까지 흐른다(`MatchConfig.map`, `SeriesGameContext.map`, 리플레이 `mapId`;
> 실제로 쓴 지형은 `SeriesGameContext.geometry = "Ascent"`). 다른 맵의 공간 데이터가 들어오면
> `setup.ts`의 `loadSpatial()`을 맵별 로더로 바꾸는 것이 전부이고 시리즈 계층은 바뀌지 않는다.
> 3사이트 맵(Haven·Lotus)은 상대 모델의 `SiteKey = "A" | "B"`도 함께 넓혀야 한다.

원칙은 엔진 전체와 같다. **결과를 먼저 정하지 않는다.** 숙련도와 스카우팅은 승률 보너스가 아니라,
이미 문서화된 수식(`docs/STAT_OUTCOME_MATRIX.md`)에 들어가는 **팀별 값**을 바꾼다.

## 1. 구조

```
준비 prepareSeries   팀별 맵 숙련도 M · 상대 스카우팅 리포트 · 밴픽 판단용 예상 승률
   ▼
밴픽 VetoProcess     포맷(데이터)의 스텝을 하나씩: ban / pick / side / decider — 사람 또는 AI
   ▼
게임 MatchEngine     맵마다 1경기. 공격으로 시작하는 팀이 엔진 슬롯 A.
                     팀별 입력(teamInputs) = 숙련도 → 기존 수식의 값, 스카우팅 → 상대 모델 사전 근거, 게임 플랜
   ▼
결과 SeriesResult    게임마다 맵 · 누가 골랐는지 · 시작 진영 · 적용된 입력 · MatchResult
```

- 결정론: 같은 설정(시드 포함) + 같은 사람 선택 → 같은 시리즈. 게임 시드는 `deriveSeed(시리즈 시드, "game:N:맵")`
  이라 숙련도·스카우팅과 무관하다. 그래서 반사실 실험에서 바꾼 입력만 달라진다.
- 시리즈 팀 `A`/`B`는 룰북의 Team A/B(A가 밴픽을 시작)다. 엔진 슬롯 `A`/`B`와는 다르며,
  게임마다 `slots: { A: 슬롯, B: 슬롯 }`으로 대응을 기록한다(엔진은 슬롯 A가 선공).

## 2. 시리즈와 밴픽

### 2.1 포맷은 데이터다

```ts
type VetoStep = { kind: "ban" | "pick" | "side"; team: "A" | "B" } | { kind: "decider" };
interface VetoFormat { id; name; games; poolSize; steps: VetoStep[]; source; verified }
```

`side`는 직전에 정해진 맵의 시작 진영 선택, `decider`는 마지막으로 남은 맵이 다음 게임이 되는 규칙 스텝(아무도 고르지 않음).
`validateVetoFormat`이 "풀을 정확히 소진하는지, 모든 맵에 진영이 정해지는지"를 검사한다. 다른 대회 순서는 스텝 배열만 넘기면 된다.

| 프리셋 | 순서 | 출처 |
|---|---|---|
| `VCT_BO1` | A밴 B밴 A밴 B밴 A밴 B밴 → 남은 맵 → **A 진영 선택** | 룰북 §4.6.7 |
| `VCT_BO3` | A밴 B밴 → A픽(1맵, **B 진영**) → B픽(2맵, **A 진영**) → A밴 B밴 → 남은 맵(3맵, **A 진영**) | §4.6.8 |
| `VCT_BO5` | A밴 B밴 → A픽(B 진영) → B픽(A 진영) → A픽(B 진영) → B픽(A 진영) → 남은 맵(5맵, **B 진영**) | §4.6.9 |
| `vctGrandFinalBo5(상위 브래킷 팀)` | 상위 브래킷 팀이 2밴 → 이후 Bo5와 동일 | §4.6.10 |

**출처와 검증 수준.** *VALORANT Champions Tour — VALORANT Official Competition Ruleset* (최종 수정 2023-04-03) §4.6.6–4.6.10의
원문을 직접 읽어 옮겼다(PDF: <https://www.a-esc.com/site_data/file/regulation/2024/03/1709876524_l12pmnXE_28Val29VCT.pdf>).
같은 문서: 맵 풀은 7개이고 실제 목록은 대회별 룰북에 있다(§4.6.6). 상위 시드가 Team A/B 중 하나를 고르고, 시드가 없으면 무작위다.

**확인하지 못한 것 (단정하지 않음):**
- 위 순서가 **2026 시즌 룰북에서도 그대로인지**는 확인하지 못했다. 2026년부터 동일 시드 경기는 1v1 스커미시로 맵·진영 선택 우선권을 정한다는
  보도가 있으나(<https://dotesports.com/valorant/news/vct-skirmish-side-selection>) 이는 "누가 Team A인가"의 문제이고 순서 자체가 바뀌었다는 근거는 찾지 못했다.
  시리즈 계층은 Team A가 누구인지 묻지 않는다 — `teamA`로 넘긴 팀이 A다.
- **대회용 맵 풀.** 기본값 `MAP_POOLS["rotation-13.04"]` = Abyss·Ascent·Haven·Lotus·Split·Summit·Sunset 은 패치 13.00(Summit·Sunset 추가, Fracture·Pearl 제외)과
  13.04(Abyss 추가, Breeze 제외) 이후의 경쟁전 로테이션이고, 이 저장소의 패치 13 이상 국제전 데이터에 등장하는 맵과 일치한다(`docs/research/NEXT_MAP_PREP.md`).
  패치 13.08에서 Bind·Corrode가 들어오고 Ascent·Split이 빠졌다(`"rotation-13.08"`). 패치 노트는 검색 요약으로만 확인했고
  (<https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-13-00/>, `…-13-04/`, <https://wiki.playvalorant.com/en-us/Patch_Notes/13.08>),
  **특정 2026 대회가 어느 풀을 썼는지는 확인하지 못했다.** 풀은 `SeriesConfig.mapPool`로 바꾼다.
- **시작 진영 선택 기준.** AI는 그 맵의 공격 라운드 승률(데이터)이 0.5를 넘으면 공격, 아니면 수비를 고른다. 데이터가 없는 맵에서 수비를 고르는 것은 관례를 따른 설계값이다.
  또 지금은 모든 맵이 Ascent 지형이라, 실제 진영 유불리는 맵과 무관하게 Ascent의 것이다.

### 2.2 AI의 밴픽 — 믿음으로 끝까지 내다본다

팀은 맵별 예상 승률(믿음)을 갖는다. 결과 계산이 아니라 **선택을 위한 추정**이다.

```
p(맵) = σ( logit(기준 승률) + 0.8 · (M_우리 − M̂_상대) )      VETO_BELIEF.masterySlope = 0.8
V(상태) = 시리즈 승리 확률                    (스텝이 끝났을 때, 먼저 과반 승)
        = 내 선택지 중 최대 V                  (내 스텝)
        = 상대 선택지 중 최소 V                (상대 스텝 — 내 추정으로 본 상대의 최선)
```

- 7맵 풀은 경우의 수가 5,040 이하라 전수 탐색한다. 동률은 풀에서 앞선 맵(무작위 없음).
- "상대가 무엇을 밴할지"가 들어가므로, 상대가 어차피 밴해야 하는 맵에 내 밴을 낭비하지 않는다.
- `M̂_상대`는 스카우팅이 있어야 알 수 있다(§4.3). 스카우팅이 없으면 모든 맵에서 리그 평균으로 본다 → 자기 숙련도만 보고 밴픽한다.
- 기울기 0.8은 §6.1의 측정에 맞춘 값이다(숙련도 차 ±0.25 → 맵 승률 약 ±5%p 수준).

### 2.3 단계별 API (UI를 올릴 자리)

`createMatchSession`이 라운드와 타임아웃을 노출하는 방식을 그대로 따른다.

```ts
const s = createSeriesSession(config, { aiTeams: ["B"] });   // 사람이 A, AI가 B
s.preparation();        // 맵별 숙련도(구성요소·불확실성), 스카우팅 리포트, 맵별 예상 승률
s.pendingVeto();        // { kind: "ban"|"pick"|"side", team, options, map?, ai, recommendation: { choice, reason, values } }
s.chooseVeto("Lotus");  // 사람의 선택 (맵 이름 또는 "attack"/"defense")
s.advanceVeto();        // 사람 차례가 올 때까지 AI 스텝 진행 → VetoAction[]
s.state();              // { phase: "veto"|"playing"|"finished", score, maps, banned, remaining, ... }
const g = s.startGame();        // { context: SeriesGameContext, session: MatchSession }  ← 기존 라운드/타임아웃 UI 그대로
g.session.playNextRound(); ...  // context.slots 로 시리즈 팀 ↔ 엔진 슬롯 변환
s.finishGame();         // SeriesGameResult (맵, pickedBy, startingSides, score, mastery, inputs, match)
s.playNextGame();       // 한 맵을 한 번에
s.result();             // SeriesResult
runSeries(config);      // 처음부터 끝까지 (양 팀 AI)
```

각 게임의 `MatchResult.config`에는 `map`과 `series: { gameNumber, map, geometry, pickedBy, sideChosenBy, startingSides, slots }`가 실린다.
CLI: `pnpm --filter @pv/match-runner sim:series --teamA 624 --teamB 7386 --format bo3 --seed 1`.

## 3. 맵 숙련도

```
M = 0.5·H + 0.3·C + 0.2·F        (각 구성요소 0–1, 각자 불확실성 1σ 보유; u_M = √Σ(w·u)²)
```

### 3.1 H — 맵 전적 (경험 × 결과, 둘 다 수축)

```
E = n / (n + K_E)                       n = 그 맵 경기 수, K_E = 리그 중앙값(현재 3경기, 하한 3)
p̂_all = (W + 10) / (N + 20)             팀의 전체 맵 승률 → 0.5로 수축
p̂_map = (w + 10·p̂_all) / (n + 10)       그 맵 승률 → 팀 자신의 전체 승률로 수축
R = 0.5 + (p̂_map − p̂_all)              = 0.5 + n/(n+10) · (w/n − p̂_all)
H = min(1, E · 2R)
```

- **3경기는 전문성이 아니다**: 3전 3승의 R은 약 0.6이고 E는 0.5라 H ≈ 0.6. 30전 21승은 H ≈ 1.
- 결과는 **팀 자신의 전체 승률 대비**다. 강팀이 모든 맵에서 이긴다고 모든 맵의 숙련자가 되지 않는다(실력은 이미 선수 능력치에 있다).
- 불확실성: `u_H = 2E · sd(p̂_map)`.

> **데이터 한계 — 맵별 승패가 커밋된 데이터에 없다.** `teams.json`의 `mapPool`은 맵별 **경기 수**뿐이다(국제전만).
> 이 경우 `R = 0.5`(중립)로 두고 `u`에 0.15를 반영한다(`history.resultsKnown = false`). 맵별 승패·선수별 맵 경기 수는
> VCT Reference DuckDB(13MB, 미커밋)에서 만들 수 있고, `packages/game-data/data/map-history.json`
> (`TeamMapHistoryBundle`)이 생기면 로더가 자동으로 쓴다. 커리어 모드는 `SeriesTeamConfig.mapRecords`로 자체 누적 전적(승패 포함)을 넘긴다.

### 3.2 C — 로스터 연속성 (쌍 단위)

```
C = 오늘의 5인 중 10개 쌍(i,j)의 평균  g_ij / (g_ij + 3),   g_ij = min(g_i, g_j)
```

`g_i`는 선수 i가 **이 팀에서 이 맵을** 뛴 경기 수. 팀워크(트레이드·양각·콜)는 쌍 단위이고, 한 쌍이 함께한 경기는 더 늦게 온 쪽을 넘지 못한다.
**새 선수 1명 → 10쌍 중 4쌍이 0 → C가 40% 이상 하락**, 2명이면 70%.

선수별 맵 경기 수가 데이터에 없으면 배분한다: `g_i = n · (그 선수의 팀 출전 수 ÷ 로스터 최다 출전 수)`
(출전이 팀의 맵들에 고르게 퍼졌다는 가정, `continuity.measured = false`, `u_C = 0.1`). 팀 기록이 없는 선수는 0.

> 지금은 숙련도 계산에만 `lineup`이 쓰인다. 엔진이 실제로 내보내는 5명은 여전히 game-data 로스터의 앞 5명이다
> (라인업 → 엔진 능력치 연결은 `match.ts`/`teams.ts`의 후속 작업, §8).

### 3.3 F — 조합 적합도

```
F = max over 그 맵의 확립된 조합 c (8 팀-맵 이상)   coverage(c) · rel(c)
coverage(c) = 5명을 조합의 5요원에 1:1 배정했을 때의 최대 평균
              1.0 요원을 써 봤고 주 역할   0.8 써 봤지만 다른 역할   0.5 역할만 맞음   0.15 둘 다 아님   0.5 정보 없는 선수
rel(c)      = 조합의 수축 승률 ÷ 최고 수축 승률,   수축 = (승 + 10) / (맵 수 + 20)
```

팀은 검증된 조합 **하나**만 잘 꾸리면 되므로 최댓값이다. 조합 통계는 `map-comps.json`(현재 **Ascent·Lotus**만 존재).
**조합 통계가 없는 맵은 역할 구성만 본다**(컨트롤러·듀얼리스트·이니시에이터·센티널 + 자유 1, 맞으면 0.75) — `compFit.basis = "roles"`, 불확실성 0.15.
요원 풀(`agent-pools.json`)은 "한 번이라도 쓴 요원" 목록이라 맵별·횟수 정보가 없다.

### 3.4 숙련도가 경기에서 하는 일 — 기존 수식의 팀별 값

`d = clamp(M − M₀, ±0.5)`, `M₀` = 리그 기준(모든 시뮬 가능 팀 × 풀의 모든 맵의 중앙값, 현재 0.428).
**`d = 0`이면 모든 값이 기본값과 같다** — 평균적인 팀의 평균적인 맵은 그냥 `runMatch`다. 모두에게 생소한 새 맵은 모두가 조금 더 엉성하다.

| 숙련도의 의미 | 들어가는 기존 수식 | 팀별 값 | d = +0.25 / −0.25 |
|---|---|---|---|
| 설치 후 어디가 안전한 자리인지 안다 | 쓰로잉 해저드 (`STAT_OUTCOME_MATRIX` §3.3) | `λ₀' = λ₀ · e^(−2d)` | ×0.61 / ×1.65 |
| 맵이 익숙하면 기복이 준다 | 라운드 폼 (§4) | `σ' = σ · clamp(1 − 1.2d, 0.5, 1.6)` | ×0.70 / ×1.30 |
| 콜이 자리 단위로 정확해 정보가 오래 유효 | 정보 반감기 (§2.2) | `trading' = trading + 0.4d` | +0.10 / −0.10 |
| 두 번째 총구가 어디 있을지 안다 | 양각 지연 (§2.1) | `gameSense' = gameSense + 0.4d` | +0.10 / −0.10 |
| 맵의 정석을 알아 변칙을 빨리 알아챈다 | 상대 모델 사전 의사카운트 α (`CTI` §4.4) | `인식' = 인식 + 0.6d` | α 1.0 → 0.81 / 1.19 |

결투 결과·승률에 직접 더하는 값은 없다. 게임마다 적용된 값이 `SeriesGameResult.inputs`에 그대로 남는다.
위 기울기들은 **설계값**이다 — 맵별 실측 승패가 없어 실데이터로 보정하지 못했다(§7).

## 4. 스카우팅과 카운터 전략

### 4.1 무엇을 보는가 — 관측 가능한 기록만

`TeamGameLog`(= `teamGameLog(MatchResult, slot)`): 상대가 과거에 치른 경기의 **공개 사실**만 남긴 기록.
공격 라운드의 설치 사이트·첫 교전 사이트, 수비 라운드에 사이트별로 잡힌 수비 수, 첫 교전 시각, 바이 등급, 선수별 킬/데스/첫 킬.
상대의 콜이나 계획 같은 숨은 상태는 읽지 않는다(경기 중 상대 모델이 배우는 것과 같은 범위).
커리어 모드는 `seriesGameLogs(result, team)`을 팀의 `history`에 쌓으면 된다.

### 4.2 리포트의 두 가지 효과

**(a) 경기 중 상대 모델의 사전 근거** — 1라운드부터 습관을 상대하되, 믿음일 뿐이다.

```
라운드 가중치 = (리포트 흡수율 | 직접 본 경기는 1) · 0.85^(몇 경기 전) · (같은 맵 1 | 다른 맵 0.35)
N      = 가중 근거 라운드 수 (공격: 설치 1, 설치 없으면 첫 교전 0.5 / 수비: 잡힌 위치 비율로 1)
질량   = 6 · N / (N + 12)                       상한 6 ≈ 경기 중 보유 가능한 표본 1/(1−0.85)
seed_k = 질량 · (사이트 k의 비율)               → OpponentModel.seed()
```

모델 안에서 신뢰도는 다른 근거와 똑같이 `질량 / (질량 + 2α)`이고, 실제로 관측한 라운드마다 0.85씩 바랜다.
그래서 **상대가 일부러 습관을 깨면 경기 중 근거가 리포트를 뒤집는다.** 필름이 아무리 많아도 직접 붙어 본 것 이상이 되지 않는다.

**(b) 밴픽** — 상대의 맵 숙련도 추정으로 §2.2의 `M̂_상대`를 채운다 → 상대가 우리보다 상대적으로 가장 강한 맵을 밴하고, 우위가 가장 큰 맵을 고른다.

```
M̂ = M₀ + a·(M − M₀) + (1 − a)·u·z        a = 분석관 수준, u = 그 숙련도의 불확실성, z ~ N(0,1) (±2 제한, 시드 고정)
```

### 4.3 스카우팅의 질 — 팀의 것

| 요소 | 값 | 수식 |
|---|---|---|
| 분석관 수준 `staff.analyst` (경기 전 옵션, 기본 0.5) | 0–1 | 검토 경기 수 = `ceil(a · min(가용 경기, 8))` (최근 경기부터), 맵 추정의 정확도 `a` |
| 로스터의 판단력 (decisionMaking 평균) | — | 흡수율 = `clamp(0.8 + 0.5·(dm − 0.6), 0.5, 1)` — 분석관이 찾아도 선수가 소화해야 한다 |
| `scouting: false` | — | 리포트 없음: 상대 맵은 전부 리그 평균으로 보고, 사전 근거도 없다 |

양 팀 모두 서로를 스카우팅할 수 있다(기본값이 그렇다).

### 4.4 시리즈 안에서의 이월

한 맵을 치르면 양 팀은 상대를 한 경기 통째로 본 것이다. 그 기록은 흡수율 1(직접 봄)로 다음 맵의 사전 근거에 더해진다
(다른 맵이므로 0.35 가중). 스카우팅 여부와 무관하며 `carryOver: false`로 끈다.

### 4.5 팀의 게임 플랜 — 습관은 어디서 오는가

엔진의 IGL은 팀마다 같은 규칙을 쓰므로 스스로는 사이트 습관이 없다. 팀의 성향은 **경기 전 옵션** `gamePlan`이다:

```ts
gamePlan: { attack: { site: "A", strength: 8 }, defense: { site: "A", strength: 8 } }
```

IGL은 "수비가 얇다고 믿는 쪽"을 치고 "공격이 온다고 믿는 쪽"을 두껍게 한다. 게임 플랜은 같은 화폐 — **바래지 않는 믿음** — 로 표현한다:
공격 성향 X(강도 s) ≡ "상대 수비는 반대편에 있다"는 상시 의사관측 s개, 수비 성향 X ≡ "상대 공격은 X로 온다" s개.
오프닝 콜 가중치는 `1 + 3·lean`, `lean = s/(s+2) · s/(s+2)` (s = 8 → 0.64)만큼 기운다. 대본이 아니라 성향이라 매 라운드 여전히 추첨이고,
플랜과 어긋나는 근거가 쌓이면 물러난다(고집 = s).

### 4.6 엔진에 아직 쓸 곳이 없는 리포트 항목

라운드 오프닝 요약(설치율·첫 교전 시각·피스톨 승률)과 선수 평가(`threat = (평점 − 0.6) + (K − D)/(라운드 + 24)`, 위험 인물·약점 태그)는
코치/화면용 정보다. 특정 선수를 노리거나 템포에 대응하는 메커니즘이 엔진에 없어서 **결과에 영향을 주지 않는다.**

## 5. 엔진 쪽 변경 (머지 포인트)

다른 세션이 수정 중인 파일에는 표시된(`[series]`) 추가만 했다.

| 파일 | 변경 |
|---|---|
| `packages/team-engine/src/opponent-model.ts` | `Tendency.seed(counts, standing)`, `OpponentModel.seed(prior, { standing })`, 타입 `OpponentPrior`. `Tendency`에 바래지 않는 `standing` 카운트 필드 추가 — `estimate()`가 `counts + standing`을 쓴다(시드하지 않으면 0이라 결과 동일) |
| `packages/team-engine/src/index.ts` | `OpponentPrior` 타입 export |
| `packages/match-runner/src/match.ts` | `MatchConfig.teamInputs?`, `MatchConfig.series?`(메타데이터) / 생성자 끝에 팀별 입력 적용 블록 / `basePolicyTuning`, `policyTuningFor`, `formSigmaFor` 추가 / `playRound`에서 `teamInputs`가 있을 때만 사이드 정책에 팀별 튜닝 재바인딩 / `formSkills`의 마지막 인자 `this.formSigmaMax` → `this.formSigmaFor(slot)` (**기존 줄 1개 수정**) |
| `packages/match-runner/src/index.ts` | 시리즈 계층 export 추가 |
| `packages/game-data/src/index.ts` | `export * from "./maps.ts"` |

**`runMatch`는 그대로다.** 새 옵션 없이 5개 경기(팀·시드 조합)의 전체 기록 해시를 변경 전(8e165f4)과 변경 후에 비교해 동일함을 확인했다
(`packages/match-runner/scripts/match-signature.mts`, 합계 해시 `24a24477…5c5291`). 중립 입력(`teamInputs` 스케일 1·델타 0)이 입력 없음과 같은 경기를 내는 것은 테스트로 고정했다.

## 6. 검증

### 6.1 측정된 효과 크기

@@EFFECTS@@

### 6.2 반사실 테스트 (한 조건만 바꿈)

`packages/match-runner/test/series.test.ts`, `packages/team-engine/test/opponent-prior.test.ts`.

| 질문 | 바꾼 조건 | 결과 |
|---|---|---|
| 스카우팅이 1라운드 판단을 바꾸는가 | 같은 시리즈, 스카우팅 on/off | off: 1라운드 상대 모델 표본 0. on: 표본 > 1, 습관 쪽 확률 > 0.5, 신뢰도 < 0.8. 스카우팅 당한 팀의 입력은 동일 |
| 스카우팅이 밴픽을 바꾸는가 | 상대가 한 맵에 매우 강함, 스카우팅 on/off | on: 첫 밴이 그 맵. off: 아님(상대 맵을 전부 리그 평균으로 봄) |
| 상대가 습관을 깨면 | 기록과 반대 플랜으로 출전 | 1라운드엔 옛 습관을 믿고 들어가지만 경기 중 근거로 믿음이 0.5 아래로 뒤집힘 |
| 근거량이 신뢰도를 정하는가 | 1경기 vs 3경기, 같은 맵 vs 다른 맵 | 사전 근거 질량: 1경기 < 3경기, 다른 맵 < 같은 맵, 상한 6 미만 |
| 분석관 수준 | 1.0 / 0.5 / 0.3 / 0 | 검토 경기 3 / 2 / 1 / 0, 맵 추정 오차는 수준이 높을수록 작음(1.0이면 정확) |
| 한 맵의 숙련도를 올리면 | 그 맵 경기 수 4 → 30 | 그 맵 숙련도 +0.15 이상, 다른 맵은 값이 **완전히 동일**. 밴픽: 그 맵이 팀의 픽이 됨. 그 맵 경기는 달라지고 다른 맵 경기는 같은 시드에서 **동일** |
| 로스터 변경 | 5명 중 1명을 팀 기록 없는 선수로 | 연속성 60% 이하로 하락, 전적 항은 불변, 숙련도 하락 |
| 3경기가 전문성으로 보이는가 | 3전 3승 vs 30전 21승 | 3전 3승의 결과 항 0.5–0.62, 전적 항은 장기 전적보다 0.25 이상 낮음 |
| 숙련도가 리그 기준이면 | d = 0 | 스케일 1·델타 0 — 입력 없는 경기와 동일 |
| 결정론 | 같은 시드·옵션 / 같은 사람 선택 | 같은 시리즈(밴픽·모든 라운드·계획). 다른 시드는 다름 |
| 단계별 진행 | 사람 A(추천과 다른 선택), AI B | 사람 스텝 5개, 맵 3개 확정, 라운드 단위 진행, 재생 시 동일 |

### 6.3 테스트 수

루트 `npx vitest run` 174 통과 / 4 todo (상대 모델 사전 근거 6개 추가), `packages/match-runner` 61 통과 (기존 32 + 시리즈 29),
`packages/game-data` 7 통과, `npx tsc --noEmit -p tsconfig.json` clean. `packages/match-runner`의 `tsc`는 소스에 오류가 없고,
기존 테스트 두 파일의 6건(§8-6)만 남는다.

## 7. 확인하지 못했거나 설계값인 것

- 2026 룰북의 밴픽 순서, 대회용 맵 풀, 시작 진영 관례(§2.1).
- 숙련도 가중치(0.5/0.3/0.2), 수축 의사카운트, 쌍 반숙련 3경기, 조합 커버리지 점수, **숙련도 → 엔진 값의 기울기 전부**: 설계값. 맵별 실측 승패가 없어 보정 불가.
- 맵별 승패·선수별 맵 경기 수: 커밋된 데이터에 없음 → 결과 항 중립, 연속성은 출전 비율로 배분.
- 조합 통계는 Ascent·Lotus뿐 → 나머지 맵의 적합도는 역할 구성만.
- 스카우팅 상수(검토 8경기, 최근성 0.85, 다른 맵 0.35, 상한 6, 반포화 12라운드, 흡수율): 설계값. 실제 스카우팅 데이터는 없다.
- 팀의 실제 사이트 성향은 데이터에 없다(`team_profiles`의 `sitePreference`가 null) → 게임 플랜은 옵션으로만 존재하고 기본은 "없음".

## 8. 남은 일

1. **코치 지시(공격)의 목표 사이트** — `TeamOrder.strategy = "aExecute"`는 전략 라벨만 바꾸고 실제 목표 사이트는 IGL의 원래 콜에서 묶인다
   (`policy.ts`의 `currentPlan`/`bindObjective`). 타임아웃 지시로 공격 사이트를 강제할 수 없다. 이번 작업 범위 밖(`policy.ts`)이라 고치지 않았다.
2. **라인업 → 엔진**: `lineup`이 숙련도에만 쓰이고 엔진은 로스터 앞 5명을 내보낸다. `MatchConfig`에 라인업을 받는 작업 필요.
3. **맵별 전적 데이터**: DuckDB에서 `map-history.json`(맵별 승패, 선수별 맵 경기 수)과 나머지 맵의 조합 통계 생성 → 숙련도 기울기를 실측 "픽 맵 승률"에 보정.
4. **맵별 지형**: `loadSpatial(map)` + 3사이트 맵용 `SiteKey` 확장.
5. 상대 모델 범주 확장(전진 수비 빈도, 템포)과 함께 리포트의 오프닝·선수 항목을 엔진에 연결.
6. 기존 테스트 `adaptation.test.ts`·`ratings.test.ts`가 `teams[0]!.id`(존재하지 않는 필드, 올바른 것은 `teamId`)를 써서 `tsc`에서 6건 오류가 나고, 실행 시에는 팀을 찾지 못해 평균 로스터로 돈다. 이번 변경과 무관한 기존 문제.
