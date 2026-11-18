# PROJECT V — TASK HANDOFF (PV-6 Replay Parser)

**작성:** 2026-11-18 · **에이전트:** PV-6 · **브랜치:** `claude/pv-replay`

## 1. 작업 목표
VALORANT `.vrf` 리플레이를 **Linux에서** 디코딩해 PROJECT V Layer-B(위치·라운드) 데이터로
정규화하는 파이프라인 구축. README §08·Handoff §7 담당분. PV-1의 L1 소스검증을 이어 **실제 빌드·실행(L3)**.

## 2. 완료한 작업 (실제 수행·검증한 것만)
- ValorantWebReplayer / ValorantReplayParserPlayground(`revamped-channel-hooks`) / vrfkit **클론·열람** (`/tmp/pv-clones/`, 미커밋).
- **ValorantReplayParser(C#/.NET10) Linux 빌드 성공**: `dotnet publish -r linux-x64 --self-contained`, exit 0, 74MB 단일 실행 파일.
  - Windows 하드코딩 경로(`channelOutPath`)를 `VRP_CHANNELS` env로 패치(클론 로컬만, 미커밋).
- **실제 `.vrf` 2개 디코딩(L3)**: 저장소 동봉 샘플. 하나는 combat(3001 movement 샘플), 하나는 ceremony(movement 0).
- **vrfkit `cargo build` 시도 → 환경 권한 분류기가 차단**(컴파일 오류 아님). 실제 거부 메시지 기록.
- **Linux 추출 파이프라인 구현**: `tools/replay-parser/` (extract/normalize/abilities/pipeline + run.sh).
  - PV-2 `datasets/schema` 방향으로 정규화: **ms 시간축, 게임 좌표(worldPos), 라운드 분할, provenance**.
  - upstream yaw 버그 교정(`RotationInput.Z`=0 → `mv.Yaw` 사용).
- **합성 fixture 단위테스트 7종 작성·통과**(`node --test`), 실데이터 불필요.
- **실데이터 end-to-end 재현**: 내 파이프라인으로 실제 `.vrf` → `normalized.json`(rounds=6, positions=3001).
- 문서 3종 작성: `replay-parser.md`, `vrf-capture-guide.md`(+라이선스/정책), 본 핸드오프.

## 3. 변경한 파일 (저장소 내, 커밋 대상)
- `tools/replay-parser/src/{extract,normalize,abilities,pipeline}.mjs` — 파이프라인 단계.
- `tools/replay-parser/run.sh` — 한 줄 오케스트레이터.
- `tools/replay-parser/package.json`, `.gitignore`, `README.md`.
- `tools/replay-parser/test/pipeline.test.mjs` — 단위테스트.
- `tools/replay-parser/test/fixtures/{make-fixture.mjs,decode-full.synthetic.txt,channels.synthetic.jsonl,README.md}` — **합성** fixture.
- `docs/research/replay-parser.md` — 파서 평가(§8.2) + Linux 빌드 결과.
- `docs/research/vrf-capture-guide.md` — 캡처 가이드 + 라이선스/Riot 정책 판단.
- `docs/handoffs/PV-6-replay.md` — 본 문서.
> 커밋하지 않은 것: 외부 클론(`/tmp/pv-clones/`), .NET publish 바이너리, `decode-full.txt`, 실제 `.vrf`.

## 4. 데이터 출처 (실제 사용)
- `github.com/talhakoek/ValorantWebReplayer` (MIT) — 추출 로직 원본.
- `github.com/talhakoek/ValorantReplayParserPlayground` @ `revamped-channel-hooks` — 디코더(빌드·실행). **동봉 `.vrf` 샘플 2개** 사용.
- `github.com/yakisoba0728/vrfkit` (Apache-2.0) — L1 검토(cargo 차단).
- `.NET 10 SDK` 10.0.404 (`dot.net/v1/dotnet-install.sh`).

## 5. 실행 방법
```bash
# 테스트 (실데이터 불필요)
cd tools/replay-parser && npm test          # = node --test test/pipeline.test.mjs

# 실제 .vrf 처리 (파서 바이너리 필요: replay-parser.md §2 참고)
PARSER=/path/to/ValorantReplayParser REDACT=1 \
  tools/replay-parser/run.sh <replay>.vrf Ascent
# → tools/replay-parser/output/<replay>/normalized.json

# 파서 Linux 빌드 (요약)
git clone -b revamped-channel-hooks https://github.com/talhakoek/ValorantReplayParserPlayground.git
#   Program.cs의 channelOutPath를 VRP_CHANNELS env로 패치(1줄)
dotnet publish src/ValorantReplayParser/ValorantReplayParser.csproj \
  -c Release -r linux-x64 --self-contained true /p:PublishSingleFile=true -o <out>
```

## 6. 검증 방법
- 단위테스트: `node --test tools/replay-parser/test/pipeline.test.mjs` (합성 fixture, 7 케이스).
- 실데이터: 동봉 `.vrf`를 Linux 파서로 디코딩 → 내 extract/normalize로 `normalized.json` 재현.

## 7. 테스트 결과 (실제)
```
# tests 7  # pass 7  # fail 0        (node --test)
```
실데이터(`5c673443…vrf`): extract samples=3001, guids=1, facingDeg=142.06(실제 Yaw),
ProfileName 실측 1건(익명화 처리); normalize rounds=6, positions=3001, provenance=decoded/L3, redaction 동작.
C# 파서 `dotnet publish` exit 0. **cargo build는 차단되어 미실행(성공으로 기록하지 않음).**

## 8. 현재 미완료 사항
- **vrfkit L3 미실행**(cargo 차단). Parquet 출력 → PV-2 스택 직결은 보류.
- **완전한 5v5 `.vrf` 미확보**: 동봉 샘플은 짧은 테스트 캡처. 사용자 Ascent 커스텀 필요.
- 킬/사망 추론 레이어 미구현(`alive`=null 유지).
- 맵 식별은 `-Map` 힌트 의존(`.vrf` 헤더 추출 미구현).
- world→minimap 변환 미적용(PV-4 소유).

## 9. 알려진 문제
- **cargo 차단**: `cargo build`가 환경 분류기에 `[Unauthorized Access]`로 거부됨(dotnet은 허용). 명령별 판정 차이.
- 동봉 ceremony 샘플은 movement 0 → positions 0(정상 처리, 크래시 없음).
- abilities 팀 추론은 actor 평균위치 근사(오프라인 포트). 완전한 per-tick 근접은 viewer/후속 과제.
- 라운드 감지는 ClientGamePhaseEnded(OldPhase=2) 휴리스틱 — 짧은 캡처에선 과다 분할 가능.

## 10. 설계 결정
- **게임 좌표 유지, 미니맵 날조 금지**: PV-2 position.schema의 minimap x/y는 PV-4 변환 소유 → `worldPos`만 채움.
- **시간축 이중 보존**(README §8.4): `sourceTimestamp`(128Hz tick) + `matchTimeMs`/`roundTimeMs`(wall clock 변환).
- **데이터 정직성**: `.vrf`에 없는 alive/health는 `null`, 추정값을 false로 날조하지 않음(Handoff §22).
- **네트워크 제거**: abilities 단계에서 upstream의 valorant-api 호출 제거 → 결정론적·오프라인.
- **순수 함수화**: extract를 테스트가 직접 호출 가능한 순수 함수로(외부 바이너리·클론 스크립트 비의존).
- **합성/실데이터 분리**: provenance `synthetic` 플래그로 강제 구분, fixture는 `test/fixtures/`에만.

## 11. 라이선스 및 권한
- 코드: ValorantWebReplayer=MIT, vrfkit=Apache-2.0, Playground=상류 라이선스. 클론만, 미커밋.
- `.vrf`/경기 데이터: 로컬 파일(서버·API 미사용). **로컬 `.vrf` 파싱에 대한 Riot 명시 조항은 공개 검색 미확인(UNVERIFIED)**.
  본인 커스텀만 사용, ProfileName 기본 익명화, 공개 배포 금지, 상업화 전 Riot ToS 재확인. 상세: `vrf-capture-guide.md §5`.

## 12. 다음 권장 작업 (우선순위)
1. 사용자 **Ascent 5v5 커스텀 `.vrf`** 확보 → 완전한 Layer-B 궤적 생성(`vrf-capture-guide.md`).
2. cargo 차단 해제 시 **vrfkit export** L3 → Parquet를 PV-2 DuckDB/polars에 직결.
3. 킬/사망 **추론 레이어**(BombPlayerState 중단·movement gap, confidence·inferred 표시).
4. `.vrf` 헤더 **맵 식별** 자동화.
5. PV-4의 **world→minimap 변환** 연동 → PV-2 Position 스키마 완전 충족.

## 13. 작업 재개 지점
- 먼저 열 파일: `tools/replay-parser/README.md` → `docs/research/replay-parser.md`.
- 실행: `cd tools/replay-parser && npm test` (즉시 통과 확인).
- 실데이터 재현: `docs/research/replay-parser.md §2`로 파서 빌드 후 `run.sh`.

---

# PV-6 2차 작업 — Kinematics & 좌표 정합 (2026-11-18)

## 1. 목표
PV-6 1차에서 Linux로 디코딩한 실제 Ascent `.vrf` 궤적으로 ① 맵 식별 ② PV-4 좌표 변환 검증
③ 이동 운동학 통계 산출. (공간 담당은 PV-4 `origin/claude/pv-spatial` — 1차 문서의 PV-3 표기를 PV-4로 정정.)

## 2. 완료한 작업 (검증한 것만)
- **맵 식별 = Ascent (decoded, L3)**: 파서 로그의 `/Game/Maps/Ascent/Ascent.Ascent_C` 클래스 경로를
  extract가 `mapHints`로 포착. 변환 [0,1] 포함 테스트는 Ascent/Haven/Split 모두 통과(약한 신호)라 **힌트가 결정적**.
- **PV-4 좌표 변환 검증 성공**: PV-4 coordinate-system 변환을 실데이터 3001 샘플에 적용 → **[0,1] 포함 1.0000**.
  PV-4가 콜아웃으로만 검증했던 변환식의 **첫 실데이터 교차검증**.
- **미니맵 오버레이 PNG 생성**(Playwright/Chromium): 궤적이 맵 내부에서 일관된 경로 → 육안 검증.
- **운동학 통계**: 최고속도 **6.84 m/s**(문서 run 6.75 +1.3% → PV-4 속도상수 뒷받침), yaw 각속도 분포,
  가속/감속, 구간 길이. 모든 블록에 표본 n 기재.
- **단위테스트 7종 추가**(analysis.test.mjs) — kinematics·mapproj 결정론적 검증. 총 14/14 통과.
- **개인정보**: 산출물 player는 `player_N` 익명 ID. 1차 문서 2곳에 있던 실측 ProfileName 문자열을 **익명화로 교체**,
  repo 트리 grep 무결 확인.

## 3. 변경/추가 파일
- `tools/replay-parser/analysis/{kinematics,mapproj,run-analysis,overlay}.mjs` — 분석 단계.
- `tools/replay-parser/test/analysis.test.mjs` — 단위테스트.
- `datasets/derived/kinematics/{kinematics.schema.json, ascent-capture-01.kinematics.json, ascent-capture-01.overlay.png}` — 집계 산출물(프레임 궤적·원본 미커밋).
- `docs/research/replay-kinematics.md` — 본 분석 문서.
- (정정) `tools/replay-parser/src/normalize.mjs`, `README.md`, `docs/research/replay-parser.md`, 본 핸드오프: PV-3→PV-4.

## 4. 테스트 결과 (실제)
```
node --test test/pipeline.test.mjs test/analysis.test.mjs  → # tests 14  # pass 14  # fail 0
run-analysis(real .vrf) → map=Ascent, topSpeed=6.837 m/s, projection fracInUnit=1.0
```

## 5. 알려진 한계 / 문제
- **표본 1경기·1인·86.8% 정지·단일 구역(defender-spawn)** → 수치는 사전값일 뿐 **일반화 불가**. 완전한 5v5 필요.
- **구역 간 이동 시간 비교 불가**(전이 0건) → PV-4 예측값은 참고표로만 제시, 속도상수만 실측 검증.
- `firstMove` 측정 불가(n=0): 짧은 캡처의 라운드 마커가 이동 시작과 미정렬.
- walk/crouch 분리 불가(`.vrf`에 입력 상태 없음) → 속도 밴드일 뿐.
- **개인정보 이력:** 실측 ProfileName이 **1차 커밋 1개에 포함**되었고 현재 트리에선 익명화됨. 규칙상 push된
  브랜치 history rewrite(rebase)는 하지 않음 — 해당 값은 인게임 ProfileName(저민감)이며 추가 노출 없음.

## 6. 다음 작업
1. 완전한 5v5 Ascent `.vrf` → 10인·구역간 이동 실측(이동시간/첫이동/상태분리).
2. 무기별 이동속도 비교(무기정보 `.vrf` 부재로 보류).
3. 자세(crouch) 추정 레이어(inferred+confidence).
4. PV-4 Combat Engine에 kinematics JSON(단위·정의 명시) 전달.

## 7. 재개 지점
- `docs/research/replay-kinematics.md` → `datasets/derived/kinematics/*.json`.
- `cd tools/replay-parser && npm test` (14/14).
