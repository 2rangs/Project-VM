# PROJECT V — 사전 통합 감사 (PRE_MERGE_AUDIT.md)

**작성:** PV-1 Research (8차) · **기준일:** 2026-11-18 · **범위:** 읽기 전용, 전 브랜치

최종 머지 전 라이선스·개인정보·출처 감사. 대상: `origin/claude/pv-{research,data,core,spatial,mapmesh,replay}`
(6브랜치, 50 커밋). **다른 브랜치는 수정하지 않았다.** 아래는 머지 담당용 체크리스트.

## 0. 요약 (심각도별)
- **차단(BLOCKING): 0건** — 머지를 막는 위반은 발견되지 않음.
- **통합 시 조치(FIX-AT-MERGE): 6건** — §A~§F.
- **참고(INFO): 다수** — §G.
비밀정보 0, `.env`/자격증명 0, 실제 RiotID 문자열 0(트리·이력 전체).

## 1. 파일 인벤토리 (main 대비)
| 브랜치 | 변경 파일 | 주요 확장자 | 대용량/바이너리 |
|---|---|---|---|
| pv-research | 44 | json18 md13 py11 | (없음) |
| pv-data | 126 | json53 py30 md17 ts16 | `player_ratings.json` 1.5MB, `round_value_lgbm.onnx` 1.0MB, sim 예제 2×255KB |
| pv-core | 126 | ts73 json43 | (없음) |
| pv-spatial | 116 | ts79 json22 mjs3 | (없음) |
| pv-mapmesh | 24 | json8 py6 cjs4 | (navmesh .bin은 gitignore) |
| pv-replay | 55 | mjs12 json11 ts11 png3 | PNG 3개(screenshot-real 191KB, screenshot-synthetic 197KB, overlay 149KB) |

## 2. 라이선스 감사
루트 LICENSE: **MIT © 2026 Kim Yi Rang**(전 브랜치 동일). 상세 고지는 `docs/THIRD_PARTY_NOTICES.md` 초안.

**[A] (FIX-AT-MERGE) ValorantWebReplayer 재구현 — MIT 고지 동반**
- `pv-replay:tools/replay-parser/src/extract.mjs`는 talhakoek/ValorantWebReplayer(MIT)의 extract-stream.mjs **재구현**(상단 주석에 출처 명시).
- 조치: MIT 라이선스 전문 + 저작권 고지를 파일/NOTICES에 동반(출처 주석만 있고 라이선스 전문 미동반).

**[B] (FIX-AT-MERGE) recast-navigation 고지**
- `pv-mapmesh`가 recast-navigation(MIT, Recast/Detour=zlib) npm 의존. `.bin` 파생물은 gitignore(미커밋). 조치: NOTICES에 MIT+zlib 고지.

**[C] (INFO) ValorantReplayParser — 외부 도구**
- `pv-replay`가 바이너리를 drop-in으로 사용, **소스/바이너리 미커밋**(확인). MIT 고지만 권장.

## 3. 개인정보·비밀정보 감사
검색: 6브랜치 현재 트리 + 전체 이력(50 커밋), `*.json/jsonl/txt/csv/ts/py`.
- **비밀정보/자격증명:** `RGAPI-`·토큰·`.env`·credentials·`.pem/.key` → **전부 0건**(트리·이력).
- **RiotID `name#tag`:** 데이터 파일 전체 이력에서 **0건**.
- **ProfileName:** 발견값은 전부 (a) 합성 픽스처 값(`SynthPlayer*`, `*.synthetic.*`)과 (b) 서술 라벨("ProfileNames removed; players are anonymous player_N")뿐. **실제 이름 0건.**
- **pv-replay 파이프라인:** `REDACT=1`, `redactProfileNames:true`, 타입 주석 "ANONYMIZED id (player_N). Never a real RiotID", convert-parser "NEVER copy ProfileName" → 익명화 정상.
- **pv-data `player_ratings.json`:** 선수를 **숫자 `playerId`**(예 "9801")로만 표기 → 실명 PII 없음.

**[D] (FIX-AT-MERGE) pv-replay 이력 squash (기 계획)**
- 오케스트레이터가 알린 "과거 커밋 ProfileName 1건"은 접근 가능한 이력에서 합성값으로만 확인됨. 그래도 **계획대로 pv-replay를 squash**해 과거 커밋 평문을 제거(belt-and-suspenders). 추가 실명은 발견되지 않음.

**[E] (FIX-AT-MERGE) `screenshot-real.png` 육안 확인**
- `pv-replay:apps/replay-viewer/docs/screenshot-real.png`는 실제 캡처 기반 뷰어 화면. 파이프라인이 이름을 player_N으로 가리지만, **머지 전 화면에 RiotID/실명이 보이지 않는지 육안 확인** 권장(본 감사 환경에선 OCR 불가). synthetic 스크린샷은 무관.

## 4. 출처(provenance) 일관성
- **실/합성 분리 양호:** pv-data `datasets/synthetic/` ↔ `datasets/normalized/vct-reference/`(실, match 754737/754730) ↔ `derived/`. 혼재 없음.
- **파생물 gitignore 양호:** vct.duckdb, navmesh `.bin`, 카탈로그 `release-*/` 전부 미커밋.
- **태그 규율 양호:** PV-4 navgraph edge `provenance:"manual-approx"`, perception params "manual-approx", 내 tactics `expert-knowledge-unsourced`, kinematics `synthetic:false`+샘플수 명시.
- 점검한 데이터 파일 전부 provenance/synthetic/sha256 마커 보유(예: `ratings_meta.json`은 source.sha256+method).

**[F] (FIX-AT-MERGE) 실데이터 파생물의 출처 표기**
- `pv-data`가 VCT Reference 파생(정규화·ratings), `pv-research`가 comps를 커밋. VCT Reference는 "출처 표기 권장" → 머지본 NOTICES/문서에 vct-reference 출처 표기 추가.
- `pv-replay:kinematics.json`은 **실 .vrf 파생**(synthetic:false, verificationLevel 3). 집계·익명이라 OK, 단 Riot 게임데이터 파생임을 provenance에 유지(이미 있음).

## 5. 머지 담당용 체크리스트
- [ ] [A] extract.mjs에 ValorantWebReplayer MIT 전문/고지 + NOTICES 반영
- [ ] [B] recast-navigation(MIT)+Recast/Detour(zlib) NOTICES 반영
- [ ] [C] ValorantReplayParser MIT 고지(외부 도구)
- [ ] [D] pv-replay 이력 squash(ProfileName 평문 제거)
- [ ] [E] screenshot-real.png 육안 확인(RiotID/실명 노출 없음)
- [ ] [F] VCT Reference 출처 표기(데이터 파생물)
- [ ] gitignore 파생물(vct.duckdb, navmesh .bin, catalog release-*/)이 머지에 섞이지 않게 확인
- [ ] 루트 공유 파일(README/Handoff/LICENSE/.gitignore/tsconfig) 브랜치 간 충돌 조정 — 내용 상이, 머지 시 reconcile
- [ ] `docs/THIRD_PARTY_NOTICES.md` 초안 → 최종본 확정, 루트 비제휴 고지 포함

## 6. 검증
읽기 전용 `git grep`/`git log`/`git ls-tree`로 수행. 실제 이름 문자열은 본 보고서에 기록하지 않음(마스킹).
pv-research 테스트(`pytest tools/catalog-builder -q`)는 영향 없음(본 작업은 문서만 추가).

---
*PV-1이 다른 브랜치를 수정·머지하지 않고 작성. 통합은 오케스트레이터가 수행.*
