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


# --- orchestration ---------------------------------------------------------------------------
def build_all(duckdb_path: str, iters: int = 2000) -> dict[str, dict]:
    import duckdb
    if not os.path.exists(duckdb_path):
        raise FileNotFoundError(duckdb_path)
    sha = _sha256(duckdb_path)
    build = None
    src = os.path.join(os.path.dirname(duckdb_path), "SOURCE.json")
    if os.path.exists(src):
        build = json.load(open(src)).get("sourceVersion")
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        rounds_intl = load_rounds(con, international_only=True)
        pt_all = per_team_rows(rounds_intl, require_economy=True)
        pt_ascent = [r for r in pt_all if r["map_name"] == "Ascent"]
        base_filter = {"international": True, "economyAvailable": True, "winnerKnown": True}
        out = {
            "economy_matchup.international": economy_matchup(
                pt_all, "international", sha, build, {**base_filter, "scope": "all international maps"}, iters),
            "economy_matchup.ascent": economy_matchup(
                pt_ascent, "ascent", sha, build, {**base_filter, "scope": "international Ascent only"}, iters),
            "side_map_baselines": side_map_baselines(
                pt_all, sha, build, {**base_filter, "scope": "international; all maps + Ascent"}, iters),
            "round_outcome_distribution": round_outcome_distribution(
                rounds_intl, sha, build, {"international": True, "winnerKnown": True,
                                          "note": "economy not required"}, iters),
            "pistol_conversion": pistol_conversion(
                rounds_intl, sha, build, {"international": True, "winnerKnown": True,
                                          "note": "economy not required; round results only"}, iters),
            "save_eco_future_value": save_eco_future_value(
                pt_all, sha, build, {**base_filter, "scope": "international; same-half next round"}, iters),
        }
        return out
    finally:
        con.close()


def write_all(duckdb_path: str, out_dir: str, iters: int = 2000) -> dict[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    for prior_id, payload in build_all(duckdb_path, iters).items():
        path = os.path.join(out_dir, f"{prior_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written[prior_id] = path
    return written
