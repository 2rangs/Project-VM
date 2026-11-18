# PROJECT V — 게임 데이터 카탈로그 (CATALOG.md)

**작성:** PV-1 Research (2차) · **기준일:** 2026-11-18 · **기준 빌드:** release-13.10 (valorant-api `/v1/version` 직접 확인)

요원·무기·스킬·궁극기·장비를 시뮬레이션 엔진이 바로 소비하는 정규화 카탈로그로 만든다 (Handoff §10, README §11).
빌더: [`tools/catalog-builder/`](../../tools/catalog-builder/) · 스키마: [`datasets/catalog/schema/`](../../datasets/catalog/schema/) · 데이터: `datasets/catalog/release-13.10/`(gitignore, 로컬 재생성).

## 1. 재생성 / 검증 (실제 실행됨)
```bash
python tools/catalog-builder/build_catalog.py           # 라이브 수집·정규화·검증
pytest tools/catalog-builder -q                         # 단위 테스트 + 스키마 검증
```
**실행 결과(2026-11-18):** pytest **9 passed**. 빌더 산출/검증:
weapons **21** · agents **30** · abilities **130** · equipment **4** — 전부 JSON Schema 통과.
ability 게임플레이 수치 검증 **0/130**(설계상 미소싱 null), equipment 검증 **0/4**.

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

### 3.3 스킬 (abilities.json) — 이름/슬롯/설명은 API(verified), 게임플레이 수치는 **미소싱 null**
| 필드 | 출처 | 상태 |
|---|---|---|
| abilityId, agentId, agentName, slot, name, description | valorant-api | **verified:true** |
| cost, charges, cooldownMs, killRecharge, ultPoints, durationMs, typeTags | 공식 패치노트/위키 | **null + gameplayVerified:false** (미소싱) |
| defaultKeybind (C/Q/E/X) | — | null (API에 없고 UI/요원 의존, 추정 금지) |

**중요:** valorant-api는 스킬의 비용·충전·쿨다운·궁극포인트·지속·타입을 제공하지 않는다.
이번 패스에서 이 값들을 **확인된 출처 없이 채우지 않았다**(Handoff §29 "AI 추정값을 사실로 저장" 금지, README §37).
`tools/catalog-builder/ability_facts.py`에 출처 URL과 함께 확인된 값만 추가하면 빌더가 자동 반영한다.

### 3.4 장비 (equipment.json) — 전부 **null + verified:false**
| 항목 | 필드 | 상태 |
|---|---|---|
| Light/Heavy/Regen Shield | cost, armor, regen | null+false (공식 위키 Credits에서 소싱 필요) |
| Spike | plantTimeMs, defuseTimeMs, defuseHalfMs, detonateTimeMs | null+false |

모든 장비 항목 `needsCrossCheckPV3:true` — 라운드·경제 수치는 **PV-3 `packages/game-rules`** 소관이라 겹치는 값은 여기서 사실로 작성하지 않고 대조 표시만 한다.

## 4. 소싱 출처 (게임플레이 수치 채울 때)
- 공식 패치노트 색인: https://playvalorant.com/en-us/news/game-updates/
- 스킬 규칙: https://wiki.playvalorant.com/en-us/Abilities
- 크레딧/실드: https://wiki.playvalorant.com/en-us/Credits
- 요원별 위키 페이지(스킬 비용/충전/궁극포인트)
- (보조, 공식 대조) 경제 가이드: https://mobalytics.gg/blog/valorant/ultimate-economy-guide/

과거 경기는 당시 패치 규칙으로 해석. 모든 레코드에 `patch` 부착(Handoff §10).

## 5. 미완료 / 다음 작업
- [ ] 스킬 게임플레이 수치(cost/charges/cooldown/ultPoints/duration/typeTags) 공식 소싱 → `ability_facts.py`
- [ ] 실드(Light/Heavy/Regen) cost/armor, 스파이크 timing 공식 소싱 → `equipment_facts.py`
- [ ] defaultKeybind(C/Q/E/X) 매핑 확정(요원별 UI 순서)
- [ ] PV-3 `packages/game-rules`와 장비·경제 수치 대조
- [ ] 패치 갱신 시 `--patch`로 재빌드, 과거 패치 보존
