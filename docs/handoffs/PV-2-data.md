# PROJECT V — TASK HANDOFF

**Agent:** PV-2 Data Engineering · **Date:** 2026-11-18 · **Branch:** `claude/pv-data`
**Scope:** Handoff TASK 003 (VCT Reference + vctstats), TASK 004 (data schema), TASK 005 (minimal dataset)

> **Bottom line:** Real data **WAS secured.** The VCT Reference DuckDB (13 MB, 10 tables) was
> downloaded and read (verification level 2), and **two real matches were normalized** into
> `datasets/normalized/` — including a real **Ascent** map with full round economy. vctstats was
> cloned and its code read (level 2); it shows Layer-B positions *could* be parsed from vlr.gg
> 2D-replay logs, but **vlr.gg's ToS prohibits the automated access + redistribution that method needs**
> (verified by PV-Spatial at vlr.gg/terms), so the path is **not usable** — no vlr scraper or
> vlr-derived data was implemented or committed. Real per-player positions were **not** obtained; the
> positional/decision layer is supplied as **clearly-labelled synthetic Ascent data** (10 scenarios +
> one map), never mixed with the real data. Authorized real Layer-B routes (later) = Riot/GRID official
> feeds (API key) or self-captured VRF via vrfkit.

---

## 1. 작업 목표
- 핵심 자료 2개(**VCT Reference**, **vctstats**)를 실제로 접속·다운로드·검증한다.
- 공통 데이터 스키마(Match/Map/Round/Player/Team/Economy/Event/Position/Provenance + WorldState)를
  정의한다. 실데이터 확인 필드와 향후 필드를 구분하고, 머신 스키마(JSON Schema, camelCase, 단위 명시)를
  PV-3 TypeScript 타입 기준으로 제공한다.
- Python ETL(`tools/data-collector/`)과 검증기(`tools/data-validator/`)를 만들고 테스트한다.
- 최소 데이터셋: 가능하면 실제 경기 1개 정규화, 실패 시 합성 Ascent 데이터 + Handoff §20 시나리오 10개.

## 2. 완료한 작업 (실제 구현·검증한 것만)
1. **VCT Reference 검증 (L2).** `https://vct-reference.com/dataset/vct.duckdb` 다운로드 성공:
   **13,381,632 bytes**, `sha256 a1a189d0ec7d9a71d7586645a3ce5d39bfea719c2f782bb287a23a300cea4890`.
   DuckDB로 10개 테이블 스키마와 행수를 실제로 읽음(아래 §4). 라이선스 확인: 상업적 사용 포함 무료,
   무보증, 공개 프로 경기 페이지 기반.
2. **vctstats 검증 (L2).** `bernielaird/vctstats` 클론, 소스 코드 분석. 위치 추출 방식·SQLite 구조·
   라운드 상태 벡터·LightGBM 특징·데이터 누출 처리·라이선스 확인(아래 §4). 라이선스 **MIT**(코드);
   원본 HTML/DB(~4GB)는 저장소에 포함되지 않음(.gitignore) → 실제 위치 데이터는 확보하지 못함.
3. **머신 스키마 11개** (`datasets/schema/*.schema.json`, draft 2020-12, camelCase, 단위 명시) 작성,
   전부 컴파일·상호참조 통과.
4. **문서 스키마** `docs/DATA_SCHEMA.md` — 엔티티별 CONFIRMED/FUTURE 표.
5. **ETL** `tools/data-collector/` — 실데이터 정규화기 + 합성 생성기 + CLI + pyproject + 테스트.
6. **검증기** `tools/data-validator/` — 스키마 검증 + 실/합성 분리 규칙 강제 + pyproject + 테스트.
7. **데이터 생성:** 실제 경기 2개 정규화(`754737`, `754730`), 합성 시나리오 10개, 합성 Ascent 맵 1개.
8. **테스트 실제 실행**(§7).

## 3. 변경한 파일 (내 소유 범위 내)
```
datasets/schema/                       11 JSON Schema + README  (머신 스키마, PV-3 타입 기준)
docs/DATA_SCHEMA.md                    엔티티별 CONFIRMED/FUTURE 문서
docs/handoffs/PV-2-data.md             이 문서
datasets/raw/vct-reference/            download.sh, .gitignore(*.duckdb), SOURCE.json
datasets/normalized/vct-reference/754737/  match/teams/players/maps/rounds.json (실제, GF)
datasets/normalized/vct-reference/754730/  match/teams/players/maps/rounds.json (실제, Ascent+경제)
datasets/normalized/README.md
datasets/synthetic/scenarios/scenario_01..10.json   DecisionContext (PV-4 사용)
datasets/synthetic/ascent/map,rounds,events.json    합성 Ascent 타임라인
datasets/synthetic/README.md
tools/data-collector/   pyproject, README, src/pv_data_collector/{__init__,provenance,vct_reference,synthetic_ascent,cli}.py, tests/{conftest,test_provenance,test_synthetic,test_vct_reference}.py
tools/data-validator/   pyproject, README, src/pv_data_validator/{__init__,validator,cli}.py, tests/{conftest,test_validator}.py
```
> `README.md`, `Handoff.md`, 루트 설정, `packages/`, `apps/`, `docs/SOURCES.md`, `datasets/registry/`,
> `datasets/spatial/` 는 **수정하지 않음**(소유권 분리).

## 4. 데이터 출처 (실제 사용한 URL·파일)

### 4.1 VCT Reference — **VERIFIED_DOWNLOADABLE (L2)**
- 다운로드: `https://vct-reference.com/dataset/vct.duckdb` · 약관 `https://vct-reference.com/terms`
- 라이선스: 상업적 사용 포함 무료·무보증·재배포 허용(출처 링크 권장). Riot 비제휴 취미 프로젝트,
  공개 프로 경기 페이지 기반. **도박/베팅 용도 금지.**
