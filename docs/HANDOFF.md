# PROJECT V — HANDOFF (2026-11-23, 작업 일시 정지 시점)

> 이 문서가 **현재 상태의 정본**이다. 이전 판(2026-11-18, PV-1 작성)은 git 이력에 있다.
> 만든 과정은 `docs/DEVELOPMENT_PROCESS.md`, 머지별 수치는 `docs/WORK_HISTORY.md`,
> 독립 진단은 `docs/research/STATUS_AUDIT_2026-11-23.md`(근거 수준 표기 포함)를 본다.
> 세션별 상세 인계: `docs/handoff/career-shell.md`, `club-ops.md`, `matchday-uiux.md`, 그리고
> 브랜치에만 있는 맵 전술 작업(아래 §4).

---

## 1. 한눈에

| 영역 | 상태 | 한 줄 |
|---|---|---|
| 라운드·경기·시리즈 엔진 | 작동, 검증 조건 문제 있음 | 공식으로 결과를 내는 엔진. **검증은 실제 로스터로 6/8**(§3) |
| 이동·내비게이션 | 작동(Ascent) | 실제 맵 경로 위 연속 이동, 벽 통과 없음. 다른 맵은 옵트인·불안정 |
| 시야 | 혼재 | Ascent는 위치 기반, 10개 맵은 표만 있음. 스모크·설치·플래시 LOS는 구역 단위 |
| 스킬 | 기본 OFF | 켜면 공격 과다(0.695, 미러 조건 측정) |
| 커리어(FM식) | 1차 구현 | 시작 메뉴·새 커리어·홈·계속·일정·순위·받은메일·저장, 생성 선수·스태프 |
| 구단 운영 | 1차 구현, **커리어와 미연결** | 계약·재정·이적·훈련 화면과 모델. 커리어 달력 훅에 아직 안 붙음 |
| 경기 화면 | 작동 | 전술 맵·팀 캠(3D), 라운드 전체 재생, 로딩 화면. 일부 미확인 |
| 출시 가능성 | 불가 | IP·자산 라이선스 미해결(§6) |

## 2. 실행 방법

```bash
nvm use 22.13.1
npx -y pnpm@10.28.0 install --frozen-lockfile     # corepack pnpm은 서명 오류
cd apps/desktop && npm run dev                     # 데스크톱(Electron)
```

- 시작하면 **시작 메뉴**: 새 커리어 / 계속 / 불러오기 / 설정 / 빠른 경기(엔진·시리즈·개발 도구) / 종료.
- 검증: `npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --out <a> --report <b>`
  (`PYTHON=`에 jsonschema가 있는 venv). 기본은 **실제 로스터**, `--mirror`가 예전(평균 선수 미러) 조건, `--abilities`로 스킬 on.
- 무거운 실행(배치·e2e·캡처·성능)은 **하나씩**: `/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "<label>" -- <cmd>`.
- e2e: `PLAYWRIGHT_REQUIRE_BASE=<playwright가 있는 node_modules의 상위>` 필요. 끝나면 `apps/desktop/docs/*.png` 되돌리기.
- 맵 원본(Blender, .glb, 메시)은 저장소 밖 `/Users/yi-rang/ProjectV-assets/`. 팀 캠 실제 메시는 gitignore된 `apps/desktop/assets/maps/`.

## 3. 검증 상태 — 반드시 먼저 읽을 것

**지금까지 보고된 "160경기 8/8, 공격 0.521"은 양쪽 10명이 모두 리그 평균(0.6) 선수인 미러 경기였다.**
`sim-batch`가 팀 id를 `t.id`로 읽었는데 필드는 `teamId`였다(`6bfb689`에서 수정, `--mirror`로 재현 가능).
14·15차 머지 기록의 8/8도 같은 조건이다.

