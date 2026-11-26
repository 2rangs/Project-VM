# 인수인계 — 관전·가독성 (spectate)

> **브랜치:** `claude/pv3-spectate` (main에서 분기, 머지는 오케스트레이터) · **작성:** 세션 G · **기준일:** 2026-11-26
> **범위:** `research/UPGRADE_BACKLOG.md` 묶음 A — #1 키 하이라이트 재생, #3 라이브 라운드 승률, #6 밴픽/베토 연출.
> **엔진 불변:** `packages/*`의 시뮬레이션 동작은 **읽기만** 했고 바꾸지 않았다(검증: `test:engine` 결정성 10/10 그대로).

---

## 1. 무엇이 생겼나

### #1 키 하이라이트 재생 (관전 상세도)
- **새 순수 모듈** `apps/desktop/src/renderer/matchday/highlights.ts`: `HighlightLevel = 'instant'|'key'|'extended'|'full'`.
  - `roundPlayWindows(round, level)` — 그 라운드에서 **실제로 재생할 시간 윈도우**를 돌려준다. `full`=라운드 전체, `instant`=[](재생 없음, 결과로 바로), `extended`=모든 이벤트(교전·설치·해체) 구간, `key`=결정적 순간만(첫 교전·설치·해체·마지막 9초 결정 교전). key/extended는 같은 lead/tail을 써서 **key가 extended의 부분집합**(= 더 적은 클립 = 더 적은 렌더)이다.
  - `advanceHighlighted(windows, cur, step, endMs)` — 재생 클럭이 윈도우 안은 재생하고 윈도우 사이 빈 시간은 **건너뛴다**. 순수 함수라 훅과 테스트가 공유.
- **재생 클럭** `matchday/usePlayback.ts`: 4번째 인자 `plan?: HighlightPlan`을 받아, 플랜이 있으면 `advanceHighlighted`로 전진한다. `null`=전체 재생(기존), `[]`=즉시 결과.
- **설정** `matchday/prefs.ts`: `MatchPrefs.detail` 추가, **기본값 `'extended'`**(모든 이벤트는 보되 빈 이동 시간은 건너뜀 — 무엇도 숨기지 않으면서 저사양에서 가벼움).
- **UI** `screens/matchday/LiveMatch.tsx`가 `prefs.detail`로 플랜을 만들어 `usePlayback`에 넘기고, 하단 바(`Hud.tsx`의 `BottomBar`)에 **결과/핵심/확장/전체** 선택기를 추가.

### #3 라이브 라운드 승률 + 스윙 모먼트
- **새 순수 모듈** `matchday/winprob.ts`: 라운드 이벤트 상태(생존 인원·스파이크 페이즈/타이머·라운드 시간·팀 로드아웃 값)만으로 **싸고 결정적인 로지스틱** 승률.
  - `attackerWinProb(round, tMs)`, `teamWinProb(round, tMs, team)` — 라운드가 끝나면 **엔진의 실제 승자로 고정**(1/0)되어 엔진 판정과 모순되지 않는다. 라이브 중엔 [0.02, 0.98].
  - `swingMoments(round, team, limit)` — 각 이벤트 직전/직후 승률 차가 임계값(0.08) 이상인 "라운드가 갈린 순간"을 크기순으로.
- **UI**: `Hud.tsx`의 `WinProbBar`(맵 위 분할 바, "라운드 승률(추정)" 라벨), 라운드 결과창의 **"라운드가 갈린 순간"** 목록, 스크러버의 스윙 마커(스포일러 방지로 `watchedTo`까지만 표시).
- **왜 `@pv/outcome-predictor`를 직접 쓰지 않았나:** 그 패키지는 **엔진의 행동 랭커**(시뮬 중 PolicyView/SpatialQuery로 후보 행동을 점수화)라 완성된 라운드의 상태→확률 읽기에는 맞지 않는다. 우리 리서치(`research/COMPARABLES.md` §C.2, Xenopoulos: 생존 인원·장비·HP가 지배적)대로 가진 필드만으로 잘 근사되는 작은 로지스틱을 썼다. 평가당 산술 몇 번 — 가장 약한 PC와 모든 하이라이트 스킵에서도 안전.

