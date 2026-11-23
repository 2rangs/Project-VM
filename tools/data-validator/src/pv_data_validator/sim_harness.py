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


# --- economy report metrics (EC-01..05) -------------------------------------------------------
def _winner_side(r):
    end = _round_end(r["events"])
    return end.get("winner") if end else None


def _team_rounds(rounds):
    """Yield (match, half, roundNumber, side, plan, vctTier, won, econ) per team per round.

    Sides are fixed within a half, so a team is (match, half, side). Plans fall back to buyTiers for
    bundles written before the per-player economy (their buyTiers were the plan tiers)."""
    for r in rounds:
        win = _winner_side(r)
        if win is None:
            continue
        n = r.get("roundNumber", 0)
        half = 0 if n <= 12 else 1 if n <= 24 else 2 + (n - 25)
        plans = r.get("plans") or r.get("buyTiers") or {}
        tiers = r.get("buyTiers") or {}
        econ = r.get("econ") or {}
        for side in ("attack", "defense"):
            yield (r.get("match"), half, n, side, plans.get(side), tiers.get(side), win == side, econ.get(side) or {})


def economy_report(rounds) -> dict[str, tuple[int, int]]:
    """Report-only economy metrics as (successes, n)."""
    by_team: dict[tuple, dict[int, tuple]] = defaultdict(dict)
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    has_match = any("match" in r for r in rounds)

    def add(key, ok):
        acc[key][1] += 1
        acc[key][0] += 1 if ok else 0

    team_rounds = list(_team_rounds(rounds))
    non_pistol = [t for t in team_rounds if t[4] != "pistol" and t[2] <= 24]
    for vt in ("eco", "semi", "full"):
        for t in non_pistol:
            add(f"tier_share:{vt}", t[5] == vt)
    for (m, half, n, side, plan, tier, won, econ) in team_rounds:
        if plan:
            add(f"plan_win:{plan}", won)
        if econ:
            if plan != "pistol":
                add("drop_rate", econ.get("drops", 0) > 0)
            add("pickup_rate", econ.get("pickups", 0) > 0)
        if has_match:
            by_team[(m, half, side)][n] = (plan, tier, won)
    # plan vs the opponent's plan (force into a full buy is the VCT semi-vs-full cell)
    for r in rounds:
        win = _winner_side(r)
        plans = r.get("plans") or r.get("buyTiers") or {}
        if win is None or not plans:
            continue
        for side, opp in (("attack", "defense"), ("defense", "attack")):
            if plans.get(side) == "force" and plans.get(opp) == "full":
                add("force_vs_full_win", win == side)
            if plans.get(side) == "eco" and plans.get(opp) == "full":
                add("eco_vs_full_win", win == side)
    # conversions: next round of the same team within the same half
    for rounds_of in by_team.values():
        for n, (plan, tier, won) in rounds_of.items():
            nxt = rounds_of.get(n + 1)
            if nxt is None:
                continue
            if plan == "pistol" and won:
                add("pistol_conversion", nxt[2])
                nxt2 = rounds_of.get(n + 2)
                if nxt[2] and nxt2 is not None:
                    add("bonus_conversion", nxt2[2])
            if tier == "eco":
                add("eco_next_round_win", nxt[2])
            if tier == "full":
                add("full_next_round_win", nxt[2])
    return {k: (v[0], v[1]) for k, v in acc.items()}


