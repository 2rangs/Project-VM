"""Simulation validation harness (README §30-31, Handoff §24.4).

Takes a bundle of SIMULATED round logs (PV-core EventLog shape) and checks the aggregate behaviour
against PV-2's real baselines (datasets/derived/priors/ + docs/VALIDATION_BASELINES.md tolerances).

No real 5v5 simulation exists yet, so the harness is exercised with synthetic fixtures (a matching
"good" run and a deliberately-wrong "bad" run) to prove pass/fail actually separates — see
tests/fixtures/. Those fixtures are SYNTHETIC and labelled as such.

Input shape (one JSON object):
    { "meta": {"synthetic": bool, ...},
      "rounds": [ {
          "roundNumber": int, "map": "Ascent",
          "roster": { "<playerId>": "attack"|"defense" },   # side per player this round
          "buyTiers": { "attack": "full"|"semi"|"eco"|"pistol", "defense": ... },  # optional
          "events": [ GameEvent, ... ]   # kind/seq/timeMs/... as in @pv/shared-types
      } ] }

Metrics with a real baseline are PASS/FAIL; metrics with none (man-advantage, trades, round time)
are REPORTED ONLY, because VCT Reference lacks per-round kill sequences (see VALIDATION_BASELINES.md).
"""

from __future__ import annotations

import datetime as dt
import glob
import json
import os
from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Any

TRADE_WINDOW_MS = 5_000

# Default tolerances (mirror docs/VALIDATION_BASELINES.md). Per-metric absolute tolerance on the rate.
DEFAULT_TOLERANCES = {
    "round_outcome_distribution": 0.04,
    "side_winrate": 0.04,
    "opening_duel": 0.04,
    "economy_matchup": 0.05,
}

# sim roundEnd.reason -> VCT Reference outcome name
REASON_TO_OUTCOME = {
    "elimination": "elimination",
    "spikeDetonation": "bomb_detonated",
    "spikeDefused": "defuse",
    "timeExpired": "time_expired",
}


@dataclass
class MetricResult:
    metric: str
    scope: str
    dims: dict
    simValue: float | None
    simN: int
    realRate: float | None = None
    realWilson: tuple[float, float] | None = None
    tolerance: float | None = None
    withinTolerance: bool | None = None
    withinRealCI: bool | None = None
    passed: bool | None = None  # None => reported only (no real baseline)
    note: str = ""


# --- prior access ----------------------------------------------------------------------------
def load_priors(priors_dir: str) -> dict[str, dict]:
    out = {}
    for path in glob.glob(os.path.join(priors_dir, "*.json")):
        d = json.load(open(path, encoding="utf-8"))
        if isinstance(d, dict) and "priorId" in d:
            out[os.path.basename(path)[:-5]] = d
    return out


def _find(prior: dict | None, **dims) -> dict | None:
    if not prior:
        return None
    for e in prior.get("estimates", []):
        if all(e["dims"].get(k) == v for k, v in dims.items()):
            return e
    return None


# --- metric computation from the event logs --------------------------------------------------
def _round_end(ev_list):
    return next((e for e in ev_list if e.get("kind") == "roundEnd"), None)


def _round_start(ev_list):
    return next((e for e in ev_list if e.get("kind") == "roundStart"), None)


def _kills(ev_list):
    return sorted((e for e in ev_list if e.get("kind") == "kill"), key=lambda e: e.get("seq", 0))


def outcome_distribution(rounds) -> dict[str, tuple[int, int]]:
    counts = defaultdict(int)
    total = 0
    for r in rounds:
        end = _round_end(r["events"])
        if not end:
            continue
        oc = REASON_TO_OUTCOME.get(end.get("reason"))
        if oc:
            counts[oc] += 1
            total += 1
    return {oc: (counts.get(oc, 0), total) for oc in REASON_TO_OUTCOME.values()}


def attacker_win_rate(rounds) -> tuple[int, int]:
    wins = n = 0
    for r in rounds:
        end = _round_end(r["events"])
        if not end:
            continue
        n += 1
        if end.get("winner") == "attack":
            wins += 1
    return wins, n


def attacker_opening_duel(rounds) -> tuple[int, int]:
    wins = n = 0
    for r in rounds:
        ks = _kills(r["events"])
        roster = r.get("roster", {})
        first = next((k for k in ks if k.get("killer") is not None), None)
        if not first:
            continue
        side = roster.get(str(first["killer"]))
        if side is None:
            continue
        n += 1
        if side == "attack":
            wins += 1
    return wins, n


