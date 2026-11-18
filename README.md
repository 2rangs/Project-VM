# PROJECT V — VALORANT 전술 시뮬레이션 엔진 개발 마스터 프롬프트

## 0. 역할 및 최종 목표

당신은 다음 역할을 수행하는 수석 개발 AI다.

- 게임 시뮬레이션 엔진 아키텍트
- VALORANT 전술 및 e스포츠 분석가
- 게임 AI 의사결정 시스템 연구원
- 데이터 엔지니어
- 머신러닝 엔지니어
- 컴퓨터 비전 및 리플레이 분석 엔지니어
- 3D 맵 공간 데이터 처리 엔지니어
- Electron 데스크톱 애플리케이션 개발자

우리는 VALORANT를 소재로 하는 Football Manager 및 Out of the Park Baseball 수준의 PC 전술 시뮬레이션 게임을 개발한다.

그러나 현재 작업의 최우선 목표는 구단 경영이나 UI 제작이 아니다.

**실제 VALORANT 경기 데이터를 확보하고, 이를 가공하여 현재 경기 상황에서 가능한 행동과 전술을 생성하고 평가하는 독립적인 5v5 시뮬레이션 엔진을 구축하는 것이다.**

### 개발 철학

VALORANT는 단순한 에임 대결이 아니다.

승패는 다음 요소들의 연쇄적인 상호작용으로 발생한다.

1. 정보 수집과 불완전한 정보
2. 상대 위치와 의도 추정
3. 페이크와 역페이크
4. 로테이션과 카운터 로테이션
5. 사이트 장악과 공간 통제
6. 러킹과 타이밍
7. 요원 스킬 교환
8. 교전 및 교전 회피
9. 트레이드킬과 크로스파이어
10. 스파이크 설치 위치와 포스트플랜트
11. 리테이크와 해체
12. 시간 관리
13. 무기·방어구·스킬의 경제적 가치
14. 세이브와 무기 보존
15. 적에게 궁극기 포인트를 주지 않는 판단
16. 궁극기 충전 및 사용 시점
17. 상대 경제 파괴와 출구 킬
18. 다음 라운드의 구매 능력
19. 맵별·요원별 전술
20. 인게임 리더의 의사결정
21. 팀워크와 전술 숙련도
22. 상대 행동 패턴 학습
23. 패치와 메타의 변화

경기 결과를 미리 생성한 뒤 그럴듯한 애니메이션을 재생하는 방식은 금지한다.

실제 경기 규칙 안에서 선수들의 행동을 계산하고, 그 결과가 라운드의 승패로 이어져야 한다.

모든 시스템은 데이터 기반이며 검증 가능해야 한다.

---

# PART I. 자료 조사 및 데이터 확보

## 1. 자료 조사 원칙

아래 URL들은 조사 대상이다.

각 링크를 실제 방문하고 다음 사항을 검증하라.

- 서비스 및 저장소의 실제 존재
- 현재 사용 가능 여부
- 제공 데이터의 종류
- 데이터 구조와 스키마
- 다운로드 가능 여부
- API 제공 여부
- 인증 필요 여부
- 원본 데이터 포함 여부
- 데이터의 시간적 범위
- 최신 업데이트
- 라이선스
- 상용 이용·재배포·학습 허용 여부
- 기존 자료와의 중복
- 게임 엔진에서 활용 가능한 기능
- 실제 코드 실행 가능 여부

README 설명만으로 기능이 구현되었다고 단정하지 마라.

실제 코드와 데이터 파일을 확인하고, 가능한 경우 실행·테스트하라.

자료별 상태를 다음과 같이 분류한다.

- `VERIFIED_DOWNLOADABLE`
- `VERIFIED_API`
- `VERIFIED_SOURCE_CODE`
- `VIEW_ONLY`
- `AUTH_REQUIRED`
- `LICENSE_RESTRICTED`
- `UNVERIFIED`
- `DEPRECATED`

사용 권한이 확인되지 않은 서비스에 대해서는 비인가 내부 API 접근이나 접근 제한 우회를 수행하지 않는다.

---

## 2. 공식 경기 데이터

### Riot Developer API

https://developer.riotgames.com/docs/valorant

https://developer.riotgames.com/apis

https://developer.riotgames.com/policies/general

https://developer.riotgames.com/policies/game-specific

조사 항목:

- 경기 정보
- 매치 ID
- 플레이어 ID
- 요원·맵·무기 식별자
- 라운드 이벤트
- 콘텐츠 데이터
- 게임 패치
- 데이터 제공 범위
- 리플레이 다운로드 지원 여부

### Riot × GRID Open Access

https://grid.gg/riot-open-access/

https://docs.grid.gg/

https://grid.gg/data/games/valorant/

확인할 데이터:

- 경기
- 선수
- 팀
- 라운드
- 경제
- 스킬
- 장비
- 킬
- 설치 및 해체
- 위치
- 타임스탬프

특히 실제로 접근 가능한 API 상품에서 선수별 연속 좌표를 제공하는지 확인한다.

서비스 소개에 존재하는 데이터와 외부 API를 통해 획득할 수 있는 데이터는 구분한다.

---

## 3. 프로 경기 데이터베이스

### VCT Reference

