# PROJECT V — 핵심 소스 상세 검증 (PV-1 Research)

**기준일:** 2026-11-18 · **검증자:** PV-1 Research 에이전트

Handoff TASK 003 중 PV-1 담당분(C9 Gameplan, vrfkit, ValoReview + ValorantReplayParser, ValorantWebReplayer)의
실제 클론·열람 결과. 외부 저장소는 `/tmp/pv-clones/`에 클론했고 **PROJECT V 저장소에는 커밋하지 않았다**.
VCT Reference·vctstats는 PV-2 담당이라 제외.

재현 방법:
```bash
mkdir -p /tmp/pv-clones && cd /tmp/pv-clones
git clone --depth 1 https://github.com/joshghal/c9-gameplan-backend.git
git clone --depth 1 https://github.com/yakisoba0728/vrfkit.git
git clone --depth 1 https://github.com/dhinakar-v/ValoReview.git
git clone --depth 1 https://github.com/michel-giehl/ValorantReplayParser.git
git clone --depth 1 https://github.com/talhakoek/ValorantWebReplayer.git
```

---

## 1. C9 Gameplan — `joshghal/c9-gameplan-backend`

- **커밋:** `0c971bb` (2026-02-03) · **라이선스:** MIT · **스택:** FastAPI/Python 3.11, NumPy/Pandas/SciPy, Anthropic SDK(코칭)
- **검증 수준:** **L2** (저장소 내 파생 데이터 JSON을 실제로 읽음)

### 1.1 입력 포맷 (데이터 파이프라인)
`scripts/`에 수집·추출 파이프라인 존재:
- `download_grid_matches.py`, `download_grid_file_api.py` — GRID에서 수집. **과거 이벤트 JSONL은 GRID 포털에서 VCT 파트너 자격으로만** 다운로드(주석 명시), API는 메타데이터만.
- `extract_trajectories.py`, `extract_all_positions.py`, `combine_position_data.py` — 원시 이벤트 → 위치 궤적.
- `extract_movement_patterns.py`, `extract_*_patterns.py`, `generate_*_vct.py` — 궤적 → 집계 모델.
- `scrape_vlr_stats.py` — VLR 보조 통계.

### 1.2 출력 필드 (저장소에 실재하는 데이터)
| 파일 | 크기 | 내용(실측) |
|---|---|---|
| `app/data/vct_match_metadata.json` | 21KB | 33 경기 UUID → `{tournament, date, teams[], series_id, map}` |
| `app/data/<team>_movement_models.json` (cloud9/nrg/sentinels/… ~14팀) | 0.5–6.8MB | 팀별 구역 전이(이동) 모델 |
| `app/data/position_patterns.json` | 554KB | `{metadata, maps}` 위치 패턴 |
| `app/data/vct_zone_definitions.json` | 89KB | 맵 구역 정의 |
| `app/data/opponent_profiles.json`, `hold_angles.json`, `trade_patterns.json`, `spike_carrier_patterns.json`, `economy_patterns.json`, `simulation_profiles.json`(85 선수) | — | 파생 행동/경제 모델 |
| `output/sim_*.json`, `output/batch_*.json` | 0.05–2.6MB | 시뮬레이션 출력 `{metadata, result, snapshots, events}` |

### 1.3 실행 가능 여부
- API 엔드포인트 문서화됨(시뮬레이션 tick/monte-carlo, 전략 라운드, 경기 아카이브, 코칭 SSE). 라이브 데모 URL 존재.
- **로컬 실행은 미수행**: `requirements.txt` 설치 + `ASI1_API_KEY`(LLM) 필요. Python으로 **데이터 로드만** 검증(L2), 시뮬레이션 재현(L3) 아님.

### 1.4 핵심 한계
- **원시 51MB `position_trajectories.json`은 `.gitignore`로 제외 → 저장소에 없음.** 헤드라인 "592,893 샘플"의 프레임 단위 원본은 미확보.
- 저장소 데이터는 **집계 모델**(README 성능 수치는 자체 보고, 미재현).

### 1.5 PROJECT V 활용
Ascent 프로토타입(Handoff §19)에 즉시 참고: 33경기 메타데이터로 Ascent 경기 식별, 구역 정의/이동 모델로 belief·행동 후보 초기화. 단, **실데이터가 아닌 파생 모델임을 provenance에 표시**.

---

## 2. 리플레이 파서 3종 — README §8.2 체크리스트 평가

`.vrf` 샘플이 없어 **디코딩 실행은 미수행**. 아래는 소스·문서 기준(L1) 평가.
`✅`=문서/스키마로 지원 확인, `◐`=부분/파생, `❌`=미제공, `—`=미확인.

