"""Generate clearly-labelled SYNTHETIC Ascent data.

Nothing here is a real match. Every record gets provenance.synthetic=True and is written only
under datasets/synthetic/. Two products:

  * build_scenarios()  -> the 10 Handoff §20 decision-context scenarios (DecisionContext shape,
    world-state.schema.json, formatVersion 2). PV-4's Action Generator / Decision Debugger consume
    these; each separates ground-truth worldState from the deciding team's belief (DECISION-004).
  * build_map()        -> one short synthetic Ascent map (map/rounds/events with position snapshots).

Determinism (DECISION-010): the map generator is seeded; scenarios are hand-authored and stable.

COORDINATES (v2): positions are in **game-world Unreal units (uu)** — the canonical cross-engine
frame owned by the Spatial agent (origin/claude/pv-spatial coordinate-system.json, valorant-api
transform verified by PV-6 on 3001 real samples). Each player/spike carries a `zoneId` from the
Ascent navgraph; its `position` is that zone's representative point. The legacy minimapUnits frame
(v1) is removed — it caused PV-3's F1 coordinate mis-map and relied on the vlr frame we cannot use.
Zone positions are snapshotted in datasets/synthetic/ascent/ascent_zones_ref.json (same source).

Economy / ultimate constants are approximate PATCH-DEPENDENT placeholders (README §10, §19, §21).
"""

from __future__ import annotations

import json
import os
import random
from typing import Any

from . import ROUND_COMBAT_MS, SPIKE_TIMER_MS  # noqa: F401
from . import provenance as prov

MAP_NAME = "Ascent"
PATCH = "synthetic-approx"
FORMAT_VERSION = 2
FRAME = "game-world-uu"

# Ascent zone representative points in game-world uu (snapshot of PV-4 navgraph; see module docstring
# and datasets/synthetic/ascent/ascent_zones_ref.json). zoneId -> (x, y, z).
ZONE_POS: dict[str, tuple[float, float, float]] = {
    "attacker-spawn": (60, 50, 190), "defender-spawn": (1995.2, -9744.9, 100),
    "a-lobby": (4489, -3014.1, 400), "a-main": (5321.6, -4710.1, 400), "a-window": (4023, -8180.7, 803),
    "a-tree": (3980.9, -5938.8, 400), "a-site": (6153.6, -6626.2, 500), "a-garden": (3773.7, -7551.4, 400),
    "a-wine": (7358.7, -4689.3, 400), "a-rafters": (6129.9, -8210, 500),
    "b-lobby": (-1490.6, -1390, 200), "b-main": (-1983.7, -5840.8, 100), "b-site": (-2344.1, -7548.5, 100),
    "b-boathouse": (-4484.8, -7763.4, 100), "mid-top": (2753.9, -2129.6, 400),
    "mid-courtyard": (1222.7, -4586.6, 300), "mid-catwalk": (2315.8, -4127.3, 300),
    "mid-cubby": (3387.3, -5129.8, 300), "mid-bottom": (1122.2, -5951.7, 200),
    "mid-link": (-632.1, -4280.3, 200), "mid-market": (1089.1, -7363.2, 100), "mid-pizza": (1801.6, -7262.2, 100),
}
# Human callout (used in the scenario bodies) -> navgraph zoneId.
CALLOUT_ZONE = {
    "attacker_spawn": "attacker-spawn", "a_lobby": "a-lobby", "a_main": "a-main", "a_site": "a-site",
    "a_heaven": "a-rafters", "a_cubby": "a-tree", "a_generator": "a-wine", "mid_bottom": "mid-bottom",
    "mid_courtyard": "mid-courtyard", "market": "mid-market", "mid_top": "mid-top", "b_lobby": "b-lobby",
    "b_main": "b-main", "b_site": "b-site", "b_lane": "b-boathouse", "defender_spawn": "defender-spawn",
}
PLANT_SITE_ZONE = {"A": "a-site", "B": "b-site"}


def _zid(callout: str) -> str:
    return CALLOUT_ZONE[callout]


