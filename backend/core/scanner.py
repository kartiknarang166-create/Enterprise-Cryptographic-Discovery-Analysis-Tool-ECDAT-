"""
core/scanner.py
Async wrapper around the Semgrep CLI. Executes a multi-language scan and returns parsed JSON.

Language coverage
-----------------
Semgrep is pointed at the ``rules/`` directory which contains one YAML file
per language family:

  rules/semgrep_crypto.yaml     — Python
  rules/c_cpp_crypto.yaml       — C / C++
  rules/java_crypto.yaml        — Java
  rules/javascript_crypto.yaml  — JavaScript / TypeScript

All files are loaded simultaneously with ``--config ./rules`` so a single
subprocess call covers every language in the target repository.

Windows compatibility
---------------------
``semgrep`` is installed as a Python console-script (semgrep.exe) into the
user's Scripts folder, which is frequently absent from PATH.  Resolution order:

  1. shutil.which("semgrep") / shutil.which("semgrep.exe")  — respects PATH
  2. Common Windows user-install locations (Python Launcher & AppData\Roaming)
  3. python -m semgrep  — always works if the semgrep package is importable

If none of the above resolve, we fall back to the plain "semgrep" name with
shell=True so that cmd.exe can perform its own PATH + PATHEXT expansion.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Absolute path to the rules DIRECTORY — Semgrep loads ALL *.yaml files within
# it simultaneously, giving us multi-language coverage in a single subprocess call.
_RULES_DIR = (Path(__file__).parent.parent / "rules").resolve()

SCAN_TIMEOUT_SECONDS = 120


# ── Semgrep executable resolution ────────────────────────────────────────────

def _probe_exe(cmd: list[str]) -> bool:
    """
    Return True if running ``cmd --version`` exits with code 0 or 1.
    This weeds out shim wrappers (e.g. semgrep.exe on Windows) that themselves
    call a sub-process by name and fail with exit code 127 when that
    sub-process is not on PATH.
    """
    try:
        r = subprocess.run(
            cmd + ["--version"],
            capture_output=True, text=True, timeout=15,
        )
        # 0 = ok, 1 = found but something minor; 127 = shim could not exec
        return r.returncode in (0, 1)
    except Exception:
        return False


def _find_semgrep() -> tuple[list[str], bool]:
    """
    Return (command_prefix, use_shell) for invoking Semgrep on any platform.

    On Windows the semgrep.exe may live in a Scripts directory that is not on
    PATH.  We try several strategies before giving up.

    Important: ``semgrep.exe`` shipped with recent pip packages is a thin
    shim that calls ``pysemgrep`` by name.  If the Scripts folder is not on
    PATH the shim exits 127.  We therefore *probe* every candidate with
    ``--version`` before accepting it, and we prefer ``pysemgrep.exe``
    (the real OCaml binary) over the ``semgrep.exe`` wrapper.

    Returns
    -------
    command_prefix : list[str]
        Argv prefix to prepend before Semgrep flags.
    use_shell : bool
        Whether subprocess should be called with shell=True.
    """
    # ── Strategy 1: shutil.which searches PATH + PATHEXT correctly ───────────
    # Prefer pysemgrep (real binary) before semgrep (possible shim)
    for name in ("pysemgrep", "pysemgrep.exe", "semgrep", "semgrep.exe"):
        found = shutil.which(name)
        if found and _probe_exe([found]):
            logger.debug("Found semgrep via shutil.which: %s", found)
            return [found], False

    # ── Strategy 2: common Windows user-install paths ────────────────────────
    if sys.platform == "win32":
        interpreter_dir = Path(sys.executable).parent
        scripts_dir = interpreter_dir / "Scripts"

        appdata = os.environ.get("APPDATA", "")
        ver = f"Python{sys.version_info.major}{sys.version_info.minor}"
        user_scripts = (
            Path(appdata) / "Python" / ver / "Scripts" if appdata else None
        )

        localappdata = os.environ.get("LOCALAPPDATA", "")
        local_py_dirs: list[Path] = []
        if localappdata:
            local_py_dirs = list(
                Path(localappdata, "Programs", "Python").glob("Python3*")
            )

        # Build candidate list — pysemgrep.exe first (real binary, not a shim)
        candidates: list[Path] = []
        for exe_name in ("pysemgrep.exe", "semgrep.exe"):
            candidates.append(scripts_dir / exe_name)
            candidates.append(interpreter_dir / exe_name)
            if user_scripts:
                candidates.append(user_scripts / exe_name)
            for pydir in local_py_dirs:
                candidates.append(pydir / "Scripts" / exe_name)

        for candidate in candidates:
            if candidate.is_file() and _probe_exe([str(candidate)]):
                logger.debug("Found semgrep at candidate path: %s", candidate)
                return [str(candidate)], False
            elif candidate.is_file():
                logger.debug(
                    "Candidate exists but probe failed (shim?): %s", candidate
                )

    # ── Strategy 3: python -m semgrep (importable if pip-installed) ──────────
    # semgrep ≥1.38.0 exits with code 2 (deprecated) when called this way,
    # but the module still works — accept codes 0 and 2.
    try:
        probe = subprocess.run(
            [sys.executable, "-m", "semgrep", "--version"],
            capture_output=True, text=True, timeout=15,
        )
        if probe.returncode in (0, 2):
            logger.debug(
                "semgrep reachable via 'python -m semgrep' (returncode=%d)",
                probe.returncode,
            )
            return [sys.executable, "-m", "semgrep"], False
    except Exception:
        pass

    # ── Strategy 4: shell=True fallback (cmd.exe does its own resolution) ────
    logger.warning(
        "Could not locate semgrep executable directly; "
        "falling back to shell=True invocation. "
        "sys.executable=%s  APPDATA=%s  PATH=%s",
        sys.executable,
        os.environ.get("APPDATA", "<unset>"),
        os.environ.get("PATH", "<unset>"),
    )
    return ["semgrep"], True          # caller must pass shell=True


# ── Public API ────────────────────────────────────────────────────────────────

async def run_semgrep_scan(target_path: str) -> dict:
    """
    Execute ``semgrep --config <rules> --json <target_path>`` asynchronously.

    Parameters
    ----------
    target_path : str
        Filesystem path to the directory or file to be scanned.

    Returns
    -------
    dict
        Parsed Semgrep JSON output, or a structured error dict on failure.
    """
    target = Path(target_path).resolve()

    if not target.exists():
        logger.error("Scan target does not exist: %s", target)
        return _error_payload(f"Target path does not exist: {target}")

    if not _RULES_DIR.is_dir():
        logger.error("Rules directory does not exist: %s", _RULES_DIR)
        return _error_payload(
            f"Rules directory not found: {_RULES_DIR}. "
            "Ensure the rules/ directory exists alongside main.py."
        )

    semgrep_prefix, use_shell = _find_semgrep()

    cmd = [
        *semgrep_prefix,
        "scan",
        "--config", str(_RULES_DIR),   # directory → all *.yaml loaded at once
        "--json",
        "--no-git-ignore",              # scan regardless of .gitignore
        str(target),
    ]

    # On Windows with shell=True subprocess expects a single string, not a list
    if use_shell and sys.platform == "win32":
        # Quote paths that may contain spaces
        cmd_str = " ".join(f'"{c}"' if " " in c else c for c in cmd)
        run_arg: str | list = cmd_str
    else:
        run_arg = cmd

    logger.info("Launching semgrep multi-language scan (shell=%s): %s", use_shell, run_arg)

    try:
        loop = asyncio.get_event_loop()
        result: subprocess.CompletedProcess = await loop.run_in_executor(
            None,
            lambda: subprocess.run(
                run_arg,
                capture_output=True,
                text=True,
                timeout=SCAN_TIMEOUT_SECONDS,
                shell=use_shell,
            ),
        )
    except subprocess.TimeoutExpired:
        logger.error("Semgrep timed out after %ds", SCAN_TIMEOUT_SECONDS)
        return _error_payload(f"Semgrep scan timed out after {SCAN_TIMEOUT_SECONDS}s")
    except FileNotFoundError:
        logger.error("semgrep executable not found after all resolution strategies")
        return _error_payload(
            "semgrep not found. Install it with:  pip install semgrep  "
            "then restart the server. If already installed, ensure "
            "C:\\Users\\<you>\\AppData\\Roaming\\Python\\PythonXYZ\\Scripts "
            "is on your PATH."
        )

    # Semgrep exits 0 (no findings), 1 (findings present), or >1 (error)
    if result.returncode > 1:
        logger.error(
            "Semgrep exited with code %d. stderr: %s",
            result.returncode,
            result.stderr[:500],
        )
        return _error_payload(
            f"Semgrep exited with code {result.returncode}: {result.stderr[:300]}"
        )

    try:
        parsed = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse semgrep JSON output: %s", exc)
        return _error_payload(f"Could not parse semgrep output: {exc}")

    logger.info(
        "Scan complete — %d finding(s) in %s",
        len(parsed.get("results", [])),
        target,
    )
    return parsed


# ── Helpers ───────────────────────────────────────────────────────────────────

def _error_payload(message: str) -> dict:
    return {
        "error": True,
        "message": message,
        "results": [],
        "errors": [],
        "stats": {},
    }
