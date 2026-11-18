# PROJECT V — DEVELOPMENT HANDOFF
## VALORANT Esports Tactical Simulation Engine
### AI 에이전트 간 프로젝트 인수인계 및 작업 연속성 문서

**문서 유형:** Technical Handoff / Project Continuity / Agent-to-Agent Transfer

**작성 기준일:** 2026-11-18

**프로젝트 단계:** 기술 조사 및 시스템 설계

**개발 우선순위:** 경기 데이터 확보 → 경기 상태 복원 → 상황 기반 선택지 생성 → 전술 의사결정 → 5v5 시뮬레이션

**개발 환경:** PC Desktop / Electron / TypeScript / Python / Rust

---

# 1. HANDOFF 목적

이 문서는 PROJECT V의 개발을 이어받을 새로운 AI 에이전트가 기존 대화나 개발 과정을 모두 읽지 않아도 프로젝트의 목표, 아키텍처, 결정 사항, 기술적 위험, 현재 진행 상태, 다음 작업을 정확히 이해하도록 작성되었다.

새로운 AI는 이 문서를 읽은 뒤 다음 사항을 반드시 인지해야 한다.

1. 사용자가 실제로 만들고 싶은 게임이 무엇인지
2. 기존에 어떤 프로젝트와 기술을 조사했는지
3. 어떤 설계 방향이 확정되었는지
4. 어떤 구현 방향이 거부되었는지
5. 실제로 확보한 데이터와 확보 후보를 어떻게 구분해야 하는지
6. 경기 엔진의 가장 중요한 기능이 무엇인지
7. 경기 상태와 AI가 관측하는 상태가 어떻게 다른지
8. 행동 후보를 어떻게 생성하고 평가해야 하는지
9. 경제·세이브·궁극기가 전술 판단에 어떻게 영향을 주는지
10. 현재 구현되지 않은 기능이 무엇인지
11. 다음 작업을 어떤 순서로 진행해야 하는지
12. 완료 여부를 어떤 테스트로 판단해야 하는지

이 문서는 완성된 구현 보고서가 아니다.

**현재까지의 설계 합의와 조사 후보를 다음 개발 단계로 전달하는 기준 문서다.**

따라서 이 문서에 포함된 자료와 기술적 가설은 실제 코드·파일·API를 확인한 후 검증해야 한다.

---

# 2. 프로젝트 개요

## 2.1 프로젝트명

PROJECT V

VALORANT Esports Tactical Simulation Engine

## 2.2 게임의 정체성

VALORANT 기반 PC e스포츠 시뮬레이션 게임.

다음 작품들의 시스템적 특성을 참고한다.

### Football Manager

https://www.footballmanager.com/

참고 요소:

- 선수 능력치
- 선수별 행동 성향
- 팀 전술
- 경기 중 전술적 판단
- 선수와 감독의 상호작용
- 장기간 선수 성장
- 경기 시뮬레이션

### Out of the Park Baseball

https://www.ootpdevelopments.com/

참고 요소:

- 선수 능력치와 통계의 관계
- 확률 기반 사건 처리
- 시즌 시뮬레이션
- 결과의 통계적 일관성
- 대규모 반복 시뮬레이션
- 스포츠 경기의 전략적 의사결정

### VCT Manager

https://oneweekonecoding.github.io/vctmanager/

https://github.com/oneweekonecoding/vctmanager

참고 요소:

- VALORANT 팀 운영
- 선수 영입
- 능력치
- 시즌
- 경기 진행 구조

### VCT Draft

https://vctdraft.com/

참고 요소:

- 실제 프로 선수
- 선수 평가
- 팀 조합
- 역할
- 드래프트

### ValoPlant

https://valoplant.gg/

참고 요소:

- 전술 지도
- 선수 배치
- 이동 경로
- 요원 스킬
- 플레이북
- 전술 단계별 시각화

## 2.3 구현 철학

이 프로젝트는 능력치에 따라 경기 결과만 계산하는 단순 시뮬레이터가 아니다.

경기 결과는 다음 과정의 누적 결과여야 한다.

```text
Current World State
        ↓
Player Observations
        ↓
Team / Individual Beliefs
        ↓
Situation Analysis
        ↓
Available Action Generation
        ↓
Action Feasibility Validation
        ↓
Future Outcome Prediction
        ↓
Decision Making
        ↓
Action Execution
        ↓
World State Update
        ↓
Next Decision
```

이러한 과정이 실제 라운드 동안 반복된다.

**선수의 행동이 경기 결과를 만들어야 하며, 경기 결과가 선수의 행동을 미리 결정해서는 안 된다.**

---

# 3. 현재까지 확정된 주요 설계 결정

## DECISION-001 — 매니지먼트보다 경기 엔진 우선

현재 개발의 우선순위는 다음과 같다.

1. 실제 경기 데이터 확보
2. 경기 데이터를 통합할 스키마 구축
3. 경기 상태 복원
4. 5v5 행동 및 판단 시스템
5. 공간 시뮬레이션
6. 교전 및 스킬 시스템
7. 라운드 시뮬레이션
8. 통계 검증
9. 경기 관전 UI
10. 구단 매니지먼트

구단 경영 UI나 선수 카드 시스템을 먼저 완성하지 않는다.

## DECISION-002 — 결과 선결정 방식 거부

다음 방식을 사용하지 않는다.

```text
Team A OVR = 85
Team B OVR = 80

Calculate Match Winner
        ↓
Generate Fake Replay
```

우리가 원하는 구조는 다음과 같다.

```text
Team A / Team B Initial State
        ↓
Generate Tactical Decisions
        ↓
Execute Movement / Abilities / Combat
        ↓
Resolve Events
        ↓
Determine Round Result
```

승리팀을 먼저 정하는 모델과 실제로 경기를 만들어내는 모델을 명확히 구분한다.

## DECISION-003 — 상황 기반 선택지 생성 우선

행동을 평가하는 알고리즘보다 **현재 상황에서 가능한 행동 후보를 생성하는 시스템**을 먼저 구축한다.

핵심 기술:

- Action Schema
- Constraint Validation
- HTN
- Utility AI
- GOAP
- 제한적 미래 탐색
- Belief State

고정된 행동 목록을 그대로 평가하는 방식이 아니라, 맵과 현재 조건을 반영해 행동을 구성한다.

## DECISION-004 — 실제 상태와 인지 상태 분리

AI 선수가 자신이 볼 수 없는 적의 정확한 위치를 알고 행동하는 것은 허용하지 않는다.

