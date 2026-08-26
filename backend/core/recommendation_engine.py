"""
core/recommendation_engine.py
NIST FIPS 203/204 Post-Quantum migration lookup table.

Each entry maps a legacy / broken algorithm keyword (upper-cased) to a
structured recommendation record that is embedded into CycloneDX output.
"""

from __future__ import annotations

# ── Migration mapping ─────────────────────────────────────────────────────────
# Key   : upper-cased algorithm name or family substring (matched via `in`)
# Value : recommendation record
MIGRATION_MAP: dict[str, dict] = {
    # ── Key Encapsulation / Asymmetric Encryption ───────────────────────────
    "RSA": {
        "pqc_standard": "NIST FIPS 203",
        "pqc_algorithm": "ML-KEM (Module-Lattice-Based Key Encapsulation Mechanism)",
        "action": "Migrate to NIST FIPS 203 ML-KEM",
        "rationale": (
            "RSA is vulnerable to Shor's algorithm on quantum computers. "
            "ML-KEM provides IND-CCA2 security and is NIST-standardised."
        ),
        "priority": "HIGH",
    },
    "ECDH": {
        "pqc_standard": "NIST FIPS 203",
        "pqc_algorithm": "ML-KEM (Module-Lattice-Based Key Encapsulation Mechanism)",
        "action": "Migrate to NIST FIPS 203 ML-KEM",
        "rationale": (
            "ECDH relies on the elliptic-curve discrete-log problem, broken by "
            "quantum Shor's algorithm. Transition to ML-KEM."
        ),
        "priority": "HIGH",
    },
    # ── Digital Signatures ──────────────────────────────────────────────────
    "ECDSA": {
        "pqc_standard": "NIST FIPS 204",
        "pqc_algorithm": "ML-DSA (Module-Lattice-Based Digital Signature Algorithm)",
        "action": "Migrate to NIST FIPS 204 ML-DSA",
        "rationale": (
            "ECDSA is vulnerable to quantum attacks. ML-DSA (formerly CRYSTALS-Dilithium) "
            "provides strong post-quantum digital signature security."
        ),
        "priority": "HIGH",
    },
    "DSA": {
        "pqc_standard": "NIST FIPS 204",
        "pqc_algorithm": "ML-DSA (Module-Lattice-Based Digital Signature Algorithm)",
        "action": "Migrate to NIST FIPS 204 ML-DSA",
        "rationale": (
            "DSA key security is based on discrete logarithm, solvable by quantum "
            "computers. Replace with ML-DSA."
        ),
        "priority": "HIGH",
    },
    # ── Broken / Legacy Symmetric & Hash ───────────────────────────────────
    "MD5": {
        "pqc_standard": "N/A (Classical)",
        "pqc_algorithm": "SHA-3-256 / SHA-3-512 (NIST FIPS 202)",
        "action": "Deprecate immediately. Upgrade to AES-256 / SHA-3",
        "rationale": (
            "MD5 produces 128-bit digests and is collision-broken. "
            "Replace with SHA-3 for hashing or HMAC-SHA-256 for MACs."
        ),
        "priority": "CRITICAL",
    },
    "DES": {
        "pqc_standard": "N/A (Classical)",
        "pqc_algorithm": "AES-256-GCM (NIST FIPS 197 / SP 800-38D)",
        "action": "Deprecate immediately. Upgrade to AES-256 / SHA-3",
        "rationale": (
            "DES has a 56-bit key and was publicly broken in 1997. "
            "Use AES-256-GCM for authenticated encryption."
        ),
        "priority": "CRITICAL",
    },
    "3DES": {
        "pqc_standard": "N/A (Classical)",
        "pqc_algorithm": "AES-256-GCM (NIST FIPS 197 / SP 800-38D)",
        "action": "Deprecate immediately. Upgrade to AES-256 / SHA-3",
        "rationale": (
            "Triple-DES provides only ~112 bits of effective security and is "
            "deprecated by NIST. Migrate to AES-256-GCM."
        ),
        "priority": "CRITICAL",
    },
    "RC4": {
        "pqc_standard": "N/A (Classical)",
        "pqc_algorithm": "ChaCha20-Poly1305 or AES-256-GCM",
        "action": "Deprecate immediately. Upgrade to AES-256 / SHA-3",
        "rationale": (
            "RC4 is a stream cipher with multiple biases and is fully broken. "
            "Replace with ChaCha20-Poly1305 or AES-256-GCM."
        ),
        "priority": "CRITICAL",
    },
    "SHA1": {
        "pqc_standard": "N/A (Classical)",
        "pqc_algorithm": "SHA-3-256 (NIST FIPS 202)",
        "action": "Deprecate immediately. Upgrade to AES-256 / SHA-3",
        "rationale": (
            "SHA-1 is collision-broken (SHAttered attack, 2017). "
            "Upgrade to SHA-256 or SHA-3."
        ),
        "priority": "HIGH",
    },
}

_DEFAULT_RECOMMENDATION: dict = {
    "pqc_standard": "Review Required",
    "pqc_algorithm": "Consult NIST SP 800-131Ar3",
    "action": "Evaluate and migrate to NIST-approved algorithm",
    "rationale": "Algorithm not in ECDAT knowledge base. Manual review required.",
    "priority": "MEDIUM",
}


def get_recommendation(algorithm_name: str) -> dict:
    """
    Return the migration recommendation for *algorithm_name*.

    Matching is case-insensitive and substring-based so that identifiers like
    ``weak-rsa-key-size`` still resolve to the RSA entry.

    Parameters
    ----------
    algorithm_name : str
        The algorithm identifier extracted from a Semgrep finding.

    Returns
    -------
    dict
        Recommendation record from MIGRATION_MAP, or a default record.
    """
    upper = algorithm_name.upper()
    for key, rec in MIGRATION_MAP.items():
        if key in upper:
            return rec
    return _DEFAULT_RECOMMENDATION