- **실제 테이블(10개)과 행수:**
  | table | rows | 핵심 컬럼 |
  |---|---|---|
  | matches | 2,930 | match_id, event, patch, team0/1_id, score0/1, format, utc_timestamp, veto[] |
  | maps | 7,398 | game_id, map_name, score0/1, performance_available, economy_available |
  | rounds | 156,769 | round_num, winner_team, side, outcome, loadout_t0/t1, bank_t0/t1 |
  | player_map | 73,976 | rating/acs/adr/kills/…/clutch_1v1..5 (각 _all/_atk/_def), econ, plants, defuses |
  | kill_matrix | 164,840 | row/col_player_id, kills, op_kills, fk_kills |
  | notables | 260,614 | stat_type(멀티킬/클러치), round_num, opponents[] |
  | players | 1,227 | player_id, player_name, country |
  | teams | 225 | team_id, team_name, country |
  | stat_source | 10,040 | 어떤 블록이 kill-feed에서 유도되었는지 |
  | feed_fill_meta | 23 | 유도 통계 정확도 메타 |
- **enum 실측:** `rounds.side`∈{attack,defense}; `rounds.outcome`∈{elimination,bomb_detonated,defuse,time_expired};
  `map_name` 13종(Abyss..Sunset, Corrode/Summit 포함).
- **결측/커버리지:** 경제 기록 라운드 128,867/156,769(**~82%**). 중국 맵은 멀티킬/클러치/킬매트릭스
  ~57.9%, 경제 ~7.9%만 보유. → `maps.economy_available`/`performance_available`로 게이트 필수.
- **한계:** 위치/틱/이벤트 타임라인 **없음**(Layer A 통계 전용).

### 4.2 vctstats — **VERIFIED_SOURCE_CODE (L2)**
- `https://github.com/bernielaird/vctstats` (MIT). HEAD `4a9a40eb`.
- 구조: Java 스크레이퍼(vlr.gg) → `data/raw/*.html`(~4GB) → SQLite `data/vct.db` → Python LightGBM.
- **위치 추출 방식(핵심):** `ReplayPageParser.java` 가 vlr.gg 2D 리플레이(`?tab=logs`)의
  `.lg-round[data-round] .lg-map[data-map]` JSON을 파싱. 이벤트마다
  `pos`(x,y), `from`(x,y), 그리고 `locs = [[playerId, x, y, angleDeg], …]`(모든 선수의 **이벤트 시점**
  위치 스냅샷)을 제공. 클럭 `"M:SS"`. 좌표는 미니맵 픽셀계. README 기준 ~600k 이벤트·**3.7M 위치**.
  → **Layer B(위치)는 실제로 vlr 2D 리플레이에서 추출 가능**하나 리플레이 데이터가 있는 경기에 한함
  (중국 등은 없음). 실측 JSON 형태를 fixture로 확인함.
- **SQLite/라운드 상태 벡터:** `game_states`(game_id, round_num, state_num, event_num, time_seconds,
  attacker_id, defender_id, atk_alive, def_alive, spike_planted, atk_won, atk/def_start_loadout),
  `replay_events`, `state_win_prob`, `event_prob_before`. 상태는 킬/설치마다 1개.
- **LightGBM 특징(train_wpa.py):** atk/def_alive, alive_diff, spike_planted, time_seconds,
  round_time_left, spike_time_left, atk/def_loadout(+diff), atk/def_bank, rifles/snipers/heavy_armor,
  score, round_num, year + 범주형 map_name, plant_site. 상수 `ROUND_SECONDS=100`, `SPIKE_SECONDS=45`.
  단조제약(alive/loadout). 목표 `atk_won`.
- **데이터 누출 처리:** 학습 2023–2025 / 테스트 2026(날짜 분할). 전체 점수화는 `GroupKFold(match_id)`
  (한 경기 상태를 그 경기로 학습한 모델이 보지 않음). early stopping도 경기 단위 분할. "just-before"
  행으로 미래정보 누출 방지. → README §22.3/§22.4, §26 요구사항을 **그대로 만족**.
- **원본 데이터 포함 여부:** 아니오(코드 + 소수 HTML fixture만). 실제 위치/DB 미확보.
- ⚠️ **vlr.gg ToS 제약(중요):** vctstats **코드는 MIT**이지만, 그 데이터 수집 방식(vlr.gg 2D 리플레이
  스크래핑)은 **vlr.gg 이용약관이 자동 접근·재배포를 금지**(개인·비상업만 허용)한다. PV-Spatial이
  `vlr.gg/terms` 원문으로 확인(`claude/pv-spatial:docs/research/spatial-sources.md §3b`). → PROJECT V는
  vlr `locs` 형태를 **스키마 참고용으로만** 쓰고, **vlr 스크레이퍼나 vlr 파생 데이터를 구현·커밋하지
  않는다.** 본 세션은 vlr 데이터·수집 스크립트를 받거나 커밋한 적이 없다(VCT Reference DuckDB만 사용).

> 발견했으나 이번에 직접 접근하지 않은 소스 정보는 PV-1(소스 레지스트리) 담당. 위 내용은 그대로 전달용.

## 5. 실행 방법
```bash
# (선택) 실제 소스 받기 — 13MB, git에는 미포함
./datasets/raw/vct-reference/download.sh

# 실제 경기 정규화
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  normalize-vct --db datasets/raw/vct-reference/vct.duckdb --match 754737 \
  --out datasets/normalized/vct-reference

# 합성 데이터(결정적)
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli gen-scenarios --out datasets/synthetic/scenarios
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli gen-map       --out datasets/synthetic/ascent

# 검증
PYTHONPATH=tools/data-validator/src python3 -m pv_data_validator.cli --datasets datasets --schema datasets/schema
```
의존성: Python ≥3.11, `duckdb`(정규화 전용), `jsonschema`(검증). `pip install -e tools/data-collector[dev]`.

## 6. 검증 방법
- 스키마 11종 컴파일 + 상호참조 해석.
- `tools/data-validator` 가 `datasets/**/*.json` 을 스키마별로 검증하고, **실/합성 분리 규칙**
  (`datasets/synthetic/` → synthetic=true, `datasets/normalized/` → false)을 강제.
- pytest: provenance 불변식, 합성 결정성(seed 동일→동일 출력), 시나리오 10개·DecisionContext 불변식
  (belief가 truth 위치를 누출하지 않음, scenario-07=1v4 등), 실데이터 정규화(결측 경제 비임퓨테이션).
  실데이터 테스트는 duckdb 파일이 있으면 실행, 없으면 skip.

## 7. 테스트 결과 (실제 실행)
```
datasets/schema        : 11 schemas compile OK
pv_data_validator CLI  : 22/22 files valid; 182 records checked
tools/data-collector   : 13 passed  (provenance 2, synthetic 7, vct_reference 4 — DB 존재하여 실행됨)
tools/data-validator   : 4 passed
```
미실행/실패 항목 없음. (실데이터 vct_reference 테스트 4개는 vct.duckdb 가 세션에 존재하여 **실제로 실행**됨.)