### #6 밴픽/베토 연출 강화
- **순수 로직** `series/view.ts`: `vetoBriefing(view)`(포맷 Bo‑n, 우리 최강 맵, 상대 대비 최대 우위/최대 위험 맵 — 전부 match-runner가 이미 낸 수치에서 파생) + `latestAction(view)`(가장 최근 동작 강조용).
- **UI** `screens/series/VetoBoard.tsx`: 상단 **브리핑 스트립**(Bo-n · 우리 최강 · 우위 · 주의) + 방금 일어난 밴/픽을 카드와 로그에서 **강조**(밴=그레이스케일 strike-in, 픽=stamp-in 애니메이션, `prefers-reduced-motion`에서 비활성).
- 기존 보드의 정보(맵별 숙련도 우리 vs 상대·확신도, 스카우팅 공수 성향, 추천)는 그대로. 연출만 더함.

---

## 2. 저사양 측정 (하이라이트 모드)

측정 스크립트(재현 가능): `apps/desktop/scripts/measure-highlights.mts` (`node --experimental-strip-types scripts/measure-highlights.mts`). 매치 스크린은 애니메이션 프레임마다 1프레임 렌더하고, 프레임당 비용의 핵심은 `computeFrame()`(그 순간 팀 지식) + PixiJS/three 드로우다. 하이라이트 플랜은 **재생하는 라운드 시간에 비례해** 비용이 든다.

실측(픽스처 `match-sample.json`, 2라운드, 이 머신 `computeFrame` 중앙값 0.029 ms/frame):

| 레벨 | 재생 라운드 시간 | 클립 수 | 프레임@60(매치 합) | computeFrame CPU(합) |
|---|---|---|---|---|
| instant | 0% | 0 | 0 | ~0 ms |
| key | 16% | 7 | 1,392 | ~41 ms |
| extended | 16% | 7 | 1,404 | ~41 ms |
| full | 100% | 2 | 8,580 | ~252 ms |

- 하이라이트 모드는 매치 전체에서 **렌더 프레임을 ~6배 줄인다**(8,580→~1,400). 느린 라운드일수록 효과가 커진다(R2는 99.5초 느린 라운드 → key/extended가 **10%**만 렌더). `instant`는 0프레임(텍스트 결과).
- **레벨 간 비율은 하드웨어 독립**이다. 절대 CPU(ms)는 머신에 비례(N배 느린 PC면 ×N). 그래서 숫자 자체보다 **비율**이 저사양 논거다.
- **왜 FPS를 xvfb/swiftshader로 안 쟀나:** 이 컨테이너의 소프트웨어 GL FPS는 실제 저사양 GPU를 대표하지 못해 오해를 준다. 대신 "렌더하는 프레임 수 × 프레임당 CPU"라는 하드웨어 독립 모델로 쟀다. 실제 렌더가 깨지지 않음은 e2e(아래)로 확인.
- 픽스처 2라운드는 이벤트가 적어 key≈extended다. 이벤트가 흩어진 긴 라운드에서는 extended > key로 벌어진다(스크립트를 긴 매치 트레이스로 돌리면 보인다).

**세션 F(저사양 렌더) 연동:** F가 "저" 그래픽 프리셋을 적용할 때 매치 관전 기본 `detail`을 `'key'`로 낮추면 체감이 크다. F에게 연동 방식(프리셋 enum 위치)을 물어 작은 헬퍼를 맞출 수 있다고 메시지 보냄(미회신). 현재는 둘을 독립 유지해도 동작한다. **내가 건드린 렌더 루프 인접 파일은 `usePlayback.ts`(RAF 클럭 분기 추가)뿐**이고, 실제 Pixi/three 드로우 호출부(MAX_FPS, MatchStage/CamStage3D, LiveMatch의 `playback.subscribe`)는 건드리지 않았다 — F의 렌더 루프/품질 작업과 충돌 가능성 낮음.

