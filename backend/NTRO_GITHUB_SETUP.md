# NTRO prototype + private GitHub repository flow (privacy-feature branch)

## 1. Prototype NTRO authentication — WHY IT IS FICTIONAL/DEMO

`backend/ntro_auth.py` implements a **prototype identity boundary**, not real
employment verification. Accounts (`NTRO-DEMO-001` active, `NTRO-DEMO-002`
inactive-by-design) are a hardcoded fictional dataset so the end-to-end
workflow can be exercised. The UI labels every such account
**DEMO / PROTOTYPE**.

- Passwords: PBKDF2-HMAC-SHA256 (210k rounds), hashes only in source.
- Sessions: HMAC-signed `ntro_…` tokens, 8h expiry, sent via `X-NTRO-Token`
  (avoids clashing with the existing `ECDAT_API_KEY` bearer scheme).
- Demo default passwords (prototype only): `demo-ntro-001` / `demo-ntro-002`
  (override with `NTRO_DEMO_PASSWORD_001/002`, secret `NTRO_JWT_SECRET`).
- Swap point: `NtroProvider` protocol + `get_provider()`. A future real NTRO
  SSO / LDAP / AD IdP implements the protocol — GitHub and scanner code
  depend on the interface, never on the demo dataset.

## 2. GitHub App setup (REAL authorization, minimum permissions)

1. Create a GitHub App (or OAuth App for development): User settings →
   Developer settings → GitHub Apps → New.
2. Permissions: **Repository → Contents: Read-only, Metadata: Read-only**.
3. Set the callback/redirect URL to `http://<backend-host>:8000/github/callback`.
4. Copy Client ID / Client Secret into backend env:
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
   (`GITHUB_APP_ID` informational, `GITHUB_FRONTEND_URL` default
   `http://localhost:5173`). See `backend/.env.example`. Never commit values.
5. Restart the backend (`.\start_backend.bat`).

If credentials are missing, `/github/config` reports `configured:false`,
the UI shows a setup error, and **local scanning keeps working**.

## 3. Required environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NTRO_JWT_SECRET` | backend | HMAC secret for prototype sessions (set in prod) |
| `NTRO_DEMO_PASSWORD_001/002` | backend (opt) | Override demo passwords |
| `GITHUB_CLIENT_ID` | backend | GitHub App/OAuth client id |
| `GITHUB_CLIENT_SECRET` | backend | GitHub secret (backend only, never frontend) |
| `GITHUB_APP_ID` | backend (opt) | Informational |
| `GITHUB_FRONTEND_URL` | backend (opt) | Post-authorization redirect target |

## 4. Minimum permissions & private repository flow

`repo,read:org` OAuth scope on a Contents-read App: the user sees **only**
repos the authorized identity can access (`GET /github/repos`, live from
GitHub, private flagged 🔒/🌐). Selecting a repo + `Analyze Repository`
calls `POST /scan/github {repository, ref?}` which: validates NTRO →
validates server-side GitHub token → re-checks `GET /repos/{owner}/{repo}`
against the token (browser values never trusted) → shallow-clones with the
existing `extraheader` credential model → optional validated `ref` checkout.

## 5. How repository data enters the EXISTING scanner

`POST /scan/github` (`backend/main.py`) is an **adapter, not a scanner**:
temp dir → `run_semgrep_scan` → `scan_for_sensitive_data` +
`correlate_and_escalate` → `scan_dependencies` →
`transform_semgrep_to_cyclonedx` → `scan_materials` → `finalize_bom` — the
identical call sequence as `POST /scan`. No `github_scanner.py` exists.

## 6. Security assumptions

- Tokens backend-only (in-memory vault); never in frontend storage, CBOM,
  Supabase history, logs, errors, or git. Clone token via process-env
  `extraheader`, never URL/argv. `GIT_TERMINAL_PROMPT=0`, 120s clone timeout,
  `TemporaryDirectory` + `finally` cleanup, ZIP-slip/path-traversal/SSRF
  guards preserved. Cloned code is UNTRUSTED DATA: read-only analysis, never
  executed (no installs/builds/binaries/workflows).
- OAuth `state` is single-use, 10-min expiry (CSRF protection).

## 7. Replacing the demo provider with real NTRO SSO

Implement `NtroProvider` (`authenticate`, `get_employee`) backed by the
official IdP, return it from `get_provider()` when configured, keep the
`X-NTRO-Token` session contract. No GitHub, retrieval, scanner, history, or
frontend-flow changes required.
