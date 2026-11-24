"""Empirical decision priors + validation baselines from the real VCT Reference data.

VCT Reference has no positions, but it has round results and a start-of-round economy snapshot.
This module turns those into:

  * economy_matchup          round win rate by (own buy tier vs opponent buy tier)
  * pistol_conversion        P(win the rounds after winning the pistol)
  * save_eco_future_value    P(win the next round | this team was on eco this round)
  * side_map_baselines       attack vs defense win rate (overall + Ascent, per half, OT)
  * round_outcome_distribution  how rounds end (elimination/detonation/defuse/time)

Every estimate carries a sample size, a Wilson 95% interval, and a **match-clustered** bootstrap
interval (Handoff §22.4: rounds within a match are correlated, so we resample whole matches).
Pistol/eco priors use the *next* round only as the outcome being measured (a descriptive future-value
prior), never as a feature for a within-round decision — no future-info leakage (Handoff §22.3).

All records carry real (synthetic=False) provenance. Buy-tier thresholds are heuristic and documented.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from collections import defaultdict
from typing import Any

from . import provenance as prov
from .stats import cluster_bootstrap_rate, wilson_interval

# --- buy-tier classification (team TOTAL loadout value, credits) -----------------------------
# Grounded on the real loadout distribution (bimodal; pistols <=4700, full buys cluster >=20000).
BUY_ECO_MAX = 5000      # < this (and not a pistol round) = eco / save
BUY_FULL_MIN = 20000    # >= this = full buy; in between = semi (half/force conflated)
PISTOL_ROUNDS = {1, 13}
REGULATION_MAX_ROUND = 24   # rounds > 24 are overtime
SMALL_SAMPLE_N = 100
BUY_TIERS = ["pistol", "eco", "semi", "full"]


def classify_buy(loadout: int | None, is_pistol: bool) -> str | None:
    if is_pistol:
        return "pistol"
    if loadout is None:
        return None
    if loadout < BUY_ECO_MAX:
        return "eco"
    if loadout < BUY_FULL_MIN:
        return "semi"
    return "full"


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _half(round_num: int) -> str:
    if round_num > REGULATION_MAX_ROUND:
        return "overtime"
    return "first" if round_num <= 12 else "second"


def _rows(con, sql, params=None):
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# --- meta era (patch) filtering --------------------------------------------------------------
# PV-1 patch-history (pv-research): Ascent is structurally stable, so map changes do NOT invalidate
# older stats; the meta driver is AGENT balance. Recommended current-meta cut: patch major >= 9.
ERAS = {"all": None, "patch>=9": 9}


def patch_major(patch: str | None) -> int | None:
    """Major version from a 'Patch 13.05' string, or None if unparseable."""
    if not patch:
        return None
    s = patch.lower().replace("patch", "").strip()
    head = s.split(".")[0].strip()
    return int(head) if head.isdigit() else None


def era_filter(rows: list[dict], era: str) -> list[dict]:
    """Keep rows whose patch major >= the era's minimum (era 'all' keeps everything)."""
    minv = ERAS.get(era)
    if minv is None:
        return rows
    out = []
    for r in rows:
        pm = patch_major(r.get("patch"))
        if pm is not None and pm >= minv:
            out.append(r)
    return out


# --- data loading ----------------------------------------------------------------------------
def load_rounds(con, international_only: bool = True) -> list[dict]:
    """One row per round (with winner + both loadouts), joined to map + match metadata."""
    where = ["r.winner_team IS NOT NULL"]
    if international_only:
        where.append("m.is_international")
    sql = f"""
        SELECT r.match_id, r.game_id, r.round_num, r.winner_team, r.side, r.outcome,
               r.loadout_t0, r.loadout_t1, mp.map_name, m.patch, m.season, m.is_international
        FROM rounds r
        JOIN maps mp ON r.game_id = mp.game_id
        JOIN matches m ON r.match_id = m.match_id
        WHERE {' AND '.join(where)}
        ORDER BY r.match_id, r.game_id, r.round_num
    """
    return _rows(con, sql)