def _gw(callout_or_zone: str) -> dict:
    """Game-world position dict for a callout name or a direct zoneId."""
    zid = CALLOUT_ZONE.get(callout_or_zone, callout_or_zone)
    x, y, z = ZONE_POS[zid]
    return {"x": x, "y": y, "z": z, "frame": FRAME}


WEAPON_COST = {
    "classic": 0, "ghost": 500, "sheriff": 800, "frenzy": 450, "shorty": 150,
    "stinger": 1100, "spectre": 1600, "bucky": 850, "judge": 1850,
    "bulldog": 2050, "guardian": 2250, "phantom": 2900, "vandal": 2900,
    "marshal": 950, "outlaw": 2400, "operator": 4700, "ares": 1600, "odin": 3200,
}
ARMOR_COST = {"none": 0, "light": 400, "heavy": 1000, "regen": 650}
ULT_COST = {
    "jett": 7, "raze": 8, "neon": 7, "phoenix": 7, "reyna": 6, "yoru": 7, "iso": 7,
    "sova": 8, "cypher": 7, "killjoy": 8, "fade": 7, "breach": 9, "skye": 7, "kayo": 8, "gekko": 8,
    "sage": 7, "omen": 7, "brimstone": 7, "viper": 8, "harbor": 7, "astra": 7, "clove": 7,
    "chamber": 8, "deadlock": 7, "vyse": 7, "tejo": 8, "waylay": 7,
}


def ult_cost(agent: str) -> int:
    return ULT_COST.get((agent or "").lower(), 7)


# --- small builders --------------------------------------------------------------------------
def _loadout(player_id, *, credits, weapon=None, armor="none", agent=None,
             ult_points=0, ability_charges=None) -> dict:
    return {
        "playerId": player_id, "credits": credits, "weaponId": weapon, "armor": armor,
        "abilityCharges": ability_charges or {}, "ultimatePoints": ult_points,
        "ultimateCost": ult_cost(agent) if agent else None,
    }


def _player(player_id, team_idx, agent, callout, *, health=100, armor=50, alive=True,
            facing=180.0, loadout=None) -> dict:
    return {
        "playerId": player_id, "teamIdx": team_idx, "agentId": agent,
        "position": _gw(callout), "zoneId": _zid(callout), "facingDeg": facing,
        "health": health, "armor": armor, "alive": alive,
        "loadout": loadout or _loadout(player_id, credits=0, agent=agent),
    }


def _enemy(pid, callout, *, ms_ago, evidence="observed", confidence=0.9) -> dict:
    return {"playerId": pid, "lastKnownPos": _gw(callout), "lastKnownZoneId": _zid(callout),
            "lastSeenMsAgo": ms_ago, "evidence": evidence, "confidence": confidence}


def _sound(kind, callout, *, ms_ago) -> dict:
    return {"kind": kind, "pos": _gw(callout), "atMsAgo": ms_ago}


def _team_econ(team_idx, *, bank, loadout_value, buy_type=None, loss_tier=None) -> dict:
    return {"teamIdx": team_idx, "bank": bank, "loadoutValue": loadout_value,
            "lossBonusTier": loss_tier, "buyType": buy_type}


def _context(context_id, scenario_ref, world_state, deciding_team, belief, *, notes=None) -> dict:
    return {
        "contextId": context_id, "formatVersion": FORMAT_VERSION, "scenarioRef": scenario_ref,
        "worldState": world_state, "decidingTeamIdx": deciding_team, "belief": belief,
        "provenance": prov.synthetic(game_patch=None, notes=notes),
    }


def _world(match_id, round_id, round_num, time_ms, phase, players, spike, *,
           attacking_team=0, team_econ=None, score=None) -> dict:
    return {
        "matchId": match_id, "roundId": round_id, "roundNum": round_num, "mapName": MAP_NAME,
        "patch": PATCH, "tick": 0, "timeRemainingMs": time_ms, "roundPhase": phase,
        "attackingTeamIdx": attacking_team, "players": players, "spike": spike,
        "teamEconomy": team_econ or [], "matchScore": score,
    }


def _spike_carried(carrier) -> dict:
    return {"status": "carried", "carrierPlayerId": carrier, "site": None, "pos": None,
            "zoneId": None, "timeUntilDetonationMs": None}


