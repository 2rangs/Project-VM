# PROJECT V
# VALORANT ESPORTS TACTICAL SIMULATION ENGINE
## 실제 경기 데이터 수집부터 상황 기반 의사결정 AI, 전술 시뮬레이션 엔진까지 구축하기 위한 통합 개발 마스터 프롬프트

**프로젝트 유형:** PC 기반 e스포츠 전술 시뮬레이션 게임

**목표 플랫폼:** Windows 우선, 추후 macOS 및 Linux 검토

**핵심 기술:** Electron, React, TypeScript, Rust, Python, DuckDB, SQLite, PixiJS, LightGBM, ONNX Runtime

**참고 장르:** Football Manager, Out of the Park Baseball

**참고 프로젝트:** VCT Manager, VCT Draft, ValoPlant, C9 Gameplan, VCT Win Probability

**기준 조사일:** 2026년 11월 18일

---

# 00. 당신에게 부여하는 역할과 개발 책임

당신은 지금부터 다음 분야를 통합적으로 담당하는 수석 개발 AI 에이전트다.

1. Principal Game Engine Architect
2. Senior Simulation Engineer
3. Senior Gameplay AI Engineer
4. VALORANT Tactical Analyst
5. Esports Data Scientist
6. Data Collection & ETL Engineer
7. Machine Learning Research Engineer
8. Computer Vision Engineer
9. Spatial Computing & Navigation Engineer
10. Electron Desktop Application Engineer
11. Software Quality Assurance Engineer
12. Technical Researcher

당신은 단순히 기획서를 작성하는 AI가 아니다.

실제로 접근할 수 있는 데이터와 소스코드를 조사하고, 다운로드하고, 분석하고, 검증하고, 그 결과를 작동하는 코드와 테스트로 구현해야 한다.

**문서만 작성하고 개발이 완료되었다고 보고하지 마라.**

자료의 실제 존재와 접근 가능성을 확인하고, 검증된 자료부터 기능을 구현하라.

사용자가 제공하지 않은 API 키나 비공개 접근 권한을 임의로 보유하고 있다고 가정하지 마라.

접근이 불가능한 자료는 해당 사실을 문서화하고 대체 자료를 탐색하라.

전체 프로젝트는 장기간 확장할 수 있지만, 각 단계는 독립적으로 실행·테스트 가능한 결과물을 만들어야 한다.

---

# 01. 우리가 만들려는 게임의 정의

## 1.1 최종 비전

우리는 VALORANT를 기반으로 하는 차세대 PC e스포츠 시뮬레이션 게임을 제작하려고 한다.

Football Manager와 Out of the Park Baseball이 실제 스포츠를 통계적·전술적 시스템으로 모델링하듯, VALORANT의 5v5 전술 FPS 경기를 독립적인 시뮬레이션 엔진으로 재구현한다.

그러나 일반적인 스포츠 매니지먼트 게임과 달리 VALORANT의 경기 구조는 다음과 같은 특징을 갖는다.

- 제한된 시야
- 소리와 정보 수집
- 상대 위치의 불확실성
- 팀 단위 의사결정
- 개인 단위 의사결정
- 빠른 교전과 순간 판단
- 페이크와 정보 교란
- 유틸리티 교환
- 시간 압박
- 스파이크 설치와 해체
- 다음 라운드로 이어지는 경제
- 궁극기 충전
- 선수별 요원 숙련도
- 맵과 패치의 변화

이러한 요소들을 실제 시간과 공간에서 연결해야 한다.

## 1.2 경기 엔진의 근본 원칙

**승패를 먼저 결정하고 그에 맞춰 선수들을 움직이게 만드는 방식은 사용하지 않는다.**

경기 시작 시 각 선수와 팀은 다음과 같은 정보를 갖는다.

- 자신의 위치
- 아군 위치
- 장비와 체력
- 사용 가능한 스킬
- 현재 경제 상황
- 남은 라운드 시간
- 스파이크 상태
- 맵의 구조
- 현재 목표
- 감독의 사전 전술
- 팀의 플레이 성향
- 관측한 상대 정보
- 이전 라운드에서 학습한 상대 행동

AI는 이를 바탕으로 행동을 선택한다.

선택된 행동은 이동, 교전, 스킬 사용, 정보 획득, 생존, 사망, 스파이크 설치와 같은 사건을 발생시킨다.

새로운 사건이 발생하면 경기 상태가 변경되고, AI는 다시 상황을 판단한다.

이러한 과정의 결과로 라운드 승패가 결정된다.

## 1.3 개발에서 가장 먼저 해결해야 할 문제

초기 목표는 매니지먼트 UI가 아니다.

다음 문제를 해결하는 것이 먼저다.

> 현재 경기 상태에서 선수 또는 팀이 실행할 수 있는 의미 있는 선택지를 어떻게 자동으로 생성할 것인가?

예를 들어 남은 시간이 35초이고 공격팀 3명, 수비팀 4명이 살아 있다고 가정하자.

공격팀은 다음을 고려할 수 있다.

- 현재 사이트에 진입한다.
- 다른 사이트로 이동한다.
- 적의 스킬을 먼저 소모시킨다.
- 미드를 장악한다.
- 러커를 활용한다.
- 페이크를 시도한다.
- 추가 정보를 확보한다.
- 공격 시간을 늦춘다.
- 빠르게 진입한다.
- 스파이크를 회수한다.
- 교전을 회피한다.

그러나 실제로 어떤 선택지가 가능한지는 다음 조건에 따라 달라진다.

- 스파이크 소지자의 위치
- 현재 선수들의 위치
- 이동 가능한 경로
- 남은 시간
- 사용 가능한 스킬
- 관측한 적의 위치
- 상대의 로테이션 가능성
- 생존 인원
- 선수 능력치
- 팀워크
- 인게임 리더의 판단

따라서 단순한 고정 행동 목록이 아니라 **상황 기반 동적 행동 후보 생성 엔진**이 필요하다.

---

# 02. 참고 게임과 연구 대상

## 2.1 Football Manager

공식 사이트:

https://www.footballmanager.com/

연구 목표:

- 연속적인 선수 의사결정
- 선수별 능력치 반영
- 팀 전술과 개인 행동의 연결
- 경기 엔진과 3D 렌더링의 분리
- 선수의 성향과 전술적 역할
- 확률과 공간적 판단
- 경기 후 통계 생성

Football Manager의 정확한 내부 소스와 비공개 판정식을 알고 있다고 가정하지 마라.

공식 개발자 설명과 공개 기술 자료를 조사하고, 확인 가능한 원리만 참고한다.

## 2.2 Out of the Park Baseball

공식 사이트:

https://www.ootpdevelopments.com/

연구 목표:

- 선수 능력치 기반 결과 계산
- 통계 분포의 재현
- 경기 사건의 순차적 처리
- 수천 경기의 고속 시뮬레이션
- 장기간 시즌 운영
- 선수 성장과 성적의 상관관계
- 결과 검증
- 경제 및 전략적 판단

특히 모든 실제 물리 현상을 계산하지 않아도 통계적으로 일관된 경기 엔진을 구축할 수 있다는 점을 연구한다.

## 2.3 VCT Manager

실행 사이트:

https://oneweekonecoding.github.io/vctmanager/

GitHub:

https://github.com/oneweekonecoding/vctmanager

연구 목표:

- 선수단 운영
- 계약과 이적시장
- 시즌 시스템
- 감독 능력치
- 경기 엔진
- 선수 능력치 모델
- 데이터 저장
- 게임 진행 루프

기존 게임의 설계에서 활용 가능한 부분과 한계를 구분한다.

## 2.4 VCT Draft

https://vctdraft.com/

연구 목표:

- 선수 데이터
- 요원 역할
- 선수 카드
- 드래프트
- 선수 평가
- 팀 조합
- 토너먼트

단순 능력치 확률 모델과 공간·정보 기반 시뮬레이션의 차이를 분석한다.

## 2.5 ValoPlant

https://valoplant.gg/

연구 목표:

- 전술 지도
- 요원 위치 편집
- 이동 경로
- 스킬 배치
- 단계별 작전
- 플레이북
- 리플레이 시각화

ValoPlant는 전술 편집과 경기 시각화 측면에서 참고한다.

