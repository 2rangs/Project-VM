# PROJECT V — TASK HANDOFF

**에이전트:** PV-1 Research · **기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
Handoff TASK 002(전체 참고 URL → 데이터 소스 레지스트리)와 TASK 003 일부(핵심 저장소 중
**C9 Gameplan, vrfkit, ValoReview** + 가능 시 ValorantReplayParser, ValorantWebReplayer를 실제
클론·열람 검증)를 수행한다. VCT Reference·vctstats는 PV-2 담당이라 레지스트리에 항목만 등록한다.

## 2. 완료한 작업 (실제 수행한 것만)
- **5개 저장소 실제 클론·열람 검증**(`/tmp/pv-clones`, 커밋 미포함):
  - C9 Gameplan(MIT) — **L2**: `app/data/*` 파생 JSON을 `json.load`로 실제 읽음. 원시 51MB 궤적은 `.gitignore`로 **부재** 확인. GRID 포털 파트너 인증 의존 확인.
  - vrfkit(Apache-2.0) — **L1**: 10크레이트 Rust 구조 + `movement.parquet` 128Hz 스키마 문서 확인. 빌드는 환경 정책상 차단, `.vrf` 없음 → 실행 미수행.
  - ValoReview(Apache-2.0) — **L1**: 코드/README/THIRD_PARTY 열람. provenance 라벨링·simulated 범위 확인.
  - ValorantReplayParser(MIT) — **L1**: C# 이벤트 디코더, vrfkit/ValoReview 상류 확인.
  - ValorantWebReplayer(MIT) — **L1**: Windows 전용 뷰어, 익명모드 한계표 확인.
- **valorant-api.com 실 API 검증 — L2**: version(release-13.10)/agents(30)/weapons(21)/maps(27) GET 성공.
- **도달성 확인(HTTP 200)**: Riot developer, GRID docs, VCT Reference, VLR, bernielaird, rib.gg, thespike, HF EsportsBench, wiki Credits, playvalorant 패치노트 등 12개.
- **산출물 4종 + 상세 1종 작성**(아래 §3).

## 3. 변경한 파일 (PV-1 소유 경로만)
| 파일 | 목적 |
|---|---|
| `datasets/registry/sources.json` | 기계 판독용 레지스트리(26항목, ~70 URL 포함) |
| `datasets/registry/SCHEMA.md` | sources.json 스키마 정의(README §3.1/3.2/3.3 매핑) |
| `docs/SOURCES.md` | 사람이 읽는 소스 레지스트리 |
| `docs/DATA_AVAILABILITY.md` | 상태표(§3.2 상태 + §3.3 수준) |
| `docs/LICENSE_AUDIT.md` | 라이선스 감사(5종 직접 확인) |
| `docs/research/CORE_SOURCE_VERIFICATION.md` | 핵심 소스 상세 + §8.2 파서 21항목 평가 |
| `docs/handoffs/PV-1-research.md` | 본 핸드오프 |

※ `README.md`, `Handoff.md`, 루트 설정, `packages/`, `apps/`는 수정하지 않음.

## 4. 데이터 출처 (실제 사용한 URL/파일)
- 클론: `joshghal/c9-gameplan-backend@0c971bb`, `yakisoba0728/vrfkit@9ece4ab`, `dhinakar-v/ValoReview@02e8065`, `michel-giehl/ValorantReplayParser@fbf24b6`, `talhakoek/ValorantWebReplayer@e060000`.
- 실 API: `https://valorant-api.com/v1/{version,agents,weapons,maps}`.
- 열람 파일: 각 저장소 README/LICENSE/NOTICE/THIRD_PARTY, vrfkit docs/USAGE.md·DATA.md, C9 `app/data/*.json`·`scripts/download_grid_matches.py`·`.gitignore`.

## 5. 실행 방법 (재현)
```bash
# 외부 저장소 재클론(저장소 밖)
mkdir -p /tmp/pv-clones && cd /tmp/pv-clones
for r in joshghal/c9-gameplan-backend yakisoba0728/vrfkit dhinakar-v/ValoReview \
         michel-giehl/ValorantReplayParser talhakoek/ValorantWebReplayer; do
  git clone --depth 1 https://github.com/$r.git $(basename $r); done
# C9 데이터 로드 확인
python3 -c "import json;print(len(json.load(open('/tmp/pv-clones/c9-gameplan-backend/app/data/vct_match_metadata.json'))),'matches')"
# valorant-api 실데이터
curl -s https://valorant-api.com/v1/version | python3 -m json.tool
# 레지스트리 검증
python3 -c "import json;json.load(open('datasets/registry/sources.json'));print('registry OK')"
```

