# PROJECT V — HANDOFF (2026-11-26, 3차 작업 묶음 통합 — 30차 머지)

> 이 문서가 **현재 상태의 정본**이다. 문서 지도는 `docs/README.md`.
> 만든 과정·게이트는 `docs/DEVELOPMENT_PROCESS.md`, 머지별 수치는 `docs/WORK_HISTORY.md`,
> 영역별 상세(무엇이 켜져 있고 무엇이 플래그 뒤에 있는지, 다음 한 걸음)는 `docs/handoff/<영역>.md`.

> **제품 원칙(사용자, 2026-11-26): FM·OOTP처럼 사양을 타면 안 된다.** 기준 PC: 내장 그래픽·4코어·8GB·1366×768.
> 엔진 행동 변경은 `round-simulator/test/perf.test.ts` ms/round를 main 대비로 보고(+10% 넘으면 원인 필수), UI는 저 품질에서 2D만·30fps.

---

## 1. 한눈에

| 영역 | 상태 | 한 줄 |
|---|---|---|
| 라운드·경기·시리즈 엔진 | 작동, **실제 로스터 8/8** | 공식(능력치 × 상황 × 결정)으로 결과를 낸다. 검증 수치 §3 |
| 개인 경제 | 작동(v1.2) | 선수별 크레딧·무기 유지·드랍·라운드 중 줍기·궁극기 포인트, 2라운드 SMG |
| 이동·바이 페이즈 | 작동 | 30초 바이 페이즈 + **라운드 중 선수별 이동 스타일 기본 ON**(28차, `weaponModes`와 함께) |
| 설치 위치·설치 후·리테이크 | 플래그 뒤 | `plantTactics`: 설치 지점 선택, 위치별 설치 후 대형·리테이크 계획, 감독 설정 |
| 미드 주도권 | 플래그 뒤(**기본 ON 후보**) | `midControl`: 30차 측정에서 두 구간 기존 8개 8/8. 비용(off/on ms/round ≤10%) 확인 후 켠다(`mid-info.md`) |
| 선수별 정보·보고·IGL | 플래그 뒤 | `informationLayer`: 선수별 지식 → 보고(지연·오류) → IGL 융합, 럴커·앵커 클리어 콜 |
| 시야·시선 | 위치 기반 LOS 기본, 시선 모델은 플래그 뒤 | `gaze` 단독은 공격 0.337로 붕괴, `gaze`+`plantTactics`는 공격 0.514지만 5/8(전멸·해체·첫 교전) — 둘을 함께 재보정해야 함 |
| 스킬 | 기본 OFF | 켜면 4/8, 공격 0.474(이전 3/8, 0.281) |
| 커리어(FM식) | 작동 | 4개 지역 리그, 국제 대회, 챔피언스 포인트, 뉴스 + **기자회견·선수 1:1 대화·스카우트 지식 감쇠·튜토리얼·난이도**(30차, `career-depth.md`) |
| 구단 운영 | 작동 | 에이전트·보너스·바이아웃·셀온·재계약 거부, 보드(목표·신뢰·경질), 스태프 시장(피지오 포함) |
| 생성 선수·스카우팅 | 작동 | 능력치 안개(스카우팅 지식만큼 범위), 잠재력·나이 곡선·은퇴, 아카데미·임대 |
| 경기 중 관리 | 작동(효과 플래그 뒤) | 타임아웃·지시·전략 변경·팀 토크·경기 전 상대 보고서와 계획 화면 |
| 경기 화면 | 작동 | 전술 맵·3D 팀 캠, **하이라이트 재생(결과/핵심/확장/전체)·라이브 라운드 승률·스윙 모먼트·밴픽 연출**(30차, `spectate.md`), 그래픽 품질 저/중/고 자동 감지(저=2D만·30fps, `lowspec.md`) |
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
| **28차 통합 트리, 시드 1–160** | **8/8** | 0.515 | **15/15** | 피스톨 0.487, 전멸 0.704, 해체 0.192, 폭발 0.087, 시간 초과 0.017, 첫 교전 0.450 |
| **28차 통합 트리, 시드 161–320** | **8/8** | 0.515 | 13/15 | 피스톨 0.484 ✅(이전 0.397). 실패: 세미 대 에코 0.990, 에코 대 풀 0.091(소표본) |
| main `889ebef`(27차), 시드 1–160 / 161–320 | 8/8 / 7/8 | 0.508 / 0.483 | 13/15 / 14/15 | 피스톨 161–320 0.397 |

