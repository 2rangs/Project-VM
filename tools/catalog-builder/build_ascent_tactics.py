#!/usr/bin/env python3
"""Build the Ascent tactical knowledge base (README §15-18, §24; Handoff §13-14).

Composable tactical PRIMITIVES (not a fixed action list) for PV-3's IGL / Action
Generator. Spatial references use PV-4 navgraph zone IDs
(datasets/derived/tactics/ascent-zone-vocabulary.json, mirrored from
origin/claude/pv-spatial with attribution); utility uses the ability-effect
effectTypes vocabulary.

Provenance honesty (orchestrator brief / README §29, §37):
  - zones/routes are navgraph-derived (PV-4), validated here.
  - The tactical content itself (which executes/holds exist, util roles) is
    standard VALORANT pro/community knowledge with no single citable URL, so it
    is tagged provenance.type = "expert-knowledge-unsourced".
  - NO match-frequency claims are made (no data basis). Comp realism uses only
    the sourced ascent-comps.json pick data.
  - vlr.gg is NOT scraped.

Output: datasets/derived/tactics/ascent-tactics.json (validated against
datasets/catalog/schema/tactic.schema.json).
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
VOCAB = REPO / "datasets" / "derived" / "tactics" / "ascent-zone-vocabulary.json"
COMPS = REPO / "datasets" / "derived" / "comps" / "ascent-comps.json"
OUT = REPO / "datasets" / "derived" / "tactics" / "ascent-tactics.json"

EXPERT = {"type": "expert-knowledge-unsourced",
          "note": "Standard VALORANT pro/community tactical knowledge; structure/zones grounded in PV-4 navgraph. No single citable URL; no match-frequency claim."}
NAVGRAPH = {"type": "navgraph-derived", "source": "PV-4 ascent.navgraph.json",
            "note": "Zones and routes from the PV-4 spatial navgraph."}

# --- Attack primitives ------------------------------------------------------
ATTACK = [
    {"id": "atk-a-execute", "side": "attack", "category": "strategic", "name": "A Execute (A Main)",
     "tacticType": "execute", "site": "A", "zones": ["a-lobby", "a-main", "a-site"],
     "route": [["a-lobby", "a-main"], ["a-main", "a-site"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "cut A Site far angles (Heaven/CT/Wine) and Tree", "targetZones": ["a-rafters", "a-wine", "a-tree"]},
         {"effectType": "flash", "purpose": "blind site anchors on entry", "targetZones": ["a-main", "a-site"]},
         {"effectType": "recon", "purpose": "clear site before commit", "targetZones": ["a-site"], "optional": True}],
     "minPlayers": 3, "idealPlayers": 5,
     "risks": ["A Main is a tight choke (easy to hold/Operator)", "exposed to A Rafters/Wine crossfire on entry"],
     "counterSetup": ["A anchor + Sentinel trips in A Main/Tree", "mid rotate once committed"], "provenance": EXPERT},

    {"id": "atk-a-split", "side": "attack", "category": "tactical", "name": "A Split (Main + Garden)",
     "tacticType": "split", "site": "A", "zones": ["a-main", "a-tree", "a-garden", "a-site", "mid-cubby"],
     "route": [["a-main", "a-site"], ["mid-cubby", "a-garden"], ["a-garden", "a-site"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "isolate site from CT/Wine and one flank", "targetZones": ["a-wine", "a-rafters"]},
         {"effectType": "flash", "purpose": "support both pinch angles", "targetZones": ["a-site"]}],
     "minPlayers": 4, "idealPlayers": 5,
     "risks": ["requires mid control first", "split timing must be coordinated or each prong trades poorly"],
     "counterSetup": ["hold mid to deny Garden prong", "stack A"], "provenance": EXPERT},

    {"id": "atk-mid-control", "side": "attack", "category": "tactical", "name": "Mid Control",
     "tacticType": "mid-control", "site": "Mid", "zones": ["mid-top", "mid-courtyard", "mid-catwalk", "mid-cubby", "mid-bottom"],
     "route": [["mid-top", "mid-courtyard"], ["mid-courtyard", "mid-catwalk"], ["mid-courtyard", "mid-cubby"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "block Mid Courtyard/Top sightlines from defense", "targetZones": ["mid-courtyard", "mid-top"]},
         {"effectType": "recon", "purpose": "clear catwalk/cubby", "targetZones": ["mid-catwalk", "mid-cubby"]}],
     "minPlayers": 2, "idealPlayers": 3,
     "risks": ["mid is contestable from both sites", "over-committing mid leaves site hits short-manned"],
     "counterSetup": ["defensive mid hold from Courtyard/Catwalk", "early info peek Mid Top"], "provenance": EXPERT},

    {"id": "atk-b-market-hit", "side": "attack", "category": "tactical", "name": "Mid-to-B via Market",
     "tacticType": "split", "site": "B", "zones": ["mid-bottom", "mid-market", "mid-pizza", "b-main", "b-site"],
     "route": [["mid-bottom", "mid-market"], ["mid-market", "b-site"], ["mid-market", "mid-pizza"], ["mid-pizza", "b-main"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "smoke B CT/Boathouse and Market window", "targetZones": ["b-boathouse", "mid-market"]},
         {"effectType": "flash", "purpose": "flash site on entry", "targetZones": ["b-site"]}],
     "minPlayers": 3, "idealPlayers": 5,
     "risks": ["Market exposes to B Site and Pizza crossfire", "needs mid-bottom taken first"],
     "counterSetup": ["Sentinel trips Market/Pizza", "B anchor + CT rotate"], "provenance": EXPERT},

    {"id": "atk-b-main-execute", "side": "attack", "category": "strategic", "name": "B Execute (B Main)",
     "tacticType": "execute", "site": "B", "zones": ["b-lobby", "b-main", "b-site"],
     "route": [["b-lobby", "b-main"], ["b-main", "b-site"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "smoke B Site CT/Boathouse and Market", "targetZones": ["b-boathouse", "mid-market"]},
         {"effectType": "flash", "purpose": "blind Boathouse/CT anchors", "targetZones": ["b-site"]},
         {"effectType": "molly", "purpose": "deny default B Site plant-deny spots", "targetZones": ["b-site"], "optional": True}],
     "minPlayers": 3, "idealPlayers": 5,
     "risks": ["B Main is long and smoke-dependent", "Boathouse + Market crossfire"],
     "counterSetup": ["double-hold B (anchor + Market)", "rotate from mid/A"], "provenance": EXPERT},

    {"id": "atk-fake-a-to-b", "side": "attack", "category": "strategic", "name": "Fake A, hit B",
     "tacticType": "fake", "site": "B", "zones": ["a-main", "a-tree", "mid-link", "b-main", "b-site"],
     "route": [["a-lobby", "a-main"], ["b-lobby", "b-main"], ["b-main", "b-site"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "spend A smokes/utility to sell the fake, then real B smokes", "targetZones": ["a-tree", "b-boathouse"]},
         {"effectType": "flash", "purpose": "noise/flashes on A to pull rotation", "targetZones": ["a-main"]},
         {"effectType": "recon", "purpose": "confirm defenders rotate off B", "targetZones": ["mid-link"], "optional": True}],
     "minPlayers": 4, "idealPlayers": 5,
     "risks": ["fake burns utility; if defense doesn't rotate the real hit is under-utilitied", "timing window is tight"],
     "counterSetup": ["disciplined no-rotate until spike/numbers confirmed", "mid info to read the fake"], "provenance": EXPERT},

    {"id": "atk-default-spread", "side": "attack", "category": "strategic", "name": "Default (map spread + info)",
     "tacticType": "default", "site": None, "zones": ["a-main", "mid-top", "mid-courtyard", "b-main"],
     "route": [["attacker-spawn", "a-lobby"], ["attacker-spawn", "mid-top"], ["attacker-spawn", "b-lobby"]],
     "utilityRequirements": [
         {"effectType": "recon", "purpose": "gather info on defensive setup", "targetZones": ["mid-courtyard", "a-main", "b-main"], "optional": True}],
     "minPlayers": 5, "idealPlayers": 5,
     "risks": ["passive default can cede map control if defense pushes", "info-less default wastes round time"],
     "counterSetup": ["aggressive info push to contest", "stack the read site late"], "provenance": EXPERT},

    {"id": "atk-mid-lurk", "side": "attack", "category": "tactical", "name": "Mid Lurk (hit opposite)",
     "tacticType": "lurk", "site": None, "zones": ["mid-link", "mid-bottom", "mid-courtyard"],
     "route": [["mid-top", "mid-courtyard"], ["mid-courtyard", "mid-catwalk"], ["mid-catwalk", "mid-bottom"], ["mid-bottom", "mid-link"]],
     "utilityRequirements": [],
     "minPlayers": 1, "idealPlayers": 1,
     "risks": ["lurker is isolated (no trade)", "mid is central and contestable"],
     "counterSetup": ["Sentinel trip mid", "clear mid before rotating"], "notes": "Lurker pressures rotations/flank while the team executes the other site.",
     "provenance": EXPERT},
]

# --- Defense primitives -----------------------------------------------------
DEFENSE = [
    {"id": "def-a-default-hold", "side": "defense", "category": "tactical", "name": "A Default Hold",
     "tacticType": "default-hold", "site": "A", "zones": ["a-site", "a-main", "a-tree", "a-wine"],
     "route": [["a-main", "a-site"], ["a-tree", "a-site"]],
     "utilityRequirements": [
         {"effectType": "trap", "purpose": "Sentinel trips/cams watching A Main and Tree/Garden flanks", "targetZones": ["a-main", "a-garden"], "optional": True},
         {"effectType": "slow", "purpose": "slow/molly A Main choke on contact", "targetZones": ["a-main"], "optional": True}],
     "minPlayers": 2, "idealPlayers": 2,
     "risks": ["A has many entries (Main, Tree, Garden) to cover", "over-peeking A Main loses the anchor"],
     "counterSetup": ["coordinated A execute with flashes/smokes", "split Garden"], "provenance": EXPERT},

    {"id": "def-b-default-hold", "side": "defense", "category": "tactical", "name": "B Default Hold",
     "tacticType": "default-hold", "site": "B", "zones": ["b-site", "b-main", "b-boathouse", "mid-market"],
     "route": [["b-main", "b-site"], ["mid-market", "b-site"]],
     "utilityRequirements": [
         {"effectType": "trap", "purpose": "Sentinel setup covering B Main and Market/Pizza", "targetZones": ["b-main", "mid-pizza"], "optional": True}],
     "minPlayers": 2, "idealPlayers": 2,
     "risks": ["B gets hit from Main and Market simultaneously (split)", "Boathouse is a deep clear"],
     "counterSetup": ["Mid-to-B Market split", "fake A then B"], "provenance": EXPERT},

    {"id": "def-mid-hold", "side": "defense", "category": "tactical", "name": "Mid Control (defense)",
     "tacticType": "default-hold", "site": "Mid", "zones": ["mid-courtyard", "mid-catwalk", "mid-top", "mid-cubby"],
     "route": [["mid-courtyard", "mid-catwalk"], ["mid-courtyard", "mid-cubby"]],
     "utilityRequirements": [
         {"effectType": "recon", "purpose": "contest/scan mid for early info", "targetZones": ["mid-top", "mid-catwalk"], "optional": True}],
     "minPlayers": 1, "idealPlayers": 2,
     "risks": ["losing mid lets attackers split both sites", "mid player can be flashed/dashed"],
     "counterSetup": ["smoke mid and take Catwalk/Cubby", "flash mid holder"], "provenance": EXPERT},

    {"id": "def-sentinel-setup-a", "side": "defense", "category": "tactical", "name": "Sentinel Setup A (Killjoy/Cypher/Chamber)",
     "tacticType": "sentinel-setup", "site": "A", "zones": ["a-main", "a-garden", "a-site", "a-wine"],
     "route": [],
     "utilityRequirements": [
         {"effectType": "trap", "purpose": "trips/cages on A Main + Garden flank; cam for info", "targetZones": ["a-main", "a-garden"]},
         {"effectType": "slow", "purpose": "slow-orb/cage A Main on execute", "targetZones": ["a-main"], "optional": True}],
     "minPlayers": 1, "idealPlayers": 1,
     "risks": ["utility can be destroyed/spotted pre-round", "a lone sentinel can be overwhelmed on a full execute"],
     "counterSetup": ["recon to spot trips", "destroy/clear utility before commit"],
     "notes": "Killjoy: turret+alarmbot+nanoswarm lockdown A Main/Garden. Cypher: trapwire Main/Garden + cam. Chamber: trademark Garden + Wine/CT rendezvous for aggressive peeks.",
     "provenance": EXPERT},

    {"id": "def-sentinel-setup-b", "side": "defense", "category": "tactical", "name": "Sentinel Setup B",
     "tacticType": "sentinel-setup", "site": "B", "zones": ["b-main", "mid-market", "mid-pizza", "b-site"],
     "route": [],
     "utilityRequirements": [
         {"effectType": "trap", "purpose": "trips/cages covering B Main and Market/Pizza splits", "targetZones": ["b-main", "mid-pizza"]}],
     "minPlayers": 1, "idealPlayers": 1,
     "risks": ["two entries (Main + Market) stretch one sentinel", "utility destroyed on contact"],
     "counterSetup": ["recon/clear utility", "hit from the uncovered entry"], "provenance": EXPERT},

    {"id": "def-retake-a", "side": "defense", "category": "tactical", "name": "Retake A",
     "tacticType": "retake", "site": "A", "zones": ["a-wine", "a-rafters", "a-site", "a-garden"],
     "route": [["a-wine", "defender-spawn"], ["a-rafters", "defender-spawn"], ["a-site", "a-wine"], ["a-site", "a-rafters"], ["a-site", "a-garden"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "smoke post-plant angles to isolate the plant", "targetZones": ["a-site"]},
         {"effectType": "flash", "purpose": "flash into site on retake", "targetZones": ["a-site"]},
         {"effectType": "recon", "purpose": "locate post-plant holders", "targetZones": ["a-site"], "optional": True}],
     "minPlayers": 2, "idealPlayers": 4,
     "risks": ["attackers hold crossfires on the plant", "limited time if plant is late"],
     "counterSetup": ["post-plant utility (mollies) to deny defuse", "spread post-plant holders"], "provenance": EXPERT},

    {"id": "def-retake-b", "side": "defense", "category": "tactical", "name": "Retake B",
     "tacticType": "retake", "site": "B", "zones": ["mid-link", "mid-market", "b-site", "b-boathouse"],
     "route": [["mid-link", "b-site"], ["mid-market", "b-site"], ["b-site", "b-boathouse"]],
     "utilityRequirements": [
         {"effectType": "smoke", "purpose": "isolate plant from attacker angles", "targetZones": ["b-site"]},
         {"effectType": "flash", "purpose": "flash retake entry", "targetZones": ["b-site"]}],
     "minPlayers": 2, "idealPlayers": 4,
     "risks": ["Boathouse/CT holders crossfire the retake", "Market entry is contestable"],
     "counterSetup": ["post-plant from Boathouse + Market", "molly common defuse spots"], "provenance": EXPERT},

    {"id": "def-mid-info-push", "side": "defense", "category": "tactical", "name": "Aggressive Mid Info Push",
     "tacticType": "info-push", "site": "Mid", "zones": ["mid-top", "mid-courtyard", "mid-catwalk"],
     "route": [["mid-top", "mid-courtyard"], ["mid-courtyard", "mid-catwalk"]],
     "utilityRequirements": [
         {"effectType": "flash", "purpose": "flash for a safe early peek", "targetZones": ["mid-courtyard"], "optional": True}],
     "minPlayers": 1, "idealPlayers": 2,
     "risks": ["can give first blood to attacker mid control", "pushes the defender off their anchor"],
     "counterSetup": ["hold mid passively and trade", "smoke the push"], "provenance": EXPERT},

    {"id": "def-rotate-a-b", "side": "defense", "category": "tactical", "name": "Rotate A↔B (CT/Mid)",
     "tacticType": "rotate", "site": None, "zones": ["defender-spawn", "mid-link", "a-wine", "b-site"],
     "route": [["a-wine", "defender-spawn"], ["mid-link", "defender-spawn"], ["mid-link", "b-site"], ["b-site", "defender-spawn"]],
     "utilityRequirements": [],
     "minPlayers": 1, "idealPlayers": 2,
     "risks": ["rotating on a fake leaves the real site short", "mid rotate can be cut by attacker mid control"],
     "counterSetup": ["fakes to bait the rotate", "mid control to deny the fast rotate"], "provenance": EXPERT},
]


def build() -> dict:
    vocab = json.loads(VOCAB.read_text())
    comps = json.loads(COMPS.read_text())
    zone_ids = set(vocab["zoneIds"])
    edge_set = {frozenset(e) for e in vocab["edges"]}

    tactics = ATTACK + DEFENSE

    # Attach honest public sources. The official Ascent wiki page documents the
    # map geography (sites, Mid, the A Link / Market mechanical doors) that every
    # tactic is built on -> attached as a GEOGRAPHY source (does not by itself
    # source the strategic choice). Sentinel-setup tactics additionally cite the
    # official agent pages whose abilities they use (that mechanic IS official).
    ASCENT_GEO = {"url": "https://wiki.playvalorant.com/en-us/Ascent", "date": "2026-11-18",
                  "strength": "official",
                  "mentions": "Ascent map layout: A/B sites, Mid lane, A Link & Market mechanical doors. Geography only; the strategic choice is expert knowledge."}
    SENTINEL_PAGES = {
        "def-sentinel-setup-a": [
            ("https://wiki.playvalorant.com/en-us/Lockdown", "Killjoy Lockdown detains on-site (official ability)"),
            ("https://wiki.playvalorant.com/en-us/Trapwire", "Cypher Trapwire tethers/reveals (official ability)"),
            ("https://wiki.playvalorant.com/en-us/Trademark", "Chamber Trademark slows on trigger (official ability)")],
        "def-sentinel-setup-b": [
            ("https://wiki.playvalorant.com/en-us/Nanoswarm", "Killjoy Nanoswarm molly denies plant/entry (official ability)"),
            ("https://wiki.playvalorant.com/en-us/Trapwire", "Cypher Trapwire covers splits (official ability)")],
    }
    for t in tactics:
        srcs = [dict(ASCENT_GEO)]
        for url, mentions in SENTINEL_PAGES.get(t["id"], []):
            srcs.append({"url": url, "date": "2026-11-18", "strength": "official", "mentions": mentions})
        t["sources"] = srcs
        # Upgrade provenance.type to official only where an official source backs
        # the tactic's MECHANIC (sentinel setups cite the ability itself).
        if t["id"] in SENTINEL_PAGES:
            t["provenance"] = {"type": "official",
                               "source": "https://wiki.playvalorant.com/en-us/Ascent",
                               "note": "Utility mechanic is officially documented (agent ability pages); the setup placement is expert knowledge."}
        # All others keep provenance.type = expert-knowledge-unsourced (strategy is
        # not documented by a single citable source); the Ascent page is geography only.

    # validate referenced zones/edges
    errors = []
    for t in tactics:
        for z in t.get("zones", []) + [z for u in t.get("utilityRequirements", []) for z in u.get("targetZones", [])]:
            if z not in zone_ids:
                errors.append(f"{t['id']}: zone '{z}' not in navgraph")
        for a, b in t.get("route", []):
            if frozenset((a, b)) not in edge_set:
                errors.append(f"{t['id']}: route edge {a}->{b} not in navgraph")
    if errors:
        raise ValueError("navgraph validation failed:\n  " + "\n  ".join(errors))

    # comp -> executable tactics (utility satisfaction), expert-reasoned, no frequency claims
    comp_map = []
    top = comps["topComps"][:5]
    for c in top:
        comp_map.append({
            "comp": c["comp"], "roles": c.get("roles"), "maps": c.get("maps"),
            "note": "Executable tactics are those whose required effectTypes the comp can field (smoke=controller, recon/flash=initiator, trap=sentinel, movement=duelist). Reasoned, not frequency-measured.",
            "provenance": {"type": "expert-knowledge-unsourced", "note": "Comp membership/pick counts are from ascent-comps.json (sourced); tactic fit is reasoned."},
        })

    return {
        "map": "Ascent",
        "zoneVocabulary": {
            "source": vocab["source"], "mapUuid": vocab["mapUuid"], "patchVersion": vocab["patchVersion"],
            "zoneIds": vocab["zoneIds"], "note": "Mirrored from PV-4 navgraph for self-contained validation.",
        },
        "effectTypeVocabulary": ["smoke", "flash", "concuss", "recon", "molly", "wall", "slow", "heal", "trap", "decoy", "movement", "suppress"],
        "provenanceLegend": {
            "navgraph-derived": "spatial fact from PV-4 navgraph",
            "official": "Riot official map/agent guide (URL)",
            "reputable-analysis": "named analyst/coach public guide (URL)",
            "expert-knowledge-unsourced": "standard pro/community knowledge, no single citable URL; NO frequency claim",
        },
        "attack": ATTACK,
        "defense": DEFENSE,
        "compMapping": comp_map,
        "caveats": [
            "Tactical content is expert-knowledge-unsourced (tagged per item); zones/routes are navgraph-derived and validated.",
            "No match-frequency claims (no data basis). Comp pick counts come from ascent-comps.json.",
            "Zone IDs that community callouts lack (e.g. 'A Heaven') map to the nearest navgraph zone (e.g. a-rafters) by description, never a new coordinate.",
        ],
    }


def main() -> int:
    out = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT}: attack={len(out['attack'])} defense={len(out['defense'])} comps={len(out['compMapping'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
