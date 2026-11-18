# PROJECT V — `.vrf` 캡처 가이드 & 라이선스/정책 판단 (PV-6)

**기준일:** 2026-11-18 · **담당:** PV-6

이 문서는 ① 분석용 `.vrf` 리플레이를 **어떻게 확보해 이 세션에 올리는지**와 ②
`.vrf`·파서·거기서 나온 데이터의 **라이선스/Riot 정책 판단**을 다룬다.

> ⚠️ 이 문서는 법률 자문이 아니다. 아래 정책 판단은 공개 자료 기준의 **엔지니어링 가이드**이며,
> 상업적 배포 전에는 Riot 공식 약관을 직접 확인하거나 Riot에 문의해야 한다.

---

## 1. `.vrf`가 무엇이고 어디에 있나

- VALORANT **리플레이 시스템**은 공식 인게임 기능이다(패치 10.x대 정식 도입). 경기를 보면
  클라이언트가 로컬에 `.vrf` 파일을 쓴다.
- 위치(Windows):
  ```
  %LOCALAPPDATA%\VALORANT\Saved\Demos\
  ```
  (탐색기 주소창에 그대로 붙여넣기). 파일명은 경기 UUID + `.vrf`.
- `.vrf`는 **당신 PC의 로컬 파일**이다. 파서는 이 파일만 읽으며 Riot 서버(`pvp.net`)·API·
  로그인 토큰을 전혀 건드리지 않는다(네트워크·인증 불필요).
- 리플레이는 영구 보관용이 아니다: 경기가 match history에서 사라지면 리플레이도 만료될 수 있다.
  분석할 경기는 **빨리 복사해 둘 것**.

### Riot Developer API는 `.vrf`를 주지 않는다
README §4.1·Handoff §6대로, 공식 Riot API는 리플레이 파일 다운로드를 제공하지 않는다.
`.vrf`는 **오직 당신 PC의 Demos 폴더**에서만 나온다. 프로 경기 서버 사이드 데이터는 Riot×GRID
(파트너 자격) 경로이며 이 파이프라인과 별개다.

---

## 2. 권장: Ascent 커스텀 게임을 녹화하라

PROJECT V의 최초 검증 맵은 **Ascent**다(Handoff DECISION-009). 그리고 **커스텀/스크림**에서는
`.vrf`의 `ProfileName`이 보통 실제 Riot ID로 남지만, 경쟁전은 익명화된다(`Player N`,
`Imported Crosshair …`). 따라서:

**권장 캡처 절차**
1. VALORANT에서 **Ascent 커스텀 게임**을 만든다(본인/지인 5v5, 또는 봇 포함 테스트도 가능).
2. 리플레이가 켜져 있는지 확인하고 한 경기(또는 몇 라운드)를 진행한다.
3. 경기 후 `%LOCALAPPDATA%\VALORANT\Saved\Demos\`에서 가장 최근 `.vrf`를 복사한다.
4. 가능하면 **combat 라운드가 실제로 진행된 경기**를 고른다. (세리머니/서렌 직후 캡처는
   movement 데이터가 비어 있을 수 있다 — PV-6이 동봉 샘플에서 실제로 확인한 사례.)

> 참고: 저장소 동봉 테스트 샘플 2개 중 하나는 1인 movement만, 다른 하나는 세리머니뿐이라
> **완전한 5v5 궤적이 아니다.** Ascent 5v5 커스텀 1경기면 Layer-B(궤적) 검증 품질이 크게 오른다.

---

## 3. 이 세션에 `.vrf` 올리는 법

1. Claude Code(웹/앱) 대화창에 `.vrf` 파일을 **첨부**한다(드래그&드롭 또는 첨부 버튼).
   - `.vrf`는 수십 KB~수십 MB다. 큰 경기 파일은 업로드가 느릴 수 있다.
2. 올린 뒤 **한 줄 실행**(파서 바이너리가 준비돼 있을 때):
   ```bash
   PARSER=/path/to/ValorantReplayParser REDACT=1 \
     tools/replay-parser/run.sh <올린-파일>.vrf Ascent
   # → tools/replay-parser/output/<이름>/normalized.json
   ```
   파서 바이너리 빌드는 `docs/research/replay-parser.md` §2(Linux build) 참고.
3. 산출물(`normalized.json`)은 게임 좌표·ms 시간축·라운드 분할·provenance가 붙은 Layer-B 데이터다.

---

## 4. 개인정보(Privacy) 주의 — `ProfileName`

- `.vrf`의 `BombPlayerState.ProfileName`에는 **커스텀/스크림에서 실제 Riot ID**가 들어갈 수 있다.
  (PV-6이 동봉 샘플에서 실명성 값 1건을 실제로 확인했다.)
- `.vrf`에 **없는** 것: 이메일·실명·결제정보 등. 하지만 Riot ID + 위치 궤적의 조합은
  **개인 식별 정보**로 취급해야 한다.
- 기본값은 **익명화**다: `run.sh`는 `REDACT=1`을 권장하며, `normalize({ redactProfileNames:true })`가
  `profileName`을 `null`로 만든다(팀 인덱스·PlayerId는 유지).
- 본인/동의한 지인의 커스텀 경기만 **비익명으로 보관**하라. 타인의 경기 데이터를 식별 가능한
  상태로 **공유/배포하지 말 것**. 학습 데이터로 쓸 때도 식별자는 제거한다(Handoff §13.2·§22와 정합).

---

## 5. 라이선스 & Riot 정책 판단

### 5.1 파서/뷰어 코드 라이선스 (오픈소스)

| 프로젝트 | 라이선스 | 이 프로젝트에서의 사용 |
|---|---|---|
| `talhakoek/ValorantWebReplayer` | **MIT** | 추출 로직 참고·Linux 이식(재구현). 귀속 표기 유지. |
| `talhakoek/ValorantReplayParserPlayground` (fork) | 상류 `FortniteReplayDecompressor` 계열(레포 `LICENSE`) | Linux에서 빌드해 디코더로 사용(바이너리 미커밋). |
| `michel-giehl/ValorantReplayParser` | NuGet alpha(상류) | 의미 교차검증 레퍼런스. |
| `yakisoba0728/vrfkit` | **Apache-2.0** | 1순위 후보(cargo 차단으로 L3 보류). NOTICE.md 준수. |

→ 모두 **코드** 라이선스다. 재배포 시 각 라이선스의 귀속·고지 요건을 지키면 된다. PV-6은 이들을
**클론만 하고 저장소에 커밋하지 않았다.**

### 5.2 `.vrf` 파일과 경기 데이터 (Riot 정책)

확인된 사실과 판단:
- `.vrf`는 **공식 리플레이 기능이 당신 PC에 생성한 로컬 파일**이다. 파서는 로컬 파일만 읽고
  Riot 서버·API·인증을 사용하지 않는다 → **클라이언트 해킹/서버 우회와는 범주가 다르다.**
- 그러나 **공개 웹검색으로는 "로컬 `.vrf` 파싱 허용"을 명시한 Riot 약관 조항을 찾지 못했다.**
  즉 "명시적으로 금지"도 "명시적으로 허용"도 공개 문서에서 단정할 수 없다.
- Riot의 일반 입장(공개 자료 기준): 비상업·팬 콘텐츠·개인 분석에는 관대하나, VALORANT/로고 등
  **상표·자산 사용**과 **공식/후원 사칭**, **타 이용자 데이터의 식별 가능한 재배포**에는 제약이 있다.
- GRID 경로(프로 경기)는 **Riot 후원 파트너 프로그램**으로 별개다. 그것이 "로컬 `.vrf` 파싱"의
  허용 근거가 되지는 않는다.

**PV-6 권고(보수적):**
1. **본인(및 동의한 참가자)의 로컬 커스텀/스크림 `.vrf`만** 분석에 사용한다.
2. 산출 데이터에서 **식별자(ProfileName)를 기본 제거**한다(§4).
3. VALORANT 상표·에셋·아이콘을 제품에 포함하거나 **Riot 공식/후원으로 오인될 표현을 쓰지 않는다**
   (업스트림 뷰어의 "Not affiliated with Riot Games" 고지를 따른다).
4. 데이터를 **공개 배포하지 않는다**(내부 연구/시뮬레이션 검증용). 공개·상업화 전 Riot
   **Terms of Service / Legal Jibber Jabber / Developer Policy**를 직접 재확인하거나 Riot에 문의한다.
5. LICENSE_AUDIT(향후)에 위 코드 라이선스와 이 데이터 정책 판단을 반영한다.

---

## 6. 참고 링크 (검증 상태)

- Riot 리플레이 FAQ: https://support.riotgames.com/ (Replays FAQ & Pro Tips) — `/demo/` 폴더에서
  수동 삭제 가능 언급(만료성 확인).
- 공식 소개: https://playvalorant.com/en-us/news/dev/replays-everything-you-need-to-know
- 커뮤니티 파서(참고): ValorantReplayParser (NuGet, experimental) — 정책 언급 없음.
- Riot ToS / 개발자 정책(상업화 전 필독): https://developer.riotgames.com/policies/general ·
  https://developer.riotgames.com/policies/game-specific

> 위 링크의 정책 요약은 공개 2차 자료 기준이며, **로컬 `.vrf` 파싱에 대한 Riot의 명시적 허가/금지
> 조항은 공개 검색에서 확인되지 않았다**는 점을 분명히 기록한다(UNVERIFIED).
