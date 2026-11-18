"""PROJECT V data-collector CLI.

Examples:
    pv-data normalize-vct --db datasets/raw/vct-reference/vct.duckdb --match 754737 \
        --out datasets/normalized/vct-reference
    pv-data gen-scenarios --out datasets/synthetic/scenarios
    pv-data gen-map       --out datasets/synthetic/ascent
"""

from __future__ import annotations

import argparse
import sys

from . import priors, profiles, ratings, synthetic_ascent, vct_reference


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pv-data", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("normalize-vct", help="Normalize one real VCT Reference match to JSON.")
    p.add_argument("--db", required=True, help="Path to vct.duckdb")
    p.add_argument("--match", required=True, help="match_id (e.g. 754737)")
    p.add_argument("--out", required=True, help="Output dir (one subdir per match is created)")

    p = sub.add_parser("gen-scenarios", help="Generate the 10 Handoff §20 synthetic scenarios.")
    p.add_argument("--out", required=True)

    p = sub.add_parser("gen-map", help="Generate one synthetic Ascent map (rounds+events+positions).")
    p.add_argument("--out", required=True)
    p.add_argument("--seed", type=int, default=20260101)

    p = sub.add_parser("gen-priors", help="Derive empirical priors/baselines from the VCT Reference DuckDB.")
    p.add_argument("--db", required=True, help="Path to vct.duckdb")
    p.add_argument("--out", required=True, help="Output dir (datasets/derived/priors)")
    p.add_argument("--iters", type=int, default=2000, help="Bootstrap iterations (default 2000)")
    p.add_argument("--era", default="all", choices=["all", "patch>=9"], help="Meta era filter (default all)")

    p = sub.add_parser("gen-ratings", help="Estimate player attributes (with uncertainty) from VCT Reference.")
    p.add_argument("--db", required=True, help="Path to vct.duckdb")
    p.add_argument("--out", required=True, help="Output dir (datasets/derived/ratings)")

    p = sub.add_parser("gen-team-profiles", help="Estimate team economic/side tendencies from VCT Reference.")
    p.add_argument("--db", required=True, help="Path to vct.duckdb")
    p.add_argument("--out", required=True, help="Output dir (datasets/derived/team-profiles)")
    p.add_argument("--as-of", default=None, help="ISO date; use only matches strictly before it (point-in-time)")
    p.add_argument("--era", default="all", choices=["all", "patch>=9"], help="Meta era filter (default all)")

    args = ap.parse_args(argv)

    if args.cmd == "normalize-vct":
        written = vct_reference.write_match(args.db, args.match, args.out)
        for name, path in written.items():
            print(f"wrote {path}")
    elif args.cmd == "gen-scenarios":
        for path in synthetic_ascent.write_scenarios(args.out):
            print(f"wrote {path}")
    elif args.cmd == "gen-map":
        for name, path in synthetic_ascent.write_map(args.out, args.seed).items():
            print(f"wrote {path}")
    elif args.cmd == "gen-priors":
        for name, path in priors.write_all(args.db, args.out, args.iters, args.era).items():
            print(f"wrote {path}")
    elif args.cmd == "gen-ratings":
        for name, path in ratings.write_ratings(args.db, args.out).items():
            print(f"wrote {path}")
    elif args.cmd == "gen-team-profiles":
        for name, path in profiles.write_profiles(args.db, args.out, args.as_of, args.era).items():
            print(f"wrote {path}")
    else:  # pragma: no cover
        ap.error(f"unknown command {args.cmd}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
