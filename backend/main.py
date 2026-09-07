"""
main.py  —  ECDAT FastAPI application entry point.

Endpoints
---------
POST /scan
    Body : { "target_directory": "<local-path-or-git-url>" }
    Returns a CycloneDX 1.6 BOM JSON with cryptographic findings,
    Mosca's Theorem risk scores, and PQC migration recommendations.

    Accepts either:
      • A local directory path  (e.g.  ./dummy_target)
      • A remote Git URL        (e.g.  https://github.com/example/repo.git)

GET /health
    Simple liveness probe.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

# ── ensure /backend is on the Python path so `core.*` imports resolve ─────────
sys.path.insert(0, str(Path(__file__).parent))

from core.scanner import run_semgrep_scan
from core.translator import transform_semgrep_to_cyclonedx
from core.dependency_scanner import scan_dependencies

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ecdat.main")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="ECDAT — Enterprise Cryptographic Discovery & Analysis Tool",
    description=(
        "Scans source code with Semgrep, maps findings to CycloneDX 1.6 "
        "cryptographic-asset components, applies Mosca's Theorem risk scoring, "
        "and provides NIST FIPS 203/204 post-quantum migration recommendations."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS — allow the Vite dev server (and any origin during development) ──────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten to ["http://localhost:5173"] in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response schemas ────────────────────────────────────────────────

class ScanRequest(BaseModel):
    target_directory: str

    @field_validator("target_directory")
    @classmethod
    def must_not_be_empty(cls, v: str) -> str:
        # Strip spaces and surrounding quotes that might accidentally be included
        v = v.strip(' "\'')
        if not v:
            raise ValueError("target_directory must not be empty")
        return v


class HealthResponse(BaseModel):
    status: str
    version: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_git_url(value: str) -> bool:
    """Return True if *value* looks like a remote Git URL."""
    lowered = value.lower()
    return (
        lowered.startswith("http://")
        or lowered.startswith("https://")
        or lowered.startswith("git@")
        or lowered.startswith("git://")
    )


def _clone_repo(url: str, dest: Path) -> None:
    """
    Shallow-clone *url* into *dest* using the system ``git`` binary.

    Raises
    ------
    HTTPException (400)
        If the clone fails for any reason (invalid URL, private repo,
        network error, git not installed, etc.).
    """
    logger.info("Cloning remote repository: %s → %s", url, dest)
    try:
        subprocess.run(
            ["git", "clone", "--depth=1", "--single-branch", url, str(dest)],
            capture_output=True,
            text=True,
            timeout=120,
            check=True,      # raises CalledProcessError on non-zero exit
        )
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip() or (e.stdout or "").strip() or "unknown git error"
        logger.error("git clone failed (exit %d): %s", e.returncode, stderr)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"git clone failed for '{url}': {stderr}",
        ) from e
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="git is not installed or not on PATH. Cannot clone remote repositories.",
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"git clone timed out after 120s for '{url}'.",
        )

    logger.info("Clone complete: %s", dest)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["ops"],
    summary="Liveness probe",
)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version="1.0.0")


@app.post(
    "/scan",
    tags=["scanner"],
    summary="Run a cryptographic scan on a local directory or remote GitHub repo",
    response_description="CycloneDX 1.6 BOM with cryptographic findings",
)
async def scan(request: ScanRequest) -> dict:
    """
    Accepts either:
    - A **local path** (absolute or relative to the backend root), e.g. ``./dummy_target``
    - A **remote Git URL**, e.g. ``https://github.com/example/repo.git``

    When a URL is provided the repo is shallow-cloned into a temporary directory,
    scanned, and the temp directory is deleted immediately afterwards.

    Steps
    -----
    1. Detect whether the input is a Git URL or a local path.
    2. If a Git URL → shallow-clone into a ``tempfile.TemporaryDirectory``.
    3. Resolve the scan target (local path or cloned dir).
    4. Run Semgrep (AST) and dependency (SCA) scanners against the target.
    5. Merge results into a CycloneDX 1.6 BOM and return it.
    6. Clean up any temporary directory (guaranteed via ``finally``).
    """
    tmp_dir_obj = None   # TemporaryDirectory handle — kept alive until finally

    try:
        # ── Step 1: URL vs local path ─────────────────────────────────────────
        if _is_git_url(request.target_directory):
            # ── Step 2: Clone remote repo into a temp directory ───────────────
            tmp_dir_obj = tempfile.TemporaryDirectory(prefix="ecdat_clone_")
            clone_dest  = Path(tmp_dir_obj.name) / "repo"
            _clone_repo(request.target_directory, clone_dest)
            target = clone_dest

        else:
            # ── Local path: resolve relative to backend root ──────────────────
            backend_root = Path(__file__).parent
            target       = (backend_root / request.target_directory).resolve()

            logger.info(
                "Local scan requested: %s  (resolved: %s)",
                request.target_directory, target,
            )

            if not target.exists():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Target path does not exist: {target}",
                )

        logger.info("Starting scan on: %s", target)

        # ── Step 3 (AST): Run Semgrep ─────────────────────────────────────────
        semgrep_result = await run_semgrep_scan(str(target))

        if semgrep_result.get("error"):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=semgrep_result.get("message", "Scanner error"),
            )

        # ── Step 4 (SCA): Scan third-party dependency manifests ───────────────
        dependency_findings = scan_dependencies(str(target))
        logger.info(
            "SCA complete — %d vulnerable dependency finding(s)",
            len(dependency_findings),
        )

        # ── Step 5: Merge & translate to CycloneDX ────────────────────────────
        bom = transform_semgrep_to_cyclonedx(semgrep_result, dependency_findings)

        logger.info(
            "Scan complete — %d total component(s), %d CRITICAL",
            len(bom["components"]),
            bom["summary"]["critical_count"],
        )

        return bom

    finally:
        # ── Step 6: Cleanup — always runs, even on exception ──────────────────
        if tmp_dir_obj is not None:
            try:
                tmp_dir_obj.cleanup()
                logger.info("Temporary clone directory cleaned up.")
            except Exception as cleanup_err:
                logger.warning("Failed to clean up temp dir: %s", cleanup_err)


# ── Dev entry point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
