"""A missing or broken Python environment must fail early and clearly — never with a traceback,
never after the batch has been simulated, and never with the exit code of a failed metric."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
RUNNER = TOOL_DIR / "scripts" / "sim-validate.mjs"
BATCH = TOOL_DIR / "scripts" / "sim-batch.mts"
ENV_ERROR_EXIT = 3

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
_WORKSPACE_READY = (REPO_ROOT / "node_modules" / ".pnpm").exists()
needs_workspace = pytest.mark.skipif(shutil.which("npx") is None or not _WORKSPACE_READY, reason="pnpm workspace not installed")


def _validate(python: str, tmp_path):
    env = {**os.environ, "PYTHON": python}
    return subprocess.run(["node", str(RUNNER), "--example", "--out", str(tmp_path / "rep")],
                          cwd=REPO_ROOT, capture_output=True, text=True, env=env)


def test_sim_harness_imports_without_jsonschema():
    """sim:validate is standard-library only: a Python with no jsonschema must still run it."""
    code = ("import sys; sys.modules['jsonschema'] = None\n"   # make `import jsonschema` fail
            "import pv_data_validator.sim_cli, pv_data_validator.sim_harness\n"
            "print('ok')")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": str(TOOL_DIR / "src")})
    assert r.returncode == 0 and r.stdout.strip() == "ok", r.stderr


def test_dataset_validator_names_still_importable_from_the_package():
    pytest.importorskip("jsonschema")
    from pv_data_validator import validate_file, validate_tree  # noqa: F401  (lazy attributes)


@needs_node
def test_missing_interpreter_is_a_clear_environment_error(tmp_path):
    r = _validate("/nonexistent/venv/bin/python", tmp_path)
    assert r.returncode == ENV_ERROR_EXIT
    assert "Python interpreter not found" in r.stderr and "/nonexistent/venv/bin/python" in r.stderr
    assert "Traceback" not in r.stderr and "report written" not in r.stderr
    assert not (tmp_path / "rep.json").exists()


@needs_node
def test_broken_venv_symlink_is_named_as_such(tmp_path):
    venv_bin = tmp_path / "venv" / "bin"
    venv_bin.mkdir(parents=True)
    (venv_bin / "python").symlink_to("/nonexistent/base/python3.9")   # base interpreter is gone
    r = _validate(str(venv_bin / "python"), tmp_path)
    assert r.returncode == ENV_ERROR_EXIT
    assert "the virtualenv is broken" in r.stderr and "Recreate it" in r.stderr
    assert "Traceback" not in r.stderr


@needs_node
def test_interpreter_that_cannot_run_python(tmp_path):
    fake = tmp_path / "python"
    fake.write_text("#!/bin/sh\necho 'dyld: Library not loaded' >&2\nexit 134\n")
    fake.chmod(0o755)
    r = _validate(str(fake), tmp_path)
    assert r.returncode == ENV_ERROR_EXIT
    assert "failed to run" in r.stderr and "Library not loaded" in r.stderr


@needs_node
def test_python_too_old_is_reported_with_its_version(tmp_path):
    fake = tmp_path / "python"
    fake.write_text("#!/bin/sh\necho 'PVENV {\"version\": [3, 8, 10], \"executable\": \"x\", \"harness\": true}'\n")
    fake.chmod(0o755)
    r = _validate(str(fake), tmp_path)
    assert r.returncode == ENV_ERROR_EXIT
    assert "Python is too old" in r.stderr and "3.8.10" in r.stderr and ">= 3.11" in r.stderr


@needs_node
def test_a_harness_crash_is_not_reported_as_a_written_report(tmp_path):
    """The preflight passes, then the harness dies: exit 3 and no 'report written' claim."""
    fake = tmp_path / "python"
    fake.write_text("#!/bin/sh\n"
                    "case \"$1\" in -c) echo 'PVENV {\"version\": [3, 12, 0], \"executable\": \"x\", \"harness\": true}';; "
                    "*) echo 'Traceback (most recent call last): boom' >&2; exit 1;; esac\n")
    fake.chmod(0o755)
    r = _validate(str(fake), tmp_path)
    assert r.returncode == ENV_ERROR_EXIT, "a crash must not look like a failed metric (exit 1)"
    assert "did not produce a report" in r.stderr and "report written" not in r.stderr


@needs_node
def test_working_environment_still_validates(tmp_path):
    r = _validate(sys.executable, tmp_path)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "rep.json").exists()


@needs_workspace
def test_sim_batch_checks_python_before_simulating(tmp_path):
    """160 matches take minutes; with a broken interpreter the batch must stop in seconds, having simulated nothing."""
    t0 = time.time()
    r = subprocess.run(["npx", "tsx", str(BATCH), "--matches", "160", "--out", str(tmp_path / "run.json"),
                        "--report", str(tmp_path / "rep")], cwd=REPO_ROOT, capture_output=True, text=True,
                       env={**os.environ, "PYTHON": "/nonexistent/python"}, timeout=120)
    assert r.returncode == ENV_ERROR_EXIT, r.stderr
    assert time.time() - t0 < 60
    assert "sim:batch: cannot run the Python validation harness" in r.stderr and "--no-validate" in r.stderr
    assert "simulating" not in r.stderr and not (tmp_path / "run.json").exists()
