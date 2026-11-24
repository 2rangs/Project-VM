# PROJECT V 데스크톱 — 한글화 용어집 (GLOSSARY_KO)

데스크톱 UI(`apps/desktop`)의 한국어 기본 표기 기준. i18n 사전은
`src/renderer/i18n/ko.ts`(기본)·`en.ts`(영어)이며, 화면은 `t('key')`로 문자열을
해석한다. 언어 전환은 **정보(About)** 화면에서 가능하고 `localStorage`에 유지된다.

## 번역 원칙

- **일반 UI 용어는 한국어**로 옮긴다(메뉴, 버튼, 패널 제목, 지표 이름, 빈 상태, 오류 등).
- **게임 고유명사·e스포츠 통용어는 원어/관용 표기를 유지**한다:
  요원 이름, 맵 이름, 무기(Vandal, Phantom, Operator …), 선수 핸들, 팀 이름.
- **엔진이 내보내는 전략 ID**(`A_EXECUTE` 등)는 UI에서 한국어 라벨로 매핑한다
  (`strategyLabel()` + `strategy.*` 키). 디버거 표의 원시 ID는 디버그 편의상 유지.
- 데이터(JSON)에서 온 문자열(트레이스 rationale, 구역 id, 분류 등)은 엔진 산출물이라
  번역하지 않고 그대로 노출한다.

## 메뉴 / 내비게이션

| 원어 | 한국어 |
| --- | --- |
| Match Day | 경기일 |
| Tactics | 전술 |
| Agent Select | 요원 선택 |
| Map Veto | 맵 밴 |
| Squad | 선수단 |
| Opponent Report | 상대 분석 |
| Inbox | 수신함 |
| Schedule | 일정 |
| Finance | 재정 |
| Transfers | 이적 |
| Training | 훈련 |
| Scouting | 스카우팅 |
| Decision Debugger | 결정 디버거 |
| About | 정보 |

## 경기 / 시뮬레이션 용어

| 원어 | 한국어 |
| --- | --- |
| Fog of war | 전장의 안개 |
| Belief heatmap | 벨리프 히트맵 |
| Ground truth | 진실 시점 |
| Observed enemies / ghost / sound zone | 관측된 적 / 고스트 / 소리 구역 |
| Economy | 경제 |
| Ultimates | 궁극기 |
| Coach note | 코치 노트 |
| Round results | 라운드 결과 |
| Economy timeline | 경제 타임라인 |
| Key decisions | 핵심 결정 |
| Match MVP | 경기 MVP |
| Post-match full view | 경기 후 전체 시점 |
| Event feed | 이벤트 피드 |

### 라운드 종료 사유 (`reason.*`)

| 원어 | 한국어 |
| --- | --- |
| elimination | 전멸 |
| spikeDetonation | 스파이크 폭발 |
| spikeDefused | 해제 |
| timeExpired | 시간 초과 |

### 경제 콜 / 매수 유형 (`buy.*`)

| 원어 | 한국어 |
| --- | --- |
| pistol | 피스톨 |
| full | 풀바이 |
| force | 포스 |
| eco | 에코 |
| save | 세이브 |
| half | 하프바이 |

### 전략 ID → 한국어 라벨 (`strategy.*`)

| 엔진 ID | 한국어 |
| --- | --- |
| A_EXECUTE / B_EXECUTE / C_EXECUTE | A·B·C 사이트 실행 |
| MID_CONTROL | 미드 컨트롤 |
| DEFAULT | 디폴트 |
| SPLIT / SPLIT_A / SPLIT_B | 스플릿 / A 스플릿 / B 스플릿 |
| FAST_A / FAST_B | A 패스트 / B 패스트 |
| DEFENSE_DEFAULT | 수비 기본 |
| STACK_A / STACK_B | A 스택 / B 스택 |
| AGGRO_PUSH | 공격적 푸시 |
| RETAKE / ROTATE | 리테이크 / 로테이트 |
| SAVE / FORCE / FULL_BUY / ECO | 세이브 / 포스 / 풀바이 / 에코 |

> 새 전략 ID가 엔진에 추가되면 `strategy.<ID>` 키를 `ko.ts`·`en.ts`에 넣는다.
> 키가 없으면 `strategyLabel()`이 원시 ID로 폴백한다.

## 인터랙티브 경기 / 전술 타임아웃

| 원어 | 한국어 |
| --- | --- |
| One-shot match | 한 번에 경기 |
| Interactive (round by round) | 인터랙티브 (라운드 진행) |
| Next round | 다음 라운드 |
| Auto-play | 자동 진행 |
| Tactical timeout | 전술 타임아웃 |
| Coach orders | 전술 지시 |
| Situation | 상황 요약 |
| Timeout log | 타임아웃 로그 |
| by coach / AI | 감독 / AI |

### 지시 전략 (`ostrat.*`, 공격/수비)

