"""PROJECT V dataset validator.

Validates every normalized/synthetic JSON file against the machine schemas in
``datasets/schema/`` and enforces the project's hard rule: files under
``datasets/synthetic/`` must be marked synthetic, files under ``datasets/normalized/``
must not be.

The dataset validator needs ``jsonschema``; the simulation harness (``sim_harness`` / ``sim_cli``)
is standard-library only. The validator names are therefore imported lazily, so ``sim:validate``
runs on any Python >= 3.11 even where ``jsonschema`` is not installed.
"""

from . import sim_harness  # noqa: F401

_VALIDATOR_EXPORTS = ("FILE_SCHEMA_MAP", "ValidationResult", "load_registry", "validate_file", "validate_tree")

__all__ = [*_VALIDATOR_EXPORTS, "sim_harness"]
__version__ = "0.1.0"


def __getattr__(name: str):
    if name in _VALIDATOR_EXPORTS:
        from . import validator  # needs jsonschema

        return getattr(validator, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
