# PROJECT V — 라이선스 감사 (LICENSE_AUDIT.md)

**작성:** PV-1 Research · **기준일:** 2026-11-18

각 외부 자료의 라이선스, 사용 제한, 재배포 가능 여부를 기록한다.
**실제 LICENSE 파일을 직접 열람해 확인한 항목**과 **미확인 항목**을 구분한다.
법률 자문이 아니며, 상업적 배포 전 각 라이선스 원문과 Riot 지식재산권 정책을 별도 검토해야 한다.

---

## 0. 결정 — 프로 선수 핸들·팀 실명 사용 (DECISION, 2026-11-18)

**사용자 결정(2026-11-18, 오케스트레이터 전달):** 우선 출시가 아니므로 **VCT 공개 경기의 프로 선수
핸들과 실제 팀 이름을 그대로 사용(커밋)한다.** 이는 본 프로젝트 감사에서 **위반이 아니라 "허용"**으로
분류한다(출처: 공개 프로 경기 기록, VCT Reference 등).

- **허용 범위:** 공개 VCT 경기의 프로 선수 핸들(IGN/handle)과 프로 팀 실명·식별자.
  예) `pv-data:datasets/normalized/vct-reference/*`의 `name:"Team Vitality"`, 선수 `handle` 필드.
- **여전히 위반(계속 차단):**
  1. **비(非)프로 일반인 식별자** — `.vrf` 샘플의 `ProfileName`, 리그 밖 일반 RiotID(`name#tag`).
  2. **API 키·비밀정보**(`RGAPI-`, 토큰, `.env`, 자격 증명).
  3. **재배포 권한이 불명확한 원본 데이터**(예: valorant-api 대량 원본 → gitignore 유지).
- **⚠ 출시 전 재검토 필수:** 상업 출시 전 **프로 선수 초상권(likeness/NIL)과 팀/대회 상표(trademark)**,
  Riot/대회사 퍼블리시티 규정을 법무 검토한다. 출시 시 가명화 또는 라이선스 확보 여부를 결정한다.

이 결정은 `docs/research/PRE_MERGE_AUDIT.md` §3의 개인정보 분류에 반영되어 있다.

---

## 1. 라이선스 직접 확인 저장소 (PV-1 LICENSE 파일 열람)

| 저장소 | 라이선스 | 저작권자 | 상업적 사용 | 재배포 | 코드 통합 시 의무 |
|---|---|---|---|---|---|
| **C9 Gameplan** (`joshghal/c9-gameplan-backend`) | **MIT** | Joshua Galilea (2025) | ✅ 허용 | ✅ 허용 | 저작권·허가 고지 포함 |
| **vrfkit** (`yakisoba0728/vrfkit`) | **Apache-2.0** | vrfkit contributors (2026) | ✅ 허용 | ✅ 허용 | 고지·NOTICE 유지, 변경 표시, 특허 조항 |
| **ValoReview** (`dhinakar-v/ValoReview`) | **Apache-2.0** | dhinakar-v | ✅ 허용 | ✅ 허용 | 고지·THIRD_PARTY 유지(벤더된 VRP 포함) |
| **ValorantReplayParser** (`michel-giehl/ValorantReplayParser`) | **MIT** | Michel Giehl (2026) | ✅ 허용 | ✅ 허용 | 저작권·허가 고지 포함 |
| **ValorantWebReplayer** (`talhakoek/ValorantWebReplayer`) | **MIT** | Talha Kök and contributors (2026) | ✅ 허용 | ✅ 허용 | 저작권·허가 고지 포함 |

**근거:** 각 저장소 `LICENSE` 파일 헤더 및 `NOTICE.md`/`THIRD_PARTY.md`를 직접 열람(2026-11-18).

### 1.1 라이선스 상호 관계 / 주의
- **vrfkit:** v0.2.0까지는 MIT였고 이후 **Apache-2.0으로 전환**(`NOTICE.md`에 구 MIT 고지 보존). ValorantReplayParser(MIT)에서 파생 — MIT 코드 고지가 함께 유지됨.
- **ValoReview:** ValorantReplayParser의 4개 프로젝트를 `csharp/parser/`에 **벤더링**하고, 바이너리는 **OozSharp**(Oodle 디코더)와 링크 → 배포 전 OozSharp 라이선스 별도 확인 필요(THIRD_PARTY.md 명시). 폰트 4종(woff2)도 라이선스 동반.
- **ValorantWebReplayer:** `ValorantReplayParserPlayground`(MIT 계열) 바이너리 + 패치 사용.
- **공통(모든 리플레이 도구):** "Not affiliated with / endorsed by Riot Games" 명시. 디코딩 대상 `.vrf`·맵 지오메트리·요원 에셋의 **원 저작권은 Riot**. 코드 라이선스(MIT/Apache)는 **코드에만** 적용되며 **게임 자산/데이터 재배포 권리를 부여하지 않는다.**

