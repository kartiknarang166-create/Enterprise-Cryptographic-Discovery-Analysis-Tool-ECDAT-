"""
binary_scanner.py  —  ECDAT compiled-binary analysis engine.

Inspects compiled binaries (.exe, .dll, .so, .elf, .dylib, .bin) for:
  • Imported / exported OpenSSL and CryptoAPI symbol names (pefile / pyelftools)
  • Hardcoded cryptographic constants (AES S-Box, SHA/MD5 IVs, PEM headers)
  • ASCII crypto symbol names embedded as strings inside binary blobs

pefile and pyelftools are treated as *optional* — if either is absent the
module falls back to pure-regex string extraction, which catches most
real-world crypto usage without native toolchain requirements.

Public API
----------
scan_binary(file_path: str) -> list[dict]
    Returns a list of ECDAT finding dicts ready for translator.py.
"""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Optional library probes ───────────────────────────────────────────────────

try:
    import pefile as _pefile
    _PEFILE_OK = True
    logger.debug("pefile available — PE (EXE/DLL) analysis enabled")
except ImportError:
    _PEFILE_OK = False
    logger.warning(
        "pefile not installed — PE analysis falls back to string extraction. "
        "Install with: pip install pefile"
    )

try:
    from elftools.elf.elffile import ELFFile as _ELFFile
    from elftools.common.exceptions import ELFError as _ELFError
    _ELFTOOLS_OK = True
    logger.debug("pyelftools available — ELF (.so/.elf) analysis enabled")
except ImportError:
    _ELFTOOLS_OK = False
    logger.warning(
        "pyelftools not installed — ELF analysis falls back to string extraction. "
        "Install with: pip install pyelftools"
    )


# ── Crypto symbol table ───────────────────────────────────────────────────────
# Maps symbol name → (algorithm, category, mosca_x, mosca_y, mosca_z)