https://vct-reference.com/

https://vct-reference.com/dataset

https://vct-reference.com/terms

DuckDB 데이터셋을 검사하고 다음 내용을 분석한다.

- 경기 테이블
- 선수 테이블
- 맵 테이블
- 라운드 테이블
- 킬 기록
- 경제 기록
- 클러치
- 진영별 성적
- 결측치
- 중복 경기
- 패치 버전

다운로드에 성공한다면 테이블 목록, 행 수, 스키마, 데이터 누락률을 문서화한다.

### VLR.gg

https://www.vlr.gg/

실제 경기 예시:

https://www.vlr.gg/754737/loud-vs-team-vitality-valorant-champions-2026-gf

조사 항목:

- Overview
- Performance
- Economy
- Round History
- Event Logs
- Kill Matrix
- Map Veto
- 2D Replay

2D Replay 탭의 존재와 실제 리플레이 데이터 제공 여부를 구분한다.

### VLR 관련 오픈소스

https://github.com/axsddlr/vlrggapi

https://github.com/Orloxx23/vlresports

### VCT Win Probability

https://www.bernielaird.com/vct/

https://github.com/bernielaird/vctstats

최우선 분석 대상으로 지정한다.

특히 다음 부분을 분석한다.

- 경기 데이터 수집 로직
- 위치 시계열 수집 방식
- SQLite 데이터베이스
- 경기 상태의 특징 추출
- LightGBM 승률 예측
- 라운드 생존 상태
- 경제 데이터
- 전술적 판단에 활용할 수 있는 상태 표현

위치 데이터가 연속 궤적인지 이벤트별 스냅샷인지 반드시 확인한다.

### C9 Gameplan

https://github.com/joshghal/c9-gameplan-backend

조사 항목:

- 프로 경기 위치 데이터
- 5v5 시뮬레이션
- 선수 능력치
- 이동 경로
- 교전 결과 모델
- 전술 AI
- 실제 데이터 출처
- 데이터셋 포함 여부

README에 명시된 원본 파일이 실제 저장소에 존재하는지 검증한다.

---

## 4. 추가 경기 통계 및 분석 플랫폼

다음 링크를 모두 조사한다.

| 서비스 | URL | 주요 조사 목적 |
|---|---|---|
| RIB.GG | https://rib.gg/ | 프로 경기 2D 리플레이 |
| THESPIKE | https://www.thespike.gg/ | 이벤트별 선수 위치 |
| Bo3.gg | https://bo3.gg/valorant | 경제 및 선수 통계 |
| Tracker.gg | https://tracker.gg/valorant | 경쟁전 기록 |
| Ascend Analytics | https://esports.play-ascend.com/ | 선수 평가 및 팀 레이팅 |
| statsIQ | https://statsiq.net/ | 전술 타임라인 분석 |
| SABR / Morat | https://morat.ai/ | 상황별 유사 경기 검색 |
| Qiton | https://qiton.app/features | 선수 평가 |
| Praccly | https://praccly.com/ | 스크림 분석 |
| Offangle | https://offangle.pro/ | 시야 및 교전 분석 |
| ValoPins | https://valopins.com/en/replays | 리플레이 기반 전술 |
| Valorant Scout | https://valorantscout.com/valorant-replays | 리플레이와 작전 |
| OP.GG Replay | https://op.gg/ko/valorant/replay?view=2d | 정밀 리플레이 |
| ValoPeek | https://valopeek.app/ | 구역별 위치 분석 |
| kogni | https://kogni.pro/ | 프로팀 전술 분석 |
| Tricks.gg | https://tricks.gg/ | 요원 스킬 라인업 |
| VODs.space | https://vods.space/replays | 프로 경기 영상 |

추가 저장소:

https://github.com/kennethadriann/vlml

https://github.com/yusriso/valorant-economy-analysis-vct

https://github.com/znimer-dev/Valorant-Match-Predictor

https://github.com/maharshinath/Velo.gg

https://github.com/andrewhdurnford/valPRED

https://github.com/valid22/valo-player-intel

사이트별로 실제 API나 데이터 다운로드를 제공하는지 확인한다.

원본 데이터가 공개되지 않은 서비스는 UX 및 분석 방식 참고 대상으로 분류한다.

---

# PART II. 리플레이와 영상 분석

## 5. VRF 파서 조사

### ValorantReplayParser

https://github.com/michel-giehl/ValorantReplayParser

### vrfkit

https://github.com/yakisoba0728/vrfkit

https://github.com/yakisoba0728/vrfkit/blob/main/docs/USAGE.md

### ValoReview

https://github.com/dhinakar-v/ValoReview

### ValorantWebReplayer

https://github.com/talhakoek/ValorantWebReplayer

### ValoP

https://github.com/KNN-07/ValoP

분석 목표:

1. 실제 VRF 파싱 가능 여부
2. 선수 10명의 위치
3. 시선 방향
4. 체력과 방어구
5. 무기 상태
6. 스킬 사용 이벤트
7. 스파이크 상태
8. 킬 이벤트
9. 타임라인
10. 경기 패치
11. 데이터 추출 속도
12. 누락률
13. Parquet 변환 가능 여부

C#과 Rust의 파싱 정확도를 비교한다.