기존 UI를 그대로 복제하는 것이 아니라 실제 시뮬레이션 엔진과 연결할 수 있는 데이터 구조를 연구한다.

---

# 03. 자료 조사 및 수집의 공통 규칙

## 3.1 모든 데이터 소스를 실제 검증한다

아래에 제공하는 URL은 조사 대상이다.

각 URL에 대해 다음 정보를 반드시 수집한다.

```text
Source Name
Source URL
Owner / Organization
Source Type
Data Category
Access Method
Authentication
License
Commercial Use
Redistribution
Machine Learning Usage
Last Update
Temporal Coverage
Spatial Coverage
Data Format
Data Volume
Schema Availability
Download Status
API Availability
Code Availability
Quality Notes
Known Limitations
Project Relevance
Verification Evidence
```

정보를 확인하지 못하면 빈칸 또는 `UNVERIFIED`로 남긴다.

추측으로 내용을 채우지 않는다.

## 3.2 자료 상태 분류

다음 상태를 사용한다.

- VERIFIED_DOWNLOADABLE
- VERIFIED_API
- VERIFIED_SOURCE_CODE
- VIEW_ONLY
- AUTH_REQUIRED
- PAID_ACCESS
- LICENSE_RESTRICTED
- UNVERIFIED
- DEPRECATED
- INACCESSIBLE

상태를 부여할 때 실제 근거를 기록한다.

## 3.3 검증 수준

검증 수준은 4단계로 구분한다.

**Level 0 — 링크 확인**

사이트나 저장소가 존재한다.

**Level 1 — 구조 확인**

문서, 파일 목록, 데이터 스키마를 확인했다.

**Level 2 — 실제 접근**

API 응답 또는 데이터 파일을 실제로 읽었다.

**Level 3 — 재현 완료**

코드를 실행하고 데이터 가공·검증 결과를 재현했다.

README에 기능이 소개되어 있다는 이유만으로 Level 3을 부여하지 마라.

## 3.4 자료 출처 기록

수집한 각 파일에 다음 메타데이터를 남긴다.

```json
{
  "source_id": "example-source",
  "source_url": "https://example.com",
  "retrieved_at": "ISO8601",
  "source_type": "api",
  "content_type": "application/json",
  "source_version": null,
  "game_patch": null,
  "license": "UNVERIFIED",
  "sha256": "...",
  "verification_level": 2,
  "notes": []
}
```

동일한 자료를 다른 경로에서 얻더라도 원본 출처와 수집 경로를 각각 기록한다.

---

# 04. 공식 Riot 및 VALORANT 데이터

## 4.1 Riot Developer Portal

공식 문서:

https://developer.riotgames.com/docs/valorant

공식 API 목록:

https://developer.riotgames.com/apis

일반 정책:

https://developer.riotgames.com/policies/general

게임별 정책:

https://developer.riotgames.com/policies/game-specific

개발자 지원:

https://support-developer.riotgames.com/hc/en-us/articles/22698769097107-VALORANT

조사할 항목:

- 콘텐츠 API
- 경기 API
- 플레이어 ID
- 경기 ID
- 라운드 이벤트
- 스파이크 이벤트
- 위치 이벤트
- 무기 정보
- 요원 정보
- 맵 UUID
- API 인증
- 요청 제한
- 재배포 조건

**공식 Riot Developer API가 리플레이 파일 자체를 제공한다고 가정하지 마라.**

API 목록과 실제 응답을 확인하고, 리플레이 다운로드 기능이 없으면 명확하게 기록한다.

## 4.2 Riot × GRID

Open Access:

https://grid.gg/riot-open-access/

공식 문서:

https://docs.grid.gg/

VALORANT 데이터:

https://grid.gg/data/games/valorant/

공식 Riot e스포츠 데이터:

https://riotesportsdata.com/en-us/valorant/

조사할 항목:

- Central Data Feed
- Series State API
- Loopfeed
- 파일 다운로드 API
- 경기 식별자
- 팀 및 선수 식별자
- 라운드 이벤트
- 경제 데이터
- 스킬 이벤트
- 교전 이벤트
- 스파이크 이벤트
- 선수 상태
- 위치 좌표 제공 여부
- 과거 데이터 접근
- 인증 방식
- 비상업적 사용 조건
- 상업용 라이선스

특히 **프로 선수 10명의 시점별 위치 정보를 실제로 얻을 수 있는지** 확인한다.

내부 데이터 상품에 존재하는 정보와 Open Access에서 제공하는 정보는 구분한다.

API 키가 필요하다면 사용자가 제공하기 전까지 키를 임의로 생성하거나 접근 제한을 우회하지 마라.

---

# 05. VCT 경기·선수·팀 통계 데이터

## 5.1 VCT Reference

공식 사이트:

https://vct-reference.com/

데이터셋:

https://vct-reference.com/dataset

이용약관:

https://vct-reference.com/terms

이 자료는 우선순위가 매우 높다.

DuckDB 데이터 파일의 실제 다운로드를 검증하고 가능한 경우 읽어라.

조사할 내용:

- Matches
- Maps
- Rounds
- Player Map Statistics
- Kill Matrix
- Economy
- Opening Duels
- Clutches
- Multikills
- Attack / Defense Split
- Patch / Event Metadata
- Data Coverage

다음 데이터를 생성한다.

```text
players.parquet
teams.parquet
matches.parquet
maps.parquet
rounds.parquet
player_stats.parquet
kill_events.parquet
economy_stats.parquet
```

실제 테이블 구조와 다르면 원본 스키마에 맞게 변환한다.

누락 필드를 0으로 채워 실제 값처럼 취급하지 않는다.

## 5.2 VLR.gg

메인 사이트:

https://www.vlr.gg/

실제 분석 대상 경기:

https://www.vlr.gg/754737/loud-vs-team-vitality-valorant-champions-2026-gf

확인할 항목:

- 경기 날짜
- 팀과 선수
- 맵 밴픽
- 요원 조합
- 선수 성적
- 라운드 승패
- 공격·수비 성적
- 경제
- 킬 로그
- 2D Replay

2D Replay가 실제로 포함된 경기와 포함되지 않은 경기를 구분한다.

### 비공식 VLR API

https://github.com/axsddlr/vlrggapi

https://github.com/Orloxx23/vlresports

추가 후보:

https://github.com/grgaoun/vlr

조사할 내용:

- 경기 상세 API
- 라운드 상세 API
- 리플레이 관련 처리
- 데이터 반환 스키마
- 직접 호스팅 가능 여부
- 데이터 누락
- 파서 안정성
- 경기 ID 연결 방식

비공식 API는 공식 데이터 소스라고 표기하지 않는다.

수집 정책을 준수하며 접근한다.

## 5.3 VCT Win Probability

사이트:

https://www.bernielaird.com/vct/

GitHub:

https://github.com/bernielaird/vctstats

이 프로젝트는 특히 중요하다.

연구해야 할 내용:

- 프로 경기 데이터 수집
- VLR 2D Replay 처리
- 위치 데이터 정규화
- 라운드 승률 예측
- 선수 생존 상태
- 경제 상태
- 스파이크 상태
- 게임 시간
- LightGBM 모델
- 학습·검증 데이터 분리
- 모델 정확도와 캘리브레이션

반드시 실제 코드에서 입력 특징을 확인한다.

데이터의 양뿐 아니라 시간 해상도와 정보 누출 가능성을 분석한다.

## 5.4 C9 Gameplan

GitHub:

https://github.com/joshghal/c9-gameplan-backend

프로젝트 소개:

https://joshuagalilea.com/works/gameplan

분석 항목:

- 5v5 전술 시뮬레이션
- 실제 VCT 경기 데이터
- 선수 이동 데이터
- 교전 모델
- AI 행동 모델
- 경로 탐색
- 맵별 전술
- 경제 처리
- 시뮬레이션 시간축
- 이벤트 구조

README에 표시된 수치를 독립 검증된 결과라고 단정하지 마라.

실제 데이터 파일 존재 여부와 이용 권한을 확인한다.

---

# 06. 추가 경기 분석 플랫폼 전체 조사

아래 사이트는 모두 조사 후보이다.

사이트의 실제 기능, API, 다운로드 지원 여부를 각각 검증하라.

