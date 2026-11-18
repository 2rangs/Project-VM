# PROJECT V — 데이터 가용성 상태표 (DATA_AVAILABILITY.md)

**작성:** PV-1 Research · **기준일:** 2026-11-18

README §3.2 상태 분류와 §3.3 검증 수준을 적용한다. 근거(Verification Evidence)는 실제 수행한 것만 기록한다.
원본: [`datasets/registry/sources.json`](../datasets/registry/sources.json).

**상태(§3.2):** VERIFIED_DOWNLOADABLE · VERIFIED_API · VERIFIED_SOURCE_CODE · VIEW_ONLY · AUTH_REQUIRED · PAID_ACCESS · LICENSE_RESTRICTED · UNVERIFIED · DEPRECATED · INACCESSIBLE
(프로젝트 확장값 `PV-2_PENDING` = Data 에이전트 검증 대기)

**검증 수준(§3.3):** L0 링크확인 · L1 구조확인 · L2 실제접근 · L3 재현완료

---

## A. PV-1이 실제 검증한 소스

| 소스 | 상태 | 수준 | 다운로드 | API | 코드 | 근거(실제 수행) |
|---|---|---|---|---|---|---|
| C9 Gameplan | VERIFIED_SOURCE_CODE | **L2** | 코드+파생데이터 ⭕ / 원시 ❌ | ⭕(호스팅) | ⭕ | clone `0c971bb`; `ls app/data`; `json.load` 3파일 성공; `.gitignore`·GRID 스크립트 열람 |
| vrfkit | VERIFIED_SOURCE_CODE | **L1** | 코드 ⭕ / 출력은 `.vrf` 필요 | ❌ | ⭕ | clone `9ece4ab`; crates/·src 열람; USAGE/DATA 스키마 열람; **빌드 미수행(차단)** |
| ValoReview | VERIFIED_SOURCE_CODE | **L1** | 코드 ⭕ | ❌ | ⭕ | clone `02e8065`; README/LICENSE/THIRD_PARTY 열람; **미실행(Win+.vrf)** |
| ValorantReplayParser | VERIFIED_SOURCE_CODE | **L1** | 코드 ⭕ / NuGet alpha | ❌ | ⭕ | clone `fbf24b6`; README/LICENSE/src 열람; **미빌드** |
| ValorantWebReplayer | VERIFIED_SOURCE_CODE | **L1** | 코드 ⭕ | ❌ | ⭕ | clone `e060000`; README/LICENSE 열람; **미실행(Win)** |
| valorant-api.com | VERIFIED_API | **L2** | — | ⭕ | ❌ | GET version/agents/weapons/maps 성공, JSON 파싱(2026-11-18) |

**해석:** 다섯 저장소 모두 코드는 **실제 클론·열람**했다. 그러나 **실행 재현(L3)은 하나도 없다** —
`.vrf` 리플레이 샘플이 없고(사용자 캡처 필요, 재배포 불가), C9 시뮬레이션·Rust/.NET 빌드는 미수행.
C9는 저장소 내 **파생 JSON을 실제로 읽어** L2, valorant-api는 **실 API 응답을 읽어** L2.

---

## B. Data 에이전트(PV-2) 검증 대기

| 소스 | 상태 | 수준 | 메모 |
|---|---|---|---|
| VCT Reference | PV-2_PENDING | L0 | DuckDB 다운로드·테이블·결측률·약관 → PV-2 |
| vctstats | PV-2_PENDING | L0 | VLR수집·SQLite·LightGBM·누출 → PV-2 |

PV-1은 도달성(HTTP 200)만 확인했고 다운로드/스키마 분석은 하지 않았다.

---

## C. 인증/권한 필요 (AUTH_REQUIRED)