| 조건 (Ascent, 시드 1–160) | 판정 | 공격 승률 | 비고 |
|---|---|---|---|
| 미러(예전 기준) | 8/8 | 0.521 | 시드 161–320도 8/8(0.535) |
| **실제 로스터(현재 기본)** | **6/8** | **0.460** | 시드 161–320: 6/8, 0.484. 해체 적고 시간 초과 많음 |
| 실제 로스터, 이 정리 시점 main | 6/8 | 0.455 | 피스톨 0.444, 전멸 0.728, 해체 0.136, 폭발 0.085, 시간 초과 0.051 |

- 스킬 OFF, Ascent 한 맵, 평균 미러에서만 보정됐다. **모든 보정 상수를 실제 로스터 조건에서 다시 봐야 한다**(감사 보고서 P0).
- 능력치 영향은 크다: 최상위 vs 최하위 로스터 24전 24승(감사 실측).
- 결과에 영향 없는 것: 값이 빈 능력치 10개 + weaponControl, outcome-predictor·lookahead·simulation-core, economy-engine 가치 평가, 상대 기억(끄더라도 차이 미검출), 스카우팅(검출 불가).

## 4. 브랜치와 미완성 작업

main에 모두 합쳐져 있다. 단, 아래는 **main에 없는 미완성 작업**이다.

| 브랜치 | 내용 | 상태 |
|---|---|---|
| `claude/nav-engine` (`11ec870`, 원격에 push) | Haven B 사이트 도달 불가·Pearl B 클럽 위치 원본 데이터 수정(재생성된 nav/vis/mesh JSON + 파이프라인·테스트) | **검증 안 됨**(세션 사용량 한도로 중단). main에는 `27bac33`까지 |
| `claude/matchday-uiux-efc023` | main과 같음(최종 머지에 포함) | — |

main에 들어갔지만 미완성인 것:
- **맵별 전술**(`557b672`, `20779a1`, `27bac33`): 맵에서 유도한 수비 위치·설치 후 위치, 3사이트 어휘. 다른 맵 자기 지형 결과는 측정 전. `geometry.test.ts`(Bind "own", 선수가 바닥에서 838 떨어짐) **실패 중** — 옵트인 경로만 해당.
- **커리어 ↔ 구단 운영 연결 안 됨**: 구단 운영은 자체 `CareerHooks`와 임시 `+일/주/월` 버튼으로 돌고, 커리어 셸의 `registerCareerHook`에 붙지 않았다. 연결 방법은 `docs/handoff/club-ops.md` §"Connecting". 두 층이 `InboxItem`·`addDays`·`teamStrength`를 따로 가짐(현재 `club*` 별칭으로 공존).
- **홈 화면 두 개**: 커리어 셸의 허브가 쓰이고, 경기 화면 세션의 로비(`screens/home/`)는 트리에 있으나 마운트 안 됨(`nav.home` 중복 항목).
- **경기 로딩 화면(`MatchLoadScreen`)·배너 선택**: 타입체크만, 실행 화면 미확인.
- AI 팀 경기를 엔진으로 전부 돌리면 시즌당 20–30분.

## 5. 부족한 점 (우선순위 순)

### P0 — 측정 기준 바로잡기
1. 실제 로스터 조건에서 재보정(지금 6/8). 원인부터 측정: 해체 감소·시간 초과 증가가 어느 팀 강도 차에서 나오는지. 상수로 덮지 말 것.
2. 검증 지표 확장(리포트 전용부터): 첫 킬 시점, 플로리스, 포스 승률, 라운드 시간, 사이트 도착 간격, 경로 다양성, 몸체 겹침률.
3. 다른 맵·스킬 on 조건의 배치를 정기 측정에 포함.