---

## 2. 라이선스 미확인 / 독점·ToS 소스

| 소스 | 라이선스 상태 | 상업적 | 재배포 | 비고 |
|---|---|---|---|---|
| **valorant-api.com** | 미확인(OSS 라이선스 미발견) | unknown | unknown | 공개 무인증 API지만 라이선스/ToS 미명시. 데이터는 Riot 에셋 파생 → 재배포 보수적으로 |
| **Riot Developer API** | Riot Developer Policies(독점) | 제한 | 제한 | 일반/게임별 정책 준수 필수. 키 발급 조건 |
| **Riot × GRID** | GRID/파트너 약관(독점) | 제한 | ❌ | 파트너 데이터 재배포 금지 추정 |
| **VLR.gg** | ToS(재배포 라이선스 없음) | ❌ | ❌ | 스크래핑 정책 준수 |
| **분석 플랫폼 17종** | 독점/ToS | ❌ | ❌ | 분석 참고용 |
| **공식 패치노트/위키** | Riot 저작권 | ❌ | ❌ | 규칙 수치는 참조 가능, 콘텐츠 재배포 불가 |
| **사용자 Blender 맵** | 미확인(Riot 지오메트리 추정) | ❌ | unknown | 게임 맵 IP는 Riot. 내부 개발용 한정 권장 |
| **참고 게임(FM/OOTP 등)** | 독점 상용 | ❌ | ❌ | 설계 참고만, 내부 비공개 가정 금지 |

### 2.0 게임 데이터 카탈로그 결정 (PV-1 2차)
valorant-api 라이선스가 **불명확**하므로, 게임 데이터 카탈로그는 **수집 스크립트·스키마·문서만 커밋**하고
Riot 파생 생성 데이터(`datasets/catalog/release-*/`)는 **gitignore**하여 로컬 재생성한다(§3 권고 2·3 적용).
스키마(`datasets/catalog/schema/`)와 테스트 픽스처는 PV-1이 작성(합성 가짜 이름)한 것이라 커밋한다.

### 2.1 VCT Reference / vctstats (PV-2 확정 예정)
- **VCT Reference:** `/terms` 미열람 → 라이선스 **UNVERIFIED**. PV-2가 약관 원문 확인 후 확정.
- **vctstats:** 저장소 LICENSE 미열람 → **UNVERIFIED**. PV-2 확인.

### 2.2 기타 미검증 저장소
§7/§8/§9/§10/§12의 ETL·예측·VOD·맵·ML 저장소는 **개별 LICENSE 미열람 → 전부 UNVERIFIED.** 사용 전 각 저장소 라이선스 확인 필수.

---

## 3. 프로젝트 통합 시 권고

1. **코드 참고/통합은 MIT·Apache-2.0 5종이 안전.** 통합 시 각 고지(MIT 고지문, Apache NOTICE/변경표시, ValoReview의 THIRD_PARTY·OozSharp)를 PROJECT V 저장소에 보존.
2. **게임 자산·경기 데이터는 코드 라이선스와 별개.** `.vrf` 디코딩 결과, 맵 지오메트리, 요원/무기 에셋, GRID/VLR 경기 데이터의 **재배포는 Riot/제공자 권리에 종속**. 내부 개발·검증 목적과 공개 배포를 구분.
3. **재배포할 산출물에는 원시 경기 데이터를 포함하지 않는 것을 기본**으로 하고, 파생·집계·합성 데이터만 공개 후보로 둔다(합성은 실데이터와 명확히 구분 — README §37).
4. **Riot 비제휴 고지**를 산출물에 포함.
5. PV-2는 VCT Reference·vctstats·VLR 계열의 약관을 확정해 이 문서를 갱신한다.

---

*변경 이력: v1.0 (2026-11-18, PV-1) — 5개 저장소 LICENSE 직접 확인, 나머지 분류.*