def _spike_planted(site, *, time_ms) -> dict:
    zid = PLANT_SITE_ZONE[site]
    return {"status": "planted", "carrierPlayerId": None, "site": site, "pos": _gw(zid),
            "zoneId": zid, "timeUntilDetonationMs": time_ms}


ATK = [("atk1", "jett"), ("atk2", "sova"), ("atk3", "omen"), ("atk4", "kayo"), ("atk5", "killjoy")]
DEF = [("def1", "chamber"), ("def2", "cypher"), ("def3", "viper"), ("def4", "neon"), ("def5", "fade")]


# --- the 10 scenarios (Handoff §20) ----------------------------------------------------------
def scenario_01():
    """Basic attack: 5v5, round start, spike carried; attackers generate site options."""
    players = []
    for pid, agent in ATK:
        lo = _loadout(pid, credits=400, weapon="vandal", armor="heavy", agent=agent, ult_points=2,
                      ability_charges={"c": 1, "q": 1, "e": 1})
        players.append(_player(pid, 0, agent, "attacker_spawn", loadout=lo, facing=0.0))
    for pid, agent in DEF:
        spot = {"def1": "a_site", "def2": "b_site", "def3": "mid_courtyard",
                "def4": "a_main", "def5": "defender_spawn"}[pid]
        lo = _loadout(pid, credits=300, weapon="vandal", armor="heavy", agent=agent, ult_points=3)
        players.append(_player(pid, 1, agent, spot, loadout=lo, facing=180.0))
    players[0]["loadout"]["weaponId"] = "operator"
    ws = _world("synthetic-ascent-s01", "synthetic-ascent-s01:1", 1, ROUND_COMBAT_MS, "round",
                players, _spike_carried("atk1"),
                team_econ=[_team_econ(0, bank=4200, loadout_value=19000, buy_type="full_buy"),
                           _team_econ(1, bank=3900, loadout_value=19500, buy_type="full_buy")], score=[0, 0])
    belief = {"visibleEnemies": [], "heardSounds": [], "knownEnemyAliveCount": 5,
              "tacticalHypotheses": [{"hypothesis": "defenders in default setup", "confidence": 0.5}]}
    return _context("scenario-01-basic-attack", "scenario-01", ws, 0, belief,
                    notes=["Round start; no enemies observed yet."])


def scenario_02():
    """Observed info: an enemy is seen at A site; attackers weigh A risk."""
    ctx = scenario_01()
    ctx["contextId"] = "scenario-02-observed-info"
    ctx["scenarioRef"] = "scenario-02"
    ctx["worldState"]["matchId"] = "synthetic-ascent-s02"
    ctx["worldState"]["roundId"] = "synthetic-ascent-s02:1"
    ctx["belief"] = {
        "visibleEnemies": [_enemy("def1", "a_site", ms_ago=1500, confidence=0.9)],
        "heardSounds": [_sound("footsteps", "a_main", ms_ago=3000)],
        "knownEnemyAliveCount": 5,
        "tacticalHypotheses": [{"hypothesis": "A is held by 2+ defenders", "confidence": 0.6}],
    }
    ctx["provenance"]["notes"].append("Belief shows only the observed A defender, not the full truth.")
    return ctx


