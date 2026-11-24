# PROJECT V — HANDOFF (2026-11-24, 이번 작업 묶음 마감 시점)

> 이 문서가 **현재 상태의 정본**이다. 문서 지도는 `docs/README.md`.
> 만든 과정·게이트는 `docs/DEVELOPMENT_PROCESS.md`, 머지별 수치는 `docs/WORK_HISTORY.md`,
> 영역별 상세(무엇이 켜져 있고 무엇이 플래그 뒤에 있는지, 다음 한 걸음)는 `docs/handoff/<영역>.md`.

---

## 1. 한눈에

| 영역 | 상태 | 한 줄 |
|---|---|---|
| 라운드·경기·시리즈 엔진 | 작동, **실제 로스터 8/8** | 공식(능력치 × 상황 × 결정)으로 결과를 낸다. 검증 수치 §3 |
| 개인 경제 | 작동(v1.2) | 선수별 크레딧·무기 유지·드랍·라운드 중 줍기·궁극기 포인트, 2라운드 SMG |
| 이동·바이 페이즈 | 작동 | 30초 바이 페이즈(선수별 스크립트) 기본 ON. 라운드 중 선수별 이동 스타일은 플래그 뒤 |
| 설치 위치·설치 후·리테이크 | 플래그 뒤 | `plantTactics`: 설치 지점 선택, 위치별 설치 후 대형·리테이크 계획, 감독 설정 |
| 미드 주도권 | 플래그 뒤 | `midControl`: 8개 맵 미드 영역, 주도권 상태, 공수 행동, 감독 설정 |
| 선수별 정보·보고·IGL | 플래그 뒤 | `informationLayer`: 선수별 지식 → 보고(지연·오류) → IGL 융합, 럴커·앵커 클리어 콜 |
| 시야·시선 | 위치 기반 LOS 기본, 시선 모델은 플래그 뒤 | `gaze`: 피크 기법(워크인·스윙·각쪼개기·지글·리피크) 포함, 공격 0.39–0.41로 아직 미달 |
| 스킬 | 기본 OFF | 켜면 4/8, 공격 0.474(이전 3/8, 0.281) |
| 커리어(FM식) | 작동 | 4개 지역 리그 동시 진행, 국제 대회(킥오프→마스터스 1·2→챔피언스), 챔피언스 포인트, 뉴스 |
| 구단 운영 | 작동 | 에이전트·보너스·바이아웃·셀온·재계약 거부, 보드(목표·신뢰·경질), 스태프 시장(피지오 포함) |
| 생성 선수·스카우팅 | 작동 | 능력치 안개(스카우팅 지식만큼 범위), 잠재력·나이 곡선·은퇴, 아카데미·임대 |
| 경기 중 관리 | 작동(효과 플래그 뒤) | 타임아웃·지시·전략 변경·팀 토크·경기 전 상대 보고서와 계획 화면 |
| 경기 화면 | 작동 | 전술 맵·3D 팀 캠(오리지널 오퍼레이터 애니메이션·무기 종류), 경제 표시, 선수 카드 로딩 화면 |
| 데스크톱 패키징 | 작동(내부용) | 엔진을 앱 안 워커로 번들(tsx 하위 프로세스 제거), macOS 앱 빌드(서명·공증 없음) |
| 출시 가능성 | 불가 | IP·자산 라이선스 미해결(§6) |

## 2. 실행 방법

```bash
nvm use 22.13.1
npx -y pnpm@10.28.0 install --frozen-lockfile     # corepack pnpm은 서명 오류
cd apps/desktop && npm install && npm run dev      # 데스크톱(Electron). apps/desktop는 pnpm 워크스페이스 밖(npm)
```

- 시작 메뉴: 새 커리어 / 계속 / 불러오기 / 설정 / 빠른 경기(엔진·시리즈·개발 도구) / 종료.
- 검증(실제 로스터, 기본): `npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --out <a> --report <b>` (`--out`과 `--report`는 다른 경로, `PYTHON=`에 jsonschema가 있는 venv — 없으면 이제 바로 알려 준다).
  정기 측정 묶음: `pnpm sim:suite`(기본 160 → 시드 161–320 → 스킬 on → 맵별 자기 지형, 이전 실행과 비교표).
- 무거운 실행(배치·e2e·캡처·성능·Blender)은 **하나씩**: `/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "<label>" -- <cmd>`. 이제 **먼저 줄 선 순서대로** 돈다. `heavy-run.sh --status`로 실행 중·대기 순서 확인. 단위 테스트·타입체크는 잠금 없이.
- e2e: `PLAYWRIGHT_REQUIRE_BASE=<playwright가 있는 node_modules의 상위>`. 끝나면 `git checkout -- apps/desktop/docs; git clean -fq apps/desktop/docs`.
- 맵 원본(Blender, .glb, 메시)은 저장소 밖 `/Users/yi-rang/ProjectV-assets/`. **절대 커밋하지 않는다.**