## 8. 현재 미완료 사항
- **실제 위치/이벤트(Layer B)**: 미확보. vlr 2D 리플레이 `locs` 형태는 파악했으나 **vlr ToS가 자동
  접근·재배포를 금지**하여 그 경로는 사용 불가(스크레이퍼 미구현). 인가된 대체(Riot/GRID 키, 자가 VRF)는
  아직 미확보 → Layer B는 합성으로 대체.
- **경제/궁극기 상수**: 합성 데이터의 무기가/방어구/궁극 포인트는 **근사 placeholder**(patch=`synthetic-approx`).
  패치별 실제 규칙 데이터화는 미완(README §10/§19/§21, 게임룰 담당).
- **ID 크로스워크**: 현재 ID = VCT Reference 정수 ID. 2차 소스 병합용 레지스트리는 PV-1(`datasets/registry/`).
- **공간 데이터**: 좌표 변환/NavMesh/plant zone 권위본은 PV-spatial(`datasets/spatial/`). 합성 좌표는 임시.
- **parquet 산출물**: README §5.1의 *.parquet 세트는 미생성(정규화는 JSON으로 제공). 필요 시 추가.

## 9. 알려진 문제
- vctstats 원본 위치 데이터는 재배포되지 않음 → 실제 Layer B는 별도 수집 필요.
- GF 경기(754737)는 라운드 경제가 기록되지 않음(모든 라운드 `startEconomy=null`). 경제가 필요한 검증엔
  754730(Ascent 포함)이나 다른 경제 보유 경기를 사용할 것.
- VCT Reference는 매일 재빌드 → sha256/행수는 2026-11-12 빌드 기준. 재다운로드 시 값이 바뀔 수 있음.
- 합성 위치는 미니맵 근사(실측 아님). 실제 교전/시야 계산 전 공간 데이터로 교정 필요.

## 10. 설계 결정
- **실/합성 완전 분리**: 디렉터리 분리 + `provenance.synthetic` 플래그 + 검증기 강제. 임퓨테이션 금지
  (결측 경제는 `null` 유지).
- **좌표계 = 미니맵 단위**(vlr `locs`와 동일 프레임)로 통일 → 실·합성 비교 가능, 권위 변환은 공간팀.
- **시간 = ms**, 라운드 전투 클럭 100,000ms, 스파이크 45,000ms (vctstats 상수와 일치).
- **camelCase + 단위 명시** JSON Schema를 PV-3 TS 타입의 단일 기준으로.
- **DecisionContext = worldState(진실) + decidingTeamIdx + belief(관측/추론만)** 로 DECISION-004(정보 분리) 구조화.
- ETL 의존성 최소화(stdlib + duckdb + jsonschema). 과도한 프레임워크 지양(README §34).

## 11. 라이선스 및 권한
- **VCT Reference 데이터 — 약관 판단(명시):** 데이터셋 페이지 명문 "Free to use, including
  commercially, with no warranty"(출처 링크 권장), 약관(`/terms`)은 정보·오락 목적·도박 금지·무보증을
  규정하나 재배포 금지 조항은 **없음**. 판단: ① 원본 `.duckdb`는 **커밋하지 않음**(용량 13MB + 일일
  재빌드로 스냅샷이 금방 낡음 → 다운로드 스크립트 + SOURCE.json만); ② `datasets/normalized/`의 정규화
  산출물(소규모 변환 통계)은 "free to use" 허용 범위 안이고 provenance에 출처를 명시하므로 **커밋 가능**으로
  판단. 재배포를 명시 금지하는 조항이 확인되면 이 판단을 뒤집고 정규화 산출물도 내려야 함.
- **vctstats**: 코드 **MIT**(자유 사용). 단 수집 방식은 vlr.gg ToS(자동 접근·재배포 금지)에 저촉 →
  원본 HTML/DB 미배포, 코드/방식은 **스키마 참고용으로만** 사용. vlr 스크레이퍼·데이터는 커밋하지 않음.
- **합성 데이터**: PROJECT V 자체 생성물. 제약 없음. 단, 실제 경기로 오인 금지(플래그로 표시).

## 12. 다음 권장 작업 (우선순위)
1. **(PV-3)** `datasets/schema/`를 TS 타입으로 변환하고, `datasets/synthetic/scenarios/scenario_*.json`을
   Action Generator / Decision Debugger 입력으로 로드(§19, §20). 10개 시나리오가 그 입력 계약이다.
2. **(PV-spatial)** Ascent 미니맵↔게임 좌표 변환 + plant/spawn/nav zone 확정 → 합성 좌표를 실좌표로 교정.
3. **(PV-2 후속) Layer B 실데이터 — vlr 스크래핑 금지.** vlr.gg ToS가 자동 접근·재배포를 금지하므로
   vlr 리플레이 스크레이퍼는 구현하지 않는다. 대신 **인가된 경로만**: (a) Riot/GRID 공식 피드(API 키 필요,
   사용자 제공 전까지 보류), (b) 사용자 자가 캡처 **VRF** 파일 + `vrfkit`/`ValorantReplayParser`
   (제3자 ToS 없음). 둘 다 확보 전까지 Layer B는 합성으로 진행하고 그렇게 표시한다.
4. **(게임룰)** 패치별 경제/궁극 상수 데이터화 → 합성 placeholder 대체.
5. **(PV-1)** 소스 레지스트리(`docs/SOURCES.md`, `datasets/registry/`)에 위 §4 출처 반영.

## 13. 작업 재개 지점
- 먼저 읽을 파일: `docs/DATA_SCHEMA.md` → `datasets/schema/world-state.schema.json` →
  `datasets/synthetic/scenarios/scenario_01.json`(결정 입력 형태) → `datasets/synthetic/README.md`.
- 실행해 상태 확인:
  ```bash
  PYTHONPATH=tools/data-validator/src python3 -m pv_data_validator.cli --datasets datasets --schema datasets/schema
  (cd tools/data-collector && python3 -m pytest -q) && (cd tools/data-validator && python3 -m pytest -q)
  ```
- 실데이터 재현: `./datasets/raw/vct-reference/download.sh` 후 `normalize-vct`.

