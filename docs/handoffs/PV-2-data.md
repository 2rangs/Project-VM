# PROJECT V — TASK HANDOFF

**Agent:** PV-2 Data Engineering · **Date:** 2026-11-18 · **Branch:** `claude/pv-data`
**Scope:** Handoff TASK 003 (VCT Reference + vctstats), TASK 004 (data schema), TASK 005 (minimal dataset)

> **Bottom line:** Real data **WAS secured.** The VCT Reference DuckDB (13 MB, 10 tables) was
> downloaded and read (verification level 2), and **two real matches were normalized** into
> `datasets/normalized/` — including a real **Ascent** map with full round economy. vctstats was
> cloned and its code read (level 2); it proves Layer-B positions are extractable from vlr.gg
> 2D-replay logs, but its raw position data is **not** redistributed, so real per-player positions
> were **not** obtained. The positional/decision layer is therefore supplied as **clearly-labelled
> synthetic Ascent data** (10 scenarios + one map), never mixed with the real data.

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
- **실제 위치/이벤트(Layer B)**: 실제 경기의 per-player 위치·이벤트 타임라인은 미확보. 방식(vlr 2D
  리플레이 `locs`)은 검증했으나, 2D 리플레이가 있는 경기 선정 + 스크레이퍼 구현은 미착수.
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
- **VCT Reference 데이터**: 상업적 포함 무료·재배포 허용·무보증, 도박 용도 금지. `.duckdb`는 용량/일일
  재빌드 이유로 **커밋하지 않음**(다운로드 스크립트 + SOURCE.json만 커밋). `datasets/normalized/`의
  정규화 산출물은 공개 통계 파생으로 커밋.
- **vctstats**: 코드 MIT. 원본 HTML/DB 미배포 → 저장소에 포함하지 않았고, 코드/방식만 참고.
- **합성 데이터**: PROJECT V 자체 생성물. 제약 없음. 단, 실제 경기로 오인 금지(플래그로 표시).

## 12. 다음 권장 작업 (우선순위)
1. **(PV-3)** `datasets/schema/`를 TS 타입으로 변환하고, `datasets/synthetic/scenarios/scenario_*.json`을
   Action Generator / Decision Debugger 입력으로 로드(§19, §20). 10개 시나리오가 그 입력 계약이다.
2. **(PV-spatial)** Ascent 미니맵↔게임 좌표 변환 + plant/spawn/nav zone 확정 → 합성 좌표를 실좌표로 교정.
3. **(PV-2 후속)** vlr 2D 리플레이가 있는 경기 1개 선정 → `ReplayPageParser` 방식으로 **실제** Event/Position
   수집기 구현 → `datasets/normalized/.../events.json` 채우기(Layer B 실데이터화).
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
- **이벤트 타임라인:** 실데이터는 FUTURE(vlr 2D 리플레이). 형태는 `event.schema.json`,
  합성 예시는 `datasets/synthetic/ascent/events.json`(위치 스냅샷 포함).
- **위치 데이터:** 형태 `position.schema.json`(미니맵 단위 + facingDeg). 실데이터 FUTURE, 합성 제공.
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