## 6. 검증 방법
- JSON 유효성: `python3 -c "import json;json.load(...)"` → sources.json 26항목, 필수키 누락 0.
- 데이터 실재: `json.load`로 C9 3파일 로드 성공, valorant-api 4엔드포인트 파싱 성공.
- 도달성: `curl -o /dev/null -w "%{http_code}"`.

## 7. 테스트 결과
- `sources.json`: 유효 JSON, status 분포 {VERIFIED_SOURCE_CODE 5, VERIFIED_API 1, PV-2_PENDING 2, AUTH_REQUIRED 3, VIEW_ONLY 4, UNVERIFIED 11}, level {L2:2, L1:4, L0:20}.
- C9 `vct_match_metadata.json`: 33 경기 로드.
- valorant-api: 30 agents / 21 weapons / 27 maps / build release-13.10.
- **실행 재현(L3)한 소스 없음**(아래 §8).

## 8. 현재 미완료 사항
- **어떤 리플레이 파서도 실제 디코딩 실행(L3) 못함**: `.vrf` 샘플 부재(사용자 캡처 필요, 재배포 불가) + cargo/.NET 빌드 미수행(cargo는 환경 정책상 차단).
- **C9 시뮬레이션 엔진 미실행**(deps + LLM 키 필요) — 데이터 로드만.
- **VCT Reference·vctstats 미검증**(PV-2).
- **Blender 맵 미다운로드**(Drive 인증), **GRID/Riot 인증 호출 없음**(키 없음).
- UNVERIFIED 저장소(ETL/예측/VOD/맵/ML) 개별 미열람.

## 9. 알려진 문제
- C9 README 헤드라인 수치("592,893 샘플 / 86% 정확도")는 저장소 내 원시 파일 부재 + 미재현 → 사실로 기록하지 말 것.
- valorant-api 라이선스/ToS 미명시 → 재배포 보수적으로.
- X-EGO-CS는 Counter-Strike(혼동 금지).

## 10. 설계 결정
- 레지스트리를 **JSON(기계 판독) + MD(사람)** 이원화, 상태/수준은 README §3.2/3.3 enum 그대로. PV-2 위임분은 확장 상태 `PV-2_PENDING`.
- 소스를 **번들 항목**(분석 플랫폼 17종, VOD 저장소 5종 등)으로 묶어 26항목으로 정리하되 전 URL은 `extra_urls`에 보존.
- 외부 클론은 `/tmp/pv-clones`에 두고 **커밋하지 않음**(지시 준수, 라이선스/용량).

## 11. 라이선스 및 권한
- 코드 통합 안전: C9(MIT), vrfkit(Apache-2.0), ValoReview(Apache-2.0), VRP(MIT), VWR(MIT) — 고지 유지 의무.
- 게임 자산/경기 데이터(.vrf 디코딩물, 맵 지오메트리, GRID/VLR)는 **코드 라이선스와 별개, Riot/제공자 권리 종속** → 재배포 보수적. 상세 `docs/LICENSE_AUDIT.md`.

## 12. 다음 권장 작업 (우선순위)
1. **PV-2:** VCT Reference DuckDB 다운로드·스키마·결측률·약관; vctstats 소스·누출 분석 → DATA_AVAILABILITY/LICENSE_AUDIT 갱신.
2. **PV-2:** valorant-api로 요원/무기/스킬 카탈로그 + 맵 변환좌표 정규화(즉시 가용, 무인증).
3. **사용자 협조 필요:** `.vrf` 리플레이 1개 확보 → vrfkit으로 `movement.parquet` 생성(Layer B 128Hz 위치).
4. **PV-3:** C9 파생 모델 + Ascent로 첫 Decision Context 프로토타입(Handoff §19).
5. GRID/Riot 키 또는 Drive 맵은 사용자 제공 시 진행.

## 13. 작업 재개 지점
- 먼저 열 파일: `docs/SOURCES.md` → `datasets/registry/sources.json` → `docs/research/CORE_SOURCE_VERIFICATION.md`.
- 첫 명령: `python3 -c "import json;json.load(open('datasets/registry/sources.json'))"` 로 레지스트리 확인, 이어서 §5 재현 블록.
- PV-2는 `assigned_agent="PV-2"` 항목(13개)부터, PV-3는 `"PV-3"` 항목(5개)부터 착수.

---

# PROJECT V — TASK HANDOFF (PV-1 2차: 게임 데이터 카탈로그)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
시뮬레이션 엔진이 바로 소비하는 요원·무기·스킬·궁극기·장비 정규화 카탈로그 구축 (Handoff §10, README §11). 기준 빌드 `release-13.10`, 모든 레코드에 패치 부착.

