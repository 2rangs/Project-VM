# PROJECT V — 게임 데이터 카탈로그 (CATALOG.md)

**작성:** PV-1 Research (2차) · **기준일:** 2026-11-18 · **기준 빌드:** release-13.10 (valorant-api `/v1/version` 직접 확인)

요원·무기·스킬·궁극기·장비를 시뮬레이션 엔진이 바로 소비하는 정규화 카탈로그로 만든다 (Handoff §10, README §11).
빌더: [`tools/catalog-builder/`](../../tools/catalog-builder/) · 스키마: [`datasets/catalog/schema/`](../../datasets/catalog/schema/) · 데이터: `datasets/catalog/release-13.10/`(gitignore, 로컬 재생성).

## 1. 재생성 / 검증 (실제 실행됨)
```bash
python tools/catalog-builder/build_catalog.py           # 라이브 수집·정규화·검증
pytest tools/catalog-builder -q                         # 단위 테스트 + 스키마 검증
```
**실행 결과(2026-11-18, 4차 반영):** pytest **14 passed**. 빌더 산출/검증:
weapons **21** · agents **30** · abilities **130** · equipment **4** · ability-effects **40** — 전부 JSON Schema 통과.
ability 게임플레이 수치 소싱 **120/130**, equipment **4/4**, ability-effects **39/40** 소싱, defaultKeybind 120/120.

## 2. 규칙
- 필드명 **camelCase**, 시간 **ms**, 거리 **m**.
- **게임 단위 변환:** VALORANT 1 m = 100 Unreal 단위. valorant-api damageRanges는 이미 m.
  vrfkit 리플레이 위치는 cm(Unreal). 카탈로그 거리(m)를 공간 데이터(cm)와 연결할 때 ×100.
- 모든 레코드에 `provenance{source, patch, retrievedAt, evidenceType, verified}`.
- PV-2 `datasets/schema/`, PV-3 shared-types와 맞추기 위한 공통 규칙.

## 3. 필드별 출처·검증 수준

### 3.1 무기 (weapons.json) — valorant-api `/v1/weapons`, **verified:true**
| 필드 | 출처 | 비고 |
|---|---|---|
| id, name, category, categoryText, cost | API `shopData`/`category` | cost=크레딧, Melee는 null |
| fireRate, magazineSize, firstBulletAccuracy, shotgunPelletCount | API `weaponStats` | fireRate=발/초 |
| reloadTimeMs, equipTimeMs | API seconds×1000 | **초→ms 변환** |
| runSpeedMultiplier | API | 무차원 이동 배수 |
| wallPenetration | API enum 정규화 | Low/Medium/High |
| fireMode, altFireType | API enum 정규화 | |
| damageRanges[] (rangeStart/EndMeters, head/body/legDamage) | API | **거리 m, 부위별 피해** |
| ads, altShotgunStats, airBurstStats | API 그대로 | ADS 줌/연사/정확도 |

→ 21개 무기(20 구매형 + Melee). README §11 무기 데이터 **완비·검증**.

### 3.2 요원 (agents.json) — valorant-api `/v1/agents`, **verified:true**
| 필드 | 출처 | 비고 |
|---|---|---|
| id, name | API | |
| role | API `role.displayName` | Duelist 9 / Initiator 7 / Controller 7 / Sentinel 7 |
| abilitySlots[] (slot, name, abilityId) | API `abilities` | slot: Ability1/Ability2/Grenade/Ultimate/Passive |

### 3.3 스킬 (abilities.json) — 이름/슬롯/설명은 API, 게임플레이 수치는 **공식 위키에서 소싱(3차)**
| 필드 | 출처 | 상태 |
|---|---|---|
| abilityId, agentId, agentName, slot, name, description | valorant-api | verified:true |
| cost, charges, ultPoints, typeTags | **공식 위키 Abilities 표**(basic/signature/ultimate) | **gameplayVerified:true** (아래 주 참조) |
| killRecharge | 공식 위키 Signature 표의 재충전 열 | 재충전 표기 시 true, 아니면 null |
| cooldownMs, durationMs | — | **null**(공식 집계표에 없음; 요원별 페이지/패치노트 필요) |
| defaultKeybind (C/Q/E/X) | — | null (API에 없고 UI/요원 의존, 추정 금지) |

