# PROJECT V — 데이터 소스 레지스트리 (SOURCES.md)

**작성:** PV-1 Research 에이전트 · **기준일:** 2026-11-18 · **조사 시점 라이브 패치:** release-13.10

이 문서는 README §3.1의 수집 항목과 §3.2/§3.3의 상태·검증 분류를 따른다.
기계 판독용 원본은 [`datasets/registry/sources.json`](../datasets/registry/sources.json),
스키마는 [`datasets/registry/SCHEMA.md`](../datasets/registry/SCHEMA.md).
상태표는 [`DATA_AVAILABILITY.md`](DATA_AVAILABILITY.md), 라이선스는 [`LICENSE_AUDIT.md`](LICENSE_AUDIT.md),
5개 핵심 저장소 상세 검증은 [`research/`](research/).

> **검증 범위 고지.** 이번 세션에서 **실제로 접근·열람·검증한 것**은
> C9 Gameplan, vrfkit, ValoReview, ValorantReplayParser, ValorantWebReplayer(소스 클론·열람)과
> valorant-api.com(실데이터 GET), 그리고 일부 URL의 도달성(HTTP 200)뿐이다.
> VCT Reference·vctstats는 **Data 에이전트(PV-2) 담당**이라 항목만 등록하고 상태는 `PV-2 검증 예정`으로 둔다.
> 나머지 URL은 README/Handoff에서 수집한 목록이며 `verification_level 0`(미검증)이다.
> 받지 못한 데이터 파일을 받은 것처럼 기록하지 않는다 (Handoff §24.1).

---

## 1. 검증 요약 (한눈에)

| 구분 | 소스 | 상태 | 검증수준 | 핵심 사실 |
|---|---|---|---|---|
| ✅ 검증 | **C9 Gameplan** | VERIFIED_SOURCE_CODE | **L2** | 파생 이동모델·33경기 메타데이터 **존재**. 원시 51MB 궤적은 **gitignore(부재)**. 원시는 GRID 파트너 인증 필요 |
| ✅ 검증 | **vrfkit** | VERIFIED_SOURCE_CODE | **L1** | Rust `.vrf→Parquet`. 128Hz 위치/회전/속도 스키마 문서 확인. 빌드·실행은 미수행(.vrf 없음) |
| ✅ 검증 | **ValoReview** | VERIFIED_SOURCE_CODE | **L1** | Apache-2.0. read/decoded/inferred/simulated 출처 라벨링 모범. Windows+.vrf 필요(미실행) |
| ✅ 검증 | **ValorantReplayParser** | VERIFIED_SOURCE_CODE | **L1** | MIT, .NET 10, vrfkit/ValoReview의 상류. 이벤트 디코더 |
| ✅ 검증 | **ValorantWebReplayer** | VERIFIED_SOURCE_CODE | **L1** | MIT, Windows 전용. `.vrf→미니맵 뷰어`. 익명모드 한계표 명확 |
| ✅ 검증 | **valorant-api.com** | VERIFIED_API | **L2** | 실 GET 성공: 30요원/21무기/27맵, build release-13.10. 미니맵 변환 좌표 제공 |
| ⏳ PV-2 | **VCT Reference** | PV-2 검증 예정 | L0 | DuckDB 통계 DB. PV-2가 다운로드·스키마 분석 |
| ⏳ PV-2 | **vctstats** | PV-2 검증 예정 | L0 | LightGBM 승률모델+VLR 수집. PV-2가 소스·누출 분석 |
| 🔒 인증 | Riot Developer, GRID, Blender 맵 | AUTH_REQUIRED | L0 | 사용자 키/파트너 인증/Drive 로그인 필요 |
| 👁 열람전용 | VLR.gg, 분석 플랫폼 17종, 게임규칙 | VIEW_ONLY | L0 | 공식 API/대량다운로드 미확인 → 분석 참고용 |
| ❓ 미검증 | 비공식 API·ETL·예측·VOD·맵·ML 저장소 | UNVERIFIED | L0 | 목록만 수집 |