def economy_matchup(rounds) -> dict[tuple[str, str], tuple[int, int]]:
    """(attackerTier, defenderTier) -> (attacker wins, n), only for rounds carrying buyTiers."""
    acc: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for r in rounds:
        bt = r.get("buyTiers")
        end = _round_end(r["events"])
        if not bt or not end:
            continue
        key = (bt.get("attack"), bt.get("defense"))
        if None in key:
            continue
        acc[key][1] += 1
        if end.get("winner") == "attack":
            acc[key][0] += 1
    return {k: (v[0], v[1]) for k, v in acc.items()}


def man_advantage(rounds) -> dict[str, tuple[int, int]]:
    """For each (atkAlive,defAlive) state a round passes through, P(attacker wins). Report-only."""
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rounds:
        end = _round_end(r["events"])
        if not end:
            continue
        atk_won = end.get("winner") == "attack"
        roster = r.get("roster", {})
        a = sum(1 for s in roster.values() if s == "attack") or 5
        d = sum(1 for s in roster.values() if s == "defense") or 5
        seen = {(a, d)}
        for k in _kills(r["events"]):
            vside = roster.get(str(k.get("victim")))
            if vside == "attack":
                a -= 1
            elif vside == "defense":
                d -= 1
            if a < 0 or d < 0:
                break
            seen.add((a, d))
        for (aa, dd) in seen:
            key = f"{aa}v{dd}"
            acc[key][1] += 1
            if atk_won:
                acc[key][0] += 1
    return {k: (v[0], v[1]) for k, v in acc.items()}


def trade_rate(rounds) -> tuple[int, int]:
    """Fraction of deaths avenged by a teammate kill within TRADE_WINDOW_MS. Report-only."""
    traded = deaths = 0
    for r in rounds:
        roster = r.get("roster", {})
        ks = _kills(r["events"])
        for i, k in enumerate(ks):
            victim = k.get("victim")
            vside = roster.get(str(victim))
            if vside is None:
                continue
            deaths += 1
            t = k.get("timeMs", 0)
            for j in ks[i + 1:]:
                if j.get("timeMs", 0) - t > TRADE_WINDOW_MS:
                    break
                killer_side = roster.get(str(j.get("killer")))
                victim_j_side = roster.get(str(j.get("victim")))
                # a teammate of the victim killed an opponent
                if killer_side == vside and victim_j_side is not None and victim_j_side != vside:
                    traded += 1
                    break
    return traded, deaths


def avg_round_duration_ms(rounds) -> tuple[float | None, int]:
    durs = []
    for r in rounds:
        s, e = _round_start(r["events"]), _round_end(r["events"])
        if s and e and e.get("timeMs") is not None and s.get("timeMs") is not None:
            durs.append(e["timeMs"] - s["timeMs"])
    return (sum(durs) / len(durs) if durs else None, len(durs))


# --- evaluation ------------------------------------------------------------------------------
def _rate(sw: tuple[int, int]) -> float | None:
    w, n = sw
    return w / n if n else None


def _judge(metric, scope, dims, sim, target, tol) -> MetricResult:
    sim_rate = _rate(sim)
    res = MetricResult(metric=metric, scope=scope, dims=dims, simValue=sim_rate, simN=sim[1],
                       tolerance=tol)
    if target is None or sim_rate is None:
        res.note = "no real baseline (data gap)" if target is None else "no sim samples"
        return res
    res.realRate = target["rate"]
    res.realWilson = (target["wilsonLow"], target["wilsonHigh"])
    res.withinTolerance = abs(sim_rate - target["rate"]) <= tol
    res.withinRealCI = target["wilsonLow"] - tol <= sim_rate <= target["wilsonHigh"] + tol
    res.passed = bool(res.withinTolerance)
    if target.get("smallSample"):
        res.note = "real baseline is small-sample; treat as advisory"
    return res