# Real (VCT international) reference values for the economy report, from datasets/derived/priors.
def _economy_reference(priors) -> dict[str, tuple[float, str]]:
    ref: dict[str, tuple[float, str]] = {}
    pc = priors.get("pistol_conversion")
    e = _find(pc, half="combined", step="win_next_round")
    if e:
        ref["pistol_conversion"] = (e["rate"], "pistol_conversion combined")
    two = [_find(pc, half=h, step="win_next_two_rounds") for h in ("first", "second")]
    one = [_find(pc, half=h, step="win_next_round") for h in ("first", "second")]
    if all(two) and all(one):
        w2 = sum(t["successes"] for t in two) / sum(t["n"] for t in two)
        w1 = sum(o["successes"] for o in one) / sum(o["n"] for o in one)
        ref["bonus_conversion"] = (w2 / w1, "pistol_conversion: P(win r+2 | won r, r+1) = two-round / one-round")
    em = priors.get("economy_matchup.international")
    if em:
        # Share of team-rounds per VCT buy tier (rounds 2-24): the matchup prior's n per own tier.
        n_by = defaultdict(int)
        for e in em.get("estimates", []):
            if e["dims"].get("ownBuy") in ("eco", "semi", "full"):
                n_by[e["dims"]["ownBuy"]] += e["n"]
        tot = sum(n_by.values())
        if tot:
            for vt, n in n_by.items():
                ref[f"tier_share:{vt}"] = (n / tot, "economy_matchup.international n per own tier")
    se = priors.get("save_eco_future_value")
    e = _find(se, condition="eco_this_round", measured="win_next_round")
    if e:
        ref["eco_next_round_win"] = (e["rate"], "save_eco_future_value eco_this_round")
    e = _find(se, condition="full_this_round", measured="win_next_round")
    if e:
        ref["full_next_round_win"] = (e["rate"], "save_eco_future_value full_this_round")
    em = priors.get("economy_matchup.international")
    e = _find(em, ownBuy="semi", oppBuy="full")
    if e:
        ref["force_vs_full_win"] = (e["rate"], "economy_matchup semi vs full (semi = half + force)")
    e = _find(em, ownBuy="eco", oppBuy="full")
    if e:
        ref["eco_vs_full_win"] = (e["rate"], "economy_matchup eco vs full")
    return ref


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


ERA_SUBDIR = {"all": "", "patch>=9": "patch-ge9"}


def _metric_key(m: dict) -> tuple:
    """Stable identity for a metric row: (metric, scope, sorted dims)."""
    dims = m.get("dims") or {}
    return (m.get("metric"), m.get("scope"), tuple(sorted((k, str(v)) for k, v in dims.items())))


def attach_comparison(report: dict[str, Any], baseline: dict) -> dict[str, Any]:
    """Annotate each metric with its change vs a baseline report (same shape), and add a summary.

    Per metric: baselineSimValue, delta (sim − baselineSim), movedToward (improved/worsened/unchanged
    for judged metrics with a real target; n/a for reported-only; new if absent from the baseline).
    "improved" means the sim value moved closer to the real target than the baseline was.
    """
    base_by = {_metric_key(m): m for m in baseline.get("metrics", [])}
    eps = 1e-9
    improved = worsened = unchanged = newly_passed = newly_failed = 0
    for m in report["metrics"]:
        b = base_by.get(_metric_key(m))
        if b is None:
            m["baselineSimValue"], m["delta"], m["movedToward"] = None, None, "new"
            continue
        bs, cs = b.get("simValue"), m.get("simValue")
        m["baselineSimValue"] = bs
        if bs is None or cs is None:
            m["delta"], m["movedToward"] = None, "n/a"
        else:
            m["delta"] = cs - bs
            real = m.get("realRate")
            if real is None:
                m["movedToward"] = "n/a"
            else:
                d_now, d_base = abs(cs - real), abs(bs - real)
                if d_now < d_base - eps:
                    m["movedToward"], _ = "improved", (improved := improved + 1)
                elif d_now > d_base + eps:
                    m["movedToward"], _ = "worsened", (worsened := worsened + 1)
                else:
                    m["movedToward"], _ = "unchanged", (unchanged := unchanged + 1)
        if b.get("passed") is not None and m.get("passed") is not None:
            if m["passed"] and not b["passed"]:
                newly_passed += 1
            elif not m["passed"] and b["passed"]:
                newly_failed += 1
    report["comparison"] = {
        "baselineLabel": (baseline.get("simMeta") or {}).get("label"),
        "baselineGeneratedAt": baseline.get("generatedAt"),
        "improved": improved, "worsened": worsened, "unchanged": unchanged,
        "newlyPassed": newly_passed, "newlyFailed": newly_failed,
    }
    return report