다음 상태를 분리한다.

- World State
- Player Observation
- Team Observation
- Belief State

게임의 실제 상태를 모든 AI에게 직접 전달하지 않는다.

## DECISION-005 — AI 학습은 선택적 고도화

대형 언어 모델이 실시간으로 선수 10명을 조작하는 구조는 채택하지 않는다.

기본 엔진은 CPU에서 실행되는 규칙 기반·확률 기반 시스템이다.

머신러닝은 다음 용도로 사용한다.

- 전술 행동 분류
- 교전 확률 추정
- 행동 우선순위 예측
- 라운드 승률 예측
- 상대 행동 패턴 분석

초기 엔진은 머신러닝 모델 없이도 동작해야 한다.

## DECISION-006 — GPU 의존 최소화

개발 중 영상 분석이나 모델 학습에는 GPU를 사용할 수 있다.

그러나 실제 배포 게임은 고성능 GPU 없이도 경기 시뮬레이션이 가능해야 한다.

경기 연산과 화면 렌더링을 분리한다.

## DECISION-007 — Electron 기반 PC 게임

예정 기술 스택:

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS v4
- Zustand
- PixiJS

경기 시뮬레이션은 별도 프로세스 또는 Worker에서 실행한다.

## DECISION-008 — 시뮬레이션 코어

초기에는 TypeScript로 시뮬레이션 프로토타입을 구현할 수 있다.

성능상 필요성이 확인되면 Rust로 핵심 연산을 이전한다.

Rust 및 Rayon은 대규모 경기·시즌 시뮬레이션 성능 최적화 후보이다.

처음부터 모든 모듈을 Rust로 다시 작성하지 않는다.

## DECISION-009 — 최초 구현 맵은 Ascent

모든 맵을 동시에 구현하지 않는다.

최초 실전 구현 대상:

**Ascent**

선택 이유:

- 대표적인 3레인 구조
- 미드 컨트롤
- A/B 사이트 운영
- 수비 로테이션
- 다양한 진입 경로
- 공격·수비 정보전
- 사이트 분할 공격
- 전술적 의사결정 테스트에 적합

다른 맵은 공통 엔진이 검증된 이후 확장한다.

## DECISION-010 — Deterministic Simulation

같은 초기 상태와 난수 시드를 사용하면 같은 경기 결과를 재현해야 한다.

화면 배속과 경기 판정은 서로 독립적이어야 한다.

랜덤 생성 순서가 달라져 결과가 변하지 않도록 난수 흐름을 관리한다.

## DECISION-011 — 세이브와 궁극기는 주요 전략 요소

세이브를 단순한 패배 시 행동으로 처리하지 않는다.

세이브는 현재 라운드, 다음 라운드, 장비 보존, 상대 경제, 궁극기 충전과 연관된 의사결정이다.

별도의 경제적 가치 평가 시스템이 필요하다.

---

# 4. 개발이 완료된 것으로 오해하면 안 되는 사항

현재까지의 대화에서는 다수의 자료를 조사하고 설계 방향을 결정했다.

그러나 이 핸드오프가 작성되는 시점에는 다음 작업의 실제 완료가 입증되지 않았다.

| 항목 | 상태 |
|---|---|
| 프로젝트 저장소 생성 | 미확인 |
| Electron 애플리케이션 구현 | 미확인 |
| VCT Reference DB 다운로드 | 미검증 |
| GRID API 인증 | 미확인 |
| VLR 리플레이 데이터 추출 | 미검증 |
| C9 Gameplan 원본 위치 파일 확보 | 미검증 |
| VRF 파일 실제 디코딩 | 미실행 |
| Blender 맵 11개 다운로드 | 미검증 |
| Ascent 충돌 메시 생성 | 미구현 |
| NavMesh 생성 | 미구현 |
| World State 구현 | 미구현 |
| Belief State 구현 | 미구현 |
| Action Generator 구현 | 미구현 |
| Combat Engine 구현 | 미구현 |
| Save Decision Engine 구현 | 미구현 |
| 5v5 시뮬레이션 | 미구현 |
| 실제 경기 통계 검증 | 미실행 |

**이 표는 이전 대화에서 확인 가능한 정보 기준이며, 실제 작업 디렉터리의 상태와는 다를 수 있다.**

새로운 AI는 반드시 프로젝트 파일을 먼저 확인한다.

기존 구현물이 있다면 이를 우선 사용하고 실제 코드를 기준으로 상태표를 갱신한다.

---

# 5. 데이터 확보 전략

## 5.1 데이터의 3개 주요 계층

### Layer A — 경기 및 선수 통계

목적:

- 선수 능력치
- 팀 전력
- 맵별 성적
- 라운드 결과
- 경제
- 공격·수비 성적
- 클러치

### Layer B — 공간 및 이벤트 데이터

목적:

- 실제 선수 위치
- 이동 경로
- 교전 위치
- 스킬 사용
- 시야
- 스파이크
- 사이트 진입
- 로테이션

### Layer C — 전술 의사결정 데이터

목적:

- 현재 상황
- 실제로 관측 가능한 정보
- 가능한 행동
- 실제로 선택된 행동
- 후속 결과
- 전술적 의도 추정

최종적으로 필요한 것은 Layer C이다.

그러나 Layer C를 구축하려면 Layer A와 B의 품질이 충분해야 한다.

---

# 6. 데이터 소스 인수인계

아래 URL을 다음 AI가 실제 방문하고 검증해야 한다.

URL이 존재하는 것과 해당 서비스에서 데이터를 자유롭게 다운로드할 수 있는 것은 별개이다.

## 6.1 공식 Riot 데이터

### Riot Developer

https://developer.riotgames.com/docs/valorant

https://developer.riotgames.com/apis

https://developer.riotgames.com/policies/general

https://developer.riotgames.com/policies/game-specific

**역할:** 공식 경기·콘텐츠 API, 데이터 식별자, 개발 정책.

**우선 확인:** 경기 이벤트, 패치 식별자, API 권한 및 제한.

### Riot × GRID

https://grid.gg/riot-open-access/

https://docs.grid.gg/

https://grid.gg/data/games/valorant/

**역할:** 공식 프로 경기 이벤트 데이터.

**우선 확인:** 실제 접근 가능한 필드, 전체 선수 위치 데이터 제공 여부, 인증 조건, 사용 권한.

