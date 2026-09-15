"""
github_auth.py — REAL GitHub authorization, backend-only secrets.

Preferred model: GitHub App with minimum repository permissions
(contents:read, metadata:read). The user-authorization step of a GitHub App
uses the standard OAuth web flow (same `login/oauth/authorize` endpoint),
so this module works for both a GitHub App client_id and an OAuth App
client_id with ZERO extra dependencies (httpx only, already required).

What lives where:
  - Browser  : only `state`, `code`, safe repo metadata, safe account login.
  - Backend  : client_secret, user access token, in-memory state store.
  - NEVER    : tokens in frontend storage, CBOM, history, logs, errors, git.

Modularity: NTRO session → GitHub Authorization Provider → Repository
Service → existing scanner. Only `require_github_auth()` and
`normalize_repo()` are consumed by the scan adapter.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import time
import urllib.parse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from ntro_auth import require_ntro_employee

logger = logging.getLogger("ecdat.github_auth")

router = APIRouter(prefix="/github", tags=["github"])

GITHUB_API = "https://api.github.com"
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

STATE_TTL_SECONDS = 10 * 60  # 10 minutes

# full_name validation: owner/repo (GitHub username/repo rules, conservative)
_REPO_RE = re.compile(r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$")
_REF_RE = re.compile(r"^[A-Za-z0-9_./\-]{1,256}$")

# ── In-memory server-side stores (no persistence, no client exposure) ────────
_states: dict[str, dict] = {}           # state -> {ntro_id, exp}
_authorizations: dict[str, dict] = {}   # ntro employee_id -> {access_token,...}


def github_config() -> dict:
    return {
        "client_id": os.environ.get("GITHUB_CLIENT_ID", ""),
        "client_secret": os.environ.get("GITHUB_CLIENT_SECRET", ""),
        "app_id": os.environ.get("GITHUB_APP_ID", ""),
        "frontend_url": os.environ.get("GITHUB_FRONTEND_URL", "http://localhost:5173"),
    }


def is_configured() -> bool:
    cfg = github_config()
    return bool(cfg["client_id"] and cfg["client_secret"])


def frontend_base_url() -> str:
    return github_config()["frontend_url"].rstrip("/")


# ── State protection (CSRF) ──────────────────────────────────────────────────

def create_state(ntro_id: str) -> str:
    state = secrets.token_urlsafe(32)
    _states[state] = {"ntro_id": ntro_id, "exp": time.time() + STATE_TTL_SECONDS}
    return state


def consume_state(state: str) -> str | None:
    """One-time use. Returns ntro employee_id or None (invalid/expired/reused)."""
    entry = _states.pop(state, None)
    if not entry or entry["exp"] < time.time():
        return None
    return entry["ntro_id"]


# ── Token vault (server-side only) ───────────────────────────────────────────

def save_authorization(ntro_id: str, access_token: str, scope: str, github_user: dict) -> None:
    _authorizations[ntro_id] = {
        "access_token": access_token,
        "scope": scope,
        "github_user": {"login": github_user.get("login"), "id": github_user.get("id"),
                        "type": github_user.get("type")},
        "obtained_at": time.time(),
    }


def get_authorization(ntro_id: str) -> dict | None:
    return _authorizations.get(ntro_id)


def clear_authorization(ntro_id: str) -> None:
    _authorizations.pop(ntro_id, None)


def _auth_headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"}


# ── Repo normalization (safe subset only) ────────────────────────────────────

def normalize_repo(item: dict) -> dict:
    full_name = item.get("full_name", "")
    return {
        "full_name": full_name,
        "name": item.get("name", ""),
        "owner": (item.get("owner") or {}).get("login", ""),
        "private": bool(item.get("private", False)),
        "default_branch": item.get("default_branch", "main"),
        "html_url": item.get("html_url", ""),
    }


def validate_full_name(full_name: str) -> str:
    full_name = (full_name or "").strip()
    if not _REPO_RE.match(full_name):
        raise HTTPException(status_code=400, detail="Invalid repository identifier")
    return full_name


def validate_ref(ref: str | None) -> str | None:
    if ref is None:
        return None
    ref = ref.strip()
    if not ref or not _REF_RE.match(ref) or ".." in ref or ref.startswith(("/", ".", "-")):
        raise HTTPException(status_code=400, detail="Invalid repository ref")
    return ref


# ── GitHub API helpers (server-side, token never leaves backend) ─────────────

def _redacted_error(status: int) -> HTTPException:
    if status == 401:
        return HTTPException(status_code=502, detail="GitHub authorization expired. Reconnect GitHub.")
    if status == 403:
        return HTTPException(status_code=502, detail="GitHub rate limit or access denied. Try again later.")
    if status == 404:
        return HTTPException(status_code=404, detail="Repository not found or not accessible with this GitHub connection.")
    return HTTPException(status_code=502, detail="GitHub request failed. Try again later.")


def github_get(access_token: str, path: str, params: dict | None = None) -> httpx.Response:
    # Never log the token; only status codes.
    try:
        resp = httpx.get(GITHUB_API + path, headers=_auth_headers(access_token),
                         params=params or {}, timeout=20)
        return resp
    except httpx.HTTPError:
        logger.warning("GitHub API network failure for path=%s", path)
        raise HTTPException(status_code=502, detail="Could not reach GitHub. Check network and try again.")


async def require_github_auth(employee: dict = Depends(require_ntro_employee)) -> dict:
    """Validate NTRO session + GitHub authorization; return safe context."""
    auth = get_authorization(employee["employee_id"])
    if auth is None:
        raise HTTPException(status_code=409, detail="GitHub not connected. Connect GitHub first.")
    return {"employee": employee, "github": auth["github_user"], "access_token": auth["access_token"]}


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/config", summary="GitHub authorization configuration status")
async def github_config_status():
    cfg = github_config()
    return {
        "configured": is_configured(),
        "has_app_id": bool(cfg["app_id"]),
        # Never expose secrets — only whether they are set.
        "message": ("GitHub authorization is configured."
                    if is_configured() else
                    "GitHub App credentials are missing. Set GITHUB_CLIENT_ID and "
                    "GITHUB_CLIENT_SECRET on the backend. Local scanning still works."),
    }


class GithubLoginResponse(BaseModel):
    auth_url: str
    state: str = Field(exclude=True)  # kept out of logs; returned once for redirect


@router.post("/login", summary="Begin REAL GitHub authorization (NTRO session required)")
async def github_login(employee: dict = Depends(require_ntro_employee)):
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="GitHub App is not configured on this server. Set GITHUB_CLIENT_ID and "
                   "GITHUB_CLIENT_SECRET. Local scanning still works.")
    cfg = github_config()
    state = create_state(employee["employee_id"])
    params = urllib.parse.urlencode({
        "client_id": cfg["client_id"],
        # Minimal scope: repo covers private repos the installation/user can access.
        "scope": "repo,read:org",
        "state": state,
        "allow_signup": "false",
    })
    return {"auth_url": f"{GITHUB_AUTHORIZE_URL}?{params}"}


@router.get("/callback", summary="GitHub authorization callback (server-side exchange)")
async def github_callback(code: str | None = Query(default=None),
                          state: str | None = Query(default=None)):
    ntro_id = consume_state(state or "")
    base = frontend_base_url()
    if not ntro_id:
        logger.warning("GitHub callback with invalid/expired state")
        return RedirectResponse(f"{base}/?github_error=invalid_state", status_code=302)
    if not code:
        logger.info("GitHub authorization cancelled by user")
        return RedirectResponse(f"{base}/?github_error=cancelled", status_code=302)
    cfg = github_config()
    try:
        resp = httpx.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={"client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                  "code": code},
            timeout=20,
        )
    except httpx.HTTPError:
        return RedirectResponse(f"{base}/?github_error=exchange_failed", status_code=302)
    try:
        data = resp.json()
    except Exception:
        return RedirectResponse(f"{base}/?github_error=exchange_failed", status_code=302)
    access_token = data.get("access_token")
    if not access_token:
        logger.warning("GitHub token exchange failed (no access_token in response)")
        return RedirectResponse(f"{base}/?github_error=exchange_failed", status_code=302)
    user_resp = github_get(access_token, "/user")
    if user_resp.status_code != 200:
        return RedirectResponse(f"{base}/?github_error=user_failed", status_code=302)
    user = user_resp.json()
    save_authorization(ntro_id, access_token, data.get("scope", ""), user)
    logger.info("GitHub authorization stored for ntro session (login=%r)", user.get("login"))
    safe_login = urllib.parse.quote(str(user.get("login", "")))
    return RedirectResponse(f"{base}/?github_connected=1&github_user={safe_login}", status_code=302)


@router.get("/status", summary="GitHub connection status (safe identifiers only)")
async def github_status(employee: dict = Depends(require_ntro_employee)):
    auth = get_authorization(employee["employee_id"])
    if auth is None:
        return {"connected": False}
    return {"connected": True, "github_user": auth["github_user"]}


@router.get("/repos", summary="List authorized repositories (from GitHub, never hardcoded)")
async def github_repos(employee: dict = Depends(require_ntro_employee)):
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="GitHub App is not configured on this server. Local scanning still works.")
    auth = get_authorization(employee["employee_id"])
    if auth is None:
        raise HTTPException(status_code=409, detail="GitHub not connected. Connect GitHub first.")
    resp = github_get(auth["access_token"],
                      "/user/repos",
                      {"per_page": "100", "sort": "updated",
                       "affiliation": "owner,collaborator,organization-member"})
    if resp.status_code != 200:
        raise _redacted_error(resp.status_code)
    try:
        items = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Could not parse GitHub repository list.")
    repos = [normalize_repo(i) for i in items if isinstance(i, dict) and i.get("full_name")]
    repos.sort(key=lambda r: (not r["private"], (r["full_name"] or "").lower()))
    return {"repos": repos, "count": len(repos)}


@router.post("/logout", summary="Disconnect GitHub (discard server-side token)")
async def github_logout(employee: dict = Depends(require_ntro_employee)):
    clear_authorization(employee["employee_id"])
    return {"ok": True, "connected": False}
