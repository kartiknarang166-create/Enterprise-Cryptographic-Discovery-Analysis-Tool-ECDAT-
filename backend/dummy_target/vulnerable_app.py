"""
dummy_target/vulnerable_app.py
Intentionally vulnerable cryptographic code for ECDAT scanner demonstration.
DO NOT USE IN PRODUCTION.
"""

import hashlib
from Crypto.PublicKey import RSA
from Crypto.Cipher import DES


# ── VULNERABILITY 1: MD5 hash (broken, collision-prone) ──────────────────────
def compute_md5(data: bytes) -> str:
    """Uses MD5 — cryptographically broken since 1996."""
    digest = hashlib.md5(data).hexdigest()
    return digest


# ── VULNERABILITY 2: RSA-1024 key generation (too short, NIST-deprecated) ────
def generate_rsa_keypair():
    """Generates an RSA key with only 1024 bits — vulnerable to factoring."""
    key = RSA.generate(1024)
    return key.export_key(), key.publickey().export_key()


# ── VULNERABILITY 3: DES symmetric encryption (56-bit key, brute-forceable) ──
def des_encrypt(plaintext: bytes, key: bytes) -> bytes:
    """Encrypts using DES — broken since 1997 DES Challenges."""
    cipher = DES.new(key, DES.MODE_ECB)
    # Pad to 8-byte block boundary
    pad_len = 8 - (len(plaintext) % 8)
    padded = plaintext + bytes([pad_len] * pad_len)
    return cipher.encrypt(padded)


if __name__ == "__main__":
    sample_data = b"sensitive-enterprise-payload"

    print("[MD5]  Hash:", compute_md5(sample_data))

    priv, pub = generate_rsa_keypair()
    print("[RSA-1024] Public key (first 64 bytes):", pub[:64])

    des_key = b"WEAKKEY!"  # 8-byte DES key
    ciphertext = des_encrypt(sample_data, des_key)
    print("[DES]  Ciphertext (hex):", ciphertext.hex())