**검증수준(README §3.3):** L0 링크확인 · L1 구조확인 · L2 실제접근 · L3 재현완료.

---

## 2. 핵심 검증 소스 (PV-1 실제 확인)

### 2.1 C9 Gameplan — `joshghal/c9-gameplan-backend` (MIT)
- **유형/계층:** 전술 시뮬레이션 백엔드 / Layer C
- **접근:** 공개 git clone (인증 불필요). 커밋 `0c971bb` (2026-02-03).
- **실제 확인한 데이터(저장소 내 존재, python `json.load` 성공):**
  - `app/data/vct_match_metadata.json` — 33개 경기 UUID → `{tournament, date, teams, series_id, map}` (VCT Americas 2024~)
  - `app/data/*_movement_models.json` — 팀별(약 14팀) 이동 모델(Markov식 구역 전이)
  - `app/data/position_patterns.json`, `vct_zone_definitions.json`, `opponent_profiles.json`, `hold_angles.json` 등
  - `output/sim_*.json` — 시뮬레이션 출력 샘플 `{metadata, result, snapshots, events}`
- **중요 한계(확인됨):**
  - README 헤드라인 **"592,893 position samples (51MB `position_trajectories.json`)"** 파일은 **`.gitignore`로 제외되어 저장소에 없다.**
  - 원시 위치는 GRID 이벤트 JSONL에서 파생되며, `scripts/download_grid_matches.py` 주석에 따르면 **GRID 포털에서 VCT 파트너 자격으로만** 내려받을 수 있다(API는 메타데이터만).
  - "86% 정확도"는 README 자체 수치이며 독립 재현하지 않았다.
  - 저장소에 든 것은 **집계된 파생 모델**이지 프레임 단위 원시 데이터가 아니다.
- **프로젝트 쓰임:** A* 경로탐색·경제·전투 모델·VCT 보정 행동의 직접 선례. Ascent 프로토타입에 즉시 참고 가능.

### 2.2 vrfkit — `yakisoba0728/vrfkit` (Apache-2.0)
- **유형/계층:** Rust `.vrf` 파서 / Layer B. 커밋 `9ece4ab` (2026-11-16). MSRV Rust 1.86.
- **입력/출력:** 입력 `.vrf`(Unreal 네트워크 리플레이) → 출력 **Parquet 6 메인 + 7 체크포인트 테이블 + `manifest.json`** (DuckDB/polars/pandas 호환).
- **확인한 핵심 스키마 — `movement.parquet` (14열, 전부 NOT NULL):**
  `time_ms`(리플레이 시작 후 ms), `packet_id`, `character_net_guid`, `pos_x/pos_y/pos_z`(cm), `yaw/pitch`(도), `vel_x/vel_y/vel_z`(cm/s), `timestamp`(**128Hz 서버틱, 라운드마다 리셋**), `movement_state`, `move_type`. 좌표계는 Unreal 좌수 Z-up.
- **지원 빌드:** 11.06 ~ **13.10** (라이브 패치와 일치).
- **한계:** 이번 세션에서 **빌드/실행 미수행**(cargo 빌드가 환경 정책상 차단, `.vrf` 샘플도 없음) → 소스·문서 수준(L1) 검증. 표시명/Riot ID/KDA/킬 귀속은 `.vrf`에 없음. Oodle 압축(oozextract) 의존.
- **프로젝트 쓰임:** 최고 정밀도 위치 소스(128Hz). 사용자가 `.vrf`를 제공하면 Layer B 공간 그라운드트루스 1순위 후보.

