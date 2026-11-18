import pytest

from pv_data_collector import stats


def test_wilson_known_value():
    # 8/10 at z=1.96 -> hand-computed Wilson interval.
    lo, hi = stats.wilson_interval(8, 10)
    assert abs(lo - 0.4902) < 1e-3
    assert abs(hi - 0.9433) < 1e-3


def test_wilson_edges():
    assert stats.wilson_interval(0, 0) == (0.0, 1.0)
    lo, hi = stats.wilson_interval(10, 10)
    assert hi == pytest.approx(1.0) and 0 < lo < 1    # upper bound hugs 1, lower is pulled in
    lo, hi = stats.wilson_interval(0, 10)
    assert lo == pytest.approx(0.0) and 0 < hi < 1


def test_wilson_contains_point_and_orders():
    for s, n in [(1, 100), (50, 100), (99, 100), (3, 7)]:
        lo, hi = stats.wilson_interval(s, n)
        assert lo <= s / n <= hi
        assert lo <= hi


def test_cluster_bootstrap_needs_two_clusters():
    assert stats.cluster_bootstrap_rate({"m1": (5, 10)}) == (None, None)


def test_cluster_bootstrap_is_deterministic_and_bracketed():
    groups = {f"m{i}": (i % 3, 3) for i in range(30)}
    a = stats.cluster_bootstrap_rate(groups, iterations=500, seed=7)
    b = stats.cluster_bootstrap_rate(groups, iterations=500, seed=7)
    assert a == b                      # deterministic for a fixed seed
    lo, hi = a
    assert 0.0 <= lo <= hi <= 1.0