CRYPTO_SYMBOLS: dict[str, tuple[str, str, int, int, int]] = {
    # ── OpenSSL / libcrypto MD5 ───────────────────────────────────────────────
    "MD5_Init":                 ("MD5",        "weak-hash",          5,  5, 5),
    "MD5_Update":               ("MD5",        "weak-hash",          5,  5, 5),
    "MD5_Final":                ("MD5",        "weak-hash",          5,  5, 5),
    # ── SHA-1 ─────────────────────────────────────────────────────────────────
    "SHA1_Init":                ("SHA1",       "weak-hash",          1,  1, 10),
    "SHA1_Update":              ("SHA1",       "weak-hash",          1,  1, 10),
    "SHA1_Final":               ("SHA1",       "weak-hash",          1,  1, 10),
    # ── SHA-256 (secure, flag for inventory) ──────────────────────────────────
    "SHA256_Init":              ("SHA256",     "secure-hash",        10, 1, 50),
    "SHA256_Update":            ("SHA256",     "secure-hash",        10, 1, 50),
    "SHA256_Final":             ("SHA256",     "secure-hash",        10, 1, 50),
    # ── DES / Triple-DES ──────────────────────────────────────────────────────
    "DES_ecb_encrypt":          ("DES",        "broken-cipher",      5,  6, 5),
    "DES_cbc_encrypt":          ("DES",        "broken-cipher",      5,  6, 5),
    "DES_ede3_cbc_encrypt":     ("3DES",       "weak-cipher",        3,  3, 10),
    # ── RC4 ───────────────────────────────────────────────────────────────────
    "EVP_rc4":                  ("RC4",        "broken-cipher",      2,  2, 10),
    "RC4":                      ("RC4",        "broken-cipher",      2,  2, 10),
    "RC4_set_key":              ("RC4",        "broken-cipher",      2,  2, 10),
    # ── Blowfish / RC2 ────────────────────────────────────────────────────────
    "BF_encrypt":               ("BLOWFISH",   "weak-cipher",        2,  2, 10),
    "RC2_encrypt":              ("RC2",        "broken-cipher",      5,  6,  5),
    # ── AES (secure) ──────────────────────────────────────────────────────────
    "EVP_aes_256_gcm":          ("AES-GCM",   "secure-cipher",      20, 1, 50),
    "EVP_aes_128_gcm":          ("AES-GCM",   "secure-cipher",      20, 1, 50),
    "AES_encrypt":              ("AES",        "symmetric-cipher",    5, 3, 15),
    "AES_set_encrypt_key":      ("AES",        "symmetric-cipher",    5, 3, 15),
    # ── RSA (quantum-vulnerable) ──────────────────────────────────────────────
    "RSA_public_encrypt":       ("RSA",        "quantum-vulnerable", 15, 5,  7),
    "RSA_private_decrypt":      ("RSA",        "quantum-vulnerable", 15, 5,  7),
    "RSA_generate_key":         ("RSA",        "quantum-vulnerable", 15, 5,  7),
    "RSA_generate_key_ex":      ("RSA",        "quantum-vulnerable", 15, 5,  7),
    # ── EC / ECDSA (quantum-vulnerable) ───────────────────────────────────────
    "EC_KEY_new":               ("ECDSA",      "quantum-vulnerable",  5, 5,  7),
    "ECDSA_sign":               ("ECDSA",      "quantum-vulnerable",  5, 5,  7),
    "ECDSA_verify":             ("ECDSA",      "quantum-vulnerable",  5, 5,  7),
    "EC_POINT_mul":             ("ECDH",       "quantum-vulnerable",  5, 5,  7),
    # ── DH ────────────────────────────────────────────────────────────────────
    "DH_generate_key":          ("DH",         "quantum-vulnerable",  7, 3,  7),
    "DH_compute_key":           ("DH",         "quantum-vulnerable",  7, 3,  7),
    # ── EVP generics ──────────────────────────────────────────────────────────
    "EVP_DigestInit":           ("HASH-GENERIC","unknown",            5, 5,  5),
    "EVP_CipherInit":           ("CIPHER-GENERIC","unknown",          5, 5,  5),
    # ── SSL/TLS ───────────────────────────────────────────────────────────────
    "SSL_CTX_new":              ("SSL/TLS",    "protocol",            5, 5,  5),
    "TLS_method":               ("TLS",        "protocol",            5, 3,  7),
    "TLS_client_method":        ("TLS",        "protocol",            5, 3,  7),
    # ── Windows CryptoAPI / BCrypt ────────────────────────────────────────────
    "CryptCreateHash":          ("WIN-CRYPTO", "weak-hash",           5, 5,  5),
    "CryptDeriveKey":           ("WIN-CRYPTO", "broken-cipher",       5, 5,  5),
    "CryptEncrypt":             ("WIN-CRYPTO", "broken-cipher",       5, 5,  5),
    "CryptDecrypt":             ("WIN-CRYPTO", "broken-cipher",       5, 5,  5),
    "BCryptOpenAlgorithmProvider": ("BCRYPT",  "symmetric-cipher",    5, 3, 15),
    "BCryptHashData":           ("BCRYPT-HASH","unknown",             5, 5,  5),
}