**주의:** GRID가 처리하는 데이터 전체가 Open Access에 제공된다고 가정하지 않는다.

---

## 6.2 VCT Reference

https://vct-reference.com/

https://vct-reference.com/dataset

https://vct-reference.com/terms

**역할:** 프로 경기·라운드·선수 통계 기반 데이터베이스.

**우선 작업:** DuckDB 다운로드 및 테이블 스키마 분석.

**확인할 항목:**

- 선수
- 팀
- 경기
- 맵
- 라운드
- 교전
- 경제
- 클러치
- 결측률

---

## 6.3 VLR.gg

https://www.vlr.gg/

분석 대상 경기:

https://www.vlr.gg/754737/loud-vs-team-vitality-valorant-champions-2026-gf

비공식 관련 코드:

https://github.com/axsddlr/vlrggapi

https://github.com/Orloxx23/vlresports

**역할:** 경기 기록, 경제, 라운드, 2D Replay 조사.

**중요:** 실제 2D Replay 데이터가 있는 경기를 별도로 확보해야 한다.

리플레이가 없는 경기를 위치 데이터 수집 성공 사례로 취급하지 않는다.

---

## 6.4 VCT Win Probability

https://www.bernielaird.com/vct/

https://github.com/bernielaird/vctstats

**역할:** VCT 데이터 수집, 경기 상태 데이터화, 위치·이벤트 기반 승률 모델.

**우선순위:** 매우 높음.

확인할 사항:

1. 실제 VLR 데이터 수집 코드
2. HTML 또는 JSON 처리
3. 위치 정보 추출 방식
4. SQLite 구조
5. 라운드 상태 벡터
6. LightGBM 특징값
7. 학습 데이터 누출 가능성
8. 원본 데이터 포함 여부

이 저장소의 설계가 우리가 만드는 경기 상태 표현과 유사할 가능성이 있다.

그러나 실제 구현 내용은 소스 분석으로 검증해야 한다.

---

## 6.5 C9 Gameplan

https://github.com/joshghal/c9-gameplan-backend

**역할:** 프로 경기 위치 데이터, 경로 탐색, 전술 시뮬레이션.

**우선순위:** 매우 높음.

확인할 사항:

- 실제 데이터 파일
- 좌표 체계
- 시간 해상도
- 전술 모델
- 이동 모델
- 교전 모델
- 경로 탐색
- 라이선스

README에서 설명하는 데이터 규모와 실제 접근 가능한 데이터량을 구분한다.

---

## 6.6 프로 경기 분석 서비스

| 서비스 | URL | 조사 대상 |
|---|---|---|
| RIB.GG | https://rib.gg/ | 2D Replay, 프로 경기 |
| THESPIKE | https://www.thespike.gg/ | 리플레이 및 이벤트 |
| Bo3.gg | https://bo3.gg/valorant | 라운드 경제 |
| Ascend | https://esports.play-ascend.com/ | 선수·팀 평가 |
| statsIQ | https://statsiq.net/ | 전술 패턴 |
| SABR / Morat | https://morat.ai/ | 유사 상황 검색 |
| Qiton | https://qiton.app/features | 선수 성적 평가 |
| Praccly | https://praccly.com/ | 연습경기 분석 |
| Offangle | https://offangle.pro/ | 교전·시야 |
| ValoPins | https://valopins.com/en/replays | 전술 변환 |
| Valorant Scout | https://valorantscout.com/valorant-replays | 리플레이 |
| OP.GG Replay | https://op.gg/ko/valorant/replay?view=2d | 정밀 위치 분석 |
| ValoPeek | https://valopeek.app/ | 구역별 교전 |
| kogni | https://kogni.pro/ | 상대팀 분석 |
| Tricks.gg | https://tricks.gg/ | 스킬 라인업 |
| VODs.space | https://vods.space/replays | 영상 타임라인 |
| Tracker.gg | https://tracker.gg/valorant | 개인 경기 통계 |

각 사이트에서 실제 데이터 파일·API 접근이 확인되지 않는다면 기술 참고 대상으로만 취급한다.

---

# 7. 리플레이 파서 인수인계

## 7.1 참고 저장소

### ValorantReplayParser

https://github.com/michel-giehl/ValorantReplayParser

### vrfkit

https://github.com/yakisoba0728/vrfkit

사용법:

https://github.com/yakisoba0728/vrfkit/blob/main/docs/USAGE.md

### ValoReview

https://github.com/dhinakar-v/ValoReview

### ValorantWebReplayer

https://github.com/talhakoek/ValorantWebReplayer

### ValoP

https://github.com/KNN-07/ValoP

## 7.2 파서 개발 목표

VRF에서 다음 데이터를 추출할 수 있는지 확인한다.

- 선수 ID
- 요원 ID
- 팀
- 위치
- 시선 방향
- 라운드 시간
- 생존 상태
- 체력
- 방어구
- 무기
- 킬
- 스킬
- 스파이크 상태

각 데이터의 획득 방식을 명시한다.

```text
Directly Decoded
Derived from Other Fields
Inferred
Unavailable
```

VRF가 모든 시점의 모든 정보를 제공한다고 가정하지 않는다.

## 7.3 C#과 Rust 비교

다음 기준으로 평가한다.

- 정확도
- 필드 커버리지
- 최신 게임 버전 지원
- 성능
- 유지보수 상태
- 출력 데이터 형식
- 추가 개발 난이도

사용할 언어는 실제 검증 결과에 따라 결정한다.

---

# 8. 방송 영상 분석 인수인계

## 참고 프로젝트

Valoscribe:

https://github.com/SphinxNumberNine/valoscribe

https://github.com/inde5media/valoscribe-VOD-ANALYSIS

Project X:

https://github.com/keith-ng/vct

Strategy Mapping Tool:

https://github.com/WesleyJWu/Valorant-Strategy-Mapping-Tool

VOD Analyzer:

https://github.com/Awilkes21/valorant-vod-analyzer

## 구현 목표

리플레이 좌표를 확보하지 못한 경기에서 방송 영상을 보조 자료로 활용한다.

분석 대상:

- HUD
- 라운드 시간
- 선수 상태
- 체력
- 방어구
- 스킬
- 킬 피드
- 스파이크
- 미니맵 위치
- 요원 식별

컴퓨터 비전으로 생성한 결과는 원본 게임 데이터보다 낮은 신뢰도로 관리한다.

---

# 9. 맵 데이터 인수인계

## 9.1 사용자가 제공한 맵 자료

