"""
dummy_target/more_crypto.py
Extended dummy target demonstrating various cryptographic assets:
- Critical (Quantum Vulnerable)
- Vulnerable but NOT Critical (Classically weak, low risk Mosca)
- Not Vulnerable (Secure / PQC ready)
"""

import hashlib
import ecdsa
import cryptography.hazmat.primitives.asymmetric.dh
import ed25519
from Crypto.PublicKey import RSA
from Crypto.Cipher import ARC4, DES3, Blowfish, AES
import pqcrypto.kem.kyber512
import pqcrypto.sign.dilithium2

# ── CRITICAL: Quantum Vulnerable (Mosca X+Y > Z) ─────────────────────────────
def critical_quantum_vulnerable():
    # ECDSA
    sk_ecdsa = ecdsa.SigningKey.generate(curve=ecdsa.NIST256p)
    
    # Diffie-Hellman
    parameters = cryptography.hazmat.primitives.asymmetric.dh.generate_parameters(generator=2, key_size=2048)
    
    # Ed25519
    sk_ed25519 = ed25519.Ed25519PrivateKey.generate()
    
    # RSA 2048 (Classically secure, Quantum vulnerable)
    rsa_2048 = RSA.generate(2048)

# ── VULNERABLE BUT NOT CRITICAL: Classically Weak (Mosca X+Y <= Z) ───────────
def vulnerable_not_critical():
    # SHA-1 Hash
    h = hashlib.sha1(b"weak_hash")
    
    # RC4 Stream Cipher
    rc4 = ARC4.new(b"secret_key")
    
    # 3DES Block Cipher
    des3 = DES3.new(b"16byte_secret_key_", DES3.MODE_ECB)
    
    # Blowfish Block Cipher
    blowfish = Blowfish.new(b"blowfish_key", Blowfish.MODE_ECB)

# ── NOT VULNERABLE: Secure / Post-Quantum Ready (Mosca X+Y <= Z) ─────────────
def secure_and_pqc():
    # AES-256-GCM (Quantum resistant symmetric)
    aes_gcm = AES.new(b"32_byte_long_secret_key_for_aes!", AES.MODE_GCM)
    
    # SHA-256 (Quantum resistant hash)
    h_sha256 = hashlib.sha256(b"secure_hash")
    
    # ML-KEM / Kyber (NIST FIPS 203)
    pk_kyber, sk_kyber = pqcrypto.kem.kyber512.generate_keypair()
    
    # ML-DSA / Dilithium (NIST FIPS 204)
    pk_dilithium, sk_dilithium = pqcrypto.sign.dilithium2.generate_keypair()

if __name__ == "__main__":
    pass
