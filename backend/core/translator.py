"""
core/translator.py
Transforms raw Semgrep JSON output (and binary/container scanner output)
into CycloneDX 1.6 SBOM documents with:
  - cryptographic-asset component type
  - Mosca's Theorem risk scoring  (X + Y > Z  =>  CRITICAL)
  - NIST FIPS 203/204 post-quantum migration recommendations

Public API
----------
transform_semgrep_to_cyclonedx(semgrep_json, dependency_findings) -> dict
transform_binary_findings_to_cyclonedx(binary_findings, source_type)  -> dict
merge_boms(bom_list)                                                    -> dict
"""

from __future__ import annotations

import uuid
import datetime
import logging
from typing import Any

from core.recommendation_engine import get_recommendation

logger = logging.getLogger(__name__)

# ── Mosca's Theorem defaults (can be overridden per-finding via rule metadata) ─
# X = time remaining before the system is retired / data expires
# Y = time required to migrate to PQC
# Z = time before a CRQC (Cryptographically Relevant Quantum Computer) exists
DEFAULT_MOSCA_X = 5   # years (conservative enterprise lifecycle)
DEFAULT_MOSCA_Y = 3   # years (typical migration project)
DEFAULT_MOSCA_Z = 7   # years (NIST estimate for CRQC availability)


def _mosca_risk(x: int, y: int, z: int) -> str:
    """
    Apply Mosca's Theorem inequality.

    If X + Y > Z the system will still be in use when quantum computers can
    break current cryptography — the risk is CRITICAL.
    """
    return "CRITICAL" if (x + y) > z else "LOW"


def _parse_mosca_params(metadata: dict) -> tuple[int, int, int]:
    """Extract X, Y, Z from Semgrep rule metadata with safe fallbacks."""
    x = int(metadata.get("mosca_x", DEFAULT_MOSCA_X))
    y = int(metadata.get("mosca_y", DEFAULT_MOSCA_Y))
    z = int(metadata.get("mosca_z", DEFAULT_MOSCA_Z))
    return x, y, z


def _severity_to_cdx(semgrep_severity: str) -> str:
    """Map Semgrep severity to CycloneDX rating severity."""
    return {
        "ERROR": "critical",
        "WARNING": "high",
        "INFO": "medium",
    }.get(semgrep_severity.upper(), "unknown")