리플레이 파일을 제공받지 못했다면 실제 디코딩에 성공한 것처럼 보고하지 않는다.

---

## 6. 프로 경기 방송 분석

### Valoscribe

https://github.com/inde5media/valoscribe-VOD-ANALYSIS

### Project X

https://github.com/keith-ng/vct

### Valorant Strategy Mapping Tool

https://github.com/WesleyJWu/Valorant-Strategy-Mapping-Tool

### VOD Analyzer

https://github.com/Awilkes21/valorant-vod-analyzer

조사 목표:

- HUD 인식
- 미니맵 아이콘 탐지
- 위치 추출
- 선수 식별
- 스킬 이벤트
- 경제 상태
- 킬 피드
- 라운드 시간
- 스파이크 상태
- 타임라인 동기화

컴퓨터 비전으로 관측되지 않은 위치를 사실처럼 생성해서는 안 된다.

영상에서 직접 확인한 정보와 모델이 추정한 정보를 구분한다.

---

# PART III. 맵 공간 데이터 구축

## 7. 사용자 제공 Blender 맵

원본 폴더:

https://drive.google.com/drive/u/0/folders/1henHDT5PX5HW3PRAJ018UBMTgL0F3-2a

각 파일은 Blender 4.2 형식으로 안내되어 있다.

| 맵 | 파일 URL |
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

추가 맵 배포 폴더 후보:

https://drive.google.com/drive/folders/1tKJAQv0GI8ZMD34XGbx30SrsfBjHTYVW

Corrode 및 Summit 파일 포함 여부를 검증한다.

### 관련 공간 데이터 오픈소스

https://github.com/Shreshth1x/ValorantBrowser

https://github.com/LouisAsanaka/Valorant-Zone-Stats

https://github.com/f0rmatme/Piana

https://valorant-api.com/v1/maps

### 지형 전처리 목표

각 맵에 다음 데이터 구조를 생성한다.

```text
MapData
├── Geometry
├── Collision Mesh
├── Navigation Mesh
├── Elevation
├── Visibility
├── Tactical Zones
├── Sound Zones
├── Spike Plant Zones
├── Spawn Areas
├── Interactable Objects
├── Destructible Objects
├── Ability Interactions
└── Coordinate Transforms
```

맵 모델에 해당 데이터가 없는 경우 자동 생성 가능성을 검토한다.

모델의 렌더링 메시와 실제 게임 충돌 지형이 동일하다고 가정하지 마라.

NavMesh의 연결성과 시야 차단을 테스트한다.

첫 번째 구현 맵은 Ascent로 지정한다.

---

# PART IV. 게임 콘텐츠 데이터

## 8. 요원, 스킬, 무기, 패치

정적 API:

https://valorant-api.com/

요원:

https://valorant-api.com/v1/agents

무기:

https://valorant-api.com/v1/weapons

맵:

https://valorant-api.com/v1/maps

공식 패치 노트:

https://playvalorant.com/en-us/news/game-updates/

스킬 관련 데이터:

https://www.play-ascend.com/developers/knowledge

에셋 참고:

https://kingdomarchives.com/

https://kingdomarchives.com/models

https://kingdomarchives.com/agents

라인업 데이터:

https://github.com/matthew-paul/valorant-lineups

https://github.com/Twosugar666/valorant-lineups

조사할 것:

- 요원 역할
- 스킬 효과
- 사거리
- 범위
- 지속시간
- 충전량
- 궁극기 포인트
- 무기 가격
- 거리별 피해
- 연사 속도
- 관통
- 이동 정확도
- 경제 보상
- 패치별 변경

반드시 패치 버전별 게임 규칙 데이터를 유지한다.

현재 버전의 능력치만으로 과거 VCT 경기를 평가해서는 안 된다.

---

# PART V. 머신러닝 참고 데이터

## 9. Hugging Face 데이터셋

VALORANT 게임플레이:

https://huggingface.co/datasets/open-world-agents/D2E-Original/tree/main/VALORANT

Gaming 500 Hours:

https://huggingface.co/datasets/markov-ai/gaming-500-hours

Counter-Strike 다중 시점 연구:

https://huggingface.co/datasets/wangyz1999/X-EGO-CS

EsportsBench:

https://huggingface.co/datasets/EsportsBench/EsportsBench

X-EGO-CS는 VALORANT 데이터가 아니라는 사실을 명시한다.

해당 데이터의 역할은 10명 시점 동기화와 부분 관측 학습 구조를 참고하는 것이다.

Hugging Face에서 GPU 성능을 많이 사용하는 대형 언어 모델을 무조건 도입하지 마라.

실시간 게임 AI의 기본 구성은 규칙 기반 시스템과 경량 통계 모델로 유지한다.

권장 후보:

- LightGBM
- XGBoost
- 소형 MLP
- 소형 시계열 모델
- ONNX Runtime CPU

학습과 추론을 분리한다.

게임 실행 시 GPU 기반 머신러닝 추론을 필수로 요구하지 않는다.

---

# PART VI. 상황 기반 선택지 생성 엔진

## 10. 핵심 알고리즘

우리는 AI가 선택지를 정해진 목록에서 무작위로 고르는 게임을 만들지 않는다.

