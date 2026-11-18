"""Estimate player attributes from VCT Reference stats, WITH uncertainty (README §23, §07).

Honesty rules (enforced by structure + tests):
  * Only attributes a published box-score actually supports are estimated. Positioning, utility
    usage, movement, comms, etc. need positional/replay data VCT Reference does not have, so they are
    returned as null + a reason — never invented.
  * Every estimate is empirical-Bayes SHRUNK toward the league (or role) mean by sample size, so a
    player with few maps sits near average, not at an extreme.
  * Role/agent effects are separated for role-driven stats (e.g. duelists naturally take more opening
    duels), by ranking those within role.
  * Records are keyed by player_id ONLY (no names committed). These are estimates from public match
    stats, NOT real skill assessments (see docs/research/PLAYER_RATINGS.md).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import math
import os
from collections import defaultdict
from statistics import mean, pstdev
from typing import Any

MIN_MAPS_QUALIFY = 5  # below this a player is flagged lowSample (still estimated, shrunk hard)
_NOW = ""  # set at build time; used in each record's provenance.retrievedAt

AGENT_ROLE = {
    # duelists
    "jett": "duelist", "raze": "duelist", "neon": "duelist", "phoenix": "duelist",
    "reyna": "duelist", "yoru": "duelist", "iso": "duelist", "waylay": "duelist",
    # initiators
    "sova": "initiator", "breach": "initiator", "skye": "initiator", "kayo": "initiator",
    "fade": "initiator", "gekko": "initiator", "tejo": "initiator",
    # controllers
    "brimstone": "controller", "omen": "controller", "viper": "controller", "astra": "controller",
    "harbor": "controller", "clove": "controller",
    # sentinels
    "killjoy": "sentinel", "cypher": "sentinel", "sage": "sentinel", "chamber": "sentinel",
    "deadlock": "sentinel", "vyse": "sentinel",
    # unknown / newer agents in the data we will not guess
    "miks": "unknown", "veto": "unknown", "hush": "unknown",
}

# Attributes we CANNOT estimate from a box score, with the reason (kept null, never invented).
UNESTIMABLE = {
    "movement": "needs positional/replay data (no movement traces in VCT Reference)",
    "weaponControl": "needs per-spray data (not in box scores)",
    "positioning": "needs player positions (Layer B not available)",
    "utilityUsage": "needs ability-usage/outcome data (not in VCT Reference)",
    "mapAwareness": "needs positional/timing data",
    "rotations": "needs positional/timing data",
    "communication": "no comms data exists",
    "teamworkDiscipline": "no setup/execution-timing data",
    "lurking": "needs positional data",
    "anchoring": "needs positional data",
    "weaponPreference": "weapon-choice per round not in VCT Reference box scores",
    "agentMastery": "needs per-agent skill baselines; only agent pool is observed",
}


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _rows(con, sql, params=None):
    cur = con.execute(sql, params or [])
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def load_player_maps(con):
    return _rows(con, """
        SELECT pm.player_id, pm.game_id, m.season, pm.agents,
               pm.acs_all, pm.adr_all, pm.kast_all, pm.hs_pct_all, pm.rating_all,
               pm.fk_all, pm.fd_all,
               (pm.clutch_1v1 + pm.clutch_1v2 + pm.clutch_1v3 + pm.clutch_1v4 + pm.clutch_1v5) AS clutches
        FROM player_map pm JOIN matches m ON pm.match_id = m.match_id
        WHERE m.is_international
    """)


def role_of(agent_counts: dict[str, int]) -> str:
    roles: dict[str, int] = defaultdict(int)
    for ag, c in agent_counts.items():
        roles[AGENT_ROLE.get(ag, "unknown")] += c
    # dominant role ignoring 'unknown' when possible
    known = {r: c for r, c in roles.items() if r != "unknown"}
    pool = known or roles
    return max(pool, key=pool.get)


def _player_aggregates(pmaps):
    by_player: dict[int, list] = defaultdict(list)
    for r in pmaps:
        by_player[r["player_id"]].append(r)
    agg = {}
    for pid, rows in by_player.items():
        agents: dict[str, int] = defaultdict(int)
        for r in rows:
            for a in (r["agents"] or []):
                agents[a] += 1

        def col(name):
            return [r[name] for r in rows if r[name] is not None]

        ratings = col("rating_all")
        fk = sum(r["fk_all"] or 0 for r in rows)
        fd = sum(r["fd_all"] or 0 for r in rows)
        opening_wr = fk / (fk + fd) if (fk + fd) > 0 else 0.5
        agg[pid] = {
            "player_id": pid, "maps": len(rows), "seasons": sorted({r["season"] for r in rows}),
            "role": role_of(agents), "agentPool": sorted(agents),
            "raw": {
                "acs": mean(col("acs_all")) if col("acs_all") else None,
                "adr": mean(col("adr_all")) if col("adr_all") else None,
                "kast": mean(col("kast_all")) if col("kast_all") else None,
                "hsPct": mean(col("hs_pct_all")) if col("hs_pct_all") else None,
                "rating": mean(ratings) if ratings else None,
                "openingWinRate": opening_wr,
                "fkPerMap": fk / len(rows),
                "clutchPerMap": sum(r["clutches"] or 0 for r in rows) / len(rows),
            },
            "ratingStd": pstdev(ratings) if len(ratings) >= 2 else None,
            "_rows": rows,
        }
    return agg


def _shrink_params(agg, stat, per_map_col):
    """Empirical-Bayes k = within-map variance / between-player variance, and the league mean."""
    means = [a["raw"][stat] for a in agg.values() if a["raw"][stat] is not None]
    mu = mean(means) if means else 0.0
    between = pstdev(means) ** 2 if len(means) >= 2 else 1.0
    within = []
    if per_map_col:
        for a in agg.values():
            vals = [r[per_map_col] for r in a["_rows"] if r[per_map_col] is not None]
            if len(vals) >= 2:
                within.append(pstdev(vals) ** 2)
    sigma2 = mean(within) if within else between
    k = sigma2 / between if between > 0 else 1e9
    return mu, k


def shrink(raw, n, mu, k):
    if raw is None:
        return None
    w = n / (n + k)
    return mu + w * (raw - mu), w


def _percentile_ranker(values: list[float]):
    s = sorted(values)
    n = len(s)

    def rank(v):
        if n == 0:
            return 0.5
        lo = sum(1 for x in s if x < v)
        hi = sum(1 for x in s if x <= v)
        return (lo + hi) / (2 * n)  # mid-rank in [0,1]
    return rank


def _to_skill(pct: float) -> float:
    """Map a league percentile [0,1] to a [0,1] skill with median ~0.6 (CombatSkills AVERAGE=0.6)."""
    return round(0.35 + 0.5 * pct, 4)


def build_ratings(duckdb_path: str) -> dict[str, Any]:
    import duckdb
    if not os.path.exists(duckdb_path):
        raise FileNotFoundError(duckdb_path)
    sha = _sha256(duckdb_path)
    global _NOW
    _NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        pmaps = load_player_maps(con)
    finally:
        con.close()
    agg = _player_aggregates(pmaps)

    # Shrink the underlying stats toward the league mean by maps played.
    stat_map_col = {"acs": "acs_all", "adr": "adr_all", "kast": "kast_all", "hsPct": "hs_pct_all",
                    "rating": "rating_all", "openingWinRate": None, "fkPerMap": "fk_all",
                    "clutchPerMap": "clutches"}
    shrink_meta = {}
    for stat, col in stat_map_col.items():
        mu, k = _shrink_params(agg, stat, col)
        shrink_meta[stat] = {"leagueMean": mu, "k": k}
        for a in agg.values():
            res = shrink(a["raw"][stat], a["maps"], mu, k)
            a.setdefault("shrunk", {})[stat] = None if res is None else res[0]
            a.setdefault("shrinkWeight", {})[stat] = None if res is None else res[1]

    # Percentile rankers (league-wide and role-relative) on SHRUNK values.
    def ranker_for(stat, role=None):
        vals = [a["shrunk"][stat] for a in agg.values()
                if a["shrunk"].get(stat) is not None and (role is None or a["role"] == role)]
        return _percentile_ranker(vals)

    league_rankers = {s: ranker_for(s) for s in stat_map_col}
    roles = {a["role"] for a in agg.values()}
    role_rankers = {(s, r): ranker_for(s, r) for s in ("openingWinRate", "fkPerMap") for r in roles}

    # consistency ranker: lower rating std = higher consistency
    cons_vals = [1.0 / (a["ratingStd"] + 0.05) for a in agg.values() if a["ratingStd"] is not None]
    cons_rank = _percentile_ranker(cons_vals)

    records = []
    for a in sorted(agg.values(), key=lambda x: -x["maps"]):
        n = a["maps"]
        low = n < MIN_MAPS_QUALIFY

        def est(stat, blend=None, role_rel=False, conf=1.0):
            sv = a["shrunk"].get(stat)
            if sv is None:
                return None
            if role_rel:
                pct = role_rankers[(stat, a["role"])](sv)
            elif blend:
                pct = mean([league_rankers[s](a["shrunk"][s]) for s in blend if a["shrunk"].get(s) is not None])
            else:
                pct = league_rankers[stat](sv)
            w = a["shrinkWeight"].get(stat) or 0.5
            # uncertainty: wider when shrunk hard (low n) or stat is a weak proxy
            uncertainty = round(min(0.5, (1 - w) * 0.5 + (1 - conf) * 0.15 + (0.1 if low else 0)), 4)
            return {"value": _to_skill(pct), "uncertainty": uncertainty, "nMaps": n,
                    "proxyConfidence": conf, "shrunkToward": "role" if role_rel else "league"}

        def est_blend(stats, conf=1.0):
            present = [s for s in stats if a["shrunk"].get(s) is not None]
            if not present:
                return None
            pct = mean(league_rankers[s](a["shrunk"][s]) for s in present)
            w = mean(a["shrinkWeight"].get(s) or 0.5 for s in present)
            uncertainty = round(min(0.5, (1 - w) * 0.5 + (1 - conf) * 0.15 + (0.1 if low else 0)), 4)
            return {"value": _to_skill(pct), "uncertainty": uncertainty, "nMaps": n,
                    "proxyConfidence": conf, "shrunkToward": "league"}

        cons = None
        if a["ratingStd"] is not None:
            pct = cons_rank(1.0 / (a["ratingStd"] + 0.05))
            cons = {"value": _to_skill(pct), "uncertainty": round(0.15 + (0.1 if low else 0), 4),
                    "nMaps": n, "proxyConfidence": 0.6, "shrunkToward": "league"}

        attributes = {
            # Mechanical (maps to PV-4 CombatSkills)
            "aim": est_blend(["acs", "adr"], conf=0.8),
            "crosshairPlacement": est("hsPct", conf=0.9),
            "firstBulletAccuracy": est_blend(["hsPct", "openingWinRate"], conf=0.6),
            "reaction": est("openingWinRate", role_rel=True, conf=0.6),
            "tracking": est("adr", conf=0.4),  # weak proxy
            # Derived / role
            "impact": est("rating", conf=0.9),
            "entryAggression": est("fkPerMap", role_rel=True, conf=0.8),
            "trading": est("kast", conf=0.6),
            "clutch": est("clutchPerMap", conf=0.4),  # wins only, no attempts -> weak
            "consistency": cons,
        }
        # Normalize attributes whose underlying stat was missing for this player.
        for name, obj in list(attributes.items()):
            if obj is None:
                attributes[name] = {"value": None, "reason": "underlying stat unavailable for this player"}
        # Null attributes (not estimable from a box score) with reasons.
        for name, reason in UNESTIMABLE.items():
            attributes[name] = {"value": None, "reason": reason}

        records.append({
            "playerId": str(a["player_id"]),
            "maps": n, "seasons": a["seasons"], "role": a["role"], "agentPool": a["agentPool"],
            "lowSample": low, "attributes": attributes,
            "provenance": {"sourceId": "vct-reference",
                           "sourceUrl": "https://vct-reference.com/dataset/vct.duckdb",
                           "retrievedAt": _NOW, "sha256": sha, "synthetic": False,
                           "evidenceType": "derived", "verified": False, "confidence": None,
                           "notes": ["Estimate from public box-score stats; NOT a real skill rating."]},
        })

    meta = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source": {"sourceId": "vct-reference", "sha256": sha, "scope": "international",
                   "players": len(records)},
        "method": {"shrinkage": "empirical Bayes toward league mean, weight n/(n+k)",
                   "minMapsQualify": MIN_MAPS_QUALIFY, "skillMapping": "percentile -> 0.35 + 0.5*pct (median~0.6)",
                   "roleRelative": ["reaction", "entryAggression"], "shrinkStats": shrink_meta},
        "disclaimer": ("Attributes are statistical ESTIMATES derived from public professional match "
                       "box scores, not assessments of real players' ability. Positional/utility/comms "
                       "attributes are left null because the data cannot support them. Using real names "
                       "in a distributed game raises name/likeness questions — see docs/research/PLAYER_RATINGS.md."),
        "unestimableAttributes": UNESTIMABLE,
    }
    return {"ratings": records, "meta": meta, "aggregates": agg}


# --- validation -------------------------------------------------------------------------------
def time_split_shrinkage_gain(agg, stat="rating", per_map_col="rating_all") -> dict:
    """Does shrinkage reduce next-season prediction error? Predict each multi-season player's latest
    season mean from earlier seasons: raw past mean vs shrunk-toward-(past league mean)."""
    train_rows, test_vals = {}, {}
    for a in agg.values():
        seasons = a["seasons"]
        if len(seasons) < 2:
            continue
        last = seasons[-1]
        past = [r[per_map_col] for r in a["_rows"] if r["season"] != last and r[per_map_col] is not None]
        cur = [r[per_map_col] for r in a["_rows"] if r["season"] == last and r[per_map_col] is not None]
        if len(past) >= 1 and cur:
            train_rows[a["player_id"]] = past
            test_vals[a["player_id"]] = mean(cur)
    if not train_rows:
        return {"players": 0}
    league_mu = mean(v for rows in train_rows.values() for v in rows)
    # k from the training pool
    pmeans = [mean(r) for r in train_rows.values()]
    between = pstdev(pmeans) ** 2 if len(pmeans) >= 2 else 1.0
    within = mean(pstdev(r) ** 2 for r in train_rows.values() if len(r) >= 2) if \
        any(len(r) >= 2 for r in train_rows.values()) else between
    k = within / between if between > 0 else 1e9
    raw_err = shr_err = 0.0
    for pid, past in train_rows.items():
        raw = mean(past)
        n = len(past)
        shr = league_mu + (n / (n + k)) * (raw - league_mu)
        raw_err += (raw - test_vals[pid]) ** 2
        shr_err += (shr - test_vals[pid]) ** 2
    m = len(train_rows)
    return {"players": m, "k": k, "rawMSE": raw_err / m, "shrunkMSE": shr_err / m,
            "shrinkageHelps": shr_err < raw_err}


def write_ratings(duckdb_path: str, out_dir: str) -> dict[str, str]:
    import json
    built = build_ratings(duckdb_path)
    os.makedirs(out_dir, exist_ok=True)
    # validation
    val = {
        "shrinkageGain": {
            "rating": time_split_shrinkage_gain(built["aggregates"], "rating", "rating_all"),
            "acs": time_split_shrinkage_gain(built["aggregates"], "acs", "acs_all"),
        },
        "attributeCorrelations": attribute_correlations(built["ratings"]),
    }
    built["meta"]["validation"] = val
    # distribution summary (per attribute: count estimated vs null, mean value)
    dist = {}
    attr_names = list(built["ratings"][0]["attributes"].keys()) if built["ratings"] else []
    for name in attr_names:
        vals = [r["attributes"][name]["value"] for r in built["ratings"]
                if r["attributes"][name].get("value") is not None]
        dist[name] = {"estimated": len(vals), "null": len(built["ratings"]) - len(vals),
                      "mean": round(mean(vals), 4) if vals else None}
    built["meta"]["attributeDistribution"] = dist

    written = {}
    for name, payload in (("player_ratings.json", built["ratings"]),
                          ("ratings_meta.json", built["meta"])):
        p = os.path.join(out_dir, name)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written[name] = p
    return written


def attribute_correlations(records) -> dict:
    """Pearson correlation among the estimated (non-null) attributes; flags |r|>0.9 as redundant."""
    names = ["aim", "crosshairPlacement", "firstBulletAccuracy", "reaction", "tracking",
             "impact", "entryAggression", "trading", "clutch", "consistency"]
    cols = {n: [] for n in names}
    for r in records:
        if all(r["attributes"][n] and r["attributes"][n]["value"] is not None for n in names):
            for n in names:
                cols[n].append(r["attributes"][n]["value"])

    def corr(x, y):
        if len(x) < 3:
            return None
        mx, my = mean(x), mean(y)
        num = sum((a - mx) * (b - my) for a, b in zip(x, y))
        dx = math.sqrt(sum((a - mx) ** 2 for a in x))
        dy = math.sqrt(sum((b - my) ** 2 for b in y))
        return num / (dx * dy) if dx > 0 and dy > 0 else None

    pairs = {}
    redundant = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            c = corr(cols[a], cols[b])
            if c is not None:
                pairs[f"{a}~{b}"] = round(c, 3)
                if abs(c) > 0.9:
                    redundant.append(f"{a}~{b}")
    return {"n": len(cols[names[0]]), "correlations": pairs, "redundantPairs": redundant}
