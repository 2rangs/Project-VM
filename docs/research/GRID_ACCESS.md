# GRID Riot Open Access — 접근 조사 (Layer B 인가 경로)

**작성:** PV-1 Research (5차) · **기준일:** 2026-11-18 · **상태:** 조사 완료, **신청은 하지 않음(사용자 판단 사항)**

PROJECT V가 프로 경기 이벤트/위치 데이터(Layer B)를 **합법적으로** 얻을 수 있는 공식 경로인
**Riot Games Open Access (powered by GRID Esports)**를 공식 문서 기준으로 정리한다.
확인한 출처는 아래 §6. 추측은 `확인 필요`로 표시한다.

---

## 1. 요약 (한 문단)
Riot Games Open Access는 **2026-11-12 출시**된, 공식 LoL·VALORANT e스포츠 인게임 데이터를
**무료 API 키**로 제공하는 커뮤니티용 프로그램이다. 학생·연구자·취미 개발자·초기 단계 프로젝트
대상의 **비상업** 용도이며, **데이터는 지연(delayed)** 제공된다. 상업용은 GRID Sales를 통한
**별도 유료 라이선스**다. VALORANT 피드는 라운드 경제·요원 스킬/궁극·스파이크 이벤트·로드아웃·
클러치 확률·요원 픽/조합을 제공하지만, **10인 시점별 위치(좌표) 텔레메트리는 공개 설명에 없음**
(= Layer B 핵심인 per-tick 위치는 확인되지 않음 → §4).

## 2. 무료(Open Access) vs 상업 라이선스
| | **Open Access (무료)** | **Commercial licence** |
|---|---|---|
| 대상 | 학생·학계·취미 개발자·초기 단계 프로젝트 | 상업 제품 |
| 용도 | 비상업(학습·실험) | 상업 |
| 데이터 속도 | **지연(delayed)** — 게임 무결성 보호 | 브로드캐스트 속도 |
| 금지 | **베팅/도박 용도 금지** | 계약 범위 내 |
| 지원 | 문서 + Discord(커뮤니티), 전용 지원 없음 | GRID Sales 협의 |
| 비용 | 무료 | 사용 사례별 맞춤 가격 |
| 신청 | Sign in → 무료 키 발급 → Build | GRID Sales 문의 |

## 3. 제공 데이터 (VALORANT)
공식 설명 기준 포함:
- 라운드 경제(round economy)와 무기 구매(weapon spend)
- 요원 스킬·궁극기 사용과 타이밍(agent abilities, ultimates, timings)
- 스파이크 설치·해체 상태/이벤트(spike plant/defuse states & events)
- 플레이어 로드아웃(loadouts)
- 클러치 확률·라운드 예측(clutch probability / round forecasts)
- 요원 선택·조합·스킬 사용(agent selection, composition, ability usage) — 실시간 추적
- 하나의 스키마로 정규화(GRID 포트폴리오 공통 스키마)

**피드 구성(두 타이틀, 하나의 키):** VALORANT Esports **Central Data Feed**, **Series State API**,
**Loopfeed** (LoL도 동일 3종). 각 피드의 정확한 필드는 docs.grid.gg 문서에서 확인(§4·§6).

## 4. Layer B(위치) 관련 — 핵심 확인 사항
- **공개 VALORANT 데이터 설명에 "player position / coordinate / per-tick / minimap" 항목이 없다.**
  경제·스킬·스파이크·로드아웃·클러치 등 **이벤트/상태 데이터** 위주로 보인다.
- 따라서 **GRID Open Access가 10인 시점별 위치 좌표(Layer B)를 제공하는지는 미확인**이며, 공개
  설명만으로는 **제공하지 않을 가능성이 높다**(README §4.2 주의와 일치). C9 Gameplan도 위치는
  GRID **포털의 이벤트 JSONL + 파트너 자격**에서 얻었고 API는 메타데이터만이었다(SOURCES.md 참조).
- **확인 필요(사용자/PV-2):** 무료 키 발급 후 Series State API/Central Data Feed/Loopfeed 응답에
  좌표·이동 필드가 있는지 실측. 없으면 위치는 `.vrf`(vrfkit, 사용자 캡처) 또는 상업 라이선스/파트너
  피드로만 가능.

## 5. 신청 준비물 체크리스트 (사용자용 — 신청은 사용자가 직접)
- [ ] GRID 계정으로 **Sign in** (https://grid.gg/riot-open-access/ → "Get your free API key")
- [ ] 자격 확인: 비상업(학습/실험/연구/초기 단계) 용도에 해당하는지
- [ ] **이용약관**(https://grid.gg/legal/terms-of-service/)과 **개인정보 처리방침**
      (https://grid.gg/legal/privacy-policy/) 검토 — 특히 재배포·저장·표기 조건
- [ ] **무료 키 발급** 후 안전 보관: 키는 **환경 보안 저장소**에 저장(코드/커밋/로그에 남기지 않음;
      이 프로젝트는 프록시 주입 방식 사용 — Riot API처럼 `proxy-injected` 자리표시자)
- [ ] 문서(https://docs.grid.gg/public/documentation)에서 3개 피드 스키마·레이트 리밋·지연 시간 확인
- [ ] (의사결정) **위치 좌표 제공 여부**를 무료 티어에서 실측 — 없으면 Layer B는 `.vrf` 경로로
- [ ] 베팅/도박·상업 용도 아님을 확인(Open Access 금지 조항)
- [ ] 상업화 계획이 있으면 Open Access가 아닌 **GRID Sales 상업 라이선스** 경로

> **주의:** 신청·키 발급은 **사용자 판단 사항**이다. 이 에이전트는 신청하지 않았다. GRID Sales는
> Open Access 가입/기술 질문을 돕지 않으므로, 가입·기술은 문서와 Discord를 사용한다.

## 6. 확인한 출처 (fetch 2026-11-18)
- https://grid.gg/riot-open-access/ (HTTP 200) — 출시일·자격·무료/상업 비교·3단계·피드 구성
- https://grid.gg/data/games/valorant/ (HTTP 200) — VALORANT 제공 데이터·FAQ(요원 픽/조합/스킬)
- https://docs.grid.gg/public/documentation — 피드 문서(JS 앱, 상세 필드는 브라우저 필요)
- https://grid.gg/legal/terms-of-service/ , https://grid.gg/legal/privacy-policy/ — 약관/개인정보

## 7. PROJECT V 반영
- **Layer A(통계)**: 이미 VCT Reference로 충분(§comps). GRID는 보강용.
- **Layer B(위치)**: GRID Open Access로 **위치 확보 가능성 불투명** → 1순위는 사용자 `.vrf` + vrfkit.
  GRID는 경제·스킬·스파이크·로드아웃 **이벤트** 보강에 유용(무료, 비상업).
- 레지스트리(`datasets/registry/sources.json`)의 `grid-open-access` 항목을 이 조사로 갱신(아래 커밋).
