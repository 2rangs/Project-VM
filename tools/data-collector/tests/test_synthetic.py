from pv_data_collector import synthetic_ascent as syn


def test_ten_scenarios_all_synthetic():
    ctxs = syn.build_scenarios()
    assert len(ctxs) == 10
    for c in ctxs:
        assert c["provenance"]["synthetic"] is True, c["contextId"]
        assert c["decidingTeamIdx"] in (0, 1)
        ws = c["worldState"]
        assert ws["mapName"] == "Ascent"
        assert 1 <= len(ws["players"]) <= 10
        assert ws["timeRemainingMs"] >= 0


def test_scenario_refs_are_unique_and_ordered():
    ctxs = syn.build_scenarios()
    refs = [c["scenarioRef"] for c in ctxs]
    assert refs == [f"scenario-{i:02d}" for i in range(1, 11)]


def test_belief_never_leaks_ground_truth_positions():
    """A deciding team's belief must only reference enemies via observation/inference, with evidence tags."""
    allowed = {"observed", "inferred", "derived"}
    for c in syn.build_scenarios():
        deciding = c["decidingTeamIdx"]
        enemy_ids = {p["playerId"] for p in c["worldState"]["players"] if p["teamIdx"] != deciding}
        for e in c["belief"].get("visibleEnemies", []):
            assert e["playerId"] in enemy_ids
            assert e["evidence"] in allowed, (c["contextId"], e)


def test_scenario_07_is_one_v_four():
    c = next(x for x in syn.build_scenarios() if x["scenarioRef"] == "scenario-07")
    ws = c["worldState"]
    deciding = c["decidingTeamIdx"]
    own_alive = [p for p in ws["players"] if p["teamIdx"] == deciding and p["alive"]]
    enemy_alive = [p for p in ws["players"] if p["teamIdx"] != deciding and p["alive"]]
    assert len(own_alive) == 1
    assert len(enemy_alive) == 4
    # The surviving attacker is holding an Operator (the save subject).
    assert own_alive[0]["loadout"]["weaponId"] == "operator"


def test_scenario_09_removes_future_rounds():
    c = next(x for x in syn.build_scenarios() if x["scenarioRef"] == "scenario-09")
    # deciding team is one round from losing the map -> no future round to save for.
    score = c["worldState"]["matchScore"]
    deciding = c["decidingTeamIdx"]
    assert score[1 - deciding] == 12


def test_map_generation_is_deterministic():
    a = syn.build_map(seed=20260101)
    b = syn.build_map(seed=20260101)
    assert a == b
    c = syn.build_map(seed=999)
    assert a != c  # different seed -> different positions


def test_map_events_have_position_snapshots():
    data = syn.build_map()
    assert data["map"]["mapName"] == "Ascent"
    for ev in data["events"]:
        assert ev["provenance"]["synthetic"] is True
        if ev["type"] in ("kill",):
            assert ev["positions"], ev["eventId"]
            # each snapshot entry is a well-formed position
            for pos in ev["positions"]:
                assert {"playerId", "x", "y"} <= set(pos)