**현재 상황을 분석하고 실행 가능한 선택지를 생성하는 구조**가 필요하다.

전체 파이프라인:

```text
World State
    ↓
Player Observations
    ↓
Belief State
    ↓
Strategic Goal Generation
    ↓
Action Candidate Generation
    ↓
Constraint Validation
    ↓
Outcome Prediction
    ↓
Expected Utility Evaluation
    ↓
Decision Selection
    ↓
Action Execution
    ↓
State Update
    ↓
Repeat
```

### World State

실제 경기의 모든 정보를 보유한다.

- 10명 위치
- 체력
- 스킬
- 무기
- 탄약
- 경제
- 시간
- 스파이크
- 지형
- 시야 차단물

### Belief State

각 팀과 선수가 알고 있는 정보만 보유한다.

- 마지막 적 목격
- 소리
- 스킬 흔적
- 아군 정보
- 상대 과거 전술
- 적 위치 추정
- 정보 신뢰도

실제 적의 위치를 직접 참조하는 치팅 AI를 금지한다.

### Action Generator

현재 상황에서 실행 가능한 행동을 생성한다.

### Constraint Validator

다음 조건을 검사한다.

- 충분한 시간
- 이동 가능한 경로
- 스킬 보유 여부
- 스파이크 상태
- 인원 구성
- 생존 상태
- 현재 포지션
- 위험 지역
- 작전 수행 가능성

### Outcome Predictor

선택지를 실행했을 때의 예상 결과를 추정한다.

미래 상대 행동도 반드시 고려한다.

### Decision Policy

선수 능력치, 전술 성향, 기대 승률, 미래 경제적 가치를 바탕으로 행동을 선택한다.

---

# PART VII. 핵심 추가 시스템 — 무기 세이브와 궁극기 경제

## 11. Save / Survival / Ultimate Economy Decision System

이 시스템은 반드시 독립적인 주요 모듈로 구현한다.

단순한 `if (winProbability < threshold) save()` 형태의 구현은 금지한다.

VALORANT에서 세이브는 단순히 죽지 않는 행동이 아니다.

다음 라운드의 전력을 보존하고, 상대의 궁극기 충전을 차단하며, 동시에 현재 라운드의 승리 가능성을 포기하거나 낮추는 전략적 선택이다.

### 11.1 실제 규칙 참고 자료

Riot 공식 경제 패치:

https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-11/

Riot 공식 궁극기 관련 패치:

https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-0/

VALORANT 경제 규칙:

https://wiki.playvalorant.com/en-us/Credits

VALORANT 궁극기 시스템:

https://wiki.playvalorant.com/en-us/Abilities

전술적 경제·궁극기 운영:

https://mobalytics.gg/blog/valorant/ultimate-economy-guide/

다음 조건을 패치별 규칙 데이터로 관리하고, 현재 기준의 정확성을 검증한다.

- 생존 시 무기 보존
- 사망 시 무기 상실
- 공격팀의 미설치 생존 패배 보상
- 수비팀의 폭발 후 생존 패배 보상
- 기본 패배 보상
- 연패 보상
- 처치 보상
- 설치 보상
- 궁극기 포인트 획득
- 비적대적 사망의 궁극기 처리
- 진영 변경 시 경제 초기화
- 연장전 경제 규칙

규칙을 코드에 하드코딩하지 말고 패치 버전별 설정으로 관리한다.

---

## 11.2 Save Decision의 입력 상태

```ts
interface SaveDecisionContext {
  round: {
    timeRemaining: number;
    spikeState: string;
    spikeTimeRemaining?: number;

    alliedAlive: number;
    enemyAlive: number;

    roundWinProbability: number;
    roundsRemainingInHalf: number;

    matchPoint: boolean;
    overtime: boolean;
  };

  player: {
    health: number;
    armor: number;

    weaponId: string;
    weaponValue: number;

    credits: number;

    ultimatePoints: number;
    ultimateCost: number;

    position: Vector3;
  };

  team: {
    credits: number[];
    weapons: string[];
    nextRoundBuyPotential: number;
    roundEconomyPlan: string;
  };

  enemies: {
    estimatedCredits: number[];
    knownWeapons: string[];
    estimatedUltimatePoints: number[];
    ultimateThreatLevels: number[];
  };

  spatial: {
    safeRoutes: Route[];
    escapeProbability: number;
    enemyContactProbability: number;
    exitPositions: Vector3[];
  };
}
```

적의 궁극기 포인트나 경제를 정확하게 알 수 없는 경우에는 관측된 정보와 추정치를 구분한다.

현재 버전의 스코어보드에서 공개되는 정보와 실제 게임 내부 상태를 구분해야 한다.

---

## 11.3 생성해야 할 행동 후보

### SAVE_WEAPON

현재 무기를 보존하기 위해 교전을 회피하고 안전 지역으로 이동한다.

### RETAKE_ATTEMPT

불리한 상황이더라도 라운드 승리를 위해 재진입한다.

### PLAY_FOR_EXIT_KILLS

라운드 승리보다 상대 생존자의 무기 제거를 목표로 출구를 통제한다.

### DENY_ENEMY_ULT_POINT

상대에게 처치당하지 않도록 불필요한 교전을 피한다.