def scenario_03():
    """Fake: attackers pressure A; the DEFENDERS decide rotation on observed info only."""
    players = []
    for pid, agent in ATK:
        spot = {"atk1": "a_main", "atk2": "a_lobby", "atk3": "mid_courtyard",
                "atk4": "mid_bottom", "atk5": "b_lobby"}[pid]
        lo = _loadout(pid, credits=200, weapon="vandal", armor="heavy", agent=agent, ult_points=4)
        players.append(_player(pid, 0, agent, spot, facing=0.0, loadout=lo))
    for pid, agent in DEF:
        spot = {"def1": "a_site", "def2": "b_site", "def3": "mid_top",
                "def4": "a_generator", "def5": "defender_spawn"}[pid]
        lo = _loadout(pid, credits=200, weapon="vandal", armor="heavy", agent=agent, ult_points=5)
        players.append(_player(pid, 1, agent, spot, loadout=lo))
    ws = _world("synthetic-ascent-s03", "synthetic-ascent-s03:1", 1, 62_000, "round", players,
                _spike_carried("atk5"),
                team_econ=[_team_econ(0, bank=1500, loadout_value=19000, buy_type="full_buy"),
                           _team_econ(1, bank=1800, loadout_value=19000, buy_type="full_buy")], score=[0, 0])
    belief = {
        "visibleEnemies": [_enemy("atk1", "a_main", ms_ago=800, confidence=0.95)],
        "heardSounds": [_sound("ability", "a_main", ms_ago=1200), _sound("footsteps", "a_lobby", ms_ago=1500)],
        "knownEnemyAliveCount": 5,
        "tacticalHypotheses": [
            {"hypothesis": "committed A execute", "confidence": 0.45},
            {"hypothesis": "A fake, spike elsewhere", "confidence": 0.3},
            {"hypothesis": "mid control for later split", "confidence": 0.25},
        ],
    }
    return _context("scenario-03-fake-defender-read", "scenario-03", ws, 1, belief,
                    notes=["Attackers show A but the spike carrier is lurking B (truth); defenders must not peek the truth."])


def scenario_04():
    """Time pressure: ~8s left, attackers at A main; a B rotation+plant is infeasible."""
    players = []
    for pid, agent in ATK:
        spot = {"atk1": "a_main", "atk2": "a_main", "atk3": "a_lobby",
                "atk4": "mid_courtyard", "atk5": "a_lobby"}[pid]
        lo = _loadout(pid, credits=0, weapon="vandal", armor="light", agent=agent, ult_points=5)
        players.append(_player(pid, 0, agent, spot, loadout=lo, facing=0.0))
    for pid, agent in DEF:
        spot = {"def1": "a_site", "def2": "b_site", "def3": "a_generator",
                "def4": "a_heaven", "def5": "mid_top"}[pid]
        players.append(_player(pid, 1, agent, spot,
                               loadout=_loadout(pid, credits=0, weapon="vandal", armor="heavy", agent=agent)))
    ws = _world("synthetic-ascent-s04", "synthetic-ascent-s04:1", 1, 8_000, "round", players,
                _spike_carried("atk1"),
                team_econ=[_team_econ(0, bank=800, loadout_value=16000, buy_type="full_buy"),
                           _team_econ(1, bank=5000, loadout_value=19000, buy_type="full_buy")], score=[0, 0])
    belief = {"visibleEnemies": [], "knownEnemyAliveCount": 5, "heardSounds": [],
              "tacticalHypotheses": [{"hypothesis": "A is stacked", "confidence": 0.5}]}
    return _context("scenario-04-time-pressure", "scenario-04", ws, 0, belief,
                    notes=["8s left at A main: a B-site rotation (distance + 4s plant) cannot complete -> infeasible candidate."])


def scenario_05():
    """Plant: attackers have A site control; plant allowed only inside the A plant zone."""
    players = []
    for pid, agent in ATK:
        spot = {"atk1": "a_site", "atk2": "a_site", "atk3": "a_cubby",
                "atk4": "a_generator", "atk5": "a_main"}[pid]
        players.append(_player(pid, 0, agent, spot,
                               loadout=_loadout(pid, credits=1200, weapon="vandal", armor="heavy",
                                                agent=agent, ult_points=6)))
    for pid, agent in DEF:
        alive = pid not in ("def1", "def4")
        spot = {"def1": "a_site", "def2": "b_site", "def3": "defender_spawn",
                "def4": "a_heaven", "def5": "mid_top"}[pid]
        players.append(_player(pid, 1, agent, spot, alive=alive, health=0 if not alive else 100,
                               loadout=_loadout(pid, credits=0, weapon="vandal", armor="heavy", agent=agent)))
    ws = _world("synthetic-ascent-s05", "synthetic-ascent-s05:1", 1, 30_000, "round", players,
                _spike_carried("atk1"),
                team_econ=[_team_econ(0, bank=1200, loadout_value=19000, buy_type="full_buy"),
                           _team_econ(1, bank=2000, loadout_value=11000)], score=[0, 0])
    belief = {"visibleEnemies": [], "knownEnemyAliveCount": 3, "heardSounds": [],
              "tacticalHypotheses": [{"hypothesis": "defenders saving for retake", "confidence": 0.55}]}
    ctx = _context("scenario-05-plant", "scenario-05", ws, 0, belief,
                   notes=["Carrier on A site (zone a-site, plantable): PLANT is feasible; a plant outside a plant zone must be rejected."])
    ctx["worldState"]["plantZones"] = {"A": _gw("a_site"), "B": _gw("b_site")}
    return ctx