Google Drive 폴더:

https://drive.google.com/drive/u/0/folders/1henHDT5PX5HW3PRAJ018UBMTgL0F3-2a

개별 파일:

| Map | URL |
|---|---|
| Abyss | https://drive.google.com/open?id=1BW2cxkBUz70ed3AYA2nGITvQlvuaEX8t |
| Ascent | https://drive.google.com/open?id=1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB |
| Bind | https://drive.google.com/open?id=1kAY2m05wdDnU9_3aOgrL_4b-p66AuLnK |
| Breeze | https://drive.google.com/open?id=1QpiCKTIJgzU735HzNH84Io5eYeoPhDdd |
| Fracture | https://drive.google.com/open?id=1WCTrmYIH9VNpXYGUN4w9U8S_nq_7Cx3I |
| Haven | https://drive.google.com/open?id=1e1wFXD2iBrYMPFNBwUgDnE9GpPTwt9rJ |
| Icebox | https://drive.google.com/open?id=1TzjOGVTZ0Du9E9-k3d9Vi7BN7qvX6hV1 |
| Lotus | https://drive.google.com/open?id=1J_FcYU3iRcvZIGRvxvdM8s7sRm5OAPTN |
| Pearl | https://drive.google.com/open?id=1L9BPmfJnlOOcduu-rlftTkgUP0r0ENh0 |
| Split | https://drive.google.com/open?id=1yTkqrAbinK1PyAFNZoyUfjvd5vA0ZMMd |
| Sunset | https://drive.google.com/open?id=1O-iEnHY1MfGcDdm32YK3f0kiA0UEybhG |

추가 맵 후보:

https://drive.google.com/drive/folders/1tKJAQv0GI8ZMD34XGbx30SrsfBjHTYVW

실제 파일을 확보한 뒤 데이터 구조를 분석해야 한다.

## 9.2 참고 프로젝트

ValorantBrowser:

https://github.com/Shreshth1x/ValorantBrowser

Valorant Zone Stats:

https://github.com/LouisAsanaka/Valorant-Zone-Stats

Valorant-API Maps:

https://valorant-api.com/v1/maps

Piana:

https://github.com/f0rmatme/Piana

## 9.3 공간 엔진 요구 사항

각 맵에 필요한 것은 다음과 같다.

```text
Map Geometry
Collision Mesh
Navigation Mesh
Elevation
Visibility
Sound Propagation
Tactical Zones
Spike Plant Zones
Spawn Zones
Dynamic Obstacles
Interactables
Coordinate Transform
```

단순한 이미지만으로 5v5 전술 시뮬레이션을 완성할 수 없다.

이동·시야·충돌이 실제로 계산 가능한 데이터 구조가 필요하다.

---

# 10. 무기·요원·스킬 데이터 인수인계

VALORANT API:

https://valorant-api.com/

요원:

https://valorant-api.com/v1/agents

무기:

https://valorant-api.com/v1/weapons

맵:

https://valorant-api.com/v1/maps

Riot 패치 노트:

https://playvalorant.com/en-us/news/game-updates/

Ascend Knowledge:

https://www.play-ascend.com/developers/knowledge

Kingdom Archives:

https://kingdomarchives.com/

스킬 라인업:

https://github.com/matthew-paul/valorant-lineups

https://github.com/Twosugar666/valorant-lineups

## 필수 구현 요구

모든 게임 규칙은 가능하면 패치 버전별로 관리한다.

특히 다음 항목은 고정값으로 가정하지 않는다.

- 요원 스킬
- 스킬 지속시간
- 궁극기 요구 포인트
- 무기 가격
- 무기 피해
- 경제 보상
- 맵 기믹
- 라운드 규칙

과거 경기 데이터는 해당 경기 당시 패치의 규칙으로 해석한다.

---

# 11. 추가 학습 자료

## Hugging Face

VALORANT 영상:

https://huggingface.co/datasets/open-world-agents/D2E-Original/tree/main/VALORANT

Gaming 500 Hours:

https://huggingface.co/datasets/markov-ai/gaming-500-hours

X-EGO-CS:

https://huggingface.co/datasets/wangyz1999/X-EGO-CS

EsportsBench:

https://huggingface.co/datasets/EsportsBench/EsportsBench

## 주의 사항

X-EGO-CS는 Counter-Strike 기반 데이터다.

VALORANT 경기 규칙이나 요원 행동을 그대로 학습하기 위한 자료가 아니다.

다중 시점 행동 기록과 부분 관측 AI의 데이터 구조를 참고하는 용도다.

---

# 12. 경기 상태 데이터 모델

## 12.1 World State

경기의 실제 상태를 저장한다.

```ts
interface WorldState {
  matchId: string;
  roundId: string;

  tick: number;
  timeRemainingMs: number;

  mapId: string;
  patchVersion: string;

  players: PlayerState[];

  spike: SpikeState;

  activeAbilities: AbilityState[];

  environment: EnvironmentState;

  economy: TeamEconomyState[];

  events: GameEvent[];
}
```

## 12.2 Player State

```ts
interface PlayerState {
  id: string;
  teamId: string;

  agentId: string;

  position: Vector3;
  facing: Vector2;

  health: number;
  armor: number;

  alive: boolean;

  weapon: WeaponState;

  credits: number;

  abilities: AbilityInventory;

  ultimatePoints: number;

  currentAction?: PlayerAction;

  currentOrder?: TacticalOrder;
}
```

## 12.3 Observation State

AI가 실제로 관측한 데이터이다.

```ts
interface ObservationState {
  visibleEnemies: ObservedEnemy[];

  audibleEvents: SoundObservation[];

  teammateReports: TeamReport[];

  knownMapChanges: MapObservation[];

  timestampMs: number;
}
```

## 12.4 Belief State

AI가 추론한 정보이다.

```ts
interface BeliefState {
  enemyPositionBeliefs: PositionDistribution[];

  tacticalHypotheses: TacticalHypothesis[];

  threatZones: ThreatEstimate[];

  confidence: number;
}
```

실제 World State와 Belief State 사이에 명확한 접근 경계가 필요하다.

---

# 13. 행동 후보 생성 엔진

## 13.1 핵심 목표

현재 상황에서 실행 가능한 선택지를 생성한다.

```text
World State
    ↓
Observation
    ↓
Belief State
    ↓
Goal Generation
    ↓
Action Schema
    ↓
Parameter Generation
    ↓
Constraint Validation
    ↓
Candidate Actions
```

