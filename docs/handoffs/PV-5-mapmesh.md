# PROJECT V — TASK HANDOFF

**Agent:** PV-5 (Map Mesh) · **Branch:** `claude/pv-mapmesh` · **Date:** 2026-11-18

## 1. 작업 목표
사용자가 제공한 Ascent Blender 맵(README §10.1)을 실제로 **내려받아**, Blender
헤드리스로 **구조를 분석**하고, **충돌/보행 메시를 추출**하여 **NavMesh**를 만들고,
그 경로 길이를 PV-4 콜아웃 그래프의 직선거리 하한값과 **보정 비교**한다. PV-4가
막혔던 Google Drive 바이러스 검사 안내 페이지를 Playwright로 통과하는 것이 출발점.

## 2. 완료한 작업 (실제 검증한 것만)
- **Ascent `.blend` 다운로드 성공.** Playwright/Chromium으로 Drive 페이지를 열고
  바이러스 검사 안내의 "Download anyway"(confirm-token) 흐름을 통과.
  `Ascent (blender 4.2).blend`, **326,114,514 B**, SHA256
  `51e0b327393356c197687b075bd511e591fc08a207ed1059e0817d7482f2b5e2`,
  헤더 `BLENDER-v402` 확인. (우회가 아니라 정상 다운로드 버튼 흐름.)
- **나머지 10개 맵 접근성 확인** (다운로드 X, 페이지 제목만 읽음): 11개 모두 접근
  가능, 전부 Blender 4.2. (`docs/research/ascent-mesh.md` §2 표)
- **Blender 4.2.23 LTS 설치**(공식 tarball; apt에 패키지 없음) 후 **헤드리스 장면
  분석**: 9,931 오브젝트(메시 8,312 / 엠프티 1,619), 4.41M 버텍스, 3.32M 폴리곤,
  16 컬렉션, 481 재질. 단위는 METRIC이나 지오메트리는 Unreal 단위(1 BU = 1 uu).
  충돌 전용 컬렉션 없음 → 아트에서 생성.
- **충돌/보행 메시 추출**: Vista(스카이박스) 제외한 플레이 가능 지오메트리에서
  삼각형을 월드 공간으로 추출하고 바닥/벽/경사로 분류(바닥 410,858 / 벽
  1,111,794 / 경사 832,719). 바닥 전용 + 지면 밴드 + 잡동사니 제거 버전도 생성.
- **좌표 정합**: Blender(m) ↔ PV-4 게임(uu) 아핀 변환 적합. 잔차 **RMS 6.6 m /
  최대 9.1 m (구역 단위)**. 두 프레임은 **반사(reflection) + 약 90–100 uu/m**
  관계(Unreal 좌반경 ↔ Blender 우반경). 22개 콜아웃 전부 변환·스냅 검증.
- **NavMesh 생성**(recast-navigation-js 0.44.0): 지면 밴드 보행면에서 빌드,
  7 타일 / 66 폴리 / 147 버텍스, Detour로 export.
- **보정 비교 실행**(실측): NavMesh 경로 vs PV-4 직선거리.

## 3. 변경한 파일 (내가 소유한 경로만)
- `tools/map-mesh/download/` — Playwright 다운로더 + 접근성 프로브
- `tools/map-mesh/blender/` — inspect-scene / dump-names / extract-collision /
  landmark-centroids / floor-centroids (헤드리스 Blender)
- `tools/map-mesh/align/fit-transform.py` — numpy 변환 적합
- `tools/map-mesh/navmesh/` — build-navmesh.cjs / calibrate-paths.cjs (+package)
- `tools/map-mesh/README.md` — 파이프라인
- `datasets/spatial/ascent/mesh/` — `raw/`·`derived/`(둘 다 .gitignore),
  `download-provenance.json`, `ascent-extract-stats.json`,
  `ascent-ground-extract-stats.json`, `ascent-blender-to-game-transform.json`,
  `ascent-navmesh-stats.json`, `ascent-path-calibration.json`
- `docs/research/ascent-mesh.md`, `docs/handoffs/PV-5-mapmesh.md`
- **PV-4 소유 파일·README·Handoff·루트 설정은 수정하지 않음.**

## 4. 데이터 출처
- Ascent 원본: https://drive.google.com/open?id=1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB
- 좌표/콜아웃 기준: PV-4 `origin/claude/pv-spatial`
  (`datasets/spatial/ascent/coordinate-system.json`, `ascent.navgraph.json`) — 읽기 전용.
- Blender 4.2.23 LTS: https://download.blender.org/release/Blender4.2/
- recast-navigation-js 0.44.0 (npm).