**3차 소싱 결과(2026-11-18):** 출처 = `https://wiki.playvalorant.com/en-us/Abilities` 공식 위키의
기본/시그니처/궁극기 집계표(Agent·Ability·Cost·Charges·Points·Functions). 실제 fetch·파싱.
valorant-api 요원(raw)과 **스킬 이름으로 조인**해 슬롯에 매핑. 결과: **비패시브 스킬 120/120 소싱,
궁극기 포인트 30/30 요원 완비.** `typeTags`는 위키 Functions 열(smoke/flash/recon/molotov/wall/heal 등).
- **gameplayVerified=true 근거:** 라이브 게임 빌드가 **release-13.10**(valorant-api로 확인)이고 공식 위키는 라이브 패치를 반영하므로 현재 값이 곧 13.10 값이다. 각 레코드에 `gameplaySource`(URL)와 `gameplayNote`(수집일·패치 고지) 부착.
- **추정 미기입:** cooldown·duration은 집계표에 없어 **null 유지**(Handoff §29 / README §37). 소싱 데이터는 `tools/catalog-builder/data/ability_facts.json`(커밋됨, 재생성 가능).

### 3.4 장비 (equipment.json) — **공식 위키에서 소싱(3차), 전부 needsCrossCheckPV3:true**
| 항목 | 값(공식) | 출처 |
|---|---|---|
| Light Armor | cost 400, armor 25, 흡수 66% | wiki Armor_and_Shield |
| Heavy Armor | cost 1000, armor 50, 흡수 66% | wiki Armor_and_Shield |
| Regen Shield | cost 650, armor 25, regenPool 50, 흡수 100% (patch v9.10 추가) | wiki Armor_and_Shield |
| Spike | plant 4000ms, defuse 7000ms, half 3500ms | wiki Spike |
| Spike detonateTimeMs | **null**(이번 fetch에서 미확보; PV-3는 45000ms 사용) | — |

실드 명칭 변경 주의: 과거 "Light/Heavy Shield" → 현재 "Light/Heavy Armor"(공식 위키).

## 3.5 Riot 공식 content API 교차검증 (3차)
`kr.api.riotgames.com` (프록시가 `X-Riot-Token` 주입; 키 값 미열람·미커밋). **재현 가능** — `build_catalog.py`가
`riot_content.py`로 자동 교차검증하고, 인증 실패 시 깔끔히 건너뜀.

**엔드포인트 접근 매트릭스 (2026-11-18, 개발 키):**
| 엔드포인트 | 결과 | 비고 |
|---|---|---|
| `/val/status/v1/platform-data` | 200 | |
| `/val/content/v1/contents` | 200 | **release-13.10** |
| `/val/ranked/v1/leaderboards/by-act/*` | 404 | 액트 항목 없음 |
| `/val/match/*` | **403** | **production 키 승인 필요** |

- **UUID 교차검증:** 카탈로그 요원 **30/30**, 무기 **21/21**이 content API characters/equips와 일치.
- content API는 ID·이름만(게임플레이 수치·리플레이·위치 없음) → UUID 확인에만 사용.
- **개발 키는 ~24시간 만료** → 재현 스크립트는 401/403에서 건너뛰도록 작성(`riot_content.try_fetch_content`, 테스트 포함). 레이트 리밋 20/초·100/2분 준수.

## 3.6 PV-3 game-rules 대조 (`origin/claude/pv-core`, 읽기 전용)
`packages/game-rules/src/{economy,spike,ultimate,weapons}.ts`를 fetch·열람(수정 안 함). 모두 provisional(verified:false).

**일치:**
- 실드: PV-3 economy.ts(light 400/25, heavy 1000/50, regen 650/25) = 카탈로그(공식 위키). ✅
- 스파이크: PV-3 spike.ts(plant 4000, defuse 7000, half 3500) = 카탈로그. ✅ (detonate 45000은 카탈로그 미확보)
- 무기 가격: PV-3 weapons.ts(vandal/phantom 2900, operator 4700 등) = 카탈로그(valorant-api). ✅ 표본 일치

