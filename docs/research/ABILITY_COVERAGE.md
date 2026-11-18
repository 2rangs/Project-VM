# PROJECT V — 스킬 커버리지 & 엔진 구현 필요 목록 (ABILITY_COVERAGE.md)

**작성:** PV-1 Research · **기준일:** 2026-11-18 · **대상:** Ascent 실측 픽률 상위 요원
**소유권 주의:** PV-4의 `ability-engine` **코드는 수정하지 않았다**(읽기 전용 참조). 이 문서는 데이터(`ability_effects.json`/`@pv/game-data`) 보강 결과와, 엔진에 필요한 **구현 목록**(권고)만 담는다.

---

## 0. 범위 — Ascent 상위 픽 요원 (실측)
`datasets/derived/comps/ascent-comps.json`(306 team-maps, patch≥9.x 국제전) 기준 픽률:

| 요원 | 역할 | 픽률 (95% CI) | 신호/궁 |
|---|---|---|---|
| **Sova** | Initiator | **0.814** (0.77–0.85) | Recon Bolt · Hunter's Fury |
| **Omen** | Controller | **0.722** (0.67–0.77) | Dark Cover · From the Shadows |
| **Jett** | Duelist | **0.699** (0.65–0.75) | Tailwind · Blade Storm |
| **KAY/O** | Initiator | **0.552** (0.50–0.61) | ZERO/point · NULL/cmd |
| **Killjoy** | Sentinel | **0.497** (0.44–0.55) | TURRET · Lockdown |

---

## 1. 데이터 보강 결과 (이번 패스)
파라미터는 **대부분 이미 채워져 있었다.** 공식 출처로 새로 보강한 값과, `effectTypes`가 빈 레코드의 처리:

| abilityId | 조치 | 출처 |
|---|---|---|
| `sova:Ultimate` (Hunter's Fury) | `params.damage = 80` 추가(블라스트 3발, 지형 관통), `fieldSources.damage` 기록. `effectTypes`는 **의도적으로 공란 유지** — PV-4에 데미지/빔 효과 유형 없음(§3 #5) | official-wiki `Hunter's_Fury` (Damage 80) |
| `jett:Ultimate` (Blade Storm) | `effectTypes` 공란 유지 — **무기 궁**(투척 단검)으로 `ability-engine`이 아닌 `combat-engine` 소관(§3 #9). 데이터 조작하지 않음 | 공식 — 무기형 궁 |

> **검증 원칙:** 출처로 확인되지 않는 값은 지어내지 않고 `null` + `verified` 유지. 빈 `effectTypes`는 "엔진에 해당 유형이 없음"을 뜻하며, 잘못된 유형으로 채우지 않았다.

---

## 2. 상위 요원 스킬 커버리지 (PV-4 `ability-engine` 모델 대비)
PV-4 모델(`packages/ability-engine/src/types.ts`): **정적 배치 효과**(origin/zone·radius·duration·hp·flashDurationMs·blocksVision·reveals 스냅샷). `EffectType` enum 12종(smoke·wall·flash·concuss·recon·molly·slow·heal·trap·decoy·movement·suppress).

범례: ✅**FULL**(엔진이 메커닉 처리) · 🟡**PARTIAL**(파라미터 존재, 근사만) · ⛔**UNSUPPORTED**(메커닉 미구현) · 🚫**OUT-OF-SCOPE**(다른 엔진 소관)

| 요원 | 슬롯 | 스킬 | effectTypes | 상태 | 비고 |
|---|---|---|---|---|---|
| Sova | A1 | Shock Bolt | molly | 🟡 | 존 생성은 되나 ActiveEffect에 데미지 필드 없음(§3 #6) |
| Sova | A2 | **Recon Bolt** | recon | ✅ | RevealSnapshot(스냅샷 공개) radius 30·reveal 750ms |
| Sova | G | Owl Drone | recon | ⛔ | **조종 가능 드론**(라이브 FOV·이동) → 정적 스냅샷으로만 근사(§3 #4) |
| Sova | **ULT** | **Hunter's Fury** | **[]** | ⛔ | 지형 관통 **빔 데미지 80×3** + reveal. 데미지/빔 유형 없음(§3 #5) |
| Omen | A1 | Paranoia | flash | ✅ | flashDurationMs로 처리(투사형 근시) |
| Omen | A2 | **Dark Cover** | smoke | ✅ | smoke+blocksVision, range 80·dur 15s |
| Omen | G | Shrouded Step | movement | ⛔ | **단거리 순간이동** → 변위 미처리(§3 #3) |
| Omen | **ULT** | **From the Shadows** | movement | ⛔ | **맵 전역 순간이동**(취소·공개 가능). 변위·텔레포트 목적지 미처리(§3 #3) |
| Jett | A1 | Updraft | movement | ⛔ | 수직 변위 미처리(§3 #2) |
| Jett | A2 | **Tailwind** | movement | ⛔ | **대시**(자기 변위) → enum만 존재, 소유자 이동 미적용(§3 #2) |
| Jett | G | Cloudburst | smoke | ✅ | 소형 즉시 연막 |
| Jett | **ULT** | **Blade Storm** | **[]** | 🚫 | **무기 궁**(투척 단검) → combat-engine(§3 #9) |
| KAY/O | G | FRAG/ment | molly | 🟡 | molly 존, 데미지 필드 없음(§3 #6) |
| KAY/O | A1 | FLASH/drive | flash | ✅ | flashDurationMs |
| KAY/O | A2 | **ZERO/point** | recon, **suppress** | ⛔ | recon은 처리, **스킬 봉인(suppress)** 메커닉 미구현(§3 #1) radius 15·8s |
| KAY/O | **ULT** | **NULL/cmd** | suppress | ⛔ | 광역 suppress 펄스 + **다운 부활**(§3 #8) + 파괴가능체 850hp(§3 #10) |
| Killjoy | G | Nanoswarm | molly | 🟡 | molly 존, 데미지 필드 없음(§3 #6) |
| Killjoy | A1 | ALARMBOT | slow, recon | 🟡 | slow는 처리, **근접 트리거 액티브 봇**은 정적 근사(§3 #4) |
| Killjoy | A2 | **TURRET** | recon | ⛔ | **사격 액티브 엔티티**(추적·발사) → 정적 recon 스냅샷으로만 근사(§3 #4) |
| Killjoy | **ULT** | **Lockdown** | suppress | ⛔ | **디텐션(detain)** — suppress와 구분(§3 #7) + 파괴가능체(§3 #10) windup 13s·radius 32.5 |

**요약(상위 5요원 20 슬롯):** FULL 5 · PARTIAL 4 · UNSUPPORTED 10 · OUT-OF-SCOPE 1.
연막·플래시·정적 recon·slow는 엔진이 완전 처리한다. **미지원의 핵심은 수치 누락이 아니라 "정적 배치 효과" 모델이 표현 못 하는 메커닉 유형들**이다.

---

## 3. 엔진 구현 필요 목록 (상위 10 — 픽률 가중)
각 항목: 필요한 **효과 유형**, **파라미터**(데이터는 이미 존재), **현재 PV-4 지원 여부**, 영향받는 상위 요원. PV-4 소유 영역이므로 **권고**다.

| # | 메커닉 (새 효과 유형) | 필요 파라미터(데이터 보유) | 현재 PV-4 | 영향 요원(픽률) | 비고 |
|---|---|---|---|---|---|
| **1** | **suppress = 스킬 봉인 상태** | radiusUnits, durationMs | enum만 존재, 적용 상태 없음 | KAY/O(.55) ZERO/point·NULL/cmd, Killjoy(.50) Lockdown | 반경 내 적에 `abilitiesDisabledUntilMs` 부여. **최다 영향** |
| **2** | **자기 변위(대시/부양)** | durationMs, (방향/거리) | `movement` enum만, 소유자 이동 미적용 | Jett(.70) Tailwind·Updraft, Omen(.72) Shrouded Step | 소유자 위치를 windup 후 이동. World 상태 변경 필요 |
| **3** | **텔레포트(목적지 지정)** | rangeUnits/global, durationMs(캐스트), 취소가능 | 미구현 | Omen(.72) From the Shadows·Shrouded Step | 목적지로 소유자 이동, 캐스트 중 공개/취소. #2의 특수형 |
| **4** | **액티브/조종 recon 엔티티** | radiusUnits(FOV), durationMs, hp | 정적 스냅샷만(라이브 재공개·발사 없음) | Sova(.81) Owl Drone, Killjoy(.50) TURRET·Alarmbot | 라이브 FOV 재공개 + (터렛) 발사 데미지 + 파괴가능 |
| **5** | **선형/빔 데미지(궁)** | damage=80, 3발, 관통, revealDurationMs=1000 | **effectTypes 공란** — 데미지 유형 없음 | Sova(.81) Hunter's Fury | 지형 관통 빔 데미지 + reveal. 신규 `damage/beam` 유형 |
| **6** | **molly 데미지 크기(DoT)** | damage-per-tick, durationMs | molly 존은 있으나 ActiveEffect에 데미지 필드 없음 | Sova Shock Bolt, KAY/O FRAG/ment, Killjoy Nanoswarm | 존 체류 시 틱 데미지. 값 소싱 필요(현재 null) |
| **7** | **detain(디텐션)** | radiusUnits, durationMs, destructibleHp | 미구현(suppress와 혼용 중) | Killjoy(.50) Lockdown | 반경 내 적 행동불능/강제. suppress와 별개 상태 |
| **8** | **다운/부활(downed state)** | reviveWindowMs, bodyHp | 미구현 | KAY/O(.55) NULL/cmd | 궁 중 사망 시 다운, 아군 안정화로 부활 |
| **9** | **무기 궁(장비 전환)** | 탄수, killRecharge, 데미지 | ability-engine 밖 | Jett(.70) Blade Storm | **combat-engine 소관** — 투척 단검 장비 |
| **10** | **파괴가능 배치체 HP** | destructibleHp(850 등) | `hp`는 wall 전용 | KAY/O NULL/cmd(850), Killjoy Lockdown·TURRET | 비-wall 배치체도 destructibleHp 노출·파괴 시 효과 취소 |

### 우선순위 해설
- **#1·#2·#3 (suppress·변위·텔레포트)**: 픽률 상위 3요원(Sova 제외 전부)의 신호/궁 핵심. enum은 있으나 **상태/World 변경이 없어** 현재는 "아무 일도 안 하는 스킬"로 처리됨 → 최우선.
- **#4 (액티브 엔티티)**: Sova(81%)·Killjoy(50%)의 정보 수집 핵심. 정적 스냅샷 근사는 "라이브 추적"을 못 해 정보전 모델의 정확도를 떨어뜨림.
- **#5·#6 (데미지)**: ActiveEffect에 **데미지 필드 자체가 없음**. 유틸 데미지(몰리·빔)는 라운드 경제/교전에 직접 영향 → combat-engine과 접점 설계 필요.
- **#7~#10**: 단일 요원 전용이지만 Sentinel/Duelist 메타 재현에 필요. #9는 엔진 경계(combat) 이슈.

---

## 4. 넘겨줄 때 (PV-4 / PV-3)
- **PV-4 Spatial**: 위 #1~#8, #10을 `ability-engine`에 구현(effectType dispatch + ActiveEffect/World 상태 확장). 데이터는 `@pv/game-data getAbilityEffects(slug)`로 이미 공급됨.
- **PV-3 Core / combat-engine**: #5·#6(유틸 데미지)와 #9(무기 궁)는 전투/경제 접점 — combat-engine과 공동 설계.
- **PV-1 (후속)**: #6 molly 데미지 수치는 현재 `null`(미소싱). 공식 per-ability 페이지에서 소싱 가능하면 보강 예정.

機械가독 요약: `datasets/derived/meta/ability-coverage.json`.
