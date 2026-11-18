# PROJECT V — DEVELOPMENT HANDOFF (통합 현재 상태)

**작성:** PV-1 Research (9차 종합) · **기준일:** 2026-11-18 · **성격:** 전 브랜치 handoff·커밋을 **읽기 전용**으로 종합한 통합 상태 초안

> 이 문서는 루트 `Handoff.md`(원본)를 **대체하지 않는다**(원본 미수정). 최종 머지 시 저장소의
> "현재 상태 문서"로 쓸 초안이며, 아직 머지되지 않은 6개 브랜치의 실제 구현 상태를 정리한다.
> 사실은 각 브랜치의 handoff·커밋·명시된 테스트 수에서 확인된 것만 적는다.

## 기준 커밋 (as-of, 브랜치 tip)
| 브랜치 | tip | 담당 | 비고 |
|---|---|---|---|
| `claude/pv-research` | `c978c86` | PV-1 Research | 데이터/카탈로그/전술/감사 |
| `claude/pv-data` | `0eb7010` | PV-2 Data | 스키마·ETL·정규화·ratings |
| `claude/pv-core` | `9d7ba29` | PV-3 Simulation Core | TS 모노레포·엔진 |
| `claude/pv-spatial` | `94fa92f` | PV-4 Spatial | 공간·지각·전투·스킬·라운드 |
| `claude/pv-mapmesh` | `5840e6d` | PV-5 Map Mesh | Blender·NavMesh |
| `claude/pv-replay` | `06b46d6` | PV-6 Replay | .vrf Linux 디코드 |

**진행 중(이 시점 이후 갱신 예정):** PV-2 7차, PV-3 리허설, PV-4 7차, PV-5 2차, PV-6 4차. 각 섹션은 쉽게 갱신하도록 분리.

---

## §4. "완료로 오해하면 안 되는 사항" — 실제 검증 상태
범례: ✅구현(테스트 검증) · 🟡부분 · ⛔미구현 · 🚫설계상 배제

| 항목 | 상태 | 근거 (브랜치 · 커밋 · 테스트) |
|---|---|---|
| 프로젝트 저장소/모노레포 | ✅ | pv-core: pnpm 워크스페이스, `packages/*`, Vitest |
| Electron 애플리케이션 | ⛔ | pv-core "No Electron app". pv-replay는 **독립 PixiJS 뷰어**(Electron 아님) |
| VCT Reference DB 다운로드·검증 | ✅ | pv-data L2(DuckDB 13MB, 10테이블); pv-research comps 재검증 |
| GRID API 인증·수집 | ⛔ | Open Access 출시(2026-11-12), **미신청**. per-tick 위치 미제공(pv-research GRID_ACCESS) |
| VLR 리플레이 위치 추출 | 🚫 | vlr.gg ToS가 자동접근·재배포 금지(pv-spatial가 `vlr.gg/terms` 확인) → **설계상 미구현** |
| C9 Gameplan 원본 위치 파일 | 🟡 | pv-research: 파생 이동모델 존재, **원시 궤적은 gitignore(부재)** + GRID 파트너 인증 필요 |
| VRF 파일 실제 디코딩 | ✅ | pv-replay L3: ValorantReplayParser Linux 빌드, `.vrf` 2개 디코드(3001 movement) |
| Blender 맵 다운로드·분석 | 🟡 | pv-mapmesh: **Ascent** `.blend`(326MB, SHA확인) 다운·헤드리스 분석. 타 맵 미완 |
| Ascent 충돌/보행 메시 | ✅ | pv-mapmesh: Blender 4.2에서 collision/floor 추출 |
| NavMesh 생성 | 🟡 | pv-mapmesh: recast-navigation-js 0.44.0로 빌드, **연결성 한계 기록**. pv-spatial는 navgraph 대체(수동근사) |
| World State | ✅ | pv-core `@pv/world-state`(불변·직렬화·observeWorld), 45 테스트 |
| Belief/Observation State | ✅ | pv-core shared-types + `observeWorld`; pv-spatial perception-engine(17 테스트) |
| Action Generator | 🟡 | pv-core `packages/action-generator` 존재(phase-3 계약). PV-3 리허설 진행 중 |
| Combat Engine | ✅ | pv-spatial combat-engine(15 테스트, 정보열세가 OVR 못이김 — README §29) |
| Save/경제·궁극 판단 | 🟡 | pv-core game-rules에 경제/궁극/세이브 규칙값(provisional). 전용 Save 엔진 미확정 |
| 5v5 라운드 시뮬레이션 | 🟡 | pv-spatial round-simulator: **결정적 고정틱 5v5 라운드 루프**(9 테스트). 풀매치·시즌 미완 |
| 실제 경기 통계 검증 | 🟡 | pv-research comps baseline(국제전 Ascent) 존재. 시뮬 vs 실측 비교 미실행 |
| 2순위 맵 데이터 계층(Lotus) | 🟡 | pv-research 10차: Lotus comps/패치이력/전술골격 준비(엔진은 Ascent만 — DECISION-009). 구역어휘 임시(PV-4 navgraph 대기). `docs/research/NEXT_MAP_PREP.md` |

