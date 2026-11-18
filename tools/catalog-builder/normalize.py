"""Pure normalization of valorant-api payloads into PROJECT V catalog records.

No network, no file IO -- every function takes parsed dicts and returns records,
so it is unit-testable in isolation. Conventions: camelCase keys, time in ms,
distance in m. VALORANT uses Unreal units where 1 m = 100 units; valorant-api
damage ranges are already metres, while vrfkit replay positions are cm.

valorant-api provides weapon stats and agent/ability names only. It does NOT
provide ability gameplay numerics (cost, charges, cooldown, ult points,
duration, type tags) nor shield/spike constants. Those are left null and marked
unverified by the fact tables in ability_facts.py / equipment_facts.py; this
module never invents them.
"""
from __future__ import annotations

import re
from typing import Any, Optional

PATCH_DEFAULT = "release-13.10"

_WALL_PEN_RE = re.compile(r"::([A-Za-z]+)$")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _sec_to_ms(seconds: Optional[float]) -> Optional[float]:
    if seconds is None:
        return None
    return round(float(seconds) * 1000, 3)


def normalize_wall_penetration(raw: Optional[str]) -> Optional[str]:
    """'EWallPenetrationDisplayType::Medium' -> 'Medium'."""
    if not raw:
        return None
    m = _WALL_PEN_RE.search(raw)
    return m.group(1) if m else raw


def _clean_enum(raw: Optional[str]) -> Optional[str]:
    """Strip 'EnumName::' prefixes; pass through plain strings; None stays None."""
    if raw is None:
        return None
    if "::" in raw:
        return raw.split("::")[-1]
    return raw


def normalize_damage_range(dr: dict[str, Any]) -> dict[str, Any]:
    return {
        "rangeStartMeters": dr.get("rangeStartMeters"),
        "rangeEndMeters": dr.get("rangeEndMeters"),
        "headDamage": dr.get("headDamage"),
        "bodyDamage": dr.get("bodyDamage"),
        "legDamage": dr.get("legDamage"),
    }


def normalize_weapon(w: dict[str, Any], *, patch: str, retrieved_at: Optional[str]) -> dict[str, Any]:
    shop = w.get("shopData") or {}
    ws = w.get("weaponStats") or None
    stats = None
    if ws is not None:
        stats = {
            "fireRate": ws.get("fireRate"),
            "magazineSize": ws.get("magazineSize"),
            "reloadTimeMs": _sec_to_ms(ws.get("reloadTimeSeconds")),
            "equipTimeMs": _sec_to_ms(ws.get("equipTimeSeconds")),
            "runSpeedMultiplier": ws.get("runSpeedMultiplier"),
            "firstBulletAccuracy": ws.get("firstBulletAccuracy"),
            "shotgunPelletCount": ws.get("shotgunPelletCount") or None,
            "wallPenetration": normalize_wall_penetration(ws.get("wallPenetration")),
            "fireMode": _clean_enum(ws.get("fireMode")),
            "altFireType": _clean_enum(ws.get("altFireType")),
            "damageRanges": [normalize_damage_range(d) for d in (ws.get("damageRanges") or [])],
            "ads": ws.get("adsStats"),
            "altShotgunStats": ws.get("altShotgunStats"),
            "airBurstStats": ws.get("airBurstStats"),
        }
    return {
        "id": w.get("uuid"),
        "name": w.get("displayName"),
        "category": shop.get("category") or _clean_enum(w.get("category")),
        "categoryText": shop.get("categoryText"),
        "cost": shop.get("cost"),
        "weaponStats": stats,
        "provenance": {
            "source": "https://valorant-api.com/v1/weapons",
            "patch": patch,
            "retrievedAt": retrieved_at,
            "evidenceType": "api",
            "verified": True,
        },
    }


def normalize_agent(a: dict[str, Any], *, patch: str, retrieved_at: Optional[str]) -> dict[str, Any]:
    role = (a.get("role") or {}).get("displayName")
    slots = []
    for ab in a.get("abilities") or []:
        slots.append({
            "slot": ab.get("slot"),
            "name": ab.get("displayName"),
            "abilityId": f"{_slug(a.get('displayName', ''))}:{ab.get('slot')}",
        })
    return {
        "id": a.get("uuid"),
        "name": a.get("displayName"),
        "role": role,
        "abilitySlots": slots,
        "provenance": {
            "source": "https://valorant-api.com/v1/agents",
            "patch": patch,
            "retrievedAt": retrieved_at,
            "evidenceType": "api",
            "verified": True,
        },
    }


def normalize_abilities(a: dict[str, Any], *, patch: str, retrieved_at: Optional[str],
                        facts: Optional[dict[str, dict[str, Any]]] = None) -> list[dict[str, Any]]:
    """One record per ability. API supplies name/slot/description (verified).
    Gameplay numerics come only from `facts` (a sourced table); absent -> null + unverified."""
    facts = facts or {}
    agent_name = a.get("displayName", "")
    agent_slug = _slug(agent_name)
    out = []
    for ab in a.get("abilities") or []:
        slot = ab.get("slot")
        ability_id = f"{agent_slug}:{slot}"
        fact = facts.get(ability_id, {})
        gameplay = {
            "cost": fact.get("cost"),
            "charges": fact.get("charges"),
            "cooldownMs": fact.get("cooldownMs"),
            "killRecharge": fact.get("killRecharge"),
            "ultPoints": fact.get("ultPoints"),
            "durationMs": fact.get("durationMs"),
            "typeTags": fact.get("typeTags", []),
            "gameplayVerified": bool(fact.get("gameplayVerified", False)),
            "gameplaySource": fact.get("gameplaySource"),
        }
        out.append({
            "abilityId": ability_id,
            "agentId": a.get("uuid"),
            "agentName": agent_name,
            "slot": slot,
            "name": ab.get("displayName"),
            "description": ab.get("description"),
            "defaultKeybind": fact.get("defaultKeybind"),
            "gameplay": gameplay,
            "provenance": {
                "source": "https://valorant-api.com/v1/agents",
                "patch": patch,
                "retrievedAt": retrieved_at,
                "evidenceType": "api",
                "verified": True,
            },
        })
    return out