## 2. 완료한 작업 (실제 수행)
- **빌더 구현·실행:** `tools/catalog-builder/`(Python stdlib + jsonschema). 라이브 수집→정규화→스키마검증.
- **산출(실행 확인):** weapons 21 / agents 30 / abilities 130 / equipment 4, 전부 JSON Schema 통과.
- **무기:** 가격·연사·탄창·장전(ms)·장착(ms)·이동배수·거리구간별 부위 피해(m)·관통·ADS — API에서 **검증**.
- **요원:** role(Duelist9/Initiator7/Controller7/Sentinel7) + 스킬 슬롯 — API 검증.
- **스킬:** 이름/슬롯/설명 API 검증. 게임플레이 수치(cost/charges/cooldown/ultPoints/duration/typeTags)는 API에 없어 **null+verified:false**(추정 미기입).
- **장비:** 실드3+스파이크 구조, 수치 전부 null+verified:false, `needsCrossCheckPV3:true`.
- **테스트:** `pytest -q` → **9 passed**(정규화 로직 + 스키마 검증).

## 3. 변경한 파일 (PV-1 소유 경로)
- `tools/catalog-builder/`: fetch.py, normalize.py, ability_facts.py, equipment_facts.py, validate.py, build_catalog.py, README.md, tests/(test_normalize.py + 합성 픽스처).
- `datasets/catalog/schema/`: weapon/agent/ability/equipment/provenance.schema.json
- `datasets/catalog/.gitignore`(release-*/ 제외), `datasets/catalog/README.md`
- `docs/research/CATALOG.md`; `docs/SOURCES.md`·`DATA_AVAILABILITY.md`·`LICENSE_AUDIT.md`·`datasets/registry/sources.json` 갱신.
- **커밋 안 함:** `datasets/catalog/release-13.10/`(Riot 파생 생성 데이터, gitignore).

## 4. 데이터 출처
valorant-api.com `/v1/{version,weapons,agents}` (2026-11-18). 스킬/장비 수치 소싱 예정 출처는 `CATALOG.md §4`.

## 5. 실행 방법
```bash
python tools/catalog-builder/build_catalog.py            # 라이브
python tools/catalog-builder/build_catalog.py --offline  # 캐시 raw/
pytest tools/catalog-builder -q
```

## 6~7. 검증/결과
pytest 9 passed. 빌더: 21/30/130/4 레코드 전부 스키마 통과. ability 수치 검증 0/130(설계상 null), equipment 0/4.

## 8. 현재 미완료
- 스킬 게임플레이 수치(비용·충전·쿨다운·궁극포인트·지속·타입) 공식 소싱 미완 → `ability_facts.py` 비어 있음.
- 실드 cost/armor, 스파이크 timing 미소싱. defaultKeybind(C/Q/E/X) 매핑 미확정.
- 생성 데이터는 로컬에만 존재(커밋 안 함).

## 9. 알려진 문제
- valorant-api는 스킬 수치·장비 상수를 제공하지 않음 → 해당 필드 null이 정상.
- jsonschema RefResolver Deprecation 경고(동작 무해).

## 10. 설계 결정
- valorant-api 라이선스 불명확 → **스크립트·스키마·문서만 커밋**, Riot 파생 데이터 gitignore(로컬 재생성).
- normalize를 순수 함수로 분리(네트워크 격리, 단위테스트 가능). 수치는 출처 테이블(`*_facts.py`)로만 주입 → 추정 유입 차단.
- 단위: camelCase/ms/m. 1 m=100 Unreal 단위(vrfkit 위치 cm)와 교차참조 명시.

## 11. 라이선스
weapons/agents/abilities 데이터는 Riot 파생 → 재배포 보수적(생성물 미커밋). 스키마·합성 픽스처는 PV-1 작성물로 커밋. 상세 `LICENSE_AUDIT.md §2.0`.

## 12. 다음 권장 작업
1. 공식 패치노트/위키에서 스킬 수치·실드·스파이크 소싱 → `ability_facts.py`/`equipment_facts.py`(URL 필수, verified:true).
2. PV-3 `packages/game-rules`와 장비·경제 수치 대조(`needsCrossCheckPV3`).
3. typeTags(smoke/flash/recon/molly/wall/heal/trap/movement…) 분류 채우기 → 전술 엔진 belief/행동에 사용.

## 13. 작업 재개 지점
- 먼저 열 파일: `docs/research/CATALOG.md` → `tools/catalog-builder/normalize.py`/`ability_facts.py`.
- 첫 명령: `pytest tools/catalog-builder -q` → `python tools/catalog-builder/build_catalog.py`.

---

# PROJECT V — TASK HANDOFF (PV-1 3차: 게임플레이 수치 공식 소싱 + 대조)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
2차에서 null로 남긴 스킬·장비 게임플레이 수치를 공식 출처로 채우고, Riot API·PV-3와 대조 (추정 금지).

