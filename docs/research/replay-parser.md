# PROJECT V — Replay Parser (PV-6)

**기준일:** 2026-11-18 · **담당:** PV-6 Replay Parser 에이전트 · **브랜치:** `claude/pv-replay`

README §08(실제 리플레이 파싱)·Handoff §7의 리플레이 파서 작업. PV-1의
`docs/research/CORE_SOURCE_VERIFICATION.md`(L1 소스 검증)를 이어받아, **Linux에서 파서를
실제로 빌드·실행(L3)** 하고 Linux용 추출 파이프라인(`tools/replay-parser/`)을 구현했다.

외부 저장소는 `/tmp/pv-clones/`에 클론했고 **PROJECT V 저장소에는 커밋하지 않았다.**
빌드 산출물(.NET publish, `decode-full.txt`)도 커밋하지 않았다.

---

## 1. 요약 (중요 결과)

| 항목 | 결과 |
|---|---|
| **ValorantReplayParser (C#/.NET 10) Linux 빌드** | ✅ **성공** (`dotnet publish -r linux-x64 --self-contained`, exit 0) |
| **실제 `.vrf` 디코딩 (L3)** | ✅ **성공** — 저장소 동봉 샘플 2개를 Linux에서 디코딩 |
| **vrfkit (Rust) `cargo build`** | ❌ **환경 권한 분류기가 차단** (컴파일 오류 아님) |
| **Linux 추출 파이프라인** | ✅ 구현+테스트 완료 (`tools/replay-parser/`, 단위테스트 7/7 통과) |
| **합성 fixture 단위테스트** | ✅ 통과 (실데이터 불필요) |
| **실데이터 end-to-end 검증** | ✅ 내 파이프라인으로 실제 `.vrf` → `normalized.json` 재현 |

**핵심 발견:** `talhakoek/ValorantReplayParserPlayground @ revamped-channel-hooks`
저장소의 `src/ValorantReplayParser/Replays/`에 **실제 `.vrf` 샘플 2개가 동봉**되어 있다
(410KB, 562KB). 덕분에 사용자 `.vrf` 없이도 전체 파이프라인을 L3로 검증할 수 있었다.
단, 이들은 **짧은 테스트 캡처**(1 combat 캡처 + 1 ceremony 캡처)이지 완전한 5v5 경기는 아니다.

---

## 2. Linux build — 실제 수행 내역

### 2.1 ValorantReplayParser (C#) — ✅ 성공

클론(읽기 전용):
```bash
git clone -b revamped-channel-hooks https://github.com/talhakoek/ValorantReplayParserPlayground.git
```

.NET 10 SDK는 컨테이너에 없어 직접 설치(`dotnet-install.sh --channel 10.0`, 10.0.404).
그다음:
```bash
dotnet publish src/ValorantReplayParser/ValorantReplayParser.csproj \
  -c Release -r linux-x64 --self-contained true /p:PublishSingleFile=true -o <out>
```
→ `warning`만 발생, **exit 0**, 74MB 단일 실행 파일 생성.

**필요한 패치 1건:** `Program.cs`의 `channelOutPath`가 Windows 절대경로
(`C:\Users\Barrage\replay-work\channels.jsonl`)로 하드코딩되어 있어 Linux에서 쓰기 실패.
`VRP_CHANNELS` 환경변수 > `./channels.jsonl`(CWD) 순으로 읽도록 **클론 로컬에서만** 수정
(커밋하지 않음). upstream에 올린다면 이 한 줄이 Linux 호환의 전부다.

### 2.2 실제 `.vrf` 디코딩 (L3) — ✅ 성공

```bash
VRP_CHANNELS=channels.jsonl ./ValorantReplayParser <sample>.vrf --verbose --full > decode-full.txt
```

| 샘플 | parse 시간 | decode-full.txt | 내용 |
|---|---|---|---|
| `5c673443…vrf` (410KB) | 409 ms | 3.5 MB | **combat 캡처** — 2949 movement 라인, 3001 샘플, 23 phase, 470 BombGameState, 1 플레이어(`GiM dot`, team 1) |
| `c96127a8…vrf` (562KB) | 553 ms | — | **ceremony 캡처** — movement 0, Thrifty/TeamAce/Flawless ceremony·SurrenderVote 액터만 |

decode-full.txt 라인 포맷(실측):
```
Chindex=<ch>\tType=<Type>\tFields=<JSON 배열>
```
(사이에 `info:` 로거 노이즈가 섞이며, 추출기는 `^Chindex=`로 앵커링해 무시한다.)

실측 movement 구조(핵심):
```
Type=ReplaysClientReceiveRemoteCharacterUpdatesSingleArrayNoAutonomous
  Fields[0].Value[i] = { ShooterCharacterNetGuidValue, ComponentDataStream.Moves[j] }
  Moves[j] = { Timestamp(128Hz tick), Position{X,Y,Z,ScaleFactor:100}, Yaw(도), RotationInput{Z} }
```
**중요 교정:** upstream `extract-stream.mjs`는 yaw를 `RotationInput.Z`에서 읽는데
실제 덤프에서 그 값은 **0**이고, 실제 조준각은 `mv.Yaw`(도)에 있다. 내 추출기는 `mv.Yaw`를
우선 사용한다(예: 첫 샘플 `facingDeg=142.06`).

### 2.3 vrfkit (Rust) — ❌ 환경 차단 (컴파일 실패 아님)

```bash
git clone https://github.com/yakisoba0728/vrfkit.git   # ✅ 클론 성공
cargo build --release -p vrfkit --locked               # ❌ 차단
```
전경·배경 모두 시도했으나 양쪽 다 다음으로 거부됨:
> `Permission for this action was denied by the Claude Code auto mode classifier.
> Reason: [Unauthorized Access].`

즉 **MSRV/코드 문제가 아니라 환경의 권한 분류기가 외부 클론 저장소의 빌드 툴 실행을 차단**한 것.
PV-1이 "이전 세션에서 cargo가 막혔다"고 보고한 것과 동일 증상이다. (대조적으로 `dotnet publish`는
허용되어 통과했다 — 분류기 판정이 명령별로 다르게 나온다.)
vrfkit은 소스/문서상 가장 성숙한 파서(Parquet 13테이블, 1,018 리플레이 검증, 빌드별 지원표)로,
cargo 실행만 허용되면 1순위 후보다. **차단 해제 시 `cargo build --release -p vrfkit --locked`
→ `vrfkit export <x>.vrf --out <dir>`로 재시도할 것.**

---

## 3. 파서 평가 (README §8.2 체크리스트) — Linux L3 반영

PV-1의 L1 표를 **실제 Linux 실행 결과로 갱신**. `✅`=확인, `◐`=부분/파생, `❌`=미제공, `—`=미확인.

| # | §8.2 항목 | ValorantReplayParser (C#, **Linux L3**) | vrfkit (Rust, L1·cargo 차단) |
|---|---|---|---|
| 1 | 지원 VRF 버전 | ◐ 동봉 샘플 2종 디코드 성공 | ✅ 11.06–13.10 빌드별 표 |
| 3 | 디코딩 이벤트 | ✅ 채널 Type별 스트림(movement/bomb/phase/ability open) | ✅ events.parquet |
| 4 | 선수 위치 | ✅ **실측** `Position{X,Y,Z}` uu | ✅ movement.parquet |
| 5 | 위치 샘플링 | ✅ per-move `Timestamp`(128Hz, 라운드 리셋) | ✅ 128Hz |
| 6 | 시선 방향 | ✅ **실측** `Yaw`(도) — RotationInput.Z는 0 | ✅ yaw/pitch |
| 7–10 | 체력/방어구/무기/탄약 | ❌ `.vrf`에 없음 | ◐ fields.parquet 속성 |
| 11–12 | 스킬 사용/오브젝트 | ◐ channels.jsonl `ev:open`의 ability 액터 spawn(cls+좌표) | ◐ RPC/이벤트 |
| 13 | 스파이크 상태 | ✅ BombPlayerState/BombGameState | ✅ BombPlayerState |
| 14 | 킬·데스 | ❌ clean death 라인 없음 → 추론 필요 | ✅ |
| 15 | 라운드 시간 | ✅ ClientGamePhaseEnded(OldPhase=2=combat start) + BombGameState wall clock | ✅ |
| 16–18 | 요원/플레이어/맵 식별 | ◐ PlayerId·ProfileName·NetGUID / 맵은 헤더 미노출(현재 `-Map` 힌트) | ✅ |
| 19 | 출력 형식 | 콘솔 덤프(→ PV-6 JSON) + channels.jsonl | Parquet 13테이블 |
| 21 | 실제 실행 성공 | ✅ **Linux에서 성공** | ❌ cargo 차단 |

### `.vrf`에 없는 값 (PV-1과 정합, 실행으로 재확인)
표시명/RiotID(단 `ProfileName`은 있음·커스텀에선 실명), KDA/점수, 킬 귀속, 체력·방어구·크레딧·보유무기,
정확한 조준(aim at kill), 요원별 아이콘. → README §8.3·§9.3, Handoff §22.2대로 **추론/시뮬레이션** 대상.
`alive`는 디코딩 불가 → 정규화 출력에서 **`null`**(절대 false로 날조 금지).

---

## 4. 구현한 Linux 파이프라인 (`tools/replay-parser/`)

| 파일 | 역할 |
|---|---|
| `src/extract.mjs` | `decode-full.txt` → raw(JSON). 순수 함수(`extractRawFromLines/File`) + CLI. upstream Linux 이식 + Yaw 교정. |
| `src/normalize.mjs` | raw → PROJECT V 정규화: **ms 시간축**, **라운드 분할**, **게임 좌표(worldPos)**, **provenance**. `redactProfileNames`·`synthetic` 옵션. |
| `src/abilities.mjs` | channels.jsonl → ability spawn(오프라인; upstream의 valorant-api 네트워크 호출 제거, 팀은 클러스터링 추론). |
| `src/pipeline.mjs` | normalize+abilities CLI 드라이버. |
| `run.sh` | 한 줄 실행: decode→extract→normalize→abilities. |
| `test/pipeline.test.mjs` | `node --test` 단위테스트 7종. |
| `test/fixtures/` | **합성** decode/channels fixture(명확히 표시). |

### 시간축 정규화 (README §8.4)
- `sourceTimestamp` — per-move 128Hz tick(라운드마다 리셋, **원본 보존**).
- `matchTimeMs` — BombGameState `ReplicatedWorldTimeSecondsDouble`(글로벌 wall 초)를 샘플0 기준으로 ms 변환.
- `roundTimeMs` — `matchTimeMs − round.startTimeMs`.
원본 tick과 변환 시간을 **모두 유지**한다.

### 좌표 경계 (PV-3와의 분담)
positions는 **게임 월드 uu(≈cm, Z-up)**. PV-2 `position.schema.json`이 요구하는 미니맵(0..1000)
x/y 변환은 **Spatial 에이전트(PV-3) 소유**이므로 여기서 날조하지 않고 `worldPos`만 채운다.

### 테스트 결과 (실제 실행)
```
$ node --test tools/replay-parser/test/pipeline.test.mjs
# tests 7  # pass 7  # fail 0
```
추가로 **실제 `.vrf`**(5c673443)에 내 파이프라인을 돌려 `normalized.json` 재현:
rounds=6, positions=3001, provenance=decoded/L3, redaction 동작 확인.

---

## 5. 라이선스 (상세는 vrf-capture-guide.md §라이선스)

| 저장소 | 라이선스 | 비고 |
|---|---|---|
| ValorantWebReplayer | MIT | Windows 전용 뷰어. 추출 로직 참고. |
| ValorantReplayParserPlayground (fork) | 상류 `FortniteReplayDecompressor` 계열 라이선스(레포 `LICENSE`) | 동봉 `.vrf` 샘플은 테스트 자원. |
| vrfkit | Apache-2.0 | 코드/NOTICE.md 확인. |

이들은 **코드** 라이선스다. 디코딩 대상인 `.vrf`와 거기서 나온 **경기 데이터**의 이용은 별도로
Riot 정책을 따른다 → `docs/research/vrf-capture-guide.md` 참조.

---

## 6. 다음 작업

1. **cargo 차단 해제 시 vrfkit L3**: `vrfkit export`의 Parquet를 PV-2 DuckDB/polars 스택에 직결.
2. **완전한 5v5 `.vrf` 확보**: 동봉 샘플은 짧은 캡처. 사용자 Ascent 커스텀 녹화 권장(캡처 가이드).
3. **킬/사망 추론 레이어**: BombPlayerState 복제 중단·movement gap 기반(confidence 포함, inferred 표시).
4. **맵 식별**: 현재 `-Map` 힌트 의존. `.vrf` 헤더에서 맵 추출(vrfkit `inspect`가 branch/맵 노출).
5. **미니맵 변환**: PV-3가 world→minimap 변환 제공 시 positions에 minimap x/y 추가.