- 28차에서 바뀐 기본값: `movementStyle`·`weaponModes` 기본 ON(**둘을 함께 켰을 때만** 두 구간 8/8 — 단독은 각각 실패, `docs/handoff/pistol-movement.md`), 공격 마무리 수정(설치 중 사망 시 스파이크 드랍, 인원 우위 시간 초과 정체 제거, `docs/handoff/attack-closing.md`).
- 피스톨 원인(측정): 엔진 버그 아님 — 움직이는 공격수 vs 멈춘 수비수(교전 61%). 이동 스타일 + 클래식 이동 사격이 함께 들어가며 회복.
- 남은 실패 셀(161–320): 세미 대 에코 0.990(VCT 0.928) — 에코 수비 스틸이 ~2–3%(VCT ~7%). 구역 단위 재배치로는 안 됨(`ecoDefenseStack` 측정상 음성) → 서브존 근접 배치 모델 필요. `weaponModes`의 에코 샷건 이동 사격도 이 셀을 악화시킨다.
- 맵 자기 지형(`geometry: "own"`, 28차 측정): 공격 승률은 6개 맵에서 범위 안, 공통 실패는 **폭발률 0.16–0.40**(Ascent 0.078). 원인은 리테이크 실행 로직이 Ascent 기준(순차 듀얼·스텝아웃). Bind는 중앙 로테이터 수비 배치로 폭발 0.257→0.174(`docs/handoff/maps-own-geometry.md`).
- 30차: 기본 시뮬 결과는 28차와 동일(두 구간 판정·수치 일치, 성능 개선은 바이트 동일). 성능 테스트는 28–33초로 상한(60초)에 여유.

## 4. 플래그 뒤에 있는 것 (기본 OFF — 켜기 전에 실제 로스터 게이트 필요)

| 플래그 | 무엇 | 마지막 측정 | 상세 |
|---|---|---|---|
| `MatchConfig.plantTactics` (`--plant-tactics`) | 설치 지점 선택(기본·안전·노출·엄폐·근접), 스파이크 위치별 설치 후 경계, 리테이크 계획, 감독 설정(`teamInputs.plantPreference/postPlantPlans/retakePlans`) | 28차: 1–160 7/8(전멸 0.644), 161–320 4/8. 가드 홀드가 폭발 과다, pointSight 리테이크가 수비 과강화 | `plant-gaze.md`, `engine-truth.md` §12 |
| `MatchConfig.midControl` (`--mid-control`) | 미드 주도권 상태·미드 파티·스플릿·로테이션, 감독 설정(`teamInputs.midPlans`) | 게이트 미실행(꺼짐은 기존과 동일 확인) | `maps-tactics.md`, `research/MID_CONTROL.md` |
| `MatchConfig.informationLayer` (`--information`) | 선수별 지식 → 보고 → IGL 융합, 클리어 콜 | 12/15(전멸 0.672 < 0.674), 공격 0.536 | `information-layer.md`, `INFORMATION_LAYER.md` |
| `MatchConfig.gaze` (`--gaze`) | 시선 상태, Fitts 조준 시간, 피크 기법, 양방향 추적 | 28차: 단독 공격 0.337, `plantTactics`와 함께 0.514·5/8. 설치 후 가드 오프셋 38° | `plant-gaze.md`, `engine-truth.md` §7–11 |
| `MatchConfig.soundDetail` (`--sound`) | 착지음·총성 마스킹·로프·짚라인·텔레포터 소리 | 보정 안 됨 | `engine-truth.md` |
| ~~`movementStyle`·`weaponModes`~~ | **28차부터 기본 ON**. 끄기: `movementStyle: false`(`--no-style`), `weaponModes: false`(`--no-weapon-modes`) | 함께 켜야 두 구간 8/8 | `pistol-movement.md` |
| `MatchConfig.ecoDefenseStack` (`--eco-stack`) | 에코 수비가 접촉 전 읽은 사이트로 스택 | 음성: 세미 대 에코 0.991→0.986, 풀 대 세미 악화 | `attack-closing.md` §5 |
| `MatchConfig.ultOrbs` (`--ult-orbs`) | 라운드 중 궁극기 오브 줍기(11개 맵 위치, 미검증) | 바이 결정(`ultHold`)을 바꿔 결과가 달라짐 → 위치 검증 전까지 OFF | `maps-own-geometry.md` |
| `geometry: "own"` (`--geometry own`) | 맵별 자기 지형 | 폭발 0.16–0.40 과다 | `maps-own-geometry.md` |
| `MatchConfig.enableAbilities` (`--abilities`) | 스킬 | 4/8, 공격 0.474 | `ability-realism.md` |
| `CLUB_FLAGS.moraleInMatch` | 사기가 커리어 경기 로스터에 반영 | 측정상 효과 없음 | `club-ops.md` |
| `ManagedSessionOptions.moodEffects / aiManager / timeoutsPerHalf` | 감독 개입의 경기 효과, AI 감독, 하프당 타임아웃 | 게이트 미실행 | `match-management.md` |