---

## 부록 A — PV-3로의 전달 내용 (Handoff §24.2)
- **통합 스키마:** `datasets/schema/*.schema.json` (11종, camelCase, 단위 명시) + `docs/DATA_SCHEMA.md`.
- **경기 ID 매핑:** `matchId` = VCT Reference match_id = vlr 경기번호. `gameId` = maps.game_id.
  팀은 `teamIds[0/1]`, 라운드/통계는 `teamIdx`(0/1)로 참조. 예: 754737 → maps
  [Summit 283286, Lotus 283287, Sunset 283288, Haven 283289].
- **선수 ID 매핑:** `playerId` = players.player_id(정수, 문자열화). **이름 문자열 병합 금지**(§13.2).
  예: LOUD=team 6961, Vitality=team 2059.
- **라운드 데이터:** `rounds.json` — winnerTeamIdx, team0Side, attackingTeamIdx(파생), outcome,
  startEconomy{loadoutValue,bank}(가용 시). 754730 Ascent(game 283266 계열)는 경제 보유.
- **이벤트 타임라인:** 실데이터 FUTURE — **인가된 경로(Riot/GRID 키, 자가 VRF)로만**(vlr 스크래핑 금지).
  형태는 `event.schema.json`, 합성 예시는 `datasets/synthetic/ascent/events.json`(위치 스냅샷 포함).
- **위치 데이터:** 형태 `position.schema.json`(미니맵 단위 + facingDeg). 실데이터 FUTURE(인가 경로만), 합성 제공.
- **데이터 신뢰도:** 레코드별 `provenance`(evidenceType/verificationLevel/synthetic/confidence).
  실=observed L2, 합성=simulated L0.
- **사용 예제:**
  ```python
  import json
  ctx = json.load(open("datasets/synthetic/scenarios/scenario_07.json"))
  ws, deciding = ctx["worldState"], ctx["decidingTeamIdx"]      # 1v4 operator-save
  own  = [p for p in ws["players"] if p["teamIdx"] == deciding and p["alive"]]   # 1명
  seen = [e["playerId"] for e in ctx["belief"]["visibleEnemies"]]                 # 관측된 적만
  # -> Action Generator 입력: 가능한 SAVE_OPERATOR / RETAKE / EXIT_KILL 후보 생성
  ```

---

# PROJECT V — TASK HANDOFF · 2차 (Priors & Validation Baselines)

**추가 작업일:** 2026-11-18 · **커밋:** phase-2 (아래) · **범위:** README §31, Handoff §22 — 실제 VCT
데이터로 의사결정 사전확률(prior) + 시뮬레이션 검증 기준선 생성.

## 2-1. 작업 목표
VCT Reference는 위치는 없지만 **라운드 결과 + 경제 스냅샷**이 있다. 이것으로 Action Generator/Outcome
Predictor가 쓸 **실측 통계**와 5v5 시뮬레이션이 맞춰야 할 **검증 목표치**를 만든다.

## 2-2. 완료한 작업
- **priors ETL** `tools/data-collector/src/pv_data_collector/priors.py` + 통계 헬퍼 `stats.py`
  (Wilson 구간, **경기 단위 클러스터 부트스트랩**). CLI `gen-priors` 추가.
- **머신 스키마** `datasets/schema/prior.schema.json` (검증기 라우팅: `datasets/derived/priors/*` → prior).
- **산출물** `datasets/derived/priors/*.json` 6종 + README. 각 파일에 source sha256·빌드일·필터·
  buy 임계값·셀별 n·Wilson·부트스트랩 수록. 전부 실데이터(synthetic=false).
- **검증 기준선 문서** `docs/VALIDATION_BASELINES.md` (목표 분포 + 허용 오차 제안).
- **테스트**: `test_stats.py`(Wilson 손계산 대조), `test_priors.py`(소형 DuckDB fixture 손계산 대조).

## 2-3. 핵심 산출 수치 (국제전, 빌드 2026-11-12)
| prior | 대표 수치 |
|---|---|
| economy_matchup (intl) | full>semi **0.66**, semi>eco **0.91**, eco>full **0.12**; 동일 tier 대각 **0.50**(sanity) |
| economy_matchup (Ascent) | full>semi **0.68**(n=1217), semi>eco **0.93** |
| pistol_conversion | 피스톨 승자 다음 라운드 승 **0.88**, 2연승 **0.37** |
| save_eco_future_value | eco→다음 라운드 승 **0.60** vs full→**0.51** (세이브 미래가치 근거) |
| side_map_baselines | 전맵 공수 **0.50/0.50**; Ascent 공격 전반 **0.58**/후반 **0.41** |
| round_outcome_distribution | 전맵 전멸 **0.66**/해체 **0.20**/폭발 **0.11**/시간초과 **0.03**; Ascent 전멸 **0.71** |

## 2-4. buy 분류 · 누출 방지 (중요)
- buy tier(팀 총 loadout, credits): pistol=라운드 1/13, eco<5000, semi 5000–20000(half+force 통합),
  full≥20000. 실제 bimodal 분포 기반. 임계값은 `priors.py`에서 조정 가능.
- per-team 행(라운드당 team0/team1 2행) → `n`은 team-round 수. 동일 tier 대각이 정확히 0.50인 것이
  내장 sanity check.
- **누출 방지(Handoff §22.3–22.4):** 경기 내 라운드 상관 → 부트스트랩은 **경기 단위**로 재표집
  (`groupingUnit=match_id`). 피스톨/eco prior는 *다음* 라운드를 **측정 대상**으로만 쓰고 결정 입력
  feature로는 쓰지 않음. season/patch/map 필터를 기록해 era별 재계산 가능.

## 2-5. Riot API 확인 (Layer B 대안 점검)
사용자 Riot 개발 키로 `kr.api.riotgames.com` 프록시 경유 실제 호출 결과:
- `/val/status/v1/platform-data` → **200**
- `/val/content/v1/contents` → **200** (요원/맵/무기 UUID 등 **콘텐츠 메타데이터** 확보 가능 — README §11 참고자료)
- `/val/match/v1/matches/{id}` → **403** (개발 키 권한 없음)
→ **결론:** Riot 개발 키는 **경기/위치 데이터(Layer B) 소스가 아님.** 콘텐츠 메타데이터용으로만 유효.
Layer B는 여전히 (a) GRID/프로덕션 Riot 피드(별도 권한) 또는 (b) 자가 캡처 VRF(vrfkit)만 인가 경로.