## 2. 완료한 작업 (실제 수행·검증)
- **스킬 수치 소싱:** 공식 위키 `wiki.playvalorant.com/en-us/Abilities`의 기본/시그니처/궁극기 집계표를 fetch·파싱, valorant-api와 스킬 이름으로 조인. **비패시브 120/120 소싱, 궁극기 포인트 30/30 요원 완비.** cost/charges/ultPoints/typeTags 채움. cooldown/duration은 표에 없어 **null 유지**.
- **장비 소싱:** 공식 위키 Armor_and_Shield(실드 400/25·1000/50·650/25+pool50) + Spike(plant 4000·defuse 7000·half 3500) → **4/4 소싱**. spike detonate는 미확보 null.
- **Riot content API:** `kr.api.riotgames.com/val/content/v1/contents` **200**(프록시 키 주입). 요원 30/30·무기 21/21 UUID 교차검증 일치. 게임플레이 수치는 없음(ID만).
- **PV-3 대조(`origin/claude/pv-core`, 읽기전용):** 실드·스파이크·무기가격 일치. **궁극 포인트 6표본 중 4건 불일치(jett/brimstone/sage/killjoy)** → 공식 현재값 채택, PV-3에 교체 권고.
- **테스트:** `pytest -q` **10 passed**. 빌더: ability 120/130 verified, equipment 4/4.

## 3. 변경한 파일
- `tools/catalog-builder/ability_facts.py`(JSON 로더로 변경) + **`data/ability_facts.json`(120 항목, 공식 위키 소싱, 커밋)**
- `tools/catalog-builder/equipment_facts.py`(공식값 채움), `normalize.py`(gameplayNote 추가), `tests/test_normalize.py`(검증 강화), `.gitignore`(pyc)
- `datasets/catalog/schema/ability.schema.json`(gameplayNote), `equipment.schema.json`(regenPool/absorptionPercent)
- `docs/research/CATALOG.md`(§3.3~3.6, §5 갱신), `docs/handoffs/PV-1-research.md`(본 섹션)

## 4. 데이터 출처
- 스킬: https://wiki.playvalorant.com/en-us/Abilities
- 장비: https://wiki.playvalorant.com/en-us/Armor_and_Shield, https://wiki.playvalorant.com/en-us/Spike
- UUID: Riot content API(kr). 빌드: valorant-api /v1/version = release-13.10.

## 5~7. 실행/검증/결과
`pytest tools/catalog-builder -q` → 10 passed. `build_catalog.py` → 전 레코드 스키마 통과, ability 120/130·equipment 4/4 소싱.

## 8. 현재 미완료
- 스킬 cooldownMs/durationMs(공식 집계표에 없음), defaultKeybind 매핑, spike detonateTimeMs.

## 9. 알려진 문제 / 판단 근거
- **gameplayVerified=true 기준:** 공식 위키의 현재 값 + 라이브 빌드 13.10 확인. 패치노트 역추적은 아님(각 레코드 gameplayNote에 명시). 커뮤니티 위키(fandom)는 값 소스로 쓰지 않음(요원 페이지 수치가 Lua 모듈이라 미추출).
- 궁극 포인트는 패치별로 변동(예: brimstone 7→8) → PV-3 provisional과 불일치 발생.

## 10. 설계 결정
- 소싱 값을 `data/ability_facts.json`(커밋)으로 분리 — PV-3가 game-rules에 수치를 커밋한 선례와 동일(작은 사실값+출처). 대량 카탈로그 덤프(descriptions/assets 포함)는 계속 gitignore.
- 조인은 스킬 이름 기반 → 슬롯 라벨 불확실성 회피. 키는 `normalize._slug`과 동일 규칙(KAY/O=`kay-o`).

## 11. 라이선스
공식 위키/Riot content API 값은 Riot 소유 사실. 소싱 테이블(출처 URL 포함)만 커밋, 대량 생성물 미커밋(2차 결정 유지).

## 12. 다음 권장 작업
1. 스킬 cooldown/duration 요원별 공식 페이지 소싱 → `ability_facts.json`.
2. PV-3: ultimate.ts 궁극 포인트를 카탈로그로 교체(불일치 4건), spike detonate 상호 확인.
3. defaultKeybind 매핑 확정.

## 13. 작업 재개 지점
- 먼저 열 파일: `docs/research/CATALOG.md`(§3.3~3.6) → `tools/catalog-builder/data/ability_facts.json`.
- 첫 명령: `pytest tools/catalog-builder -q` → `python tools/catalog-builder/build_catalog.py`.

---

# PROJECT V — TASK HANDOFF (PV-1 4차: Ability Effect Spec + 소비자 정합)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
Ability Engine용 스킬 효과 명세(cooldown/duration/radius 등)를 공식 위키에서 소싱하고, PV-4/PV-3 소비자와 정합. spike detonate·defaultKeybind 마무리.

