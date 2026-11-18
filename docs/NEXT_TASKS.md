# PROJECT V — NEXT TASKS (통합 후 남은 과제)

**작성:** PV-1 Research (9차 종합) · **기준일:** 2026-11-18 · 기준 커밋: `docs/HANDOFF.md` 참조.
각 과제에 **선행 조건**과 **막힌 이유(사용자 조치 필요 여부)**를 표기. 사실은 handoff·커밋 확인분만.

## P0 — 통합(머지) 직전
| 과제 | 선행/막힌 이유 |
|---|---|
| 6브랜치 통합 머지 | 오케스트레이터 수행. `PRE_MERGE_AUDIT.md` 체크리스트(라이선스 고지, pv-replay squash, VCT 출처표기, 루트 파일 충돌) 선행 |
| `THIRD_PARTY_NOTICES.md` 최종본 | 초안 존재. extract.mjs MIT 전문·recast 고지 확정 |
| 루트 공유파일 충돌 조정(README/Handoff/LICENSE/tsconfig/.gitignore) | 브랜치별 내용 상이 → reconcile |

## P1 — 핵심 엔진 완성
| 과제 | 선행 / 막힌 이유 |
|---|---|
| **실측 Layer B 확보** (사용자 Ascent 5v5 `.vrf`) | **🔒 사용자 조치 필요** — 사용자가 `.vrf` 캡처 제공. PV-6 파이프라인으로 디코드(L3 검증됨). 현재는 합성 데이터만 |
| Action Generator + Decision Debugger 완성 | pv-core phase-3 계약 존재. PV-3 리허설 진행 중. shared-types 안정 후 |
| Save/궁극 경제 엔진 전용화 | game-rules provisional 값 → 실측(ability_facts/effects) 반영; 세이브 가치 모델 |
| 경제·궁극 수치 provisional→확정 | pv-research 소싱값(ult points 30/30, 실드/스파이크)으로 game-rules 교체(PV-3 대조 권고 §CATALOG 3.6) |
| 교전/라운드 보정 | pv-replay kinematics(실 .vrf 집계)로 이동/속도 밴드 보정; combat-engine 캘리브레이션 |

## P2 — 공간·검증
| 과제 | 선행 / 막힌 이유 |
|---|---|
| NavMesh 완전 연결 | pv-mapmesh 연결성 한계 기록 → 수동 보강/재빌드. PV-4 navgraph와 정합 |
| 나머지 맵(Ascent 외) Blender 분석 | **🔒 부분 사용자 조치** — 맵 .blend 다운로드(Drive). PV-5 파이프라인 재사용 |
| 시뮬 vs 실측 통계 검증 (README §31) | round-simulator 산출 vs pv-research comps(공수 WR·조합). patch≥9.x 구간 권고 |
| 풀 5v5 라운드→매치→시즌 | round-simulator(라운드 루프 9테스트) 확장; 결정적 고속 시뮬 |

## P3 — 데이터/인가 경로 (사용자 판단)
| 과제 | 막힌 이유 |
|---|---|
| GRID Open Access 무료 키 + 좌표 제공 실측 | **🔒 사용자 신청**(비상업·지연). per-tick 위치 제공 여부 실측 필요(GRID_ACCESS) |
| Riot production 키(match API) | **🔒 사용자 승인 신청** — 개발키는 match 403 |
| C9 GRID 원시 궤적 | **🔒 VCT 파트너 자격** 필요 |

## P4 — UI / 매니지먼트
| 과제 | 선행 / 막힌 이유 |
|---|---|
| Electron 앱 쉘(메인/렌더러/시뮬 프로세스 분리) | 엔진 안정 후. 현재 pv-replay 독립 PixiJS 뷰어만 |
| PixiJS 리플레이 뷰어 통합 | pv-replay 뷰어를 통합 데이터 스키마에 연결 |
| 정보전 중심 UX + 매니지먼트 화면 | 엔진·검증 완료 후(DECISION-001: 매니지먼트는 마지막) |
| 선수 능력치 → 행동/결과 반영 | pv-data player_ratings(402, EB shrinkage) → 엔진 연결 |

## 블로커 요약 (사용자 조치 필요)
1. **Ascent 5v5 `.vrf` 캡처** (실측 Layer B의 1순위 경로).
2. **맵 .blend 추가 다운로드** (나머지 맵).
3. **GRID 무료 키 / Riot production 키** 신청(선택).
4. **출시 전 초상권·상표 법무 검토**(프로 실명 사용).
