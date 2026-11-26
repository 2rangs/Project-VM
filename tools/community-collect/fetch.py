#!/usr/bin/env python3
"""Rate-limited, cached HTTP fetcher for PROJECT V community data collection (session J).

Design goals (see tools/community-collect/README.md):
- Respect each host: >= MIN_INTERVAL seconds between requests to the same host.
- Generic, honest User-Agent (NOT a browser spoof). Non-commercial research client.
- Cache every raw response under cache/ (gitignored) keyed by a slug + sha1(url),
  with a provenance sidecar (url, status, retrieved_at, sha256 of body).
- Re-runnable: a cached, still-fresh entry is reused instead of re-fetching.
- No bypassing of blocks: a 403/429/5xx is recorded and surfaced, never worked around.

This module is a *library* used by collect scripts and also runnable as a CLI:
    python3 fetch.py <url> [--slug name] [--max-age-hours N] [--force]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

CACHE_DIR = Path(__file__).resolve().parent / "cache"
USER_AGENT = "ProjectV-research/1.0 (non-commercial VCT esports-sim research; contact via github 2rangs/Project-VM)"
MIN_INTERVAL_SEC = 2.5  # per-host politeness delay (task rule: >= 2s between requests)
DEFAULT_MAX_AGE_HOURS = 24 * 14  # treat a cached page <= 14 days old as fresh
TIMEOUT = 30

_last_request_at: dict[str, float] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _slugify(url: str, slug: str | None) -> str:
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    if slug:
        base = "".join(c if c.isalnum() or c in "-_." else "-" for c in slug)[:60]
        return f"{base}.{h}"
    host = _host(url).replace(".", "-")
    return f"{host}.{h}"


def _throttle(host: str) -> None:
    last = _last_request_at.get(host)
    if last is not None:
        wait = MIN_INTERVAL_SEC - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_request_at[host] = time.monotonic()


def fetch(
    url: str,
    slug: str | None = None,
    *,
    headers: dict | None = None,
    max_age_hours: float = DEFAULT_MAX_AGE_HOURS,
    force: bool = False,
) -> dict:
    """Fetch url (or return a fresh cache hit). Returns a provenance dict and
    writes <slug>.body + <slug>.meta.json into cache/. Never raises on HTTP
    errors; the returned dict's `status` and `ok` carry the result."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    name = _slugify(url, slug)
    meta_path = CACHE_DIR / f"{name}.meta.json"
    body_path = CACHE_DIR / f"{name}.body"

    if meta_path.exists() and body_path.exists() and not force:
        meta = json.loads(meta_path.read_text())
        age_h = (time.time() - meta.get("_cached_epoch", 0)) / 3600.0
        if meta.get("ok") and age_h <= max_age_hours:
            meta["from_cache"] = True
            return meta

    host = _host(url)
    _throttle(host)
    hdrs = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)

    retrieved_at = _now_iso()
    try:
        resp = requests.get(url, headers=hdrs, timeout=TIMEOUT, allow_redirects=True)
        body = resp.content
        status = resp.status_code
        final_url = resp.url
        err = None
    except requests.RequestException as exc:  # network/proxy error -> record, don't crash
        body = b""
        status = 0
        final_url = url
        err = str(exc)

    sha = hashlib.sha256(body).hexdigest() if body else None
    ok = status == 200 and bool(body)
    meta = {
        "url": url,
        "final_url": final_url,
        "host": host,
        "status": status,
        "ok": ok,
        "error": err,
        "retrieved_at": retrieved_at,
        "sha256": sha,
        "bytes": len(body),
        "slug": name,
        "body_file": str(body_path.relative_to(CACHE_DIR.parent)),
        "_cached_epoch": time.time(),
        "from_cache": False,
    }
    if body:
        body_path.write_bytes(body)
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta


def body_text(meta: dict) -> str:
    p = CACHE_DIR / Path(meta["body_file"]).name
    return p.read_text(errors="replace") if p.exists() else ""


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Rate-limited cached fetcher (PV session J)")
    ap.add_argument("url")
    ap.add_argument("--slug", default=None)
    ap.add_argument("--max-age-hours", type=float, default=DEFAULT_MAX_AGE_HOURS)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    meta = fetch(args.url, args.slug, max_age_hours=args.max_age_hours, force=args.force)
    print(json.dumps({k: v for k, v in meta.items() if not k.startswith("_")}, indent=2))
    return 0 if meta["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
