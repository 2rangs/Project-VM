import json

from conftest import DATASETS_DIR, SCHEMA_DIR
from pv_data_validator import load_registry, validate_file, validate_tree


def test_all_committed_datasets_are_valid():
    results = validate_tree(str(DATASETS_DIR), str(SCHEMA_DIR))
    assert results, "no dataset files were found to validate"
    failures = [(r.path, r.errors) for r in results if not r.ok]
    assert not failures, failures
    # Expect at least the two real matches + synthetic scenarios + synthetic map.
    assert sum(r.records for r in results) >= 150


def test_every_schema_file_loads():
    reg = load_registry(str(SCHEMA_DIR))
    for sid in ("match.schema.json", "world-state.schema.json", "event.schema.json"):
        assert reg.get_or_retrieve(sid).value.contents["$id"] == sid


def test_separation_rule_catches_mislabelled_synthetic(tmp_path):
    """A synthetic-flagged record under datasets/normalized/ must fail."""
    reg = load_registry(str(SCHEMA_DIR))
    bad = tmp_path / "datasets" / "normalized" / "x" / "teams.json"
    bad.parent.mkdir(parents=True)
    bad.write_text(json.dumps([{
        "teamId": "1", "name": "Test",
        "provenance": {"sourceId": "x", "retrievedAt": "2026-01-01T00:00:00+00:00",
                       "evidenceType": "observed", "synthetic": True},  # wrong for /normalized/
    }]))
    res = validate_file(str(bad), reg)
    assert not res.ok
    assert any("separation violated" in e for e in res.errors)


def test_schema_rejects_bad_record(tmp_path):
    reg = load_registry(str(SCHEMA_DIR))
    bad = tmp_path / "datasets" / "synthetic" / "scenarios" / "scenario_99.json"
    bad.parent.mkdir(parents=True)
    bad.write_text(json.dumps({"contextId": "x"}))  # missing required worldState/decidingTeamIdx/provenance
    res = validate_file(str(bad), reg)
    assert not res.ok


def _write_zone_ref(tmp_path):
    """Minimal navgraph ref so zone checks can resolve (v2, game-world uu)."""
    ref = tmp_path / "datasets" / "synthetic" / "ascent" / "ascent_zones_ref.json"
    ref.parent.mkdir(parents=True, exist_ok=True)
    ref.write_text(json.dumps({
        "zones": [
            {"id": "a-site", "position": {"x": 6153.6, "y": -6626.2, "z": 500.0}},
            {"id": "mid", "position": {"x": 0.0, "y": 0.0, "z": 0.0}},
        ]
    }))


def _scenario(zone_id, x, y):
    """A minimal valid DecisionContext with one player at (zone_id, x, y)."""
    return {
        "contextId": "zc", "formatVersion": 2,
        "worldState": {
            "matchId": "syn", "roundId": "syn:1", "mapName": "Ascent",
            "timeRemainingMs": 100000, "roundPhase": "round",
            "players": [{
                "playerId": "p0", "teamIdx": 0, "alive": True,
                "zoneId": zone_id,
                "position": {"x": x, "y": y, "z": 500.0, "frame": "game-world-uu"},
            }],
            "spike": {"status": "carried", "carrierPlayerId": "p0"},
        },
        "decidingTeamIdx": 0,
        "provenance": {"sourceId": "syn", "retrievedAt": "2026-01-01T00:00:00+00:00",
                       "evidenceType": "simulated", "synthetic": True},
    }


def test_zone_check_accepts_position_on_zone(tmp_path):
    reg = load_registry(str(SCHEMA_DIR))
    _write_zone_ref(tmp_path)
    good = tmp_path / "datasets" / "synthetic" / "scenarios" / "scenario_98.json"
    good.parent.mkdir(parents=True, exist_ok=True)
    good.write_text(json.dumps(_scenario("a-site", 6153.6, -6626.2)))
    res = validate_file(str(good), reg)
    assert res.ok, res.errors


def test_zone_check_rejects_unknown_zone_id(tmp_path):
    reg = load_registry(str(SCHEMA_DIR))
    _write_zone_ref(tmp_path)
    bad = tmp_path / "datasets" / "synthetic" / "scenarios" / "scenario_97.json"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text(json.dumps(_scenario("nowhere", 6153.6, -6626.2)))
    res = validate_file(str(bad), reg)
    assert not res.ok
    assert any("not in navgraph zones" in e for e in res.errors)


def test_zone_check_rejects_position_far_from_zone(tmp_path):
    reg = load_registry(str(SCHEMA_DIR))
    _write_zone_ref(tmp_path)
    bad = tmp_path / "datasets" / "synthetic" / "scenarios" / "scenario_96.json"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text(json.dumps(_scenario("a-site", 0.0, 0.0)))  # a-site is ~9000uu away
    res = validate_file(str(bad), reg)
    assert not res.ok
    assert any("from zone a-site" in e for e in res.errors)