## 5. 실행 방법
`tools/map-mesh/README.md`의 6단계. Blender는 `/opt/blender-4.2/blender`
(이 세션 한정; 컨테이너 재생성 시 tarball 재설치 필요). navmesh 도구는
`cd tools/map-mesh/navmesh && npm install` 후 실행. PV-4 navgraph는 읽기 전용으로
`git show origin/claude/pv-spatial:datasets/spatial/ascent/ascent.navgraph.json`.

## 6. 검증 방법
- 다운로드: 파일 크기·SHA256·Blender 헤더 바이트 확인.
- 장면: inspect-scene.py JSON 실측.
- 변환: 5개 앵커 최소제곱, 앵커별 잔차 출력.
- NavMesh: random-point 도달성으로 **최대 연결 성분 비율** 측정
  (full mesh ~7%, floor-only ~35%, ground-band ~27–39%).
- 보정: 콜아웃을 메인 성분에 스냅 후 경로/직선 비율.

## 7. 테스트 결과 (실제)
- 다운로드·접근성·장면·추출·변환: 성공(위 수치).
- **NavMesh: 부분 연결.** 메인 연결 성분이 맵 면적의 **~27%**. 메인 성분 근처(18 m
  이내)에 있는 콜아웃은 Mid 3개(mid-bottom/market/pizza)뿐. **PV-4 32개 엣지 중 2개만
  측정 가능**: mid-bottom→mid-market 경로 0.9 m(비율 1.01), mid-bottom→mid-link
  6.0 m(비율 0.76, 단 상대 rep 18 m로 신뢰 낮음). 나머지 30개는 조각난 성분에 걸쳐
  **측정 불가**(맵에 길이 없다는 뜻이 아니라 NavMesh 연결 한계).
- 미실행/과장 없음: 연결되지 않은 엣지를 측정했다고 보고하지 않음.

## 8. 현재 미완료 사항
- **완전 연결된 Ascent NavMesh.** 원본이 충돌 레이어 없는 아트 메시라 자동
  복셀화가 보행면을 조각낸다(멀티레벨, 계단=이산 스텝, 좁은 문, 장식물).
- 사이트/라인 구간(실제 벽 우회가 큰 곳)의 경로 보정.
- 콜아웃 단위 정밀 좌표 정합(현재 구역 단위 ~7 m).
- 나머지 10개 맵 처리(스크립트는 맵 ID만 바꾸면 동작).

## 9. 알려진 문제
- NavMesh 연결성 ~27%(위). 파라미터(cs/climb/radius/region/floor-only/zband/
  clutter) 광범위 스윕했으나 최대 ~39%가 한계.
- 좌표 변환은 **구역 단위**(RMS 6.6 m): 아트 중심점과 valorant-api 콜아웃 모두
  근사 구역 마커라서 콜아웃 단위 정밀도는 안 나옴.
- `ascent-path-calibration.json`에서 비율<1(예: 0.76)은 rep 거리 큰 콜아웃의
  아티팩트 — `repDist_*_m`로 표시해둠.

## 10. 설계 결정
- 다운로드는 confirm-token 폼(“Download anyway”)으로 — 정상 버튼 흐름.
- 입력 표면은 **지면 밴드 바닥 전용**(측정상 연결성 최고).
- Recast Y-up을 위해 Blender Z↔Y 스왑.
- 보정은 콜아웃을 **메인 연결 성분의 대표점**에 투영하고 `repDist`로 신뢰도 공개.
- 변환은 아핀(반사·이방성 흡수) 채택, 유사변환은 프레임 관계 확인용.

## 11. 라이선스 및 권한
- `.blend`는 **사용자 제공·Riot 맵 아트 포함, 재배포 라이선스 미확인**. 따라서
  원본/추출 지오메트리/NavMesh 바이너리는 **커밋 안 함**(`raw/`·`derived/`
  .gitignore). 수치 통계·변환·스크립트만 커밋(= “불명확하면 생성 스크립트만
  커밋” 규칙 준수). 스크립트 + 원본만 있으면 전부 재생성 가능.

## 12. 다음 권장 작업 (우선순위)
1. **깨끗한 충돌/블록아웃 메시 확보** → Recast 입력으로. 가능하면 VALORANT 자체
   blocking volume(이 export엔 없음). 없으면 지면 워터타이트 재구성.
2. 레벨 전환 ~십여 곳에 **Detour off-mesh connection**(계단/램프) 추가 + 문 보존
   단순화 → 완전 연결 달성 후 `calibrate-paths.cjs` 재실행.
3. 콜아웃 단위 정밀 앵커(명명 오브젝트 매칭)로 변환 RMS 축소.
4. 연결된 NavMesh에서 나온 `replacementProposal`을 PV-4에 제안(파일 직접 수정은
   오케스트레이터/PV-4가).