### 2.3 ValoReview — `dhinakar-v/ValoReview` (Apache-2.0)
- 커밋 `02e8065` (2026-08-28). FastAPI + React 19 + three.js, C#(.NET 10) 디코더 벤더링(`csharp/parser/`, THIRD_PARTY.md 기록).
- **모범 사례:** 화면의 모든 값을 **read / decoded / looked-up / inferred / simulated**로 라벨링 → README §13.3 Provenance 모델과 직접 대응.
- **생성(실데이터 아님):** 체력·방어구·크레딧·무기·ATK/DEF는 `.vrf`에 없어 `web/src/model/synthetic.ts`에서 **시뮬레이션**(결정론적)하고 `SIMULATED` 칩 표기. 좌표는 절대 생성하지 않음.
- **한계:** Windows `.bat` 러너 + .NET 10 SDK + `.vrf` 필요 → **미실행**. 스킬 범위는 수기 커뮤니티 표(`abilityfacts.py`)에서 조회.

### 2.4 ValorantReplayParser — `michel-giehl/ValorantReplayParser` (MIT)
- 커밋 `fbf24b6` (2026-11-11). .NET 10, NuGet `0.1.0-alpha.2`(실험적). **vrfkit·ValoReview의 상류.**
- `IReplayEventSink`로 디코딩된 `ReplayEvent` 스트림 + 메타데이터 방출. `Read()`는 메타/패킷/번치 통계·진단 반환.
- **한계:** 알파 API 변동 가능. 호환성 통과 ≠ 전 기능 디코딩. 이번 세션 빌드/실행 미수행.

### 2.5 ValorantWebReplayer — `talhakoek/ValorantWebReplayer` (MIT)
- 커밋 `e060000` (2026-06-19). **Windows 전용**, Node 20. `ValorantReplayParserPlayground`(자립 .NET 10 바이너리) + 채널-오픈 이벤트 노출 패치.
- 입력 로컬 `.vrf` → 브라우저 스크럽 미니맵 뷰어(위치·라운드·스킬·스파이크). 에셋은 valorant-api.com(공개).
- **익명모드 한계표(문서화됨):** 실명/요원별 아이콘/KDA/킬 귀속/실제 조준 방향은 Riot match-details 없이는 불가. 경쟁전 `.vrf`는 ProfileName 익명화.

### 2.6 valorant-api.com (VERIFIED_API, L2)
- **실제 GET 성공(2026-11-18):** `/v1/version` → build `release-13.10`, engine 5.3.2, buildDate 2026-11-07. `/v1/agents?isPlayableCharacter=true` → **30**(abilities 슬롯 Ability1/Ability2/Grenade/Ultimate/Passive). `/v1/weapons` → **21**. `/v1/maps` → **27**(미니맵 변환 좌표 포함).
- **제공 O:** 요원/무기/스킬 카탈로그, 맵 UUID, 월드→미니맵 변환. **제공 X:** 경기 텔레메트리, 충돌/내비 지오메트리, 스킬 수치(반경·지속). 라이선스/ToS 미확인 → 재배포 unknown.
- **PV-1 2차:** 이 API를 정규화해 게임 데이터 카탈로그 생성 — [`docs/research/CATALOG.md`](research/CATALOG.md), 빌더 [`tools/catalog-builder/`](../tools/catalog-builder/), 스키마 [`datasets/catalog/schema/`](../datasets/catalog/schema/). 산출(무기21·요원30·스킬130) 스키마 통과, pytest 9 passed. 라이선스 불명확으로 **생성 데이터는 커밋 안 함(gitignore)**, 로컬 재생성.

---

## 3. PV-2(Data 에이전트) 위임 — 항목만 등록

| 소스 | URL | PV-2 작업 | 비고 |
|---|---|---|---|
| **VCT Reference** | https://vct-reference.com/ (`/dataset`, `/terms`) | DuckDB 다운로드, 테이블/결측률 분석, 약관 확인 | Layer A 최우선 통계 DB |
| **vctstats** | https://github.com/bernielaird/vctstats (+ bernielaird.com/vct) | VLR 수집코드·SQLite·LightGBM 특징·누출 분석 | 승률모델 선례(§26.3) |

이 둘은 PV-1이 다운로드/스키마 분석을 **수행하지 않았다.** 상태는 `PV-2_PENDING`.

---

## 4. 공식/인증 필요 소스 (AUTH_REQUIRED)

