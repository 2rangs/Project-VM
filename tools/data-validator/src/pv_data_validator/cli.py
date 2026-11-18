"""PROJECT V dataset validator CLI.

    pv-validate --datasets datasets --schema datasets/schema
"""

from __future__ import annotations

import argparse
import sys

from .validator import validate_tree


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pv-validate", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datasets", default="datasets", help="Root of datasets to validate")
    ap.add_argument("--schema", default="datasets/schema", help="Dir holding *.schema.json")
    ap.add_argument("--quiet", action="store_true", help="Only print failures and the summary")
    args = ap.parse_args(argv)

    results = validate_tree(args.datasets, args.schema)
    passed = sum(r.ok for r in results)
    recs = sum(r.records for r in results)
    for r in results:
        if r.ok and args.quiet:
            continue
        mark = "OK " if r.ok else "FAIL"
        print(f"{mark} {r.path}  [{r.schema_id}, {r.records} rec]")
        for e in r.errors:
            print(f"     - {e}")
    print(f"\n{passed}/{len(results)} files valid; {recs} records checked.")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