## 5. 부족한 점 (우선순위 순)

### P0 — 엔진 정합성
1. ~~피스톨 161–320~~ — 28차 해결(0.484). ~~라운드 중 이동 스타일~~ — 28차 기본 ON.
2. **에코 수비 스틸**(세미 대 에코 161–320만 0.990, 1–160은 0.976 통과): 30차 측정 — 원인은 총이 아니라 **접촉 시점 수적 열세**(선제조준 에코 수비는 1v1에서 소총을 ~0.6로 이기지만 오프닝 듀얼 0.236). 로테이션 스택·바이 페이즈 스택·전원 근접 홀드 모두 효과 없음. `weaponModes`는 에코 셀을 **돕는다**(끄면 0.976→0.990, 28차 기록 정정). 다음 레버: **공격적 에코 픽**(수비 1명이 통제된 러크로 집행 전 5v4) — 새 행동 시스템(`eco-defense.md`).
3. **`plantTactics`+`gaze` 묶음 재보정**: 둘은 결합돼 따로 게이트 불가. gaze ON 상태에서 설치 후 가드 듀얼(홀더 위치 우위 vs 리테이커 스윙)을 폭발·해체 밴드에 맞춰 함께 보정. 피스톨 1–160이 최대 제약.
4. **큰 맵 폭발 과다 = 공격이 세이버를 사냥하지 않음**(30차 세션 D 측정, 맵당 40경기): 폭발은 **전부 수비 세이브 라운드**에서 나온다(리테이크한 라운드는 해체 또는 전멸). 세이브 라운드가 전멸로 끝나는 비율 Ascent 61% vs Split 11%·Fracture 5%·Bind 20%·Haven 16%·Pearl 33%. 리테이크 강제 반례: Ascent 폭발 0.087→~0.006(게이트 붕괴), Split은 수비가 총 들고 죽음 → **리테이커·세이브 로직은 레버가 아님(Ascent에 맞게 튜닝돼 있음)**. 다음 레버: 설치 후 공격 `postPlantDecision`에 "리테이크 포기 감지 → 홀더 일부 수색" (C 영역과 함께, 경제 손해 없음). 세션 D 측정 문서는 마감 전 push 실패 — 수치는 여기와 WORK_HISTORY 30차.

### P1 — 켜야 할 시스템
5. `midControl`: 두 구간 8/8 통과 — 비용 확인 후 기본 ON. `informationLayer`: 새 기본값 위 재측정 필요. `plantTactics`+`gaze`: 30차 세션 C 마감 전 push 실패, 재착수(P0-3·P0-4와 같은 묶음).
6. 맵 자기 지형: P0-4(맵 인식 리테이크) 후 `geometry: "own"` 기본화.
7. 스킬 기본 ON 결정(지금 4/8, 0.474).
8. 궁극기 오브: 28차에 11개 맵 위치 완비(미검증) — 위치 검증 후 `ultOrbs` 게이트.

