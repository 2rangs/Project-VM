"""Validate catalog records against the JSON Schemas in datasets/catalog/schema/.

Uses `jsonschema` with a local RefResolver so $ref to provenance.schema.json
resolves without network. Returns (ok, errors)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
from jsonschema import Draft7Validator


def _load_schema(schema_dir: Path, name: str) -> dict[str, Any]:
    return json.loads((schema_dir / name).read_text())


def _validator(schema_dir: Path, schema_name: str) -> Draft7Validator:
    schema = _load_schema(schema_dir, schema_name)
    store = {}
    for p in schema_dir.glob("*.schema.json"):
        s = json.loads(p.read_text())
        if "$id" in s:
            store[s["$id"]] = s
        store[p.name] = s  # allow relative "provenance.schema.json" refs
    resolver = jsonschema.RefResolver(base_uri=f"{schema_dir.as_uri()}/", referrer=schema, store=store)
    return Draft7Validator(schema, resolver=resolver)


def validate_records(records: list[dict[str, Any]], schema_dir: Path, schema_name: str) -> tuple[bool, list[str]]:
    v = _validator(schema_dir, schema_name)
    errors: list[str] = []
    for i, rec in enumerate(records):
        for err in v.iter_errors(rec):
            loc = "/".join(str(x) for x in err.path)
            errors.append(f"[{schema_name} #{i} {loc}] {err.message}")
    return (len(errors) == 0, errors)
