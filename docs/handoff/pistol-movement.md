# Handoff — pistol & round movement (session A, PV-2 2차)

Branch `claude/pv2-pistol`. Scope: `packages/combat-engine`, `packages/round-simulator` (이동·교전),
`packages/team-engine/src/movement*`, 피스톨·이동 측정. HANDOFF P0-1(피스톨), P0-4(movementStyle).

> **결론 먼저:** 측정 결과 **기본값을 바꾸는 변경은 없다.** 피스톨 부진의 원인은 "엔진이 수비 각유지
> 우위를 올바르게 재현하는 것 + 표본 분산"이며, 국소 버그가 아니다. 후보 레버(`weaponModes`,
> `movementStyle`)는 둘 다 **두 구간 게이트를 통과하지 못해** 플래그 뒤에 OFF로 남긴다. 상수로 덮지 않았다.

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
- 보상 레버 후보는 `weaponModes`(움직이는 공격수의 run-and-gun 회복)뿐인데, 그건 전멸을 깬다(§2).
- **style + weaponModes** 조합 측정: (진행 중 — 결과 나오면 갱신). 이론상 스타일의 전멸 이득(0.683)이
  weaponModes의 전멸 손실(0.670)을 상쇄하고 run-and-gun이 피스톨 손실을 메울 수 있는지가 관건.

**현재 판정:** movementStyle 단독으로는 피스톨 손실로 게이트 미통과 → **플래그 뒤 OFF 유지.**

## 4. 두 구간 게이트 표 (실제 로스터, Ascent, 160경기/구간, 기존 8개)

main 기준선 = 현재 HEAD(엔진이 65180b9 이후 바뀌어 직접 측정). base = 변경 없음.

| 조건 | 구간 | 판정8 | 전멸 | 폭발 | 해체 | 시간초과 | 공격 | 오프닝 | 피스톨 | 풀v풀 |
|---|---|---|---|---|---|---|---|---|---|---|
| base(main) | 1–160 | **8/8** | 0.681 | 0.078 | 0.185 | 0.056 | 0.508 | 0.449 | 0.469 | 0.486 |
| base(main) | 161–320 | 7/8 | 0.682 | 0.078 | 0.182 | 0.058 | 0.483 | 0.432 | **0.397❌** | 0.454 |
| weaponModes | 1–160 | 7/8 | **0.670❌** | 0.083 | 0.192 | 0.055 | 0.504 | 0.450 | 0.469 | 0.495 |
| weaponModes | 161–320 | 7/8 | 0.680 | 0.078 | 0.183 | 0.059 | 0.483 | 0.428 | **0.434❌** | 0.456 |
| movementStyle | 1–160 | 7/8 | 0.683 | 0.082 | 0.185 | 0.050 | 0.486 | 0.442 | **0.438❌** | 0.466 |
| movementStyle | 161–320 | (진행 중) | | | | | | | | |
| style+weaponModes | 1–160 | (진행 중) | | | | | | | | |

허용: 전멸 0.714±0.04(≥0.674), 폭발 0.082±0.04, 해체 0.160±0.04(≤0.200), 시간초과 0.043±0.04,
공격 0.509±0.04, 오프닝 0.437±0.04, 피스톨 0.500±0.05(≥0.450), 풀v풀 0.500±0.05. (전체는 ±실제 CI도 본다.)

## 5. 남은 것 / 다음 한 걸음
1. 피스톨 자체를 0.45 이상으로 "고치는" 원리적 레버는 **combat-engine의 이동 사수 벌점 재보정**뿐인데,
   이는 오프닝 듀얼 보정(현재 목표 적중)을 흔들고 engine-truth 소유 영역이다. 함부로 건드리지 않음.
2. style+weaponModes 조합이 두 구간 8/8이면 그때 movementStyle + weaponModes를 함께 기본 ON 검토.
   아니면 둘 다 OFF 유지(현 상태).
3. 피스톨 게이트 목표 0.50은 대칭 가정치다. 실제 Ascent 오프닝 듀얼은 0.437(수비 우위)이라 대칭 장비
   라운드가 0.50 밑도는 건 현실적이다. 목표/허용 재검토는 데이터팀 몫(여기서 바꾸지 않음).

## 6. 측정 재현
```bash
# 피스톨 교전 자세 진단(라운드1 양방향, traceEngagements)
npx tsx tools/data-validator/scripts/pistol-engagements.mts --seeds 1..480
# 게이트(PYTHON은 jsonschema 있는 python3)
PYTHON=python3 npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --seed-start 1   --python python3 --out A.json --report A
PYTHON=python3 npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --seed-start 161 --python python3 --out B.json --report B
# 후보: --weapon-modes / --style / --style --weapon-modes
```
