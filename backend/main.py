"""
main.py  —  ECDAT FastAPI application entry point.

Endpoints
---------
POST /scan
    Body : { "target_directory": "<path>" }
    Returns a CycloneDX 1.6 BOM JSON with cryptographic findings,
    Mosca's Theorem risk scores, and PQC migration recommendations.

GET /health
    Simple liveness probe.
"""

from __future__ import annotations

import logging
import sys
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
        if not v.strip():
            raise ValueError("target_directory must not be empty")
        return v.strip()


class HealthResponse(BaseModel):
    status: str
    version: str


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
    summary="Run a cryptographic scan on a target directory",
    response_description="CycloneDX 1.6 BOM with cryptographic findings",
)
async def scan(request: ScanRequest) -> dict:
    """
    1. Resolve the *target_directory* relative to the backend root.
    2. Execute ``semgrep`` via the async scanner (AST / crypto-primitive analysis).
    3. Run the native Python SCA scanner against manifest files in the same directory.
    4. Merge both result sets into a single CycloneDX 1.6 BOM and return it.
    """
    # Resolve the path relative to the backend directory
    backend_root = Path(__file__).parent
    target = (backend_root / request.target_directory).resolve()

    logger.info("Scan requested for: %s (resolved: %s)", request.target_directory, target)

    if not target.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Target path does not exist: {target}",
        )

    # ── Step 3 (AST): Run Semgrep ────────────────────────────────────────────
    semgrep_result = await run_semgrep_scan(str(target))

    if semgrep_result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=semgrep_result.get("message", "Scanner error"),
        )

    # ── Step 4 (SCA): Scan third-party dependency manifests ──────────────────
    dependency_findings = scan_dependencies(str(target))
    logger.info(
        "SCA complete — %d vulnerable dependency finding(s)",
        len(dependency_findings),
    )

    # ── Merge & translate to CycloneDX ───────────────────────────────────────
    bom = transform_semgrep_to_cyclonedx(semgrep_result, dependency_findings)

    logger.info(
        "Scan complete — %d total component(s), %d CRITICAL",
        len(bom["components"]),
        bom["summary"]["critical_count"],
    )

    return bom


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
