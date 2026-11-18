# PROJECT V — Ascent Tactical Knowledge Base (ASCENT_TACTICS.md)

**작성:** PV-1 Research (6차) · **기준일:** 2026-11-18

PV-3의 IGL/Action Generator가 전략·전술 후보를 **조합**해 생성할 때 쓰는 구조화된 전술 지식
(README §15–18, §24; Handoff §13–14). 고정 행동 목록이 아니라 **전술 요소(primitives) + 전제 조건**이다(§29).

- 스키마: [`datasets/catalog/schema/tactic.schema.json`](../../datasets/catalog/schema/tactic.schema.json)
- 데이터: [`datasets/derived/tactics/ascent-tactics.json`](../../datasets/derived/tactics/ascent-tactics.json)
- 구역 어휘: [`datasets/derived/tactics/ascent-zone-vocabulary.json`](../../datasets/derived/tactics/ascent-zone-vocabulary.json) (PV-4 navgraph 미러, 출처 표기)
- 생성/검증: `python tools/catalog-builder/build_ascent_tactics.py` → `pytest tools/catalog-builder -q`

## 1. 출처 규칙 (정직성)
- **구역·경로(zones/route)**: PV-4 `ascent.navgraph.json`에서 파생(`navgraph-derived`). 빌드/테스트에서 **zone ID·edge 실재 검증**.
- **유틸 유형(effectType)**: 내 ability-effect 어휘(smoke/flash/recon/molly/wall/slow/trap/heal/decoy/movement/suppress/concuss) — 검증.
- **전술 내용**(어떤 실행·홀드가 존재하는지, 유틸 역할): 표준 프로/커뮤니티 지식이며 단일 인용 URL이 없어 **`provenance.type="expert-knowledge-unsourced"`**로 명시. 공식/분석 출처가 있으면 `official`/`reputable-analysis` + URL.
- **경기 빈도 수치는 쓰지 않음**(데이터 근거 없음). 조합 멤버십·픽 수만 `ascent-comps.json`(실측)에서 인용.
- vlr.gg 자동 수집 안 함.
- 커뮤니티 콜아웃이 navgraph에 없으면(예: "A Heaven") **가장 가까운 zone ID + 설명**(예: `a-rafters`)으로 두고 새 좌표를 짓지 않음.

## 2. 내용 요약
- **공격 요소 8종:** A Execute, A Split(Main+Garden), Mid Control, Mid→B via Market, B Execute, Fake A→B, Default spread, Mid Lurk.
- **수비 요소 9종:** A/B Default Hold, Mid Control(수비), Sentinel Setup A/B, Retake A/B, Aggressive Mid Info Push, Rotate A↔B.
- **유틸 요구:** 각 요소의 `utilityRequirements[]` = `{effectType, purpose, targetZones[], optional}`.
- **조합 매핑:** `ascent-comps.json` 상위 5조합별 실행 가능 전술(유틸 충족 기준, 추론; 빈도 아님).

## 3. 핵심 구역 어휘 (PV-4 navgraph, 22 zones)
A: `a-lobby a-main a-tree a-garden a-window a-site a-wine a-rafters` · B: `b-lobby b-main b-site b-boathouse`
Mid: `mid-top mid-courtyard mid-catwalk mid-cubby mid-bottom mid-link mid-market mid-pizza` · spawns: `attacker-spawn defender-spawn`
plantZones: `plant-a`(a-site), `plant-b`(b-site).

## 4. PV-3 Action Generator 필드 매핑 (읽기 전용 정합)
PV-3 `shared-types/action-schema.ts`의 `ActionCategory = "strategic"|"tactical"|"individual"`, `ActionSchema{category, preconditions[], parameters[], generate(context)}`, `InfeasibilityReason`(`missingAbility`,`insufficientTime`,`noPath`,...)에 대응.

| tactic 필드 | PV-3 소비 | 용도 |
|---|---|---|
| `category` (strategic/tactical) | `ActionSchema.category` | 전략/전술 계층 매칭 |
| `utilityRequirements[].effectType` | precondition / `InfeasibilityReason:"missingAbility"` | 보유 스킬(ability-effects)로 실행 가능성 판정 |
| `zones`, `route` | ParameterDefinition(position/path) + spatial feasibility | 경로·목표 구역 생성(PV-4 navgraph로 `noPath`/시간 검증) |
| `minPlayers`/`idealPlayers` | precondition(생존 인원) | 인원 제약 |
| `route` edge times (PV-4) | `InfeasibilityReason:"insufficientTime"` | 남은 시간 대비 실행 가능성(§15.3, Scenario 04) |
| `risks`/`counterSetup` | Outcome Predictor 입력 | 위험·상대 대응 평가 |
| `compMapping` | 팀 AI prior | 조합별 가능한 전술 집합 |
| `provenance.type` | 신뢰도 가중 | expert-unsourced는 보정 대상(실데이터로 검증 전) |

**좌표/시간 단위:** zones·route는 ID 참조(좌표 없음). 거리·시간이 필요하면 PV-4 navgraph edge(`distanceMeters`,`runTimeMs`,`walkTimeMs`)를 조회 — PV-4는 world units(100u=1m).

## 5. 소비자/확장
- PV-3 IGL: `attack`/`defense` 요소를 사이트 선택·로테이션·페이크 후보로 전개(§24.1).
- PV-4: zone/route 검증·경로 시간 제공. 스킬 반경→존 변환은 PV-4가 수행(§CATALOG 3.9).
- 확장: 공식/분석 출처 확보 시 각 요소 provenance를 `official`/`reputable-analysis`로 승격, targetZones 세분화.

## 6. 출처 보강 (7차)
각 전술에 `sources[]`(url·date·strength·mentions) 추가:
- 전 17종에 **공식 Ascent 위키 페이지**를 geography 출처로(사이트·미드·A Link/Market 문; 전략 자체는 아님 — mentions에 명시).
- Sentinel Setup A/B는 사용 스킬의 **공식 요원/스킬 페이지**(Lockdown·Trapwire·Trademark·Nanoswarm, 전부 resolve 확인)를 추가하고 provenance.type를 `official`로 승격(메커니즘이 공식 문서화됨).
- 나머지 전략 결정(execute/fake/lurk/split 등)은 단일 인용 URL이 없어 `expert-knowledge-unsourced` 유지(geography 출처만 부착). 억지 출처 미부착.

## 7. 미완료
- 전략 결정 자체의 분석가/코칭 출처(작성자·날짜 명확) 확보 시 strength `analyst`/`community`로 보강.
- route별 소요 시간은 PV-4 navgraph edge로 런타임 계산(여기 수치 미기입).
