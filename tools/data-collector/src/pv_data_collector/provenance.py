"""Provenance helpers (datasets/schema/provenance.schema.json).

The one invariant every caller relies on: ``real(...)`` always sets ``synthetic=False``
and ``synthetic(...)`` always sets ``synthetic=True``. Nothing else may set that flag.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

# Verified source descriptors (see docs/handoffs/PV-2-data.md for the verification evidence).
VCT_REFERENCE = {
    "sourceId": "vct-reference",
    "sourceUrl": "https://vct-reference.com/dataset/vct.duckdb",
}
SYNTHETIC_ASCENT = {
    "sourceId": "pv-synthetic-ascent",
    "sourceUrl": None,
}


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def real(
    *,
    evidence_type: str = "observed",
    game_patch: str | None = None,
    source_version: str | None = None,
    sha256: str | None = None,
    verification_level: int = 2,
    confidence: float | None = None,
    notes: list[str] | None = None,
) -> dict[str, Any]:
    """Provenance for a record derived from the real VCT Reference dataset."""
    return {
        "sourceId": VCT_REFERENCE["sourceId"],
        "sourceUrl": VCT_REFERENCE["sourceUrl"],
        "sourceVersion": source_version,
        "gamePatch": game_patch,
        "retrievedAt": _now(),
        "evidenceType": evidence_type,
        "confidence": confidence,
        "verified": True,
        "verificationLevel": verification_level,
        "synthetic": False,
        "sha256": sha256,
        "notes": notes or [],
    }


def synthetic(
    *,
    evidence_type: str = "simulated",
    game_patch: str | None = None,
    confidence: float | None = None,
    notes: list[str] | None = None,
) -> dict[str, Any]:
    """Provenance for generated (non-real) data. Always synthetic=True."""
    base_notes = ["SYNTHETIC — not a real VCT match; do not present as real pro data."]
    return {
        "sourceId": SYNTHETIC_ASCENT["sourceId"],
        "sourceUrl": None,
        "sourceVersion": "0.1.0",
        "gamePatch": game_patch,
        "retrievedAt": _now(),
        "evidenceType": evidence_type,
        "confidence": confidence,
        "verified": False,
        "verificationLevel": 0,
        "synthetic": True,
        "sha256": None,
        "notes": base_notes + (notes or []),
    }