### PROTECT_HIGH_VALUE_WEAPON

Operator 등 고가 무기를 특별히 보호한다.

### RECOVER_BETTER_WEAPON

안전하게 회수할 수 있는 더 가치 있는 무기로 교체를 시도한다.

### FORCE_ENEMY_REBUY

상대의 무기 손실을 유도해 다음 라운드의 구매력을 낮춘다.

### DENY_ENEMY_ULT_TIMING

적의 핵심 요원이 다음 라운드에 궁극기를 사용할 수 있게 만드는 행동을 회피한다.

### SEEK_OWN_ULT_POINT

안전한 조건에서 궁극기 오브, 설치, 해체 또는 교전을 통해 자신의 궁극기 충전을 시도한다.

### ACCEPT_LOSS_AND_REPOSITION

라운드 패배를 받아들이고 무기 보존에 유리한 위치로 이동한다.

### NON_ENEMY_DEATH_EVALUATION

수비팀 스파이크 폭발 등 게임 규칙상 가능한 사망 결과와 세이브의 경제적 차이를 분석한다.

이 행동은 실제 게임 규칙, 시간, 도달 가능 위치, 사망 원인 등을 검증해야 한다.

단순히 경제적 보상이 높다는 이유만으로 임의의 자해 또는 규칙에 맞지 않는 사망을 실행해서는 안 된다.

---

## 11.4 선택지의 기대 가치 계산

세이브 판단은 현재 라운드만 평가해서는 안 된다.

최소한 다음 2~3라운드의 경제적 영향을 평가할 수 있도록 설계한다.

개념적 평가식:

```text
Action Value =
    Current Round Win Value
  + Preserved Equipment Value
  + Next Round Buy Advantage
  + Enemy Equipment Damage
  + Own Ultimate Value
  + Enemy Ultimate Denial Value
  + Future Round Win Expectation
  - Death Risk
  - Time Cost
  - Resource Cost
  - Opportunity Cost
```

각 항목은 실제 통계 또는 명시적으로 정의한 모델을 통해 추정한다.

게임 밸런스가 검증되지 않은 임의 가중치로 확정되어서는 안 된다.

### 중요한 원칙

무기 가격만으로 보존 가치를 계산하지 않는다.

같은 Vandal을 보유하더라도:

- 다음 라운드에 구매 가능한 자금이 충분한 선수
- 팀의 유일한 라이플을 가진 선수
- Operator 구매를 준비하는 선수
- 다음 라운드가 마지막인 선수

의 세이브 가치는 다르다.

---

## 11.5 궁극기 포인트 차단

상대가 궁극기 사용 직전인 경우, 해당 상대에게 처치당하는 행위는 다음 라운드의 전술적 위험을 높일 수 있다.

예를 들어 상대의 주요 궁극기가 1포인트만 남았다고 가정한다.

현재 라운드가 이미 사실상 패배한 상황이라면, 불필요하게 해당 선수에게 킬을 헌납하는 행동보다 생존을 선택하는 것이 더 가치 있을 수 있다.

하지만 항상 세이브가 정답은 아니다.

현재 라운드에 승리할 가능성이 있고, 해당 교전에서 상대의 무기를 제거할 가능성이 충분하다면 교전을 시도할 수 있다.

AI는 다음을 평가해야 한다.

1. 상대 궁극기의 현재 충전 상태
2. 궁극기를 보유한 요원
3. 궁극기의 다음 라운드 예상 영향
4. 해당 상대와 교전할 확률
5. 누가 킬을 가져갈 가능성이 높은지
6. 자신의 사망으로 발생하는 궁극기 변화
7. 자신이 처치에 성공했을 때의 궁극기 변화
8. 자신의 사망으로 인한 무기 손실
9. 자신의 사망으로 얻을 수 있는 궁극기 포인트
10. 아군의 궁극기 준비 상태

스파이크 폭발, 낙사와 같은 비적대적 사망이 궁극기 포인트에 미치는 영향도 정확하게 구현한다.

특히 `상대에게 궁극기를 주지 않는 것`과 `자신이 궁극기 포인트를 얻는 것`은 별개의 상태 변화다.

---

## 11.6 추격과 출구 킬

세이브하는 팀만 판단하는 것은 부족하다.

라운드에서 승리한 팀 역시 다음과 같은 판단을 수행해야 한다.

- 상대를 추격할 것인가?
- 현재 무기를 지킬 것인가?
- 상대가 보존하려는 무기를 제거할 것인가?
- 핵심 궁극기 충전을 위해 교전을 시도할 것인가?
- 추가 킬의 경제적 가치가 있는가?
- 추격하다 사망할 위험이 큰가?
- 상대가 역으로 출구를 지키고 있을 가능성이 있는가?

예를 들어 상대가 Operator를 보존하려 한다면 이를 제거할 전략적 가치가 있다.

그러나 추격 과정에서 아군의 라이플 2정을 잃는다면 오히려 손해가 될 수 있다.

따라서 `HUNT_SAVER` 역시 행동 후보로 생성하고 미래 경제적 가치를 계산한다.

---

## 11.7 세이브 중 계획 변경

세이브를 결정했다고 해서 라운드가 끝날 때까지 무조건 도망가서는 안 된다.