def scenario_06():
    """Post-plant: spike down A default; defender positions evaluated vs plant location."""
    players = []
    for pid, agent in ATK:
        alive = pid != "atk5"
        spot = {"atk1": "a_generator", "atk2": "a_cubby", "atk3": "a_heaven",
                "atk4": "a_main", "atk5": "a_site"}[pid]
        players.append(_player(pid, 0, agent, spot, alive=alive, health=0 if not alive else 80,
                               loadout=_loadout(pid, credits=0, weapon="vandal", armor="light", agent=agent,
                                                ult_points=6)))
    for pid, agent in DEF:
        alive = pid in ("def2", "def3", "def5")
        spot = {"def1": "a_site", "def2": "b_main", "def3": "mid_courtyard",
                "def4": "a_heaven", "def5": "defender_spawn"}[pid]
        players.append(_player(pid, 1, agent, spot, alive=alive, health=0 if not alive else 100,
                               loadout=_loadout(pid, credits=0, weapon="vandal", armor="heavy", agent=agent,
                                                ult_points=6)))
    ws = _world("synthetic-ascent-s06", "synthetic-ascent-s06:1", 1, 24_000, "post_plant", players,
                _spike_planted("A", time_ms=24_000),
                team_econ=[_team_econ(0, bank=1000, loadout_value=14000),
                           _team_econ(1, bank=1500, loadout_value=14000)], score=[0, 0])
    belief = {"visibleEnemies": [], "knownEnemyAliveCount": 3,
              "heardSounds": [_sound("footsteps", "b_main", ms_ago=1000)],
              "tacticalHypotheses": [{"hypothesis": "retake grouping through B main/CT", "confidence": 0.5}]}
    return _context("scenario-06-post-plant", "scenario-06", ws, 0, belief,
                    notes=["3v3 post-plant A default; defender hold angles depend on the exact plant position."])


def scenario_07():
    """Operator save: 1v4, attacker has an Operator; evaluate preservation value."""
    players = [_player("atk1", 0, "jett", "a_main", health=60, armor=0,
                       loadout=_loadout("atk1", credits=900, weapon="operator", armor="none",
                                        agent="jett", ult_points=6, ability_charges={"e": 1}))]
    for pid, agent in ATK[1:]:
        players.append(_player(pid, 0, agent, "attacker_spawn", alive=False, health=0,
                               loadout=_loadout(pid, credits=0, agent=agent)))
    for pid, agent in DEF:
        alive = pid != "def5"
        spot = {"def1": "a_site", "def2": "a_generator", "def3": "mid_courtyard",
                "def4": "a_heaven", "def5": "a_lobby"}[pid]
        players.append(_player(pid, 1, agent, spot, alive=alive, health=0 if not alive else 100,
                               loadout=_loadout(pid, credits=2000, weapon="vandal", armor="heavy", agent=agent)))
    ws = _world("synthetic-ascent-s07", "synthetic-ascent-s07:1", 13, 35_000, "round", players,
                _spike_carried("atk1"),
                team_econ=[_team_econ(0, bank=900, loadout_value=4700, buy_type="save"),
                           _team_econ(1, bank=12000, loadout_value=20000)], score=[6, 6])
    belief = {"visibleEnemies": [_enemy("def1", "a_site", ms_ago=500, confidence=0.9)],
              "knownEnemyAliveCount": 4, "heardSounds": [],
              "tacticalHypotheses": [{"hypothesis": "4 defenders collapsing on A", "confidence": 0.7}]}
    return _context("scenario-07-operator-save", "scenario-07", ws, 0, belief,
                    notes=["1v4, Operator (4700cr) alive; many future rounds remain -> preservation value is high."])


