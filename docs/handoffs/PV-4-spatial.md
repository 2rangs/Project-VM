# PROJECT V — TASK HANDOFF

**Agent:** PV-4 Spatial → Agent Simulation
**Version:** v4 (2026-11-18) — adds ability-engine; supersedes v0–v3
**Branch:** `claude/pv-spatial`
**Map:** Ascent (per DECISION-009 — first and only implemented map)

> **v4 changelog (this update):** added `packages/ability-engine` (5차 작업) — abilities as
> live effect objects (smoke/wall/flash/concuss/recon/molly/slow/trap/decoy) bridged into
> spatial (LoS/path), perception (smoke/reveal) and combat (flash). Reveals are frozen
> snapshots (no leak). Availability API for PV-3 Constraint Validation. 13 tests passing.
> Additive change to spatial-engine: `PathOptions.blockedZones` (molly area denial) — spatial
> still 21 tests. Details in **§C. Ability Engine** below.
>
> **v3:** added `packages/combat-engine` (4차 작업) — deterministic
> timeline-based duel resolution from weapons/distance/info/skills; winner & TTK emergent
> (DECISION-002), OVR cannot beat an info deficit (README §29). 15 tests passing; `tsc`
> clean. Weapon values NOT committed (PV-1 LICENSE_AUDIT) — manual-approx fixture + local
> regen script instead. Details in **§B. Combat Engine** below.
>
> **v2:** added `packages/perception-engine` (3차) — Vision/Hearing/Memory/Communication →
> per-player/team Observations, enforcing the ground-truth boundary (DECISION-004). 17 tests.
> Details in **§A**. spatial-engine unchanged (21 tests).

> **v1 changelog (this update):**
> - Investigated real per-event player positions via vlr.gg 2D-replay logs. The data exists and is
>   reachable (Ascent game 283266: 193 events / 1,089 position samples), **but vlr.gg's ToS prohibits
>   automated access and redistribution** → not used; **no data or scraper committed**. See
>   `docs/research/spatial-sources.md` §3b. No `derived-real` values were produced.
> - Added a **spawn pass-through path constraint** (`transit: false` on spawn zones). This fixes the
>   v0 problem where `a-site → b-site` routed through `defender-spawn`; it now routes through mid.
> - Tests: **21 passing** (was 18); `tsc --noEmit` clean.
> - The model remains entirely `manual-approx` (node positions real from valorant-api).

---

## 1. 작업 목표

Ascent 전술 공간 모델 v0 + 독립 실행 가능한 `spatial-engine` 패키지를 만든다.
Handoff §24.3(좌표계 / NavMesh 대체 그래프 / 충돌·시야 / 이동 경로 API / 구역 정보 / 설치 가능 영역)를
Simulation 에이전트가 바로 소비할 수 있는 데이터 + API로 전달한다.

## 2. 완료한 작업 (실제 검증된 것만)

- **맵 소스 검증:** valorant-api.com/v1/maps 실제 호출(HTTP 200, 90KB 파싱). Ascent 좌표 변환값과
  실제 콜아웃 22개 좌표 확보. Google Drive Blender 맵은 **확보 실패**(바이러스 검사 인터스티셜) →
  `docs/research/spatial-sources.md`에 사실대로 기록.
- **좌표계 정의 + 검증:** 게임↔미니맵 변환(축 교환형). 22개 구역 전부 [0,1]에 들어옴을 스크립트로 확인,
  왕복 오차 ≈ 1e-12. (`tools/map-processor/verify-transform.mjs`)
- **Ascent 구역(callout) 그래프:** 22 노드 / 32 간선 / 2 설치 구역. 노드 좌표는 실제값,
  그래프·설치 폴리곤·시야·소리는 전부 `provenance: "manual-approx"`.
- **`packages/spatial-engine` (독립 TS 패키지):** A* 경로탐색, 최단 이동 시간, 구역 조회,
  설치 가능 판정, 시야(LoS) 질의, 소리 전파 근사 API.