def evaluate_sim_run(sim_run: dict, priors_dir: str, *, scope: str = "ascent",
                     tolerances: dict | None = None, era: str = "all",
                     compare_path: str | None = None) -> dict[str, Any]:
    tol = {**DEFAULT_TOLERANCES, **(tolerances or {})}
    sub = ERA_SUBDIR.get(era, "")
    priors = load_priors(os.path.join(priors_dir, sub) if sub else priors_dir)
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

    # 6. economy (report-only: the VCT figures are shown for reference, not judged)
    econ_ref = _economy_reference(priors)
    for key, sw in sorted(economy_report(rounds).items()):
        name, _, plan = key.partition(":")
        res = _judge("economy", "sim_only", {"metric": name, **({"plan": plan} if plan else {})}, sw, None, 0.0)
        ref_key = key if key in econ_ref else name
        if ref_key in econ_ref:
            res.realRate, src = econ_ref[ref_key]
            res.note = f"reference only: {src}"
        results.append(res)
    dur, dn = avg_round_duration_ms(rounds)
    results.append(MetricResult("round_duration_ms", "sim_only", {}, dur, dn,
                                note="no real baseline (VCT Reference has map duration, not per-round)"))

    judged = [r for r in results if r.passed is not None]
    passed = sum(1 for r in judged if r.passed)
    report = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "scope": scope,
        "era": era,
        "priorsSource": {k: priors[k]["source"].get("sha256") for k in priors},
        "simMeta": sim_run.get("meta", {}),
        "summary": {"passed": passed, "judged": len(judged), "reportedOnly": len(results) - len(judged),
                    "allPassed": passed == len(judged) and len(judged) > 0},
        "metrics": [asdict(r) for r in results],
    }
    if compare_path:
        with open(compare_path, encoding="utf-8") as f:
            attach_comparison(report, json.load(f))
    return report


_MOVE_SYMBOL = {"improved": "↑ better", "worsened": "↓ worse", "unchanged": "= same",
                "n/a": "·", "new": "＋ new"}


def _comparison_markdown(report: dict) -> list[str]:
    """The metrics table with baseline columns, used when a comparison is attached."""
    c = report["comparison"]
    lines = [
        f"- **Compared to baseline** `{c['baselineLabel']}` ({c['baselineGeneratedAt']}): "
        f"{c['improved']} improved, {c['worsened']} worsened, {c['unchanged']} unchanged; "
        f"{c['newlyPassed']} newly pass, {c['newlyFailed']} newly fail.", "",
        "| Metric | Dims | Base | Sim | Δ | Move | Real | Result |",
        "|---|---|---|---|---|---|---|---|"]
    for m in report["metrics"]:
        is_dur = m["metric"] == "round_duration_ms"
        fmt = (lambda v: "—" if v is None else (f"{v:.0f}ms" if is_dur else f"{v:.3f}"))
        base = fmt(m.get("baselineSimValue"))
        sim = fmt(m["simValue"])
        delta = "—" if m.get("delta") is None else (f"{m['delta']:+.0f}" if is_dur else f"{m['delta']:+.3f}")
        move = _MOVE_SYMBOL.get(m.get("movedToward"), "·")
        real = "—" if m["realRate"] is None else f"{m['realRate']:.3f}"
        result = "report-only" if m["passed"] is None else ("✅ PASS" if m["passed"] else "❌ FAIL")
        dims = ", ".join(f"{k}={v}" for k, v in m["dims"].items()) or "—"
        lines.append(f"| {m['metric']} | {dims} | {base} | {sim} | {delta} | {move} | {real} | {result} |")
    return lines


def report_markdown(report: dict) -> str:
    lines = ["# PROJECT V — Simulation Validation Report", "",
             f"- Generated: {report['generatedAt']}  ·  scope: `{report['scope']}`",
             f"- Baselines: VCT Reference priors ({', '.join(sorted(set(v for v in report['priorsSource'].values() if v)))[:16]}…)",
             f"- Sim meta: `{json.dumps(report['simMeta'])}`",
             f"- **{report['summary']['passed']}/{report['summary']['judged']} judged metrics passed** "
             f"({report['summary']['reportedOnly']} reported-only)", ""]
    if report.get("comparison"):
        return "\n".join(lines + _comparison_markdown(report)) + "\n"
    lines += ["| Metric | Dims | Sim | Real | Real 95% CI | Tol | Result |",
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