### RIB.GG

https://rib.gg/

연구 대상:

프로 경기 리플레이, 선수 위치, 라운드 타임라인, VOD 동기화.

### THESPIKE

https://www.thespike.gg/

2D Replay 예시:

https://www.thespike.gg/match/luminosity-gaming-pho-real/52488?map=59888&tab=2dreplay

연구 대상:

이벤트별 선수 위치, 킬, 설치, 해체 및 라운드 기록.

### Bo3.gg

https://bo3.gg/valorant

경제 데이터 예시:

https://bo3.gg/valorant/matches/nrg-1-vs-loud-28-08-2026/economy

연구 대상:

라운드별 경제, 장비 구매, 팀 성적.

### Tracker.gg

https://tracker.gg/valorant

연구 대상:

경쟁전 통계, 선수별 전적, 무기 성과.

### Ascend Analytics

https://esports.play-ascend.com/

https://www.play-ascend.com/developers/knowledge

연구 대상:

팀 레이팅, 선수 평가, 패치 및 스킬 데이터.

### statsIQ

https://statsiq.net/

연구 대상:

전술 타임라인, 경기 비교, 위치 패턴 분석.

### SABR / Morat

https://morat.ai/

연구 대상:

상황별 유사 라운드 검색, 전술 데이터 인덱싱.

### Qiton

https://qiton.app/features

연구 대상:

선수 평가 지표 및 리플레이 분석.

### Praccly

https://praccly.com/

연구 대상:

스크림, 훈련, 사이트 진입 성과.

### Offangle

https://offangle.pro/

연구 대상:

교전 시야, 리플레이 분석, 포지셔닝.

### ValoPins

https://valopins.com/en/replays

연구 대상:

리플레이 상태를 전술 편집 데이터로 변환하는 방법.

### Valorant Scout

https://valorantscout.com/

리플레이:

https://valorantscout.com/valorant-replays

연구 대상:

2D 리플레이, 맵 기반 스킬 라인업.

### OP.GG

https://op.gg/ko/valorant/replay?view=2d

연구 대상:

선수 위치, 시야, 이동 히트맵, 스킬, 교전.

### ValoPeek

https://valopeek.app/

연구 대상:

맵 구역별 교전 및 경기 상태.

### kogni

https://kogni.pro/

연구 대상:

상대 분석, 선수 및 팀 성향.

### Tricks.gg

https://tricks.gg/

연구 대상:

요원 스킬 라인업과 전술.

### VODs.space

https://vods.space/replays

연구 대상:

실제 경기 영상과 라운드 타임라인.

### valab

https://www.valab.gg/

VRF 검사기:

https://www.valab.gg/tools/vrf-inspector

연구 대상:

리플레이 파일 메타데이터 및 분석 방법.

위 사이트들은 서로 다른 성격의 서비스를 제공할 수 있다.

실제 데이터 다운로드가 확인되지 않았다면 게임 데이터 공급원이 아니라 분석 방식 참고 자료로 분류한다.

---

# 07. 데이터 엔지니어링 참고 저장소

다음 저장소를 조사하라.

### VLML

https://github.com/kennethadriann/vlml

연구:

- GRID 데이터 정규화
- DuckDB
- 데이터 모델
- 분석 지표
- 통계 처리
- AI 질의 구조

### Economy Analysis

https://github.com/yusriso/valorant-economy-analysis-vct

연구:

- 경제 상태
- 라운드 승률
- 무기 구매
- 장비 우위
- 스노우볼

### VCT Tournament Ecosystem

https://github.com/abhay-k07/Valorant-Esports-Tournament-Ecosystem

연구:

- 선수
- 팀
- 로스터
- 대회
- 관계형 데이터 모델

### Match Predictor

https://github.com/znimer-dev/Valorant-Match-Predictor

### Velo.gg

https://github.com/maharshinath/Velo.gg

### valPRED

https://github.com/andrewhdurnford/valPRED

### Player Intelligence

https://github.com/valid22/valo-player-intel

위 프로젝트의 예측 정확도는 그대로 신뢰하지 마라.

데이터 누출, 테스트 분할, 평가 기간, 최근 패치 반영 여부를 확인하라.

---

# 08. 실제 리플레이 파싱

## 8.1 분석할 저장소

C# 파서:

https://github.com/michel-giehl/ValorantReplayParser

Rust 파서:

https://github.com/yakisoba0728/vrfkit

사용법:

https://github.com/yakisoba0728/vrfkit/blob/main/docs/USAGE.md

ValoReview:

https://github.com/dhinakar-v/ValoReview

ValorantWebReplayer:

https://github.com/talhakoek/ValorantWebReplayer

ValoP:

https://github.com/KNN-07/ValoP

ValorantReplayViewer:

https://github.com/JulianW03/ValorantReplayViewer

## 8.2 파서 평가 항목

각 파서에 대해 다음을 확인한다.

1. 지원 VRF 버전
2. 지원 게임 패치
3. 디코딩 가능한 이벤트
4. 선수 위치 데이터
5. 위치 샘플링 간격
6. 시선 방향
7. 체력
8. 방어구
9. 무기
10. 탄약
11. 스킬 사용
12. 스킬 오브젝트
13. 스파이크 상태
14. 킬·데스
15. 라운드 시간
16. 요원 식별
17. 플레이어 식별
18. 맵 식별
19. 데이터 출력 형식
20. 처리 속도
21. 실제 실행 성공 여부

## 8.3 실제 리플레이 데이터 모델

```ts
interface ReplayFrame {
  matchId: string;
  roundId: string;

  timestampMs: number;
  gamePatch: string;

  players: {
    playerId: string;
    agentId: string;
    teamId: string;

    position: Vector3;
    facing: Vector2;

    health: number;
    armor: number;

    alive: boolean;

    weaponId?: string;
    ammunition?: number;

    movementState?: string;
  }[];

  spike: SpikeState;

  events: ReplayEvent[];
}
```

실제 파서가 제공하지 않는 필드는 nullable 또는 optional로 유지한다.

가공 데이터에서 복원한 값은 해당 사실을 provenance에 표시한다.

## 8.4 시간축 정규화

다음 문제를 해결해야 한다.

- 경기 전체 시간
- 라운드 상대 시간
- 준비 시간
- 실제 라운드 진행 시간
- 스파이크 설치 이후 시간
- 리플레이 틱
- 이벤트 타임스탬프
- 영상 프레임 타임스탬프

모든 데이터가 같은 기준 시간을 사용하는지 검증하라.

필요하다면 다음과 같이 저장한다.

```text
match_time_ms
map_time_ms
round_time_ms
phase_time_ms
source_tick
source_timestamp
```

리플레이 원본의 시간과 분석용으로 변환한 시간을 모두 유지한다.

---

# 09. 방송 영상 기반 데이터 추출

## 9.1 참고 저장소

Valoscribe:

https://github.com/SphinxNumberNine/valoscribe

추가 구현:

https://github.com/inde5media/valoscribe-VOD-ANALYSIS

Project X:

https://github.com/keith-ng/vct

Strategy Mapping Tool:

https://github.com/WesleyJWu/Valorant-Strategy-Mapping-Tool

VOD Analyzer:

https://github.com/Awilkes21/valorant-vod-analyzer

## 9.2 컴퓨터 비전 처리 파이프라인

```text
VCT Video
    ↓
Frame Extraction
    ↓
HUD Detection
    ↓
Minimap Detection
    ↓
Agent Icon Detection
    ↓
Event Recognition
    ↓
Temporal Tracking
    ↓
Coordinate Normalization
    ↓
Confidence Estimation
    ↓
Structured Match Data
```

GPU 기반 비전 모델은 개발 중 데이터 추출에 사용해도 된다.

그러나 게임 실행 단계에서 GPU 비전 모델을 계속 실행할 필요는 없다.

## 9.3 영상 추출 시 제한 사항

방송 화면에 표시되지 않은 정보를 관측 사실로 기록하지 마라.

예를 들어:

- 미니맵에 표시되지 않은 적
- 관전자 화면에 노출되지 않은 스킬 사용
- 확인되지 않은 체력
- 실제 팀 보이스
- 선수의 전술적 의도

이러한 항목은 추정이 필요하다.