## 2-6. 테스트 결과 (실제 실행)
```
collector : 24 passed  (provenance2 + synthetic7 + vct_reference4 + stats6 + priors5... 신규 stats/priors 포함)
validator : 4 passed
검증 CLI  : 28/28 files valid; 188 records checked (priors 6종 포함)
```

## 2-7. 미완료 / 주의
- priors는 2021–2026 패치 혼합 pooled. era별 분리 기준선은 필터로 재생성 필요(컬럼은 남김).
- 위치 기반 검증(교전/시야)은 Layer B 미확보로 불가 — 현 기준선은 **결과·경제** 검증용.
- Ascent full-vs-eco 등 일부 셀은 소표본(n<100, `smallSample=true`) — 튜닝 금지.

## 2-8. 다음 권장
1. **(PV-3/Outcome Predictor)** `economy_matchup`·`save_eco_future_value`를 사전확률로 로드.
   `docs/VALIDATION_BASELINES.md`의 허용 오차로 시뮬레이션 출력 검증.
2. **(게임룰)** `/val/content`로 요원/무기/맵 UUID 레퍼런스 데이터셋 생성(선택) — README §11.
3. **(PV-2 후속)** Layer B 실데이터는 GRID 권한 또는 자가 VRF로만. era별 기준선 분리.

---

# PROJECT V — TASK HANDOFF · 3차 (Economy & Ultimate Engine v0)

**추가 작업일:** 2026-11-18 · **범위:** Handoff §15–16, §20.7–20.10, §29; README §19–22, P3.
**추가 소유:** `packages/economy-engine/`, `docs/ECONOMY_MODEL.md` (오케스트레이터가 범위 확장 지시).

## 3-1. 작업 목표
PV-2 priors를 소비하는 **경제 판단 엔진**(독립 TypeScript 패키지)을 만든다. 구매·세이브·미래가치·
궁극기 경제·출구킬을 각각 평가해 PV-3 Action Generator가 쓸 선택지를 낸다.

## 3-2. 완료한 작업
- **`packages/economy-engine`** 독립 패키지(package.json/tsconfig/vitest, 런타임 의존성 0).
  - `shared-mirror.ts`: `@pv/shared-types` 필드 미러(통합 시 import로 교체).
  - `rules.ts`: `@pv/game-rules` 수치 미러(provisional) + **PV-1 카탈로그 궁극 포인트(공식값)**.
  - `priors-fixture.ts`: PV-2 `datasets/derived/priors/` 실수치 스냅샷(출처·sha 기록).
  - 엔진 5종: `buy-strategy`, `future-value`, `save-decision`, `ultimate-economy`, `exit-kill`
    + `round-boundaries` + 통합 `evaluateEconomy()`.
- **출력 계약** `EconomyOption { action, currentRoundValue, futureValue, economicDelta, ultDelta, explanation }`.
- **문서** `docs/ECONOMY_MODEL.md` (인터페이스·수치 출처·설계 결정·빌드/테스트).
- **테스트** vitest 15개(규칙, 시나리오 07/08/09, 구매, 미래가치, 출구킬, 결정성).

## 3-3. 수치 출처 (중요)
- 경제 규칙(가격/방어구/로스보너스 `[1900,2400,2900]`/보상/궁극 포인트 획득): **@pv/game-rules 미러,
  전부 provisional(verified:false)** — 패치 소스 검증 전까지 사실로 취급 금지(README §29).
- **궁극 포인트 요구치: PV-1 카탈로그가 공식 현재값**(`pv-research:.../ability_facts.json` `ultPoints`,
  build release-13.10, gameplayVerified). PV-3 샘플과 4건 불일치 → **카탈로그 채택**:
  jett 8(≠7), sage 7(≠8), killjoy 9(≠8), brimstone 8(≠7).
- 승률 prior: PV-2 실데이터(`datasets/derived/priors/`, 빌드 2026-11-12) 스냅샷.

## 3-4. 핵심 설계 (사양 준수)
- **세이브는 단순 임계값 금지(Handoff §29).** SAVE_WEAPON vs PLAY_FOR_ROUND를 무기 보존가치 +
  궁극 포인트 차단 + 탈출 위험 + 현재 라운드 승률의 **가중 결합**으로 비교. 승률만 낮다고 세이브
  강제 안 함(Classic + 차단할 궁극 없음 → PLAY가 동점 이상).
- **경계에서 미래가치 0.** 하프/연장 리셋 직전(라운드 12·24·OT) 및 **매치포인트**(맵 종료 가능 →
  보존할 다음 라운드 없음)에서 `weaponFutureValue=0` → 매치포인트엔 세이브 대신 플레이 선호(§20.9).
- **궁극 포인트 차단(§15.2, §21.3):** 적이 정확히 1포인트 부족일 때 차단가치 최대, 이미 충전 시 0.
  생존=SAVE의 ultDelta 가산, 교전 사망=PLAY의 ultDelta 차감.
- **출구킬(§22):** 도주 적 고가 무기 파괴 EV vs 자기 라이플·적 궁극 급전 위험 비교.

## 3-5. 테스트 결과 (실제 실행)
```
packages/economy-engine: typecheck OK, build OK, vitest 15 passed (3 files)
  - rules(로스보너스·카탈로그 궁극포인트·무기가), scenarios 07/08/09, buy·future·exit-kill, determinism
런타임 스모크: evaluateEconomy(operator save) -> SAVE futureValue 0.4, economicDelta 1880
```

## 3-6. 미완료 / 주의
- 모든 경제 상수 provisional — 패치 소스 검증 패스 필요(게임룰 담당). `Rule<T>`로 노출해 교체 용이.
- `shared-mirror.ts`·`priors-fixture.ts`는 통합 시 실제 import/파일 로드로 교체.
- 패키지 그래프(워크스페이스)에 아직 미연결 — 독립 빌드. PV-3가 `evaluateEconomy` 직접 import 가능.
- node_modules/dist는 커밋 안 함(.gitignore).

## 3-7. 다음 권장
1. **(PV-3)** `evaluateEconomy`를 Action Generator의 Resource Cost / Expected Utility 입력으로 연결.
2. **(게임룰)** game-rules 경제/궁극 상수 패치 검증 → provisional 플래그 해제.
3. **(통합)** shared-mirror → `@pv/shared-types`, priors-fixture → `datasets/derived/priors/` 로더.

