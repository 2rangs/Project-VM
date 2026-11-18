"""Sourced gameplay numerics for abilities (cost, charges, cooldown, ult points,
duration, type tags, default keybind).

valorant-api does NOT publish these. Each value here MUST come from an official
source (Riot patch notes or the official wiki) recorded in `gameplaySource`.
An unsourced value stays absent, so the builder emits null + gameplayVerified=false.

DO NOT paste remembered or estimated numbers here. A value without a verifiable
`gameplaySource` URL is a fabrication and is forbidden (orchestrator brief;
Handoff §29 "AI 추정값을 사실로 저장하기" / README §37).

Key: "<agent-slug>:<slot>" (e.g. "brimstone:Ultimate").
Shape per entry (include only fields actually sourced):
    {
      "cost": int, "charges": int, "cooldownMs": float, "killRecharge": bool,
      "ultPoints": int, "durationMs": float, "typeTags": [str],
      "defaultKeybind": "C|Q|E|X",
      "gameplayVerified": True,
      "gameplaySource": "https://playvalorant.com/.../patch-notes-X-YZ/",
    }

AUTHORITATIVE SOURCES to fill this table (PV-2 / future work):
  - Official patch notes index: https://playvalorant.com/en-us/news/game-updates/
  - Ability rules: https://wiki.playvalorant.com/en-us/Abilities
  - Per-agent pages on the official wiki (cost/charges/ult points per ability)
  - Economy guide (secondary, confirm against official):
    https://mobalytics.gg/blog/valorant/ultimate-economy-guide/
"""
from __future__ import annotations

from typing import Any

# Empty on purpose: no verified ability numerics have been sourced yet this pass.
# Populate per the header once values are confirmed against an official URL.
ABILITY_FACTS: dict[str, dict[str, Any]] = {}