| 소스 | 상태 | 수준 | 인증 | 근거 |
|---|---|---|---|---|
| Riot Developer API | AUTH_REQUIRED | L0 | 사용자 API 키 | HTTP 200 `/apis`; 인증 호출 없음 |
| Riot × GRID Open Access | AUTH_REQUIRED | L0 | VCT 파트너 | HTTP 200 docs; C9 스크립트로 포털 전용 확인 |
| 사용자 Blender 맵(Drive) | AUTH_REQUIRED | L0 | Drive 로그인 | URL만; 미다운로드 |

---

## D. 열람 전용 (VIEW_ONLY)

| 소스 | 상태 | 수준 | 근거 |
|---|---|---|---|
| VLR.gg | VIEW_ONLY | L0 | HTTP 200; 공식 API 없음, 2D replay 일부만 |
| 분석 플랫폼 17종(RIB.GG, THESPIKE 등) | VIEW_ONLY | L0 | rib.gg/thespike.gg HTTP 200; 나머지 목록만. 대량접근 미확인 |
| 게임규칙/위키/패치노트 | VIEW_ONLY | L0 | playvalorant 패치노트·wiki Credits HTTP 200 |
| 참고 게임(FM/OOTP/vctmanager/VCTDraft/ValoPlant) | VIEW_ONLY | L0 | 설계 참고; 미조사 |

---

## E. 미검증 (UNVERIFIED, 목록만 — L0)

비공식 VLR API(vlrggapi·vlresports·grgaoun/vlr), ETL(VLML·economy-analysis·tournament-ecosystem),
예측/ML(Match-Predictor·Velo.gg·valPRED·valo-player-intel), 추가 리플레이(ValoP·ReplayViewer),
VOD/CV(valoscribe×2·keith-ng/vct·Strategy-Mapping·vod-analyzer), 맵(ValorantBrowser·Zone-Stats·Piana),
ML 데이터셋(EsportsBench(200)·D2E·gaming-500-hours·X-EGO-CS[=CS]).
→ 전부 README/Handoff 목록에서 수집했을 뿐 개별 접근·검증하지 않았다.

---

## E-2. 게임 데이터 카탈로그 (PV-1 2차, valorant-api 기반)

| 산출 | 상태 | 수준 | 근거 |
|---|---|---|---|
| weapons.json (21) | VERIFIED_API | **L3** | 빌더 실행·스키마 통과. 무기 스탯 전부 API 검증 |
| agents.json (30) | VERIFIED_API | **L3** | 빌더 실행·스키마 통과. role+슬롯 API 검증 |
| abilities.json (130) | 부분검증 | **L3(구조)/L0(수치)** | 이름/슬롯/설명 API 검증; cost/charges/cooldown/ultPoints/duration/typeTags는 **null+verified:false**(미소싱) |
| equipment.json (4) | 미검증 수치 | L0 | 실드·스파이크 상수 전부 null+verified:false. `needsCrossCheckPV3:true` |

빌더/스키마/문서만 커밋, 생성 데이터는 gitignore(valorant-api 라이선스 불명확) → 로컬 재생성.
검증 실행: `pytest tools/catalog-builder -q` → **9 passed**; `build_catalog.py` → 전 레코드 스키마 통과.

## F. 특이 사항 (혼동 방지)

1. **C9의 "592,893 샘플" 원시 파일은 저장소에 없다** (`.gitignore` 제외). 있는 것은 파생 모델.
2. **X-EGO-CS는 Counter-Strike 데이터** — VALORANT 전술 데이터로 취급 금지(README §12).
3. **공식 Riot API가 리플레이/10인 위치를 준다고 가정 금지**(README §4.1).
4. 실제 10인 시점별 위치의 현실적 경로 2가지: (a) 사용자 **`.vrf` + vrfkit/ValoReview**(128Hz), (b) **GRID 파트너 피드**(인증).
5. 조사 시점 라이브 패치 **release-13.10** — vrfkit 최상위 지원 빌드와 일치. 과거 경기는 당시 패치 규칙으로 해석(Handoff §10).