---

# PROJECT V — TASK HANDOFF · 4차 (Combat Prior + Validation Harness)

**추가 작업일:** 2026-11-18 · **범위:** README §30–31, Handoff §22·§24.4. 소유: `datasets/derived/`,
`tools/data-validator/`, docs.

## 4A — 교전 prior & 데이터 공백 (중요한 음성 결과)
VCT Reference의 킬 데이터 granularity를 실제 확인함:
- `kill_matrix` = (match,game,선수쌍) **집계**(총 kills/deaths/op/fk). 라운드 번호·시각·순서 **없음**.
- `rounds` = winner/side/outcome/economy만. 킬 없음.
→ **다음은 VCT Reference로 계산 불가**(인가 Layer B 필요): 첫킬→라운드 승(라운드 연결 없음),
  **인원 우위(5v4/4v3…) 전이 승률**(라운드별 alive 없음), **트레이드율**(킬 타임스탬프 없음).

**계산 가능한 것 → 생성함:** `datasets/derived/priors/combat_opening_duel.json`.
`player_map`의 `fk_atk/fd_atk/fk_def/fd_def` 집계로 **오프닝 듀얼(첫 교전) 승률**을 side·map별로.
(맵당 fk+fd = 라운드 수라서 성립. 공/수 합 = 1.) 경기 단위 부트스트랩·Wilson·소표본 플래그.
- 전맵: 공격 **0.457** / 수비 0.543. Ascent: 공격 **0.437** / 수비 0.563(수비가 첫 교전 우세).
- **주의:** 이것은 "어느 쪽이 첫 듀얼을 이기나"지, "첫킬 낸 팀이 라운드를 이기나"가 아님(후자는 소스에 없음).

**CombatCalibration 매핑**(`origin/claude/pv-spatial` `packages/combat-engine`,
`CombatCalibration = { hitChanceScale?, headshotScale?, reactionScale? }`): 직접 필드 없음 →
**보정 목표치**로 사용. 몬테카를로 첫 듀얼 반복 → 시뮬 공격 오프닝듀얼 승률을 측정 → 구간
(전맵 0.450–0.463, Ascent 0.420–0.454)에 들도록 reactionScale/hitChanceScale 조정. 시뮬 승률은
아래 하네스가 계산해 줌. (`docs/VALIDATION_BASELINES.md` §6에 수치·매핑·공백 기록.)

## 4B — Validation Harness
`tools/data-validator/`에 **시뮬레이션 결과 검증기**(`sim_harness.py` + `pv-validate-sim` CLI).
- **입력:** 시뮬 라운드 로그 묶음(JSON). 이벤트 형식은 `origin/claude/pv-core`
  `packages/simulation-core` **EventLog**(GameEvent: kind/seq/timeMs, kill{killer,victim}, roundEnd{winner,reason})에 맞춤. 라운드별 roster(선수→side), 선택적 buyTiers.
- **기준:** `datasets/derived/priors/*.json`(머신리더블) + `VALIDATION_BASELINES.md` 허용 오차.
- **지표:** 라운드 종료 분포, 공격 승률, 오프닝듀얼 승률, 경제 매치업(판정) + 인원우위 상태별 승률,
  트레이드율, 평균 라운드 시간(기준 없음 → 보고만). 각 지표: 시뮬값·실측·Wilson CI·허용오차·통과/실패.
- **출력:** Markdown + JSON 리포트.
- **하네스 자체 테스트:** 합성 시뮬 로그 fixture(meta.synthetic=true) — 기준에 맞는 good run은
  7/7 통과(exit 0), 일부러 틀린 bad run은 전부 실패(exit 1). 샘플 리포트 `examples/report_good.md`.
- **실제 로그용 한 줄 명령**(통합 후): `pv-validate-sim --logs sim_run.json --priors datasets/derived/priors --scope ascent --out reports/sim_validation` (README에 입력 스키마 포함).

## 4-테스트 결과 (실제 실행)
```
data-collector : 25 passed (opening_duel 포함)
data-validator : 10 passed (sim harness good/bad 분리 검증 포함)
economy-engine : 15 passed
dataset 검증    : 29/29 files valid, 189 records
```

## 4-주의 / 미완료
- 인원우위·트레이드·첫킬→라운드 승 실측 기준선은 **VCT Reference로 불가** → 인가 Layer B(GRID/VRF) 필요.
  하네스는 이 지표들을 시뮬 로그에서 계산은 하되 "기준 없음(보고만)"으로 둔다.
- 실제 5v5 시뮬레이터 미존재 → 하네스는 합성 fixture로만 검증됨. 통합 시 실제 EventLog 투입.
- 라운드별 실측 소요시간 기준선 없음(소스는 맵 전체 duration만).

## 4-다음 권장
1. **(PV-4)** combat_opening_duel을 CombatCalibration 보정 루프의 목표치로 사용.
2. **(PV-sim/통합)** 실제 라운드 EventLog 묶음을 `pv-validate-sim`에 투입해 회귀 검증 연결.
3. **(Layer B 확보 시)** 인원우위·트레이드·첫킬 승률 실측 기준선 추가 → 하네스 판정 지표로 승격.

---

# PROJECT V — TASK HANDOFF · 5차 (Pre-round Round Value Model)

**추가 작업일:** 2026-11-18 · **범위:** README §26.3–26.4, DECISION-005(선택적 고도화).
**추가 소유:** `tools/ml/`, `models/round-value/`, `docs/research/ROUND_VALUE_MODEL.md`.

## 5-1. 목표
라운드 시작 정보만으로 공격팀 라운드 승률을 추정하는 **보조 모델**. 엔진은 이 모델 없이도 동작(휴리스틱/priors 폴백).

## 5-2. 완료한 작업
- **피처 파이프라인** `tools/ml/round-value/features.py`: 17개 pre-round 피처(사이드 암시, 맵, 라운드/하프,
  양팀 점수·차, 시작 loadout/bank·차, 로스 스트릭, 직전 결과, buy tier 코드). **누출 금지 구조**(경기 내
  상태는 과거 라운드에서만 누적, 결과는 피처 방출 후 반영) + **누출 테스트**(미래 라운드 결과를 바꿔도
  이전 라운드 피처 불변).
