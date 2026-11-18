"""Pre-round feature engineering for the round-value model (README §26.3-26.4, §22.3-22.4).

Target: did the ATTACKING team win the round (attacker_won, 0/1).

Every feature is knowable at round START. Per-game running state (scores, loss streaks, previous
result) is accumulated ONLY from earlier rounds: a round's features are emitted BEFORE its result is
folded into the state, so no round outcome, mid-round event, or future-round info can leak
(enforced structurally and checked by tests/test_features.py).

Categoricals (map, buy tiers) are encoded as integer codes so the exact same numeric feature vector
feeds Python training, the ONNX model, and the TypeScript inference path.
"""

from __future__ import annotations

import hashlib
import os

import duckdb
import pandas as pd

# Buy-tier thresholds — identical to tools/data-collector priors.py (team total loadout, credits).
BUY_ECO_MAX = 5000
BUY_FULL_MIN = 20000
PISTOL_ROUNDS = {1, 13}
REGULATION_MAX_ROUND = 24

TIER_CODE = {"pistol": 3, "eco": 0, "semi": 1, "full": 2}

# Fixed feature order. The ONNX model and the TS path MUST use this exact order.
FEATURE_NAMES = [
    "round_num", "is_ot", "half_index",
    "atk_score", "def_score", "score_diff",
    "atk_loadout", "def_loadout", "loadout_diff",
    "atk_bank", "def_bank",
    "atk_streak_losses", "def_streak_losses", "prev_atk_won",
    "map_code", "atk_tier_code", "def_tier_code",
]
# Columns that are metadata / split keys — NEVER model features.
META_COLUMNS = ["match_id", "game_id", "utc_timestamp", "season", "patch",
                "atk_tier", "def_tier", "map_name", "attacker_team"]
TARGET = "attacker_won"

# Forbidden: anything derived from this round's result or later. Guarded by tests.
FORBIDDEN_FEATURE_SUBSTRINGS = ["winner", "outcome", "won_round", "future", "final", "result"]


def classify_buy(loadout, is_pistol):
    if is_pistol:
        return "pistol"
    if loadout is None:
        return "eco"
    if loadout < BUY_ECO_MAX:
        return "eco"
    if loadout < BUY_FULL_MIN:
        return "semi"
    return "full"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _half_index(round_num: int) -> int:
    if round_num > REGULATION_MAX_ROUND:
        return 3
    return 1 if round_num <= 12 else 2


def _load_rounds(con):
    sql = """
        SELECT r.match_id, r.game_id, r.round_num, r.winner_team, r.side,
               r.loadout_t0, r.loadout_t1, r.bank_t0, r.bank_t1,
               mp.map_name, m.utc_timestamp, m.season, m.patch
        FROM rounds r
        JOIN maps mp ON r.game_id = mp.game_id
        JOIN matches m ON r.match_id = m.match_id
        WHERE m.is_international AND r.winner_team IS NOT NULL
          AND r.loadout_t0 IS NOT NULL AND r.loadout_t1 IS NOT NULL
        ORDER BY m.utc_timestamp, r.match_id, r.game_id, r.round_num
    """
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def build_dataset(duckdb_path: str) -> pd.DataFrame:
    """Return a DataFrame of one row per round with pre-round features + target + metadata."""
    if not os.path.exists(duckdb_path):
        raise FileNotFoundError(duckdb_path)
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        rounds = _load_rounds(con)
    finally:
        con.close()

    map_codes: dict[str, int] = {}
    rows = []
    # Per-game running state, accumulated from EARLIER rounds only.
    state: dict[str, dict] = {}

    for r in rounds:
        g = r["game_id"]
        st = state.setdefault(g, {"wins": {0: 0, 1: 0}, "streak": {0: 0, 1: 0}, "last_winner": None})
        atk_team = 0 if r["side"] == "attack" else 1
        def_team = 1 - atk_team
        is_pistol = r["round_num"] in PISTOL_ROUNDS

        atk_loadout = r["loadout_t0"] if atk_team == 0 else r["loadout_t1"]
        def_loadout = r["loadout_t1"] if atk_team == 0 else r["loadout_t0"]
        atk_bank = (r["bank_t0"] if atk_team == 0 else r["bank_t1"]) or 0
        def_bank = (r["bank_t1"] if atk_team == 0 else r["bank_t0"]) or 0
        atk_tier = classify_buy(atk_loadout, is_pistol)
        def_tier = classify_buy(def_loadout, is_pistol)
        map_code = map_codes.setdefault(r["map_name"], len(map_codes))

        prev = st["last_winner"]
        prev_atk_won = -1 if prev is None else (1 if prev == atk_team else 0)

        rows.append({
            # --- features (pre-round only) ---
            "round_num": r["round_num"],
            "is_ot": 1 if r["round_num"] > REGULATION_MAX_ROUND else 0,
            "half_index": _half_index(r["round_num"]),
            "atk_score": st["wins"][atk_team],
            "def_score": st["wins"][def_team],
            "score_diff": st["wins"][atk_team] - st["wins"][def_team],
            "atk_loadout": atk_loadout, "def_loadout": def_loadout,
            "loadout_diff": atk_loadout - def_loadout,
            "atk_bank": atk_bank, "def_bank": def_bank,
            "atk_streak_losses": st["streak"][atk_team],
            "def_streak_losses": st["streak"][def_team],
            "prev_atk_won": prev_atk_won,
            "map_code": map_code,
            "atk_tier_code": TIER_CODE[atk_tier], "def_tier_code": TIER_CODE[def_tier],
            # --- target ---
            "attacker_won": 1 if r["winner_team"] == atk_team else 0,
            # --- metadata (NOT features) ---
            "match_id": r["match_id"], "game_id": g,
            "utc_timestamp": r["utc_timestamp"], "season": r["season"], "patch": r["patch"],
            "atk_tier": atk_tier, "def_tier": def_tier, "map_name": r["map_name"],
            "attacker_team": atk_team,
        })

        # Fold THIS round's result into the state AFTER emitting its features (no leakage).
        w = r["winner_team"]
        st["wins"][w] += 1
        st["streak"][w] = 0
        st["streak"][1 - w] += 1
        st["last_winner"] = w

    df = pd.DataFrame(rows)
    df.attrs["map_codes"] = map_codes
    df.attrs["feature_names"] = list(FEATURE_NAMES)
    return df


def feature_matrix(df: pd.DataFrame):
    """The ordered numeric feature matrix (X) and target (y)."""
    return df[FEATURE_NAMES].to_numpy(dtype="float32"), df[TARGET].to_numpy(dtype="int64")


def assert_no_forbidden_features() -> None:
    """Static guard: no feature name looks like a post-round / future value."""
    for name in FEATURE_NAMES:
        low = name.lower()
        for bad in FORBIDDEN_FEATURE_SUBSTRINGS:
            assert bad not in low, f"feature {name!r} contains forbidden token {bad!r}"