def transform_semgrep_to_cyclonedx(semgrep_json: dict, dependency_findings: list = None) -> dict:
    """
    Convert a Semgrep JSON result object to a CycloneDX 1.6 BOM document.

    The BOM ``components`` list contains one entry per finding, typed as
    ``cryptographic-asset``.  Each component carries:

    * Standard CycloneDX fields (bom-ref, name, description, etc.)
    * ``cryptoProperties``  — algorithm details per CycloneDX 1.6 spec
    * ``mosca``             — Mosca's Theorem evaluation
    * ``recommendation``    — NIST FIPS 203/204 migration guidance

    Parameters
    ----------
    semgrep_json : dict
        Output of ``run_semgrep_scan()``.

    Returns
    -------
    dict
        A fully-formed CycloneDX 1.6 BOM dict (ready for JSON serialisation).
    """
    if semgrep_json.get("error"):
        return _error_bom(semgrep_json.get("message", "Scanner error"))

    findings: list[dict[str, Any]] = semgrep_json.get("results", [])
    components: list[dict] = []

    for finding in findings:
        rule_id: str = finding.get("check_id", "unknown-rule")
        message: str = finding.get("extra", {}).get("message", "")
        severity: str = finding.get("extra", {}).get("severity", "UNKNOWN")
        metadata: dict = finding.get("extra", {}).get("metadata", {})
        file_path: str = finding.get("path", "unknown")
        start_line: int = finding.get("start", {}).get("line", 0)
        end_line: int = finding.get("end", {}).get("line", 0)

        # ── Algorithm identification ─────────────────────────────────────────
        algorithm_raw: str = metadata.get("algorithm", rule_id)

        # ── Mosca's Theorem ──────────────────────────────────────────────────
        x, y, z = _parse_mosca_params(metadata)
        risk_level = _mosca_risk(x, y, z)

        # ── NIST migration recommendation ────────────────────────────────────
        recommendation = get_recommendation(algorithm_raw)

        # ── Build CycloneDX component ────────────────────────────────────────
        component: dict = {
            "type": "cryptographic-asset",
            "bom-ref": str(uuid.uuid4()),
            "name": algorithm_raw,
            "version": "N/A",
            "description": message,
            "cryptoProperties": {
                "assetType": "algorithm",
                "algorithmProperties": {
                    "primitive": _map_primitive(algorithm_raw),
                    "parameterSetIdentifier": algorithm_raw,
                    "nistQuantumSecurityLevel": _nist_qs_level(algorithm_raw),
                },
                "oid": _map_oid(algorithm_raw),
            },
            "evidence": {
                "occurrences": [
                    {
                        "location": file_path,
                        "line": start_line,
                        "endLine": end_line,
                    }
                ]
            },
            "properties": [
                {"name": "semgrep:rule_id", "value": rule_id},
                {"name": "semgrep:severity", "value": severity},
                {"name": "semgrep:cwe", "value": metadata.get("cwe", "N/A")},
                {"name": "semgrep:owasp", "value": metadata.get("owasp", "N/A")},
                {"name": "ecdat:category", "value": metadata.get("category", "unknown")},
            ],
            "vulnerabilities": [
                {
                    "id": rule_id,
                    "description": message,
                    "ratings": [
                        {
                            "severity": _severity_to_cdx(severity),
                            "method": "other",
                        }
                    ],
                }
            ],
            "mosca": {
                "x_years_data_sensitivity": x,
                "y_years_migration_time": y,
                "z_years_until_crqc": z,
                "equation": f"{x} + {y} > {z}  =>  {'TRUE' if (x + y) > z else 'FALSE'}",
                "risk_level": risk_level,
            },
            "recommendation": recommendation,
        }

        components.append(component)
        logger.debug("Translated finding %s -> risk=%s", rule_id, risk_level)

    # ── Append Dependency Findings ───────────────────────────────────────────
    if dependency_findings:
        _append_dependency_components(components, dependency_findings)

    # ── Assemble CycloneDX 1.6 BOM ───────────────────────────────────────────
    bom: dict = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "tools": [
                {
                    "vendor": "ECDAT",
                    "name": "Enterprise Cryptographic Discovery & Analysis Tool",
                    "version": "1.0.0",
                }
            ],
            "component": {
                "type": "application",
                "name": "ECDAT Scan Target",
                "version": "1.0.0",
            },
        },
        "components": components,
        "summary": {
            # total_findings counts all components: Semgrep AST findings + SCA dependency findings
            "total_findings": len(components),
            "critical_count": sum(
                1 for c in components if c["mosca"]["risk_level"] == "CRITICAL"
            ),
            "low_count": sum(
                1 for c in components if c["mosca"]["risk_level"] == "LOW"
            ),
        },
    }

    return bom


# ── Binary / Container findings translator ────────────────────────────────────

