# Handoff — pistol & round movement (session A, PV-2 2차)

Branch `claude/pv2-pistol`. Scope: `packages/combat-engine`, `packages/round-simulator` (이동·교전),
`packages/team-engine/src/movement*`, 피스톨·이동 측정. HANDOFF P0-1(피스톨), P0-4(movementStyle).

> **결론 먼저:**
> 1. 피스톨 원인은 "엔진이 수비 각유지 우위를 올바르게 재현 + 표본 분산"이며 국소 버그가 아니다(§1).
> 2. **`weaponModes` 단독·`movementStyle` 단독은 각각 두 구간 게이트를 통과하지 못한다**(§2–3).
> 3. **그러나 `movementStyle` + `weaponModes`를 함께 켜면 두 구간 모두 기존 8개 8/8을 통과하고
>    161–320 피스톨이 0.397 → 0.456으로 고쳐진다**(§4). run-and-gun이 movementStyle이 만든 "움직이는
>    공격수"를 정확히 메우고, movementStyle의 전멸 이득이 weaponModes의 전멸 손실을 상쇄한다 —
>    P0-1(피스톨)과 P0-4(movementStyle ON)를 **하나의 원리적 조합으로 동시 해결.** 상수로 안 덮음.
> 4. 단, 이 조합은 161–320에서 **비핵심 에코 셀**(semi-eco, full-eco·eco-full=소표본)을 악화시킨다 —
>    세션 B(에코) 영역과 겹치므로 후속 과제로 기록(§4).
>
> **2026-11-25 오케스트레이터 결정으로 이 브랜치는 기본값을 플립했다:** `weaponModes` 기본 ON
> (`!== false`), `movementStyle` 기본 ON (`?? true`). 두 구간 8/8 ≥ main이라 규칙 충족. opt-out:
> sim-batch `--no-weapon-modes` / `--no-style`, 또는 `MatchConfig.weaponModes:false` /
> `movementStyle:false`(또는 `BUY_PHASE_ONLY_STYLE`). 최종 판정은 B·C·D와 합친 통합 트리 재게이트.
> 전체 테스트/타입체크 통과(§7).

---

## 1. 피스톨 원인 (측정)

피스톨 라운드는 양쪽 모두 Classic + 라이트실드(800cr, loadout 4000/4000) — **장비·크레딧 완전 대칭.**
유일한 비대칭은 공/수 역할(위치)뿐이다. (`buydump` 확인: 10명 전원 Classic/armor 25.)

측정 도구: `runMatch({traceEngagements:true})`의 `RoundRecord.engagements`(EngagementRecord). 라운드 1만
양방향으로 돌려(roster 강도 상쇄) 960라운드 풀링. 스크립트: `tools/data-validator/scripts/pistol-engagements.mts`.

핵심 수치(시드 1–480, 960라운드):
- 첫 교전 거리 ~20 m, **첫 시야(first-sight)의 87–92%가 mutual**, 첫 교전에서 preAim ≈ 0 (수비가
  첫 접촉에서 각을 미리 잡고 있지 않다). 즉 피스톨 오프닝은 ~20 m 대칭 Classic 난사전이다.
- 모든 교전 집계: **공격수 이동 67% vs 수비수 이동 38%.** 가장 흔한 자세쌍(61%)은
  **움직이는 공격수 대 멈춘 수비수.**
- crossfire 걸림: 공 0.210 / 수 0.207 (**대칭 — 원인 아님**). info 우위: 공 0.080 / 수 0.006
  (**공격에 유리 — 원인 아님**).
- mutual 듀얼에서 공격수가 **먼저 쏘는 비율 88%**(readyMs 93 ms 빠름, 피커 어드밴티지) **인데도** 더 진다.

**메커니즘:** 공격수는 각으로 **움직이며** 피크한다. 먼저 쏘더라도 아직 이동 중이라 명중이 깎이고
(combat-engine `hitChance`의 movingPenalty), 멈춘 수비수의 사격은 정확히 들어간다 → 대칭 듀얼을
수비가 가져간다. 이는 엔진이 **수비 각유지 우위를 올바르게 재현**하는 것이다(오프닝 듀얼 목표
Ascent 0.437; 엔진 0.43–0.45, 게이트 통과).

**구간별(원인):** 자세 분포는 구간 간 거의 동일(dist 20–21, mutual 0.87–0.92, opening 0.41).
라운드 승률만 갈린다(side-swap probe: 1–160 0.463, 161–320 0.422, 321–480 0.509, **풀 0.465**).
→ 161–320은 **같은 메커니즘의 운 나쁜(수비 유리) 표본**이다. n=320, SE≈0.028이라 0.39–0.51의 폭은
±2SE 수준. **피스톨 풀링(0.465)은 게이트 허용(0.50±0.05) 안**이고, 161–320 단일 구간만 0.397로 미달.