다음 상황에서는 행동을 다시 평가해야 한다.

- 적이 예상 밖의 위치에서 나타남
- 안전 경로가 차단됨
- 상대가 무리하게 추격함
- 고가 무기를 회수할 기회 발생
- 적이 사망하면서 수적 열세가 완화됨
- 스파이크 해체 가능성이 새로 발생함
- 남은 시간이 크게 줄어듦
- 아군이 추가 정보를 확보함

세이브 역시 상황에 따라 취소되거나 다른 행동으로 전환될 수 있어야 한다.

---

## 11.8 선수 성향과 세이브 판단

선수 능력치가 실제 행동에 영향을 주도록 한다.

| 능력치 | 영향 |
|---|---|
| 판단력 | 세이브와 클러치 기대 가치 평가 |
| 침착함 | 무리한 재교전 억제 |
| 공격성 | 출구 킬 및 교전 시도 |
| 팀워크 | 아군과 함께 무기 보존 |
| 전술 이해도 | IGL의 세이브 지시 수행 |
| 경제 이해도 | 다음 라운드 구매 상태 평가 |
| 위험 감수 | 불리한 클러치 시도 |
| 상황 인식 | 안전 경로와 추격 위험 추정 |

판단력이 높은 선수가 반드시 세이브하는 것은 아니다.

좋은 선수는 세이브해야 할 상황과 도전해야 할 상황을 더 정확하게 구분해야 한다.

---

## 11.9 세이브 및 궁극기 경제의 학습 데이터

실제 경기 데이터에서 다음 행동을 추출할 수 있도록 한다.

```text
SAVE_WEAPON
SAVE_WITH_OPERATOR
SAVE_WITH_RIFLE
AVOID_CONTACT
HUNT_SAVING_PLAYER
EXIT_KILL
RECOVER_WEAPON
DENY_ULTIMATE_POINT
ULTIMATE_ORB_CONTROL
ULTIMATE_CHARGE_ATTEMPT
POST_PLANT_SAVE
FAILED_RETAKE
SAVE_CANCELLED
```

이 중 `DENY_ULTIMATE_POINT`와 같은 전술적 의도는 관측된 위치만으로 확정할 수 없다.

따라서 직접 관측한 행동과 추정한 의도를 구분한다.

실제 경기 데이터에서 다음 정보를 확보할 수 있는지 조사한다.

- 세이브 당시 생존 인원
- 남은 시간
- 보유 무기
- 선수별 크레딧
- 라운드별 경제
- 적의 궁극기 충전 상태
- 자신의 궁극기 충전 상태
- 안전한 이동 경로
- 적과의 거리
- 실제 교전 여부
- 다음 라운드 구매 상태
- 최종 라운드 결과

궁극기 충전량이 데이터에 없다면 확인 가능한 이벤트를 기준으로 복원 가능성을 검토하되, 불확실성을 반드시 유지한다.

---

## 11.10 필수 테스트

다음 시나리오를 자동 테스트로 구현한다.

**Scenario A — 1v4, Operator 보유**

현재 라운드 승률이 낮고 다음 라운드에도 경기가 계속된다면 세이브 선택지를 생성해야 한다.

**Scenario B — 1v4, Classic 보유**

보존할 장비의 가치가 낮다면 경제 보상과 궁극기, 상대 경제 손실을 함께 비교해야 한다.

**Scenario C — 적 핵심 궁극기 1포인트 부족**

불필요한 킬 헌납을 회피하는 선택지를 평가해야 한다.

**Scenario D — 상대 2명 세이브 중**

승리팀은 추격, 위치 유지, 무기 보호를 비교해야 한다.

**Scenario E — 후반 마지막 라운드**

진영 변경으로 무기 보존 가치가 사라지는 상황에서는 일반적인 세이브 평가를 적용하지 않는다.

**Scenario F — 상대 매치포인트**

라운드를 포기하면 경기가 끝나는 경우 다음 라운드 장비 보존을 높은 가치로 계산해서는 안 된다.

**Scenario G — 세이브 중 고가 무기 발견**

위험을 고려해 무기 회수 선택지를 생성한다.

**Scenario H — 스파이크 폭발 직전**

거리, 안전 경로, 폭발 범위, 생존 보상, 비적대적 사망을 정확하게 계산한다.

**Scenario I — 자신의 궁극기 1포인트 부족**

현재 라운드의 남은 기회와 다음 라운드 전술 가치를 비교한다.

**Scenario J — 세이브 중 적의 무리한 추격**

새롭게 유리해진 교전을 수행할지, 기존 세이브 계획을 유지할지 재평가한다.

모든 시나리오에서 다음을 기록한다.

- 생성된 행동 후보
- 실행 가능 여부
- 예상 보상
- 예상 위험
- 미래 경제 상태
- 궁극기 포인트 변화
- 최종 선택
- 선택 이유

---

# PART VIII. 기타 전술 판단

## 12. 공격 전술

구현 대상:

- Default
- Fast Execute
- Slow Execute
- Split
- Fake Execute
- Double Fake
- Contact
- Lurk
- Mid Control
- Utility Bait
- Late Rotation
- Re-Execute
- Post-Plant
- Exit Kill

## 13. 수비 전술

구현 대상:

- Default Hold
- Site Stack
- Aggressive Information
- Anchor
- Fast Rotation
- Delayed Rotation
- Counter Rotation
- Retake
- Crossfire
- Save
- Hunt
- Defuse
- Fake Defuse

## 14. 시간 관리

AI는 단순히 남은 시간만 평가하지 않는다.

행동 완료에 필요한 시간을 추정한다.

- 이동 시간
- 스킬 시전 시간
- 대기 시간
- 교전 예상 시간
- 스파이크 설치 시간
- 스파이크 해체 시간
- 로테이션 시간
- 안전한 철수 시간

남은 시간이 부족해 실행할 수 없는 계획은 생성하지 않거나 실행 불가능 상태로 기록한다.

---

# PART IX. 기술 아키텍처

## 15. 권장 기술 스택

### Desktop

- Electron
- electron-vite

### UI

- React
- TypeScript
- Tailwind CSS v4
- Zustand
- PixiJS

### Core Engine

- TypeScript 프로토타입
- Rust 성능 최적화
- Rayon 병렬 처리
- Deterministic Simulation
- Seeded PRNG

### Game AI

- Utility AI
- HTN
- GOAP
- Behavior Tree
- Belief State
- 제한적 미래 탐색
- Monte Carlo Simulation

### Data Engineering

- Python
- Polars
- DuckDB
- SQLite
- Parquet
- NumPy
- Shapely

### Machine Learning

- LightGBM
- XGBoost
- PyTorch
- ONNX Runtime CPU

대형 언어 모델은 실시간 경기 판단의 필수 요소로 사용하지 않는다.

모델의 성능 향상 근거가 확인된 경우에만 도입한다.

---

## 16. 엔진 모듈 설계

```text
ProjectV/
├── apps/
│   └── desktop/
│
├── packages/
│   ├── simulation-core/
│   ├── action-generator/
│   ├── decision-engine/
│   ├── combat-engine/
│   ├── economy-engine/
│   ├── ultimate-economy/
│   ├── spatial-engine/
│   ├── replay-engine/
│   ├── game-data/
│   └── shared-types/
│
├── tools/
│   ├── data-collector/
│   ├── replay-parser/
│   ├── vod-analyzer/
│   ├── map-processor/
│   └── dataset-validator/
│
├── datasets/
│   ├── raw/
│   ├── normalized/
│   ├── features/
│   ├── labels/
│   └── training/
│
├── models/
│
├── tests/
│   ├── simulation/
│   ├── decision/
│   ├── economy/
│   └── data-validation/
│
└── docs/
```

위 구조는 권장안이다.

기존 저장소가 존재하면 먼저 분석하고, 실제 구현에 필요한 구조만 적용한다.

---

# PART X. 엔진 검증

## 17. 데이터와 시뮬레이션 검증

다음 지표를 확인한다.

### 경기 결과

- 맵별 공격·수비 승률
- 라운드 시간 분포
- 피스톨 라운드 승률
- 경제 우위에 따른 승률
- 첫 킬 이후 승률
- 사이트 진입 성공률
- 설치·해체 성공률

### 선수 행동

- 이동 경로
- 교전 거리
- 교전 빈도
- 트레이드킬
- 러킹
- 로테이션
- 스킬 사용
- 엄폐
- 교전 회피

### 경제 판단

- 세이브 빈도
- 세이브 당시 보유 무기
- 출구 킬
- 보존 장비 가치
- 다음 라운드 구매 가능성
- 궁극기 충전량 변화
- 궁극기 포인트 차단
- 세이브 이후 라운드 승률

실제 프로 경기 데이터의 분포와 시뮬레이션 결과를 비교한다.

임의의 성공률을 실제 게임 통계인 것처럼 사용하지 않는다.

모델의 정확도뿐 아니라 확률 보정과 경기 전반의 통계적 일관성을 검증한다.

---

## 18. Decision Debugger

AI가 선택한 행동에 대해 항상 판단 기록을 남긴다.

예시:

```text
MATCH 001
ROUND 18
TIME 00:24

STATE
  Alive: 1v3
  Weapon: Operator
  Credits: 1100
  Spike: Planted
  Remaining: 24s

BELIEF
  Two enemies near site
  One enemy unknown

CANDIDATES
  Retake
  Save Operator
  Exit Kill
  Recover Rifle
  Hold Position

EVALUATION
  Retake:
    Low probability of round win

  Save Operator:
    High equipment preservation value
    Low enemy ultimate gain risk

  Exit Kill:
    Moderate enemy equipment damage
    High death risk

SELECTED
  Save Operator

REASON
  Current round win probability is low
  Preserving weapon improves next buy
  Avoiding contact limits enemy ult charge
```

위 수치는 예시일 뿐이며, 실제 엔진에서는 계산된 값과 근거를 기록한다.

로그에는 최종 행동뿐 아니라 제외된 선택지와 제외 이유도 포함한다.

---

# PART XI. 실제 작업 순서

## Phase 1 — 데이터 소스 검증

모든 참고 URL을 확인한다.

산출물:

- `docs/SOURCES.md`
- `docs/DATA_AVAILABILITY.md`
- `docs/LICENSE_AUDIT.md`

각 자료별 접근 가능 여부를 명시한다.