## 13.2 행동의 4개 계층

### Strategic

팀 전체 목표.

예시:

- A Execute
- B Execute
- Fake
- Rotate
- Map Control
- Save
- Retake

### Tactical

실제 전술 구성.

예시:

- A Main 진입
- Mid Split
- Lurk
- Crossfire
- Utility Bait

### Individual

선수별 행동.

예시:

- Move
- Peek
- Hold
- Retreat
- Trade
- Use Ability

### Parameters

행동의 실제 실행 설정.

예시:

- 위치
- 방향
- 타이밍
- 목표
- 스킬 시전 좌표
- 이동 경로

## 13.3 후보 생성 방식

모든 좌표 조합을 무작위로 나열하지 않는다.

먼저 의미 있는 전략적 목표를 생성한다.

그다음 하위 행동으로 분해한다.

이 과정에서 실제 맵의 경로와 현재 상태를 사용한다.

## 13.4 선택지 평가

다음 항목을 고려한다.

- 승률
- 시간
- 자원
- 공간 장악
- 정보 획득
- 생존
- 다음 라운드 경제
- 궁극기 가치
- 상대 반응
- 실행 가능성

---

# 14. 반드시 구현해야 하는 핵심 전술 시스템

## 14.1 정보전

- 적 목격
- 발소리
- 스킬 정보
- 마지막 위치
- 팀원 정보 공유
- 정보의 시간적 신뢰도
- 상대 위치 분포 추정

## 14.2 페이크

- 가짜 사이트 압박
- 스킬 소비 유도
- 상대 로테이션 유도
- 역페이크
- 반복 패턴에 대한 적응

## 14.3 로테이션

- 이동 가능 경로
- 이동 시간
- 적과 마주칠 위험
- 스파이크 위치
- 정보 신뢰도
- 팀원 합류

## 14.4 교전

- 사격 가능 여부
- 시야
- 거리
- 엄폐
- 무기
- 체력
- 선수 능력치
- 교전 상대 수
- 트레이드 가능성

## 14.5 스파이크

- 설치 위치
- 설치 시간
- 설치 노출 위험
- 포스트플랜트
- 리테이크
- 해체
- 페이크 해체

---

# 15. 세이브·무기 보존·궁극기 포인트 차단

이 부분은 마지막 대화에서 중요성이 추가로 강조되었다.

다음 AI는 이 시스템을 부차적인 기능으로 취급해서는 안 된다.

## 15.1 핵심 개념

세이브는 라운드 패배를 받아들이고 무기를 보존하는 행동이다.

그러나 단순히 다음 라운드 무기 구매 비용만 평가하는 것이 아니다.

다음 요소가 연결된다.

- 현재 라운드 승리 가능성
- 보존 장비 가치
- 다음 라운드 구매 가능성
- 팀의 경제
- 상대의 경제
- 상대의 궁극기
- 자신의 궁극기
- 남은 라운드
- 진영 변경
- 매치포인트
- 안전한 경로

## 15.2 궁극기 포인트 차단

불필요한 사망으로 상대에게 킬을 허용하면, 해당 상대의 궁극기 충전에 영향을 줄 수 있다.

따라서 AI는 다음을 판단해야 한다.

- 적에게 교전을 제공할 가치가 있는가?
- 상대가 궁극기를 준비하고 있는가?
- 현재 사망이 다음 라운드 위험을 증가시키는가?
- 총기를 보존할 수 있는가?
- 교전을 피하면 적에게 궁극기 포인트를 주지 않을 수 있는가?

궁극기 포인트 규칙은 현재 패치 기준으로 별도 검증해야 한다.

## 15.3 세이브 후보

```text
SAVE_WEAPON
SAVE_OPERATOR
RETREAT
AVOID_CONTACT
RECOVER_WEAPON
RETAKE
EXIT_KILL
HUNT_SAVER
DENY_ENEMY_ULT_POINT
PLAY_FOR_ULT_CHARGE
```

## 15.4 마지막 라운드

미래 구매 기회가 없는 경우 일반적인 세이브 평가를 적용해서는 안 된다.

매치포인트, 진영 변경, 연장전 상황을 구분한다.

## 15.5 세이브 중 행동 변경

세이브를 선택한 뒤 상황이 바뀌면 계획을 다시 평가한다.

예를 들어 적이 무리하게 추격하면 반격을 선택할 수 있어야 한다.

---

# 16. 경제·궁극기 참고 규칙

Riot 패치 노트:

https://playvalorant.com/en-us/news/game-updates/

Credits:

https://wiki.playvalorant.com/en-us/Credits

Abilities:

https://wiki.playvalorant.com/en-us/Abilities

경제 관련 자료:

https://mobalytics.gg/blog/valorant/ultimate-economy-guide/

이 자료들은 규칙 검증 후보이다.

현재 버전의 정확한 경제·궁극기 판정은 공식 패치 노트와 실제 게임 규칙을 기준으로 확정한다.

---

# 17. 시뮬레이션 엔진 구조

권장 구조:

```text
Simulation Engine
│
├── Game Rules
│   ├── Round Rules
│   ├── Spike Rules
│   ├── Economy Rules
│   └── Ultimate Rules
│
├── World State
│
├── Spatial Engine
│   ├── Navigation
│   ├── Collision
│   ├── Visibility
│   └── Sound
│
├── Perception Engine
│   ├── Vision
│   ├── Hearing
│   ├── Memory
│   └── Communication
│
├── Decision Engine
│   ├── Belief State
│   ├── Goal Generation
│   ├── Action Generator
│   ├── Constraint Validation
│   ├── Outcome Predictor
│   └── Decision Policy
│
├── Player Engine
│   ├── Movement
│   ├── Combat
│   ├── Ability Execution
│   └── Individual Behavior
│
├── Team Engine
│   ├── IGL
│   ├── Tactical Orders
│   ├── Team Coordination
│   └── Tactical Adaptation
│
├── Economy Engine
│   ├── Buy Strategy
│   ├── Save Strategy
│   ├── Weapon Preservation
│   ├── Ultimate Economy
│   └── Future Round Value
│
├── Event System
│
└── Replay Recorder
```

모듈 간 의존성을 명확하게 설계한다.

UI와 시뮬레이션 엔진이 직접 결합되지 않도록 한다.

---

# 18. 개발 우선순위

## P0 — 필수 기반

- Data Source Registry
- 경기 데이터 스키마
- World State
- Player State
- 맵 좌표 체계
- 경기 규칙 데이터
- Seeded RNG
- Event Log

