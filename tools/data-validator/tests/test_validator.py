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