def per_team_rows(rounds: list[dict], require_economy: bool = True) -> list[dict]:
    """Expand each round into two team perspectives (team0, team1)."""
    out = []
    for r in rounds:
        is_pistol = r["round_num"] in PISTOL_ROUNDS
        loadout = {0: r["loadout_t0"], 1: r["loadout_t1"]}
        if require_economy and (loadout[0] is None or loadout[1] is None):
            continue
        attack_team = 0 if r["side"] == "attack" else 1
        for t in (0, 1):
            opp = 1 - t
            out.append({
                "match_id": r["match_id"], "game_id": r["game_id"], "round_num": r["round_num"],
                "map_name": r["map_name"], "patch": r["patch"], "season": r["season"],
                "team": t, "won": 1 if r["winner_team"] == t else 0,
                "side": "attack" if t == attack_team else "defense",
                "own_buy": classify_buy(loadout[t], is_pistol),
                "opp_buy": classify_buy(loadout[opp], is_pistol),
                "is_pistol": is_pistol, "is_ot": r["round_num"] > REGULATION_MAX_ROUND,
                "half": _half(r["round_num"]), "outcome": r["outcome"],
            })
    return out


# --- estimate builder ------------------------------------------------------------------------
def _estimate(dims: dict, rows: list[dict], boot_iters: int, boot_seed: int) -> dict:
    n = len(rows)
    successes = sum(r["won"] for r in rows)
    rate = successes / n if n else None
    wlo, whi = wilson_interval(successes, n)
    groups: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        g = groups[r["match_id"]]
        g[0] += r["won"]
        g[1] += 1
    blo, bhi = cluster_bootstrap_rate({k: tuple(v) for k, v in groups.items()},
                                      iterations=boot_iters, seed=boot_seed)
    return {
        "dims": dims, "n": n, "successes": successes, "rate": rate,
        "wilsonLow": wlo, "wilsonHigh": whi,
        "bootstrapLow": blo, "bootstrapHigh": bhi,
        "matches": len(groups), "smallSample": n < SMALL_SAMPLE_N,
    }


def _estimate_counts(dims: dict, match_counts: dict[str, tuple[int, int]],
                     boot_iters: int, boot_seed: int) -> dict:
    """Build an estimate from pre-aggregated per-match (successes, n) counts.

    Used where the source only gives aggregates (e.g. opening duels from player_map fk/fd),
    so we never had individual rows — but match-clustered bootstrap still applies.
    """
    successes = sum(s for s, _ in match_counts.values())
    n = sum(nn for _, nn in match_counts.values())
    rate = successes / n if n else None
    wlo, whi = wilson_interval(successes, n)
    blo, bhi = cluster_bootstrap_rate(match_counts, iterations=boot_iters, seed=boot_seed)
    return {
        "dims": dims, "n": n, "successes": successes, "rate": rate,
        "wilsonLow": wlo, "wilsonHigh": whi, "bootstrapLow": blo, "bootstrapHigh": bhi,
        "matches": len(match_counts), "smallSample": n < SMALL_SAMPLE_N,
    }


def _wrap(prior_id, description, estimates, *, sha, build, filters, method_extra=None,
          grouping="match_id") -> dict:
    method = {"statistic": "binomial win/success rate", "wilsonZ": 1.959963984540054,
              "bootstrap": {"unit": "match", "iterations": 2000, "seed": 20260101},
              "buyThresholds": {"ecoMaxCredits": BUY_ECO_MAX, "fullMinCredits": BUY_FULL_MIN,
                                "pistolRounds": sorted(PISTOL_ROUNDS)},
              "notes": []}
    if method_extra:
        method.update(method_extra)
    return {
        "priorId": prior_id,
        "description": description,
        "source": {"sourceId": "vct-reference", "sourceUrl": prov.VCT_REFERENCE["sourceUrl"],
                   "sourceVersion": build, "sha256": sha, "filters": filters},
        "method": method,
        "groupingUnit": grouping,
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "estimates": estimates,
        "provenance": prov.real(evidence_type="derived", source_version=(sha[:12] if sha else None),
                                sha256=sha, verification_level=2,
                                notes=["Aggregate statistic derived from VCT Reference rounds/economy."]),
    }


