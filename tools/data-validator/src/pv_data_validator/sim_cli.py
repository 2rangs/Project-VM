"""Simulation validation harness CLI.

Once a real 5v5 simulation exists, dump its per-round EventLogs to one JSON bundle and run:

    pv-validate-sim --logs sim_run.json --priors datasets/derived/priors \
        --scope ascent --out reports/sim_validation

That writes reports/sim_validation.json and .md. Exit code is non-zero if any judged metric fails.
"""

from __future__ import annotations

import argparse
import json
import sys

from .sim_harness import evaluate_sim_run, report_markdown, write_reports


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pv-validate-sim", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logs", required=True, help="JSON bundle of simulated round logs")
    ap.add_argument("--priors", default="datasets/derived/priors", help="Dir of PV-2 prior JSON files")
    ap.add_argument("--scope", default="ascent", choices=["ascent", "all_maps"])
    ap.add_argument("--era", default="all", choices=["all", "patch>=9"],
                    help="Baseline era: 'all' (default, more samples) or 'patch>=9' (current meta)")
    ap.add_argument("--compare", help="A prior report JSON to diff against (adds Δ vs baseline columns)")
    ap.add_argument("--out", help="Output path prefix (writes <out>.json and <out>.md)")
    args = ap.parse_args(argv)

    sim_run = json.load(open(args.logs, encoding="utf-8"))
    report = evaluate_sim_run(sim_run, args.priors, scope=args.scope, era=args.era,
                              compare_path=args.compare)
    if args.out:
        paths = write_reports(report, args.out)
        for k, p in paths.items():
            print(f"wrote {p}")
    else:
        print(report_markdown(report))
    s = report["summary"]
    print(f"\n{s['passed']}/{s['judged']} judged metrics passed; {s['reportedOnly']} reported-only.")
    return 0 if s["allPassed"] else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
