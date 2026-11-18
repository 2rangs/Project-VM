"""SYNTHETIC simulation-log fixtures for exercising the validation harness.

These are NOT real matches and NOT real simulation output — they are hand-parameterized event
logs (PV-core EventLog shape) built only to prove the harness's pass/fail separates correctly.
Every run is marked meta.synthetic = True. Knobs (winner, first-kill side, outcome mix) are set
independently; internal consistency is not required of a test fixture.
"""

from __future__ import annotations

ATTACKERS = [f"a{i}" for i in range(5)]
DEFENDERS = [f"d{i}" for i in range(5)]
ROSTER = {**{p: "attack" for p in ATTACKERS}, **{p: "defense" for p in DEFENDERS}}

OUTCOMES = ["elimination", "spikeDetonation", "spikeDefused", "timeExpired"]


def _round(rn, winner, reason, first_kill_side, duration_ms=60_000):
    killer = ATTACKERS[0] if first_kill_side == "attack" else DEFENDERS[0]
    victim = DEFENDERS[0] if first_kill_side == "attack" else ATTACKERS[0]
    # second kill (a trade by the victim's team) so trade/man-advantage paths have data
    trade_killer = DEFENDERS[1] if first_kill_side == "attack" else ATTACKERS[1]
    trade_victim = ATTACKERS[0] if first_kill_side == "attack" else DEFENDERS[0]
    events = [
        {"kind": "roundStart", "seq": 0, "tick": 0, "timeMs": 0, "roundNumber": rn},
        {"kind": "kill", "seq": 1, "tick": 10, "timeMs": 15_000, "victim": victim,
         "killer": killer, "assists": [], "cause": "weapon", "weaponId": "vandal"},
        {"kind": "kill", "seq": 2, "tick": 11, "timeMs": 17_000, "victim": trade_victim,
         "killer": trade_killer, "assists": [], "cause": "weapon", "weaponId": "phantom"},
        {"kind": "roundEnd", "seq": 3, "tick": 60, "timeMs": duration_ms,
         "winner": winner, "reason": reason},
    ]
    return {"roundNumber": rn, "map": "Ascent", "roster": dict(ROSTER),
            "buyTiers": {"attack": "full", "defense": "full"}, "events": events}


def build_run(*, n: int, atk_win_frac: float, first_kill_atk_frac: float,
              outcome_fracs: dict[str, float], label: str) -> dict:
    """Build n rounds hitting the given aggregate fractions (via exact index thresholds)."""
    atk_wins = round(atk_win_frac * n)
    fk_atk = round(first_kill_atk_frac * n)
    # outcome counts (assign the remainder to elimination)
    counts = {oc: round(f * n) for oc, f in outcome_fracs.items()}
    counts["elimination"] = n - sum(v for oc, v in counts.items() if oc != "elimination")
    reason_seq = []
    for oc in OUTCOMES:
        reason_seq += [oc] * max(0, counts.get(oc, 0))
    reason_seq = (reason_seq + ["elimination"] * n)[:n]

    rounds = []
    for i in range(n):
        winner = "attack" if i < atk_wins else "defense"
        first_kill_side = "attack" if i < fk_atk else "defense"
        rounds.append(_round(i + 1, winner, reason_seq[i], first_kill_side))
    return {"meta": {"synthetic": True, "label": label, "rounds": n}, "rounds": rounds}


def good_run(n: int = 200) -> dict:
    """Matches the Ascent baselines within tolerance."""
    return build_run(
        n=n, atk_win_frac=0.50, first_kill_atk_frac=0.44,
        outcome_fracs={"elimination": 0.71, "spikeDefused": 0.16,
                       "spikeDetonation": 0.08, "timeExpired": 0.04},
        label="good-matches-ascent-baselines")


def bad_run(n: int = 200) -> dict:
    """Deliberately wrong: attacker-dominant, all eliminations."""
    return build_run(
        n=n, atk_win_frac=0.90, first_kill_atk_frac=0.90,
        outcome_fracs={"elimination": 1.0, "spikeDefused": 0.0,
                       "spikeDetonation": 0.0, "timeExpired": 0.0},
        label="bad-attacker-dominant")