def transform_binary_findings_to_cyclonedx(
    binary_findings: list[dict],
    source_type: str = "file",
    dependency_findings: list[dict] | None = None,
) -> dict:
    """
    Convert a list of binary_scanner finding dicts into a CycloneDX 1.6 BOM.

    Parameters
    ----------
    binary_findings : list[dict]
        Output of ``binary_scanner.scan_binary()`` or the ``binary_findings``
        key from ``container_scanner.scan_container_tar()``.
    source_type : str
        ``"file"`` for a direct binary upload, ``"container"`` for a Docker image.
    dependency_findings : list[dict] | None
        Optional SCA findings to merge in (same format as in semgrep translator).

    Returns
    -------
    dict
        CycloneDX 1.6 BOM ready for JSON serialisation.
    """
    components: list[dict] = []

    for finding in binary_findings:
        algorithm_raw: str = finding.get("algorithm", "UNKNOWN")
        message: str        = finding.get("message",   "Cryptographic usage detected in binary")
        category: str       = finding.get("category",  "binary-crypto-symbol")
        file_path: str      = finding.get("file",       "unknown")
        symbol: str         = finding.get("symbol",     "")
        offset              = finding.get("offset")
        severity: str       = finding.get("severity",   "WARNING")
        cwe: str            = finding.get("cwe",         "CWE-327")
        owasp: str          = finding.get("owasp",       "A02:2021")

        # Mosca params
        x: int = int(finding.get("mosca_x", DEFAULT_MOSCA_X))
        y: int = int(finding.get("mosca_y", DEFAULT_MOSCA_Y))
        z: int = int(finding.get("mosca_z", DEFAULT_MOSCA_Z))
        risk_level = _mosca_risk(x, y, z)

        recommendation = get_recommendation(algorithm_raw)

        component: dict = {
            "type": "cryptographic-asset",
            "bom-ref": str(uuid.uuid4()),
            "name": algorithm_raw,
            "version": "N/A",
            "description": message,
            "cryptoProperties": {
                "assetType": "algorithm",
                "algorithmProperties": {
                    "primitive":               _map_primitive(algorithm_raw),
                    "parameterSetIdentifier": algorithm_raw,
                    "nistQuantumSecurityLevel": _nist_qs_level(algorithm_raw),
                },
                "oid": _map_oid(algorithm_raw),
            },
            "evidence": {
                "occurrences": [
                    {
                        "location": file_path,
                        "line":     offset if isinstance(offset, int) else 0,
                        "endLine":  offset if isinstance(offset, int) else 0,
                        "symbol":   symbol,
                    }
                ]
            },
            "properties": [
                {"name": "ecdat:source",    "value": "binary"},
                {"name": "ecdat:category",  "value": category},
                {"name": "ecdat:symbol",    "value": symbol},
                {"name": "semgrep:severity", "value": severity},
                {"name": "semgrep:cwe",     "value": cwe},
                {"name": "semgrep:owasp",   "value": owasp},
            ],
            "vulnerabilities": [
                {
                    "id":          f"BINARY-{algorithm_raw.upper()}-{str(uuid.uuid4())[:8]}",
                    "description": message,
                    "ratings": [{"severity": _severity_to_cdx(severity), "method": "other"}],
                }
            ],
            "mosca": {
                "x_years_data_sensitivity": x,
                "y_years_migration_time":   y,
                "z_years_until_crqc":       z,
                "equation":   f"{x} + {y} > {z}  =>  {'TRUE' if (x + y) > z else 'FALSE'}",
                "risk_level": risk_level,
            },
            "recommendation": recommendation,
        }
        components.append(component)

    # Append SCA dependency findings (reuse existing logic)
    if dependency_findings:
        _append_dependency_components(components, dependency_findings)

    bom: dict = {
        "bomFormat":    "CycloneDX",
        "specVersion":  "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version":      1,
        "metadata": {
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "tools": [
                {
                    "vendor": "ECDAT",
                    "name":   "Enterprise Cryptographic Discovery & Analysis Tool",
                    "version": "1.0.0",
                }
            ],
            "component": {
                "type":    source_type,   # "file" | "container"
                "name":    "ECDAT Scan Target",
                "version": "1.0.0",
            },
        },
        "components": components,
        "summary": {
            "total_findings": len(components),
            "critical_count": sum(1 for c in components if c["mosca"]["risk_level"] == "CRITICAL"),
            "low_count":      sum(1 for c in components if c["mosca"]["risk_level"] == "LOW"),
        },
    }
    return bom


