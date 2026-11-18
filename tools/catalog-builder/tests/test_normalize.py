"""Unit tests for pure normalization + schema validation. Run: pytest -q"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent
REPO = TOOL.parent.parent
SCHEMA_DIR = REPO / "datasets" / "catalog" / "schema"
sys.path.insert(0, str(TOOL))

import normalize  # noqa: E402
import validate as validate_mod  # noqa: E402

RETRIEVED = "2026-11-18T00:00:00Z"
PATCH = "release-13.10"


@pytest.fixture
def weapons_raw():
    return json.loads((HERE / "fixtures" / "weapons_min.json").read_text())["data"]


@pytest.fixture
def agents_raw():
    return json.loads((HERE / "fixtures" / "agents_min.json").read_text())["data"]


# ---- weapons ----

def test_wall_penetration_enum_stripped():
    assert normalize.normalize_wall_penetration("EWallPenetrationDisplayType::Medium") == "Medium"
    assert normalize.normalize_wall_penetration(None) is None


def test_weapon_seconds_to_ms(weapons_raw):
    rifle = normalize.normalize_weapon(weapons_raw[0], patch=PATCH, retrieved_at=RETRIEVED)
    assert rifle["weaponStats"]["reloadTimeMs"] == 2500.0
    assert rifle["weaponStats"]["equipTimeMs"] == 1000.0
    assert rifle["cost"] == 2900
    assert rifle["category"] == "Rifles"  # shopData category preferred
    assert rifle["weaponStats"]["wallPenetration"] == "Medium"
    assert rifle["weaponStats"]["damageRanges"][0]["headDamage"] == 160
    assert rifle["provenance"]["verified"] is True


def test_weapon_melee_null_cost(weapons_raw):
    melee = normalize.normalize_weapon(weapons_raw[1], patch=PATCH, retrieved_at=RETRIEVED)
    assert melee["cost"] is None
    # category falls back to weapon.category enum when no shopData
    assert melee["category"] == "Melee"


# ---- agents / abilities ----

def test_agent_role_and_slots(agents_raw):
    agent = normalize.normalize_agent(agents_raw[0], patch=PATCH, retrieved_at=RETRIEVED)
    assert agent["role"] == "Controller"
    slots = {s["slot"] for s in agent["abilitySlots"]}
    assert slots == {"Ability1", "Ability2", "Grenade", "Ultimate", "Passive"}
    assert agent["abilitySlots"][0]["abilityId"] == "testagent:Ability1"


def test_abilities_gameplay_null_unverified_without_facts(agents_raw):
    abilities = normalize.normalize_abilities(agents_raw[0], patch=PATCH, retrieved_at=RETRIEVED, facts={})
    assert len(abilities) == 5
    for ab in abilities:
        assert ab["gameplay"]["gameplayVerified"] is False
        assert ab["gameplay"]["cost"] is None
        assert ab["gameplay"]["ultPoints"] is None
        assert ab["gameplay"]["typeTags"] == []
        assert ab["name"]  # name is API-verified
        assert ab["provenance"]["verified"] is True


def test_abilities_use_sourced_facts(agents_raw):
    facts = {
        "testagent:Ultimate": {
            "ultPoints": 7, "typeTags": ["damage"], "gameplayVerified": True,
            "gameplaySource": "https://example.test/patch-notes",
        }
    }
    abilities = normalize.normalize_abilities(agents_raw[0], patch=PATCH, retrieved_at=RETRIEVED, facts=facts)
    ult = [a for a in abilities if a["slot"] == "Ultimate"][0]
    assert ult["gameplay"]["ultPoints"] == 7
    assert ult["gameplay"]["gameplayVerified"] is True
    assert ult["gameplay"]["gameplaySource"].startswith("https://")


# ---- schema validation ----

def test_normalized_weapons_validate(weapons_raw):
    recs = [normalize.normalize_weapon(w, patch=PATCH, retrieved_at=RETRIEVED) for w in weapons_raw]
    ok, errs = validate_mod.validate_records(recs, SCHEMA_DIR, "weapon.schema.json")
    assert ok, errs


def test_normalized_agents_and_abilities_validate(agents_raw):
    agents = [normalize.normalize_agent(a, patch=PATCH, retrieved_at=RETRIEVED) for a in agents_raw]
    ok, errs = validate_mod.validate_records(agents, SCHEMA_DIR, "agent.schema.json")
    assert ok, errs
    abilities = []
    for a in agents_raw:
        abilities.extend(normalize.normalize_abilities(a, patch=PATCH, retrieved_at=RETRIEVED))
    ok2, errs2 = validate_mod.validate_records(abilities, SCHEMA_DIR, "ability.schema.json")
    assert ok2, errs2


def test_equipment_validate_and_sourced():
    from equipment_facts import EQUIPMENT
    ok, errs = validate_mod.validate_records([dict(e) for e in EQUIPMENT], SCHEMA_DIR, "equipment.schema.json")
    assert ok, errs
    by_id = {e["id"]: e for e in EQUIPMENT}
    # officially sourced shield values (wiki Armor & Shield)
    assert by_id["shield-light"]["cost"] == 400 and by_id["shield-light"]["armor"] == 25
    assert by_id["shield-heavy"]["cost"] == 1000 and by_id["shield-heavy"]["armor"] == 50
    assert by_id["shield-regen"]["cost"] == 650 and by_id["shield-regen"]["regenPool"] == 50
    assert by_id["spike"]["plantTimeMs"] == 4000 and by_id["spike"]["defuseTimeMs"] == 7000
    # every sourced value carries a source URL and cross-check flag
    for e in EQUIPMENT:
        if e["verified"]:
            assert e["source"] and e["source"].startswith("https://")
        assert e["needsCrossCheckPV3"] is True


def test_ability_effects_validate_and_sourced():
    import effects as effects_mod
    recs = effects_mod.load_effects()
    assert len(recs) >= 30
    ok, errs = validate_mod.validate_records(recs, SCHEMA_DIR, "ability-effect.schema.json")
    assert ok, errs
    by_id = {r["abilityId"]: r for r in recs}
    # spot-check officially-sourced values
    dark = by_id["omen:Ability2"]  # Dark Cover (smoke)
    assert "smoke" in dark["effectTypes"]
    assert dark["params"]["blocksVision"] is True
    assert dark["params"]["radiusMeters"] == 4.1 and dark["params"]["durationMs"] == 15000.0
    assert dark["params"]["defaultKeybind"] == "E"
    assert dark["sourcePage"].startswith("https://")
    # sourced records carry field provenance
    for r in recs:
        if r["verified"]:
            assert r["sourcePage"] and r["fieldSources"]


def test_ability_facts_have_keybinds():
    from ability_facts import ABILITY_FACTS
    KEY = {"Ability1": "Q", "Ability2": "E", "Grenade": "C", "Ultimate": "X"}
    for k, v in ABILITY_FACTS.items():
        slot = k.rsplit(":", 1)[1]
        if slot in KEY:
            assert v.get("defaultKeybind") == KEY[slot], k


def test_ascent_comps_committed_valid():
    """The committed derived comp stats validate against their schema."""
    comps_dir = REPO / "datasets" / "derived" / "comps"
    data = json.loads((comps_dir / "ascent-comps.json").read_text())
    schema = json.loads((comps_dir / "ascent-comps.schema.json").read_text())
    import jsonschema
    jsonschema.Draft7Validator(schema).validate(data)
    assert data["overall"]["teamMaps"] > 0
    assert data["provenance"]["verified"] is True and data["provenance"]["sha256"]
    # pick rates are a proper rate in [0,1]
    for row in data["pickRate"]:
        assert 0.0 <= row["pickRate"] <= 1.0


def test_riot_crosscheck_uuids_pure():
    import riot_content
    content = {"version": "release-13.10",
               "characters": [{"id": "AAA", "name": "A"}, {"id": "BBB", "name": "B"}],
               "equips": [{"id": "WWW", "name": "W"}]}
    agents = [{"id": "aaa", "name": "A"}, {"id": "zzz", "name": "Z"}]
    weapons = [{"id": "www", "name": "W"}]
    xc = riot_content.crosscheck_uuids(content, agents, weapons)
    assert xc["build"] == "release-13.10"
    assert xc["agents_matched"] == 1 and xc["agents_missing"] == ["Z"]
    assert xc["weapons_matched"] == 1 and xc["weapons_missing"] == []


def test_riot_try_fetch_skips_cleanly(monkeypatch):
    import urllib.error
    import riot_content

    def boom(url, timeout=30):
        raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)

    monkeypatch.setattr(riot_content, "fetch_content", boom)
    content, reason = riot_content.try_fetch_content()
    assert content is None and "401" in reason  # expired/absent dev key -> clean skip


def test_ability_facts_loaded_and_applied(agents_raw):
    from ability_facts import ABILITY_FACTS
    assert len(ABILITY_FACTS) >= 100
    # every ultimate entry has an integer ult-point cost with a source
    ults = {k: v for k, v in ABILITY_FACTS.items() if k.endswith(":Ultimate")}
    assert len(ults) == 30
    for k, v in ults.items():
        assert isinstance(v["ultPoints"], int)
        assert v["gameplaySource"].startswith("https://")
    # normalize applies facts onto the matching ability (join by name -> slot)
    abilities = []
    for a in agents_raw:
        abilities.extend(normalize.normalize_abilities(a, patch=PATCH, retrieved_at=RETRIEVED, facts=ABILITY_FACTS))
    # fixture agent is synthetic -> no facts match -> stays null (proves no accidental fill)
    assert all(ab["gameplay"]["ultPoints"] is None for ab in abilities)
