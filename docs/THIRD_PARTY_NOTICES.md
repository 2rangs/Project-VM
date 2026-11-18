# PROJECT V — Third-Party Notices (draft)

**작성:** PV-1 Research (8차 사전 통합 감사) · **기준일:** 2026-11-18

PROJECT V(루트 LICENSE: MIT, © 2026 Kim Yi Rang)가 포함·파생·의존하는 제3자 자료의 고지 초안.
통합(머지) 시 저장소 루트에 포함할 것. 각 항목은 전 브랜치(`origin/claude/pv-*`)의 실제 커밋을 읽고 작성.

> 데이터/게임 자산 주의: 아래 코드 라이선스는 **코드에만** 적용된다. VALORANT 게임 자산·맵 지오메트리·
> 요원/무기 수치·경기 데이터의 원 저작권은 Riot Games에 있으며, 코드 라이선스가 그 재배포 권리를 부여하지 않는다.

---

## 1. 포팅/재구현된 코드 (고지 필수)

### ValorantWebReplayer — MIT © 2026 Talha Kök and contributors
- https://github.com/talhakoek/ValorantWebReplayer
- **사용처:** `pv-replay` `tools/replay-parser/src/extract.mjs` 상단 주석에 명시 — "Reimplementation of talhakoek/ValorantWebReplayer scripts/extract-stream.mjs, ported to run on Linux and refactored."
- **조치:** MIT 라이선스 전문 + 저작권 고지를 본 파일에 동반(현재 출처 주석은 있으나 라이선스 전문 미동반 → 추가 권장).

### ValorantReplayParser — MIT © 2026 Michel Giehl
- https://github.com/michel-giehl/ValorantReplayParser
- **사용처:** `pv-replay`가 **외부 도구**로 사용(`PARSER=/path/to/ValorantReplayParser`, `--verbose --full` 출력 디코드). VRF 포맷·출력 스키마 이해의 기반. **바이너리/소스는 저장소에 미커밋**(확인됨).
- **조치:** 외부 도구 사용·포맷 기반 출처로 MIT 고지. 빌드 지침은 pv-replay README에 존재.

## 2. 런타임 의존성 (npm; 저장소에 소스 미벤더링)

### recast-navigation-js 0.44.0 — MIT
- Recast & Detour(원저작 Mikko Mononen) 바인딩, 원본은 **zlib 라이선스**.
- **사용처:** `pv-mapmesh` `pv-ascent-navmesh`(`dependencies: recast-navigation`). NavMesh `.bin` 산출물은 **gitignore**(파생물, 미커밋). 출처는 `ascent-navmesh-stats.json`에 명시.
- **조치:** recast-navigation(MIT) + Recast/Detour(zlib) 고지.

### 기타 npm 런타임 (각자 라이선스)
- `pv-replay` 뷰어: pixi.js, react, react-dom, vite, @vitejs/plugin-react (전부 MIT).
- 공통 개발: typescript, vitest, tsx, @types/* (Apache-2.0/MIT).
- → `package-lock.json`의 의존성 트리가 정본. 배포 번들 시 각 라이선스 고지 포함.

## 3. 데이터 출처 (사실·수치; 코드 라이선스와 별개)

| 출처 | 조건 | 저장소 반영 |
|---|---|---|
| **VCT Reference** (vct-reference.com) | Free to use incl. commercial, **출처 표기 권장** | 원시 `.duckdb` 미커밋; 소형 파생(정규화·comps·ratings)만 커밋 → **출처 표기 추가 권장** |
| **valorant-api.com** | 라이선스 **불명확** | 대량 생성 카탈로그 **gitignore**(스크립트·스키마·소싱테이블만 커밋) |
| **공식 VALORANT 위키 / 패치노트 / Riot content API** | Riot 소유 사실 | 수치·패치 출처 URL만 기록, 자산 미재배포 |
| **PV-4 navgraph 파생**(pv-research tactics) | 내부 산출물 | 출처 표기(미러) |

## 4. 비제휴 고지
PROJECT V is not affiliated with, endorsed by, or sponsored by Riot Games. VALORANT and related
assets are trademarks/property of Riot Games, Inc.

---
*이 문서는 PV-1이 전 브랜치를 읽기 전용으로 감사해 작성한 초안이다. 머지 담당(오케스트레이터)이 최종본으로 확정한다.*
