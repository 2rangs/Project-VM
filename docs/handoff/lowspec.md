# 저사양 최적화 (claude/pv3-lowspec)

> 목표: 감독 게임이 FM·OOTP처럼 사양을 타지 않게. 저사양 기준 = 내장 그래픽 · 4코어 · 8GB RAM · 1366×768.
> 범위: `apps/desktop`(경기 화면 렌더링·메모리·번들)만. 시뮬 엔진(`packages/*`)은 건드리지 않음(세션 E 담당).

## 1. 무엇을 바꿨나

| 영역 | 변경 | 파일 |
|---|---|---|
| **그래픽 품질 설정(저/중/고)** | 설정 메뉴에 한국어 토글 추가. 저=3D 끔·2D만·30fps 상한·애니 최소·dPR 1 고정, 중=3D 60fps·dPR 1.25, 고=3D 144fps·그림자·dPR 1.5 | `settings/graphics.tsx`, `screens/career/StartMenu.tsx`, `i18n/ko,en.ts` |
| **하드웨어 자동 기본값** | 첫 실행 시 GPU 종류(WebGL 렌더러 문자열)·코어 수·메모리·화면폭을 보고 저/중/고를 자동 선택. 소프트웨어 렌더러·내장+4코어+8GB+1366 → 저 | `settings/graphics.tsx` (`detectQuality`) |
| **백그라운드/최소화 시 렌더 정지** | 창이 가려지거나 최소화되면(`visibilityState==='hidden'`) 재생 루프가 클럭도 멈추고 구독자도 호출 안 함 → 0 프레임 | `matchday/usePlayback.ts` |
| **3D 모듈 지연 로딩** | three.js·오퍼레이터 모델·맵 메시 파서를 전부 동적 import. 2D/저사양 경로에선 아예 로드·파싱 안 함. 초기 번들에서 three.js 1.27MB 분리 | `cams3d-loader.ts`, `mesh3d.ts`, `assets.ts`, `LiveMatch.tsx` |
| **품질 연동 렌더러** | 2D(Pixi)·3D(three) 모두 품질의 dPR·안티앨리어싱·그림자·fps 상한을 따름. 저=3D 생성 자체를 안 함 | `MatchStage.ts`, `CamStage3D.ts`, `LiveMatch.tsx` |
| **화면 이탈 시 dispose** | 3D 스테이지 파괴 시 scene·1인칭 scene의 지오메트리/텍스처/머티리얼을 순회하며 dispose(기존엔 `renderer.dispose()`만) | `CamStage3D.ts` (`destroy`) |
| **유휴 시 0 프레임** | 2D는 입력(플레이헤드·레이아웃·렌더카운터)이 그대로면 프레임 계산 생략(기존), 3D는 sig 동일 시 렌더 생략(기존). 멈춰 있으면 두 스테이지 모두 0 렌더 | 기존 유지(측정으로 확인) |
| **큰 표 가상 스크롤** | 공용 `DataTable`을 60행 초과 시 뷰포트 안 행만 DOM에 렌더(+오버스캔), 위·아래 스페이서 행으로 스크롤 높이 유지. 스카우팅 유망주·FA 풀(수백 명) 등 전부 적용 | `ui.tsx` |

## 2. 측정 방법

- 이 리눅스 컨테이너(4코어/15GB)에서 Playwright `_electron`으로 빌드된 앱을 실행. **GPU 끔**(`--use-gl=swiftshader` 소프트웨어 렌더링), **CPU 스로틀링**은 CDP `Emulation.setCPUThrottlingRate`.
- 하네스: `test/perf.lowspec.mjs`(시작 시간·화면별 메모리·FPS/CPU·메뉴 전환), `test/perf.leak.mjs`(경기 10회 개폐 후 힙·RSS 비교). 실행: `xvfb-run -a node test/perf.lowspec.mjs`.
- 메모리는 `/proc`에서 프로세스 트리 RSS를 **메인/렌더러/GPU**로 분류해 합산. FPS는 `requestAnimationFrame` 간격, 3D 렌더 CPU는 `window.__mdxPerf.avgMs`. CPU%는 프로세스 트리 전체의 jiffies 증분(코어 1개 기준 %).
- **측정 한계(정직하게):** ① 소프트웨어 래스터라이저(swiftshader)는 2D에서도 ~15–20fps가 상한이라, 실제 내장 그래픽이면 하드웨어 가속으로 수십~백fps가 나오고 거기서 **30fps 상한이 비로소 CPU·배터리를 아낀다**. 컨테이너에선 그 상한이 걸리는 모습을 볼 수 없다. ② CDP 스로틀은 렌더러 메인 스레드(JS)만 늦추고, GPU 프로세스의 소프트웨어 래스터는 풀 속도라 CPU%가 300% 부근으로 부풀려진다. ③ GPU 프로세스 RSS는 WebGL 컨텍스트를 새로 만들 때마다 swiftshader가 메모리를 OS에 반환하지 않아 누적된다(실제 GPU면 드라이버가 VRAM 회수). 따라서 **절대 수치가 아니라 전후 상대 비교**로 읽을 것.

## 3. 전후 수치 (CPU 4× 스로틀, 소프트웨어 렌더링, 1366×768)

`before` = 이 브랜치 이전 동작(품질 설정 없음 = 3D 켜짐·144fps·dPR 1.5, 고 품질과 동등).
`after(저)` = 새 자동 기본값이 저사양 하드웨어에서 고르는 값(2D만). `after(고)` = 고 품질(기존 경험 유지 확인).

