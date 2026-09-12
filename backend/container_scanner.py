"""
container_scanner.py  —  ECDAT container image analysis engine.

Supports two ingestion paths:

  1. ``scan_container_tar(tar_path)``
     Reads a Docker / OCI image ``.tar`` export (produced by ``docker save``
     or pulled via Docker Hub / registry) and extracts all filesystem layers
     into a temporary directory, then runs the full ECDAT pipeline against it.

  2. ``scan_container_image(image_tag)``
     Invokes ``docker save <image_tag>`` in a subprocess, writes the output to
     a temp file, then delegates to ``scan_container_tar``.  Raises a
     descriptive ``RuntimeError`` if Docker is not installed / not running.

Both return a unified result dict:
    {
        "semgrep": <semgrep JSON>,
        "binary_findings": [...],
        "dependency_findings": [...],
    }
ready for ``merge_boms()`` in ``core/translator.py``.

Layer extraction
----------------
Handles two common layouts:
  • Docker v1  — ``manifest.json`` at root; layers referenced as ``<hash>/layer.tar``
  • OCI v1     — ``index.json`` + ``blobs/sha256/<hash>`` files

Path-traversal protection is applied when extracting inner layer tarballs.
"""

from __future__ import annotations

import io
import json
import logging
import subprocess
import tarfile
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Maximum seconds for ``docker save`` to complete
_DOCKER_SAVE_TIMEOUT = 180   # 3 minutes; large images may be slow

# File extensions (and magic bytes) that trigger binary scanning
_BINARY_EXTS = frozenset({".exe", ".dll", ".so", ".elf", ".bin", ".dylib", ".o", ".a", ".sys"})


# ── Internal helpers ──────────────────────────────────────────────────────────

def _safe_extract_member(
    tar: tarfile.TarFile,
    member: tarfile.TarInfo,
    dest: Path,
) -> None:
    """Extract a single tar member with path-traversal protection."""
    member_dest = (dest / member.name).resolve()
    if not str(member_dest).startswith(str(dest.resolve())):
        logger.warning("Skipping path-traversal entry: %s", member.name)
        return
    try:
        tar.extract(member, dest, set_attrs=False)
    except Exception as exc:
        logger.debug("Could not extract %s: %s", member.name, exc)


def _extract_layer(layer_bytes: bytes, dest_dir: Path) -> None:
    """Unpack a single image layer tarball into dest_dir."""
    try:
        with tarfile.open(fileobj=io.BytesIO(layer_bytes), mode="r:*") as layer_tar:
            for member in layer_tar.getmembers():
                _safe_extract_member(layer_tar, member, dest_dir)
    except Exception as exc:
        logger.warning("Layer extraction failed: %s", exc)


def _extract_oci_layers(image_tar_path: str, fs_dir: Path) -> None:
    """
    Open the outer image tarball and unpack all filesystem layers into fs_dir.

    Supports Docker v1 format (manifest.json) and OCI v1 format (index.json /
    blobs directory).
    """
    fs_dir.mkdir(parents=True, exist_ok=True)

    with tarfile.open(image_tar_path, "r:*") as outer:
        names = set(outer.getnames())

        # ── Docker v1: manifest.json at root ─────────────────────────────────
        if "manifest.json" in names:
            manifest_f = outer.extractfile("manifest.json")
            manifest: list[dict] = json.load(manifest_f)
            layer_paths: list[str] = []
            for entry in manifest:
                layer_paths.extend(entry.get("Layers", []))

            for layer_path in layer_paths:
                if layer_path not in names:
                    logger.warning("Layer not found in tar: %s", layer_path)
                    continue
                layer_f = outer.extractfile(layer_path)
                if layer_f is None:
                    continue
                _extract_layer(layer_f.read(), fs_dir)

        else:
            # ── OCI v1: blobs/sha256/<hash> ───────────────────────────────────
            # Heuristic: anything under blobs/ that's a tarball
            blob_paths = [
                n for n in names
                if n.startswith("blobs/") and not n.endswith("/")
            ]
            # Also pick up <hash>/layer.tar paths (non-standard but seen in some exporters)
            layer_tar_paths = [n for n in names if n.endswith("/layer.tar")]
            for layer_path in blob_paths + layer_tar_paths:
                member_info = outer.getmember(layer_path)
                if member_info.size == 0:
                    continue
                layer_f = outer.extractfile(layer_path)
                if layer_f is None:
                    continue
                raw = layer_f.read()
                # Only process gzip/bz2/uncompressed tarballs (skip JSON blobs)
                if raw[:2] in (b"\x1f\x8b", b"BZ") or raw[:4] == b"\x1f\x8b\x08\x00":
                    _extract_layer(raw, fs_dir)
                elif raw[:5] == b"ustar" or raw[257:262] == b"ustar":
                    _extract_layer(raw, fs_dir)

        logger.info("Container layer extraction complete → %s", fs_dir)