---

## 3. 게이트 결과

| 게이트 | 결과 |
|---|---|
| `npx tsc --noEmit` (typecheck) | 통과 |
| `npm run build` (electron-vite) | 통과 |
| `npm run test:unit` | 80 통과 (series-view +2) |
| `npm run test:matchday` | 74 통과 (spectate.test.ts +16) |
| `npm run test:engine` | 10 통과 (엔진 결정성 불변) |
| i18n ko/en 키·플레이스홀더 패리티 | 통과 |
| `xvfb-run node test/e2e.series.test.mjs` | 통과(ko/en Bo3 완주, 베토 보드 렌더) |
| `xvfb-run node test/e2e.electron.test.mjs` | 통과(매치 → LiveMatch 렌더, 하이라이트/WP 바 깨짐 없음) |

- 루트 워크스페이스: `npx -y pnpm@10.28.0 install --frozen-lockfile`, 데스크톱: `cd apps/desktop && npm install` 후 위 명령.
- e2e는 스크린샷을 `apps/desktop/docs/`에 쓴다 → 끝나고 `git checkout -- apps/desktop/docs; git clean -fq apps/desktop/docs`로 정리했다(이미 정리됨).

---

## 4. 새/수정 파일

**새 파일**
- `apps/desktop/src/renderer/matchday/highlights.ts` — 하이라이트 플랜(순수).
- `apps/desktop/src/renderer/matchday/winprob.ts` — 라운드 승률·스윙(순수).
- `apps/desktop/test/matchday/spectate.test.ts` — 위 두 모듈 테스트(+16).
- `apps/desktop/scripts/measure-highlights.mts` — 저사양 측정 스크립트.

**수정**
- `matchday/prefs.ts`(detail 필드), `matchday/usePlayback.ts`(plan 분기), `screens/matchday/LiveMatch.tsx`(플랜·WP·스윙 배선), `screens/matchday/Hud.tsx`(상세도 선택기·`WinProbBar`·스윙·결과 목록), `screens/matchday/matchday.css`.
- `series/view.ts`(vetoBriefing·latestAction), `screens/series/VetoBoard.tsx`(브리핑·연출), `screens/series/series.css`.
- `i18n/ko.ts`·`i18n/en.ts`(mdx.detail*/winprob*/swing*, ser.brief*).
- `test/matchday/matchday-logic.test.ts`(prefs 테스트에 detail), `test/series-view.test.ts`(briefing·latest 테스트).

---

## 5. 다음 한 걸음(이 브랜치 범위 밖)

- **F 연동 확정:** "저" 프리셋 ↔ `detail='key'` 자동 연동(F 회신 후 prefs.ts에 작은 헬퍼 export).
- **WP 보정:** 현재 로지스틱 가중치는 손으로 맞춘 **추정**이다(엔진 적합 아님). 원하면 `tools/`에서 라운드 상태→실제 결과로 로지스틱을 적합해 `winprob.ts`의 `W` 상수를 교체(엔진 결과에 고정되므로 품질은 "라이브 중" 값에만 영향). `research/UPGRADE_BACKLOG.md` #3·#4와 연결.
- **하이라이트 ↔ 스윙 연동:** `key` 윈도우 선정에 WP 스윙(가장 승률을 흔든 순간)을 기준으로 넣으면 더 똑똑한 하이라이트가 된다(지금은 이벤트 종류 기준).
- **커리어 화면 WP:** 지금은 매치 관전에만. 커리어 결과/리뷰 화면에도 스윙 요약을 붙일 수 있다.
