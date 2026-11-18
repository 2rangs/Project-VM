"""Sourced gameplay numerics for abilities (cost, charges, ult points, type tags).

Values are loaded from data/ability_facts.json, generated from the OFFICIAL
VALORANT wiki Abilities tables (basic / signature / ultimate) at
https://wiki.playvalorant.com/en-us/Abilities, fetched 2026-11-18. The live game
build is release-13.10 (confirmed via valorant-api /v1/version), so the wiki's
current tables are the current-patch values; each record carries its
gameplaySource URL and a gameplayNote stating this.

NOT covered by those tables and therefore still null:
  - durationMs, cooldownMs  (not published in the aggregate tables)
  - defaultKeybind (C/Q/E/X) (agent/UI dependent)
Fill those only from an official source with a URL; never hardcode an estimate
(Handoff §29 "AI 추정값을 사실로 저장" / README §37).

Key: "<agent-slug>:<slot>" (e.g. "brimstone:Ultimate"). The slug matches
normalize._slug(agent displayName); slot is the valorant-api slot. Wiki abilities
are joined to valorant-api slots by ability NAME, so cost attaches to the right
ability regardless of which basic/signature slot it occupies.

AUTHORITATIVE SOURCES used / to extend:
  - Abilities (cost/charges/points/functions): https://wiki.playvalorant.com/en-us/Abilities
  - Per-ability durations/cooldowns: individual official ability pages / patch notes
  - Patch index: https://playvalorant.com/en-us/news/game-updates/
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DATA = Path(__file__).resolve().parent / "data" / "ability_facts.json"

try:
    ABILITY_FACTS: dict[str, dict[str, Any]] = json.loads(_DATA.read_text(encoding="utf-8"))
except FileNotFoundError:  # pragma: no cover - data file is committed
    ABILITY_FACTS = {}
