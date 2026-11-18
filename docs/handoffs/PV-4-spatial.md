# PROJECT V — TASK HANDOFF

**Agent:** PV-4 Spatial → Agent Simulation
**Date:** 2026-11-18
**Branch:** `claude/pv-spatial`
**Map:** Ascent (per DECISION-009 — first and only implemented map)

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
- `vitest run` → **Test Files 3 passed, Tests 18 passed.**
  - 좌표 변환: 전 구역 [0,1] 매핑 + 왕복 복원(2건)
  - 경로: 존재/도달 가능(전 구역 도달), 동일 노드 0비용, 걷기>달리기 시간, **이동시간 단조 증가**, 미지 노드 throw
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

- 간선 거리는 **노드 중심 간 직선거리**라 실제 보행 경로보다 짧다(하한값). 일부 경로가
  기하적으로는 그럴듯하지만 전술적으로 어색할 수 있음(예: `a-site→b-site`가 defender-spawn 경유).
  → 실측 navmesh 확보 시 교체.
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

## 12. 다음 권장 작업 (우선순위)

1. **(P1)** Simulation 에이전트: 이 패키지의 `SpatialEngine`로 이동/경로/설치 판정 연결.
   입력은 `ascent.navgraph.json` + `coordinate-system.json`.
2. **(P1)** Google Drive Ascent `.blend` 실제 확보(confirm-token 흐름) → `tools/map-processor`에서
   Blender로 충돌 메시 추출 → 실측 navmesh로 그래프 거리/도달성 교체.
3. **(P2)** 실측 기반 Ray-cast 시야 + 연막 볼륨, 동적 문 상태를 경로/시야에 반영.
4. **(P2)** 설치 폴리곤을 실제 사이트 경계로 교체, 패치 버전 스탬프.
5. **(P3)** 타입을 `shared-types`로 이전(PV-3 모노레포 확정 후), 루트 `packages/*` glob 편입.

## 13. 작업 재개 지점

- 먼저 열 파일: `packages/spatial-engine/src/engine.ts`(공개 API),
  `datasets/spatial/ascent/ascent.navgraph.json`(데이터), `docs/research/spatial-sources.md`(소스 상태).
- 먼저 실행: `cd packages/spatial-engine && npm install && npm test` (18 통과 확인),
  이어서 `node tools/map-processor/build-ascent.mjs`로 데이터 재생성 재현.

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
