"""Tests for the NTRO prototype + private GitHub adapter (privacy-feature).

All GitHub interactions are mocked — no real credentials required.
"""
import json
from types import SimpleNamespace as NS

from fastapi.testclient import TestClient

import main
import github_auth
import ntro_auth
from github_auth import normalize_repo


def _client():
    return TestClient(main.app, raise_server_exceptions=False)


def _ntro_login(client, employee_id="NTRO-DEMO-001", password="demo-ntro-001"):
    return client.post("/ntro/login", json={"employee_id": employee_id, "password": password})


def _ntro_headers(client):
    resp = _ntro_login(client)
    assert resp.status_code == 200, resp.text
    return {"X-NTRO-Token": resp.json()["token"]}


def _seed_github(employee_id="NTRO-DEMO-001", token="gho_test_token_xyz"):
    github_auth.save_authorization(
        employee_id, token, "repo",
        {"login": "octo", "id": 1, "type": "User"})


# ── NTRO authentication boundary ─────────────────────────────────────────────

def test_ntro_login_succeeds():
    client = _client()
    resp = _ntro_login(client)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token"].startswith("ntro_")
    assert body["employee"]["employee_id"] == "NTRO-DEMO-001"
    assert body["employee"]["department"]
    me = client.get("/ntro/me", headers={"X-NTRO-Token": body["token"]})
    assert me.status_code == 200


def test_ntro_invalid_employee_rejected():
    client = _client()
    resp = _ntro_login(client, employee_id="NTRO-NOBODY-999", password="whatever")
    assert resp.status_code == 401


def test_ntro_invalid_password_rejected():
    client = _client()
    resp = _ntro_login(client, password="wrong-password")
    assert resp.status_code == 401
    assert "wrong-password" not in resp.text


def test_ntro_inactive_employee_rejected():
    client = _client()
    resp = _ntro_login(client, employee_id="NTRO-DEMO-002", password="demo-ntro-002")
    assert resp.status_code == 401


def test_ntro_session_required_and_expiry():
    client = _client()
    assert client.get("/ntro/me").status_code == 401
    assert client.get("/github/status").status_code == 401
    expired = ntro_auth.mint_session_token("NTRO-DEMO-001", ttl=-1)
    assert client.get("/ntro/me", headers={"X-NTRO-Token": expired}).status_code == 401


# ── GitHub authorization: config + state validation ──────────────────────────

def test_github_unconfigured_reports_setup_error(monkeypatch):
    monkeypatch.delenv("GITHUB_CLIENT_ID", raising=False)
    monkeypatch.delenv("GITHUB_CLIENT_SECRET", raising=False)
    client = _client()
    assert client.get("/github/config").json()["configured"] is False
    headers = _ntro_headers(client)
    assert client.post("/github/login", headers=headers).status_code == 503
    assert client.get("/github/repos", headers=headers).status_code == 503