## 2. 완료한 작업 (실제 수행·검증)
- **Ability Effect Spec:** Ascent 대표 10요원(Omen/Sova/KAY/O/Killjoy/Jett/Cypher/Astra/Gekko/Breach/Viper)의 40스킬. 각 스킬 **공식 위키 페이지**(Stat/Value 표 + 인포박스, 패치 버전 포함) fetch·파싱 → effectTypes·windup·range·radius·duration·cooldown·killRecharge·reveal·HP·blocksVision·makesSound·keybind. **39/40 소싱**(Astra Nebula 서브페이지 404 → null).
- **defaultKeybind:** 인포박스에서 추출, slot↔key 100% 일관(Ability1→Q/Ability2→E/Grenade→C/Ultimate→X) 확인 → `ability_facts.json` 120/120 채움.
- **spike detonate:** 공식 wiki Spike "45 second detonation" 확인 → equipment_facts 45000ms(verified).
- **소비자 정합(읽기전용):** PV-4 perception-engine(vision smokedPairs=존쌍, hearing abilityCast, **world units=×100**)·PV-3 action-schema(missingAbility feasibility) 확인 → CATALOG.md §3.9 필드 매핑표 작성.
- **PV-2 Ascent 데이터:** `origin/claude/pv-data`는 합성 데이터만 존재(실제 픽률 없음) → 공식 대표 요원으로 진행(기록함).
- **테스트:** `pytest -q` **14 passed**. 빌더: ability-effects 40(39 소싱), 전 레코드 스키마 통과.

## 3. 변경한 파일
- `datasets/catalog/schema/ability-effect.schema.json`(신규)
- `tools/catalog-builder/`: `effects.py`(신규), `data/ability_effects.json`(신규, 40), `data/ability_facts.json`(keybind 추가), `equipment_facts.py`(spike detonate), `build_catalog.py`(효과 emit+검증), `tests/test_normalize.py`
- `docs/research/CATALOG.md`(§3.7~3.9, §1·§5), `docs/handoffs/PV-1-research.md`

## 4. 데이터 출처
공식 위키 스킬별 페이지(wiki.playvalorant.com/en-us/<Ability>) + Spike/Armor 페이지. 빌드 release-13.10.

## 5~7. 실행/검증/결과
`pytest tools/catalog-builder -q` → 14 passed. `build_catalog.py` → weapons21/agents30/abilities130/equipment4/ability-effects40 전부 스키마 통과; 효과 39/40·keybind 120/120 소싱.

## 8. 현재 미완료
- Effect Spec를 나머지 20요원으로 확장. Astra Nebula 효과 재소싱(서브페이지). 일부 스킬 damage/affectsAllies 등 미채움(공식 페이지에 명시 안 된 값은 null).

## 9. 알려진 문제
- PV-4는 연막을 **존-레벨 smokedPairs**로 처리 → 반경→존쌍 변환은 spatial zone 정의에서 수행(카탈로그는 반경·지속만 제공).
- 단위 불일치 주의: 카탈로그 m ↔ PV-4/spatial world units(×100).

## 10. 설계 결정
- 효과 수치는 공식 스킬 페이지의 Stat/Value 표 + 인포박스에서만 추출, `fieldSources{raw,confirmed}`로 값별 출처 기록. 미확인 null(추정 금지).
- effectTypes는 위키 Functions 기반. makesSound/blocksVision은 일반/정의상 사실로 note와 함께 표기.

## 11. 라이선스
공식 위키 값은 Riot 소유 사실. 소싱 테이블(출처 포함)만 커밋, 대량 생성물 미커밋(기존 결정 유지).

## 12. 다음 권장 작업
1. Effect Spec 20요원 확장(동일 파이프라인). 2. PV-4와 연막 반경→존쌍 변환 규칙 합의. 3. PV-3: 궁극 포인트 카탈로그로 교체.

## 13. 작업 재개 지점
- `docs/research/CATALOG.md` §3.7~3.9 → `tools/catalog-builder/data/ability_effects.json` / `effects.py`.
- `pytest tools/catalog-builder -q` → `python tools/catalog-builder/build_catalog.py`.

---

# PROJECT V — TASK HANDOFF (PV-1 5차: Ascent 조합 통계 + 효과 확장 + GRID)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
(1) VCT Reference 원본 DuckDB에서 실제 Ascent 조합 통계, (2) 효과 명세 전 30요원 확장, (3) GRID Open Access 접근 조사.