## P1 — 최소 전술 엔진

- Observation
- Belief State
- Action Generator
- Constraint Validator
- 기본 이동
- 기본 교전
- 기본 스파이크
- 라운드 종료

## P2 — 실제 VALORANT 전술

- 스킬
- 시야
- 정보전
- 페이크
- 로테이션
- 리테이크
- 포스트플랜트

## P3 — 경제 및 장기 판단

- 구매 전략
- 무기 보존
- 세이브
- 출구 킬
- 궁극기 포인트
- 다음 라운드 가치

## P4 — 고도화

- 선수 능력치
- 팀 전술 숙련도
- 상대 패턴 학습
- 머신러닝
- 대규모 시뮬레이션
- 경기 관전 UI
- 구단 매니지먼트

---

# 19. 첫 번째 실제 구현 목표

## Ascent Decision Prototype

최초 완성할 기능은 다음과 같다.

**Ascent의 특정 경기 상황을 입력하면 현재 실행 가능한 전술 선택지를 생성하고, 각 행동의 예상 결과를 평가하는 독립적인 프로토타입.**

필수 입력:

```text
Map
Patch
Round Time
Alive Players
Player Positions
Player Weapons
Player Abilities
Spike State
Team Observations
Belief State
```

필수 출력:

```text
Candidate Actions
Feasibility
Required Time
Resource Cost
Estimated Risk
Expected Outcomes
Expected Utility
Selected Action
Decision Explanation
```

최소 하나의 실제 또는 명확히 표시된 합성 경기 상태에 대해 작동해야 한다.

실제 데이터가 확보되지 않았으면 합성 상태를 사용하되 실제 프로 경기 기록이라고 주장해서는 안 된다.

---

# 20. 첫 번째 프로토타입 테스트 사례

## Scenario 01 — 기본 공격

5v5, 라운드 시작, 스파이크 소지.

공격팀은 진입 사이트, 디폴트 운영, 미드 컨트롤 등 행동 후보를 생성한다.

## Scenario 02 — 위치 정보

A 사이트에 적이 관측된다.

공격팀은 관측 정보를 반영해 위험도를 평가한다.

## Scenario 03 — 페이크

공격팀이 A 사이트를 압박한다.

수비팀은 실제 관측된 정보만으로 로테이션을 판단한다.

## Scenario 04 — 시간 부족

B 사이트까지 이동하고 스파이크를 설치할 시간이 부족하다.

B 로테이션은 실행 불가능한 후보로 처리된다.

## Scenario 05 — 설치

설치 가능한 구역 안에서만 스파이크를 설치한다.

## Scenario 06 — 포스트플랜트

스파이크 위치에 따라 수비 위치를 평가한다.

## Scenario 07 — Operator 세이브

1v4 상황에서 Operator 보존 가치를 평가한다.

## Scenario 08 — 궁극기 차단

상대 핵심 요원의 궁극기 충전을 피하는 행동을 평가한다.

## Scenario 09 — 매치포인트

세이브하면 경기가 끝나는 상황에서 미래 라운드 보존 가치를 제거한다.

## Scenario 10 — 출구 킬

상대 세이브를 추격하는 행동과 현재 무기를 지키는 행동을 비교한다.

---

# 21. Decision Debugger 요구 사항

최종 행동만 출력해서는 안 된다.

AI가 어떤 상황에서 어떤 선택지를 검토했는지 보여줘야 한다.

예시:

```text
MATCH: 001
ROUND: 17

TIME: 00:34

WORLD STATE
  Attackers Alive: 3
  Defenders Alive: 4
  Spike: Carried

OBSERVED
  A Site: Two defenders
  B Site: Unknown
  Mid: Partial control

GENERATED ACTIONS
  A Execute
  B Rotate
  Mid Split
  Gather Information
  Fake A

VALIDATION
  A Execute: Feasible
  B Rotate: Feasible
  Mid Split: Feasible
  Gather Information: Feasible
  Fake A: Feasible

PREDICTION
  Round Win Probability
  Expected Time
  Expected Equipment Loss
  Tactical Information Gain
  Future Economy Impact

SELECTED ACTION
  [Calculated by Decision Policy]

REASON
  [Grounded in evaluated candidates]
```

실제 숫자를 출력할 때는 모델이 계산한 값이어야 한다.

예시 값을 실제 분석값으로 오인하게 만들지 않는다.

---

# 22. 데이터 품질과 학습 주의 사항

## 22.1 선택된 행동과 최적 행동은 다르다

프로 선수가 선택한 행동이 반드시 최적의 선택은 아니다.

따라서 다음 모델을 구분한다.

- Behavior Cloning
- Outcome Prediction
- Value Estimation

프로 선수 행동을 따라 하는 모델과 승률을 높이는 모델은 동일하지 않다.

## 22.2 전술적 의도는 관측할 수 없는 경우가 많다

A에서 연막을 사용하고 B로 이동했다고 해서 페이크라고 확정하지 않는다.

가능한 대안:

- 계획된 페이크
- 진입 실패
- 정보 획득
- 로테이션
- 미드 컨트롤

추론한 의도에는 불확실성을 기록한다.

## 22.3 미래 정보 누출 금지

행동을 선택하는 순간에는 아직 발생하지 않은 사건을 입력으로 사용하면 안 된다.

특히 실제 프로 경기 데이터를 학습할 때 주의한다.

## 22.4 같은 경기의 중복 샘플

같은 경기에서 수집한 시간적으로 가까운 샘플을 무작위로 학습·검증에 나누지 않는다.

경기 또는 시리즈 단위 분할을 적용한다.

---

# 23. 권장 프로젝트 구조

```text
project-v/
│
├── apps/
│   └── desktop/
│
├── packages/
│   ├── simulation-core/
│   ├── world-state/
│   ├── game-rules/
│   ├── spatial-engine/
│   ├── perception-engine/
│   ├── action-generator/
│   ├── decision-engine/
│   ├── combat-engine/
│   ├── ability-engine/
│   ├── economy-engine/
│   ├── ultimate-engine/
│   ├── replay-engine/
│   └── shared-types/
│
├── tools/
│   ├── data-collector/
│   ├── replay-parser/
│   ├── vod-analyzer/
│   ├── map-processor/
│   └── data-validator/
│
├── datasets/
│   ├── raw/
│   ├── normalized/
│   ├── spatial/
│   ├── derived/
│   ├── labels/
│   └── training/
│
├── models/
│
├── tests/
│   ├── state/
│   ├── decisions/
│   ├── spatial/
│   ├── combat/
│   ├── economy/
│   └── simulation/
│
└── docs/
    ├── HANDOFF.md
    ├── MASTER_PROMPT.md
    ├── SOURCES.md
    ├── DATA_AVAILABILITY.md
    ├── LICENSE_AUDIT.md
    ├── ARCHITECTURE.md
    ├── GAME_RULES.md
    ├── DATA_SCHEMA.md
    ├── DECISION_MODEL.md
    ├── TEST_PLAN.md
    ├── DEVELOPMENT_LOG.md
    └── NEXT_TASKS.md
```