def test_github_state_validation_rejects_bad_and_reused(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    client = _client()
    # Unknown state → safe redirect, no exception, no token.
    r = client.get("/github/callback", params={"code": "x", "state": "bogus"}, follow_redirects=False)
    assert r.status_code == 302 and "github_error=invalid_state" in r.headers["location"]
    # Cancelled authorization (no code) → safe redirect.
    headers = _ntro_headers(client)
    login = client.post("/github/login", headers=headers)
    state = github_auth._states and next(iter(github_auth._states))
    assert login.status_code == 200 and state
    r = client.get("/github/callback", params={"state": state}, follow_redirects=False)
    assert r.status_code == 302 and "github_error=cancelled" in r.headers["location"]
    # Reused state → rejected (already consumed).
    r = client.get("/github/callback", params={"code": "x", "state": state}, follow_redirects=False)
    assert r.status_code == 302 and "github_error=invalid_state" in r.headers["location"]


def test_repo_metadata_normalization_keeps_safe_fields_only():
    repo = normalize_repo({
        "full_name": "octo/private-repo", "name": "private-repo",
        "owner": {"login": "octo"}, "private": True,
        "default_branch": "main", "html_url": "https://github.com/octo/private-repo",
        "token": "must-never-appear", "secret": "x",
    })
    assert repo == {"full_name": "octo/private-repo", "name": "private-repo",
                    "owner": "octo", "private": True,
                    "default_branch": "main",
                    "html_url": "https://github.com/octo/private-repo"}
    assert "token" not in json.dumps(repo)


def test_github_repos_come_from_github_not_hardcoded(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    client = _client()
    headers = _ntro_headers(client)
    _seed_github()
    fake = [{"full_name": "octo/real-private", "name": "real-private",
             "owner": {"login": "octo"}, "private": True, "default_branch": "main",
             "html_url": "https://github.com/octo/real-private"}]
    monkeypatch.setattr(github_auth, "github_get",
                        lambda *a, **kw: NS(status_code=200, json=lambda: fake))
    body = client.get("/github/repos", headers=headers).json()
    assert body["repos"][0]["full_name"] == "octo/real-private"
    assert body["repos"][0]["private"] is True


# ── Secure retrieval + scanner adapter (mocked) ──────────────────────────────

def _mock_pipeline(monkeypatch, tmp_path):
    async def semgrep(_):
        return {"results": [{"path": "app.py", "start": {"line": 1}, "end": {"line": 1},
                             "extra": {"metadata": {"algorithm": "RSA"}}}]}
    monkeypatch.setattr(main, "run_semgrep_scan", semgrep)
    monkeypatch.setattr(main, "clone_with_token",
                        lambda url, dest, token: dest.mkdir(parents=True))
    monkeypatch.setattr(main, "checkout_ref", lambda *a: None)
    monkeypatch.setattr(main, "resolve_commit_sha", lambda _: "a" * 40)


def test_inaccessible_repository_rejected(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    client = _client()
    headers = _ntro_headers(client)
    _seed_github()
    monkeypatch.setattr(main, "github_get",
                        lambda *a, **kw: NS(status_code=404, json=lambda: {"message": "Not Found"}))
    resp = client.post("/scan/github", headers=headers, json={"repository": "octo/nope"})
    assert resp.status_code == 404
    assert "gho_test_token_xyz" not in resp.text


def test_github_scan_uses_existing_pipeline_and_safe_provenance(monkeypatch, tmp_path):
    monkeypatch.delenv("ECDAT_API_KEY", raising=False)
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    client = _client()
    headers = _ntro_headers(client)
    _seed_github()
    _mock_pipeline(monkeypatch, tmp_path)
    monkeypatch.setattr(
        main, "github_get",
        lambda *a, **kw: NS(status_code=200,
                            json=lambda: {"full_name": "octo/private-repo",
                                          "default_branch": "main"}))
    resp = client.post("/scan/github", headers=headers,
                       json={"repository": "octo/private-repo", "ref": "main"})
    assert resp.status_code == 200, resp.text
    text = resp.text
    assert "gho_test_token_xyz" not in text  # token never in response/CBOM
    assert "GITHUB_CLIENT_SECRET" not in text
    bom = resp.json()
    name = bom["metadata"]["component"]["name"]
    assert name.startswith("github:octo/private-repo@")  # history-safe target
    coverage = json.loads(next(p["value"] for p in bom["properties"]
                               if p["name"] == "ecdat:coverage"))
    assert coverage[0]["sourceType"] == "github"
    assert coverage[0]["repository"] == "octo/private-repo"
    assert coverage[0]["commitSha"] == "a" * 40
    assert "token" not in json.dumps(coverage).lower()
    assert bom["components"], "existing scanner findings must flow through"


def test_github_scan_rejects_malicious_identifiers(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test-secret")
    client = _client()
    headers = _ntro_headers(client)
    _seed_github()
    for bad in ["../../etc", "https://github.com/o/r.git", "owner/", "", "o/r; rm -rf"]:
        assert client.post("/scan/github", headers=headers,
                           json={"repository": bad}).status_code == 400
    assert client.post("/scan/github", headers=headers,
                       json={"repository": "octo/r", "ref": "../../evil"}).status_code == 400


def test_local_scan_regression(monkeypatch, tmp_path):
    monkeypatch.delenv("ECDAT_API_KEY", raising=False)
    (tmp_path / "app.py").write_text("pass\n")

    async def semgrep(_):
        return {"results": []}
    monkeypatch.setattr(main, "run_semgrep_scan", semgrep)
    resp = _client().post("/scan", json={"target_directory": str(tmp_path)})
    assert resp.status_code == 200, resp.text
