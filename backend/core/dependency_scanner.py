"""
core/dependency_scanner.py
Parses manifest files (requirements.txt, package.json) for known vulnerable
cryptographic dependencies. Pure Python — no Go binaries required.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

VULNERABLE_LIBS = {
    "pycrypto": "Deprecated and vulnerable to block collisions. Migrate to the `cryptography` standard library.",
    "md5-hash": "MD5 is cryptographically broken. Migrate to SHA-256."
}

def scan_dependencies(target_directory: str) -> list:
    findings = []
    target = Path(target_directory)
    
    if not target.exists() or not target.is_dir():
        return findings

    # Check requirements.txt
    req_path = target / "requirements.txt"
    if req_path.is_file():
        try:
            with open(req_path, "r", encoding="utf-8") as f:
                content = f.read().lower()
                for lib, recommendation in VULNERABLE_LIBS.items():
                    if lib.lower() in content:
                        findings.append({
                            "package": lib,
                            "file": "requirements.txt",
                            "recommendation": recommendation,
                        })
        except Exception as exc:
            logger.warning("Could not parse requirements.txt at %s: %s", req_path, exc)

    # Check package.json
    pkg_path = target / "package.json"
    if pkg_path.is_file():
        try:
            with open(pkg_path, "r", encoding="utf-8") as f:
                content = f.read().lower()
                for lib, recommendation in VULNERABLE_LIBS.items():
                    if f'"{lib.lower()}"' in content:
                        findings.append({
                            "package": lib,
                            "file": "package.json",
                            "recommendation": recommendation,
                        })
        except Exception as exc:
            logger.warning("Could not parse package.json at %s: %s", pkg_path, exc)

    return findings