`combat-engine`의 `hitChance`/`readyDelayMs`는 **무기 독립**(샷당 명중은 사수 스킬·거리 기반; 무기는
데미지·연사·근접폭 falloff·movingAccuracy만 바꾼다). 그래서 피스톨이 full-v-full(0.486)보다 약간 낮은
것도 같은 구조 + 분산이지 Classic 전용 버그가 아니다.

## 2. `weaponModes` 평가 (읽기만: `origin/claude/remaining-work-final-push-fa1459` ee4adbb)

그 브랜치의 변경은 `loadWeapons({ modes: config.weaponModes !== false })`(기본 ON) + sim-batch
`--no-weapon-modes`. Classic의 run-and-gun(movingAccuracy 0.75) + 근접 버스트(≤3 m)를 켠다. **머지하지
않고** 같은 조건을 내 트리에서 `--weapon-modes`(기본 OFF)로 측정했다.

- **원리적으로 맞는 방향:** 실제 발로란트 권총은 이동 사격 정확도가 높은데, 현재 기본값은 움직이는
  Classic을 소총처럼 penalize한다. 공격수가 더 많이 움직이므로(67%) 이 과벌점이 공격을 특히 누른다.
- **효과(측정):** 161–320 피스톨 **0.397 → 0.434** (+0.037, 실질 개선) — 그러나 **여전히 미달**(<0.450).
  1–160 피스톨은 0.469 → 0.469(변화 없음; 표본 의존).
- **부작용(게이트 탈락):** 1–160에서 **전멸 0.681 → 0.670 (미달, ≥0.674 경계 밖)** → 1–160이 8/8 → 7/8로
  **main보다 나빠진다.** deton 0.078→0.083, defuse 0.185→0.192로 라운드 결과 분포가 스파이크 쪽으로
  이동(움직이며 교전 → 교전이 길어지고 트레이드/설치로 감).
- **Classic 한정 run-and-gun**(샷건/Frenzy/Stinger 제외)로 좁혀도 **두 구간 모두 full weaponModes와
  수치가 동일**했다. 즉 전멸 하락의 원인은 샷건류가 아니라 **Classic 자체**(에코 라운드에서도 Classic을
  쓰므로)다 — 피스톨 상승과 전멸 하락이 같은 무기 속성이라 분리 불가.

**판정:** `weaponModes`는 피스톨을 올리지만 (a) 161–320을 통과시키지 못하고 (b) 1–160 전멸을 깨뜨린다.
**기본 ON 불가.** 상대 세션의 기본 ON 변경은 통합 트리에서 게이트를 통과하지 못한다(아래 표). 플래그
뒤 OFF 유지 권장.

## 3. `movementStyle` 평가 (HANDOFF P0-4)

`--style`(라이브 전 파트) 1–160: 피스톨 **0.469 → 0.438 (미달)** → 1–160이 8/8 → 7/8. 나머지 7개는 OK
(전멸 0.683, 공격 0.486, full-full 0.466). movement.md의 "스타일 ON = 피스톨 −1.5~2 %p"를 통합 트리에서 재현.

- 원인: 스타일은 공격수를 더 움직이게 만들어(§1의 과벌점을 더 받는 자세) 피스톨을 누른다.
- 보상 레버는 `weaponModes`(움직이는 공격수의 run-and-gun 회복). §4에서 **조합이 통한다.**

**판정:** movementStyle 단독은 미통과(피스톨 0.438). **weaponModes와 함께 켜면 피스톨 손실이 사라진다
(§4)** — P0-4 해결. 단독으로는 플래그 뒤 OFF.

## 4. 두 구간 게이트 표 (실제 로스터, Ascent, 160경기/구간, 기존 8개) — **핵심 결과**

main 기준선 = 현재 HEAD(엔진이 65180b9 이후 바뀌어 직접 측정). base = 변경 없음. ❌=미달.

| 조건 | 구간 | 판정8 | 전멸 | 폭발 | 해체 | 시간초과 | 공격 | 오프닝 | 피스톨 | 풀v풀 |
|---|---|---|---|---|---|---|---|---|---|---|
| base(main) | 1–160 | **8/8** | 0.681 | 0.078 | 0.185 | 0.056 | 0.508 | 0.449 | 0.469 | 0.486 |
| base(main) | 161–320 | 7/8 | 0.682 | 0.078 | 0.182 | 0.058 | 0.483 | 0.432 | **0.397❌** | 0.454 |
| weaponModes | 1–160 | 7/8 | **0.670❌** | 0.083 | 0.192 | 0.055 | 0.504 | 0.450 | 0.469 | 0.495 |
| weaponModes | 161–320 | 7/8 | 0.680 | 0.078 | 0.183 | 0.059 | 0.483 | 0.428 | **0.434❌** | 0.456 |
| movementStyle | 1–160 | 7/8 | 0.683 | 0.082 | 0.185 | 0.050 | 0.486 | 0.442 | **0.438❌** | 0.466 |
| **style+weaponModes** | **1–160** | **8/8** | 0.689 | 0.080 | 0.185 | 0.047 | 0.488 | 0.443 | **0.463✅** | 0.462 |
| **style+weaponModes** | **161–320** | **8/8** | 0.684 | 0.079 | 0.190 | 0.047 | 0.487 | 0.445 | **0.456✅** | 0.460 |