## 2. 완료한 작업 (실제 수행·검증)
- **Ascent 조합 통계:** VCT Reference DuckDB(13MB, SHA 일치) 다운로드(미커밋) → `build_ascent_comps.py`로 국제전 Ascent 집계. 306 team-maps, Wilson 95% CI. 픽률(Sova 81%/Omen 72%/Jett 70%/KAY/O 55%/Killjoy 50%...), 최빈 조합(jett·kayo·killjoy·omen·sova 85maps 57.6%WR), 역할 템플릿(1C/1D/2I/1S 52.6%), 공수(atk 47.2%/def 52.8%). → `datasets/derived/comps/ascent-comps.json`(+스키마).
- **효과 명세 확장:** 나머지 20요원 80스킬을 공식 위키에서 소싱(픽률 순, Fade·Chamber 우선) → **전 30요원 120스킬, 119 소싱**(Astra Nebula만 404). defaultKeybind는 검증된 slot↔key 맵(Q/E/C/X)으로 120 전부 일관.
- **GRID 조사:** Riot Open Access(2026-11-12 출시) 공식 문서 정리 → `docs/research/GRID_ACCESS.md` + 레지스트리 갱신. **핵심:** 무료·비상업·지연, VALORANT는 경제/스킬/스파이크/로드아웃/클러치 제공하나 **per-tick 위치는 공개 설명에 없음**(Layer B는 `.vrf` 우선). 신청은 안 함(사용자 판단).
- **우선순위 재검증:** 4차 10요원 중 6요원이 실측 상위 8위, Fade·Chamber 추가 필요 확인 → 확장에 반영.
- **테스트:** `pytest -q` **15 passed**(comps·effects·keybind 검증 포함). 빌더 전 레코드 스키마 통과.

## 3. 변경한 파일
- `datasets/derived/comps/`(신규 소유): ascent-comps.json/.schema.json/README.md
- `tools/catalog-builder/`: build_ascent_comps.py(신규), data/ability_effects.json(10→120), tests
- `docs/research/GRID_ACCESS.md`(신규), `docs/research/CATALOG.md`(§3.7·3.10·§1·§5), 레지스트리(grid), handoff
- **미커밋:** `/tmp/pv-vct/vct.duckdb`(원시 DB, 매일 재빌드+용량), 대량 catalog 생성물

## 4. 데이터 출처
VCT Reference DuckDB(vct-reference.com/dataset/vct.duckdb, free incl. commercial), 공식 위키 스킬 페이지, grid.gg Open Access/데이터 페이지.

## 5~7. 실행/검증/결과
`curl …/vct.duckdb` → `python tools/catalog-builder/build_ascent_comps.py --db /tmp/vct.duckdb` → `pytest -q`(15 passed). 효과 119/120, 조합 schema OK.

## 8. 현재 미완료
- Astra Nebula 효과(서브페이지), 일부 스킬 damage/affectsAllies. GRID 무료 티어 좌표 제공 여부 실측(사용자 키 필요).

## 9. 알려진 문제
- Ascent 통계는 패치 2.09–13.05 혼합(단일 빌드 아님) — CI·caveat 기록. 효과 keybind 2건 regex 오탐 → 검증된 slot맵으로 교정.

## 10. 설계 결정
- 원시 DuckDB 미커밋(PV-2 정책 일치), 소형 집계·출처만 커밋. 효과 keybind는 per-page regex보다 검증된 slot↔key 맵 우선.

## 11. 라이선스
VCT Reference: free incl. commercial, 출처표기 권장(집계 derivative 커밋). GRID: Open Access 무료·비상업. 위키: Riot 소유 사실, 소싱만 커밋.

## 12. 다음 권장 작업
1. PV-2: GRID 무료 키로 좌표 제공 여부 실측. 2. 효과 Astra Nebula·damage 보강. 3. PV-3: comps를 팀 AI prior로, 효과를 Ability Engine으로 연결.

## 13. 작업 재개 지점
- `datasets/derived/comps/ascent-comps.json`, `docs/research/GRID_ACCESS.md`, `tools/catalog-builder/data/ability_effects.json`.
- `pytest tools/catalog-builder -q`.

---

# PROJECT V — TASK HANDOFF (PV-1 6차: Ascent 전술 지식 KB)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
PV-3 IGL/Action Generator용 조합형 Ascent 전술 primitives(공격·수비·유틸·조합 매핑)를 PV-4 구역 ID·내 effectTypes·실측 조합으로 구축(README §15–18, §24; Handoff §13–14).

## 2. 완료한 작업 (실제 수행·검증)
- **전술 KB:** 공격 8 + 수비 9 + 조합 매핑 5. 각 요소에 utilityRequirements(effectType), minPlayers, risks, counterSetup, zones/route. → `datasets/derived/tactics/ascent-tactics.json`(+ `tactic.schema.json`).
- **구역 접지:** 모든 zones·route를 **PV-4 navgraph(22 zones/32 edges)** 어휘로 검증(미러 파일 `ascent-zone-vocabulary.json`, 출처 표기). 커뮤니티 콜아웃 없는 건 최근접 zone+설명(새 좌표 미생성).
- **출처 정직성:** 전술 내용은 `expert-knowledge-unsourced` 명시, 빈도 수치 미사용, vlr.gg 미수집. 구역/경로는 navgraph-derived, 유틸은 ability-effect 어휘.
- **PV-3 정합:** action-schema(ActionCategory/InfeasibilityReason) 매핑표 → `ASCENT_TACTICS.md §4`.
- **Astra Nebula 보강:** Astra 공식 페이지에서 smoke/duration 14.25s/cooldown 35s 소싱 → **ability-effects 120/120**.
- **테스트:** `pytest -q` **16 passed**(전술 스키마 + zone/edge/effectType 실재 검증 포함).