| 엔진 order | 한국어 |
| --- | --- |
| aExecute / bExecute | A 실행 / B 실행 |
| midControl | 미드 컨트롤 |
| default | 디폴트 |
| split | 스플릿 |
| defaultHold | 수비 기본 |
| stackA / stackB | A 스택 / B 스택 |
| aggroPush | 공격적 푸시 |

### 경제 콜 (`oecon.*`) · 템포 (`otempo.*`)

| 원어 | 한국어 |
| --- | --- |
| save / force / full | 세이브 / 포스 / 풀바이 |
| slow / normal / fast | 슬로우 / 노멀 / 패스트 |

## 라운드별 판단 (경기 후 리뷰) · 경기 옵션

| 원어 | 한국어 |
| --- | --- |
| Round decisions | 라운드별 판단 |
| Read of the opponent (going in) | (들고 들어간) 상대 리딩 |
| Where they attack / defend | 상대 공격 방향 / 상대 수비 배치 |
| Confidence: none / low / medium / high (`conf.*`) | 근거 없음 / 신뢰도 낮음 / 보통 / 높음 |
| Samples | 표본 |
| Opening call / Final call | 오프닝 콜 / 최종 콜 |
| Objective site | 목표 사이트 |
| Fake (feint) | 페이크 |
| Plan changes (revisions) | 플랜 수정 |
| {m:ss} left (round clock) | {m:ss} 남음 |
| Read was right / wrong / untested | 리딩 적중 / 빗나감 / 확인 불가 |
| Plant / first contact | 스파이크 설치 / 첫 교전 |
| Used the read / against the read | 리딩 활용 / 리딩과 반대 |
| Attack / Defense (`side.*`) | 공격 / 수비 |
| Pistol / Regulation / Overtime (`phase.*`) | 피스톨 / 정규 / 연장 |
| Match options | 경기 옵션 |
| Opponent memory | 상대 기억 |
| Minimum throw rate | 최소 쓰로잉률 |

라운드별 판단의 콜 이름은 지시 전략과 같은 `ostrat.*` 키를 쓴다. 엔진 `TeamStrategy`
전체를 덮도록 다음이 추가되었다:

| 엔진 id | 한국어 |
| --- | --- |
| fakeAtoB / fakeBtoA | A 페이크 → B / B 페이크 → A |
| lurkDefault | 러크 디폴트 |
| save | 세이브 |
| retake | 리테이크 |
| `<call> (slow)` | `<콜>` (슬로우) |
| `commit A` / `commit B` | A 사이트 확정 / B 사이트 확정 |

> 플랜 수정의 **사유(reason)** 는 엔진이 영어 문장으로 만든다. `src/renderer/decision-reasons.ts`가
> 그 문장을 풀어 `rev.dec.reason.*` 키로 한국어·영어로 표시한다(모르는 문장은 원문 그대로).

### 플랜 수정 사유 (`rev.dec.reason.*`) · 로테이션 콜

| 엔진 문장 | 한국어 |
| --- | --- |
| spike planted — retake call | 스파이크가 설치됨 — 리테이크 콜 |
| A is stacked — swing to B | A에 수비가 몰려 있음 — B로 전환 |
| clock — commit with the information gathered | 시간이 없음 — 지금까지 모은 정보로 사이트 확정 |
| player advantage 4v2 — hit while they are short | 인원 우위 4대2 — 상대가 부족할 때 진입 |
| man count even again (3v3) — play it out | 인원이 다시 동률 (3대3) — 라운드를 이어감 |
| round lost 1v3 before the plant (…) — save | 설치 전 1대3로 밀림 (승산 4% < 기준 10%) — 세이브 |
| … leaves the angle to chase the exit kill | … 각을 버리고 엑시트 킬을 노림 |
| N runners heard / N seen on A | A에서 N명 발소리 / A에서 N명 목격 |
| with contact · contact on B · no contact on B · 2 on B | (교전 중) · B도 교전 · B는 조용함 · B에 2명 |
| P(hit A) 0.62, fake 0.11 | A 진입 확률 62% · 페이크 11% |
| rotate 2 · stand down, hold | 2명 로테이트 · 로테이션 해제, 홀드 |
| `stack A ×3` · `support B ×1` · `hold` (콜) | A 스택 ×3 · B 지원 ×1 · 홀드 |
| cExecute · stackC | C 실행 · C 스택 |

## 원어 유지 (번역하지 않음)

- 요원: Jett, Sova, Killjoy, Omen … (한글 음차하지 않음)
- 맵: Ascent, Bind, Haven …
- 무기: Vandal, Phantom, Operator, Spectre, Classic …
- 선수 핸들·팀 이름: NRG, Team Heretics, TenZ … (실명/실팀, 사용자 결정)
- 역할 문자열(controller, duelist …)·구역 id(a-site, mid …)는 엔진 데이터라 유지.