## 13. 작업 재개 지점
- 먼저 열 파일: `docs/research/ascent-mesh.md`(§6 라이선스, §7 NavMesh, §8 보정),
  `tools/map-mesh/README.md`.
- 먼저 실행: `.blend` 재다운로드(위 1단계) → Blender 재설치
  (`/opt/blender-4.2`가 없으면 tarball) → §3 추출 → §5 빌드 → §6 보정.
- 핵심 산출물: `datasets/spatial/ascent/mesh/ascent-path-calibration.json`,
  `ascent-blender-to-game-transform.json`, `ascent-navmesh-stats.json`.

**실제 테스트 여부:** 위 모든 수치는 이 환경에서 실제 실행한 결과. 연결되지 않은
엣지를 측정 성공으로 기록하지 않았다.

---
---

# 2차 작업 (Round 2) — 보행 연결 + 실측 시야 + 교체 제안

오케스트레이터 2차 지시(handoff §12 권고 1–3 + 시야)에 따른 작업. 같은 브랜치
`claude/pv-mapmesh`, 머지·PR·리베이스 없음.

## R2-1. 완료한 작업 (실측)
- **2.5D 보행 격자**(`tools/map-mesh/nav2d/build_grid.py`): 바닥 삼각형을 높이
  레이어별 occupancy grid로 래스터화, 이웃 셀을 계단 높이(step-tol) 내에서 연결.
  Recast(연결 성분 ~27%)를 대체. 결과(cs 1.2m, step-tol 3.0m): 최대 연결 성분
  **95%**, 콜아웃 **22/22**, PV-4 엣지 **32/32** 측정 가능. 우회 비율 중앙값
  1.21, 최대 2.19(벽이 강제하는 우회가 실제로 드러남: a-lobby→a-main 2.04 등).
- **Off-mesh 브리지 자동 탐지**(`offmesh_candidates.py`): 분리된 성분 사이 짧은
  계단/드롭 후보를 바닥 높이 불연속으로 생성. 1개 자동 후보(b-boathouse 구출,
  hGap 3.8m/vGap 1.2m)로 21/22→**22/22** 달성. 수작업 보정 파일
  `offmesh-manual.json`(provenance:manual) 제공(이번엔 불필요).
- **실측 시야**(`tools/map-mesh/los/los.py`): 벽 삼각형(927,089개)에 대해 눈높이
  레이캐스트(uniform-grid broadphase + 배치 Möller–Trumbore), 시드 K×K 샘플링.
  PV-4 수작업 sightline 11개 중 **4개 실측 corroborate**. ⚠️ 한계: 눈 위치가
  구역 단위 변환 오차(~7m)를 상속받아 **차단을 과대평가**(일부 PV-4 direct
  sightline이 0으로 — 배치 아티팩트, 반증 아님). 정밀 정합 필요.
- **PV-6 교차검증**(`align/validate_pv6.py`): PV-6 실측 3,001 샘플(전부
  defender-spawn). 원점 재생성 불가(.vrf/파서 바이너리 없음)라 커밋된 minimap
  bbox를 역투영→게임좌표→내 변환→Blender. 캡처 중심이 바닥에서 **2.9m**,
  defender-spawn에서 **6.8m**(~7m 오차 이내). **PASS** — 독립 리플레이 데이터와
  변환 자기일관성 확인.
- **교체 제안서**(`make_proposal.py` → `replacement-proposal.json`): PV-4 그래프
  엣지 32개(거리·시간, 신뢰도 medium 30/low 2) + sightline 11개(가시확률, low)
  의 교체값. 각 값에 근거·신뢰도. 집계 수치만, 지오메트리 없음. **PV-4 파일 미수정.**
- **테스트**: `nav2d/test_grid.py`(cluster_layers/build_adjacency/dijkstra/
  connected_components/is_bridge_candidate), `los/test_los.py`(ray hit·miss·
  short-segment/segment_cells/WallIndex) — 전부 통과.

## R2-2. 변경/추가 파일
- `tools/map-mesh/nav2d/`(build_grid.py, offmesh_candidates.py, test_grid.py)
- `tools/map-mesh/los/`(los.py, test_los.py)
- `tools/map-mesh/align/validate_pv6.py`, `tools/map-mesh/make_proposal.py`
- `tools/map-mesh/blender/extract-collision.py`(--walls-only 추가)
- `datasets/spatial/ascent/mesh/`: ascent-grid-calibration.json,
  ascent-los-matrix.json, offmesh-candidates.json, offmesh-manual.json,
  ascent-pv6-validation.json, replacement-proposal.json
- `docs/research/ascent-mesh.md` §9–§14
- 파생 바이너리(ascent_floor_all.bin, ascent_walls.bin)는 derived/ gitignore.

