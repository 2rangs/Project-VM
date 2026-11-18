"""Real-source normalizer tests. These run only when the VCT Reference DuckDB is present
(datasets/raw/vct-reference/vct.duckdb). They are skipped otherwise, so the suite stays
runnable offline without redistributing the 13 MB source file."""

import pytest

from conftest import REPO_ROOT
from pv_data_collector import vct_reference as vr

DB = REPO_ROOT / "datasets" / "raw" / "vct-reference" / "vct.duckdb"
pytestmark = pytest.mark.skipif(not DB.exists(), reason="vct.duckdb not present (download it first)")


def test_normalize_known_match_shape():
    data = vr.normalize_match(str(DB), "754737")
    assert set(data) == {"match", "teams", "players", "maps", "rounds"}
    m = data["match"]
    assert m["matchId"] == "754737"
    assert m["provenance"]["synthetic"] is False
    assert len(m["teamIds"]) == 2
    assert len(data["teams"]) == 2
    assert data["maps"], "match should have maps"
    # Every normalized record is real.
    for coll in ("teams", "players", "maps", "rounds"):
        for rec in data[coll]:
            assert rec["provenance"]["synthetic"] is False


def test_missing_economy_is_not_imputed():
    """Rounds without recorded economy must have startEconomy=None, never zero-filled."""
    data = vr.normalize_match(str(DB), "754737")  # this match has no round economy
    assert all(r["startEconomy"] is None for r in data["rounds"])


def test_economy_present_when_recorded():
    data = vr.normalize_match(str(DB), "754730")  # has economy on its maps
    econ_rounds = [r for r in data["rounds"] if r["startEconomy"] is not None]
    assert econ_rounds, "expected some rounds with recorded economy"
    r = econ_rounds[0]
    assert len(r["startEconomy"]["bank"]) == 2


def test_unknown_match_raises():
    with pytest.raises(ValueError):
        vr.normalize_match(str(DB), "does-not-exist")
