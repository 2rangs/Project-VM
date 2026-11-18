"""Optional cross-check against the official Riot VAL content API.

The content endpoint returns UUID<->name for characters, maps and equips (no
gameplay numerics), so it is used ONLY to cross-validate the catalog's UUIDs and
confirm the live build.

Auth: requests to kr.api.riotgames.com go through the session proxy, which
injects the X-Riot-Token header. This code never sets or reads the key. A Riot
*development* key expires every ~24h and the match endpoints need a production
key, so every call here fails CLEANLY (returns None / skipped=True) on
401/403/404/network error -- the catalog build never depends on it.

Endpoint access matrix observed 2026-11-18 (development key):
  GET /val/status/v1/platform-data        -> 200
  GET /val/content/v1/contents?locale=...  -> 200 (release-13.10)
  GET /val/ranked/v1/leaderboards/by-act/* -> 404 (no entries for that act)
  GET /val/match/*                         -> 403 (needs a PRODUCTION key)
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

CONTENT_URL = "https://kr.api.riotgames.com/val/content/v1/contents?locale=en-US"
USER_AGENT = "project-v-catalog-builder/1.0 (research)"


def fetch_content(url: str = CONTENT_URL, timeout: int = 30) -> dict[str, Any]:
    """Fetch Riot VAL content. Raises on HTTP/network error (caller skips)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 https only
        return json.loads(resp.read().decode("utf-8"))


def try_fetch_content(url: str = CONTENT_URL, timeout: int = 30) -> tuple[Optional[dict[str, Any]], str]:
    """Return (content, reason). On any failure returns (None, human reason) so the
    caller can skip cleanly -- e.g. an expired/absent dev key yields HTTP 401/403."""
    try:
        return fetch_content(url, timeout=timeout), "ok"
    except urllib.error.HTTPError as e:
        return None, f"skipped: HTTP {e.code} (dev key expired/absent or endpoint needs production key)"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return None, f"skipped: {type(e).__name__} {e}"
    except json.JSONDecodeError as e:
        return None, f"skipped: invalid JSON ({e})"


def crosscheck_uuids(content: dict[str, Any], agents: list[dict[str, Any]],
                     weapons: list[dict[str, Any]]) -> dict[str, Any]:
    """Compare catalog agent/weapon UUIDs against Riot content characters/equips.
    Returns match counts and any catalog UUIDs missing from the Riot payload."""
    chars = {c["id"].lower() for c in content.get("characters", []) if c.get("id")}
    equips = {e["id"].lower() for e in content.get("equips", []) if e.get("id")}
    agent_missing = [a["name"] for a in agents if a["id"].lower() not in chars]
    weapon_missing = [w["name"] for w in weapons if w["id"].lower() not in equips]
    return {
        "build": content.get("version"),
        "agents_matched": len(agents) - len(agent_missing),
        "agents_total": len(agents),
        "agents_missing": agent_missing,
        "weapons_matched": len(weapons) - len(weapon_missing),
        "weapons_total": len(weapons),
        "weapons_missing": weapon_missing,
    }
