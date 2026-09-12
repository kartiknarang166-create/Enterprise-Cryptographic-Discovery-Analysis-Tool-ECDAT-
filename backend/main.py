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

POST /scan/upload
    Accepts a zip file (multipart/form-data) — the browser zips the user's
    selected local folder client-side using JSZip, then uploads it here.

POST /scan/binary
    Accepts a compiled binary file (multipart/form-data).
    Supports: .exe, .dll, .so, .elf, .bin, .dylib, .sys
    Runs binary_scanner (PE/ELF symbol tables + crypto constant scan).
    Returns a CycloneDX 1.6 BOM with component.type = "file".

POST /scan/container/upload
    Accepts a Docker/OCI image .tar archive (multipart/form-data).
    Max size: 500 MB.  Extracts all layers and runs AST + binary + SCA.
    Returns a merged CycloneDX 1.6 BOM with component.type = "container".

POST /scan/container
    Body: { "image_tag": "nginx:latest" }
    Pulls the image via `docker save`, then runs the same container pipeline.
    Requires Docker to be installed and running on the server.

GET /health
    Simple liveness probe.

GET /health/docker
    Returns { "docker": true/false } — used by the UI to disable the
    image-tag input when Docker is not installed on the server.
"""

from __future__ import annotations

import io
import logging
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

# ── ensure /backend is on the Python path so `core.*` imports resolve ─────────
sys.path.insert(0, str(Path(__file__).parent))

from core.scanner import run_semgrep_scan
from core.translator import (
    transform_semgrep_to_cyclonedx,
    transform_binary_findings_to_cyclonedx,
    merge_boms,
)
from core.dependency_scanner import scan_dependencies
from binary_scanner import scan_binary
from container_scanner import (
    scan_container_tar,
    scan_container_image,
    is_docker_available,
)

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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], 
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


class ContainerTagRequest(BaseModel):
    image_tag: str

    @field_validator("image_tag")
    @classmethod
    def must_not_be_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("image_tag must not be empty")
        return v


class DockerStatusResponse(BaseModel):
    docker: bool
    message: str


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


@app.get(
    "/health/docker",
    response_model=DockerStatusResponse,
    tags=["ops"],
    summary="Docker availability probe — used by the UI to enable/disable container tag scanning",
)
async def health_docker() -> DockerStatusResponse:
    """
    Returns whether Docker is installed and running on the server.
    The frontend uses this to disable the container image-tag input
    field (with a tooltip) when Docker is not available.
    """
    available = await run_in_threadpool(is_docker_available)
    return DockerStatusResponse(
        docker=available,
        message="Docker is available" if available
        else "Docker is not installed or not running on this server. "
             "Container image-tag scanning is disabled. "
             "You can still scan .tar exports via the upload endpoint.",
    )

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
            await run_in_threadpool(_clone_repo, request.target_directory, clone_dest)
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
        dependency_findings = await run_in_threadpool(scan_dependencies, str(target))
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


# ── Allowed binary extensions ─────────────────────────────────────────────────────

_BINARY_EXTS = frozenset({".exe", ".dll", ".so", ".elf", ".bin", ".dylib", ".sys", ".o"})
_MAX_BINARY_BYTES   = 100 * 1024 * 1024   #  100 MB — binaries are rarely larger
_MAX_CONTAINER_BYTES = 500 * 1024 * 1024  #  500 MB — container layers compressed


@app.post(
    "/scan/binary",
    tags=["scanner"],
    summary="Run a cryptographic scan on a compiled binary (.exe / .dll / .so / .elf / .bin / .dylib)",
    response_description="CycloneDX 1.6 BOM with binary cryptographic findings",
)
async def scan_binary_upload(file: UploadFile = File(...)) -> dict:
    """
    Accepts a compiled binary file as multipart/form-data.

    Supported formats
    -----------------
    Windows PE executables/DLLs  (.exe, .dll, .sys)
    ELF shared libraries          (.so, .elf, .o)
    macOS / UNIX shared libs      (.dylib)
    Raw binary blobs              (.bin)

    Max size: 100 MB

    The scanner:
    1. Detects PE vs ELF via magic bytes.
    2. Extracts imported/exported crypto symbol names (pefile / pyelftools).
    3. Scans for hardcoded crypto constants (AES S-Box, SHA/MD5 IVs, PEM headers).
    4. Normalises findings into a CycloneDX 1.6 BOM (component.type = "file").
    """
    raw = await file.read()

    if len(raw) > _MAX_BINARY_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Binary too large ({len(raw) // (1024 * 1024)} MB). "
                f"Maximum is {_MAX_BINARY_BYTES // (1024 * 1024)} MB."
            ),
        )

    suffix = Path(file.filename or "binary").suffix.lower() or ".bin"

    tmp_dir_obj = tempfile.TemporaryDirectory(prefix="ecdat_binary_")
    try:
        tmp_path = Path(tmp_dir_obj.name) / f"target{suffix}"
        tmp_path.write_bytes(raw)

        logger.info("Binary scan: %s (%d bytes)", file.filename, len(raw))
        binary_findings: list[dict] = await run_in_threadpool(scan_binary, str(tmp_path))
        logger.info("Binary scan complete: %d finding(s)", len(binary_findings))

        bom = transform_binary_findings_to_cyclonedx(binary_findings, source_type="file")

        # Stamp the original filename into the BOM metadata
        bom["metadata"]["component"]["name"] = file.filename or "binary-upload"

        logger.info(
            "Binary BOM: %d component(s), %d CRITICAL",
            len(bom["components"]), bom["summary"]["critical_count"],
        )
        return bom

    finally:
        try:
            tmp_dir_obj.cleanup()
        except Exception as e:
            logger.warning("Binary temp cleanup failed: %s", e)


@app.post(
    "/scan/container/upload",
    tags=["scanner"],
    summary="Run a full cryptographic scan on a Docker/OCI image .tar archive",
    response_description="Merged CycloneDX 1.6 BOM (AST + binary + SCA)",
)
async def scan_container_upload(file: UploadFile = File(...)) -> dict:
    """
    Accepts a Docker / OCI image ``.tar`` archive as multipart/form-data.

    How to produce a compatible .tar
    ---------------------------------
    docker save nginx:latest -o nginx.tar

    Max size: 500 MB (displayed in the upload UI)

    Pipeline
    --------
    1. Extract all OCI/Docker filesystem layers into a temp directory.
    2. Run Semgrep AST scan over extracted source files.
    3. Run binary_scanner over extracted ELF/PE executables.
    4. Run SCA (dependency manifests) scan.
    5. Merge all results into a single CycloneDX 1.6 BOM
       (component.type = "container").
    """
    raw = await file.read()

    if len(raw) > _MAX_CONTAINER_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Container archive too large ({len(raw) // (1024 * 1024)} MB). "
                f"Maximum is {_MAX_CONTAINER_BYTES // (1024 * 1024)} MB."
            ),
        )

    # Validate it's a tar
    import io as _io
    try:
        import tarfile as _tarfile
        if not _tarfile.is_tarfile(_io.BytesIO(raw)):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is not a valid tar archive.",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # tarfile.is_tarfile may raise on very large buffers — proceed anyway

    tmp_dir_obj = tempfile.TemporaryDirectory(prefix="ecdat_ctrup_")
    try:
        tar_path = Path(tmp_dir_obj.name) / "image.tar"
        tar_path.write_bytes(raw)
        del raw   # free memory before the heavy pipeline runs

        logger.info("Container tar scan: %s (%d MB)", file.filename, tar_path.stat().st_size // (1024 * 1024))
        result = await scan_container_tar(str(tar_path))

        # Build merged BOM from all three sub-results
        semgrep_bom = transform_semgrep_to_cyclonedx(
            result["semgrep"], result["dependency_findings"]
        )
        binary_bom = transform_binary_findings_to_cyclonedx(
            result["binary_findings"], source_type="container"
        )
        bom = merge_boms([semgrep_bom, binary_bom])
        bom["metadata"]["component"]["type"]    = "container"
        bom["metadata"]["component"]["name"]    = file.filename or "container-image"

        logger.info(
            "Container BOM: %d component(s), %d CRITICAL",
            len(bom["components"]), bom["summary"]["critical_count"],
        )
        return bom

    finally:
        try:
            tmp_dir_obj.cleanup()
        except Exception as e:
            logger.warning("Container tar temp cleanup failed: %s", e)


@app.post(
    "/scan/container",
    tags=["scanner"],
    summary="Run a cryptographic scan on a Docker image by tag (requires Docker on server)",
    response_description="Merged CycloneDX 1.6 BOM (AST + binary + SCA)",
)
async def scan_container_by_tag(request: ContainerTagRequest) -> dict:
    """
    Pulls the specified Docker image via ``docker save``, extracts all layers,
    and runs the full ECDAT pipeline (Semgrep AST + binary + SCA).

    Requires Docker to be installed and running on the server.
    Check ``GET /health/docker`` to verify availability before calling this.

    Example body
    ------------
    { "image_tag": "nginx:latest" }
    { "image_tag": "redis:7.0" }
    { "image_tag": "docker.io/library/ubuntu:focal" }
    """
    try:
        result = await scan_container_image(request.image_tag)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    semgrep_bom = transform_semgrep_to_cyclonedx(
        result["semgrep"], result["dependency_findings"]
    )
    binary_bom = transform_binary_findings_to_cyclonedx(
        result["binary_findings"], source_type="container"
    )
    bom = merge_boms([semgrep_bom, binary_bom])
    bom["metadata"]["component"]["type"] = "container"
    bom["metadata"]["component"]["name"] = request.image_tag

    logger.info(
        "Container tag BOM (%s): %d component(s), %d CRITICAL",
        request.image_tag, len(bom["components"]), bom["summary"]["critical_count"],
    )
    return bom

@app.post(
    "/scan/upload",
    tags=["scanner"],
    summary="Run a cryptographic scan on a browser-uploaded zip of a local folder",
    response_description="CycloneDX 1.6 BOM with cryptographic findings",
)
async def scan_upload(file: UploadFile = File(...)) -> dict:
    """
    Accepts a **zip file** posted as multipart/form-data.

    The browser (LandingPage.jsx) zips the user-selected local folder using
    JSZip, then POSTs it here.  We extract the zip into a temp directory and
    run the same scan pipeline as POST /scan.

    Source files are extracted only into a temporary directory for the duration
    of the scan.  Nothing is stored after the request completes.

    Limits
    ------
    - Maximum upload size: 200 MB (enforced by the frontend and server-side)
    - File must be a valid zip archive
    """
    MAX_BYTES = 200 * 1024 * 1024  # 200 MB

    # Read the upload into memory
    raw = await file.read()

    if len(raw) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Upload too large ({len(raw) // (1024*1024)} MB). Maximum is 200 MB.",
        )

    # Validate it's a zip
    if not zipfile.is_zipfile(io.BytesIO(raw)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a valid zip archive.",
        )

    tmp_dir_obj = tempfile.TemporaryDirectory(prefix="ecdat_upload_")
    try:
        extract_dir = Path(tmp_dir_obj.name)
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            # Security: guard against path-traversal in zip entry names
            for member in zf.infolist():
                member_path = extract_dir / member.filename
                if not str(member_path.resolve()).startswith(str(extract_dir.resolve())):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Zip contains unsafe path entries (path traversal detected).",
                    )
            await run_in_threadpool(zf.extractall, extract_dir)

        logger.info(
            "Upload extracted: %s (%d bytes, %d files)",
            file.filename, len(raw), len(list(extract_dir.rglob("*"))),
        )

        # ── Run same pipeline as POST /scan ────────────────────────────────────
        semgrep_result = await run_semgrep_scan(str(extract_dir))

        if semgrep_result.get("error"):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=semgrep_result.get("message", "Scanner error"),
            )

        dependency_findings = await run_in_threadpool(scan_dependencies, str(extract_dir))
        logger.info("SCA complete — %d finding(s)", len(dependency_findings))

        bom = transform_semgrep_to_cyclonedx(semgrep_result, dependency_findings)

        logger.info(
            "Upload scan complete — %d component(s), %d CRITICAL",
            len(bom["components"]),
            bom["summary"]["critical_count"],
        )

        return bom

    finally:
        try:
            tmp_dir_obj.cleanup()
            logger.info("Upload temp directory cleaned up.")
        except Exception as cleanup_err:
            logger.warning("Failed to clean up upload temp dir: %s", cleanup_err)


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