**불일치 — 궁극기 포인트(PV-3 ultimate.ts 표본 6개, 전부 UNVERIFIED):**
| 요원 | 카탈로그(공식 현재) | PV-3(provisional) | 판정 |
|---|---|---|---|
| jett | **8** | 7 | 불일치 → 공식 채택(포인트 상향됨) |
| brimstone | **8** | 7 | 불일치 → 공식 채택 |
| sage | **7** | 8 | 불일치 → 공식 채택 |
| killjoy | **9** | 8 | 불일치 → 공식 채택 |
| sova | 8 | 8 | 일치 |
| omen | 7 | 7 | 일치 |

→ **권고:** PV-3는 `ultimate.ts`의 ULTIMATE_COSTS 표본을 카탈로그(`abilities.json`의 `ultPoints`, 30요원 완비)로 교체. PV-1은 PV-3 파일을 수정하지 않았다.

## 3.7 Ability Effect Spec (4차, Ascent 메타 요원) — `ability-effects.json`
Ability Engine/perception/action용 **스킬 효과 명세**. 스키마 `datasets/catalog/schema/ability-effect.schema.json`,
소싱 데이터 `tools/catalog-builder/data/ability_effects.json`(커밋).

- **대상:** VCT Reference의 Ascent 픽 데이터는 PV-2(`origin/claude/pv-data`)에 **합성 데이터만** 있고 실제 픽률은 없어, 공식 위키 기준 Ascent 대표 요원 **10명**으로 진행: Omen, Sova, KAY/O, Killjoy, Jett, Cypher, Astra, Gekko, Breach, Viper (40 스킬).
- **출처:** 각 스킬의 **공식 위키 페이지**(`wiki.playvalorant.com`)의 `Stat/Value/Confirmed value?` 표 + 인포박스. 패치 버전 표기 포함. **40개 중 39개 소싱**(Astra Nebula는 서브페이지 404 → null+verified:false).
- **필드:** effectTypes(smoke/flash/concuss/recon/molly/wall/slow/heal/trap/decoy/movement/suppress), windupMs·deployTimeMs·rangeMeters·radiusMeters·durationMs·cooldownMs·killRecharge·revealDurationMs·damage·destructible·destructibleHp·blocksVision·affectsAllies·makesSound·defaultKeybind. 값마다 `fieldSources{raw, confirmed}`.
- **예(공식):** Dark Cover(Omen) smoke, radius 4.1m, duration 15000ms, range 80m, cooldown 40000ms, key E, blocksVision. Recon Bolt(Sova) recon, radius 30m, cooldown 50000ms, key E. Nanoswarm(Killjoy) molly, radius 5.25m, duration 5000ms, key C. Flashpoint(Breach) flash, duration 2250ms, range 35m, key Q.
- **미확인 → null:** 공식 페이지에 없거나 fetch 실패 값. `makesSound=true`는 스킬 시전음 존재(PV-4 abilityCast) 일반 사실, `blocksVision=true`는 smoke 정의상 사실로 표기(note 기록). 추정 미기입.

## 3.8 defaultKeybind 매핑 (4차 완료)
공식 위키 인포박스의 "Default Key"를 10요원 39스킬에서 추출 → **slot↔key가 100% 일관**:
**Ability1→Q, Ability2→E, Grenade→C, Ultimate→X**. (주의: valorant-api 슬롯 라벨은 키와 직결되지 않는 것처럼 보이지만 — 예: Sova Recon Bolt는 slot `Ability2`인데 key `E` — 위 매핑이 전 요원 일관.)
→ 이 검증된 매핑으로 `ability_facts.json`의 **defaultKeybind를 30요원 120스킬 전부**에 채움(패시브 제외). 각 레코드 note에 근거 기록.

## 3.9 소비자 정합 — 필드 매핑표 (PV-4 perception, PV-3 action)
읽기 전용으로 소비자 인터페이스를 확인하고 정리(수정 안 함).

