# PROJECT V — Ascent 패치·메타 이력 (PATCH_HISTORY.md)

**작성:** PV-1 Research (7차) · **기준일:** 2026-11-18 · **현재 빌드:** release-13.10

PV-2의 VCT 통계가 여러 시즌(패치 2.09–13.05)에 걸쳐 있어, 맵·요원 변경을 패치 단위로 정리하고
**현재 빌드와 비교 가능한 데이터 구간**을 권고한다. 데이터: [`datasets/derived/meta/patch-history.json`](../../datasets/derived/meta/patch-history.json)(+스키마).

## 1. 출처
- 공식 VALORANT 위키(wiki.playvalorant.com)의 각 요원·맵 **Update History** 섹션(패치 태그 포함).
- 공식 패치 노트 URL(`playvalorant.com/.../valorant-patch-notes-X-YZ/`)은 **각각 resolve 여부 검증**(`patchNoteResolves`). 일부 핫픽스(9.01·9.06·13.09)는 단독 노트 페이지가 없어 위키 Update History가 출처.

## 2. Ascent 맵 — 구조적 안정
**Ascent 레이아웃은 역사적으로 구조가 안정적이다.** 벽/창/문 상호작용 소소한 수정뿐, 사이트·경로 리워크 없음:
- v10.04 B Lane 벽 non-pennable, v6.0 Market 문 파괴 불가, v4.04 B orb 위치, v9.06/9.08 창/벽 상호작용 수정 등.
- 고유 기믹: A Link(A)·Market(B) **기계식 문**(라운드 시작 시 열림, 사이트 쪽 스위치로 개폐).

→ **함의:** 맵 변경은 과거 Ascent 통계를 무효화하지 않는다. 메타 변동 요인은 **맵이 아니라 요원 밸런스**다.

## 3. 상위 픽 요원 밸런스 이력 (주요 변경, 공식 위키)
각 요원의 notableChanges(최근 밸런스 패치 위주)는 데이터 파일에 patch·summary·공식 노트 URL·resolve로 수록. 요지:
- **Chamber:** 연속 너프(5.12 Trademark/TDF 슬로우 6→4s·근접 제한, 6.07 Headhunter ADS, 6.11, 8.03 가격/연사, 9.05 텔레포트 반경, 11.04 Trademark 제한 해제). → 픽률 급락의 원인(상위권이나 과거만큼은 아님).
- **Jett:** Tailwind 리워크(7.04 대시 창 방식 변경), 9.10 창 통과 등 — 기동 메타 변동.
- **Sova:** 다회 조정(7.04, 9.04, 11.00/11.08, 13.00) — Recon/Shock 밸런스.
- **Omen:** 7.04·9.05·11.x 스모크/파라노이아 조정.
- **KAY/O:** 5.08·5.12·9.05·11.08·13.00 — 플래시/넉다운 조정.
- **Killjoy:** 7.04·8.0·11.x·13.10 — 터렛/락다운 조정.
- **Astra:** 4.04·5.10·7.04·9.05·11.08 — 스타/스모크 조정.
- **Fade:** 출시 6.0 이후 7.10·11.08·13.00 조정.

(정확한 수치·문구와 패치 노트 링크는 `patch-history.json`의 `agents[*].notableChanges` 참조.)

## 4. 표본 크기 (국제전 Ascent, VCT Reference 153 maps)
| 구간 | 맵 수 |
|---|---|
| 전체(2.09–13.05) | 153 |
| ≥ 9.x | **42** |
| ≥ 11.x | 31 |
| ≥ 13.x | 13 |

최근일수록 표본이 작다(최신 메타 ↔ 표본 수 트레이드오프).

## 5. 데이터 구간 권고 (PV-2 priors용)
- **현재 메타(13.10) 비교용 1순위: 패치 ≥ 9.x (42 maps).** 에피소드 9+는 현대 로스터/경제를 반영하며 표본도 사용 가능.
- **가장 타이트한 사용 가능 구간: ≥ 11.x (31 maps).** ≥ 13.x(13 maps)는 통계적으로 너무 작음.
- **전체 153 maps**는 구조/방향성 추세·역할 템플릿 baseline에만 사용.
- **근거:** 맵은 구조 안정, 변동 요인은 요원 밸런스(Chamber 5.12/6.07 너프, Jett Tailwind 리워크 7.04/9.10, 궁극 포인트/경제 변경). <9.x는 구메타 혼합.

### PV-2 적용 방법 (권고만 — PV-2 파일 미수정)
- `datasets/derived/priors/`는 **PV-2 소유**. 아래는 권고.
- 현재 메타 prior: `matches.patch`(예 'Patch 9.05')를 숫자 major.minor로 파싱해 **≥ 9.0 필터**, 또는 season/episode ≥ 9.
- 구조 baseline prior는 전체 이력으로 별도 유지. 두 prior를 분리 보관 권장.

## 6. 미완료
- 요원별 랜드마크 리워크(예: Chamber 5.12) 중 최근 5개 밖의 과거 항목은 산문으로만 언급. 필요 시 `notableChanges` 확장.
- 일부 핫픽스 패치는 공식 노트 페이지 부재(위키 Update History가 출처).