# --- individual priors -----------------------------------------------------------------------
def economy_matchup(pt_rows, scope, sha, build, filters, iters=2000):
    cells = defaultdict(list)
    for r in pt_rows:
        if r["is_ot"] or r["own_buy"] is None or r["opp_buy"] is None:
            continue
        cells[(r["own_buy"], r["opp_buy"])].append(r)
    estimates = []
    for i, ob in enumerate(BUY_TIERS):
        for j, pb in enumerate(BUY_TIERS):
            rows = cells.get((ob, pb), [])
            if not rows:
                continue
            estimates.append(_estimate({"ownBuy": ob, "oppBuy": pb}, rows, iters, 20260101 + i * 10 + j))
    return _wrap(f"economy_matchup.{scope}",
                 "Round win rate by own vs opponent buy tier (OT excluded). Diagonal ~50% is a sanity check.",
                 estimates, sha=sha, build=build, filters=filters,
                 method_extra={"notes": ["Per-team perspective: each round contributes two rows "
                                         "(team0 and team1). Pistol rounds form the (pistol,pistol) cell."]})


def side_map_baselines(pt_rows, sha, build, filters, iters=2000):
    est = []
    def add(dims, pred):
        est.append(_estimate(dims, [r for r in pt_rows if pred(r)], iters, 20270000 + len(est)))
    for scope_name, map_pred in (("all_maps", lambda r: True), ("ascent", lambda r: r["map_name"] == "Ascent")):
        for side in ("attack", "defense"):
            add({"scope": scope_name, "side": side, "phase": "all"},
                lambda r, s=side, mp=map_pred: mp(r) and r["side"] == s and not r["is_ot"])
        for half in ("first", "second"):
            add({"scope": scope_name, "side": "attack", "phase": half},
                lambda r, h=half, mp=map_pred: mp(r) and r["side"] == "attack" and r["half"] == h)
        add({"scope": scope_name, "side": "attack", "phase": "overtime"},
            lambda r, mp=map_pred: mp(r) and r["side"] == "attack" and r["is_ot"])
    return _wrap("side_map_baselines",
                 "Attacker/defender win rate overall and on Ascent, by half and overtime. "
                 "'won' is from the row team's view; attacker rows give attack win rate.",
                 est, sha=sha, build=build, filters=filters)


def round_outcome_distribution(rounds, sha, build, filters, iters=2000):
    """Multinomial outcome proportions as one-vs-rest binomials (per round, not per team)."""
    est = []
    outcomes = ["elimination", "bomb_detonated", "defuse", "time_expired"]
    for scope_name, pred in (("all_maps", lambda r: True), ("ascent", lambda r: r["map_name"] == "Ascent")):
        base = [r for r in rounds if pred(r) and r["outcome"] is not None]
        for i, oc in enumerate(outcomes):
            rows = [{"won": 1 if r["outcome"] == oc else 0, "match_id": r["match_id"]} for r in base]
            est.append(_estimate({"scope": scope_name, "outcome": oc}, rows, iters, 20280000 + i))
    return _wrap("round_outcome_distribution",
                 "Share of rounds ending by elimination / spike detonation / defuse / time expiry.",
                 est, sha=sha, build=build, filters=filters, grouping="match_id")


def pistol_conversion(rounds, sha, build, filters, iters=2000):
    """P(pistol winner also wins round+1, and round+1 & round+2)."""
    winner = {(r["game_id"], r["round_num"]): r["winner_team"] for r in rounds}
    match_of = {r["game_id"]: r["match_id"] for r in rounds}
    est = []
    for half_name, p in (("first", 1), ("second", 13)):
        conv2, conv23 = [], []
        for gid, mid in match_of.items():
            pw = winner.get((gid, p))
            if pw is None:
                continue
            w1 = winner.get((gid, p + 1))
            if w1 is not None:
                conv2.append({"won": 1 if w1 == pw else 0, "match_id": mid})
            w2 = winner.get((gid, p + 2))
            if w1 is not None and w2 is not None:
                conv23.append({"won": 1 if (w1 == pw and w2 == pw) else 0, "match_id": mid})
        est.append(_estimate({"half": half_name, "step": "win_next_round"}, conv2, iters, 20290000 + p))
        est.append(_estimate({"half": half_name, "step": "win_next_two_rounds"}, conv23, iters, 20291000 + p))
    # combined halves
    conv2 = []
    for gid, mid in match_of.items():
        for p in (1, 13):
            pw = winner.get((gid, p))
            w1 = winner.get((gid, p + 1))
            if pw is not None and w1 is not None:
                conv2.append({"won": 1 if w1 == pw else 0, "match_id": mid})
    est.insert(0, _estimate({"half": "combined", "step": "win_next_round"}, conv2, iters, 20292000))
    return _wrap("pistol_conversion",
                 "P(the pistol-round winner wins the following round / following two rounds). "
                 "The following round is the measured outcome, not an input feature (no leakage).",
                 est, sha=sha, build=build, filters=filters)


