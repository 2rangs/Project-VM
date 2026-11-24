# PROJECT V — 문서 안내

처음 보는 사람은 이 순서로 읽는다: `HANDOFF.md`(현재 상태·검증·남은 일) → `DEVELOPMENT_PROCESS.md`(일하는 방식·게이트) → 맡은 영역의 `handoff/<영역>.md`.

## 현재 상태
| 문서 | 내용 |
|---|---|
| `HANDOFF.md` | 현재 상태의 정본: 검증 수치, main에 없는 브랜치, 부족한 점(P0–P3), 라이선스·자산 |
| `WORK_HISTORY.md` | 머지별 기록(무엇을 합쳤고 어떤 수치로 검증했는지) |
| `DEVELOPMENT_PROCESS.md` | 세션 운영, 검증 게이트, 무거운 실행 잠금, 교훈 |
| `handoff/*.md` | 영역별 인수인계(경기 화면, 커리어, 구단 운영, 맵 전술 등) |

## 설계·모델(영역별 정본)
| 문서 | 영역 |
|---|---|
| `ARCHITECTURE.md`, `ARCHITECTURE.integrated.md` | 패키지 구조와 데이터 흐름 |
| `ENGINE_TRUTH.md` | 시야·스모크·설치·피크 모델, 실제 로스터 보정 기록 |
| `STAT_OUTCOME_MATRIX.md` | 능력치 → 결과 공식 |
| `DECISION_MODEL.md`, `CONTINUOUS_TACTICAL_INTELLIGENCE.md` | 팀·IGL 의사결정 |
| `ECONOMY_MODEL.md` | 팀·개인 경제 |
| `MOVEMENT_STYLE.md` | 선수별 이동·바이 페이즈(움직임 브랜치) |
| `SERIES_AND_VETO.md` | 시리즈·밴픽·맵 숙련도 |
| `CAREER_MODE.md`, `CLUB_OPERATIONS.md`, `GENERATED_PEOPLE.md` | 커리어·구단 운영·생성 인물 |
| `MODELS_AND_MAP_MESHES.md` | 3D 모델과 맵 메시 파이프라인 |
| `GAME_RULES.md`, `DATA_SCHEMA.md`, `DATA_AVAILABILITY.md` | 게임 규칙·데이터 스키마·가용 데이터 |
| `VALIDATION_BASELINES.md`, `TEST_PLAN.md` | 검증 기준과 테스트 계획 |
| `LICENSE_AUDIT.md`, `THIRD_PARTY_NOTICES.md`, `SOURCES.md` | 라이선스·출처 |

## 리서치
`research/` — 프로 기술 카탈로그(`PRO_TECHNIQUES*.md`), 럴커(`LURKER_ROLE.md`), 설치·설치 후·리테이크(`PLANT_POSTPLANT.md`), 미드 주도권(`MID_CONTROL.md`), 상태 감사(`STATUS_AUDIT_2026-11-23.md`).

## 기록 보관
- `handoffs/PV-*.md` — 2026-11-18 초기 7개 에이전트의 인수인계(코드 주석이 참조하므로 위치 유지).
- `archive/` — 끝난 일회성 문서: 초기 통합 계획·리허설·결과, 초기 개발 로그(→ `WORK_HISTORY.md`로 대체), 초기 다음 과제 목록(→ `HANDOFF.md` §5로 대체), 시제품 체크리스트, 통합 리허설 하네스.
- 루트 `Handoff.md` — 최초 설계 명세(2026-11-18). 코드 주석의 "Handoff §N"은 이 문서를 가리킨다. 현재 상태는 `docs/HANDOFF.md`.
