"""Ability effect spec loader (README §11.2, Handoff §10).

Per-ability effect parameters for the Ability Engine / perception / action
generation, sourced from official wiki per-ability pages (Stat/Value table +
infobox), patch-versioned. Committed as data/ability_effects.json. Unsourced
values are null; no estimates (Handoff §29 / README §37).

Current scope: the ~10 Ascent-meta agents (Omen, Sova, KAY/O, Killjoy, Jett,
Cypher, Astra, Gekko, Breach, Viper). Extend by fetching more official ability
pages into the same shape.

Units: time ms, distance m. PV-4 perception-engine / spatial-engine use world
units (×100). See docs/research/CATALOG.md "소비자 정합 / 필드 매핑".
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DATA = Path(__file__).resolve().parent / "data" / "ability_effects.json"


def load_effects() -> list[dict[str, Any]]:
    try:
        return json.loads(_DATA.read_text(encoding="utf-8"))
    except FileNotFoundError:  # pragma: no cover - data file is committed
        return []