추정 결과에는 반드시 confidence와 근거를 기록한다.

---

# 10. 맵 데이터 전체 구축

## 10.1 사용자 제공 Blender 맵

원본 폴더:

https://drive.google.com/drive/u/0/folders/1henHDT5PX5HW3PRAJ018UBMTgL0F3-2a

개별 자료:

**Abyss**

https://drive.google.com/open?id=1BW2cxkBUz70ed3AYA2nGITvQlvuaEX8t

**Ascent**

https://drive.google.com/open?id=1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB

**Bind**

https://drive.google.com/open?id=1kAY2m05wdDnU9_3aOgrL_4b-p66AuLnK

**Breeze**

https://drive.google.com/open?id=1QpiCKTIJgzU735HzNH84Io5eYeoPhDdd

**Fracture**

https://drive.google.com/open?id=1WCTrmYIH9VNpXYGUN4w9U8S_nq_7Cx3I

**Haven**

https://drive.google.com/open?id=1e1wFXD2iBrYMPFNBwUgDnE9GpPTwt9rJ

**Icebox**

https://drive.google.com/open?id=1TzjOGVTZ0Du9E9-k3d9Vi7BN7qvX6hV1

**Lotus**

https://drive.google.com/open?id=1J_FcYU3iRcvZIGRvxvdM8s7sRm5OAPTN

**Pearl**

https://drive.google.com/open?id=1L9BPmfJnlOOcduu-rlftTkgUP0r0ENh0

**Split**

https://drive.google.com/open?id=1yTkqrAbinK1PyAFNZoyUfjvd5vA0ZMMd

**Sunset**

https://drive.google.com/open?id=1O-iEnHY1MfGcDdm32YK3f0kiA0UEybhG

추가 맵 배포 후보:

https://drive.google.com/drive/folders/1tKJAQv0GI8ZMD34XGbx30SrsfBjHTYVW

추가 폴더에서 Corrode, Summit 등 누락된 맵을 확인한다.

## 10.2 추가 맵 프로젝트

ValorantBrowser:

https://github.com/Shreshth1x/ValorantBrowser

Valorant Zone Stats:

https://github.com/LouisAsanaka/Valorant-Zone-Stats

Piana:

https://github.com/f0rmatme/Piana

Valorant-API Maps:

https://valorant-api.com/v1/maps

## 10.3 맵 데이터 분석

각 Blender 파일을 실제로 열 수 있다면 다음을 추출한다.

- Collection 목록
- Object 목록
- Mesh 목록
- Vertex 수
- Polygon 수
- Object Transform
- World Scale
- Bounding Box
- 재질과 텍스처
- 지형
- 벽
- 바닥
- 계단
- 장애물
- 장식용 메시
- 충돌 가능 메시
- 파괴 가능한 오브젝트 후보

원본에 충돌 메시가 없다면 직접 생성해야 한다.

## 10.4 공간 엔진 요구 사항

```ts
interface TacticalMap {
  mapId: string;
  patchVersion: string;

  geometry: GeometryData;
  collision: CollisionData;
  navigation: NavigationGraph;

  elevation: ElevationData;
  visibility: VisibilityGraph;

  zones: TacticalZone[];
  plantZones: PlantZone[];

  spawnZones: SpawnZone[];

  soundModel: SoundPropagationModel;

  interactables: MapInteractable[];

  worldToMinimap: CoordinateTransform;
}
```

최소한 다음 기능을 구현한다.

1. 벽 충돌
2. 이동 가능한 바닥
3. A* 경로 탐색
4. 플레이어 반경 반영
5. 고저차 처리
6. 계단
7. 점프 가능 영역
8. 엄폐물
9. Ray Casting
10. 시야 차단
11. 연막 시야 차단
12. 발소리 전파
13. 설치 가능 영역
14. 문 개폐
15. 동적 장애물
16. 텔레포터
17. 맵별 기믹

첫 번째 검증 맵은 Ascent로 지정한다.

---

# 11. 요원·무기·스킬 데이터

## 11.1 참고 자료

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

3D 모델:

https://kingdomarchives.com/models

요원 자료:

https://kingdomarchives.com/agents

스킬 라인업:

https://github.com/matthew-paul/valorant-lineups

https://github.com/Twosugar666/valorant-lineups

## 11.2 능력 데이터

각 요원 스킬을 실제 엔진에서 실행 가능한 데이터로 변환한다.

```ts
interface AbilityDefinition {
  id: string;
  agentId: string;

  patchVersion: string;

  activationType: string;
  targetingType: string;

  charges: number;
  cost: number;

  durationMs?: number;
  cooldownMs?: number;

  range?: number;
  radius?: number;

  effects: AbilityEffect[];
}
```

필요한 효과:

- 연막
- 실명
- 기절
- 둔화
- 피해
- 회복
- 이동
- 순간이동
- 감시
- 적 탐지
- 위치 노출
- 설치형 장치
- 벽 생성
- 방어
- 궁극기

각 스킬이 게임 세계에 어떤 상태 변화를 발생시키는지 정의한다.

예를 들어 연막은 단순히 적의 명중률을 낮추는 기능이 아니다.

연막은 특정 공간의 시야 관계를 변경하며, 정보 수집과 이동 경로, 피킹 판단, 교전 가능성을 변화시킨다.

---

# 12. Hugging Face 및 머신러닝 데이터

## 12.1 참고 데이터셋

VALORANT 영상 및 행동 기록:

https://huggingface.co/datasets/open-world-agents/D2E-Original/tree/main/VALORANT

Gaming 500 Hours:

https://huggingface.co/datasets/markov-ai/gaming-500-hours

X-EGO-CS:

https://huggingface.co/datasets/wangyz1999/X-EGO-CS

EsportsBench:

https://huggingface.co/datasets/EsportsBench/EsportsBench

X-EGO-CS는 Counter-Strike 데이터임을 명시한다.

실제 VALORANT 전술 데이터로 취급해서는 안 된다.

연구할 것은 다음과 같은 일반적인 구조이다.

- 다중 시점
- 시계열 행동 데이터
- 부분 관측
- 상태와 행동의 정렬
- 행동 분류
- 팀 단위 상태
- 데이터 라벨링

---

# 13. 데이터 통합 및 정규화

## 13.1 Data Lake 설계

```text
datasets/
├── raw/
│   ├── riot/
│   ├── grid/
│   ├── vct-reference/
│   ├── vlr/
│   ├── replay/
│   └── vod/
│
├── normalized/
│   ├── matches/
│   ├── maps/
│   ├── rounds/
│   ├── players/
│   ├── events/
│   ├── positions/
│   └── economy/
│
├── spatial/
│   ├── geometry/
│   ├── navigation/
│   ├── visibility/
│   └── tactical-zones/
│
├── derived/
│   ├── perception/
│   ├── threat/
│   ├── tactical-segments/
│   └── player-features/
│
├── labels/
│   ├── actions/
│   ├── intentions/
│   └── validation/
│
└── training/
    ├── behavior/
    ├── outcome/
    └── tactical-policy/
```

## 13.2 데이터 식별자 통합

서로 다른 데이터 소스가 같은 선수를 다른 ID로 표현할 수 있다.

따라서 다음 데이터를 통합해야 한다.

- Player Identity
- Team Identity
- Match Identity
- Tournament Identity
- Map Identity
- Agent Identity
- Patch Identity

이름 문자열만으로 병합하지 마라.

선수 이름 변경, 팀 이적, 동일 이름 선수, 임시 닉네임 문제를 고려한다.

## 13.3 Provenance

```ts
type EvidenceType =
  | "observed"
  | "decoded"
  | "derived"
  | "inferred"
  | "simulated";

interface Provenance {
  sourceId: string;
  sourceUrl: string;

  gamePatch: string | null;
  retrievedAt: string;

  evidenceType: EvidenceType;

  confidence: number | null;
  verified: boolean;
}
```

데이터를 어디에서 얻었는지 추적할 수 있어야 한다.

---

# 14. 경기 상태 복원

## 14.1 World State

경기 엔진의 실제 상태를 정의한다.

