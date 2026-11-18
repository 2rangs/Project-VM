"""Schema + separation validation for PROJECT V datasets."""

from __future__ import annotations

import glob
import json
import os
from dataclasses import dataclass, field

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

# basename (or prefix) -> (schema $id, "object" | "array")
FILE_SCHEMA_MAP: dict[str, tuple[str, str]] = {
    "match.json": ("match.schema.json", "object"),
    "teams.json": ("team.schema.json", "array"),
    "players.json": ("player.schema.json", "array"),
    "maps.json": ("map.schema.json", "array"),
    "rounds.json": ("round.schema.json", "array"),
    "events.json": ("event.schema.json", "array"),
    "player_ratings.json": ("player-rating.schema.json", "array"),
    "team_profiles.json": ("team-profile.schema.json", "array"),
}
# prefix match (scenario_01.json, ...) -> single DecisionContext
PREFIX_SCHEMA_MAP: dict[str, tuple[str, str]] = {
    "scenario_": ("world-state.schema.json", "object"),
}


@dataclass
class ValidationResult:
    path: str
    schema_id: str | None
    ok: bool
    records: int = 0
    errors: list[str] = field(default_factory=list)


def load_registry(schema_dir: str) -> Registry:
    resources = []
    for f in sorted(glob.glob(os.path.join(schema_dir, "*.schema.json"))):
        d = json.load(open(f, encoding="utf-8"))
        resources.append((d["$id"], Resource.from_contents(d)))
    return Registry().with_resources(resources)


def _schema_for(path: str) -> tuple[str, str] | None:
    norm = path.replace("\\", "/")
    name = os.path.basename(path)
    # Derived priors: any JSON under datasets/derived/priors/ is a prior document.
    if "/datasets/derived/priors/" in norm or norm.startswith("datasets/derived/priors/"):
        if name == "README.json":
            return None
        return ("prior.schema.json", "object")
    # Defensive setup packs under datasets/synthetic/setups/.
    if "/datasets/synthetic/setups/" in norm or norm.startswith("datasets/synthetic/setups/"):
        if name == "README.json":
            return None
        return ("defense-setup.schema.json", "object")
    if name in FILE_SCHEMA_MAP:
        return FILE_SCHEMA_MAP[name]
    for prefix, spec in PREFIX_SCHEMA_MAP.items():
        if name.startswith(prefix):
            return spec
    return None


def _records(payload, kind: str) -> list:
    return list(payload) if kind == "array" else [payload]


def _expected_synthetic(path: str) -> bool | None:
    norm = path.replace("\\", "/")
    if "/datasets/synthetic/" in norm or norm.startswith("datasets/synthetic/"):
        return True
    if "/datasets/normalized/" in norm or norm.startswith("datasets/normalized/"):
        return False
    if "/datasets/derived/" in norm or norm.startswith("datasets/derived/"):
        return False  # derived priors are real aggregates
    return None


def _provenances(rec):
    """Yield every provenance dict found in a record (top-level, and nested worldState scenarios)."""
    if isinstance(rec, dict):
        if isinstance(rec.get("provenance"), dict):
            yield rec["provenance"]


# --- zone / coordinate checks (synthetic Ascent, game-world frame) ---------------------------
_ZONE_TOLERANCE_UU = 800.0  # 2D distance a position may sit from its zone representative point


def _find_zone_ref(path: str) -> dict | None:
    """Walk up from `path` to find datasets/synthetic/ascent/ascent_zones_ref.json."""
    d = os.path.dirname(os.path.abspath(path))
    for _ in range(8):
        cand = os.path.join(d, "datasets", "synthetic", "ascent", "ascent_zones_ref.json")
        if os.path.exists(cand):
            return json.load(open(cand, encoding="utf-8"))
        nd = os.path.dirname(d)
        if nd == d:
            break
        d = nd
    return None


def _zone_points(zone_ref: dict) -> dict[str, tuple[float, float]]:
    return {z["id"]: (z["position"]["x"], z["position"]["y"]) for z in zone_ref.get("zones", [])}


def _zone_errors(obj, zones: dict, trail: str = "") -> list[str]:
    """Recursively check every {zoneId|lastKnownZoneId + coords} object against the navgraph."""
    errs: list[str] = []
    if isinstance(obj, dict):
        for zkey, poskey in (("zoneId", "position"), ("lastKnownZoneId", "lastKnownPos")):
            zid = obj.get(zkey)
            if isinstance(zid, str):
                if zid not in zones:
                    errs.append(f"{trail}.{zkey}={zid!r} not in navgraph zones")
                else:
                    pos = obj.get(poskey)
                    # position may be a sibling object, or this same object carries x/y (snapshot)
                    if not isinstance(pos, dict):
                        pos = obj if ("x" in obj and "y" in obj) else None
                    if isinstance(pos, dict) and "x" in pos and "y" in pos:
                        zx, zy = zones[zid]
                        dist = ((pos["x"] - zx) ** 2 + (pos["y"] - zy) ** 2) ** 0.5
                        if dist > _ZONE_TOLERANCE_UU:
                            errs.append(f"{trail}.{poskey} is {dist:.0f}uu from zone {zid} "
                                        f"(> {_ZONE_TOLERANCE_UU:.0f}uu)")
        for k, v in obj.items():
            errs += _zone_errors(v, zones, f"{trail}/{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            errs += _zone_errors(v, zones, f"{trail}[{i}]")
    return errs


def validate_file(path: str, registry: Registry) -> ValidationResult:
    spec = _schema_for(path)
    if spec is None:
        return ValidationResult(path, None, True, 0, [])
    schema_id, kind = spec
    schema = registry.get_or_retrieve(schema_id).value.contents
    validator = Draft202012Validator(schema, registry=registry)

    try:
        payload = json.load(open(path, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return ValidationResult(path, schema_id, False, 0, [f"could not read JSON: {e}"])

    records = _records(payload, kind)
    errors: list[str] = []
    for i, rec in enumerate(records):
        for err in validator.iter_errors(rec):
            loc = "/".join(str(p) for p in err.absolute_path)
            errors.append(f"[rec {i}] {loc or '<root>'}: {err.message}")

    # Separation rule: synthetic flag must match the directory tree.
    want = _expected_synthetic(path)
    if want is not None:
        for i, rec in enumerate(records):
            for pv in _provenances(rec):
                got = pv.get("synthetic")
                if got is not want:
                    errors.append(
                        f"[rec {i}] provenance.synthetic={got!r} but path implies {want!r} "
                        f"(real/synthetic separation violated)")

    # Zone / coordinate checks for synthetic Ascent data (game-world frame, v2).
    norm = path.replace("\\", "/")
    if "/datasets/synthetic/" in norm or norm.startswith("datasets/synthetic/"):
        zone_ref = _find_zone_ref(path)
        if zone_ref:
            zones = _zone_points(zone_ref)
            for i, rec in enumerate(records):
                for e in _zone_errors(rec, zones, f"[rec {i}]"):
                    errors.append(e)

    return ValidationResult(path, schema_id, not errors, len(records), errors)


def validate_tree(datasets_dir: str, schema_dir: str) -> list[ValidationResult]:
    registry = load_registry(schema_dir)
    results = []
    for path in sorted(glob.glob(os.path.join(datasets_dir, "**", "*.json"), recursive=True)):
        if _schema_for(path) is None:
            continue
        results.append(validate_file(path, registry))
    return results
