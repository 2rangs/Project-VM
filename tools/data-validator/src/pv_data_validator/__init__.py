"""PROJECT V dataset validator.

Validates every normalized/synthetic JSON file against the machine schemas in
``datasets/schema/`` and enforces the project's hard rule: files under
``datasets/synthetic/`` must be marked synthetic, files under ``datasets/normalized/``
must not be.
"""

from . import sim_harness  # noqa: F401
from .validator import (  # noqa: F401
    FILE_SCHEMA_MAP,
    ValidationResult,
    load_registry,
    validate_file,
    validate_tree,
)

__all__ = ["FILE_SCHEMA_MAP", "ValidationResult", "load_registry", "validate_file",
           "validate_tree", "sim_harness"]
__version__ = "0.1.0"