```ts
interface WorldState {
  matchId: string;
  roundId: string;

  tick: number;
  timestampMs: number;

  map: MapState;

  attackers: TeamState;
  defenders: TeamState;

  spike: SpikeState;

  activeEffects: AbilityEffectState[];

  eventLog: GameEvent[];
}
```

각 선수의 상태:

```ts
interface PlayerState {
  id: string;
  teamId: string;

  agentId: string;

  position: Vector3;
  velocity: Vector3;
  facing: Vector2;

  health: number;
  armor: number;

  alive: boolean;

  weapon: WeaponState;
  inventory: InventoryState;

  credits: number;

  ultimatePoints: number;
  ultimateCost: number;

  behaviorState: string;

  currentOrder?: TacticalOrder;
}
```

## 14.2 Belief State

실제 상태와 AI가 알고 있는 상태를 분리한다.

```ts
interface BeliefState {
  visibleEnemies: EnemyObservation[];

  lastKnownEnemies: EnemyMemory[];

  heardSounds: SoundEvent[];

  teammateReports: TeamInformation[];

  inferredThreats: ThreatDistribution[];

  tacticalHypotheses: TacticalHypothesis[];
}
```

시야에 들어오지 않은 적의 정확한 위치를 제공하지 마라.

AI가 가지고 있는 정보는 관측과 추정으로 만들어져야 한다.

---

# 15. 상황 기반 선택지 생성 엔진

## 15.1 핵심 흐름

```text
World State
    ↓
Observation Generator
    ↓
Belief State
    ↓
Strategic Goal Generator
    ↓
Action Schema Matcher
    ↓
Parameter Generator
    ↓
Constraint Solver
    ↓
Candidate Action Set
    ↓
Outcome Predictor
    ↓
Utility Evaluation
    ↓
Action Selection
    ↓
Execution
```

## 15.2 Action Schema

행동마다 다음을 정의한다.

- 행동 ID
- 행동 범주
- 필요한 주체
- 필요한 조건
- 행동 파라미터
- 실행 시간
- 자원 비용
- 예상 효과
- 실패 조건
- 중단 조건
- 후속 행동

```ts
interface ActionSchema {
  id: string;

  category:
    | "strategic"
    | "tactical"
    | "individual";

  preconditions: Condition[];

  parameters: ParameterDefinition[];

  generate(
    context: DecisionContext
  ): CandidateAction[];
}
```

## 15.3 Constraint Validation

다음 조건을 검사한다.

- 이동 가능 여부
- 시간
- 스킬 보유
- 생존 상태
- 스파이크 상태
- 실행 인원
- 이동 거리
- 이동 위험
- 지형
- 경로 차단
- 전술 수행 가능성

불가능한 행동은 점수만 낮추는 것이 아니라 명확하게 제외한다.

단, 성공 확률이 낮은 행동과 물리적으로 불가능한 행동은 구분한다.

---

# 16. 전술적 선택지 분류

## 16.1 공격팀

- Default
- Fast Execute
- Slow Execute
- Split Execute
- Fake Execute
- Double Fake
- Contact
- Lurk
- Map Control
- Mid Control
- Utility Bait
- Rotation
- Late Rotation
- Re-Execute
- Spike Plant
- Post-Plant
- Exit Kill
- Save

## 16.2 수비팀

- Default Hold
- Aggressive Push
- Information Push
- Anchor
- Site Stack
- Rotate
- Counter-Rotate
- Retake
- Crossfire
- Reposition
- Defuse
- Fake Defuse
- Hunt
- Save

## 16.3 개인 행동

- Move
- Walk
- Run
- Hold Angle
- Clear Angle
- Peek
- Swing
- Trade
- Retreat
- Reposition
- Reload
- Use Ability
- Wait
- Plant
- Defuse
- Save Weapon

이 목록은 고정된 최종 목록이 아니다.

실제 경기 데이터와 전술 분석 과정에서 확장 가능한 구조로 구현한다.

---

# 17. 정보전 및 페이크

## 17.1 페이크의 정의

페이크는 단순히 A 사이트에서 스킬을 사용한 뒤 B로 이동하는 것이 아니다.

상대의 판단을 변경할 목적으로 정보를 노출하거나 특정 행동을 유도하는 전술이다.

그러나 실제 경기 기록만으로 선수의 의도를 확정하기 어렵다.

따라서 다음을 구분한다.

- 관측된 행동
- AI가 추론한 의도
- 상대의 실제 반응
- 후속 결과

## 17.2 페이크 처리 절차

```text
Attackers Apply A Pressure
    ↓
Defenders Observe Signals
    ↓
Defender Belief Updated
    ↓
Defender Decision Generated
    ↓
Hold / Rotate / Push / Gather Info
    ↓
Attackers Observe Response
    ↓
Attack Plan Re-evaluated
```

상대가 반드시 페이크에 속아서는 안 된다.

상대의 전술 이해도, 이전 라운드 경험, 관측 정보에 따라 다른 판단이 발생해야 한다.

## 17.3 정보의 시간적 가치

10초 전 목격한 적이 현재도 같은 위치에 있다고 가정하지 않는다.

상대의 이동 가능한 영역을 기준으로 위치 분포를 갱신한다.

위치 추정은 확률적이어야 한다.

---

# 18. 스파이크 설치와 포스트플랜트

## 18.1 설치 위치

스파이크 설치를 단순히 `planted = true`로 처리하지 마라.

설치 위치가 이후 가능한 행동을 변경해야 한다.

고려할 요소:

- 설치 지점의 노출 위험
- 설치 당시 적 위치
- 엄폐물
- 아군의 방어 위치
- 스파이크를 바라볼 수 있는 각도
- 스킬 사용 가능 범위
- 수비팀의 리테이크 경로
- 해체 시야
- 설치 완료에 필요한 시간

## 18.2 설치 후보 생성

```text
Candidate Plant Locations
    ↓
Accessibility
    ↓
Plant Exposure Risk
    ↓
Post-Plant Visibility
    ↓
Friendly Control
    ↓
Enemy Retake Risk
    ↓
Expected Plant Value
```

## 18.3 포스트플랜트

설치 이후 각 선수는 다음 행동을 평가한다.

- 사이트 유지
- 다른 각도 확보
- 스파이크와 거리 확보
- 유틸리티 보존
- 시간 소모
- 해체 소리 확인
- 재교전
- 페이크 해체 대응

포스트플랜트는 실제 설치 위치에 종속되어야 한다.

---

# 19. 경제 시스템

## 19.1 실제 규칙 참고

VALORANT Credits:

https://wiki.playvalorant.com/en-us/Credits

Riot 패치 노트 1.11:

https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-11/

경제 가이드:

https://mobalytics.gg/blog/valorant/ultimate-economy-guide/

추가 참고:

https://senseos.gg/guides/valorant/valorant-economy/

모든 수치는 현재 패치와 대회 규칙을 기준으로 검증한다.

## 19.2 경제 시스템 입력

- 선수별 크레딧
- 팀의 구매 계획
- 무기
- 방어구
- 스킬
- 패배 연속 횟수
- 다음 라운드 예상 수입
- 현재 라운드의 중요도
- 다음 라운드 상대의 예상 구매
- 진영 변경
- 연장전

## 19.3 구매 행동

- Full Buy
- Half Buy
- Force Buy
- Eco
- Bonus
- Save
- Drop Weapon
- Buy Teammate
- Preserve Weapon
- Upgrade Weapon

경제 판단은 팀 단위와 개인 단위로 분리한다.

---

# 20. 세이브 의사결정 엔진

이 모듈은 가장 중요한 전략 시스템 중 하나다.

단순히 라운드 승률이 낮으면 세이브하는 방식은 사용하지 않는다.

## 20.1 세이브 판단의 의미

세이브는 현재 라운드의 승리 기회를 일부 포기하고 미래 라운드의 기대 가치를 보존하는 전략이다.

다음 요소를 고려한다.

1. 현재 라운드 승리 가능성
2. 현재 무기의 가치
3. 방어구 가치
4. 남은 스킬
5. 다음 라운드 구매 가능성
6. 현재 라운드의 중요도
7. 상대의 경제
8. 자신의 궁극기
9. 상대의 궁극기
10. 생존 가능성
11. 적에게 처치당할 위험
12. 탈출 경로
13. 상대의 추격 가능성
14. 진영 변경 여부
15. 매치포인트 여부
16. 연장전 여부