# ── Byte-level crypto constant signatures ────────────────────────────────────
# (pattern_bytes, algorithm, human_message)
CRYPTO_CONSTANTS: list[tuple[bytes, str, str]] = [
    # AES S-Box first row (present in any AES implementation)
    (b"\x63\x7c\x77\x7b\xf2\x6b\x6f\xc5", "AES",  "Hardcoded AES S-Box constant"),
    # SHA-1 initial hash values (big-endian)
    (b"\x67\x45\x23\x01\xef\xcd\xab\x89", "SHA1", "Hardcoded SHA-1 IV constants"),
    # MD5 initial hash values (little-endian)
    (b"\x01\x23\x45\x67\x89\xab\xcd\xef", "MD5",  "Hardcoded MD5 IV constants"),
    # PEM headers
    (b"-----BEGIN RSA PRIVATE KEY-----",   "RSA",  "Hardcoded RSA private key (PKCS#1)"),
    (b"-----BEGIN PRIVATE KEY-----",       "RSA",  "Hardcoded PKCS#8 private key"),
    (b"-----BEGIN EC PRIVATE KEY-----",    "ECDSA","Hardcoded EC private key"),
    (b"-----BEGIN CERTIFICATE-----",       "X509", "Hardcoded X.509 certificate"),
    # OpenSSL version strings (older linkage)
    (b"OpenSSL 1.",                         "OPENSSL","Linked against OpenSSL 1.x (pre-3.0)"),
    (b"OpenSSL 0.",                         "OPENSSL","Linked against OpenSSL 0.x (very old)"),
    (b"libssl.so.1",                        "OPENSSL","Dynamic link: libssl 1.x"),
    # DES weak / semi-weak key constants
    (b"\xfe\xfe\xfe\xfe\xfe\xfe\xfe\xfe", "DES",  "Possible DES weak-key constant"),
    # MD5 magic constant (used in MD5 rounds)
    (b"\xd7\x6a\xa4\x78",                  "MD5",  "Hardcoded MD5 round constant"),
]

# ASCII symbol regex — matches exported/imported names embedded as C strings
_SYM_RE = re.compile(rb"[A-Za-z_][A-Za-z0-9_]{4,}")


# ── Finding builder ───────────────────────────────────────────────────────────

def _finding(
    file_path: str,
    symbol: str,
    algorithm: str,
    category: str,
    offset: int | None,
    message: str,
    mosca_x: int = 5,
    mosca_y: int = 5,
    mosca_z: int = 5,
) -> dict:
    return {
        "source":    "binary",
        "file":      file_path,
        "symbol":    symbol,
        "algorithm": algorithm,
        "offset":    offset,
        "message":   message,
        "severity":  "WARNING",
        "category":  category,
        "mosca_x":   mosca_x,
        "mosca_y":   mosca_y,
        "mosca_z":   mosca_z,
        # CWE / OWASP defaults (translator picks these up)
        "cwe":   "CWE-327",
        "owasp": "A02:2021",
    }


# ── PE analysis (pefile) ──────────────────────────────────────────────────────

def _scan_pe(file_path: str, data: bytes) -> list[dict]:
    """Parse Windows PE import/export directories for crypto symbols."""
    findings: list[dict] = []
    try:
        pe = _pefile.PE(data=data, fast_load=False)
    except Exception as exc:
        logger.debug("PE parse error for %s: %s", file_path, exc)
        return findings

    # Imported symbols
    if hasattr(pe, "DIRECTORY_ENTRY_IMPORT"):
        for entry in pe.DIRECTORY_ENTRY_IMPORT:
            dll = (entry.dll or b"").decode(errors="replace").lower()
            for imp in entry.imports:
                name = (imp.name or b"").decode(errors="replace")
                if name in CRYPTO_SYMBOLS:
                    alg, cat, x, y, z = CRYPTO_SYMBOLS[name]
                    findings.append(_finding(
                        file_path, name, alg, cat,
                        imp.address or None,
                        f"PE import: {name} from {dll}",
                        x, y, z,
                    ))

    # Exported symbols (for DLLs)
    if hasattr(pe, "DIRECTORY_ENTRY_EXPORT"):
        for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
            name = (exp.name or b"").decode(errors="replace")
            if name in CRYPTO_SYMBOLS:
                alg, cat, x, y, z = CRYPTO_SYMBOLS[name]
                findings.append(_finding(
                    file_path, name, alg, cat,
                    exp.address or None,
                    f"PE export: {name}",
                    x, y, z,
                ))

    return findings


# ── ELF analysis (pyelftools) ─────────────────────────────────────────────────

