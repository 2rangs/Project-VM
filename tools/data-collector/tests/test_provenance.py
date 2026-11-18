from pv_data_collector import provenance as prov


def test_real_is_not_synthetic():
    p = prov.real(game_patch="Patch 13.05", sha256="a" * 64)
    assert p["synthetic"] is False
    assert p["verified"] is True
    assert p["sourceId"] == "vct-reference"
    assert p["gamePatch"] == "Patch 13.05"
    assert p["sha256"] == "a" * 64


def test_synthetic_is_synthetic_and_warns():
    p = prov.synthetic()
    assert p["synthetic"] is True
    assert p["verified"] is False
    assert p["sourceUrl"] is None
    assert any("SYNTHETIC" in n for n in p["notes"])