def save_eco_future_value(pt_rows, sha, build, filters, iters=2000):
    """P(team wins round n+1 | team was on eco in round n), same half only (no side-swap confound)."""
    result = {(r["game_id"], r["round_num"], r["team"]): r["won"] for r in pt_rows}
    est_rows_eco, est_rows_full = [], []
    for r in pt_rows:
        n = r["round_num"]
        if n in (12, 24) or r["is_ot"]:  # next round crosses a half / OT boundary
            continue
        nxt = result.get((r["game_id"], n + 1, r["team"]))
        if nxt is None:
            continue
        row = {"won": nxt, "match_id": r["match_id"]}
        if r["own_buy"] == "eco":
            est_rows_eco.append(row)
        elif r["own_buy"] == "full":
            est_rows_full.append(row)
    est = [
        _estimate({"condition": "eco_this_round", "measured": "win_next_round"}, est_rows_eco, iters, 20300000),
        _estimate({"condition": "full_this_round", "measured": "win_next_round"}, est_rows_full, iters, 20300001),
    ]
    return _wrap("save_eco_future_value",
                 "Next-round win rate conditioned on this round's buy. eco-vs-full gap is the "
                 "measurable economic snowball behind save decisions (Handoff §15). Per-team baseline is 50%.",
                 est, sha=sha, build=build, filters=filters)


def opening_duel(con, sha, build, filters, iters=2000, era="all"):
    """Opening-duel (first-kill) win rate by side and map, from player_map fk/fd aggregates.

    VCT Reference has NO per-round kill sequence, so this is the aggregate 'which side wins the
    opening duel', NOT 'does the first-kill team win the round' (that round-conditional stat needs
    per-round kill events, absent here — see the data-gap note). Per map, summed attacker first
    kills (fk_atk) and first deaths (fd_atk) partition the rounds: fk_atk+fd_atk = rounds.
    """
    rows = _rows(con, """
        SELECT pm.match_id, pm.game_id, mp.map_name, m.patch,
               SUM(pm.fk_atk) AS fk_atk, SUM(pm.fd_atk) AS fd_atk,
               SUM(pm.fk_def) AS fk_def, SUM(pm.fd_def) AS fd_def
        FROM player_map pm
        JOIN maps mp ON pm.game_id = mp.game_id
        JOIN matches m ON pm.match_id = m.match_id
        WHERE m.is_international AND mp.performance_available
        GROUP BY pm.match_id, pm.game_id, mp.map_name, m.patch
    """)
    rows = era_filter(rows, era)

    def counts(scope_pred, numerator, denom_a, denom_b):
        acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for r in rows:
            if not scope_pred(r):
                continue
            num = r[numerator] or 0
            den = (r[denom_a] or 0) + (r[denom_b] or 0)
            g = acc[r["match_id"]]
            g[0] += num
            g[1] += den
        return {k: (v[0], v[1]) for k, v in acc.items() if v[1] > 0}

    est = []
    for scope_name, pred in (("all_maps", lambda r: True),
                             ("ascent", lambda r: r["map_name"] == "Ascent")):
        # attacker opening-duel win rate = fk_atk / (fk_atk + fd_atk)
        est.append(_estimate_counts({"scope": scope_name, "side": "attack"},
                                    counts(pred, "fk_atk", "fk_atk", "fd_atk"), iters, 20310000 + len(est)))
        # defender opening-duel win rate = fk_def / (fk_def + fd_def)
        est.append(_estimate_counts({"scope": scope_name, "side": "defense"},
                                    counts(pred, "fk_def", "fk_def", "fd_def"), iters, 20310000 + len(est)))
    return _wrap("combat_opening_duel",
                 "Opening-duel (first-blood) win rate by side and map, from player_map fk/fd "
                 "aggregates. NOTE: this is which side wins the first duel, NOT the round-conditional "
                 "'first-kill team wins the round' stat, which needs per-round kill events that VCT "
                 "Reference does not provide.",
                 est, sha=sha, build=build, filters=filters,
                 method_extra={"statistic": "opening-duel win rate (aggregate fk/fd)",
                               "notes": ["Per map, fk_atk+fd_atk = rounds. Attacker and defender rates "
                                         "sum to 1 by construction."]})


