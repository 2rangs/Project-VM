#!/usr/bin/env python3
"""Build the PROJECT V game-data catalog from valorant-api.

Outputs (under datasets/catalog/<patch>/, gitignored -- Riot-derived data):
  raw/{version,weapons,agents}.json   provenance copies of API responses
  weapons.json  agents.json  abilities.json  equipment.json

Only this builder + the JSON Schemas + docs are committed; the generated data is
regenerated locally because valorant-api's licence is unclear.

Usage:
  python build_catalog.py                 # fetch live, build, validate
  python build_catalog.py --offline       # use cached raw/ (no network)
  python build_catalog.py --patch release-13.10
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent  # tools/catalog-builder -> repo root
sys.path.insert(0, str(HERE))

import fetch  # noqa: E402
import normalize  # noqa: E402
import validate as validate_mod  # noqa: E402
from ability_facts import ABILITY_FACTS  # noqa: E402
from equipment_facts import EQUIPMENT  # noqa: E402

SCHEMA_DIR = REPO / "datasets" / "catalog" / "schema"


def _write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def build(patch: str, offline: bool) -> int:
    out_dir = REPO / "datasets" / "catalog" / patch
    raw_dir = out_dir / "raw"

    raw = fetch.load_cached(raw_dir) if offline else fetch.fetch_all(raw_dir)
    missing = [k for k in ("weapons", "agents") if k not in raw]
    if missing:
        print(f"ERROR: missing raw payloads {missing} (run without --offline first)", file=sys.stderr)
        return 2

    retrieved_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # confirm the live/cached build matches the requested patch (warn only)
    api_build = (raw.get("version", {}).get("data") or {}).get("branch")
    if api_build and api_build != patch:
        print(f"WARNING: valorant-api build is {api_build}, requested patch {patch}", file=sys.stderr)

    weapons = [normalize.normalize_weapon(w, patch=patch, retrieved_at=retrieved_at)
               for w in raw["weapons"]["data"]]
    agents = [normalize.normalize_agent(a, patch=patch, retrieved_at=retrieved_at)
              for a in raw["agents"]["data"]]
    abilities = []
    for a in raw["agents"]["data"]:
        abilities.extend(normalize.normalize_abilities(
            a, patch=patch, retrieved_at=retrieved_at, facts=ABILITY_FACTS))
    equipment = [dict(e) for e in EQUIPMENT]

    _write(out_dir / "weapons.json", weapons)
    _write(out_dir / "agents.json", agents)
    _write(out_dir / "abilities.json", abilities)
    _write(out_dir / "equipment.json", equipment)

    # validate against schema
    ok_all = True
    for recs, schema in [(weapons, "weapon.schema.json"), (agents, "agent.schema.json"),
                         (abilities, "ability.schema.json"), (equipment, "equipment.schema.json")]:
        ok, errs = validate_mod.validate_records(recs, SCHEMA_DIR, schema)
        ok_all = ok_all and ok
        status = "OK" if ok else f"FAIL ({len(errs)} errors)"
        print(f"  {schema:28} {len(recs):3} records  {status}")
        for e in errs[:10]:
            print("    " + e, file=sys.stderr)

    # coverage report
    ab_verified = sum(1 for a in abilities if a["gameplay"]["gameplayVerified"])
    eq_verified = sum(1 for e in equipment if e["verified"])
    print(f"\nSummary (patch {patch}):")
    print(f"  weapons={len(weapons)} agents={len(agents)} abilities={len(abilities)} equipment={len(equipment)}")
    print(f"  ability gameplay verified: {ab_verified}/{len(abilities)} (rest null+unverified by design)")
    print(f"  equipment verified: {eq_verified}/{len(equipment)}")
    print(f"  output: {out_dir}  (gitignored)")
    return 0 if ok_all else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--patch", default=normalize.PATCH_DEFAULT)
    ap.add_argument("--offline", action="store_true", help="use cached raw/ instead of fetching")
    args = ap.parse_args()
    return build(args.patch, args.offline)


if __name__ == "__main__":
    raise SystemExit(main())