| 항목 | before | after(저) | after(고) | 비고 |
|---|---|---|---|---|
| 앱 시작(실행→시작 메뉴) | 768 ms | 744 ms | 710 ms | Electron 부팅(~700ms)이 지배적. 번들 분리 효과는 실HW·실디스크에서 더 큼 |
| 커리어 메뉴 전환(시작→새 커리어) | 216 ms | 158 ms | 189 ms | 측정 노이즈 범위, 지연 로딩으로 메인 스레드 경합 감소 |
| 메모리 시작메뉴(메인/렌더러) | 194 / 183 MB | 194 / 189 MB | 195 / 189 MB | 동일 |
| 메모리 경기2D(메인/렌더러) | 256 / 372 MB | **252 / 327 MB** | 253 / 350 MB | 저는 3D 미로드로 렌더러 −45MB(GPU 프로세스는 233→168MB) |
| 메모리 경기3D 캠(메인/렌더러) | 202 / 381 MB | **해당 없음(3D 끔)** | 199 / 357 MB | 저는 3D 경로 자체가 없음 |
| 경기 2D(전술 맵) FPS / CPU | 9.2 fps / 295% | **12.3 fps / 301%** | 8.8 fps / 298% | 저는 dPR 1·AA 끔으로 래스터 비용 ↓ → **+34% fps** |
| 경기 3D(팀 캠) FPS / CPU / 렌더 | 3.0 fps / 321% / 24.7 ms | **해당 없음** | 2.8 fps / 315% / 25.8 ms | 고는 기존과 동등(패리티 확인) |
| 초기 로드 JS | 6.05 MB (단일 청크) | **4.98 MB** | 4.98 MB | three.js 1.27MB를 지연 청크로 분리 |
| 지연 3D JS(저사양·2D에선 미로드) | 0 (초기에 포함) | 1.27 MB | 1.27 MB | 저 품질은 끝까지 로드 안 함 |
| 렌더러 번들 총량 | 6.67 MB | 6.37 MB | 6.37 MB | 총량은 비슷(three가 청크로 이동), **초기 로드가 핵심** |

보조(무스로틀, THROTTLE=1): 2D FPS 저 19.7 vs 고 14.8 → dPR 1·AA 끔이 래스터 바운드에서 **+33%**. (swiftshader 상한 때문에 둘 다 30fps 미만이라 30fps 상한은 미작동 — 실HW에선 작동.)

### 설치 크기
리눅스 패키징(electron-builder)이 이 저장소엔 설정돼 있지 않아(`package:mac`만) 설치본 크기는 직접 측정 불가. 앱 페이로드(`out/` 전체)는 전후 **7.6 MB**로 동일. 설치 크기는 ‘Electron 런타임(~200MB) + 앱 페이로드’이며 JS 변경으로 거의 불변. 저사양에 실효적인 지표는 **초기 로드 JS(6.05→4.98MB)** 와 저 품질에서 three.js 미로드.

## 4. 메모리 누수 확인 (경기 8회 연속 개폐, `test/perf.leak.mjs`)

매 사이클: 경기 실행 → 전술/3D 화면 열고 → 나가기(스테이지 dispose) → 강제 GC 후 힙·RSS 측정.

| 품질 | JS 힙 | GPU 프로세스 RSS | 트리 총 RSS | 판정 |
|---|---|---|---|---|
| 저(2D만) | 21 → 23 MB | **146 → 151 MB(평탄)** | ~1130 MB로 안정 | **누수 없음** |
| 고(2D+3D) | 25 → 28 MB(평탄) | 211 → 669 MB(사이클당 ~65MB) | 증가 | JS 누수 없음. GPU 증가는 swiftshader 컨텍스트 재생성 특성 |

- **JS 힙은 두 품질 모두 평탄** → 내가 만든 코드에 JS 누수 없음(스테이지·리스너·참조 정리됨). 메인·시뮬 서브프로세스도 평탄.
- 고 품질의 GPU 프로세스 누적은 경기마다 WebGL 컨텍스트를 새로 만들고 버리는 과정에서 swiftshader가 메모리를 OS에 반환하지 않는 것(실 GPU 드라이버는 회수). 새로 추가한 `CamStage3D.destroy()`의 지오메트리/텍스처/머티리얼 dispose로 렌더러 측 three 자원은 이전보다 더 확실히 해제된다.
- **저 품질(저사양 대상)은 3D 컨텍스트를 아예 만들지 않아 이 누적이 통째로 사라진다** — 즉 누수에 가장 취약한 하드웨어가 그 경로를 안 탄다.
- (후속 후보) 경기마다 `CamStage3D`를 새로 만들지 않고 화면 간 **재사용**하면 고 품질의 컨텍스트 재생성도 없앨 수 있다. 범위·위험 때문에 이번엔 미적용.

## 5. 회귀

| 게이트 | 결과 |
|---|---|
| typecheck | 통과 |
| build | 통과 |
| test:unit | 78 통과 |
| test:matchday | 58 통과 |
| test:engine | 10 통과 |

## 6. 기본값·되돌리기
- 저장 키 `pv-graphics-quality`(localStorage). 없으면 첫 실행에 `detectQuality()`로 자동 설정.
- 품질 강제: 설정 메뉴 또는 `localStorage.setItem('pv-graphics-quality','low'|'medium'|'high')`.
- 측정 재현: `cd apps/desktop && npm run build && LABEL=x QUALITY=low THROTTLE=4 xvfb-run -a node test/perf.lowspec.mjs`.