- **학습/평가** `train.py`: 시간 holdout(최근 20% 경기) + 경기단위 GroupKFold CV. priors 룩업·로지스틱·
  LightGBM. log loss/Brier/AUC/ECE. ONNX export + 파이썬 파리티.
- **모델 산출물** `models/round-value/`: `round_value_lgbm.onnx`(opset12), `metrics.json`,
  `parity_samples.json`, `model_card.md`(빌드일·sha·피처·지표·한계·라이선스).
- **TS 추론 seam** `packages/economy-engine/src/round-value-model.ts`: `createRoundValueModel({modelPath?})`
  → `predict(features)`. `onnxruntime-node`(**optional dependency**, 동적 import) 있으면 ONNX, 없거나
  모델 파일 없으면 **priors 룩업 폴백**. 절대 throw 안 함. Node↔ONNX 파리티 테스트 포함.
- **평가 리포트** `docs/research/ROUND_VALUE_MODEL.md`.

## 5-3. 핵심 결과 (정직한 음성 결과)
국제전 23,989 라운드, 시간 holdout(4,777) 기준:
| 모델 | log loss | Brier | AUC | 정확도 | ECE |
|---|---|---|---|---|---|
| priors 룩업 | 0.6317 | 0.2221 | 0.672 | 61.4% | **0.012** |
| 로지스틱 | **0.6234** | **0.2179** | **0.693** | **62.2%** | 0.020 |
| LightGBM | 0.6318 | 0.2220 | 0.680 | 61.8% | 0.032 |

→ **LightGBM은 베이스라인을 못 이김.** pre-round 정보는 약한 예측력(정확도 ~62%, AUC ~0.69; 공개
round-start 모델 ~61%와 일치). **DECISION-005대로 모델 미채택이 권고**: economy-engine의 priors 룩업을
그대로 사용(성능 사실상 동일, 모델 파일·런타임 불필요). ONNX/TS seam은 통합·재학습용으로만 유지.

## 5-4. 테스트 결과 (실제 실행)
```
tools/ml/round-value : 9 passed (누출 테스트·split·metrics 포함)
economy-engine       : 20 passed (ONNX↔Python 파리티 포함; onnxruntime-node는 --onnxruntime-node-install-cuda=skip로 설치)
파이썬↔ONNX 파리티    : maxAbsDiff 1.3e-7
```

## 5-5. 주의 / 미완료
- pre-round 전용 → 약한 예측력(의도된 한계). 통합 시 priors 폴백을 기본으로 둘 것.
- 2021–2026 패치 pooled. season/patch 컬럼 보존 → era별 재학습 가능.
- 위치/컴포지션 피처 없음(VCT Reference 한계). Layer B 확보 후 재평가해야 비선형 모델이 의미 가질 수 있음.
- `onnxruntime-node`는 optionalDependency(네이티브, CUDA EP 스킵 필요). 미설치 시 폴백 자동.

## 5-6. 다음 권장
1. **(PV-3/economy)** RoundValueModel을 Future Round Value 입력으로 연결하되 **priors 폴백을 기본**으로.
2. **(Layer B 확보 후)** 위치·컴포지션 피처 추가해 재평가.
3. **(선택)** era별 모델.

---

# PROJECT V — TASK HANDOFF · 6차 (Player Ratings 추정)

**추가 작업일:** 2026-11-18 · **범위:** README §23(선수 AI), §07. 소유: `datasets/derived/ratings/`,
`docs/research/PLAYER_RATINGS.md`, `tools/data-collector` ratings 모듈.

## 6-1. 목표
VCT Reference 선수 통계로 엔진 선수 능력치를 **불확실성과 함께** 추정. PV-4 combat-engine `CombatSkills`와
PV-3 player policy 성향 입력으로 사용.

## 6-2. 완료한 작업
- **ratings 모듈** `tools/data-collector/src/pv_data_collector/ratings.py` + CLI `gen-ratings`.
  통계→능력치 **설명 가능한 규칙**, **경험적 베이즈 축소**(n/(n+k), k=맵내분산/선수간분산),
  **역할 상대화**(reaction·entry는 역할 내 퍼센타일), 퍼센타일→`0.35+0.5·p`(중앙값 0.6).
- **데이터** `datasets/derived/ratings/`: `player_ratings.json`(402명, **playerId만, 이름 미저장**) +
  `ratings_meta.json`(축소 파라미터·검증·분포·고지). 스키마 `datasets/schema/player-rating.schema.json`.
- **문서** `docs/research/PLAYER_RATINGS.md` (방법·CombatSkills 매핑표·윤리).
- **검증기 연동**: `player_ratings.json` → player-rating 스키마 (30/30 파일 유효).
- **테스트** 8개(역할·축소·null+이유·검증·결정성).

## 6-3. 추정 vs null (정직성)
- 추정(축소·[0,1]): aim, crosshairPlacement, firstBulletAccuracy, reaction, tracking, impact,
  entryAggression, trading, clutch, consistency.
- **null+이유**(박스스코어로 불가): movement, weaponControl, positioning, utilityUsage, mapAwareness,
  rotations, communication, teamworkDiscipline, lurking, anchoring, weaponPreference, agentMastery.
  → 지어내지 않음. 12개 전부 null.

## 6-4. 검증 결과
- **축소가 예측 오차를 줄임**(시간 분할, 다음 시즌 예측): rating MSE 0.0292→0.0273, ACS 1106→1002
  (둘 다 shrinkageHelps=true).
- **중복 탐지**: `aim~tracking` **r=0.99** → tracking은 aim의 저신뢰 중복으로 보고(별도 스킬로 쓰지 말 것).
  파이프라인이 자동 플래그.

## 6-5. CombatSkills/PV-3 매핑 (읽기 전용 참조)
- PV-4 `CombatSkills`(aim/crosshairPlacement/firstBulletAccuracy/reaction/tracking) ← 동명 attribute 직결.
  movement·weaponControl은 **null → AVERAGE_SKILLS(0.6) 사용**(Layer B 전까지). 포지셔닝은 스킬이 아니라
  combat-engine `EngagePosture`로 모델(README §29: 레이팅이 정보 열위를 못 덮음).
- PV-3 player policy: entryAggression→진입성향, trading→트레이드 규율, clutch/consistency→멘탈. uncertainty를
  함께 넘겨 저표본 선수는 행동 분산을 넓힘.

