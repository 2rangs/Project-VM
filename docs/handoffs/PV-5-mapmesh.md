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
