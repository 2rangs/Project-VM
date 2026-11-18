"""Equipment catalog: shields and spike constants.

These numerics are NOT in valorant-api. Each must be sourced from an official
URL before `verified` becomes true; until then values are null + verified=false.
DO NOT paste remembered/estimated numbers without a verifiable `source`.

Round/economy reward numerics (kill reward, loss bonus, plant bonus, etc.) are
owned by PV-3 in packages/game-rules. Items here that overlap carry
needsCrossCheckPV3=true and are not authored as fact in this catalog.

AUTHORITATIVE SOURCES to fill these (future work):
  - https://wiki.playvalorant.com/en-us/Credits  (shield cost/armor)
  - https://playvalorant.com/en-us/news/game-updates/  (patch-versioned changes)
  - Spike timing: official wiki / patch notes.
"""
from __future__ import annotations

from typing import Any

PATCH_DEFAULT = "release-13.10"

# Structural entries with null numerics + verified=false. Fill `cost/armor/...`
# and set verified=true ONLY alongside a real `source` URL.
EQUIPMENT: list[dict[str, Any]] = [
    {
        "id": "shield-light", "name": "Light Shield", "type": "shield",
        "cost": None, "armor": None, "regen": False,
        "verified": False, "source": None, "needsCrossCheckPV3": True,
        "note": "Source cost/armor from official wiki Credits page.",
    },
    {
        "id": "shield-heavy", "name": "Heavy Shield", "type": "shield",
        "cost": None, "armor": None, "regen": False,
        "verified": False, "source": None, "needsCrossCheckPV3": True,
        "note": "Source cost/armor from official wiki Credits page.",
    },
    {
        "id": "shield-regen", "name": "Regen Shield", "type": "shield",
        "cost": None, "armor": None, "regen": True,
        "verified": False, "source": None, "needsCrossCheckPV3": True,
        "note": "Regenerating shield; source cost/armor/regen rules from official source.",
    },
    {
        "id": "spike", "name": "Spike", "type": "objective",
        "plantTimeMs": None, "defuseTimeMs": None, "defuseHalfMs": None, "detonateTimeMs": None,
        "verified": False, "source": None, "needsCrossCheckPV3": True,
        "note": "Plant/defuse/detonate timing; reconcile with PV-3 packages/game-rules.",
    },
]