def scenario_08():
    """Ultimate denial: avoid feeding an enemy key agent one point from their ult."""
    ctx = scenario_07()
    ctx["contextId"] = "scenario-08-ult-denial"
    ctx["scenarioRef"] = "scenario-08"
    ctx["worldState"]["matchId"] = "synthetic-ascent-s08"
    ctx["worldState"]["roundId"] = "synthetic-ascent-s08:1"
    for p in ctx["worldState"]["players"]:
        if p["playerId"] == "def4":
            p["agentId"] = "neon"
            p["loadout"]["ultimatePoints"] = 6
            p["loadout"]["ultimateCost"] = ult_cost("neon")
    ctx["provenance"]["notes"].append("def4 (neon) is 6/7 ult: a needless death this round could complete it.")
    ctx["belief"]["tacticalHypotheses"].append(
        {"hypothesis": "enemy neon near ult; avoid feeding the point", "confidence": 0.8})
    return ctx


def scenario_09():
    """Match point: a save would END the match, so future-round preservation value is zero."""
    ctx = scenario_07()
    ctx["contextId"] = "scenario-09-match-point"
    ctx["scenarioRef"] = "scenario-09"
    ctx["worldState"]["matchId"] = "synthetic-ascent-s09"
    ctx["worldState"]["roundId"] = "synthetic-ascent-s09:1"
    ctx["worldState"]["roundNum"] = 24
    ctx["worldState"]["matchScore"] = [11, 12]
    ctx["provenance"]["notes"].append("Team 0 at 11-12: if they lose this round the map ends -> no future round to save for.")
    ctx["belief"]["tacticalHypotheses"] = [{"hypothesis": "no future round; play to win now", "confidence": 0.9}]
    return ctx


def scenario_10():
    """Exit kill: winning team decides whether to chase an enemy saver or keep its own weapons."""
    players = []
    for pid, agent in ATK:
        alive = pid in ("atk1", "atk2", "atk3")
        spot = {"atk1": "a_site", "atk2": "a_generator", "atk3": "a_main",
                "atk4": "attacker_spawn", "atk5": "attacker_spawn"}[pid]
        players.append(_player(pid, 0, agent, spot, alive=alive, health=0 if not alive else 70,
                               loadout=_loadout(pid, credits=1500, weapon="vandal", armor="heavy",
                                                agent=agent, ult_points=5)))
    for pid, agent in DEF:
        alive = pid == "def1"
        spot = {"def1": "b_lane", "def2": "a_site", "def3": "a_site",
                "def4": "a_main", "def5": "mid_top"}[pid]
        players.append(_player(pid, 1, agent, spot, alive=alive, health=0 if not alive else 100,
                               loadout=_loadout(pid, credits=600, weapon="operator" if pid == "def1" else None,
                                                armor="heavy" if pid == "def1" else "none", agent=agent)))
    ws = _world("synthetic-ascent-s10", "synthetic-ascent-s10:1", 1, 15_000, "post_plant", players,
                _spike_planted("A", time_ms=15_000),
                team_econ=[_team_econ(0, bank=3000, loadout_value=12000),
                           _team_econ(1, bank=400, loadout_value=4700, buy_type="save")], score=[7, 5])
    belief = {"visibleEnemies": [_enemy("def1", "b_lane", ms_ago=1200, confidence=0.75)],
              "knownEnemyAliveCount": 1, "heardSounds": [_sound("footsteps", "b_lane", ms_ago=1000)],
              "tacticalHypotheses": [{"hypothesis": "last enemy saving the Operator toward B/CT", "confidence": 0.7}]}
    return _context("scenario-10-exit-kill", "scenario-10", ws, 0, belief,
                    notes=["Spike already down (round won if time runs); chasing the saver's Operator vs keeping 3 rifles safe."])


SCENARIOS = [scenario_01, scenario_02, scenario_03, scenario_04, scenario_05,
             scenario_06, scenario_07, scenario_08, scenario_09, scenario_10]


def build_scenarios() -> list[dict]:
    return [fn() for fn in SCENARIOS]


