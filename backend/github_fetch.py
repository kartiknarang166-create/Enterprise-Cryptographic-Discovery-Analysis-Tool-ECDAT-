"""
github_fetch.py — Repository retrieval ADAPTER (no crypto scanning here).

GitHub → temporary analysis workspace → existing ECDAT scan pipeline.

Security model (mirrors main._clone_repo):
  - Shallow clone (`--depth=1`), non-interactive (`GIT_TERMINAL_PROMPT=0`).
  - Short-lived token passed via `http.<host>.extraheader` in the child
    process environment — NEVER in the clone URL or argv (so it cannot leak
    via process listings). Mirrors the existing ECDAT_GIT_TOKEN mechanism.
  - Clone timeout 120s; `git checkout <ref>` only after strict ref validation.
  - Private contents treated as UNTRUSTED DATA: read/analyzed only, never
    executed (no installs, builds, binaries, workflows).
  - Temporary workspace is always removed by the caller (`finally` cleanup).
"""

from __future__ import annotations

import base64
import logging
import os
import subprocess
from pathlib import Path

from fastapi import HTTPException, status

logger = logging.getLogger("ecdat.github_fetch")

CLONE_TIMEOUT_SECONDS = 120


def clone_url_for(full_name: str) -> str:
    return f"https://github.com/{full_name}.git"


def clone_with_token(url: str, dest: Path, token: str, host: str = "github.com") -> None:
    """Secure shallow clone. Token travels via env extraheader, never argv/URL."""
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400,
                            detail="Repository URL must not contain credentials")
    if parsed.hostname != host:
        raise HTTPException(status_code=400,
                            detail="Repository host is not permitted for GitHub scans")
    auth = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0",
               GIT_CONFIG_COUNT="1",
               GIT_CONFIG_KEY_0=f"http.https://{host}/.extraheader",
               GIT_CONFIG_VALUE_0=f"Authorization: Basic {auth}")
    logger.info("Cloning GitHub repository into %s", dest)
    try:
        subprocess.run(
            ["git", "clone", "--depth=1", "--single-branch", "--", url, str(dest)],
            env=env, capture_output=True, text=True,
            timeout=CLONE_TIMEOUT_SECONDS, check=True,
        )
    except subprocess.CalledProcessError as exc:
        logger.warning("GitHub clone failed (exit %d)", exc.returncode)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not clone the repository. It may be inaccessible, deleted, "
                   "or empty. Check GitHub access and try again.",
        ) from exc
    except FileNotFoundError:
        raise HTTPException(status_code=400,
                            detail="git is not installed on the server.")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=400,
                            detail="Repository clone timed out. Try a smaller repository.")
    logger.info("GitHub clone complete: %s", dest)


def checkout_ref(repo_dir: Path, ref: str) -> None:
    """Checkout a validated branch/tag/ref inside the cloned workspace."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    try:
        subprocess.run(
            ["git", "-C", str(repo_dir), "fetch", "--depth=1", "origin", ref],
            env=env, capture_output=True, text=True, timeout=CLONE_TIMEOUT_SECONDS,
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(repo_dir), "checkout", "--detach", "FETCH_HEAD"],
            env=env, capture_output=True, text=True, timeout=60, check=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=400,
                            detail="Repository ref is not available (deleted, renamed, "
                                   "or unsupported). Select another ref.") from exc


def resolve_commit_sha(repo_dir: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_dir), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=30, check=True,
        )
        sha = out.stdout.strip()
        return sha if len(sha) == 40 else None
    except Exception:
        return None