## 3. 검증 상태

기준: Ascent, 실제 로스터(46팀), 시드당 160경기, 기존 8개 판정 지표(전멸·폭발·해체·시간 초과·공격 승률·첫 교전·피스톨·풀 대 풀) + 경제 대결 셀(전체 15개 판정).

| 조건 | 기존 8개 | 공격 | 전체 판정 | 비고 |
|---|---|---|---|---|
| **이번 통합 트리, 시드 1–160** | **8/8** | 0.499 | 13/15 | 피스톨 0.469, 전멸 0.688, 해체 0.179, 폭발 0.082, 시간 초과 0.051 |
| 이번 통합 트리, 시드 161–320 | 7/8 | 0.483 | 14/15 | 피스톨 0.397 미달 — 이번 작업 전 main도 0.394(같은 문제) |
| main `65180b9`(이번 묶음 직전), 시드 1–160 | 8/8 | 0.512 | 13/15 | 경제 v1.2 |

- 남은 실패 셀: 에코 대 세미 0.021(VCT 0.072), 세미 대 세미 0.550(허용 0.50±0.05). 에코 쪽 해법은 플래그 뒤에 있다(`ecoSidearms`, §4).
- 피스톨(시드 161–320): 원인 미확인. 양쪽 장비가 같은데 공격 0.447(960라운드 합산). 상수로 덮지 않았다(`docs/handoff/engine-truth.md`).
- 데스크톱 번들 엔진 캐시 전후로 6경기 결과가 바이트 단위로 같음(이번 통합 세션 확인).
- 맵 자기 지형(`geometry: "own"`): 범위 안은 Breeze뿐, Pearl·Sunset 근접, 나머지 7개는 설치 후 공격 승률이 0.78–0.90로 높아 폭발이 많다(`docs/handoff/maps-tactics.md`).

## 4. 플래그 뒤에 있는 것 (기본 OFF — 켜기 전에 실제 로스터 게이트 필요)

| 플래그 | 무엇 | 마지막 측정 | 상세 |
|---|---|---|---|
| `MatchConfig.plantTactics` (`--plant-tactics`) | 설치 지점 선택(기본·안전·노출·엄폐·근접), 스파이크 위치별 설치 후 경계, 리테이크 계획, 감독 설정(`teamInputs.plantPreference/postPlantPlans/retakePlans`) | 켜면 공격 −0.02, 피스톨·풀 대 풀 셀 실패 | `engine-truth.md` §12, `research/PLANT_POSTPLANT.md` |
| `MatchConfig.midControl` (`--mid-control`) | 미드 주도권 상태·미드 파티·스플릿·로테이션, 감독 설정(`teamInputs.midPlans`) | 게이트 미실행(꺼짐은 기존과 동일 확인) | `maps-tactics.md`, `research/MID_CONTROL.md` |
| `MatchConfig.informationLayer` (`--information`) | 선수별 지식 → 보고 → IGL 융합, 클리어 콜 | 12/15(전멸 0.672 < 0.674), 공격 0.536 | `information-layer.md`, `INFORMATION_LAYER.md` |
| `MatchConfig.gaze` (`--gaze`) | 시선 상태, Fitts 조준 시간, 피크 기법, 양방향 추적 | 공격 0.39–0.41 | `engine-truth.md` §7–11 |
| `MatchConfig.soundDetail` (`--sound`) | 착지음·총성 마스킹·로프·짚라인·텔레포터 소리 | 보정 안 됨 | `engine-truth.md` |
| `MatchConfig.movementStyle` (`--style`, 기본 `BUY_PHASE_ONLY_STYLE`) | 라운드 중 레인·간격·경로 선택·멈춰서 확인·럴커 걷기 | 켜면 피스톨 0.436(1.5–2%p 낮음) | `movement.md`, `MOVEMENT_STYLE.md` |
| `EconomyOptions.ecoSidearms` (`--economy '{"ecoSidearms":true}'`) | 에코가 다음 구매 예비분을 넘는 돈을 고스트·셰리프·샷건·경량 실드에 씀 | 게이트 미실행 | `economy.md` |
| `MatchConfig.weaponModes` (`--weapon-modes`) | 클래식 점사, 이동 사격 정확도 | 양방향 추적과 겹쳐 효과 축소(0.016) — 재보정 필요 | `economy.md` |
| `MatchConfig.enableAbilities` (`--abilities`) | 스킬 | 4/8, 공격 0.474 | `ability-realism.md` |
| `CLUB_FLAGS.moraleInMatch` | 사기가 커리어 경기 로스터에 반영 | 측정상 효과 없음 | `club-ops.md` |
| `ManagedSessionOptions.moodEffects / aiManager / timeoutsPerHalf` | 감독 개입의 경기 효과, AI 감독, 하프당 타임아웃 | 게이트 미실행 | `match-management.md` |

## 5. 부족한 점 (우선순위 순)

