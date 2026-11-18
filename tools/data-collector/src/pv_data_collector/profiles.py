"""Team behaviour profiles from VCT Reference round + economy data (Handoff P4, README §24).

What a box score supports is ECONOMIC and SIDE/MAP tendency: how a team buys after losses, after a
pistol loss, on bonus rounds, against an eco, and at match point; plus attack/defense and map records.
Tactical tendencies that need positions (site preference, execute tempo, default setups) are left
null + reason — never invented.

Point-in-time: build_team_profiles(db, as_of=...) uses only matches strictly BEFORE as_of, so a
simulation can reproduce the opponent profile a team would have had at a past date without leaking
future results (Handoff §22.3).

Rates are empirical-Bayes (Beta-binomial) shrunk toward the league mean by sample size, so a team with
few maps sits near average. Records are keyed by teamId ONLY (no names committed).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
from collections import defaultdict
from statistics import mean, pstdev
from typing import Any

# Buy tiers — identical thresholds to priors.py / round-value features.
BUY_ECO_MAX = 5000
BUY_FULL_MIN = 20000
PISTOL_ROUNDS = {1, 13}
REGULATION_MAX_ROUND = 24
MIN_MAPS_QUALIFY = 5
_NOW = ""

# Tactical tendencies we CANNOT estimate from a box score.
UNESTIMABLE = {
    "sitePreference": "needs per-round plant site / positions (Layer B not available)",
    "executeTempo": "needs timing of site hits (no per-round timeline in VCT Reference)",
    "defaultSetup": "needs player positions",
    "utilityUsage": "needs ability-usage data",
    "rotationTendency": "needs positional/timing data",
    "lurkTendency": "needs positional data",
    "retakeVsSaveTendency": "needs post-plant positions/outcomes per round",
    "fakeTendency": "needs utility + movement traces",
}


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def classify_buy(loadout, is_pistol):
    if is_pistol:
        return "pistol"
    if loadout is None or loadout < BUY_ECO_MAX:
        return "eco"
    if loadout < BUY_FULL_MIN:
        return "semi"
    return "full"


def _rows(con, sql, params=None):
    cur = con.execute(sql, params or [])
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def load_rounds(con, as_of: str | None):
    where = ["m.is_international", "r.winner_team IS NOT NULL",
             "r.loadout_t0 IS NOT NULL", "r.loadout_t1 IS NOT NULL"]
    params = []
    if as_of:
        where.append("m.utc_timestamp < ?")
        params.append(as_of)
    sql = f"""
        SELECT r.match_id, r.game_id, r.round_num, r.winner_team, r.side,
               r.loadout_t0, r.loadout_t1, mp.map_name, m.season, m.utc_timestamp,
               m.team0_id, m.team1_id
        FROM rounds r JOIN maps mp ON r.game_id = mp.game_id JOIN matches m ON r.match_id = m.match_id
        WHERE {' AND '.join(where)}
        ORDER BY m.utc_timestamp, r.match_id, r.game_id, r.round_num
    """
    return _rows(con, sql, params)


class Counter:
    __slots__ = ("s", "n")

    def __init__(self):
        self.s = 0
        self.n = 0

    def add(self, hit):
        self.n += 1
        self.s += 1 if hit else 0


def _team_tallies(rounds):
    """Per team: economic + side counters, and per-season rates for stability."""
    teams: dict[int, dict] = defaultdict(lambda: {
        "maps": set(), "seasons": set(), "mapPool": defaultdict(int),
        "postLossForce": Counter(), "postLossByTier": defaultdict(Counter),
        "pistolLossForce": Counter(), "bonusBuy": Counter(), "antiEcoFullBuy": Counter(),
        "overtimeForce": Counter(),
        "attackWins": Counter(), "defenseWins": Counter(),
        "firstHalfAtkWins": Counter(), "secondHalfAtkWins": Counter(),
        "ascentAttackWins": Counter(),
        "seasonForce": defaultdict(Counter),  # season -> postLossForce (stability)
        "seasonAttack": defaultdict(Counter),  # season -> attack win (stability)
    })
    by_game: dict[str, list] = defaultdict(list)
    for r in rounds:
        by_game[r["game_id"]].append(r)

    for gid, grs in by_game.items():
        grs.sort(key=lambda r: r["round_num"])
        map_name = grs[0]["map_name"]
        season = grs[0]["season"]
        t0, t1 = grs[0]["team0_id"], grs[0]["team1_id"]
        for t in (t0, t1):
            teams[t]["maps"].add(gid)
            teams[t]["seasons"].add(season)
            teams[t]["mapPool"][map_name] += 1
        streak = {t0: 0, t1: 0}
        prev_winner = None
        for i, r in enumerate(grs):
            atk = t0 if r["side"] == "attack" else t1
            dfn = t1 if atk == t0 else t0
            winner_id = t0 if r["winner_team"] == 0 else t1  # winner_team is a 0/1 index, not an id
            is_pistol = r["round_num"] in PISTOL_ROUNDS
            tier = {t0: classify_buy(r["loadout_t0"], is_pistol),
                    t1: classify_buy(r["loadout_t1"], is_pistol)}
            is_ot = r["round_num"] > REGULATION_MAX_ROUND

            # economic tendencies (team perspective), excluding pistols for buy-choice stats
            for t in (t0, t1):
                opp = t1 if t == t0 else t0
                tb = teams[t]
                if not is_pistol and not is_ot:
                    if streak[t] >= 1:  # team lost the previous round
                        bought = tier[t] in ("semi", "full")
                        tb["postLossForce"].add(bought)
                        key = "1" if streak[t] == 1 else "2" if streak[t] == 2 else "3plus"
                        tb["postLossByTier"][key].add(bought)
                        tb["seasonForce"][season].add(bought)
                    if tier[opp] == "eco":  # opponent on eco -> do we field a full buy?
                        tb["antiEcoFullBuy"].add(tier[t] == "full")
                # pistol-loss response: previous round was a pistol this team lost
                if r["round_num"] in (2, 14) and prev_winner is not None and prev_winner != t:
                    teams[t]["pistolLossForce"].add(tier[t] in ("semi", "full"))
                # bonus buy: round after this team won a pistol — do they spend (semi/full) or save (eco)?
                if r["round_num"] in (2, 14) and prev_winner == t:
                    teams[t]["bonusBuy"].add(tier[t] in ("semi", "full"))
                if is_ot and not is_pistol:
                    teams[t]["overtimeForce"].add(tier[t] in ("semi", "full"))

            # side/map outcomes
            atk_won = winner_id == atk
            teams[atk]["attackWins"].add(atk_won)
            teams[atk]["seasonAttack"][season].add(atk_won)
            teams[dfn]["defenseWins"].add(not atk_won)
            half = "first" if r["round_num"] <= 12 else "second" if not is_ot else "ot"
            if half == "first":
                teams[atk]["firstHalfAtkWins"].add(atk_won)
            elif half == "second":
                teams[atk]["secondHalfAtkWins"].add(atk_won)
            if map_name == "Ascent":
                teams[atk]["ascentAttackWins"].add(atk_won)

            # update loss streaks (keyed by team id) and the previous-round winner
            loser = t1 if winner_id == t0 else t0
            streak[winner_id] = 0
            streak[loser] = streak.get(loser, 0) + 1
            prev_winner = winner_id
    return teams


# --- Beta-binomial empirical-Bayes shrinkage --------------------------------------------------
def _beta_mom(rates: list[float]) -> float:
    """Method-of-moments pseudocount (a+b) for Beta-binomial shrinkage from league team rates."""
    rates = [r for r in rates if r is not None]
    if len(rates) < 3:
        return 20.0
    m = mean(rates)
    v = pstdev(rates) ** 2
    if v <= 1e-9 or m <= 0 or m >= 1:
        return 50.0
    k = m * (1 - m) / v - 1
    return max(1.0, min(500.0, k))


def _shrunk_rate(counter: Counter, league_mean: float, k: float):
    if counter.n == 0:
        return None
    raw = counter.s / counter.n
    value = (counter.s + league_mean * k) / (counter.n + k)
    uncertainty = round(min(0.5, (k / (counter.n + k)) * 0.5 + (0.05 if counter.n < 30 else 0)), 4)
    return {"value": round(value, 4), "raw": round(raw, 4), "n": counter.n, "uncertainty": uncertainty}


def build_team_profiles(duckdb_path: str, as_of: str | None = None) -> dict[str, Any]:
    import duckdb
    if not os.path.exists(duckdb_path):
        raise FileNotFoundError(duckdb_path)
    sha = _sha256(duckdb_path)
    global _NOW
    _NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        rounds = load_rounds(con, as_of)
    finally:
        con.close()
    teams = _team_tallies(rounds)

    # league means + pseudocounts per rate
    def league(attr, sub=None):
        vals = []
        for tb in teams.values():
            c = tb[attr][sub] if sub else tb[attr]
            if c.n > 0:
                vals.append(c.s / c.n)
        return (mean(vals) if vals else 0.5), _beta_mom(vals)

    rate_specs = {
        "forceBuyAfterLoss": ("postLossForce", None),
        "pistolLossForceBuy": ("pistolLossForce", None),
        "bonusBuyRate": ("bonusBuy", None),
        "antiEcoFullBuy": ("antiEcoFullBuy", None),
        "overtimeForceBuy": ("overtimeForce", None),
        "attackWinRate": ("attackWins", None),
        "defenseWinRate": ("defenseWins", None),
    }
    league_params = {name: league(attr, sub) for name, (attr, sub) in rate_specs.items()}
    tier_params = {k: league("postLossByTier", k) for k in ("1", "2", "3plus")}

    records = []
    for tid, tb in sorted(teams.items(), key=lambda kv: -len(kv[1]["maps"])):
        maps = len(tb["maps"])
        low = maps < MIN_MAPS_QUALIFY
        econ = {}
        for name, (attr, sub) in rate_specs.items():
            if attr in ("attackWins", "defenseWins"):
                continue
            mu, k = league_params[name]
            econ[name] = _shrunk_rate(tb[attr], mu, k) or {"value": None, "reason": "no qualifying rounds"}
        econ["forceBuyAfterLossByTier"] = {}
        for key in ("1", "2", "3plus"):
            mu, k = tier_params[key]
            econ["forceBuyAfterLossByTier"][key] = _shrunk_rate(tb["postLossByTier"][key], mu, k) or \
                {"value": None, "reason": "no post-loss rounds at this tier"}

        mu_a, k_a = league_params["attackWinRate"]
        mu_d, k_d = league_params["defenseWinRate"]
        asc = _shrunk_rate(tb["ascentAttackWins"], mu_a, k_a) or {"value": None, "reason": "no Ascent maps"}
        fh = tb["firstHalfAtkWins"]
        sh = tb["secondHalfAtkWins"]
        half_dev = None
        if fh.n > 0 and sh.n > 0:
            half_dev = round((fh.s / fh.n) - (sh.s / sh.n), 4)
        side = {
            "attackWinRate": _shrunk_rate(tb["attackWins"], mu_a, k_a),
            "defenseWinRate": _shrunk_rate(tb["defenseWins"], mu_d, k_d),
            "ascentAttackWinRate": asc,
            "firstMinusSecondHalfAttack": {"value": half_dev,
                                           "reason": None if half_dev is not None else "insufficient half data"},
        }
        tactical = {name: {"value": None, "reason": reason} for name, reason in UNESTIMABLE.items()}

        records.append({
            "teamId": str(tid), "maps": maps, "seasons": sorted(s for s in tb["seasons"] if s is not None),
            "mapPool": dict(sorted(tb["mapPool"].items(), key=lambda kv: -kv[1])),
            "lowSample": low,
            "economy": econ, "side": side, "tacticalNull": tactical,
            "provenance": {"sourceId": "vct-reference",
                           "sourceUrl": "https://vct-reference.com/dataset/vct.duckdb",
                           "retrievedAt": _NOW, "sha256": sha, "synthetic": False,
                           "evidenceType": "derived", "verified": False, "confidence": None,
                           "notes": ["Team tendency estimate from public match economy; NOT a scouting truth."
                                     + (f" asOf={as_of}" if as_of else "")]},
        })

    meta = {
        "generatedAt": _NOW,
        "source": {"sourceId": "vct-reference", "sha256": sha, "scope": "international",
                   "teams": len(records), "asOf": as_of},
        "method": {"shrinkage": "Beta-binomial empirical Bayes toward league mean",
                   "buyThresholds": {"ecoMax": BUY_ECO_MAX, "fullMin": BUY_FULL_MIN},
                   "forceBuy": "loadout tier in {semi,full} (not eco) in a non-pistol, non-OT round",
                   "leagueParams": {k: {"mean": round(v[0], 4), "pseudocount": round(v[1], 1)}
                                    for k, v in league_params.items()}},
        "disclaimer": ("Team tendencies are statistical ESTIMATES from public match economy data, not "
                       "verified scouting intel. Tactical tendencies needing positions are null. Team "
                       "names are not committed (teamId only). Real-name use in a shipped game is a "
                       "user/legal decision — see docs/research/TEAM_PROFILES.md."),
        "unestimableTactical": UNESTIMABLE,
    }
    return {"profiles": records, "meta": meta, "_teams": teams}


def _season_corr(teams, attr: str, min_n: int = 10) -> dict:
    """Correlate a team's season-S rate with its season-(S+1) rate across all teams (stability)."""
    import math
    xs, ys = [], []
    for tb in teams.values():
        seasons = sorted(s for s in tb[attr] if s is not None)
        for a, b in zip(seasons, seasons[1:]):
            ca, cb = tb[attr][a], tb[attr][b]
            if ca.n >= min_n and cb.n >= min_n:
                xs.append(ca.s / ca.n)
                ys.append(cb.s / cb.n)
    if len(xs) < 3:
        return {"pairs": len(xs), "correlation": None, "note": "insufficient multi-season teams"}
    mx, my = mean(xs), mean(ys)
    num = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    dx = math.sqrt(sum((a - mx) ** 2 for a in xs))
    dy = math.sqrt(sum((b - my) ** 2 for b in ys))
    corr = num / (dx * dy) if dx > 0 and dy > 0 else None
    return {"pairs": len(xs), "correlation": round(corr, 3) if corr is not None else None,
            "interpretation": ("stable season-to-season" if (corr or 0) >= 0.4 else
                               "roster/meta dependent (weak season-to-season persistence)")}


def season_stability(duckdb_path: str) -> dict:
    """Season-to-season persistence of two tendencies. Low correlation => roster/meta dependent."""
    teams = build_team_profiles(duckdb_path)["_teams"]
    return {
        "forceBuyAfterLoss": _season_corr(teams, "seasonForce"),
        "attackWinRate": _season_corr(teams, "seasonAttack"),
    }


def write_profiles(duckdb_path: str, out_dir: str, as_of: str | None = None) -> dict[str, str]:
    import json
    built = build_team_profiles(duckdb_path, as_of)
    built["meta"]["stability"] = season_stability(duckdb_path)
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    for name, payload in (("team_profiles.json", built["profiles"]),
                          ("team_profiles_meta.json", built["meta"])):
        p = os.path.join(out_dir, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written[name] = p
    return written