# --- synthetic map with a short event/position timeline --------------------------------------
def build_map(seed: int = 20260101) -> dict[str, Any]:
    """One synthetic Ascent map: a few rounds, each with events carrying game-world position snapshots."""
    rng = random.Random(seed)
    game_id = "synthetic-ascent-g1"
    match_id = "synthetic-ascent-m1"
    atk_ids = [p for p, _ in ATK]
    def_ids = [p for p, _ in DEF]
    all_ids = atk_ids + def_ids

    def snapshot(bias):
        out = []
        for pid in all_ids:
            zid = CALLOUT_ZONE[bias[pid]]
            ax, ay, az = ZONE_POS[zid]
            out.append({"playerId": pid, "x": round(ax + rng.uniform(-80, 80), 1),
                        "y": round(ay + rng.uniform(-80, 80), 1), "z": az, "frame": FRAME,
                        "zoneId": zid, "facingDeg": round(rng.uniform(0, 360), 1), "alive": True})
        return out

    rounds_out, events_out = [], []
    for rnum in (1, 2, 3):
        rid = f"{game_id}:{rnum}"
        bias = {"atk1": "a_main", "atk2": "a_lobby", "atk3": "mid_courtyard", "atk4": "a_main",
                "atk5": "b_lobby", "def1": "a_site", "def2": "b_site", "def3": "mid_top",
                "def4": "a_generator", "def5": "defender_spawn"}
        ev_specs = [
            (0, 12_000, "kill", "atk1", "def4", 0, 1, "vandal", None, "a_main", "a_generator"),
            (1, 28_000, "plant", "atk1", None, 0, None, None, "A", "a_site", None),
            (2, 40_000, "kill", "atk3", "def1", 0, 1, "phantom", None, "a_site", "mid_courtyard"),
        ]
        eids = []
        for (enum, t, etype, actor, victim, at, vt, weapon, site, pos, frm) in ev_specs:
            eid = f"{rid}:{enum}"
            eids.append(eid)
            events_out.append({
                "eventId": eid, "roundId": rid, "eventNum": enum, "type": etype, "timeMs": t,
                "actorPlayerId": actor, "victimPlayerId": victim,
                "actorTeamIdx": at, "victimTeamIdx": vt, "weapon": weapon, "site": site,
                "afterDetonation": False,
                "pos": _gw(pos) if pos else None, "fromPos": _gw(frm) if frm else None,
                "positions": snapshot(bias),
                "provenance": prov.synthetic(game_patch=None, evidence_type="simulated"),
            })
        rounds_out.append({
            "roundId": rid, "gameId": game_id, "matchId": match_id, "roundNum": rnum,
            "winnerTeamIdx": 0, "attackingTeamIdx": 0, "team0Side": "attack",
            "outcome": "bomb_detonated" if rnum != 2 else "defuse",
            "startEconomy": {"loadoutValue": [19000, 18000], "bank": [2000, 2500]},
            "plantSite": "A", "events": eids,
            "provenance": prov.synthetic(game_patch=None, evidence_type="simulated"),
        })

    map_rec = {
        "gameId": game_id, "matchId": match_id, "mapName": MAP_NAME, "pickedByTeamIdx": 0,
        "durationText": None, "score": [2, 1], "performanceAvailable": False, "economyAvailable": True,
        "rounds": [r["roundId"] for r in rounds_out], "playerMapStats": [],
        "provenance": prov.synthetic(game_patch=None, evidence_type="simulated"),
    }
    return {"map": map_rec, "rounds": rounds_out, "events": events_out}


# --- writers ---------------------------------------------------------------------------------
def _write_json(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def write_scenarios(out_dir: str) -> list[str]:
    paths = []
    for i, ctx in enumerate(build_scenarios(), start=1):
        path = os.path.join(out_dir, f"scenario_{i:02d}.json")
        _write_json(path, ctx)
        paths.append(path)
    return paths


def write_map(out_dir: str, seed: int = 20260101) -> dict[str, str]:
    data = build_map(seed)
    written = {}
    for name, payload in (("map.json", data["map"]), ("rounds.json", data["rounds"]),
                          ("events.json", data["events"])):
        path = os.path.join(out_dir, name)
        _write_json(path, payload)
        written[name] = path
    return written