| 소스 | 인증 | 핵심 메모 |
|---|---|---|
| **Riot Developer API** | 사용자 API 키 | 리플레이/10인 위치 제공 **가정 금지**(README §4.1). 키는 사용자가 제공할 때까지 생성·우회 안 함 |
| **Riot × GRID Open Access** | VCT 파트너 자격 | 과거 이벤트 JSONL은 **포털 수동 다운로드**(C9 스크립트로 교차확인). 전 위치 제공 여부 미확인 |
| **사용자 제공 Blender 맵 (Google Drive)** | Drive 로그인 | 11개 맵(.blend) + 추가 폴더. **미다운로드**. 충돌 메시 없을 수 있음(§10.3). Ascent 우선 |

---

## 5. 열람 전용 / 분석 참고 (VIEW_ONLY, 데이터 공급원 아님)

- **VLR.gg** (+ 비공식 API `vlrggapi`, `vlresports`, `grgaoun/vlr`): 2D Replay는 일부 경기만. 공식 API 없음, ToS 적용.
- **분석 플랫폼 17종** (RIB.GG, THESPIKE, Bo3.gg, Tracker.gg, Ascend, statsIQ, morat.ai, Qiton, Praccly, Offangle, ValoPins, Valorant Scout, OP.GG, ValoPeek, kogni, Tricks.gg, VODs.space, valab vrf-inspector): 실제 대량 다운로드/API 미확인 → **분석 방식 참고용**(README §6 지침).
- **게임 규칙/위키/패치노트**: 경제·궁극기·스킬 규칙은 **패치별**로 관리(Handoff §10). 공식 패치노트 기준으로 확정.

---

## 6. 미검증 저장소 목록 (UNVERIFIED, L0 — 목록만)

- **ETL/데이터**(§7): VLML, valorant-economy-analysis-vct, Valorant-Esports-Tournament-Ecosystem
- **예측/ML**(§7): Valorant-Match-Predictor, Velo.gg, valPRED, valo-player-intel — *정확도 신뢰 금지, 누출·분할·패치 확인 필요*
- **추가 리플레이**(§8): ValoP, ValorantReplayViewer (vrfkit 등으로 이미 역량 검증됨)
- **VOD/CV**(§9): valoscribe, valoscribe-VOD-ANALYSIS, keith-ng/vct, Valorant-Strategy-Mapping-Tool, valorant-vod-analyzer — *CV 출력은 저신뢰*
- **맵**(§10): ValorantBrowser, Valorant-Zone-Stats, Piana
- **ML 데이터셋**(§12): EsportsBench(HTTP 200), D2E-VALORANT, gaming-500-hours, **X-EGO-CS(=카운터스트라이크, VALORANT 아님)**
- **참고 게임**(§2): Football Manager, OOTP, vctmanager, VCT Draft, ValoPlant — *설계 참고, 데이터 아님*

---

## 7. 막힌 소스와 대체 (네트워크/인증 차단 기록)

| 막힌 것 | 이유 | 대체 |
|---|---|---|
| GRID 과거 이벤트 JSONL | VCT 파트너 자격 필요 | C9가 공개한 **파생 이동모델**(위치 분포 근사); 또는 사용자 `.vrf` → vrfkit |
| Riot 공식 10인 위치/리플레이 | 공식 API 미제공 추정 + 키 필요 | **`.vrf` 로컬 캡처 → vrfkit/ValoReview**(128Hz 위치); 방송 VOD CV(저신뢰) |
| Blender 맵(Drive) | 인터랙티브 Drive 인증 | valorant-api 맵 변환 좌표 + 커뮤니티 맵 저장소(미검증) |
| vrfkit 빌드/실행 | 환경 정책상 cargo 빌드 차단 + `.vrf` 샘플 없음 | 소스/문서 스키마로 I/O 확정(L1); 사용자 `.vrf` 확보 시 재현(L3) 가능 |

---

*변경 이력: v1.0 (2026-11-18, PV-1) — 최초 레지스트리 작성.*