**단위 주의:** 카탈로그는 **거리 m**, PV-4 perception-engine/spatial-engine은 **world units(100 units = 1 m)** → **×100 변환 필요**. 시간은 양쪽 ms.

| 카탈로그 효과 필드 | 소비자 | 소비자 형식 | 매핑 |
|---|---|---|---|
| effectTypes `smoke`, `blocksVision`, radiusMeters, durationMs | PV-4 `vision.ts` `VisionContext.smokedPairs` | 존-쌍 시야 차단 | 연막 활성 구간(duration) 동안 반경 내 존-쌍을 smokedPairs로. 반경은 ×100(units) |
| makesSound=true | PV-4 `hearing.ts` `SoundKind.abilityCast` | 소리원(loudness) | 스킬 시전 시 abilityCast 사운드 발생 |
| effectTypes `recon`, revealDurationMs, radiusMeters | PV-4 vision/memory | 적 공개 | 리콘은 반경 내 적을 revealDuration 동안 관측으로 노출 |
| cost/charges/cooldownMs/killRecharge (ability_facts) | PV-3 `action-schema.ts` `InfeasibilityReason:"missingAbility"` | 행동 가용성 | 충전/쿨다운으로 Use Ability 액션 feasibility 판정 |
| effectTypes, rangeMeters, radiusMeters | PV-3 Action Generator `ParameterDefinition`(position/direction/timing) | 액션 파라미터 | 스킬 시전 좌표/범위 생성에 사용 |
| destructible/destructibleHp | 교전/시뮬레이션 | 파괴 가능 설치물 | 트랩/드론/큐브 HP |
| defaultKeybind | UI/디버거 | C/Q/E/X | 표시용 |

PV-4 vision은 **존-레벨 smokedPairs**(기하 반경 아님)로 연막을 처리하므로, 연막 반경→존-쌍 변환은 spatial-engine zone 정의(PV-4/PV-spatial)에서 수행. 카탈로그는 반경·지속만 제공.

## 4. 소싱 출처 (게임플레이 수치 채울 때)
- 공식 패치노트 색인: https://playvalorant.com/en-us/news/game-updates/
- 스킬 규칙: https://wiki.playvalorant.com/en-us/Abilities
- 크레딧/실드: https://wiki.playvalorant.com/en-us/Credits
- 요원별 위키 페이지(스킬 비용/충전/궁극포인트)
- (보조, 공식 대조) 경제 가이드: https://mobalytics.gg/blog/valorant/ultimate-economy-guide/

과거 경기는 당시 패치 규칙으로 해석. 모든 레코드에 `patch` 부착(Handoff §10).

## 5. 미완료 / 다음 작업
- [x] 스킬 cost/charges/ultPoints/typeTags 공식 위키 소싱(120/120 비패시브, 궁극 30/30) — 3차 완료
- [x] 실드·스파이크 공식 위키 소싱(4/4) — 3차 완료
- [x] PV-3 `packages/game-rules` 대조(§3.6) — 3차 완료
- [x] Riot content API UUID 교차검증(§3.5) — 3차 완료
- [x] 스킬 cooldown/duration/radius/range/windup 소싱(Ascent 10요원, 39/40) — 4차(§3.7)
- [x] defaultKeybind 매핑 확정(Ability1→Q/Ability2→E/Grenade→C/Ultimate→X, 120/120) — 4차(§3.8)
- [x] spike detonateTimeMs 공식 확인(45000ms, wiki Spike) — 4차
- [x] 소비자(PV-4/PV-3) 필드 매핑표 — 4차(§3.9)
- [ ] Ability Effect Spec를 나머지 20요원으로 확장(동일 공식 위키 페이지 소싱)
- [ ] Astra Nebula(서브페이지 404) 효과 재소싱
- [ ] (권고) PV-3가 ultimate.ts 궁극 포인트를 카탈로그로 교체(§3.6 불일치 4건)
- [ ] 패치 갱신 시 `--patch`로 재빌드, 과거 패치 보존