## 3. 변경한 파일
- `datasets/catalog/schema/tactic.schema.json`(신규)
- `datasets/derived/tactics/`(신규 소유): ascent-tactics.json, ascent-zone-vocabulary.json(PV-4 미러)
- `tools/catalog-builder/`: build_ascent_tactics.py(신규), data/ability_effects.json(Astra Nebula), tests
- `docs/research/ASCENT_TACTICS.md`(신규), `docs/research/CATALOG.md`(§1·§5), handoff

## 4. 데이터 출처
PV-4 navgraph(구역/경로), 내 ability-effects(유틸 어휘), ascent-comps.json(조합), 전술 내용은 expert-unsourced. Astra Nebula: 공식 위키 Astra 페이지.

## 5~7. 실행/검증/결과
`python tools/catalog-builder/build_ascent_tactics.py`(zone/route 검증) → `pytest -q`(16 passed). 전술 17종 전부 스키마+navgraph 검증 통과.

## 8. 현재 미완료
- 전술 요소의 공식/분석 URL 출처 보강(현재 expert-unsourced). route별 시간은 PV-4 navgraph 런타임 조회.

## 9. 알려진 문제
- 전술 지식은 단일 인용 URL이 없어 expert-unsourced로 표기(실데이터 검증 전 가중치 보정 대상).

## 10. 설계 결정
- 고정 목록이 아닌 primitives+전제조건(§29). 구역/경로는 PV-4 navgraph로 검증(테스트 강제). 콜아웃 공백은 최근접 zone+설명.

## 11. 라이선스
전술 지식은 일반 지식(출처 없음 표기). 구역은 PV-4 파생(미러, 출처표기). 위키 Astra 페이지는 Riot 소유 사실.

## 12. 다음 권장 작업
1. 전술 요소에 공식/분석 출처 보강. 2. PV-3가 compMapping·utilityRequirements를 Action Generator precondition으로 연결. 3. route 시간은 PV-4 edge로 계산.

## 13. 작업 재개 지점
- `docs/research/ASCENT_TACTICS.md` → `datasets/derived/tactics/ascent-tactics.json` / `build_ascent_tactics.py`.
- `pytest tools/catalog-builder -q`.

---

# PROJECT V — TASK HANDOFF (PV-1 7차: 전술 출처 보강 + 패치/메타 이력)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research`

## 1. 작업 목표
(A) 전술 17종에 공개 출처 부착, (B) Ascent·상위 요원 패치/메타 이력 + 데이터 구간 권고.

## 2. 완료한 작업 (실제 수행·검증)
- **(A) 전술 출처:** 전 17종에 공식 Ascent 위키(geography) 출처 부착. Sentinel Setup A/B는 사용 스킬의 공식 페이지(Lockdown/Trapwire/Trademark/Nanoswarm, resolve 확인)로 provenance=official 승격. 나머지 전략은 `expert-knowledge-unsourced` 유지(억지 출처 미부착). vlr.gg 미수집, 각 페이지 개별 fetch.
- **(B) 패치/메타 이력:** 공식 위키 Update History에서 Ascent 맵 변경 13건 + 상위 8요원 밸런스 변경 추출. 공식 패치노트 URL **24/27 resolve 확인**(미해결 핫픽스는 위키가 출처). → `datasets/derived/meta/patch-history.json`(+스키마).
- **데이터 구간 권고:** Ascent 맵은 **구조 안정**(변동 요인=요원 밸런스). 국제전 153맵 중 ≥9.x=42, ≥11.x=31, ≥13.x=13 → **현재 메타 비교는 패치 ≥9.x 권고**(42맵), 전체는 구조 baseline용. PV-2 priors 필터 방법 명시(파일 미수정).
- **테스트:** `pytest -q` **17 passed**(전술 sources + 패치 스키마·단조성·URL 형식 검증).

## 3. 변경한 파일
- `datasets/derived/meta/`(신규 소유): patch-history.json/.schema.json
- `datasets/catalog/schema/tactic.schema.json`(sources 필드), `tools/catalog-builder/build_ascent_tactics.py`(출처 부착), data 재생성
- `docs/research/PATCH_HISTORY.md`(신규), `ASCENT_TACTICS.md`(§6 출처), tests, handoff

