"""Equipment catalog: shields and spike constants.

Values sourced from OFFICIAL VALORANT wiki pages, fetched 2026-11-18 (live build
release-13.10 confirmed via valorant-api /v1/version):
  - Armor & Shield: https://wiki.playvalorant.com/en-us/Armor_and_Shield
      Light Armor  400cr, 66% absorption, 25 armor
      Heavy Armor 1000cr, 66% absorption, 50 armor
      Regen Shield 650cr, 100% absorption, 25 armor, 50 regen pool (added v9.10;
      Light/Heavy were formerly "Light/Heavy Shields")
  - Spike: https://wiki.playvalorant.com/en-us/Spike
      plant 4s, defuse 7s, half-defuse checkpoint 3.5s

Round/economy reward numerics (kill reward, loss bonus, plant bonus, etc.) are
owned by PV-3 in packages/game-rules; items here carry needsCrossCheckPV3=true.
Cross-check result (origin/claude/pv-core packages/game-rules, read 2026-11-18):
shield costs/armor MATCH PV-3 economy.ts (light 400/25, heavy 1000/50,
regen 650/25); spike plant/defuse/half MATCH PV-3 spike.ts. See docs/research/
CATALOG.md "PV-3 대조".

Still null (not confirmed this fetch): spike detonateTimeMs (community/PV-3 use
45000 ms) -- source from the official Spike page's Countdown section before use.
"""
from __future__ import annotations

from typing import Any

PATCH_DEFAULT = "release-13.10"
WIKI_ARMOR = "https://wiki.playvalorant.com/en-us/Armor_and_Shield"
WIKI_SPIKE = "https://wiki.playvalorant.com/en-us/Spike"

EQUIPMENT: list[dict[str, Any]] = [
    {
        "id": "shield-light", "name": "Light Armor", "type": "shield",
        "cost": 400, "armor": 25, "regen": False, "regenPool": None, "absorptionPercent": 66,
        "verified": True, "source": WIKI_ARMOR, "needsCrossCheckPV3": True,
        "note": "Official wiki Armor & Shield (current, build 13.10). Matches PV-3 economy.ts. Formerly 'Light Shield'.",
    },
    {
        "id": "shield-heavy", "name": "Heavy Armor", "type": "shield",
        "cost": 1000, "armor": 50, "regen": False, "regenPool": None, "absorptionPercent": 66,
        "verified": True, "source": WIKI_ARMOR, "needsCrossCheckPV3": True,
        "note": "Official wiki Armor & Shield (current, build 13.10). Matches PV-3 economy.ts. Formerly 'Heavy Shield'.",
    },
    {
        "id": "shield-regen", "name": "Regen Shield", "type": "shield",
        "cost": 650, "armor": 25, "regen": True, "regenPool": 50, "absorptionPercent": 100,
        "verified": True, "source": WIKI_ARMOR, "needsCrossCheckPV3": True,
        "note": "Official wiki Armor & Shield (current, build 13.10). Added patch v9.10. Matches PV-3 economy.ts (650/25).",
    },
    {
        "id": "spike", "name": "Spike", "type": "objective",
        "plantTimeMs": 4000, "defuseTimeMs": 7000, "defuseHalfMs": 3500, "detonateTimeMs": None,
        "verified": True, "source": WIKI_SPIKE, "needsCrossCheckPV3": True,
        "note": "Official wiki Spike (current): plant 4s, defuse 7s, half-defuse checkpoint 3.5s. Matches PV-3 spike.ts. detonateTimeMs left null (not captured this fetch; PV-3 uses 45000 ms).",
    },
]