| # | §8.2 항목 | vrfkit (Rust/Apache-2.0) | ValorantReplayParser (C#/MIT) | ValoReview (Py+C#/Apache-2.0) |
|---|---|---|---|---|
| 1 | 지원 VRF 버전 | ✅ 11.06–13.10 (빌드별 표) | ✅ "current builds" 호환검사 | ✅ VRP 디코더 벤더 |
| 2 | 지원 게임 패치 | ✅ 빌드별 브랜치 | ◐ | ◐ |
| 3 | 디코딩 이벤트 | ✅ events.parquet | ✅ ReplayEvent 스트림 | ✅ 라운드/킬/스킬 캐스트 |
| 4 | 선수 위치 | ✅ movement.parquet | ✅(이벤트) | ✅ 라다/3D 좌표 |
| 5 | 위치 샘플링 간격 | ✅ 128Hz 서버틱(`timestamp`), `time_ms` | ◐ | ◐(디코더 의존) |
| 6 | 시선 방향 | ✅ yaw/pitch(도) | ◐ | ✅ |
| 7 | 체력 | ◐ fields.parquet 속성 | ◐ | ❌ `.vrf`에 없음→**simulated** |
| 8 | 방어구 | ◐ | ◐ | ❌ simulated |
| 9 | 무기 | ◐ 속성 | ◐ | ❌ simulated(보유 무기) |
| 10 | 탄약 | ◐ | — | ❌ |
| 11 | 스킬 사용 | ◐ RPC/이벤트 | ◐ | ✅ 캐스트 추론(looked-up 수치) |
| 12 | 스킬 오브젝트 | ◐ | — | ◐ |
| 13 | 스파이크 상태 | ✅ BombPlayerState 등 | ✅ | ✅ 설치 |
| 14 | 킬·데스 | ✅ | ✅ | ✅ |
| 15 | 라운드 시간 | ✅ 라운드마다 `timestamp` 리셋 | ✅ | ✅ |
| 16 | 요원 식별 | ✅ characterId/GUID(교차검증) | ✅ | ✅ |
| 17 | 플레이어 식별 | ✅ subject UUID, NetGUID | ✅ | ✅(inferred 팀/사이드) |
| 18 | 맵 식별 | ✅ | ✅ | ✅ |
| 19 | 출력 형식 | **Parquet 13테이블 + manifest.json** | C# 객체/이벤트 싱크 | 웹 뷰어(FastAPI+three.js) |
| 20 | 처리 속도 | ✅ PERFORMANCE_NOTES; 콜드 103캡처≈5s(ValoReview 수치) | — | ✅ 콜드 ~5s / 웜 0.03s |
| 21 | 실제 실행 성공 | ❌ **미수행**(빌드 차단·.vrf 없음) | ❌ 미수행 | ❌ 미수행(Win 전용) |

### 2.1 공통 확정 사실
- **`.vrf`에 없는 값:** 표시명/Riot ID, KDA/점수, 킬 귀속, 체력·방어구·크레딧·보유무기·ATK/DEF, 스킬 수치(반경·지속). 이들은 **추론 또는 시뮬레이션** 대상 → README §8.3·§9.3, Handoff §22.2와 정합.
- **위치 좌표계:** Unreal 좌수 Z-up, cm 단위. 월드→미니맵 변환은 valorant-api 맵 데이터로.
- **시간축:** `time_ms`(글로벌) vs `timestamp`(128Hz, 라운드 리셋) 구분 필수 → README §8.4 시간축 정규화에 직접 대응.

### 2.2 언어/성숙도 비교 (Handoff §7.3)
- **vrfkit(Rust):** 가장 성숙(744 Rust+1081 Python 테스트, 1,018 리플레이 검증, 빌드별 지원표, `#![forbid(unsafe_code)]`). **"모든 값 보존" 설계**(typed는 additive overlay). Parquet 출력이 우리 DuckDB/polars 스택과 일치 → **1순위 권장**.
- **ValorantReplayParser(C#):** 상류 레퍼런스. 이벤트 디코딩 의미 교차검증용. NuGet alpha(변동 가능).
- **ValoReview(Py+C#):** 통합 뷰어 + **출처 라벨링 모범**. Windows 러너라 재현성은 낮지만 provenance 설계 참고 가치 최상.

---

## 3. ValorantWebReplayer (요약, L1)
- 커밋 `e060000`(2026-06-19), MIT, **Windows 전용**. `.vrf`→브라우저 미니맵 뷰어.
- `ValorantReplayParserPlayground` 바이너리 + 채널-오픈 이벤트 패치. 에셋은 valorant-api.com.
- **익명모드 한계표** 문서화: match-details 없이는 실명/요원별아이콘/KDA/킬귀속/조준방향 불가.
- 우리 replay-engine의 "읽히는 것 vs 서버 필요한 것" 경계 참고 템플릿.

---

## 4. 다음 에이전트 인계 (Handoff §24.1)

**PV-2(Data)에게:**
- 실데이터 즉시 가용: **C9 파생 모델**(`app/data/*`), **valorant-api 카탈로그**(요원30/무기21/맵27+변환좌표).
- 검증 필요: **VCT Reference DuckDB**, **vctstats**(소스·누출). 약관 확정 후 LICENSE_AUDIT 갱신.
- 원시 위치 경로: 사용자 `.vrf` 확보 시 vrfkit으로 `movement.parquet` 생성 → Layer B.

**PV-3(Spatial/Simulation)에게:**
- 좌표: Unreal cm Z-up, valorant-api 맵 변환. 시간축: `time_ms` vs 128Hz 라운드-리셋 `timestamp`.
- Ascent 우선. 맵 지오메트리(Blender)는 AUTH_REQUIRED(미확보) — 대체는 valorant-api 맵 + 커뮤니티 맵 저장소(미검증).
- provenance 모델은 ValoReview의 read/decoded/looked-up/inferred/simulated 5분류 채택 권장.