## 4. 데이터 출처
공식 위키 Update History(맵·요원), 공식 패치노트(resolve 검증), 공식 스킬 페이지(Sentinel 메커니즘), VCT Reference(표본 수).

## 5~7. 실행/검증/결과
`python tools/catalog-builder/build_ascent_tactics.py` → `pytest -q`(17 passed). 패치 URL 24/27 resolve, 단조 증가 검증.

## 8. 현재 미완료
- 전략 결정 자체의 분석가/코칭 출처(작성자·날짜 명확) — 확보 시 analyst/community로 보강.
- 요원별 과거 랜드마크 리워크 일부는 산문 언급(필요 시 notableChanges 확장).

## 9. 알려진 문제
- 일부 핫픽스 패치(9.01·9.06·13.09)는 공식 노트 페이지 부재 → patchNoteResolves=false, 위키가 출처.

## 10. 설계 결정
- geography 출처(Ascent 위키)는 전략을 입증하지 않으므로 provenance.type 미승격(메커니즘 공식 문서화된 Sentinel만 official). 데이터 구간 권고는 표본 수 트레이드오프로 근거화.

## 11. 라이선스
공식 위키/패치노트는 Riot 소유 사실, 출처 URL만 기록. PV-2 priors 미수정(권고만).

## 12. 다음 권장 작업
1. PV-2: priors에 patch≥9.0 현재-메타 필터 + 전체 구조 baseline 분리. 2. 전술 전략 출처(분석가) 보강. 3. 패치별 요원 수치는 ability_facts/effects를 패치 스냅샷으로 확장.

## 13. 작업 재개 지점
- `docs/research/PATCH_HISTORY.md` → `datasets/derived/meta/patch-history.json`; `docs/research/ASCENT_TACTICS.md` → tactics.
- `pytest tools/catalog-builder -q`.

---

# PROJECT V — TASK HANDOFF (PV-1 8차: 사전 통합 감사)

**기준일:** 2026-11-18 · **브랜치:** `claude/pv-research` · **범위:** 읽기 전용(전 브랜치)

## 1. 작업 목표
최종 머지 전 6브랜치의 라이선스·개인정보·출처를 감사(읽기 전용), 통합 체크리스트 작성.

## 2. 완료한 작업 (실제 수행)
- **인벤토리:** 6브랜치 × main 대비 변경 파일 목록 + 대용량/바이너리 분류(pv-data 1.5MB ratings·1MB onnx, pv-replay PNG 3개).
- **라이선스:** extract.mjs=ValorantWebReplayer(MIT) 재구현, pv-mapmesh=recast-navigation(MIT/zlib) npm, ValorantReplayParser=외부도구(미커밋). 루트 LICENSE=MIT © Kim Yi Rang. → `THIRD_PARTY_NOTICES.md` 초안.
- **개인정보:** 트리+전체 이력(50커밋) 검색 — 비밀정보/.env/자격증명 0, RiotID 0, ProfileName은 합성값/라벨뿐(실명 0). player_ratings는 숫자 ID. 조치: pv-replay squash(계획), screenshot-real.png 육안 확인.
- **출처:** 실/합성 분리 양호, 파생물 gitignore 양호, 태그 규율 양호. VCT Reference 출처 표기 보강 권고.
- **산출물:** `docs/THIRD_PARTY_NOTICES.md`, `docs/research/PRE_MERGE_AUDIT.md`(심각도별 체크리스트).

## 3. 변경한 파일 (내 브랜치 문서만)
- `docs/THIRD_PARTY_NOTICES.md`(신규), `docs/research/PRE_MERGE_AUDIT.md`(신규), handoff. **다른 브랜치 미수정.**

## 4~7. 방법/결과
읽기 전용 git grep/log/ls-tree. 차단 0건, 통합 시 조치 6건(A~F), 참고 다수. 실제 이름은 마스킹(보고서 미기록).

## 8. 현재 미완료 (머지 담당 몫)
- extract.mjs MIT 전문 동반, recast 고지, pv-replay squash, screenshot-real.png 육안확인, VCT Reference 출처표기, 루트 공유파일 충돌 조정.

## 10. 설계 결정
- 다른 브랜치 수정/머지 금지 준수. 실명 문자열 미기록(마스킹). geography 출처와 전략 출처 구분 원칙 유지.

## 12. 다음 권장 작업
오케스트레이터가 PRE_MERGE_AUDIT §5 체크리스트로 통합 진행. THIRD_PARTY_NOTICES 최종본 확정.

## 13. 작업 재개 지점
- `docs/research/PRE_MERGE_AUDIT.md` → `docs/THIRD_PARTY_NOTICES.md`.

---
**실행한 테스트만 보고함. 미실행 테스트를 통과로 기록하지 않음. 받지 못한/확인하지 못한 값을 사실로 기록하지 않음.**