### P0 — 엔진 정합성
1. **피스톨(시드 161–320, 0.397)** 원인 찾기. 장비 동일 조건에서 공격 0.447.
2. **에코 라운드**: `ecoSidearms`를 게이트에 올리기(에코 대 세미 0.021 → VCT 0.072). 무기 목록 확장분은 이미 들어 있음.
3. **시선 모델 재보정**: 설치 후 공격 경계가 리테이크 진입 방향에서 약 38° 벗어나 있음 → `plantTactics`의 위치별 경계와 함께 맞춘 뒤 `gaze` 기본 ON 검토.
4. **라운드 중 움직임 스타일**을 피스톨 손실 없이 켜기(따라가기 정체는 고침, 남은 1.5–2%p).

### P1 — 켜야 할 시스템
5. `plantTactics`, `midControl`, `informationLayer`를 하나씩 게이트 통과시켜 기본 ON(각자 handoff에 다음 한 걸음).
6. 맵 자기 지형: 7개 맵의 설치 후 공격 과다 원인(설치 시점 가장 가까운 수비 57–81 m vs Ascent 27 m) → `geometry: "own"` 기본화.
7. 스킬 기본 ON 결정(지금 4/8, 0.474).
8. 궁극기 오브 위치: 4개 맵만(검증 안 된 구역 기준점). 나머지 7개 맵 콜아웃 필요.

### P2 — 품질·깊이
9. 빠른 시뮬(커리어 AI 경기)이 강팀을 과신(예측 13% vs 실측 28%), 맵별 노이즈 0.3은 추정값 → 엔진 데이터로 적합.
10. 사기 두 개 통합: 구단 운영의 추적 사기(`moraleOf`)와 성장의 시즌 사기(`developmentMorale`).
11. 데이터: `vct.duckdb`에 위치·이벤트·설치 좌표가 없어 설치 후 인원 우위별 승률, 첫 킬 위치별 승률, 스플릿 비율을 못 구함(GRID Open Access 또는 VOD 코딩).
12. 군중 이동 세부, 성능(틱당 O(n²), `routeCache`).

### P3 — 제품화
13. **IP 방향 결정**(§6). 14. 서명·공증, Windows/Linux 빌드, 튜토리얼, Steam.

## 6. 라이선스·자산 (출시 전 필수 재검토)
- 커밋된 맵 파생물: 11개 `<map>.nav.json`(점·선분), `<map>.vis.json`(쌍당 1비트), `<map>.objects.json`, 구역 JSON. 사용자 결정으로 커밋, 출시 전 재검토(`docs/LICENSE_AUDIT.md` §2.0b). 메시·.blend·.glb는 커밋 금지.
- 런타임 게임 자산(gitignore, 내부 개발용): valorant-api.com 미니맵·요원 초상·맵 스플래시, kingdomarchives.com 킬 배너, VCT 로고. valorant-api 라이선스 미확인.
- **Kingdom Archives 플레이어 카드**: 사용자 결정(2026-11-24)으로 공개 배포본(원본 게임 파일 아님)을 `apps/desktop/assets/playercards/`에 커밋. 파일이 없어도 기본 화면으로 동작. **음성 라인은 사용자 결정으로 폐기**. 출시 전 재검토 대상.
- 요원·무기·오퍼레이터 3D 모델과 애니메이션은 오리지널. 생성 선수 이름은 오리지널, 실존 핸들 1,227개와 충돌 검사.
- 원작 명칭(VALORANT, 요원·맵 이름) 사용 자체가 판매를 막을 수 있는 독립 위험 — 독자 세계관 여부를 일찍 결정할 것.

## 7. 테스트 상태 (이번 통합 트리)

| 묶음 | 결과 |
|---|---|
| 루트 vitest(코어·team-engine·decision-engine) | 307 통과, 4 todo |
| round-simulator / match-runner | 165 통과(1 skip) / 135 통과 |
| spatial-engine | 442 통과, 22 skip(로컬 보행 격자 필요) |
| combat / perception / economy-engine | 36 / 32 / 38 통과 |
| career | 99 통과, 1 skip(옵트인 엔진 테스트) |
| data-validator pytest | 65 통과 |
| 데스크톱 typecheck·build | 통과 |
| 데스크톱 test:unit / test:matchday / test:engine | 78 / 58 / 10 통과 |
| e2e / series / career / club | 모두 통과(최종 트리) |

## 8. 운영 메모
- 세션 15개가 동시에 돌면 무거운 실행 대기열이 60–90분까지 늘었다. 다음 묶음은 세션 수를 줄이거나, 세션별 게이트 대신 통합 게이트 한 번으로 묶는다(이번 마감에서 그렇게 했다).
- 브랜치를 합칠 때 겹친 곳은 대부분 "양쪽이 같은 자리에 기능 추가"였다. 같은 함수를 두 세션이 동시에 고친 경우(리테이크 경로, `moraleOf`, 데스크톱 엔진 호스트)는 맡은 세션이 직접 포팅하는 편이 안전했다.
