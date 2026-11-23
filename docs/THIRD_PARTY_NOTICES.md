# PROJECT V — Third-Party Notices

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
- `apps/desktop` 경기 화면 팀 캠(3D): three, three-mesh-bvh (둘 다 MIT). 선수 모델·1인칭 뷰모델은 three.js로 직접 만든 오리지널 도형이며, 게임 캐릭터·무기·스킨 에셋이나 외부 3D 에셋은 쓰지 않는다. 맵 메시는 사용자가 제공한 `.blend`의 파생물로 git에 넣지 않는다(`apps/desktop/assets/maps/` gitignore).
- 공통 개발: typescript, vitest, tsx, @types/* (Apache-2.0/MIT).
- → `package-lock.json`의 의존성 트리가 정본. 배포 번들 시 각 라이선스 고지 포함.

## 3. 데이터 출처 (사실·수치; 코드 라이선스와 별개)

| 출처 | 조건 | 저장소 반영 |
|---|---|---|
| **VCT Reference** (vct-reference.com) | Free to use incl. commercial, **출처 표기 권장** | 원시 `.duckdb` 미커밋; 소형 파생(정규화·comps·ratings)만 커밋 → **출처 표기 추가 권장** |
| **valorant-api.com** | 라이선스 **불명확** | 대량 생성 카탈로그 **gitignore**(스크립트·스키마·소싱테이블만 커밋) |
| **공식 VALORANT 위키 / 패치노트 / Riot content API** | Riot 소유 사실 | 수치·패치 출처 URL만 기록, 자산 미재배포 |
| **PV-4 navgraph 파생**(pv-research tactics) | 내부 산출물 | 출처 표기(미러) |
| **valorant-api.com** `/v1/maps` (10개 맵 콜아웃·미니맵 변환, 2026-11-19) | 라이선스 **불명확** | Ascent와 동일하게 맵별 원본 콜아웃 JSON만 커밋 (`datasets/spatial/<map>/valorant-api-<map>.raw.json`) |
| **사용자 제공 VALORANT Blender 맵** (Riot Games 지오메트리) | 재배포 라이선스 **미확인** | 원본·추출 메시·워크 그리드 **미커밋**. 커밋되는 것은 측정 수치(JSON), 그래프 도식 PNG (`docs/research/MAPS_DATA.md`), 그리고 사용자 결정(2026-11-20)에 따른 내비게이션 로드맵(`<map>.nav.json`: 점·선분)과 지점 간 시야 표(`<map>.vis.json`: 쌍당 1비트) — 표면 지오메트리는 없음 (`docs/LICENSE_AUDIT.md` §2.0b) |

## 4. 비제휴 고지
PROJECT V is not affiliated with, endorsed by, or sponsored by Riot Games. VALORANT and related
assets are trademarks/property of Riot Games, Inc.

---
*Finalized at integration (PV-3 integration lead, 2026-11-18) from PV-1 PRE_MERGE_AUDIT; items [A]-[F] processed. License texts below.*

---

## 5. License texts

### MIT License
Applies to: ValorantWebReplayer (© Talha Kök and contributors), ValorantReplayParser
(© Michel Giehl), recast-navigation-js, and the MIT-licensed npm runtime/dev dependencies
listed above.

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### zlib License
Applies to: Recast & Detour (© 2009 Mikko Mononen memon@inside.org), the native library
wrapped by recast-navigation-js.

```
This software is provided 'as-is', without any express or implied warranty.
In no event will the authors be held liable for any damages arising from the
use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it freely,
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
   that you wrote the original software. If you use this software in a product,
   an acknowledgment in the product documentation would be appreciated but is
   not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```