### P1 — 시스템 일관성
4. **시야 진실 하나로**: 플래시·정찰·트레이서·크로스파이어·데스크톱 시야 오버레이를 `vision.ts`의 위치 LOS로 통일.
5. 스모크를 위치 기반 차단으로, 설치·해체를 다각형·거리로(`isPointPlantable` 사용).
6. 스킬 on을 제품 기본으로 할지 결정 → 켜고 실제 로스터로 검증(현재 공격 과다).
7. 맵 선택이 지형을 바꾸게: 맵별 전술 완성 → `geometry: "own"`을 기본으로. 끊긴 구역(Haven B, Pearl 4곳, Split Mid Vent, Icebox A Nest, Abyss 2곳) 수정 브랜치 검증.
8. 능력치 정리: 빈 10개는 출처를 정하거나 UI에서 제거, weaponControl 연결, 속성별 ±1σ 효과 표.
9. 커리어 ↔ 구단 운영 훅 연결, 홈 화면 하나로, 시즌 진행이 감독 팀 로스터를 자동 변경하지 않게, 감독 경기 선수별 K/D 기록, 라인업 선택.

### P2 — 품질
10. 군중 이동: 몸체 통과(양보 0.6초 후 1.5초간 무시), 큐 3초 타임아웃, 5인 도착 간격이 기계적(최대 정확히 3.0초), 사망자 위치 점유 미해제.
11. 성능: 경기마다 nav/vis JSON 재파싱, 틱당 O(n²), `routeCache` 무효화 없음, 데스크톱이 경기마다 `npx tsx` 하위 프로세스(90초 타임아웃), 시즌 AI 시뮬 20–30분. round-simulator 성능 테스트는 부하 시 60초 한도 초과.
12. 계약 세부(에이전트·보너스·셀온·수입 규정), 보드 목표, 스태프 시장, 피로의 경기 반영, 국제 대회(킥오프·마스터스), 다른 지역 리그.
13. 계획 변경 사유 현지화, 데스크톱 `test/review.test.ts`(JSON import attribute) 실패.

### P3 — 제품화
14. **IP 방향 결정**(§6). 15. 패키징(tsx 하위 프로세스 제거), 튜토리얼, Steam.

## 6. 라이선스·자산 (출시 전 필수 재검토)
- 커밋된 맵 파생물: 11개 `<map>.nav.json`(점·선분), 11개 `<map>.vis.json`(쌍당 1비트), 기타 구역 JSON. 사용자 결정으로 커밋, 출시 전 재검토(`docs/LICENSE_AUDIT.md` §2.0b).
- **경기 화면이 런타임에 게임 자산을 씀**: valorant-api.com 미니맵·요원 초상·맵 스플래시, kingdomarchives.com 킬 배너 레이어(로컬 gitignore 폴더), VCT 로고 로딩 엠블럼(로컬 gitignore, Riot 상표). 경기 화면 세션 인계서에는 "사용자 결정: 사용 가능"이라고 적혀 있으나, 이 통합 세션에서는 그 결정을 직접 확인하지 못했다. valorant-api의 라이선스는 미확인(`LICENSE_AUDIT.md`). **내부 개발용으로만**.
- 요원·무기 3D 모델은 오리지널(`ca945d2`). 생성 선수 이름은 오리지널, 실존 핸들 1,227개와 충돌 검사.
- 원작 명칭(VALORANT, 요원·맵 이름) 사용 자체가 판매를 막을 수 있는 독립 위험 — 독자 세계관 여부를 일찍 결정할 것.

## 7. 테스트 상태 (이 정리 시점, 통합 브랜치에서 측정)

| 묶음 | 결과 |
|---|---|
| 루트 vitest(코어) | 259 통과, 4 todo |
| career | 45 통과 |
| round-simulator | 121 통과, 1 skip |
| match-runner | 87 통과, **1 실패**(`geometry.test.ts` Bind own — main에서도 동일) |
| spatial-engine | 278 통과, 22 skip(로컬 보행 격자 필요) |
| ability-engine / combat-engine | 21 / 21 통과 |
| 데스크톱 typecheck·build | 통과 |
| 데스크톱 test:unit / test:matchday / test:engine | 58 / 34 / 4 통과 |
| e2e / series / career / club | 모두 통과(공용 잠금으로 하나씩 실행) |