- **테스트:** Vitest 18개 전부 통과. typecheck(`tsc --noEmit`) 통과.

## 3. 변경한 파일 (내 소유 범위만)

```
datasets/spatial/ascent/
  coordinate-system.json        # 게임↔미니맵 변환 + 단위 (valorant-api, verified)
  ascent.source.json            # 손으로 작성한 소스(노드/간선/설치/시야/소리)
  ascent.navgraph.json          # map-processor가 생성(간선 거리·시간 주입) — 엔진 입력
  valorant-api-ascent.raw.json  # 원본 API 응답 보존(provenance)
tools/map-processor/
  verify-transform.mjs          # 좌표 변환 검증(모든 콜아웃 [0,1])
  build-ascent.mjs              # source → navgraph 생성(유클리드 거리 + 이동시간)
packages/spatial-engine/
  package.json, tsconfig.json, vitest.config.ts
  src/{types,coordinate,geometry,pathfinding,engine,loader,index}.ts
  test/{fixture,coordinate,pathfinding,zones-plant-visibility}.test.ts
docs/research/spatial-sources.md
docs/handoffs/PV-4-spatial.md   # 이 문서
```

내가 수정하지 않은 것: 루트 package.json / tsconfig / pnpm-workspace / README.md / Handoff.md / 다른 패키지.

## 4. 데이터 출처

- **VERIFIED:** `https://valorant-api.com/v1/maps` (L2, 실제 응답 읽음). Ascent uuid
  `7eaecc1b-4337-bbf6-6ab9-04b8f06b3319`, 변환값 xMul `0.00007` / yMul `-0.00007` /
  xAdd `0.813895` / yAdd `0.573242`, 콜아웃 22개.
- **NOT OBTAINED:** Google Drive Blender 맵(인터스티셜), 맵 참고 GitHub 3개(이 세션 GitHub 범위 밖, 403).
  세부 내용은 `docs/research/spatial-sources.md`.

## 5. 실행 방법

