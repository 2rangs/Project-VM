"""Fetch raw valorant-api payloads (stdlib only) and cache them for provenance.

Network is isolated here so normalize.py stays pure/testable. Raw payloads are
written under datasets/catalog/<patch>/raw/ (gitignored: valorant-api license is
unclear, so Riot-derived data is regenerated locally, not committed).
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Any

USER_AGENT = "project-v-catalog-builder/1.0 (research; contact via repo)"
BASE = "https://valorant-api.com/v1"

ENDPOINTS = {
    "version": f"{BASE}/version",
    "weapons": f"{BASE}/weapons",
    "agents": f"{BASE}/agents?isPlayableCharacter=true",
}


def fetch_json(url: str, timeout: int = 30) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
        return json.loads(resp.read().decode("utf-8"))


def fetch_all(raw_dir: Path, timeout: int = 30) -> dict[str, dict[str, Any]]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    out: dict[str, dict[str, Any]] = {}
    for name, url in ENDPOINTS.items():
        data = fetch_json(url, timeout=timeout)
        (raw_dir / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
        out[name] = data
    return out


def load_cached(raw_dir: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for name in ENDPOINTS:
        p = raw_dir / f"{name}.json"
        if p.exists():
            out[name] = json.loads(p.read_text())
    return out