def merge_boms(bom_list: list[dict]) -> dict:
    """
    Merge multiple CycloneDX BOMs (e.g., from a container scan that ran both
    the AST and binary pipelines) into a single unified BOM.

    The first BOM in the list provides the metadata skeleton; all components
    from every BOM are combined and the summary counters are recomputed.

    Parameters
    ----------
    bom_list : list[dict]
        A list of CycloneDX 1.6 BOM dicts.  Empty / error BOMs are skipped.

    Returns
    -------
    dict
        A merged CycloneDX 1.6 BOM.
    """
    valid = [b for b in bom_list if b and not b.get("error") and b.get("components") is not None]
    if not valid:
        return _error_bom("All sub-scans produced no results.")

    base = valid[0]
    all_components: list[dict] = []
    for bom in valid:
        all_components.extend(bom.get("components", []))

    merged: dict = {
        "bomFormat":   "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version":     1,
        "metadata":    base.get("metadata", {}),
        "components":  all_components,
        "summary": {
            "total_findings": len(all_components),
            "critical_count": sum(
                1 for c in all_components
                if c.get("mosca", {}).get("risk_level") == "CRITICAL"
            ),
            "low_count": sum(
                1 for c in all_components
                if c.get("mosca", {}).get("risk_level") == "LOW"
            ),
        },
    }
    return merged


# ── Internal shared helpers ───────────────────────────────────────────────────

def _append_dependency_components(components: list[dict], dependency_findings: list[dict]) -> None:
    """Shared helper: append SCA dependency findings as CycloneDX components."""
    for dep in dependency_findings:
        component = {
            "type": "library",
            "bom-ref": str(uuid.uuid4()),
            "name": dep["package"],
            "version": "N/A",
            "description": dep["recommendation"],
            "evidence": {
                "occurrences": [
                    {"location": dep["file"], "line": 1, "endLine": 1}
                ]
            },
            "properties": [
                {"name": "ecdat:category", "value": "dependency-vulnerability"},
            ],
            "vulnerabilities": [
                {
                    "id": f"VULN-{dep['package'].upper()}",
                    "description": dep["recommendation"],
                    "ratings": [{"severity": "critical", "method": "other"}],
                }
            ],
            "mosca": {
                "x_years_data_sensitivity": 0,
                "y_years_migration_time":   0,
                "z_years_until_crqc":       0,
                "equation":   "N/A",
                "risk_level": "CRITICAL",
            },
            "recommendation": {
                "action":        dep["recommendation"],
                "pqc_algorithm": "",
                "rationale":     "Vulnerable third-party dependency.",
                "pqc_standard":  "N/A (Classical)",
            },
        }
        components.append(component)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _error_bom(message: str) -> dict:
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "error": message,
        "components": [],
        "summary": {"total_findings": 0, "critical_count": 0, "low_count": 0},
    }


def _map_primitive(algorithm: str) -> str:
    upper = algorithm.upper()
    if any(k in upper for k in ("RSA", "ECDH", "DH")):
        return "key-agreement"
    if any(k in upper for k in ("ECDSA", "DSA", "ED25519")):
        return "signature"
    if any(k in upper for k in ("MD5", "SHA", "BLAKE")):
        return "hash"
    if any(k in upper for k in ("DES", "AES", "RC4", "CHACHA")):
        return "block-cipher"
    return "other"


def _nist_qs_level(algorithm: str) -> int:
    """
    Approximate NIST Quantum Security (QS) level:
    0 = no quantum resistance, 1-5 per NIST PQC levels.
    """
    upper = algorithm.upper()
    broken = ("MD5", "DES", "3DES", "RC4", "SHA1")
    if any(k in upper for k in broken):
        return 0
    classical = ("RSA", "ECDSA", "ECDH", "DSA")
    if any(k in upper for k in classical):
        return 0      # quantum-vulnerable
    return 1          # unknown / assume minimal


def _map_oid(algorithm: str) -> str:
    """Return a best-effort OID for common algorithms."""
    oids = {
        "MD5": "1.2.840.113549.2.5",
        "SHA1": "1.3.14.3.2.26",
        "RSA": "1.2.840.113549.1.1.1",
        "DES": "1.3.14.3.2.7",
        "3DES": "1.2.840.113549.3.7",
        "ECDSA": "1.2.840.10045.4.3.2",
    }
    upper = algorithm.upper()
    for key, oid in oids.items():
        if key in upper:
            return oid
    return "N/A"
