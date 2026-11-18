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
**실행한 테스트만 보고함. 미실행 테스트를 통과로 기록하지 않음. 받지 못한 데이터를 받은 것으로 기록하지 않음.**