def _scan_binaries_in_fs(fs_dir: Path) -> list[dict]:
    """Walk the extracted container filesystem and binary-scan each executable."""
    from binary_scanner import scan_binary

    findings: list[dict] = []
    for path in fs_dir.rglob("*"):
        if not path.is_file():
            continue

        # Extension-based detection
        if path.suffix.lower() in _BINARY_EXTS:
            findings.extend(scan_binary(str(path)))
            continue

        # Magic-byte detection for extension-less executables
        try:
            header = path.read_bytes(4)
        except OSError:
            continue

        if header[:2] == b"MZ" or header == b"\x7fELF":
            findings.extend(scan_binary(str(path)))

    return findings


# ── Public API ────────────────────────────────────────────────────────────────

async def scan_container_tar(tar_path: str) -> dict:
    """
    Extract a Docker/OCI ``.tar`` image and run the full ECDAT pipeline.

    Parameters
    ----------
    tar_path : str
        Filesystem path to the container tar archive.

    Returns
    -------
    dict
        ``{ "semgrep": dict, "binary_findings": list, "dependency_findings": list }``
    """
    from core.scanner import run_semgrep_scan
    from core.dependency_scanner import scan_dependencies
    from fastapi.concurrency import run_in_threadpool

    empty: dict = {
        "semgrep": {"results": [], "errors": []},
        "binary_findings": [],
        "dependency_findings": [],
    }

    with tempfile.TemporaryDirectory(prefix="ecdat_container_") as work_dir:
        fs_dir = Path(work_dir) / "fs"

        logger.info("Extracting container image: %s", tar_path)
        try:
            await run_in_threadpool(_extract_oci_layers, tar_path, fs_dir)
        except Exception as exc:
            logger.error("Container extraction failed: %s", exc)
            return empty

        if not fs_dir.exists():
            logger.error("Extraction produced no filesystem: %s", tar_path)
            return empty

        # ── AST scan (Semgrep) ────────────────────────────────────────────────
        logger.info("Container AST scan: %s", fs_dir)
        semgrep_result = await run_semgrep_scan(str(fs_dir))

        # ── Binary scan ───────────────────────────────────────────────────────
        logger.info("Container binary scan: %s", fs_dir)
        binary_findings: list[dict] = await run_in_threadpool(
            _scan_binaries_in_fs, fs_dir
        )
        logger.info("Container binary scan: %d finding(s)", len(binary_findings))

        # ── SCA (dependency manifests) ────────────────────────────────────────
        dependency_findings: list[dict] = await run_in_threadpool(
            scan_dependencies, str(fs_dir)
        )
        logger.info("Container SCA: %d finding(s)", len(dependency_findings))

        return {
            "semgrep": semgrep_result,
            "binary_findings": binary_findings,
            "dependency_findings": dependency_findings,
        }


async def scan_container_image(image_tag: str) -> dict:
    """
    Pull a Docker image by tag and scan it.

    Uses ``docker save <image_tag>`` to write a ``.tar`` to a temp file, then
    delegates to ``scan_container_tar``.

    Parameters
    ----------
    image_tag : str
        e.g. ``"nginx:latest"``, ``"redis:7.0"``,
        ``"docker.io/library/ubuntu:focal"``

    Raises
    ------
    RuntimeError
        If Docker is not installed, the image doesn't exist, or the save times
        out.  The caller is expected to map this to an HTTPException(400).
    """
    from fastapi.concurrency import run_in_threadpool

    with tempfile.TemporaryDirectory(prefix="ecdat_dockerpull_") as work_dir:
        tar_path = str(Path(work_dir) / "image.tar")
        logger.info("docker save %s → %s", image_tag, tar_path)

        def _docker_save() -> None:
            try:
                subprocess.run(
                    ["docker", "save", image_tag, "-o", tar_path],
                    capture_output=True,
                    text=True,
                    timeout=_DOCKER_SAVE_TIMEOUT,
                    check=True,
                )
            except subprocess.CalledProcessError as e:
                stderr = (e.stderr or "").strip() or "docker save returned non-zero"
                raise RuntimeError(
                    f"docker save failed for '{image_tag}': {stderr}"
                ) from e
            except FileNotFoundError:
                raise RuntimeError(
                    "Docker is not installed or not on PATH. "
                    "Install Docker Desktop and ensure it is running."
                )
            except subprocess.TimeoutExpired:
                raise RuntimeError(
                    f"docker save timed out after {_DOCKER_SAVE_TIMEOUT}s "
                    f"for image '{image_tag}'."
                )

        await run_in_threadpool(_docker_save)
        return await scan_container_tar(tar_path)


def is_docker_available() -> bool:
    """
    Return True if the ``docker`` CLI is installed and responsive.
    Used by the health-check endpoint so the UI can disable the tag-input field.
    """
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False