## 6-6. 윤리 / 실명 — **사용자 판단 필요**
- 저장은 **player_id 기반**, 이름 미커밋(로컬 DB 조인으로 재생성). 추정치는 공개 통계 기반·실제 평가 아님을
  데이터(provenance.notes)·meta(disclaimer)·문서에 명시.
- 배포 게임에 실명/능력치 사용은 초상권·데이터 권리 이슈 → **사용자/법무 결정**으로 `PLAYER_RATINGS.md`에 기록
  (익명/가상 로스터, 옵트인, 라이선싱 등 옵션 제시).

## 6-7. 테스트 결과 (실제 실행)
```
data-collector : 33 passed (ratings 8 포함)
dataset 검증    : 30/30 files valid, 591 records (player_ratings 402 포함)
```

## 6-8. 미완료 / 주의
- 박스스코어 한계 → 전술/포지셔널 능력치 추정 불가(Layer B 필요). clutch는 시도 분모 없음(약함), tracking 중복.
- 2021–2026 패치/메타 pooled. era·역할별 재추정 권장.

## 6-9. 다음 권장
1. **(PV-4)** CombatSkills에 ratings 연결, movement/weaponControl은 0.6 폴백.
2. **(PV-3)** player policy 성향 필드 확정 후 entry/trading/clutch 연결(uncertainty 포함).
3. **(Layer B 확보 후)** 포지셔닝·유틸 능력치 추정 추가.

---

# PROJECT V — TASK HANDOFF · 7차 (Team Profiles)

**추가 작업일:** 2026-11-18 · **범위:** Handoff P4, README §24. 소유: `datasets/derived/team-profiles/`,
`docs/research/TEAM_PROFILES.md`, `tools/data-collector` profiles 모듈.

## 7-1. 목표
PV-3 IGL 상대 모델링·자팀 성향용 **팀 단위 행동 프로필**을 VCT Reference 라운드/경제로 생성.

## 7-2. 완료한 작업
- **profiles 모듈** `tools/data-collector/profiles.py` + CLI `gen-team-profiles`(`--as-of` 지원).
  경기 내 라운드 시퀀스로 로스 스트릭·직전 승자 추적 → 경제 성향 집계, Beta-binomial 축소, 시점 기준(as-of).
- **데이터** `datasets/derived/team-profiles/`: 70팀, **teamId만(이름 미커밋)**, 스키마+meta(리그 평균·축소·안정성·고지). 스키마 `datasets/schema/team-profile.schema.json` + 검증기 연동(31/31 유효).
- **문서** `docs/research/TEAM_PROFILES.md`(방법·TeamDecisionPolicy 매핑·윤리).
- **테스트** 8개(분류·축소·null+이유·attack 승률 정확성·as-of 서브셋·결정성).

## 7-3. 추정 vs null
- 경제: forceBuyAfterLoss(+티어별), pistolLossForceBuy, bonusBuyRate, antiEcoFullBuy, overtimeForceBuy.
- 사이드/맵: attackWinRate, defenseWinRate, ascentAttackWinRate, firstMinusSecondHalfAttack, mapPool.
- **null+이유**(위치 필요): sitePreference, executeTempo, defaultSetup, utilityUsage, rotationTendency,
  lurkTendency, retakeVsSaveTendency, fakeTendency — 지어내지 않음.

## 7-4. 핵심 결과
- 변별력 있는 경제 신호는 **pistolLossForceBuy(평균 0.15)**, **antiEcoFullBuy(0.11)**. forceBuyAfterLoss(0.89)·
  bonusBuyRate(~1)·overtimeForceBuy(~1)는 거의 보편이라 팀별 정보 적음(그대로 기록).
- **안정성(시즌 간)**: forceBuyAfterLoss r≈−0.06, attackWinRate r≈0.17 → **둘 다 약함 = 로스터·메타 의존적**.
  프로필은 "이 로스터가 이 기간에 이렇게 했다"로 읽어야 하며 **시점 기준(as-of) 생성 권장**.

## 7-5. PV-3 매핑 (team-engine 미정의 → 제안)
pv-core에 `team-engine`/`TeamDecisionPolicy` 아직 없음. 제안: IGL 경제 정책←forceBuyAfterLoss/pistolLossForceBuy,
안티에코←antiEcoFullBuy, 상대 기억(사이드 강점)←attack/defense/ascent/half, 맵 숙련←mapPool, 전술 성향←null.
uncertainty 동반, **as-of 매치 날짜로** 프로필 생성(미래 폼 미사용).

## 7-6. 윤리
팀도 실명 → **teamId 기반 저장, 이름 미커밋**(로컬 조인 재생성). 추정치임을 provenance·meta·문서에 고지.
실명 배포는 초상권/데이터 권리 → **사용자/법무 결정**으로 기록(익명/가상/옵트인/라이선싱).

## 7-7. 테스트 결과
```
data-collector : 41 passed (profiles 8 포함)
dataset 검증    : 31/31 files valid, 661 records (team_profiles 70 포함)
```

## 7-8. 다음 권장
1. **(PV-3)** team-engine 정의 후 위 매핑 연결, as-of로 상대 프로필 생성.
2. **(Layer B 확보 후)** 전술 성향(사이트 선호·템포 등) 추가.

## 7-9. 실명 반영 (사용자 결정 2026-11-18)
사용자 결정: 우선 출시가 아니므로 **공개 VCT 프로 선수·팀 전부 실명 사용**. 반영:
- `datasets/derived/ratings/player_names.json`(playerId→핸들, 402명), `datasets/derived/team-profiles/team_names.json`(teamId→팀명, 70팀) **커밋**. 각 파일에 출처(빌드일·sha256)·고지 포함. 레코드는 계속 ID 기반(이름은 사이드카 매핑).
- 고지 변경: "**출시 전 내부 개발용. 실명 사용은 사용자 결정(2026-11-18). 출시 전 라이선스·초상권 재검토 필요.**" + "공개 통계 기반 추정치이며 실제 실력 평가 아님" 유지. 범위: **공개 VCT 프로 선수·팀만**(비공개 개인 데이터 제외).
- 스키마·README·research 문서 고지 동기화. 테스트 추가(매핑 생성 검증). gen-ratings/gen-team-profiles가 매핑도 자동 생성.