## R2-3. 실행 방법
`tools/map-mesh/README.md` 파이프라인에 이어서:
```
# floor(all heights)·walls 추출: extract-collision.py --floor-only / --walls-only
python3 -I tools/map-mesh/nav2d/build_grid.py --mesh ...floor_all.bin \
  --navgraph <PV-4> --transform ...transform.json \
  --out ...grid-calibration.json --cs 1.2 --step-tol 3.0 --full-matrix \
  --offmesh ...offmesh-candidates.json
python3 -I tools/map-mesh/nav2d/offmesh_candidates.py ... --radius 12 --max-gap 6 --min-comp 1
python3 -I tools/map-mesh/los/los.py --walls ...walls.bin --grid ...grid-calibration.json ...
python3 -I tools/map-mesh/align/validate_pv6.py ...
python3 -I tools/map-mesh/make_proposal.py ...
# tests:
python3 -I tools/map-mesh/nav2d/test_grid.py && python3 -I tools/map-mesh/los/test_los.py
```

## R2-4. 미완료 / 알려진 문제
- **시야 정밀도**: 구역 단위 변환(~7m)이 LoS를 과대차단. 콜아웃 단위 정밀 정합
  (명명 오브젝트 매칭) 후 재실행하면 신뢰도 상승. (handoff §12 권고 5, 시간상 미실시.)
- 격자 step-tol 3.0m은 일부 드롭/점프를 걷기로 간주 — 이동시간 상한에 영향.
  필요하면 방향성(내리막만 큰 tol) 엣지로 세분화 가능.
- Recast off-mesh 연결 API 직접 통합 대신 격자 브리지로 해결(격자가 우수).

## R2-5. 다음 권장 작업
1. 콜아웃 단위 정밀 정합 → LoS/경로 신뢰도 상향.
2. `replacement-proposal.json`을 PV-4 그래프에 반영(오케스트레이터/PV-4).
3. 나머지 10개 맵에 동일 파이프라인 적용.

---
---

# 3차 작업 (Round 3) — 동결(FROZEN)

사용자 지시로 main 머지를 위해 작업 동결. 3차(정밀 좌표 정합)는 **착수 직후 동결**되어,
완료·검증된 산출물만 남긴다. 2차까지의 파이프라인/결과(`c946796`)는 그대로 유효하며
테스트(nav2d 5 + los 5) 전부 통과 상태.

## R3 완료한 것 (검증됨)
- `tools/map-mesh/blender/dump-object-centroids.py`: Vista 제외 전체 메시
  오브젝트(6,736개)의 월드 중심·bbox·이름을 1회 덤프하는 유틸(정밀 정합 앵커
  선정을 Blender 재실행 없이 Python에서 반복하기 위함). 실행 확인 완료.

## R3 미완료 (TODO — 다음 에이전트)
1. **정밀 정합(목표 RMS ≤2m, 현재 6.6m):**
   - `dump-object-centroids.py` 출력에서 콜아웃별 명명 오브젝트(ABombsite/BSite/
     AtkTower/스파이크 사이트 박스/계단 등)를 valorant-api 콜아웃에 대응시켜
     앵커를 5개→더 많이 확장.
   - **PV-6 실측 앵커:** 원본 `.vrf` 점 단위 재생성은 이 환경에서 **불가**(.NET/mono
     미설치, 실제 .vrf·ValorantReplayParser 바이너리 없음; pv-replay엔 합성 픽스처만).
     대안으로 커밋된 캡처 minimap bbox 중심(게임좌표 (1882,-10389)) ↔ Blender
     defender-spawn 바닥을 앵커로 사용(이미 `ascent-pv6-validation.json`에서 2.9m
     바닥 적중 확인). 점 단위가 필요하면 .NET 가능한 환경에서 PV-6 파이프라인 실행.
   - reflection + 스케일(~90–100 uu/m) 고정 강체+스케일 변환 우선, 아핀은 비교용.
   - 달성 못하면 도달 RMS와 병목(콜아웃 좌표 자체의 근사성)을 기록.
2. **재계산:** 개선된 변환으로 grid-calibration·LoS 행렬·32간선 재계산, 이전과
   비교(특히 PV-4 sightline 11개 중 corroborate 수 변화). `replacement-proposal.json`
   갱신·신뢰도 재등급. **(현 동결 시점에선 마지막 유효본 유지.)**
3. **엔진용 경량 행렬:** 구역쌍 가시확률 행렬 + 구역간 실측 이동시간 행렬을
   제안서에 집계 수치로 추가, PV-4 `ascent.navgraph.json`의 sightlines·edges 필드 형식에 맞춤.
4. **(선택) 2순위 맵 Lotus**(PV-1 `NEXT_MAP_PREP.md`): 파이프라인 맵 파라미터화 +
   Lotus 다운로드·장면 분석까지만(엔진 반영 금지, DECISION-009).