```bash
# 데이터 재생성 (루트에서)
node tools/map-processor/verify-transform.mjs   # 변환 검증
node tools/map-processor/build-ascent.mjs        # ascent.navgraph.json 생성

# 패키지 단독 실행 (루트 설정에 의존하지 않음)
cd packages/spatial-engine
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## 6. 검증 방법 / 7. 테스트 결과 (실제 실행함)

- `verify-transform.mjs` → `PASS: all zones within [0,1]`, 왕복 오차 9.095e-13.
- `build-ascent.mjs` → zones 22 / edges 32 / plantZones 2, 총 간선 길이 952.2 m.
- `vitest run` → **Test Files 3 passed, Tests 21 passed.**
  - 좌표 변환: 전 구역 [0,1] 매핑 + 왕복 복원(2건)
  - 경로: 존재/도달 가능(전 구역 도달), 동일 노드 0비용, 걷기>달리기 시간, **이동시간 단조 증가**, 미지 노드 throw
  - **(v1) spawn 통과 금지**: 기본 경로가 defender/attacker-spawn을 경유하지 않음, 옵트인 시에만 허용, spawn은 출발/도착점으로는 허용
  - 구역/설치/시야/소리: 타입별 조회, nearestZone, `isPlantableZone`, 폴리곤 내부/외부 판정, LoS 대칭·연막 차단, 소리 감쇠
- 실제 경로 예시(달리기, 직선근사):
  - `attacker-spawn → a-site` 93.7 m / 13.9 s, `[spawn > a-lobby > a-main > a-site]`
  - `attacker-spawn → b-site` 83.4 m / 12.4 s
  - `a-site → b-site` 108.8 m / 16.1 s

## 8. 현재 미완료 사항

- 실측 **충돌 메시 / NavMesh 없음** (Blender 맵 미확보). 이동 가능 바닥, 벽 충돌, 고저차,
  계단, 점프, Ray Casting 기반 정밀 시야는 미구현 — 현재는 콜아웃 그래프 근사.
- 패치 버전 미확인(`patchVersion: UNVERIFIED`).
- 설치 폴리곤은 사각형 근사(실제 사이트 경계 아님).
- 연막/문 상태의 동적 시야·경로 반영은 입력 파라미터로만 존재(동적 장애물 엔진 미구현).

## 9. 알려진 문제

- 간선 거리는 **노드 중심 간 직선거리**라 실제 보행 경로보다 짧다(하한값). → 실측 navmesh 확보 시 교체.
- ~~`a-site→b-site`가 defender-spawn 경유~~ → **v1에서 수정**(spawn `transit:false`). 이제 mid 경유
  `a-site > a-garden > mid-cubby > mid-bottom > mid-market > b-site`로 라우팅.
- 실측 위치 데이터 미반영: 이동 시간/구역 경계가 실제 경기로 보정되지 않음(vlr ToS 제약, §11 참고).
- `pointInPolygon`은 모서리 위 점 처리를 보장하지 않음(경계 민감 로직에 의존 금지).

## 10. 설계 결정

- **좌표 변환은 축 교환형**으로 확정(경험적 검증: 그 방향만 전 콜아웃이 [0,1]). 근거를 코드/문서에 남김.
- **엔진 코어는 파일시스템 비의존**(브라우저/Worker에서 사전 로드 데이터로 동작). FS 로더는 `loader.ts`로 분리.
- **단일 진실원천:** 사람이 쓰는 `ascent.source.json` → 도구가 거리/시간 주입한 `ascent.navgraph.json`.
  엔진은 navgraph만 소비.
- **타입은 로컬**(`src/types.ts`)에 두고 "shared-types 이전 후보" 주석 표기. 루트 모노레포(PV-3)에
  합쳐질 때 이동 예정. 지금 교차 패키지 import 하지 않음.
- A* 휴리스틱은 목표까지 직선 이동시간(간선이 직선거리이므로 admissible).

## 11. 라이선스 및 권한

- valorant-api 데이터는 Riot 게임 파일 파생. 상업적/재배포 조건 **UNVERIFIED** — 배포 전 확인 필요.
- Blender 맵은 사용자 제공 자료이나 원 저작권·배포 조건 미확인.
- **vlr.gg (중요):** 2D 리플레이 위치 데이터는 실재·접근 가능하나 **ToS가 자동 접근(봇/스크립트)과
  재배포를 금지**(개인·비상업 용도 한정). 따라서 vlr 데이터와 수집 스크립트 **모두 커밋하지 않음**.
  실측 위치가 필요하면 VCT Reference(자체 약관 확인), Riot/GRID 공식 피드(키 필요), 또는 자가 캡처
  VRF 리플레이(vrfkit) 같은 **허가된 소스**를 사용할 것.

## 12. 다음 권장 작업 (우선순위)

1. **(P1)** Simulation 에이전트: 이 패키지의 `SpatialEngine`로 이동/경로/설치 판정 연결.
   입력은 `ascent.navgraph.json` + `coordinate-system.json`.
2. **(P1)** 실측 위치는 **허가된 소스로만**: VCT Reference DuckDB 약관 확인(PV-2 협업), 안 되면
   Riot/GRID 공식 피드(키) 또는 자가 캡처 VRF. vlr.gg는 ToS상 사용 금지 — 재시도 금지.
3. **(P1)** Google Drive Ascent `.blend` 실제 확보(confirm-token 흐름) → `tools/map-processor`에서
   Blender로 충돌 메시 추출 → 실측 navmesh로 그래프 거리/도달성 교체.
3. **(P2)** 실측 기반 Ray-cast 시야 + 연막 볼륨, 동적 문 상태를 경로/시야에 반영.
4. **(P2)** 설치 폴리곤을 실제 사이트 경계로 교체, 패치 버전 스탬프.
5. **(P3)** 타입을 `shared-types`로 이전(PV-3 모노레포 확정 후), 루트 `packages/*` glob 편입.

## 13. 작업 재개 지점

- 먼저 열 파일: `packages/spatial-engine/src/engine.ts`(공개 API),
  `datasets/spatial/ascent/ascent.navgraph.json`(데이터), `docs/research/spatial-sources.md`(소스 상태).
- 먼저 실행: `cd packages/spatial-engine && npm install && npm test` (21 통과 확인),
  이어서 `node tools/map-processor/build-ascent.mjs`로 데이터 재생성 재현.

---

## §A. Perception Engine (3차 작업, `packages/perception-engine`)

**목표 (Handoff §12.3, §17 Perception, DECISION-004):** 전지적 `WorldState`에서 선수별·팀별
**Observation**을 생성하되, AI가 보거나 듣지 못한 적의 실제 위치를 알 수 없게 하는 경계를 타입 수준에서 강제.

**PV-3(`claude/pv-core`)와의 정합 — 실제로 fetch해서 확인함(읽기 전용):**
- `@pv/shared-types`에 `ObservationState`, `ObservedEnemy`, `SoundObservation`, `TeamReport`,
  `WorldState`, `PlayerState`, branded id, `Vector3` 등이 이미 정의됨. 이 shapes를 `src/shared-mirror.ts`에
  **필드 단위로 그대로 미러링**(다른 브랜치라 패키지 의존 불가). 모노레포 통합 시 이 파일 삭제하고
  `@pv/shared-types` import로 교체하면 drop-in.
- PV-3 `@pv/world-state`의 `observeWorld(world, id, { oracle })`가 받는 `VisibilityOracle`은
  주석에 **"to be implemented by the spatial-engine (PV-4)"**라고 명시됨. 이걸 `SpatialPerceptionOracle`로
  구현 → `engine.visibilityOracle`를 그대로 넘기면 됨.

**구성 (`packages/perception-engine/src/`):**
- `vision.ts` — FOV 콘 + 시야거리 + 구역 sightline(+연막 차단), 결정적. sightline 없으면 비가시(fail-safe).
- `hearing.ts` — 달리기 발소리(걷기=무음), 총성, 스킬, 스파이크 설치·해체를 spatial `audibleZones`로 전파.
  위치는 **소스 구역 중심(구역 단위)** + confidence로만 남김(정확 좌표 금지).
- `memory.ts` — 마지막 목격 정보가 half-life 신뢰도 감쇠, 임계 미만 시 망각.
- `communication.ts` — 팀원 콜아웃이 comms 지연 후 팀 관측으로 전파, 사망 선수 마지막 정보 유지(옵션).
- `oracle.ts` — PV-3 `VisibilityOracle` 구현 + 연막 smokedPairs 유도.
- `engine.ts` — `PerceptionEngine`(틱 단위 stateful): `perceive(world)→{players,teams}`, `observe(world,id)`.
- `params.ts` — FOV/청취/감쇠/지연 등 **모든 튜닝값을 한 곳에**, 전부 `manual-approx`. 출처 있는 값 없음.
- `rng.ts` — mulberry32 시드 RNG(확률적 발견 주입용, 기본은 비사용 → 완전 결정적).
- 출력: `PlayerObservation`(= shared-types `ObservationState`), `TeamObservation`(로컬, shared-types 이전 후보).

**전지적 정보 누출 차단:** `perceive/observe`는 Observation만 반환, `WorldState`(players/events/live position)
통과 경로 없음 — 타입으로 불가능하게 만들고 `test/leak.test.ts`로 검증(미관측 적의 실제 좌표가 직렬화 결과에
없음, 이동 후에도 lastSeenPosition만 남음).

**테스트 (실제 실행, 17개 통과 / `tsc --noEmit` 통과):**
- vision(4): sightline+FOV+거리 충족 시 가시 / LoS 없으면 비가시 / FOV 밖(등 뒤) 비가시 / 연막 차단.
- hearing(3): 달리는 적 들림·걷는 적 안 들림 / 걷기·정지 무음 / 총성 인접 구역 전파 + 구역 중심 로컬화.
- memory(2): `confidenceForAge` 단조 감소(half-life에서 0.5) / 목격→기억→망각, lastSeenPosition 유지.
- leak(3): Observation 키만 존재(players/events 등 없음) / 미관측 적 좌표 비노출 / 이동 후 live 위치 비노출.
- determinism(3): 기본 완전 결정적 / 동일 시드+입력 → 동일 출력(확률 발견 on) / missProb>0인데 rng 없으면 throw.
- communication(2): 콜아웃이 지연 후 전파 / 팀 적 그림 dedup.

**실행:** `cd packages/perception-engine && npm install && npm test` (spatial-engine는 `file:` 링크).

**미완료/주의:** 모든 수치 `manual-approx`(실측 보정 전). 시야는 구역 단위 LoS(정밀 ray-cast 아님).
연막 판정은 구역 incident smokeable sightline 차단(볼륨 교차 아님). `knownMapChanges`는 v0에서 빈 배열.

---

## §B. Combat Engine (4차 작업, `packages/combat-engine`)

**목표 (Handoff §14.4, README §23, §29 "OVR만으로 교전 결정 금지", DECISION-002):** 두 선수 교전을
**물리·정보 요소로** 결정론적으로 해결. 승자/TTK를 미리 정하지 않고, 입력 상태에서 사건(사격→명중→피해→사망)을
시간순으로 생성.

**설계:**
- `engine.ts` `resolveDuel(duel, seed)` — 반응 지연(pre-aim≈즉시, 플래시=긴 지연) 후 연사력 간격으로 사격,
  탄창 소진 시 장전. 매 사격: 명중 판정(`hitChance`) → 부위(`headshotChance`) → 거리밴드 피해 → 실드/체력 적용.
  시드 RNG 스트림을 **선수별로 분리**(한쪽 롤 변화가 다른쪽에 영향 안 줌). 출력: `shot/hit/damage/kill/reload`
  이벤트 로그 + 남은 체력·탄약·명중수, winner/TTK(둘 다 생존이면 null).
- `damage.ts` — 거리밴드 피해 + 실드 1:1 흡수(Operator 몸샷 150이 풀중실드 100+50=150 관통 1킬).
- `skills.ts` — README §23.1 Mechanical 능력치(aim/reaction/crosshair/firstBullet/tracking/movement/weaponControl)를
  반응시간·명중·헤드샷 확률로 매핑.
- `montecarlo.ts` — N회 시드 교전 승률.
- `params.ts` — 모든 튜닝값 `manual-approx` 집약. `CombatCalibration`은 PV-2 실측 VCT 통계(첫킬 승률 등)로
  보정할 **인터페이스 자리**(엔진 수정 없이 승률 스케일 주입).

**무기 데이터 / 라이선스 (중요):** PV-1 `docs/LICENSE_AUDIT.md` 판단 = valorant-api 라이선스 불명확 →
Riot 파생 카탈로그 **값은 커밋 안 함**(스키마·픽스처만). 따라서:
- 커밋: `test/fixtures/weapons.manual-approx.json` — 공개 게임 규칙의 **수작업 근사치**(Vandal/Phantom/
  Operator/Sheriff/Spectre/Classic), `manual-approx` 표기. 테스트는 이것만 사용(오프라인·결정적·라이선스 안전).
- 미커밋(gitignore): `npm run fetch-weapons` → `test/fixtures/weapons.real.generated.json`(valorant-api 정확값
  로컬 재생성). PV-1 `tools/catalog-builder`(release-13.10)로도 재생성 가능.
- 이 세션에서 실제 valorant-api 값은 픽스처 보정용으로만 참조(커밋 안 함).

**테스트 (실제 실행, 15개 통과 / `tsc` 통과). 실측 승률 마진:**
- pre-aim 우위: winRateA **0.82** (>0.6) — 같은 조건이면 선피킹/선관측이 유리.
- 원거리(42m) 라이플>SMG: Vandal winRate **0.91**.
- 근거리(8m) SMG 경쟁력: Vandal winRate **0.52**(지배당하지 않음).
- Operator 몸샷 1킬: 실드 50/25/0 전부 즉사(damage 테스트).
- 플래시 지연: 피격측 선사격 불가 → winRateA **0.00**.
- 결정론: 동일 시드+입력 → 동일 이벤트 로그(단일·몬테카를로 모두).
- 정보 우위 > OVR: 능력치 0.4+pre-aim 이 능력치 0.95+지연 상대에게 승률 >0.5 → OVR 결정론 금지 확인.

**실행:** `cd packages/combat-engine && npm install && npm test`. (런타임 의존성 없음 — 완전 독립.)

**미완료/주의:** 전부 `manual-approx`. 1v1 중심(다대다 트레이드/크로스파이어 미구현). 엄폐·높이우위는 구역 근사
파라미터(`behindCover`)로만. 스킬→확률 매핑은 PV-2 실측으로 보정 필요(`CombatCalibration` 사용).

---

## §C. Ability Engine (5차 작업, `packages/ability-engine`)

**목표 (Handoff §14.1·14.2, README §11.2, P2):** 스킬 사용을 월드 효과 객체로 남기고, 그 효과가
spatial·perception·combat 엔진에 실제로 반영되게 함.

**PV-1 정합 (claude/pv-research fetch, 읽기만):** `ability-effect.schema.json`은 **아직 미published**.
`ability.schema.json` + `tools/catalog-builder/data/ability_facts.json`의 `abilityId`(`<agent>:<slot>`)·
`slot`·`gameplay.typeTags`(smoke|flash|recon|molly|wall|concuss…) 어휘를 따라 **로컬 효과 스키마**를 정의.
PV-1 런타임 스펙 published 시 맞출 필드(아래) handoff에 기록.

**효과 유형별 런타임 (`AbilityEngine`, 증가하는 ms 클럭):**
- smoke / wall — 구역 LoS 차단(wall은 파괴 가능 HP). perception에 주입.
- flash / concuss — 대상 블라인드 ms 기록 → combat posture.flashBlindMs 입력.
- recon / trap — 범위 내 적 **공개 시점 스냅샷**(freeze)만 저장 → 이후 이동 미반영(누출 금지).
- molly / slow — 구역 area-denial → spatial `blockedZones`.
- decoy — 페이크용 가짜 정보(효과 객체로만, v0은 상태 보유).
- 이벤트: `effectStart/effectExpire/effectDestroyed/flashApplied/reveal/trapTriggered`.

**연동 어댑터 (`adapters.ts`):**
- `toPerceptionAbilityStates` + `visionBlockerIsSmoke` → perception `SpatialPerceptionOracle({isSmoke})`.
- `combatFlashBlindMs(engine, playerId, nowMs)` → combat `EngagePosture.flashBlindMs`.
- `revealedEnemies(engine)` → 팀 관측용 frozen `RevealSnapshot[]`(위치 고정).
- `deniedZoneIds(engine)` → spatial `PathOptions.blockedZones`.

**사용 가능 여부 API (PV-3 Action Generator Constraint Validation용):**
`checkAvailability(catalog, loadoutEntry, nowMs, ult?)` → `{usable, reason}`(no-charges / on-cooldown /
ult-not-ready / unknown-ability / ok, +cooldownRemainingMs). PV-3가 후보 제외 사유로 사용.

**spatial-engine 변경(내 소유, additive):** `PathOptions.blockedZones` 추가(중간 경유 불가, 출발/도착은 허용).
기존 21개 테스트 그대로 통과.

**테스트 (실제 실행, 13개 통과 / `tsc` 통과):**
- smoke: 연막 뒤 적 비가시 → 만료 후 다시 가시(perception 연동).
- flash: 플래시 피격측 combat 승률 0.25 미만(몬테카를로 고정시드) + 블라인드 시간 감쇠.
- recon: 공개 적이 팀 관측에 들어오나 **공개 이후 이동 미반영**(frozen, 좌표 누출 없음) + 만료 후 사라짐.
- molly: denied 구역 우회 경로(비용 증가, 해당 구역 미경유) + 만료 후 해제.
- wall: 부분 피해 생존 → HP 초과 피해 시 파괴 이벤트 + 시야 차단 해제.
- availability: 충전/쿨다운/궁극기 포인트/미지 스킬.
- determinism: 동일 스크립트 → 동일 이벤트·공개.

**실행:** `cd packages/ability-engine && npm install && npm test` (spatial/perception/combat `file:` 링크).

**PV-1 효과 명세 정합 — 완료 (6차-A, PV-1 `6759b5c`):** PV-1 `ability-effect.schema.json`이 published되어
정합 완료. `src/catalog-adapter.ts`의 `abilitySpecFromCatalog(rec, facts)`가 PV-1 카탈로그 레코드
(effectTypes[] + params{}, **거리 m**)를 런타임 `AbilitySpec`(**world units**)으로 변환 — **m→units ×100 변환은
이 한 곳에서만**(`UNITS_PER_METER=100`). 필드 매핑: `radiusMeters→radiusUnits`, `rangeMeters→rangeUnits`,
`destructibleHp→wallHp`, `blocksVision`(perception smokedPairs 구동), `makesSound`(perception abilityCast),
`revealDurationMs`(recon), effectTypes[]는 우선순위로 primary `effectType` 도출. 커밋 fixture는 PV-1 카탈로그
shape(m)으로 재구성 후 normalizer 경유 로드. 미소싱 수치는 null 유지(임의 생성 금지). catalog-adapter 테스트 5개 추가.

**남은 정합(미완):** 다중 효과(effectTypes 2개 이상, 예: slow+smoke)는 primary 하나만 런타임 반영(나머지는 메타로 보존).
`makesSound→perception abilityCast` 소리 주입 경로와 `decoy` 가짜정보 주입은 round-simulator 연동 단계에서.

---

## 부록 — §24.3 전달 산출물 요약 (Agent Spatial → Agent Simulation)

| §24.3 항목 | 전달물 | 비고 |
|---|---|---|
| 맵 좌표계 | `coordinate-system.json`, `MapCoordinateSystem.toMinimap/toGame` | valorant-api, verified |
| NavMesh | **대체 그래프**(콜아웃 22노드/32간선) `ascent.navgraph.json` | 실측 navmesh 아님(manual-approx) |
| 충돌 정보 | 없음(그래프 도달성으로 대체) | Blender 맵 확보 시 추가 |
| 시야 판정 | `SpatialEngine.hasLineOfSight`, `visibleZonesFrom`, `sightlines` | manual-approx, 연막 파라미터 지원 |
| 이동 경로 API | `findPath(from,to,mode)`, `shortestTravelTimeMs`, `isReachable` | A*, run/walk 이동시간 |
| 구역 정보 | `getZone`, `zonesByType`, `nearestZone`, `zones` | zoneType/plantable/좌표 |
| 설치 가능 영역 | `isPlantableZone`, `isPointPlantable`, `plantZoneAt`, `plantZones` | 폴리곤 근사 |
| (추가) 소리 전파 | `audibleZones(origin, threshold)` | 감쇠 BFS, manual-approx |
