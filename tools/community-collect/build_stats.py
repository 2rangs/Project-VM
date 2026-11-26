#!/usr/bin/env python3
"""Build datasets/community/vct_community_stats.json from curated, provenance-tagged items.

Session J (claude/pv3-community-data). Each item here was extracted BY HAND from a public,
legal source (the raw page is fetched+cached by fetch.py; the number is transcribed here with
its source URL, scope, licence and confidence). Re-running this script regenerates the JSON
deterministically and validates it against the schema. It does NOT re-fetch — use fetch.py /
the collect scripts for that; this is the curation + serialization layer so the numbers, their
provenance and the engine cross-refs live in one reviewable place.

Rules honoured (see README.md):
- Only numbers with a concrete public source URL. No personal data (no reddit usernames).
- Percentages stored as 0..1 fractions (value_unit=fraction) unless noted.
- vlr.gg-scraped values are NOT included; where a source mixes in vlr data that fact is noted
  and only the non-vlr figures are taken.
- confidence: high = exact number, large/known sample, reputable/official source;
  med = exact number but small/one-event sample or no stated denominator;
  low  = approximate, third-party unverified, or team/player-level used as a weak proxy.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "datasets/community/vct_community_stats.json"
SCHEMA = Path(__file__).resolve().parents[2] / "datasets/community/vct_community_stats.schema.json"

# Common source URLs
RIOT_DD23 = "https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023/"
UPCOMER_B1 = "https://upcomer.com/answering-valorant-masters-berlin-questions-part-1"
UPCOMER_B2 = "https://upcomer.com/answering-valorant-masters-3-berlin-questions-part-2"
TS_CH25 = "https://www.thespike.gg/valorant/news/valorant-champions-2025-map-analysis-trends-and-insights/6917"
COYOTE_FB = "https://note.com/coyote59/n/nb2cebc617103?hl=en"


def item(**kw):
    kw.setdefault("value_unit", "fraction")
    kw.setdefault("useful_for_session_H", False)
    kw.setdefault("map", None)
    kw.setdefault("side", None)
    kw.setdefault("patch_or_period", None)
    kw.setdefault("n", None)
    kw.setdefault("engine_prior_ref", None)
    return kw


ITEMS: list[dict] = []

# ---------------------------------------------------------------------------
# 1. Plant timing — Riot official VCT 2023 Data Drop (text, high confidence)
# ---------------------------------------------------------------------------
ITEMS += [
    item(
        id="plant-time-pacific-2023", metric="Average time to plant spike (fastest region)",
        metric_category="site_plant_timing_detonation", side="attack",
        scope="VCT 2023 Pacific (all pro matches, regular season + LCQ + global events)",
        patch_or_period="2023", value=52.3, value_unit="seconds",
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        engine_prior_ref="plant_post_plant.json (plant timing not in VCT Reference)",
        notes="Fastest region. Already cited in docs/research/LURKER_ROLE.md §5 as the lurk engage-window reference clock.",
    ),
    item(
        id="plant-time-europe-2023", metric="Average time to plant spike (slowest region)",
        metric_category="site_plant_timing_detonation", side="attack",
        scope="VCT 2023 Europe (EMEA)", patch_or_period="2023", value=60.4, value_unit="seconds",
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        notes="Slowest region. Article says 'Europe', not 'EMEA'. No Americas/China plant-time figures in the text (charts are images).",
    ),
    item(
        id="flash-duration-range-2023", metric="Full flash duration range across agent flashes",
        metric_category="ability_ult_timing", scope="VALORANT live build (official, 2023 article)",
        patch_or_period="2023", value="1.0-3.1", value_unit="seconds",
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        notes="'A full flash lasts anywhere from 1 to 3.1 seconds depending on the Agent flash ability.' Bounds for ability-effects flash durationMs.",
    ),
]

# ---------------------------------------------------------------------------
# 2. Post-plant / defuse — Riot 2023 (team-level best, so med/low, team=Fnatic)
# ---------------------------------------------------------------------------
ITEMS += [
    item(
        id="postplant-attack-win-best-team-2023", metric="Attacker-side post-plant round win rate (best team)",
        metric_category="plant_manadv_retake", side="attack",
        scope="VCT 2023 international, team Fnatic (the single best team, all maps)",
        patch_or_period="2023", value=0.748,
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med",
        engine_prior_ref="plant_post_plant.json post_plant_attack_win (VCT 0.709, Ascent 0.738)",
        notes="BEST team's attacker post-plant win (not a league average). League average is ~0.709 per VCT Reference prior. 0.748 is an upper reference; already in LURKER_ROLE.md §3.",
    ),
    item(
        id="defuse-rate-best-team-2023", metric="Defender-side defuse rate (best team)",
        metric_category="plant_manadv_retake", side="defense",
        scope="VCT 2023 international, team Fnatic (best defuse rate, all maps)",
        patch_or_period="2023", value=0.391,
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med",
        engine_prior_ref="round_outcome_distribution.json defuse (VCT 0.199 of all rounds; here conditioned on opponent plant)",
        notes="Best team's defuse rate = share of opponent plants Fnatic defused. This is retake-success upper bound (team-level). Complement 1-0.748=0.252 is the attacker post-plant loss for that team.",
    ),
]

# ---------------------------------------------------------------------------
# 3. First kill / trade — Upcomer (rib.gg data), Masters Berlin 2021
# ---------------------------------------------------------------------------
ITEMS += [
    item(
        id="firstblood-round-win-berlin2021", metric="Round win rate given the player's team got first blood",
        metric_category="firstkill_trade",
        scope="VCT Masters 3 Berlin 2021 (international LAN, aggregate across players)",
        patch_or_period="2021 (patch 3.x era)", value=0.7139,
        source_name="Upcomer — Answering VALORANT Masters Berlin Questions: Part 1 (data: rib.gg)",
        source_url=UPCOMER_B1, source_type="analysis_article",
        license="editorial (cite, no redistribution); underlying data rib.gg",
        retrieved_at="2026-11-26", confidence="med", useful_for_session_H=True,
        engine_prior_ref="combat_opening_duel.json (opening-duel win rate exists; entry->ROUND win is a VCT Reference gap, VALIDATION_BASELINES §6)",
        notes="FILLS A GAP: VCT Reference has no entry->round-win link (per VALIDATION_BASELINES §6 'Combat data NOT available'). No published denominator; one event, 2021 meta. Treat as a prior, not a baseline. Harness already computes this from sim logs as a 'no real baseline' report metric — this gives it a comparison point.",
    ),
    item(
        id="firstblood-round-win-copenhagen2022",
        metric="Round win rate given the team got first blood (= first-5v4 win rate)",
        metric_category="firstkill_trade",
        scope="VCT 2022 Stage 2 Masters Copenhagen (international, all teams, Day 1-12)",
        patch_or_period="2022", value=0.703, n=1349,
        source_name="note.com/coyote — A Discussion on First Bloods in VALORANT (data: THESPIKE.GG, manual)",
        source_url=COYOTE_FB, source_type="analysis_article",
        license="editorial (cite); data manually aggregated from thespike.gg",
        retrieved_at="2026-11-26", confidence="med", useful_for_session_H=True,
        engine_prior_ref="combat_opening_duel.json; VALIDATION_BASELINES §6 entry->round-win gap",
        notes="949 won / 400 lost after first blood of 1349 rounds -> 70.3%. CORROBORATES the Berlin 2021 figure (0.714) from an INDEPENDENT source/event (thespike, not rib.gg): two events agree ~0.70-0.71. Source is thespike.gg, NOT vlr. Manual collection ('may be errors'). Same number also gives the 5v4 man-advantage (next item).",
    ),
    item(
        id="manadv-5v4-postfirstblood-copenhagen2022",
        metric="5v4 round win rate (advantage team, immediately after first blood)",
        metric_category="plant_manadv_retake", side=None,
        scope="VCT 2022 Stage 2 Masters Copenhagen (international, all teams)",
        patch_or_period="2022", value=0.703, n=1349,
        source_name="note.com/coyote — First Bloods in VALORANT (data: THESPIKE.GG, manual)",
        source_url=COYOTE_FB, source_type="analysis_article",
        license="editorial (cite); data manually aggregated from thespike.gg",
        retrieved_at="2026-11-26", confidence="med",
        engine_prior_ref="no VCT Reference baseline (needs per-round alive transitions) — VALIDATION_BASELINES §6 'Man-advantage win rates ... needs per-round alive transitions'",
        notes="FILLS THE #1 GAP (man-advantage win rate). This is specifically the FIRST 5v4 (the round's opening kill), so it is a lower-bound proxy for a general 5v4 (later 5v4s with spike/time context differ). 4v5 complement = 29.7%. VCT Reference cannot produce this (no alive-count sequence). Treat as a prior, not a judged baseline.",
    ),
    item(
        id="utility-kill-share-berlin2021", metric="Share of kills that came from utility (ability damage)",
        metric_category="ability_ult_timing",
        scope="VCT Masters 3 Berlin 2021 (aggregate)", patch_or_period="2021", value=0.044,
        source_name="Upcomer — Masters Berlin Part 1 (data: rib.gg)", source_url=UPCOMER_B1,
        source_type="analysis_article", license="editorial (cite); data rib.gg",
        retrieved_at="2026-11-26", confidence="med", useful_for_session_H=True,
        notes="'Only about 4.4% of kills in Berlin were from utility.' Excludes utility assists. Reference for how much of combat is ability vs gunfire; relevant to enableAbilities calibration (HANDOFF: abilities 4/8).",
    ),
    item(
        id="lurk-kill-share-nats-berlin2021", metric="Share of a lurker's kills that came from lurks (nAts)",
        metric_category="firstkill_trade",
        scope="VCT Masters 3 Berlin 2021, player nAts (Gambit) — single player",
        patch_or_period="2021", value=0.351,
        source_name="Upcomer — Masters Berlin Part 2 (data: rib.gg)", source_url=UPCOMER_B2,
        source_type="analysis_article", license="editorial (cite); data rib.gg",
        retrieved_at="2026-11-26", confidence="low",
        notes="LURK DATA (rare): 35.1% of nAts' Berlin kills were from lurks; ~60-75% of those on open maps (Icebox, Breeze). Player-level, one event. Directly relevant to docs/research/LURKER_ROLE.md §10 'data we do not have'. Not a league rate.",
    ),
]

# ---------------------------------------------------------------------------
# 4. Pistol / eco / force
# ---------------------------------------------------------------------------
ITEMS += [
    item(
        id="pistol-conversion-berlin2021", metric="Second-round win rate after winning the pistol (conversion)",
        metric_category="pistol_eco_force",
        scope="VCT Masters 3 Berlin 2021 (aggregate across teams)", patch_or_period="2021",
        value=0.909,
        source_name="Upcomer — Masters Berlin Part 2 (data: rib.gg)", source_url=UPCOMER_B2,
        source_type="analysis_article", license="editorial (cite); data rib.gg",
        retrieved_at="2026-11-26", confidence="med",
        engine_prior_ref="pistol_conversion.json (VCT Reference 0.879, VALIDATION_BASELINES §2 ±0.04 -> 0.839-0.919)",
        notes="CORROBORATES the engine prior: 0.909 sits inside the prior's 0.879 +/-0.04 interval. Independent source (rib.gg, 2021) agrees with VCT Reference (2021-2026). No denominator published.",
    ),
    # Champions 2025 (thespike, exact, international) — pistol by map/side
    item(
        id="pistol-attack-win-abyss-ch2025", metric="Attack-side pistol round win rate", map="Abyss",
        metric_category="pistol_eco_force", side="attack",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.6429,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med",
        notes="Map-level pistol win; small per-map sample (Abyss played 14 times at the event).",
    ),
    item(
        id="pistol-attack-win-haven-ch2025", metric="Attack-side pistol round win rate", map="Haven",
        metric_category="pistol_eco_force", side="attack",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.55,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med", notes="Haven played 10 times at the event (small sample).",
    ),
    item(
        id="pistol-defense-win-lotus-ch2025", metric="Defense-side pistol round win rate", map="Lotus",
        metric_category="pistol_eco_force", side="defense",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.5556,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med", notes="Lotus played 18 times (largest map sample at the event).",
    ),
    item(
        id="pistol-defense-win-sunset-ch2025", metric="Defense-side pistol round win rate", map="Sunset",
        metric_category="pistol_eco_force", side="defense",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.6818,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med", notes="Small per-map sample.",
    ),
    # Pistol->2nd conversion by map/side (Champions 2025)
    item(
        id="pistol-conv-defense-bind-ch2025", metric="Pistol-to-second-round conversion (defense side)", map="Bind",
        metric_category="pistol_eco_force", side="defense",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.9091,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="med",
        engine_prior_ref="pistol_conversion.json (0.879)",
        notes="Map/side-specific conversion; consistent with the ~0.88-0.91 league conversion. Attack-side conversion on Abyss/Haven was 100% (tiny samples, omitted as unusable).",
    ),
]

# ---------------------------------------------------------------------------
# 5. Side / map win rates — TheSpike Champions 2025 (exact, international) -> HIGH
# ---------------------------------------------------------------------------
ITEMS += [
    item(
        id="attack-win-abyss-ch2025", metric="Attack round win rate", map="Abyss",
        metric_category="side_map_patch", side="attack",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.5793,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        engine_prior_ref="side_map_baselines.json (Ascent-only today; no Abyss baseline)",
        notes="Most attack-sided map at the event. Abyss played 14 times.",
    ),
    item(
        id="attack-win-haven-ch2025", metric="Attack round win rate", map="Haven",
        metric_category="side_map_patch", side="attack",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.5773,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high", notes="Second-most attack-sided at the event.",
    ),
    item(
        id="attack-win-lotus-ch2025", metric="Attack round win rate", map="Lotus",
        metric_category="side_map_patch", side="attack",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.5104,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        notes="Defense complement 0.4896. Most balanced map at the event. Lotus played 18 times.",
    ),
    item(
        id="defense-win-sunset-ch2025", metric="Defense round win rate", map="Sunset",
        metric_category="side_map_patch", side="defense",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.6044,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        notes="Strongest defensive map at the event (attack ~0.396).",
    ),
    item(
        id="defense-win-bind-ch2025", metric="Defense round win rate", map="Bind",
        metric_category="side_map_patch", side="defense",
        scope="VCT Champions 2025 (international)", patch_or_period="2025", value=0.5494,
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        notes="Defense-favoured (attack ~0.451). Corroborated by multiple third-party trackers (~0.52-0.55 defense).",
    ),
]

# ---------------------------------------------------------------------------
# 6. Map pick rate — Champions 2025 (map_pick_ban)
# ---------------------------------------------------------------------------
_pick25 = {"Lotus": 0.2045, "Abyss": 0.1591, "Corrode": 0.1477,
           "Sunset": 0.125, "Ascent": 0.125, "Bind": 0.125, "Haven": 0.1136}
_games25 = {"Lotus": 18, "Abyss": 14, "Corrode": 13, "Haven": 10}
for m, v in _pick25.items():
    ITEMS.append(item(
        id=f"map-pickrate-{m.lower()}-ch2025", metric="Map pick rate (share of maps played)", map=m,
        metric_category="map_pick_ban",
        scope="VCT Champions 2025 (international, 7-map pool)", patch_or_period="2025",
        value=round(v, 4), n=_games25.get(m),
        source_name="TheSpike.gg — VALORANT Champions 2025 map analysis", source_url=TS_CH25,
        source_type="analysis_article", license="editorial (cite, no redistribution)",
        retrieved_at="2026-11-26", confidence="high",
        notes="Share of the event's maps that were this map. n = times played where stated.",
    ))

# ---------------------------------------------------------------------------
# 7. Plant-site distribution per map — Upcomer/rib.gg Berlin 2021 (site_plant_timing)
#    'A, 57.02% plant rate' read as: on this map, the named site is the most-planted,
#    with that share of plants on it.
# ---------------------------------------------------------------------------
_sites = {"Ascent": ("A", 0.5702), "Bind": ("A", 0.5122), "Breeze": ("A", 0.6620),
          "Haven": ("C", 0.4611), "Icebox": ("B", 0.5025), "Split": ("A", 0.5345)}
for m, (site, v) in _sites.items():
    ITEMS.append(item(
        id=f"plant-site-share-{m.lower()}-berlin2021",
        metric=f"Plant-site distribution: share of plants on the most-used site ({site})", map=m,
        metric_category="site_plant_timing_detonation", side="attack",
        scope="VCT Masters 3 Berlin 2021 (international)", patch_or_period="2021",
        value=v,
        source_name="Upcomer — Masters Berlin Part 1 (data: rib.gg)", source_url=UPCOMER_B1,
        source_type="analysis_article", license="editorial (cite); data rib.gg",
        retrieved_at="2026-11-26", confidence="low",
        engine_prior_ref="no VCT Reference equivalent (positions/plant coords absent) — HANDOFF P2-11",
        notes="FILLS A GAP: per-map A/B(/C) plant-site preference, which vct.duckdb lacks. 'Plant rate' not precisely defined by the source; read as most-planted-site share. Haven is a 3-site map so C 46% leaves A+B 54%. 2021 map versions (Breeze/Icebox since reworked/rotated) — treat as historical prior only.",
    ))

# ---------------------------------------------------------------------------
# 8. Match-state comeback rates — Riot 2023 official (match_result / round-value)
# ---------------------------------------------------------------------------
ITEMS += [
    item(
        id="comeback-3-9-zero-win-teams-2023",
        metric="Share of teams with a 0% match win rate when down 3-9 at halftime",
        metric_category="match_result",
        scope="VCT 2023 international (32 teams tracked)", patch_or_period="2023",
        value=round(18/32, 4), n=32,
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite)",
        retrieved_at="2026-11-26", confidence="high",
        notes="18 of 32 teams never won a map after a 3-9 half. A measure of how strong the economic/score snowball is at the half. Supports round-value / save-decision snowball modelling (README §20, §26.3).",
    ),
    item(
        id="timeout-called-win-berlin2021", metric="Round win rate for the team that called a tactical timeout",
        metric_category="other",
        scope="VCT Masters 3 Berlin 2021 (aggregate)", patch_or_period="2021", value=0.344,
        source_name="Upcomer — Masters Berlin Part 2 (data: rib.gg)", source_url=UPCOMER_B2,
        source_type="analysis_article", license="editorial (cite); data rib.gg",
        retrieved_at="2026-11-26", confidence="low",
        notes="Timeouts were 'not really' decisive. Weak prior for match-management timeout effects (ManagedSessionOptions.timeoutsPerHalf / moodEffects, HANDOFF §4). One event.",
    ),
    item(
        id="clutch-momentum-shift-berlin2021", metric="Share of clutches that shifted momentum (>=2 round win streak after)",
        metric_category="clutch_multikill_kast_adr",
        scope="VCT Masters 3 Berlin 2021 (156 clutches)", patch_or_period="2021",
        value=0.256, n=156,
        source_name="Upcomer — Masters Berlin Part 2 (data: rib.gg)", source_url=UPCOMER_B2,
        source_type="analysis_article", license="editorial (cite); data rib.gg",
        retrieved_at="2026-11-26", confidence="med", useful_for_session_H=True,
        notes="156 clutches: 25.6% shifted momentum to the clutcher's team, 58.3% no change, 16.0% lost momentum. Relevant to session H clutch distribution and to round-value momentum modelling.",
    ),
    item(
        id="comeback-2-10-rate-2023", metric="Match comeback rate when down 2-10 at halftime",
        metric_category="match_result",
        scope="VCT 2023 international", patch_or_period="2023", value=round(2/67, 4), n=67,
        source_name="Riot Games — VALORANT Data Drop: VCT 2023", source_url=RIOT_DD23,
        source_type="riot_official", license="editorial (official Riot article; cite)",
        retrieved_at="2026-11-26", confidence="high",
        notes="67 games had a 2-10 half; only DRX and Team Liquid came back (~3%). 0-26 when trailing 1-11, 0-4 when trailing 0-12. Deep-deficit comeback priors for the round-value model.",
    ),
]


def build() -> dict:
    return {
        "schemaVersion": "1.0.0",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "collector": "session J (claude/pv3-community-data) tools/community-collect/build_stats.py",
        "notes": (
            "VCT-like community/official statistics with provenance. NOT engine judgement baselines "
            "(those are datasets/derived/priors, from the real VCT Reference DB). Candidates for corroboration/"
            "fill; the orchestrator decides what (if anything) enters priors. See docs/research/COMMUNITY_DATA.md. "
            "Ranked-tier values, when added, are restricted to Immortal+ per the user's directive."
        ),
        "blockedSources": [
            {"source": "Reddit (r/ValorantCompetitive, r/VALORANT, old.reddit.com JSON)",
             "host": "reddit.com / old.reddit.com", "status": "403",
             "reason": "Reddit itself blocks unauthenticated JSON from this datacenter/cloud IP (not the proxy; a full 403 block page is served). Browser-spoofing was not attempted (task rule). No bypass.",
             "evidence": "GET old.reddit.com/.../search.json -> 403 with Reddit block HTML; www.reddit.com/*.json -> 403."},
            {"source": "Pushshift (Reddit archive)", "host": "api.pushshift.io", "status": "403",
             "reason": "403 from this IP; access now gated to approved Reddit moderators only.", "evidence": "GET -> 403"},
            {"source": "Liquipedia MediaWiki API", "host": "liquipedia.net", "status": "429",
             "reason": "Cloudflare 'Rate Limited' anti-scraper page for this IP; Liquipedia's terms forbid scraper/bot access without approved API arrangement. Not bypassed.",
             "evidence": "api.php -> 429 'Your IP address has been temporarily blocked ... Scrapers and similar tools are not permitted'."},
            {"source": "MetaSRC (ranked aggregate stats)", "host": "metasrc.com", "status": "403",
             "reason": "robots.txt Disallows all AI crawlers (ClaudeBot, GPTBot, anthropic-ai...) and signals ai-train=no; www host returns Cloudflare 403 to non-browser clients. Respected, not used.",
             "evidence": "metasrc.com/robots.txt Disallow /; GET www.metasrc.com/... -> 403."},
            {"source": "rib.gg (direct)", "host": "rib.gg", "status": "429",
             "reason": "429 to this IP; rib.gg numbers are instead taken second-hand via published Upcomer analysis articles (which credit rib.gg).",
             "evidence": "GET rib.gg/robots.txt -> 429"},
            {"source": "vlr.gg and vlr-derived datasets", "host": "vlr.gg", "status": "n/a",
             "reason": "EXCLUDED BY TASK POLICY (ToS). Not scraped; no vlr-scraped Kaggle/GitHub dataset used. Upcomer Part 2's agent-pick figures are vlr-sourced and were therefore NOT taken; only its rib.gg-sourced figures were used.",
             "evidence": "task rule: vlr.gg 스크래핑 금지"},
            {"source": "Kaggle: ryanluong1/valorant-champion-tour-2021-2026-data (round win methods, maps_stats, maps_scores, overtime rates 2022 10.98% / 2023 12.41% / 2024 10.14%)",
             "host": "kaggle.com", "status": "excluded-vlr-derived",
             "reason": "VLR-DERIVED -> NOT USED. The richest free VCT round-level dataset, but its scraper is RyanLuong1/vct-web-scraping, described verbatim as 'Web scraping VCT 2021-2024 data from vlr.gg.' Task policy forbids vlr-scraped datasets. Recorded only. The m1ke-dev.github.io/project1 analysis is built on this same dataset, so its numbers (incl. the overtime rates) are also vlr-derived and NOT used.",
             "evidence": "github.com/RyanLuong1/vct-web-scraping description: 'Web scraping VCT 2021- 2024 data from vlr.gg. Part of the ETL pipeline.'"},
            {"source": "IEEE DataPort — VCT 2024 Pacific & EMEA Round Data (1301 rounds, economy fields)",
             "host": "ieee-dataport.org", "status": "auth",
             "reason": "Login/subscription required to download; not freely accessible. Strong round-level lead for a future authorized pull.",
             "evidence": "dataset page behind login"},
            {"source": "LIACS bachelor thesis — Nieland, 'Applying ML to a Limited Esports Dataset' (2025)",
             "host": "theses.liacs.nl", "status": "excluded-vlr-derived",
             "reason": "VLR-DERIVED -> NOT USED. The thesis states its data was scraped from vlr.gg (VLR gave the author scraping permission, but that permission is to them, not to this project; task policy forbids vlr-derived data). PDF read locally with pdftotext to confirm provenance.",
             "evidence": "thesis §3.1.1: 'the decision was made to scrape data from https://www.vlr.gg'."},
            {"source": "GitHub bernielaird/vctstats (VCT Win Probability, README §5.3)",
             "host": "github.com", "status": "excluded-vlr-derived",
             "reason": "VLR-DERIVED -> NOT USED for data values. Per README §5.3 it processes VLR 2D-Replay data. Its MODELLING approach is a study reference (Handoff), but its numbers rest on vlr scraping.",
             "evidence": "README §5.3 'VLR 2D Replay 처리'; project scrapes vlr."},
            {"source": "TechRxiv — Predictive Analysis of Valorant (1301 rounds, 2024 Pacific+EMEA)",
             "host": "techrxiv.org", "status": "403",
             "reason": "Direct PDF URL returns 403 to this client; could not read provenance or the raw economy-state win rates. Built on the IEEE DataPort dataset. Candidate for a future read via the article landing page.",
             "evidence": "GET .../file/.../*.pdf -> 403"},
            {"source": "CalState ScholarWorks — 'Win-Loss Probability and Round Differential in Professional Valorant'",
             "host": "scholarworks.calstate.edu", "status": "403",
             "reason": "403 to this client; could not read provenance or man-advantage/round-differential numbers.",
             "evidence": "GET -> 403"},
        ],
        "items": ITEMS,
    }


def main() -> int:
    data = build()
    # Validate against the schema if jsonschema is available.
    try:
        import jsonschema  # type: ignore
        schema = json.loads(SCHEMA.read_text())
        jsonschema.validate(data, schema)
        print(f"schema: OK ({len(ITEMS)} items)")
    except ImportError:
        print("schema: jsonschema not installed, skipping validation")
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} ({len(ITEMS)} items)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
