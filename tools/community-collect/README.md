# `tools/community-collect/` — community VCT-stats collection (session J)

Re-runnable, rate-limited collection of **VCT-like public statistics** from legal community /
official sources, with full provenance. Fills engine-validation gaps that `vct.duckdb` cannot
(HANDOFF §5 P2-11: no positions/events/plant coords → no man-advantage, first-kill-zone, or
split-ratio numbers). Output: [`datasets/community/vct_community_stats.json`](../../datasets/community/vct_community_stats.json)
(+ schema), documented in [`docs/research/COMMUNITY_DATA.md`](../../docs/research/COMMUNITY_DATA.md).

## Layout
| File | Role |
|---|---|
| `fetch.py` | rate-limited (≥2.5 s/host), honest-UA, **cached** HTTP fetcher with a provenance sidecar. Never bypasses a block. |
| `build_stats.py` | curation + serialization: hand-extracted numbers (each with source URL, scope, licence, confidence) → validated JSON. |
| `cache/` | raw response cache — **gitignored, never committed** (task rule). |

## Run
```bash
python3 tools/community-collect/fetch.py "<url>" --slug name    # fetch+cache one page
python3 tools/community-collect/build_stats.py                  # regenerate the JSON (validates vs schema)
```
`build_stats.py` does not re-fetch; it serializes the curated items. `fetch.py` does the actual
network I/O (used ad-hoc and by future collect scripts), caching bodies under `cache/`.

## Collection rules (enforced)
- **Generic, honest User-Agent** (`ProjectV-research/1.0 …`), **not** a browser spoof. ≥ 2.5 s between
  requests to the same host.
- **No bypassing blocks.** A 403/429/robots-disallow is recorded in the JSON's `blockedSources`
  and in `COMMUNITY_DATA.md`, with the host name — never worked around.
- **No vlr.gg** scraping, and **no vlr-derived** Kaggle/GitHub datasets. Where a source mixes vlr
  data in (e.g. one article's agent-pick table), only the non-vlr figures are taken and the fact is noted.
- **No personal data.** No Reddit usernames; only article/post URLs. Numbers + short summaries only,
  never bulk copy of source text.
- **No secrets** committed.

## What is reachable from this environment (2026-11-26)
Reachable & used: `playvalorant.com` (Riot official), `thespike.gg` (robots allows `/valorant/news/`,
`/valorant-stats`), published analysis articles (Upcomer…), `raw.githubusercontent.com`.
Blocked / not used (recorded, not bypassed): `reddit.com`/`old.reddit.com` (403 to cloud IP),
`api.pushshift.io` (403), `liquipedia.net` (Cloudflare 429, anti-scraper), `metasrc.com`
(robots Disallows AI crawlers + `ai-train=no`, Cloudflare 403), `rib.gg` direct (429 — used
second-hand via Upcomer), `ieee-dataport.org` round dataset (login-gated). See `blockedSources`.

## Confidence scale
`high` exact number + large/known sample + reputable/official · `med` exact but small/one-event
or no stated denominator · `low` approximate / third-party unverified / single team-or-player proxy.
