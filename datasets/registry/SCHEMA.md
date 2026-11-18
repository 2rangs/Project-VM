# sources.json — 스키마 문서

PROJECT V 데이터 소스 레지스트리의 기계 판독용 파일 `datasets/registry/sources.json`의
스키마 정의. 작성: PV-1 Research 에이전트. 기준일 2026-11-18.

이 스키마는 README §3.1(수집 항목)과 §3.2(상태)·§3.3(검증 수준)을 기계 판독용으로 옮긴 것이다.
사람이 읽는 서술형은 `docs/SOURCES.md`, `docs/DATA_AVAILABILITY.md`, `docs/LICENSE_AUDIT.md`에 있다.

## 최상위 구조

```jsonc
{
  "registry_version": "1.0.0",     // 레지스트리 스키마 버전 (semver)
  "generated_at": "ISO8601",       // 이 파일 생성 시각 (UTC)
  "generated_by": "PV-1-research", // 작성 에이전트
  "game_build_at_survey": "release-13.10", // 조사 시점 라이브 패치 (valorant-api.com로 확인)
  "status_enum": [ ... ],          // 허용되는 status 값 (README §3.2)
  "verification_level_enum": { ... }, // 0~3 의미 (README §3.3)
  "sources": [ SourceEntry, ... ]
}
```

## SourceEntry 필드

README §3.1의 항목을 모두 포함한다. 확인하지 못한 값은 `null` 또는 `"UNVERIFIED"`.

| 필드 | 타입 | 의미 |
|---|---|---|
| `source_id` | string | 고유 ID (kebab-case) |
| `source_name` | string | 출처 이름 |
| `source_url` | string | 1차 URL |
| `extra_urls` | string[] | 추가 URL(문서/약관/데이터셋 등) |
| `owner` | string\|null | 소유 개인/조직 |
| `source_type` | enum | `official_api` \| `community_api` \| `source_code` \| `dataset` \| `website_service` \| `reference_docs` \| `game_rules` \| `map_asset` \| `ml_dataset` |
| `data_category` | enum | `match_stats` \| `spatial_events` \| `tactical_decision` \| `replay_file` \| `agent_weapon_ability` \| `map_geometry` \| `economy_rules` \| `vod_video` \| `tooling` |
| `layer` | enum\|null | Handoff §5.1 데이터 계층: `A`(통계) \| `B`(공간·이벤트) \| `C`(전술 의사결정) \| null |
| `access_method` | string | 접근 방식(clone/REST/download/portal/scrape 등) |
| `authentication` | enum | `none` \| `api_key` \| `partner_credentials` \| `account_login` \| `unknown` |
| `license` | string | SPDX 식별자 또는 `UNVERIFIED`/`proprietary`/`ToS` |
| `commercial_use` | enum | `yes` \| `no` \| `restricted` \| `unknown` |
| `redistribution` | enum | `yes` \| `no` \| `attribution_required` \| `unknown` |
| `ml_usage` | enum | `yes` \| `no` \| `restricted` \| `unknown` |
| `last_update` | string\|null | 출처의 최근 갱신(커밋일/패치일 등) |
| `temporal_coverage` | string\|null | 데이터가 다루는 기간 |
| `spatial_coverage` | string\|null | 위치/좌표 범위 |
| `data_format` | string\|null | json/parquet/jsonl/duckdb/csv/vrf/blend 등 |
| `data_volume` | string\|null | 규모 |
| `schema_availability` | enum | `documented` \| `partial` \| `none` \| `unknown` |
| `download_status` | enum | README §3.2 status 값 중 다운로드 가능성 관련 |
| `api_availability` | enum | `yes` \| `no` \| `unknown` |
| `code_availability` | enum | `yes` \| `no` \| `unknown` |
| `status` | enum | README §3.2 전체 상태 분류 |
| `verification_level` | int(0-3)\|null | README §3.3 |
| `quality_notes` | string | 품질 메모 |
| `known_limitations` | string | 알려진 한계 |
| `project_relevance` | string | PROJECT V에서의 쓰임 |
| `verification_evidence` | string | 실제 검증 근거(수행한 명령/읽은 파일/응답) |
| `assigned_agent` | enum | `PV-1`(Research) \| `PV-2`(Data) \| `PV-3`(Simulation) \| `unassigned` |
| `provenance` | object\|null | 클론/수집한 경우 커밋 해시·수집 시각 |

## status_enum (README §3.2)

`VERIFIED_DOWNLOADABLE`, `VERIFIED_API`, `VERIFIED_SOURCE_CODE`, `VIEW_ONLY`,
`AUTH_REQUIRED`, `PAID_ACCESS`, `LICENSE_RESTRICTED`, `UNVERIFIED`, `DEPRECATED`,
`INACCESSIBLE`.

PV-2에 위임된 항목은 상태 문자열을 `PV-2_PENDING`으로 두고 `assigned_agent="PV-2"`로 표기한다.
(이는 README 표준 enum 외의 프로젝트 확장값이며, 검증 완료 시 표준값으로 교체한다.)

## verification_level_enum (README §3.3)

- `0` — 링크 확인(사이트/저장소 존재)
- `1` — 구조 확인(문서·파일 목록·스키마 확인)
- `2` — 실제 접근(API 응답 또는 데이터 파일을 실제로 읽음)
- `3` — 재현 완료(코드 실행 및 데이터 가공·검증 재현)