실제 저장소를 확인한 뒤 기존 구조와 통합한다.

프로젝트 구조를 변경하기 전에 현재 작업물의 상태를 검사한다.

---

# 24. 다른 AI 에이전트에게 작업을 넘길 때 지킬 규칙

이 프로젝트는 복수의 AI 에이전트가 순차적으로 작업할 수 있도록 설계한다.

각 에이전트는 자신의 작업 결과를 다음 에이전트가 재현할 수 있도록 기록해야 한다.

## 24.1 Agent Research → Agent Data Engineering

전달 내용:

- 검증된 데이터 출처
- 실제 다운로드 URL
- API 문서
- 라이선스
- 데이터 스키마
- 인증 요구 사항
- 결측치
- 샘플 데이터

데이터 파일을 받지 못했다면 받은 것처럼 보고하지 않는다.

## 24.2 Agent Data Engineering → Agent Simulation

전달 내용:

- 통합 스키마
- 경기 ID 매핑
- 선수 ID 매핑
- 라운드 데이터
- 이벤트 타임라인
- 위치 데이터
- 데이터 신뢰도
- 사용 예제

## 24.3 Agent Spatial → Agent Simulation

전달 내용:

- 맵 좌표계
- NavMesh
- 충돌 정보
- 시야 판정
- 이동 경로 API
- 구역 정보
- 설치 가능 영역

## 24.4 Agent Simulation → Agent Validation

전달 내용:

- 시뮬레이션 엔진 실행 방법
- 테스트 시드
- 경기 로그
- 생성된 행동
- 실제 결과
- 예상 결과
- 현재 한계

## 24.5 Agent Validation → Agent UI

전달 내용:

- 리플레이 데이터 스키마
- 이벤트 구조
- 좌표 변환
- 시간 탐색
- 검증된 시뮬레이션 동작

UI는 시뮬레이션 엔진의 내부 로직을 직접 수정하지 않는다.

---

# 25. 개발 작업 완료 시 필수 HANDOFF 템플릿

각 AI 에이전트는 작업을 종료하거나 다음 AI로 넘기기 전에 다음 형식으로 보고해야 한다.

```markdown
# PROJECT V — TASK HANDOFF

## 1. 작업 목표
이번 작업에서 해결하려던 문제를 설명한다.

## 2. 완료한 작업
실제로 구현하거나 검증한 항목만 기재한다.

## 3. 변경한 파일
파일 경로와 변경 목적을 기록한다.

## 4. 데이터 출처
실제 사용한 URL과 파일을 기록한다.

## 5. 실행 방법
환경 설정과 실행 명령을 기록한다.

## 6. 검증 방법
실행한 테스트와 재현 조건을 기록한다.

## 7. 테스트 결과
실제 결과를 기록한다.

## 8. 현재 미완료 사항
구현하지 못한 항목을 기록한다.

## 9. 알려진 문제
버그, 성능 문제, 데이터 문제를 기록한다.

## 10. 설계 결정
중요한 기술 선택과 이유를 기록한다.

## 11. 라이선스 및 권한
사용한 외부 자료의 제한을 기록한다.

## 12. 다음 권장 작업
우선순위에 따라 다음 작업을 제시한다.

## 13. 작업 재개 지점
다음 AI가 처음 열어야 할 파일과
실행해야 할 명령을 기록한다.
```

모든 작업 완료 보고에는 실제 테스트 여부를 명시한다.

미실행 테스트를 성공한 것으로 기록하지 않는다.

---

# 26. 다음 AI가 즉시 수행해야 하는 작업

**다음 AI의 최초 작업 범위는 Phase 0과 Phase 1이다.**

## TASK 001 — 프로젝트 환경 확인

현재 작업 디렉터리를 조사한다.

확인할 사항:

- 기존 저장소
- package.json
- Python 환경
- Rust 환경
- 기존 소스 파일
- 기존 데이터셋
- 기존 테스트
- Git 상태

기존 구현이 있다면 덮어쓰지 않는다.

## TASK 002 — 자료 목록 생성

모든 참고 URL을 데이터 소스 레지스트리로 변환한다.

산출물:

```text
docs/SOURCES.md
docs/DATA_AVAILABILITY.md
docs/LICENSE_AUDIT.md
```

## TASK 003 — 핵심 자료 5개 검증

최우선 검증 대상:

1. VCT Reference
2. vctstats
3. C9 Gameplan
4. vrfkit
5. ValoReview

각 자료의 실제 파일, 코드, API, 라이선스를 확인한다.

## TASK 004 — 데이터 스키마 정의

공통 경기·라운드·선수·위치·이벤트 스키마를 설계한다.

실제 데이터에서 확인된 필드와 향후 필요한 필드를 구분한다.

## TASK 005 — 최소 데이터셋 생성

가능하면 실제 경기 1개를 정규화한다.

실제 데이터 확보에 실패한 경우 합성 테스트 데이터를 생성한다.

합성 데이터를 실제 VCT 경기 데이터와 혼동하지 않도록 별도 디렉터리에 보관한다.

## TASK 006 — 경기 상태 복원

한 라운드의 특정 시점을 입력으로 World State를 생성한다.

## TASK 007 — Action Generator 프로토타입

하나의 경기 상태에 대해 실행 가능한 행동 후보를 생성한다.

## TASK 008 — Decision Debugger

선택된 행동과 제외된 행동의 이유를 기록한다.

---

# 27. 우선 완료 기준

현재 단계에서 전체 게임 완성을 요구하지 않는다.

첫 번째 기술적 성공 기준은 다음과 같다.