허용: 전멸 0.714±0.04(≥0.674), 폭발 0.082±0.04, 해체 0.160±0.04(≤0.200), 시간초과 0.043±0.04,
공격 0.509±0.04, 오프닝 0.437±0.04, 피스톨 0.500±0.05(≥0.450), 풀v풀 0.500±0.05. (전체는 ±실제 CI도 본다.)

**style+weaponModes는 두 구간 모두 기존 8개 8/8을 통과하고 피스톨을 고친다**(1–160 0.469→0.463 유지,
161–320 0.397→0.456). 메커니즘: §1의 "움직이는 공격수" 과벌점을 Classic run-and-gun이 메우고(피스톨↑),
movementStyle이 올린 전멸(0.689/0.684)이 weaponModes가 깎던 전멸(단독 0.670)을 상쇄한다. 1–160은 15/15.

### 비핵심 에코 셀 (통합 전 B와 조율)
161–320 전체판정은 base 14/15 → style+weaponModes **12/15**. 악화 셀(비핵심, 기존 8개 아님):
`semi-v-eco 0.931→0.980`(목표 0.928, ≤0.968 밖), `full-v-eco 0.934→0.908`·`eco-v-full 0.077→0.097`
(둘 다 Ascent 소표본 "don't tune"). weaponModes가 에코에 샷건 run-and-gun을 주는 알려진 부작용 →
**세션 B(에코) 영역**. 1–160 에코 셀은 오히려 전부 통과(15/15).

### 기본값 플립 (적용됨, 2026-11-25)
```ts
// packages/match-runner/src/match.ts
this.weapons = loadWeapons({ modes: config.weaponModes !== false });   // 기본 ON
movementStyle: config.movementStyle ?? true,                           // BUY_PHASE_ONLY_STYLE → true
```
sim-batch: `--no-weapon-modes` 추가, `--style`/`--weapon-modes`는 이제 no-op(기본값), `--no-style` opt-out 유지.

## 7. 테스트 (기본값 플립 후, 통과)
루트 vitest 307(+4 todo) · match-runner 135 · round-simulator 165(1 skip) · combat 36 · economy 38 ·
perception 32 · career 106(1 skip) · data-validator pytest 65 · 루트+데스크톱 typecheck 통과 ·
데스크톱 test:engine 10(번들=소스 바이트 동일 확인) / test:unit 78 / test:matchday 58. e2e 미실행(통합 게이트).

### 기본값(플래그 없이) 1–160 재확인
(default_1 결과 채움 — style+weaponModes와 동일해야 함)

## 5. 남은 것 / 다음 한 걸음
1. **통합 단계(오케스트레이터 + 세션 B): style+weaponModes 기본 ON 결정.** §4 한 줄 패치 적용 → 두 구간
   8개 재게이트 + 전체 테스트(match-runner, round-simulator, combat, economy, 데스크톱 test:engine/matchday,
   e2e) 갱신. 에코 셀(§4) 악화를 B가 수용 가능한지 확인. 수용 가능하면 피스톨 P0-1 + movementStyle P0-4
   동시 해결. 아니면 에코 부작용을 줄이도록 weaponModes를 Classic+샷건 중 한쪽만으로 좁히는 실험(161–320
   에코는 샷건 run-and-gun 영향으로 보임 — 측정 필요).
2. 대안(에코 부작용 회피): 이동 사격 정확도를 **무기 카탈로그가 아니라 피스톨 라운드/Classic에만** 주는
   좁은 플래그. 단 §2에서 보듯 Classic은 에코에서도 쓰여 분리는 라운드 타입 조건이 필요(비원리적) — 권장 안 함.
3. 피스톨 게이트 목표 0.50은 대칭 가정치다. 실제 Ascent 오프닝 듀얼은 0.437(수비 우위)이라 대칭 장비
   라운드가 0.50 밑도는 건 현실적이다. 목표/허용 재검토는 데이터팀 몫(여기서 바꾸지 않음).
4. 역할별 바리어 셋업(공격수 출구 역할 그룹핑)은 미완(movement.md) — 오프닝 듀얼 재보정 필요, engine-truth 영역.

## 6. 측정 재현
```bash
# 피스톨 교전 자세 진단(라운드1 양방향, traceEngagements)
npx tsx tools/data-validator/scripts/pistol-engagements.mts --seeds 1..480
# 게이트(PYTHON은 jsonschema 있는 python3)
PYTHON=python3 npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --seed-start 1   --python python3 --out A.json --report A
PYTHON=python3 npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --seed-start 161 --python python3 --out B.json --report B
# 후보: --weapon-modes / --style / --style --weapon-modes
```
