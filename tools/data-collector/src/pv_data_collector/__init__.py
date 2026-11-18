"""PROJECT V data collector.

Two responsibilities, kept strictly separate:

* ``vct_reference`` — normalize a real, verified source (the VCT Reference DuckDB) into
  PROJECT V's schema. Every record is marked ``provenance.synthetic = False``.
* ``synthetic_ascent`` — generate clearly-labelled synthetic Ascent data and the
  Handoff §20 decision-context scenarios. Every record is marked
  ``provenance.synthetic = True`` and written only under ``datasets/synthetic/``.

Real and synthetic data are never mixed in one file or directory.
"""

__version__ = "0.1.0"

# Shared time constants (see datasets/schema/world-state.schema.json).
# Defined before the submodule imports below, which depend on them.
ROUND_COMBAT_MS = 100_000  # combat clock after barriers drop (vctstats ROUND_SECONDS=100)
SPIKE_TIMER_MS = 45_000     # spike countdown once planted (vctstats SPIKE_SECONDS=45)

from . import priors, provenance, stats, synthetic_ascent, vct_reference  # noqa: E402,F401

__all__ = ["provenance", "stats", "priors", "synthetic_ascent", "vct_reference",
           "ROUND_COMBAT_MS", "SPIKE_TIMER_MS"]