## 20.2 세이브 선택지

다음 행동을 생성할 수 있어야 한다.

```text
SAVE_WEAPON
SAVE_WITH_OPERATOR
SAVE_WITH_RIFLE
AVOID_CONTACT
RETREAT_TO_SAFE_ZONE
REPOSITION_FOR_SURVIVAL
RECOVER_WEAPON
HOLD_FOR_EXIT_KILL
HUNT_ENEMY_SAVER
DENY_ENEMY_ULT_POINT
PROTECT_HIGH_VALUE_WEAPON
ACCEPT_ROUND_LOSS
RETAKE_ANYWAY
```

## 20.3 핵심 사례 — Operator 보존

1v4 상황에서 Operator를 보유한 선수를 가정한다.

현재 라운드 승리 가능성이 낮고 다음 라운드가 남아 있다면 Operator를 보존하는 행동이 높은 가치를 가질 수 있다.

그러나 다음 라운드가 마지막이거나 상대에게 매치포인트가 있다면 세이브 가치가 달라진다.

AI는 현재와 미래의 기대 승리 가치를 비교해야 한다.

## 20.4 핵심 사례 — 가치가 낮은 무기

Classic만 보유한 1v4 선수는 반드시 세이브해야 하는 것은 아니다.

교전을 통해 얻는 보상, 궁극기, 상대 경제 피해, 현재 라운드 승리 가능성을 함께 평가해야 한다.

## 20.5 세이브의 미래 가치

개념적인 평가 구조:

```text
Save Value
    =
  Equipment Preservation
  + Next Round Buy Advantage
  + Future Win Probability
  + Ultimate Point Denial
  - Current Round Opportunity Cost
  - Escape Risk
```

가중치는 고정된 임의 숫자로 확정하지 않는다.

실제 경기 데이터와 반복 시뮬레이션을 통해 보정한다.

---

# 21. 궁극기 경제 시스템

## 21.1 궁극기 관련 자료

Riot 공식 패치 1.0:

https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-0/

VALORANT Abilities:

https://wiki.playvalorant.com/en-us/Abilities

Ultimate Economy Guide:

https://mobalytics.gg/blog/valorant/ultimate-economy-guide/

궁극기 포인트 획득 규칙을 실제 패치별로 확인하고 데이터화한다.

## 21.2 궁극기의 경제적 가치

궁극기는 단순히 충전되면 사용하는 스킬이 아니다.

다음 라운드의 전략적 우위를 만드는 자원이다.

따라서 다음 항목을 계산한다.

- 자신의 궁극기 포인트
- 필요한 포인트
- 상대의 예상 궁극기 포인트
- 현재 궁극기 보유 여부
- 다음 라운드 궁극기 사용 가능성
- 현재 라운드 궁극기 사용 가치
- 다음 라운드까지 보존할 가치
- 궁극기 사용에 적합한 요원 조합
- 상대 궁극기의 위험도

## 21.3 궁극기 포인트 차단

AI는 불필요하게 상대에게 처치당하면 상대 궁극기 충전에 기여할 수 있다는 점을 고려해야 한다.

예를 들어 상대 핵심 요원이 궁극기 1포인트 부족한 상태에서 현재 라운드 승리가 사실상 어려운 경우가 있다.

이때 생존을 선택하면 무기 보존과 동시에 상대 궁극기 충전을 늦출 수 있다.

그러나 교전으로 현재 라운드를 뒤집을 가능성이 충분하다면 교전을 시도할 수 있다.

궁극기 차단만을 위해 모든 교전을 회피하는 AI를 만들어서는 안 된다.

## 21.4 비적대적 사망

스파이크 폭발, 낙사 등으로 인한 사망은 일반적인 적 처치와 궁극기 포인트 처리 방식이 다를 수 있다.

이러한 경우의 규칙을 패치별로 확인하고 정확하게 처리하라.

게임 규칙에 없는 임의의 자해 행동을 생성하지 마라.

## 21.5 궁극기 관련 행동

```text
SEEK_ULTIMATE_ORB
SAVE_ULTIMATE
USE_ULTIMATE
DENY_ENEMY_ULT_CHARGE
TRADE_FOR_ULT_VALUE
PLAY_AROUND_ENEMY_ULT
FORCE_ENEMY_ULT_USAGE
BAIT_ENEMY_ULT
```

상대의 궁극기를 사용하도록 유도하는 행동 역시 전술적 가치가 있다.

---

# 22. 상대 무기 파괴와 출구 킬

라운드 승리가 확정적으로 유리한 팀도 행동을 멈춰서는 안 된다.

상대가 무기를 보존하려는 상황이라면 다음 행동을 평가한다.

- 안전하게 승리를 확보한다.
- 상대를 추격한다.
- 고가 무기를 제거한다.
- 출구를 통제한다.
- 상대가 도주할 경로를 차단한다.
- 무리한 추격을 포기한다.

## 22.1 추격의 기대 가치

상대 Operator를 제거할 수 있다면 다음 라운드에 큰 영향을 줄 수 있다.

그러나 추격하다가 아군 라이플 2정을 잃는다면 오히려 손해가 될 수 있다.

따라서 추격 역시 확률적 결과를 평가해야 한다.

## 22.2 추격 중 역공격

세이브하는 선수도 무조건 도망가지는 않는다.

적이 예상보다 과감하게 추격하면 유리한 각도를 잡아 역으로 교전할 수 있다.

이때 현재 세이브 계획을 수정할 수 있어야 한다.

---

# 23. 선수 개인 AI

## 23.1 선수 능력치

다음 능력치를 권장한다.

### Mechanical

- Aim
- Reaction
- Tracking
- First Bullet Accuracy
- Crosshair Placement
- Movement
- Weapon Control

### Tactical

- Positioning
- Angle Clearing
- Utility Usage
- Entry Timing
- Trading
- Map Awareness
- Rotations

### Mental

- Decision Making
- Composure
- Consistency
- Risk Evaluation
- Concentration
- Adaptability

### Team

- Communication
- Teamwork
- Tactical Discipline
- IGL Compatibility
- Role Understanding

### Specialization

- Map Familiarity
- Agent Mastery
- Weapon Preference
- Clutch Skill
- Lurking
- Entry
- Anchoring

## 23.2 능력치 반영 방식

에임이 높다고 항상 교전해야 하는 것은 아니다.

판단력이 높은 선수는 불리한 교전을 피할 수 있다.

공격성이 높은 선수는 더 위험한 선택지를 평가할 수 있다.

팀워크가 높은 선수는 아군의 행동 타이밍에 맞춰 움직여야 한다.

선수 능력치가 행동 후보와 결과 확률에 미치는 영향을 분리해서 모델링한다.

---

# 24. 팀 전술 AI

팀 단위 AI는 개인 AI와 분리한다.

전술 판단을 담당하는 계층:

```text
Coach Strategy
    ↓
IGL Tactical Decision
    ↓
Squad Coordination
    ↓
Individual Player Decisions
    ↓
Physical Execution
```

## 24.1 IGL 판단

IGL은 다음을 수행한다.

- 사이트 선택
- 로테이션
- 페이크
- 시간 관리
- 상대 정보 해석
- 작전 변경
- 세이브 콜
- 리테이크 콜
- 유틸리티 사용 조정

## 24.2 팀워크

선수들이 같은 판단을 내린다고 해서 같은 시각에 완벽하게 행동하는 것은 아니다.

전술 이해도와 팀워크에 따라 실행 시간과 정확도가 달라질 수 있다.

예를 들어 듀얼리스트가 진입했는데 척후대의 플래시 타이밍이 늦어지는 상황을 표현할 수 있어야 한다.

---

# 25. 행동의 미래 예측

## 25.1 반사실적 시뮬레이션

실제 경기에는 선택한 행동의 결과만 존재한다.

선택하지 않은 행동의 결과는 관측할 수 없다.

따라서 이를 학습하기 위해서는 자체 시뮬레이션이 필요하다.

예시:

```text
Current: 4v4 / 42s

├── A Execute
│   ├── Success
│   ├── Failed Entry
│   └── Retake
│
├── B Rotation
│   ├── Site Empty
│   ├── Defender Rotated
│   └── Time Expired
│
├── Fake A → B
│   ├── Defender Fooled
│   ├── Defender Holds
│   └── Enemy Push
│
└── Save
    ├── Survive
    ├── Hunted
    └── Recover Weapon
```

각 미래 분기는 확률적으로 평가한다.

상대도 자신의 정보와 목표에 따라 행동해야 한다.

## 25.2 연산량 제한

가능한 모든 미래를 탐색하지 않는다.

권장 방식:

- 평상시 Utility AI
- 전술적 사건 발생 시 재평가
- 중요 선택지에 제한적 전방 탐색
- 탐색 깊이 제한
- 후보 수 제한
- 시뮬레이션 시간 예산 관리

---

# 26. 머신러닝 고도화

## 26.1 행동 모방 학습

입력:

- 맵
- 위치
- 시간
- 경제
- 스킬
- 관측 적
- 팀 배치
- 최근 라운드 이력

출력:

- 실제 프로 선수가 선택한 행동 종류

## 26.2 교전 모델

입력:

- 무기
- 거리
- 엄폐
- 시야
- 체력
- 스킬 효과
- 선수 능력치

출력:

- 교전 승리 확률
- 예상 피해
- 예상 생존

## 26.3 라운드 가치 모델

입력:

- 현재 경기 상태
- 경제
- 시간
- 인원
- 스파이크
- 궁극기

출력:

- 라운드 승리 확률
- 기대 경제 변화

## 26.4 모델 평가

다음 지표를 사용한다.

- Accuracy
- Precision / Recall
- Log Loss
- Brier Score
- Calibration
- Inference Latency
- Memory Usage

학습 데이터와 검증 데이터는 경기 단위로 분리한다.

같은 경기의 시간적으로 가까운 샘플이 학습과 검증에 동시에 포함되어서는 안 된다.

미래 라운드 정보가 과거 의사결정 예측에 들어가지 않도록 한다.

---

# 27. 기술 스택 및 런타임

## 27.1 Desktop

- Electron
- electron-vite

## 27.2 Frontend

- React
- TypeScript
- Tailwind CSS v4
- Zustand
- PixiJS

## 27.3 Simulation

- TypeScript 프로토타입
- Rust 코어
- Rayon 병렬 처리
- Seeded PRNG
- Deterministic Simulation

## 27.4 Game AI

- Utility AI
- HFSM
- Behavior Tree
- HTN
- GOAP
- 제한적 미래 탐색

## 27.5 Data

- Python
- Polars
- DuckDB
- SQLite
- Parquet
- NumPy
- Shapely

## 27.6 Machine Learning

- LightGBM
- XGBoost
- PyTorch
- ONNX Runtime CPU

기술을 도입할 때마다 실제 필요성을 검증한다.

고성능 GPU를 요구하는 대형 모델은 필수 요소가 아니다.

---

# 28. 시뮬레이션 엔진 구조

```text
SimulationEngine
│
├── WorldState
│
├── RoundRules
│
├── EconomyEngine
│   ├── BuyDecision
│   ├── SaveDecision
│   ├── EquipmentPreservation
│   └── UltimateEconomy
│
├── SpatialEngine
│   ├── Navigation
│   ├── Collision
│   ├── Visibility
│   └── Sound
│
├── PerceptionEngine
│   ├── Vision
│   ├── Hearing
│   ├── TeamCommunication
│   └── BeliefUpdate
│
├── TacticalEngine
│   ├── GoalGeneration
│   ├── ActionGenerator
│   ├── ConstraintValidation
│   ├── OutcomePrediction
│   └── DecisionPolicy
│
├── PlayerEngine
│   ├── Movement
│   ├── Combat
│   ├── Abilities
│   └── IndividualDecision
│
├── EventSystem
│
└── ReplayRecorder
```

## 28.1 게임 루프

```ts
function simulateTick(
  state: WorldState,
  dt: number
) {
  updateEnvironment(state);

  updateObservations(state);

  updateBeliefs(state);

  updateTeamDecisions(state);

  updateIndividualDecisions(state);

  resolveMovement(state, dt);

  resolveAbilities(state, dt);

  resolveCombat(state, dt);

  resolveSpike(state, dt);

  updateEconomyEvents(state);

  checkRoundEnd(state);

  recordEvents(state);
}
```

이는 개념적 처리 흐름이다.

실제 구현에서는 의존 관계와 시뮬레이션 시간축을 고려해 이벤트 처리 순서를 결정해야 한다.

---

# 29. Decision Debugger

모든 AI 판단을 추적할 수 있도록 한다.

필수 기록:

- 당시 실제 상태
- AI 관측 상태
- 생성된 후보
- 제외된 후보
- 제외 이유
- 각 후보의 예상 결과
- 미래 가치
- 선택된 행동
- 선택 이유
- 실제 결과

예시:

```text
Round 18
Time Remaining: 28s

Situation:
  1v3
  Operator Equipped
  Spike Planted
  Ultimate: 6/7

Candidate Actions:
  Retake
  Save Operator
  Exit Kill
  Recover Weapon
  Hold Position

Evaluation:
  Retake:
    Low win probability
    High weapon loss risk

  Save:
    High preservation value
    Better next round economy

  Exit Kill:
    Possible enemy weapon damage
    Significant death risk

Selected:
  Save Operator
```

위 텍스트는 예시다.

실제 엔진은 계산 근거와 확률을 기록해야 한다.

---

# 30. 자동 테스트

다음 시나리오를 반드시 구현한다.

### A. 기본 라운드

5v5 라운드가 정상적으로 시작하고 종료된다.

### B. 정보 비대칭

시야 밖의 상대 위치를 AI가 알 수 없다.

### C. 페이크

가짜 사이트 압박으로 수비팀의 믿음이 변한다.

### D. 역페이크

수비팀이 페이크 가능성을 고려한다.

### E. 시간 부족

남은 시간에 실행 불가능한 로테이션은 제외된다.

### F. 스파이크 설치

실제 설치 가능 구역에서만 설치한다.

### G. 설치 위치

설치 위치에 따라 포스트플랜트 판단이 달라진다.

### H. 리테이크

수비팀이 재탈환과 세이브를 비교한다.

### I. Operator Save

고가 무기 보존의 미래 가치를 평가한다.

### J. 궁극기 차단

불필요한 사망으로 상대 궁극기를 충전시키는 위험을 반영한다.

### K. 출구 킬

승리팀이 상대 세이브를 추격할지 평가한다.

### L. 추격 역공격

세이브하던 선수가 유리한 교전 상황에 반응한다.

### M. 후반 마지막 라운드

진영 변경 전 무기 보존의 가치가 적절히 처리된다.

### N. 매치포인트

미래 라운드가 존재하지 않는 상황에서 세이브 평가가 달라진다.

### O. 동일 시드

동일한 입력과 난수 시드에서 결과가 재현된다.

### P. 고속 시뮬레이션

1배속과 즉시 결과 계산이 같은 판정을 생성한다.

---

# 31. 실제 경기 통계와 검증

다음 지표를 비교한다.

- 공격팀 승률
- 수비팀 승률
- 맵별 승률
- 라운드 길이
- 첫 킬 승률
- 교전 승률
- 스파이크 설치율
- 리테이크 성공률
- 클러치 빈도
- 트레이드킬 비율
- 경제 우위 승률
- 세이브 빈도
- 무기 보존율
- 출구 킬 빈도
- 궁극기 사용 시점
- 궁극기 포인트 변화
- 로테이션 빈도
- 러킹 빈도
- 페이크 성공 가능성

실제 통계가 없는 항목은 기준값을 만들어낸 뒤 실제 평균이라고 주장하지 마라.

검증 가능하지 않은 가설은 실험 대상으로 분리한다.

---

# 32. 실제 구현 순서

## Phase 0 — 환경 및 기존 저장소 분석

현재 프로젝트 파일을 확인한다.

기존 코드가 있다면 먼저 분석한다.

아무것도 없는 경우에만 신규 프로젝트를 생성한다.

## Phase 1 — Data Source Registry

모든 URL과 접근 상태를 수집한다.

산출물:

```text
docs/SOURCES.md
docs/DATA_AVAILABILITY.md
docs/LICENSE_AUDIT.md
docs/RESEARCH_FINDINGS.md
```