### P2 — 품질·깊이
9. ~~빠른 시뮬 보정~~ — 29차: 28차 엔진 1,100시리즈 재적합 적용(라운드 기울기 10.57, ECE 0.055→0.011). 엔진이 바뀌면 `bash tools/career/refit-quick-sim.sh`로 다시 적합.
10. ~~사기 통합~~ — 28차: `developmentMorale`이 추적 사기가 있으면 `moraleOf` 사용(`career-quicksim-morale.md`).
11. 데이터: 30차 커뮤니티 수집(`docs/research/COMMUNITY_DATA.md`, `datasets/community/`, 40개 값) — 첫 5v4 승률 0.703(n=1349), 첫킬→라운드 0.70–0.71(2개 대회 일치), 맵별 공수(Champions 2025: Sunset 수비 0.604, Abyss·Haven 공격 ~0.58), 설치 시각. 공개 분석 생태계는 거의 vlr 스크래핑 → 제외. 위치·이벤트는 **GRID Open Access 무료 키**(VALORANT 지원 확인, `GRID_ACCESS.md`, 사용자 신청) 또는 `.vrf`/VOD 경로.
12. ~~틱 성능~~ — 30차: 지각 패스 위치 캐시로 **48.84→32.40 ms/round(−33.6%)**, 결과 바이트 동일. 남은 것: 기본 리그 깊이로 시즌 ~10.8분(저사양 목표 제안·자기 리그 외 quick 기본화·세이브 gzip은 결과/기본값 변경이라 미적용, `perf.md`).
13. 고도화 백로그(`docs/research/UPGRADE_BACKLOG.md`): 박스스코어(KAST·ADR·클러치)·검증 지표 확장 — 30차 세션 H 마감 전 push 실패, 재착수 필요. WP 가중치 엔진 데이터 적합(`apps/desktop/scripts/fit-winprob.mts`). 데이터 에디터·모드(IP 결정 대기).

### P3 — 제품화
13. **IP 방향 결정**(§6). 14. 서명·공증, Windows/Linux 빌드, 튜토리얼, Steam.

## 6. 라이선스·자산 (출시 전 필수 재검토)
- 커밋된 맵 파생물: 11개 `<map>.nav.json`(점·선분), `<map>.vis.json`(쌍당 1비트), `<map>.objects.json`, 구역 JSON. 사용자 결정으로 커밋, 출시 전 재검토(`docs/LICENSE_AUDIT.md` §2.0b). 메시·.blend·.glb는 커밋 금지.
- 런타임 게임 자산(gitignore, 내부 개발용): valorant-api.com 미니맵·요원 초상·맵 스플래시, kingdomarchives.com 킬 배너, VCT 로고. valorant-api 라이선스 미확인.
- **Kingdom Archives 플레이어 카드**: 사용자 결정(2026-11-24)으로 공개 배포본(원본 게임 파일 아님)을 `apps/desktop/assets/playercards/`에 커밋. 파일이 없어도 기본 화면으로 동작. **음성 라인은 사용자 결정으로 폐기**. 출시 전 재검토 대상.
- 요원·무기·오퍼레이터 3D 모델과 애니메이션은 오리지널. 생성 선수 이름은 오리지널, 실존 핸들 1,227개와 충돌 검사.
- 원작 명칭(VALORANT, 요원·맵 이름) 사용 자체가 판매를 막을 수 있는 독립 위험 — 독자 세계관 여부를 일찍 결정할 것.

## 7. 테스트 상태 (30차 통합 트리)

| 묶음 | 결과 |
|---|---|
| 루트 vitest(코어·team-engine·decision-engine) | 307 통과, 4 todo |
| round-simulator / match-runner | 166 통과(1 skip, perf 28.3 ms/round) / 136 통과 |
| spatial-engine | 442 통과, 22 skip |
| combat / perception / economy / ability-engine | 36 / 32 / 38 / 21 통과 |
| replay-engine / game-data | 15 / 7 통과 |
| career | 128 통과, 1 skip |
| data-validator pytest | 65 통과 |
| 데스크톱 typecheck·build | 통과 |
| 데스크톱 test:unit / test:matchday / test:engine | 80 / 76 / 10 통과 |
| e2e / series / career / club | 세션 측 통과(E: electron·series·club, I: career·club, G: series·main) — 통합 트리 재실행은 안 함 |

## 8. 운영 메모
- 세션 15개가 동시에 돌면 무거운 실행 대기열이 60–90분까지 늘었다. 다음 묶음은 세션 수를 줄이거나, 세션별 게이트 대신 통합 게이트 한 번으로 묶는다(이번 마감에서 그렇게 했다).
- 브랜치를 합칠 때 겹친 곳은 대부분 "양쪽이 같은 자리에 기능 추가"였다. 같은 함수를 두 세션이 동시에 고친 경우(리테이크 경로, `moraleOf`, 데스크톱 엔진 호스트)는 맡은 세션이 직접 포팅하는 편이 안전했다.