1. 실제 사용 가능한 데이터 소스가 식별된다.
2. 원본 자료와 가공 데이터가 구분된다.
3. 경기 상태 스키마가 정의된다.
4. 최소 하나의 경기 상태를 재현할 수 있다.
5. 해당 상태에서 의미 있는 행동 후보를 생성할 수 있다.
6. 물리적으로 불가능한 행동이 제외된다.
7. 행동 선택 이유를 설명할 수 있다.
8. 동일 상태와 시드를 재현할 수 있다.
9. 데이터 출처와 불확실성을 추적할 수 있다.
10. 다음 AI가 작업을 이어받을 수 있도록 파일과 테스트가 정리된다.

---

# 28. 장기 완료 기준

장기적으로는 다음이 필요하다.

- 완전한 5v5 라운드
- 선수별 개인 AI
- 팀 전술 AI
- 시야와 정보전
- 페이크
- 로테이션
- 스킬 연계
- 교전 시스템
- 스파이크 설치
- 포스트플랜트
- 리테이크
- 세이브
- 궁극기 경제
- 구매 전략
- 다음 라운드 가치
- 전술 적응
- 실제 경기 통계 검증
- 고속 시즌 시뮬레이션
- PixiJS 리플레이
- Electron PC 앱
- 추후 구단 운영 시스템

---

# 29. 절대 피해야 할 문제

다음 작업 방식은 금지한다.

### 결과부터 생성하기

먼저 승리팀을 정해두고 경기 장면만 생성하는 방식.

### 모든 선수에게 전지적 정보 제공하기

AI가 시야 밖의 적 위치를 정확히 알고 행동하는 방식.

### 정해진 행동만 무작위 선택하기

현재 위치·시간·경로를 무시하고 사전에 작성된 행동 목록에서 선택하는 방식.

### OVR만으로 교전 결정하기

엄폐·무기·거리·정보·시야 등을 무시하는 방식.

### 세이브를 단순 임계값으로 처리하기

라운드 승률이 낮다는 이유만으로 무조건 세이브하는 방식.

### 궁극기를 단순 스킬로만 처리하기

현재 충전량, 상대 궁극기, 다음 라운드의 가치를 무시하는 방식.

### README만 보고 구현 완료 판단하기

문서에 기재된 기능을 직접 검증하지 않고 사용 가능한 기능으로 보고하는 방식.

### AI 추정값을 사실로 저장하기

전술적 의도와 실제 관측 행동을 혼동하는 방식.

### 초기에 과도한 프레임워크 도입하기

검증되지 않은 구조를 위해 불필요한 의존성을 추가하는 방식.

---

# 30. 작업 재개 프로토콜

다음 AI는 프로젝트를 이어받을 때 아래 순서로 작업을 시작한다.

```text
1. Read HANDOFF.md
       ↓
2. Read MASTER_PROMPT.md
       ↓
3. Inspect Repository
       ↓
4. Inspect Existing Tests
       ↓
5. Read DEVELOPMENT_LOG.md
       ↓
6. Read NEXT_TASKS.md
       ↓
7. Compare Documentation With Code
       ↓
8. Identify Current Blockers
       ↓
9. Select Highest Priority Task
       ↓
10. Implement
       ↓
11. Test
       ↓
12. Update Documentation
       ↓
13. Write New HANDOFF
```

문서의 주장과 실제 소스코드가 충돌하면 실제 실행 결과와 테스트를 우선한다.

기존 코드가 잘못되어 있다면 수정 근거를 기록한다.

---

# 31. 다음 AI에게 전달할 최종 메시지

당신은 PROJECT V의 개발을 이어받았다.

PROJECT V는 단순한 VALORANT 경기 예측기나 선수단 매니저가 아니다.

우리가 개발하려는 것은 실제 발로란트의 전술적 행동을 재현하는 독립적인 시뮬레이션 엔진이다.

가장 중요한 부분은 다음과 같다.

**현재 경기 상황을 이해하고, 실행 가능한 행동 후보를 생성한 뒤, 미래 결과와 경제적 가치를 평가하고 행동을 선택하는 것.**

그 과정에서 선수와 팀의 정보는 제한되어야 한다.

상대의 위치를 완벽하게 알고 움직이는 AI는 허용하지 않는다.

선수들은 자신의 관측, 팀원 정보, 이전 경기 경험, 전술 이해도와 능력치를 바탕으로 판단해야 한다.

또한 현재 라운드를 승리하는 것만을 목표로 해서는 안 된다.

장비 보존, 경제 관리, 상대에게 궁극기 포인트를 주지 않는 판단, 상대의 고가 무기 파괴, 궁극기 사용 타이밍, 다음 라운드의 전략적 우위가 모두 행동 선택에 영향을 줘야 한다.

실제 VCT 경기 데이터는 이러한 판단 시스템을 검증하기 위한 중요한 근거다.

따라서 자료 조사는 단순한 참고 링크 수집으로 끝나서는 안 된다.

가능한 범위에서 실제 데이터를 확보하고, 가공하고, 검증하고, 동작하는 시뮬레이션 엔진으로 연결해야 한다.

다만 자료의 존재 여부와 실제 데이터 접근 가능성을 혼동하지 마라.

실제 파일을 확보하지 못했다면 확보하지 못했다고 보고해야 한다.

현재까지의 설계는 완성된 코드가 아니다.

실제 저장소가 존재한다면 상태를 확인하고 기존 작업을 최대한 활용하라.

저장소가 없다면 가장 작은 검증 가능한 프로토타입부터 시작한다.

**당장의 목표는 게임의 완성이 아니라 Ascent에서 현재 경기 상황을 입력받아 실행 가능한 전술 선택지를 생성하고 평가하는 핵심 시스템을 작동시키는 것이다.**

첫 작업으로 프로젝트 환경을 검사하고, 데이터 소스 5개를 검증하며, 실제 또는 명확히 구분된 합성 데이터로 최초 Decision Context를 생성하라.

그다음 Action Generator와 Decision Debugger를 구현하고 테스트한다.

각 작업이 끝나면 이 HANDOFF 문서를 갱신해 다음 AI가 동일한 프로젝트 맥락에서 개발을 이어갈 수 있도록 한다.

---

**END OF HANDOFF**

**Project:** PROJECT V

**Current Stage:** Research / Architecture

**Next Stage:** Data Source Verification & Data Schema Implementation

**First Deliverable:** Verified Source Registry + Minimal Decision Context

**Primary Technical Objective:** Situation-Aware Action Generation

**Long-Term Objective:** Deterministic, Data-Grounded 5v5 VALORANT Tactical Simulation Engine
