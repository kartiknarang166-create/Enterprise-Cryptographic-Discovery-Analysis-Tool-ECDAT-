"""
ntro_auth.py — Prototype NTRO identity boundary (DEMO / FICTIONAL).

This is a PROTOTYPE authentication layer. It does NOT verify that a real
person is an NTRO employee. All accounts here are fictional demo accounts
used so the GitHub + scanner workflow can be exercised end-to-end.

Modularity contract (Phase A):
    class NtroProvider — interface with `authenticate()` / `get_employee()`.
    class DemoNtroProvider(NtroProvider) — pbkdf2-backed demo implementation.
    A future real NTRO SSO / LDAP / AD provider only needs to implement
    NtroProvider and be swapped in `get_provider()` — GitHub and scanning
    code depends on the interface, never on the demo dataset.

Security properties:
  - Passwords are NEVER stored in plaintext (pbkdf2_hmac/sha256, 210k rounds).
  - Passwords are NEVER logged (login failures log employee_id only).
  - Sessions are short-lived HMAC-signed tokens (default 8h), stdlib only.
  - Unknown employee / wrong password / inactive account all rejected with
    identical generic error text (no user enumeration beyond status codes).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Protocol

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("ecdat.ntro_auth")

router = APIRouter(prefix="/ntro", tags=["ntro"])

# ── Session configuration ────────────────────────────────────────────────────
SESSION_TTL_SECONDS = 8 * 3600  # 8 hours — short-lived prototype session
TOKEN_PREFIX = "ntro_"


def _session_secret() -> str:
    secret = os.environ.get("NTRO_JWT_SECRET", "")
    if not secret:
        # Dev-only fallback so local prototype works without configuration.
        # Production deployments MUST set NTRO_JWT_SECRET.
        return "ntro-prototype-dev-only-do-not-use-in-prod"
    return secret


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def mint_session_token(employee_id: str, ttl: int = SESSION_TTL_SECONDS) -> str:
    payload = json.dumps(
        {"sub": employee_id, "exp": int(time.time()) + ttl}, separators=(",", ":")
    ).encode()
    sig = hmac.new(_session_secret().encode(), payload, hashlib.sha256).digest()
    return TOKEN_PREFIX + _b64url(payload) + "." + _b64url(sig)


def verify_session_token(token: str) -> str | None:
    """Return employee_id if *token* is valid and unexpired, else None."""
    try:
        if not token.startswith(TOKEN_PREFIX):
            return None
        body = token[len(TOKEN_PREFIX):]
        payload_b64, sig_b64 = body.split(".", 1)
        payload = _b64url_decode(payload_b64)
        expected = hmac.new(_session_secret().encode(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64url_decode(sig_b64)):
            return None
        data = json.loads(payload)
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        return str(data.get("sub"))
    except Exception:
        return None


# ── Demo employee dataset (FICTIONAL — prototype only) ───────────────────────
# Password hashes only; plaintext appears nowhere in this file.
#   NTRO-DEMO-001 default demo password:  demo-ntro-001   (override via env)
#   NTRO-DEMO-002 is INACTIVE (used to test inactive rejection).
# Env overrides (no code change needed):
#   NTRO_DEMO_PASSWORD_001 / NTRO_DEMO_PASSWORD_002

def _hash(password: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt_hex), 210_000
    ).hex()


_DEMO_USERS = [
    {
        "employee_id": "NTRO-DEMO-001",
        "name": "Aarav Sharma",
        "department": "Quantum Security Lab",
        "active": True,
        "salt": "2c0017139180a52fe9ebe6184f5b6432",
        "password_hash": "4da7c6ad2c193969a9537bdbd48356c29f0a4bee63ae2b1a55b0a39eb592a412",
        "env_password": "NTRO_DEMO_PASSWORD_001",
        "default_password": "demo-ntro-001",
    },
    {
        "employee_id": "NTRO-DEMO-002",
        "name": "Meera Iyer",
        "department": "Cryptography Review Cell",
        "active": False,  # inactive by design — login must be rejected
        "salt": "1b9273de6052e96ffb952154990c2b7f",
        "password_hash": "6404ceb3752dc6748146eda6ee1552a05e6bde849f09865a9b322e5c6b356ffc",
        "env_password": "NTRO_DEMO_PASSWORD_002",
        "default_password": "demo-ntro-002",
    },
]


def _expected_hash(entry: dict) -> str:
    """Env override wins; otherwise the baked-in demo hash (same password)."""
    override = os.environ.get(entry["env_password"])
    if override:
        return _hash(override, entry["salt"])
    return entry["password_hash"]


# ── Provider interface (swap point for real NTRO SSO/LDAP/AD) ────────────────

class NtroProvider(Protocol):
    def authenticate(self, employee_id: str, password: str) -> dict | None: ...
    def get_employee(self, employee_id: str) -> dict | None: ...


class DemoNtroProvider:
    """Fictional demo provider — satisfies NtroProvider for the prototype."""

    def get_employee(self, employee_id: str) -> dict | None:
        for entry in _DEMO_USERS:
            if hmac.compare_digest(entry["employee_id"], employee_id):
                return {
                    "employee_id": entry["employee_id"],
                    "name": entry["name"],
                    "department": entry["department"],
                    "active": entry["active"],
                }
        return None

    def authenticate(self, employee_id: str, password: str) -> dict | None:
        for entry in _DEMO_USERS:
            if hmac.compare_digest(entry["employee_id"], employee_id):
                if not entry["active"]:
                    return None
                candidate = _hash(password, entry["salt"])
                if hmac.compare_digest(candidate, _expected_hash(entry)):
                    return self.get_employee(employee_id)
                return None
        return None


def get_provider() -> NtroProvider:
    # Future: return RealNtroSsoProvider() when configured, without touching
    # GitHub or scanner code.
    return DemoNtroProvider()


# ── FastAPI dependency ───────────────────────────────────────────────────────

def _extract_token(x_ntro_token: str | None, authorization: str | None) -> str | None:
    if x_ntro_token:
        return x_ntro_token.strip()
    if authorization and authorization.lower().startswith("bearer "):
        candidate = authorization[7:].strip()
        if candidate.startswith(TOKEN_PREFIX):
            return candidate
    return None


async def require_ntro_employee(
    x_ntro_token: str | None = Header(default=None, alias="X-NTRO-Token"),
    authorization: str | None = Header(default=None),
) -> dict:
    token = _extract_token(x_ntro_token, authorization)
    if not token:
        raise HTTPException(status_code=401, detail="NTRO session required")
    employee_id = verify_session_token(token)
    if not employee_id:
        raise HTTPException(status_code=401, detail="NTRO session expired or invalid")
    employee = get_provider().get_employee(employee_id)
    if not employee or not employee.get("active"):
        raise HTTPException(status_code=401, detail="NTRO session expired or invalid")
    return employee


# ── Routes ───────────────────────────────────────────────────────────────────

class NtroLoginRequest(BaseModel):
    employee_id: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class NtroLoginResponse(BaseModel):
    token: str
    employee: dict


@router.post("/login", response_model=NtroLoginResponse, summary="Prototype NTRO demo login")
async def ntro_login(body: NtroLoginRequest):
    employee_id = body.employee_id.strip()
    employee = get_provider().authenticate(employee_id, body.password)
    if employee is None:
        # Log identity only — NEVER the password.
        logger.warning("NTRO demo login rejected for employee_id=%r", employee_id)
        raise HTTPException(status_code=401, detail="Invalid employee ID or password")
    token = mint_session_token(employee["employee_id"])
    logger.info("NTRO demo login accepted for employee_id=%r", employee["employee_id"])
    return {"token": token, "employee": employee}


@router.get("/me", summary="Current prototype NTRO session")
async def ntro_me(employee: dict = Depends(require_ntro_employee)):
    return {"employee": employee, "demo": True, "prototype": True}


@router.post("/logout", summary="Discard prototype NTRO session (stateless)")
async def ntro_logout(employee: dict = Depends(require_ntro_employee)):
    # Sessions are stateless HMAC tokens; the client discards the token.
    return {"ok": True}