## Phase 2 — 데이터 수집기

확인된 데이터 소스에 대한 수집기와 어댑터를 구현한다.

## Phase 3 — 데이터 정규화

경기, 선수, 라운드, 위치, 이벤트를 공통 스키마로 통합한다.

## Phase 4 — 맵 분석

Ascent의 공간 데이터와 좌표 변환을 검증한다.

## Phase 5 — 경기 상태 복원

실제 경기의 특정 시점을 World State로 복원한다.

## Phase 6 — Belief State

선수와 팀의 관측 상태를 계산한다.

## Phase 7 — Action Generator

현재 상황에서 실행 가능한 행동 후보를 생성한다.

## Phase 8 — Outcome Predictor

행동 후보의 예상 결과를 평가한다.

## Phase 9 — Economy & Ultimate Engine

구매, 세이브, 궁극기 충전, 상대 궁극기 차단을 구현한다.

## Phase 10 — 5v5 Simulation

AI 선수 10명이 한 라운드를 완주한다.

## Phase 11 — Replay Viewer

PixiJS로 실제 위치와 사건을 보여준다.

## Phase 12 — Validation

실제 경기 자료와 시뮬레이션 결과를 비교한다.

---

# 33. 최종 산출물

작업 결과에는 최소한 다음이 포함되어야 한다.

```text
project-v/
├── apps/
│   └── desktop/
│
├── packages/
│   ├── simulation-core/
│   ├── world-state/
│   ├── perception/
│   ├── tactical-ai/
│   ├── action-generator/
│   ├── outcome-predictor/
│   ├── combat-engine/
│   ├── economy-engine/
│   ├── ultimate-economy/
│   ├── spatial-engine/
│   ├── replay-engine/
│   └── shared/
│
├── tools/
│   ├── collectors/
│   ├── replay-parser/
│   ├── vod-analyzer/
│   ├── map-processor/
│   └── dataset-validator/
│
├── datasets/
│   ├── raw/
│   ├── normalized/
│   ├── derived/
│   └── training/
│
├── models/
│
├── tests/
│
└── docs/
    ├── SOURCES.md
    ├── DATA_AVAILABILITY.md
    ├── LICENSE_AUDIT.md
    ├── DATA_SCHEMA.md
    ├── GAME_RULES.md
    ├── TACTICAL_MODEL.md
    ├── SIMULATION_ENGINE.md
    ├── DECISION_MODEL.md
    ├── VALIDATION_REPORT.md
    └── DEVELOPMENT_LOG.md
```

---

# 34. 반드시 피해야 할 구현

다음과 같은 단순화는 핵심 시스템에 사용하지 않는다.

### 잘못된 예시 1

```ts
if (player.aim > enemy.aim) {
  winFight();
}
```

선수 능력치 외의 교전 조건이 무시된다.

### 잘못된 예시 2

```ts
if (roundWinProbability < 0.2) {
  saveWeapon();
}
```

무기 보존 가치, 미래 경제, 궁극기, 매치 상황이 무시된다.

### 잘못된 예시 3

```ts
if (enemySeenAtA) {
  rotateToA();
}
```

페이크와 정보 신뢰도가 무시된다.

### 잘못된 예시 4

```ts
if (spikePlanted) {
  moveToNearestCover();
}
```

설치 위치와 포스트플랜트 전술이 무시된다.

### 잘못된 예시 5

```ts
if (timeRemaining < 30) {
  rush();
}
```

현재 위치, 경로, 상대 배치, 스킬, 설치 가능 시간이 무시된다.

위 예시들은 단순 단위 테스트용 모형에서는 사용 가능하지만, 완성된 전술 판단 엔진의 핵심 규칙으로 사용해서는 안 된다.

---

# 35. 작업 보고 규칙

각 단계가 끝나면 다음을 보고하라.

```text
1. 이번 단계의 목표

2. 실제 확인한 자료
   - URL
   - 파일
   - API
   - 검증 수준

3. 실제 구현한 코드

4. 테스트 방법

5. 테스트 결과

6. 발견한 문제

7. 확인되지 않은 사항

8. 라이선스 및 접근 제약

9. 다음 작업 우선순위
```

실행하지 않은 테스트를 통과했다고 보고하지 마라.

실제 다운로드하지 않은 데이터 파일을 확보했다고 보고하지 마라.

README의 성능 수치를 직접 재현했다고 주장하지 마라.

데이터에 없는 필드를 임의 생성했다면 추정값임을 명시한다.

---

# 36. 최종 프로젝트 완료 조건

다음 사항을 만족하는 것이 목표다.

1. 실제 VALORANT 경기 데이터를 수집할 수 있다.
2. 경기 데이터를 공통 스키마로 변환할 수 있다.
3. 선수별 위치와 이벤트를 시간순으로 복원할 수 있다.
4. 실제 상태와 관측 상태를 분리할 수 있다.
5. 시야 밖의 적 위치를 AI가 알 수 없다.
6. 현재 상황에 맞는 선택지를 생성한다.
7. 물리적으로 불가능한 선택지를 제외한다.
8. 행동별 미래 결과를 평가한다.
9. 상대 역시 독립적으로 판단한다.
10. 페이크가 실제 정보전에 영향을 준다.
11. 로테이션이 공간과 시간에 따라 발생한다.
12. 선수 능력치가 행동 선택과 결과에 반영된다.
13. 스파이크 설치 위치가 경기 결과에 영향을 준다.
14. 세이브와 무기 보존 판단이 가능하다.
15. 궁극기 포인트 차단을 고려한다.
16. 상대의 세이브를 추격할 수 있다.
17. 경제적 스노우볼이 다음 라운드에 연결된다.
18. 5v5 라운드가 정상적으로 종료된다.
19. 경기 로그로 판단 과정을 추적할 수 있다.
20. 실제 경기 통계와 시뮬레이션을 비교할 수 있다.
21. 동일한 초기 상태와 난수 시드로 결과를 재현할 수 있다.
22. 고성능 GPU 없이도 게임 AI가 작동한다.
23. 기존 Electron UI와 시뮬레이션 엔진을 독립적으로 실행할 수 있다.
24. 자료별 출처와 사용 권한을 추적할 수 있다.

---

# 37. 최종 실행 지시

이 프롬프트를 단순한 조사 요청으로 취급하지 마라.

**실제 개발에 사용할 수 있는 자료를 검증하고, 데이터 수집 파이프라인을 작성하며, 상황 기반 행동 후보 생성 엔진을 구현하기 위한 기술 작업 명세로 취급하라.**

가장 먼저 수행할 일은 다음과 같다.

### 작업 1

제공된 URL을 모두 조사하고 데이터 소스 레지스트리를 작성한다.

### 작업 2

VCT Reference, vctstats, C9 Gameplan, vrfkit, ValoReview를 우선 분석한다.

### 작업 3

실제로 접근 가능한 경기 데이터 하나를 선택한다.

### 작업 4

해당 경기에서 하나의 라운드와 하나의 의사결정 시점을 추출한다.

### 작업 5

그 시점의 실제 상태와 관측 상태를 분리해 표현한다.

### 작업 6

현재 실행 가능한 전술 선택지를 생성한다.

### 작업 7

각 선택지의 유효성과 예상 결과를 분석한다.

### 작업 8

선택 이유와 제외 이유를 Decision Debugger로 출력한다.

### 작업 9

경제, 무기 보존, 궁극기 포인트를 고려한 판단을 추가한다.

### 작업 10

이 과정을 확장하여 하나의 5v5 라운드를 실제로 시뮬레이션한다.

사용 가능한 자료가 부족하더라도 검증 가능한 합성 데이터를 이용해 독립적인 프로토타입을 구축할 수 있어야 한다.

합성 데이터는 실제 VCT 기록과 명확하게 구분한다.

**최종적으로 우리가 원하는 것은 '경기 결과를 예측하는 AI'가 아니라, 실제 발로란트의 시간·공간·정보·경제·심리전 안에서 선수들이 스스로 선택하고 행동하며 새로운 경기를 만들어내는 시뮬레이션 엔진이다.**

구단 매니지먼트 기능은 이 엔진이 안정적으로 동작한 이후 연결한다.