# --- play-pattern baselines (player_map / notables aggregates) -------------------------------
# These back the report-only validation metrics (tools/data-validator): KAST, clutch wins, plants
# and post-plant results, kills by agent role. VCT Reference has no kill timestamps or positions,
# so nothing timed (first-kill time, round duration, trades) or positional can be derived here.
PLAY_PRIOR_IDS = ("kast", "clutch_wins_per_round", "plant_post_plant", "role_kill_share")
CLUTCH_SIZES = ("1v1", "1v2", "1v3", "1v4", "1v5")
_SCOPES = (("all_maps", lambda r: True), ("ascent", lambda r: r["map_name"] == "Ascent"))


def _has_columns(con, table: str, columns: tuple[str, ...]) -> bool:
    have = {r[0] for r in con.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = ?", [table]).fetchall()}
    return all(c in have for c in columns)


def _match_counts(rows, pred, successes, n) -> dict[str, tuple[int, int]]:
    """Per-match (successes, n) from rows, for the match-clustered bootstrap."""
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        if not pred(r):
            continue
        g = acc[r["match_id"]]
        g[0] += int(successes(r) or 0)
        g[1] += int(n(r) or 0)
    return {k: (v[0], v[1]) for k, v in acc.items() if v[1] > 0}


def _team_side_rounds(con) -> dict[tuple[str, int], dict[str, int]]:
    """(game_id, team_idx) -> rounds played on attack / defense. `rounds.side` is team 0's side."""
    out: dict[tuple[str, int], dict[str, int]] = {}
    for g, side, c in con.execute(
            "SELECT game_id, side, COUNT(*) FROM rounds WHERE winner_team IS NOT NULL GROUP BY 1, 2").fetchall():
        for team in (0, 1):
            own = side if team == 0 else ("defense" if side == "attack" else "attack")
            out.setdefault((g, team), {"attack": 0, "defense": 0})[own] = \
                out.setdefault((g, team), {"attack": 0, "defense": 0})[own] + c
    return out


def kast(con, sha, build, filters, iters=2000, era="all"):
    """KAST — share of a player's rounds with a Kill, Assist, Survival or Traded death.

    player_map carries KAST as a per-map percentage (overall and per side). Each player-map is
    weighted by the rounds it covers (the map's rounds; per side, the rounds that team attacked /
    defended), so `n` is player-rounds and `successes` the implied KAST rounds (rounded per map).
    """
    rows = _rows(con, """
        SELECT pm.match_id, pm.game_id, pm.team_idx, mp.map_name, m.patch,
               pm.kast_all, pm.kast_atk, pm.kast_def
        FROM player_map pm
        JOIN maps mp ON pm.game_id = mp.game_id
        JOIN matches m ON pm.match_id = m.match_id
        WHERE m.is_international AND mp.performance_available AND pm.kast_all IS NOT NULL
    """)
    rows = era_filter(rows, era)
    side_rounds = _team_side_rounds(con)
    for r in rows:
        sr = side_rounds.get((r["game_id"], r["team_idx"]), {"attack": 0, "defense": 0})
        r["rounds_attack"], r["rounds_defense"] = sr["attack"], sr["defense"]
        r["rounds_all"] = sr["attack"] + sr["defense"]
    est = []
    for scope_name, pred in _SCOPES:
        for side, col, rcol in (("all", "kast_all", "rounds_all"), ("attack", "kast_atk", "rounds_attack"),
                                ("defense", "kast_def", "rounds_defense")):
            counts = _match_counts(
                rows, lambda r, col=col, rcol=rcol, pred=pred: pred(r) and r[col] is not None and r[rcol] > 0,
                lambda r, col=col, rcol=rcol: round(r[col] / 100.0 * r[rcol]), lambda r, rcol=rcol: r[rcol])
            est.append(_estimate_counts({"scope": scope_name, "side": side}, counts, iters, 20320000 + len(est)))
    return _wrap("kast",
                 "KAST: share of player-rounds with a kill, an assist, a survival or a traded death "
                 "(player_map kast_all / kast_atk / kast_def, weighted by rounds).",
                 est, sha=sha, build=build, filters=filters,
                 method_extra={"statistic": "round-weighted mean of per-map KAST percentages",
                               "notes": ["n = player-rounds; successes = sum over player-maps of round(KAST% x rounds).",
                                         "The source publishes KAST as a whole percent per map, so each player-map "
                                         "carries up to +-0.5 percentage points of rounding.",
                                         "The trade window behind the source's 'T' is not documented."]})


def clutch_wins_per_round(con, sha, build, filters, iters=2000, era="all"):
    """How often a round is won by a 1vX clutch, by X.

    The source lists every clutch WON (notables: clutch_1v1..1v5, with its round); it does not
    list clutch attempts, so a clutch win RATE (wins / attempts) cannot be derived — only the
    frequency of clutch wins per round. Denominator: rounds of the maps that carry the detail
    block (maps with at least one notable row of any kind).
    """
    games = _rows(con, """
        SELECT r.match_id, r.game_id, mp.map_name, m.patch, COUNT(*) AS rounds
        FROM rounds r
        JOIN maps mp ON r.game_id = mp.game_id
        JOIN matches m ON r.match_id = m.match_id
        WHERE m.is_international AND r.winner_team IS NOT NULL
          AND r.game_id IN (SELECT DISTINCT game_id FROM notables)
        GROUP BY 1, 2, 3, 4
    """)
    games = era_filter(games, era)
    won = {(g, st): c for g, st, c in con.execute(
        "SELECT game_id, stat_type, COUNT(*) FROM notables WHERE stat_type LIKE 'clutch_%' GROUP BY 1, 2").fetchall()}
    est = []
    for scope_name, pred in _SCOPES:
        for size in CLUTCH_SIZES:
            counts = _match_counts(games, pred, lambda r, size=size: won.get((r["game_id"], f"clutch_{size}"), 0),
                                   lambda r: r["rounds"])
            est.append(_estimate_counts({"scope": scope_name, "x": size}, counts, iters, 20330000 + len(est)))
        counts = _match_counts(games, pred,
                               lambda r: sum(won.get((r["game_id"], f"clutch_{s}"), 0) for s in CLUTCH_SIZES),
                               lambda r: r["rounds"])
        est.append(_estimate_counts({"scope": scope_name, "x": "any"}, counts, iters, 20330000 + len(est)))
    return _wrap("clutch_wins_per_round",
                 "Share of rounds won by a 1vX clutch (the last player alive on a team winning the round "
                 "against X opponents alive), by X. Clutch wins only: the source has no clutch attempts.",
                 est, sha=sha, build=build, filters=filters,
                 method_extra={"statistic": "clutch wins per round (notables clutch_1vX / rounds)",
                               "notes": ["n = rounds on maps that carry the detail block; successes = clutches won.",
                                         "X is the number of opponents alive when the player became the last alive."]})


def plant_post_plant(con, sha, build, filters, iters=2000, era="all"):
    """Plant rate, and how planted rounds end.

    Plants per map come from player_map.plants (summed over both teams); the rounds table says
    how each round ended. After a plant the defense can only win by defusing, so
        post-plant attack win rate = 1 - defuses / plants.
    """
    games = _rows(con, """
        SELECT r.match_id, r.game_id, mp.map_name, m.patch, COUNT(*) AS rounds,
               COUNT(*) FILTER (WHERE r.outcome = 'defuse') AS defuses,
               COUNT(*) FILTER (WHERE r.outcome = 'bomb_detonated') AS detonations
        FROM rounds r
        JOIN maps mp ON r.game_id = mp.game_id
        JOIN matches m ON r.match_id = m.match_id
        WHERE m.is_international AND mp.performance_available AND r.winner_team IS NOT NULL
        GROUP BY 1, 2, 3, 4
    """)
    games = era_filter(games, era)
    plants = dict(con.execute("SELECT game_id, SUM(plants) FROM player_map GROUP BY 1").fetchall())
    for g in games:
        # A map's plants can never be fewer than its spike-decided rounds; keep the data honest.
        g["plants"] = max(int(plants.get(g["game_id"]) or 0), g["defuses"] + g["detonations"])
        g["plants"] = min(g["plants"], g["rounds"])
    est = []
    for scope_name, pred in _SCOPES:
        est.append(_estimate_counts({"scope": scope_name, "measure": "plant_rate"},
                                    _match_counts(games, pred, lambda r: r["plants"], lambda r: r["rounds"]),
                                    iters, 20340000 + len(est)))
        est.append(_estimate_counts({"scope": scope_name, "measure": "post_plant_attack_win"},
                                    _match_counts(games, pred, lambda r: r["plants"] - r["defuses"], lambda r: r["plants"]),
                                    iters, 20340000 + len(est)))
        est.append(_estimate_counts({"scope": scope_name, "measure": "post_plant_detonation"},
                                    _match_counts(games, pred, lambda r: r["detonations"], lambda r: r["plants"]),
                                    iters, 20340000 + len(est)))
    return _wrap("plant_post_plant",
                 "Plant rate (plants / rounds) and post-plant results: attack win rate after a plant "
                 "(1 - defuses / plants) and the share of plants that detonate.",
                 est, sha=sha, build=build, filters=filters,
                 method_extra={"statistic": "plants per round; post-plant outcome shares",
                               "notes": ["plant_rate: n = rounds, successes = plants (player_map.plants summed per map).",
                                         "post_plant_*: n = plants. A planted round is lost by the attack only through a defuse."]})


def _agent_key(agent: str | None) -> str:
    return "".join(ch for ch in (agent or "").lower() if ch.isalnum())


def load_agent_roles(path: str) -> dict[str, str]:
    """agent slug -> role (lower-case) from the game-data agents catalog (packages/game-data/data/agents.json)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {_agent_key(a.get("slug")): str(a["role"]).lower() for a in data if a.get("role")}


def role_kill_share(con, roles: dict[str, str], sha, build, filters, iters=2000, era="all"):
    """Kills / (kills + deaths) by the role of the agent played — K/D as a proportion.

    K/D = share / (1 - share). Roles come from the game-data agents catalog; player-maps whose
    agent is not in the catalog are left out (their count is recorded in the method notes).
    """
    rows = _rows(con, """
        SELECT pm.match_id, pm.game_id, mp.map_name, m.patch, pm.agents[1] AS agent,
               pm.kills_all AS kills, pm.deaths_all AS deaths
        FROM player_map pm
        JOIN maps mp ON pm.game_id = mp.game_id
        JOIN matches m ON pm.match_id = m.match_id
        WHERE m.is_international AND mp.performance_available
    """)
    rows = era_filter(rows, era)
    unknown = 0
    for r in rows:
        r["role"] = roles.get(_agent_key(r["agent"]))
        if r["role"] is None:
            unknown += 1
    est = []
    for scope_name, pred in _SCOPES:
        for role in sorted(set(roles.values())):
            counts = _match_counts(rows, lambda r, role=role, pred=pred: pred(r) and r["role"] == role,
                                   lambda r: r["kills"], lambda r: (r["kills"] or 0) + (r["deaths"] or 0))
            est.append(_estimate_counts({"scope": scope_name, "role": role}, counts, iters, 20350000 + len(est)))
    return _wrap("role_kill_share",
                 "Kills / (kills + deaths) by agent role (controller, duelist, initiator, sentinel). "
                 "K/D = share / (1 - share).",
                 est, sha=sha, build=build, filters=filters,
                 method_extra={"statistic": "kill share by agent role (player_map kills_all, deaths_all)",
                               "notes": ["n = kills + deaths of the role; successes = kills.",
                                         f"{unknown} player-maps had an agent missing from the role catalog and were left out."]})


def build_play_priors(con, sha, build, iters=2000, era="all", agent_roles_path: str | None = None) -> dict[str, dict]:
    """The play-pattern baselines the database (and, for roles, the agents catalog) can support.

    A prior is omitted — not guessed — when the database lacks the columns it needs (older or
    trimmed builds) or, for role_kill_share, when no agents catalog is given.
    """
    f = {"international": True, "performanceAvailable": True, "era": era}
    out: dict[str, dict] = {}
    if _has_columns(con, "player_map", ("kast_all", "kast_atk", "kast_def", "team_idx")):
        out["kast"] = kast(con, sha, build, {**f, "kastKnown": True}, iters, era)
    if _has_columns(con, "notables", ("stat_type", "game_id")):
        out["clutch_wins_per_round"] = clutch_wins_per_round(
            con, sha, build, {"international": True, "detailBlockAvailable": True, "era": era}, iters, era)
    if _has_columns(con, "player_map", ("plants",)):
        out["plant_post_plant"] = plant_post_plant(con, sha, build, {**f, "winnerKnown": True}, iters, era)
    if agent_roles_path and _has_columns(con, "player_map", ("agents", "kills_all", "deaths_all")):
        out["role_kill_share"] = role_kill_share(
            con, load_agent_roles(agent_roles_path), sha, build, {**f, "roleSource": "game-data agents.json"}, iters, era)
    return out


# --- orchestration ---------------------------------------------------------------------------
def build_all(duckdb_path: str, iters: int = 2000, era: str = "all",
              agent_roles_path: str | None = None) -> dict[str, dict]:
    import duckdb
    if os.path.exists(duckdb_path) is False:
        raise FileNotFoundError(duckdb_path)
    if era not in ERAS:
        raise ValueError(f"unknown era {era!r}; known: {sorted(ERAS)}")
    sha = _sha256(duckdb_path)
    build = None
    src = os.path.join(os.path.dirname(duckdb_path), "SOURCE.json")
    if os.path.exists(src):
        build = json.load(open(src)).get("sourceVersion")
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        rounds_intl = era_filter(load_rounds(con, international_only=True), era)
        pt_all = per_team_rows(rounds_intl, require_economy=True)
        pt_ascent = [r for r in pt_all if r["map_name"] == "Ascent"]
        base_filter = {"international": True, "economyAvailable": True, "winnerKnown": True, "era": era}
        bf2 = {"international": True, "winnerKnown": True, "era": era}
        out = {
            "economy_matchup.international": economy_matchup(
                pt_all, "international", sha, build, {**base_filter, "scope": "all international maps"}, iters),
            "economy_matchup.ascent": economy_matchup(
                pt_ascent, "ascent", sha, build, {**base_filter, "scope": "international Ascent only"}, iters),
            "side_map_baselines": side_map_baselines(
                pt_all, sha, build, {**base_filter, "scope": "international; all maps + Ascent"}, iters),
            "round_outcome_distribution": round_outcome_distribution(
                rounds_intl, sha, build, {**bf2, "note": "economy not required"}, iters),
            "pistol_conversion": pistol_conversion(
                rounds_intl, sha, build, {**bf2, "note": "economy not required; round results only"}, iters),
            "save_eco_future_value": save_eco_future_value(
                pt_all, sha, build, {**base_filter, "scope": "international; same-half next round"}, iters),
            "combat_opening_duel": opening_duel(
                con, sha, build, {"international": True, "performanceAvailable": True, "era": era,
                                  "note": "aggregate fk/fd; no per-round kill sequence in source"}, iters, era),
        }
        out.update(build_play_priors(con, sha, build, iters, era, agent_roles_path))
        # tag the era into each priorId so files from different eras never collide.
        for p in out.values():
            p["source"]["filters"]["era"] = era
        return out
    finally:
        con.close()


def write_all(duckdb_path: str, out_dir: str, iters: int = 2000, era: str = "all",
              agent_roles_path: str | None = None, only: list[str] | None = None) -> dict[str, str]:
    """Write the priors as <out_dir>/<priorId>.json. `only` restricts the files written (the others
    are still computed, but left untouched on disk — e.g. to add new priors without re-stamping
    the existing ones)."""
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    for prior_id, payload in build_all(duckdb_path, iters, era, agent_roles_path).items():
        if only and prior_id not in only:
            continue
        path = os.path.join(out_dir, f"{prior_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written[prior_id] = path
    return written