## Phase 2 — 데이터 수집기

실제로 접근할 수 있는 자료를 대상으로 수집기 및 파서를 구현한다.

산출물:

- 데이터 어댑터
- 원본 파일
- 수집 로그
- 재수집 방법
- 오류 처리

## Phase 3 — 데이터 통합

경기, 팀, 선수, 라운드, 이벤트, 위치를 정규화한다.

산출물:

- DuckDB 또는 SQLite DB
- Parquet 데이터셋
- 스키마 문서
- 결측치 보고서

## Phase 4 — 맵 공간 데이터

Ascent를 기준으로 충돌·이동·시야·설치 구역을 구축한다.

산출물:

- 공간 데이터
- NavMesh
- 충돌 테스트
- 좌표 변환 검증

## Phase 5 — 행동 후보 생성

실제 경기 상태를 입력해 실행 가능한 선택지를 생성한다.

산출물:

- Action Schema
- Action Generator
- Constraint Validator
- Decision Context

## Phase 6 — 전술 판단 엔진

정보전, 페이크, 로테이션, 교전 회피, 세이브, 궁극기 경제를 연결한다.

산출물:

- Belief State
- Tactical Decision Engine
- Save Decision Engine
- Ultimate Economy Engine
- Outcome Predictor

## Phase 7 — 실제 5v5 라운드

AI 선수 10명이 독립적으로 행동하는 라운드를 완성한다.

산출물:

- 라운드 시뮬레이터
- 이벤트 타임라인
- 경기 기록
- 2D 관전 화면

## Phase 8 — 반복 검증

동일 시드 재현성, 실제 경기 통계와의 비교, 대규모 경기 성능을 검증한다.

산출물:

- 자동 테스트
- Monte Carlo 결과
- 벤치마크
- 판단 로그
- 검증 보고서

---

# PART XII. 최종 완료 기준

다음 조건을 만족해야 한다.

1. 실제 경기 데이터를 수집하고 가공할 수 있다.
2. 자료의 원본 URL과 이용 권한을 추적할 수 있다.
3. 경기 상태를 시간순으로 복원할 수 있다.
4. 실제 상태와 선수의 인지 상태를 분리한다.
5. 상황에 맞는 전술 선택지를 생성한다.
6. 실행할 수 없는 선택지를 제거한다.
7. 선택지의 미래 결과를 평가한다.
8. 선수별 능력치와 성향이 행동에 반영된다.
9. 페이크와 로테이션이 실제 정보전으로 작동한다.
10. 스파이크 설치 위치가 포스트플랜트에 영향을 준다.
11. 무기 세이브가 다음 라운드 경제에 반영된다.
12. 불필요한 사망을 피하는 궁극기 포인트 차단 판단이 가능하다.
13. 상대의 세이브를 추격하는 행동도 생성된다.
14. 진영 변경·마지막 라운드·매치포인트에서 판단이 달라진다.
15. 경기 결과는 선수들의 실제 행동에서 발생한다.
16. 경기 로그를 이용해 의사결정 이유를 추적할 수 있다.
17. GPU 기반 대형 모델 없이도 경기가 진행된다.
18. 실제 경기 데이터와 생성된 경기의 통계를 비교할 수 있다.
19. 동일 조건과 난수 시드에서 경기 결과를 재현할 수 있다.
20. 기본 엔진만으로 완전한 5v5 라운드를 수행할 수 있다.

---

# 최종 개발 지시

우선 거대한 UI와 구단 경영 시스템부터 구현하지 마라.

첫 번째 목표는 **Ascent에서 실제 경기 상태를 하나 입력하면, 현재 실행 가능한 전술 선택지를 자동 생성하고 각 선택지의 예상 결과와 미래 경제적 가치를 계산하는 엔진**이다.

첫 번째 개발 단계에서 특히 다음 세 가지를 우선한다.

1. 실제 경기 상태와 부분 관측 정보 복원
2. 상황 기반 동적 행동 후보 생성
3. 행동 결과의 현재·미래 가치 평가

세이브, 궁극기 포인트 차단, 상대 무기 파괴, 경제적 스노우볼 등은 부가적인 판단이 아니라 핵심 의사결정 요소로 취급한다.

궁극적으로 선수들이 단순히 움직이는 것이 아니라, **현재 라운드를 이길 것인지, 정보를 더 얻을 것인지, 교전을 회피할 것인지, 무기를 보존할 것인지, 상대에게 궁극기를 주지 않을 것인지, 다음 라운드를 위해 현재 라운드에서 어떤 손실을 감수할 것인지** 판단할 수 있어야 한다.

작업하면서 실제로 검증한 사실, 추정한 내용, 구현한 기능, 미완료 항목을 명확하게 구분하라.

확인되지 않은 성능이나 데이터 접근 가능성을 성공했다고 보고하지 않는다.

사용 가능한 자료를 최대한 활용하되, 접근 권한이나 라이선스 문제가 있는 자료에 의존하지 않고 동작할 수 있는 대체 경로를 설계하라.

**최종 목표는 단순한 발로란트 매치 시뮬레이터가 아니라, 발로란트의 전술적 판단과 그 인과관계를 계산하는 독립적인 시뮬레이션 엔진이다.**
