# datasets/catalog — 게임 데이터 카탈로그

시뮬레이션 엔진이 바로 소비하는 정규화된 요원·무기·스킬·장비 카탈로그.
기준 빌드 **release-13.10** (valorant-api `/v1/version`로 직접 확인, 2026-11-18).

## 레이아웃
```
datasets/catalog/
├── schema/                     # JSON Schema (커밋됨) — 내가 작성한 스펙
│   ├── weapon.schema.json
│   ├── agent.schema.json
│   ├── ability.schema.json
│   ├── equipment.schema.json
│   └── provenance.schema.json
├── .gitignore                  # release-*/ (생성 데이터) 커밋 제외
└── release-13.10/              # 생성 데이터 (커밋 안 함, 로컬 재생성)
    ├── raw/{version,weapons,agents}.json   # provenance용 원본 API 응답
    ├── weapons.json   agents.json
    ├── abilities.json equipment.json
```

## 왜 데이터는 커밋하지 않는가
valorant-api.com의 라이선스가 명시되어 있지 않고, 데이터는 Riot 게임 자산에서 파생된다.
합의된 규칙("라이선스 불명확 시 수집 스크립트만 커밋")에 따라 **스크립트 + 스키마 + 문서만 커밋**하고,
데이터는 아래 명령으로 로컬에서 재생성한다.

```bash
python tools/catalog-builder/build_catalog.py            # 라이브 수집 + 검증
python tools/catalog-builder/build_catalog.py --offline  # 캐시된 raw/로 재생성
pytest tools/catalog-builder -q                          # 단위 테스트 + 스키마 검증
```

## 규칙
- 필드명 **camelCase**, 시간 **ms**, 거리 **m**. (VALORANT 1 m = 100 Unreal 단위; vrfkit 리플레이 위치는 cm.)
- 모든 레코드에 `provenance`(source·patch·retrievedAt·verified) 부착.
- **valorant-api에 없는 값(스킬 비용/충전/쿨다운/궁극포인트/지속/타입태그, 실드·스파이크 상수)은
  `null` + `verified:false`로 둔다.** 공식 패치노트/위키에서 출처 URL과 함께 확인된 값만 채운다.
  추정값을 사실처럼 넣지 않는다 (Handoff §29 / README §37).

상세 출처·검증 수준은 [`../../docs/research/CATALOG.md`](../../docs/research/CATALOG.md).