**테스트 합계(명시된 것만):** pv-core 45, pv-spatial 80(21+17+15+18+9), pv-replay 7, pv-data·pv-research 다수(pytest). 수치는 각 handoff 명시값.

---

## §3·§15. 확정된 설계 결정 (원본 DECISION + 이번 세션 결정)
**원본 DECISION-001~011**(루트 Handoff §3)은 유효: 매니지먼트보다 경기엔진 우선, 결과 선결정 거부,
상황기반 선택지 우선, 실제/인지 상태 분리(DECISION-004), ML 선택적 고도화(기본 엔진은 ML 없이 동작),
GPU 의존 최소화, Electron PC, TS 프로토타입→필요시 Rust, 최초 맵 Ascent, 결정적 시뮬, 세이브·궁극 핵심.

**이번 오케스트레이션 세션에서 확인/추가된 결정(2026-11-18):**
| ID | 결정 | 근거 |
|---|---|---|
| OPS-A | **vlr.gg 사용 금지** — ToS가 자동접근·재배포 금지 | pv-spatial `vlr.gg/terms` 확인; pv-data 미구현 |
| OPS-B | **Riot 개발 키 범위 한정** — status/content 200, match **403**(production 키 필요), 개발키 24h 만료 | pv-research DATA_AVAILABILITY |
| OPS-C | **GRID Open Access에 per-tick 위치 없음**(추정) → Layer B는 `.vrf` 우선 | pv-research GRID_ACCESS |
| OPS-D | **ML 선-라운드 승률 모델 미채택**(vctstats식) — ToS + 누출 위험 | pv-data; 기본 엔진 규칙·확률 기반 |
| OPS-E | **프로 선수 핸들·팀 실명 사용 허용**(출시 전 초상권·상표 재검토) | 사용자 결정 2026-11-18; LICENSE_AUDIT §0 |
| OPS-F | **머지 정책** — 각 세션은 자기 브랜치에만 커밋/푸시, 머지·PR 금지, 통합은 오케스트레이터가 최종 수행 | 세션 지침 |
| OPS-G | **Layer B 실데이터는 사용자 `.vrf` 캡처 경로** — 합성 데이터는 실데이터와 명확히 분리 | pv-data synthetic/ ↔ normalized/ |

(통합 전 조치·고지는 `docs/research/PRE_MERGE_AUDIT.md`, `docs/THIRD_PARTY_NOTICES.md` 참조.)

---

## 작업 재개 프로토콜 (머지 후)
1. 이 문서 → `docs/NEXT_TASKS.md` → `docs/DEVELOPMENT_LOG.md` → `docs/ARCHITECTURE.integrated.md`.
2. 브랜치별 실제 코드·테스트 확인(위 커밋 기준). 3. `docs/research/PRE_MERGE_AUDIT.md` 체크리스트 수행.
