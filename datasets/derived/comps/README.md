# datasets/derived/comps — 요원 조합 통계 (PV-1 소유)

실제 프로 경기 기반 맵별 요원 픽·조합·승률 통계 (Layer A, 위치 데이터 없음).

- `ascent-comps.json` — 국제전 Ascent 통계 (+ `ascent-comps.schema.json`)
- 출처: **VCT Reference DuckDB** (`https://vct-reference.com/dataset/vct.duckdb`, free to use incl. commercial, 출처 표기 권장). PV-2가 Level 2 검증한 소스.

## 재생성 (DB는 커밋하지 않음 — 매일 재빌드 + 용량)
```bash
# 1) DB 다운로드 (PV-2 스크립트 또는 직접)
curl -fSL https://vct-reference.com/dataset/vct.duckdb -o /tmp/vct.duckdb
# 2) 통계 생성 + 스키마 검증
python tools/catalog-builder/build_ascent_comps.py --db /tmp/vct.duckdb
pytest tools/catalog-builder -q   # 커밋된 json의 스키마 검증 포함
```

## 주의
- 레이트는 **맵 단위**, Wilson 95% CI. 표본 = 306 team-maps (153 maps).
- **패치 혼합**(Patch 2.09–13.05): 단일 빌드 기준 아님. Ascent는 경쟁 맵풀을 드나들어 현재 메타와 다를 수 있음.
- 원시 `.duckdb`와 `datasets/derived/priors/`(PV-2 소유)는 건드리지 않음.
- 상세·소비자 매핑: `docs/research/CATALOG.md` §3.10.