def _scan_elf(file_path: str, data: bytes) -> list[dict]:
    """Parse ELF symbol tables (.dynsym + .symtab) for crypto symbols."""
    findings: list[dict] = []
    try:
        elf = _ELFFile(io.BytesIO(data))
    except Exception as exc:
        logger.debug("ELF parse error for %s: %s", file_path, exc)
        return findings

    for section in elf.iter_sections():
        if section["sh_type"] not in ("SHT_SYMTAB", "SHT_DYNSYM"):
            continue
        for sym in section.iter_symbols():
            name: str = sym.name
            if name in CRYPTO_SYMBOLS:
                alg, cat, x, y, z = CRYPTO_SYMBOLS[name]
                findings.append(_finding(
                    file_path, name, alg, cat,
                    sym["st_value"] or None,
                    f"ELF symbol: {name}",
                    x, y, z,
                ))

    return findings


# ── String/constant scanner (always runs) ─────────────────────────────────────

def _scan_strings(file_path: str, data: bytes, known_syms: set[str]) -> list[dict]:
    """
    Byte-level scan for:
    • Hardcoded crypto constants (S-boxes, IVs, PEM headers).
    • ASCII symbol names embedded in the binary but not in symbol tables.
    """
    findings: list[dict] = []
    seen: set[tuple[str, str]] = set()

    # Constant patterns
    for pattern, algorithm, message in CRYPTO_CONSTANTS:
        if pattern in data:
            key = (algorithm, message)
            if key not in seen:
                seen.add(key)
                offset = data.find(pattern)
                findings.append(_finding(
                    file_path,
                    pattern.decode(errors="replace").strip()[:40],
                    algorithm, "hardcoded-constant", offset, message,
                ))

    # ASCII symbol strings (supplements symbol-table scan)
    for match in _SYM_RE.finditer(data):
        sym = match.group().decode(errors="replace")
        if sym in CRYPTO_SYMBOLS and sym not in known_syms:
            alg, cat, x, y, z = CRYPTO_SYMBOLS[sym]
            key = (sym, alg)
            if key not in seen:
                seen.add(key)
                findings.append(_finding(
                    file_path, sym, alg, cat,
                    match.start(),
                    f"Crypto symbol string in binary: {sym}",
                    x, y, z,
                ))

    return findings


# ── Public API ────────────────────────────────────────────────────────────────

def scan_binary(file_path: str) -> list[dict]:
    """
    Scan a compiled binary for cryptographic usage.

    Strategy
    --------
    1. Read magic bytes to detect PE (``MZ``) vs ELF (``\\x7fELF``).
    2. Parse symbol tables with pefile / pyelftools if available.
    3. Always run a byte-level string/constant scan as a supplement.
    4. Deduplicate: don't emit the same (symbol, algorithm) pair twice.

    Parameters
    ----------
    file_path : str
        Absolute or relative path to the binary file.

    Returns
    -------
    list[dict]
        ECDAT finding dicts consumable by ``transform_binary_findings_to_cyclonedx``.
    """
    path = Path(file_path)
    if not path.is_file():
        logger.error("Binary not found: %s", file_path)
        return []

    try:
        data = path.read_bytes()
    except OSError as exc:
        logger.error("Cannot read binary %s: %s", file_path, exc)
        return []

    if len(data) < 4:
        return []  # too small to be a real binary

    findings: list[dict] = []
    magic = data[:4]

    is_pe  = data[:2] == b"MZ"
    is_elf = magic    == b"\x7fELF"

    if is_pe and _PEFILE_OK:
        logger.info("PE analysis  : %s", path.name)
        findings.extend(_scan_pe(str(path), data))
    elif is_elf and _ELFTOOLS_OK:
        logger.info("ELF analysis : %s", path.name)
        findings.extend(_scan_elf(str(path), data))
    else:
        if is_pe:
            logger.info("PE detected but pefile unavailable — string scan only: %s", path.name)
        elif is_elf:
            logger.info("ELF detected but pyelftools unavailable — string scan only: %s", path.name)
        else:
            logger.info("Unknown binary format — string scan: %s", path.name)

    # Always run string scanner; skip symbols we already found via table parsing
    known_syms = {f["symbol"] for f in findings}
    findings.extend(_scan_strings(str(path), data, known_syms))

    logger.info(
        "Binary scan complete — %d finding(s) in %s (PE=%s ELF=%s)",
        len(findings), path.name, is_pe, is_elf,
    )
    return findings