def evaluate_sim_run(sim_run: dict, priors_dir: str, *, scope: str = "ascent",
                     tolerances: dict | None = None) -> dict[str, Any]:
    tol = {**DEFAULT_TOLERANCES, **(tolerances or {})}
    priors = load_priors(priors_dir)
    rounds = sim_run.get("rounds", [])
    results: list[MetricResult] = []

    # scope fallback: ascent baseline if present else all_maps
    def scope_for(prior_key):
        p = priors.get(prior_key)
        if p and _find(p, scope=scope):
            return scope
        return "all_maps"

    # 1. outcome distribution
    s = scope_for("round_outcome_distribution")
    for oc, sw in outcome_distribution(rounds).items():
        tgt = _find(priors.get("round_outcome_distribution"), scope=s, outcome=oc)
        results.append(_judge("round_outcome_distribution", s, {"outcome": oc}, sw, tgt,
                              tol["round_outcome_distribution"]))

    # 2. attacker win rate
    s = scope_for("side_map_baselines")
    tgt = _find(priors.get("side_map_baselines"), scope=s, side="attack", phase="all")
    results.append(_judge("side_winrate", s, {"side": "attack", "phase": "all"},
                          attacker_win_rate(rounds), tgt, tol["side_winrate"]))

    # 3. attacker opening-duel rate
    s = scope_for("combat_opening_duel")
    tgt = _find(priors.get("combat_opening_duel"), scope=s, side="attack")
    results.append(_judge("opening_duel", s, {"side": "attack"},
                          attacker_opening_duel(rounds), tgt, tol["opening_duel"]))

    # 4. economy matchup (only cells present in the sim)
    em_key = "economy_matchup.ascent" if scope == "ascent" and "economy_matchup.ascent" in priors \
        else "economy_matchup.international"
    for (own, opp), sw in economy_matchup(rounds).items():
        tgt = _find(priors.get(em_key), ownBuy=own, oppBuy=opp)
        results.append(_judge("economy_matchup", em_key.split(".")[-1],
                              {"ownBuy": own, "oppBuy": opp}, sw, tgt, tol["economy_matchup"]))

    # 5. report-only metrics (no real baseline)
    for key, sw in sorted(man_advantage(rounds).items()):
        results.append(_judge("man_advantage", "sim_only", {"state": key}, sw, None, 0.0))
    results.append(_judge("trade_rate", "sim_only", {}, trade_rate(rounds), None, 0.0))
    dur, dn = avg_round_duration_ms(rounds)
    results.append(MetricResult("round_duration_ms", "sim_only", {}, dur, dn,
                                note="no real baseline (VCT Reference has map duration, not per-round)"))

    judged = [r for r in results if r.passed is not None]
    passed = sum(1 for r in judged if r.passed)
    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "scope": scope,
        "priorsSource": {k: priors[k]["source"].get("sha256") for k in priors},
        "simMeta": sim_run.get("meta", {}),
        "summary": {"passed": passed, "judged": len(judged), "reportedOnly": len(results) - len(judged),
                    "allPassed": passed == len(judged) and len(judged) > 0},
        "metrics": [asdict(r) for r in results],
    }


def report_markdown(report: dict) -> str:
    lines = ["# PROJECT V — Simulation Validation Report", "",
             f"- Generated: {report['generatedAt']}  ·  scope: `{report['scope']}`",
             f"- Baselines: VCT Reference priors ({', '.join(sorted(set(v for v in report['priorsSource'].values() if v)))[:16]}…)",
             f"- Sim meta: `{json.dumps(report['simMeta'])}`",
             f"- **{report['summary']['passed']}/{report['summary']['judged']} judged metrics passed** "
             f"({report['summary']['reportedOnly']} reported-only)", "",
             "| Metric | Dims | Sim | Real | Real 95% CI | Tol | Result |",
             "|---|---|---|---|---|---|---|"]
    for m in report["metrics"]:
        sim = "—" if m["simValue"] is None else f"{m['simValue']:.3f}" if m["metric"] != "round_duration_ms" \
            else f"{m['simValue']:.0f}ms"
        real = "—" if m["realRate"] is None else f"{m['realRate']:.3f}"
        ci = "—" if not m["realWilson"] else f"[{m['realWilson'][0]:.3f},{m['realWilson'][1]:.3f}]"
        tol = "—" if m["tolerance"] in (None, 0.0) else f"±{m['tolerance']:.2f}"
        if m["passed"] is None:
            result = "report-only"
        else:
            result = "✅ PASS" if m["passed"] else "❌ FAIL"
        dims = ", ".join(f"{k}={v}" for k, v in m["dims"].items()) or "—"
        lines.append(f"| {m['metric']} | {dims} | {sim} | {real} | {ci} | {tol} | {result} |")
    return "\n".join(lines) + "\n"


def write_reports(report: dict, out_prefix: str) -> dict[str, str]:
    os.makedirs(os.path.dirname(out_prefix) or ".", exist_ok=True)
    jp, mp = out_prefix + ".json", out_prefix + ".md"
    with open(jp, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(mp, "w", encoding="utf-8") as f:
        f.write(report_markdown(report))
    return {"json": jp, "markdown": mp}
