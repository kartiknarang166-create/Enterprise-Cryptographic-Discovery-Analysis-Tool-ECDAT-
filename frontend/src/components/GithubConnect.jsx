/**
 * GithubConnect.jsx — REAL GitHub authorization + private repo selection.
 *
 *  - Tokens stay backend-only: this component only ever sees safe metadata
 *    (login, repo full_name, private flag, default_branch).
 *  - Repository list comes from GitHub (`GET /github/repos`), never hardcoded.
 *  - Analyze posts `{repository, ref}` to `POST /scan/github` with the NTRO
 *    session header; the backend validates everything server-side, clones
 *    into a temp workspace, and runs the EXISTING scanner.
 */
import { useCallback, useEffect, useState } from 'react'
import { GitBranch, AlertTriangle, CheckCircle, RefreshCw, Lock } from 'lucide-react'
import { NTRO_TOKEN_KEY, ntroHeaders, isValidRepoName, formatGithubTarget } from '../ntroGithub'
import { apiHeaders } from '../cbom'

const DS = {
  surfaceHigh: '#292932',
  onSurface: '#e4e1ed',
  outlineVar: '#464554',
  error: '#ffb4ab',
  primary: '#c0c1ff',
  secondary: '#4cd7f6',
  emerald: '#6ee7b7',
  muted: '#908fa0',
  violet: '#d8a2ff',
}

const PHASE_LABELS = [
  'Retrieving repository…',
  'Scanning repository…',
  'Building cryptographic inventory…',
  'Analyzing quantum risk…',
]

export default function GithubConnect({ apiBase, ntroToken, ntroEmployee, scanContext, sensitiveKeywords, onScanComplete, onNtroLogout }) {
  const [configured, setConfigured] = useState(null) // null=checking
  const [configMsg, setConfigMsg] = useState('')
  const [connected, setConnected] = useState(false)
  const [githubUser, setGithubUser] = useState(null)
  const [repos, setRepos] = useState([])
  const [selected, setSelected] = useState('')
  const [ref, setRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState(0)
  const [error, setError] = useState(null)
  const [elapsed, setElapsed] = useState(0)

  const headers = useCallback(() => ({ 'Content-Type': 'application/json', ...apiHeaders(), ...ntroHeaders(ntroToken) }), [ntroToken])

  const loadStatus = useCallback(async () => {
    setError(null)
    try {
      const cfg = await fetch(`${apiBase}/github/config`).then(r => r.json())
      setConfigured(cfg.configured === true)
      setConfigMsg(cfg.message || '')
      if (!cfg.configured) return
      const st = await fetch(`${apiBase}/github/status`, { headers: { ...apiHeaders(), ...ntroHeaders(ntroToken) } })
      if (st.status === 401) {
        sessionStorage.removeItem(NTRO_TOKEN_KEY)
        onNtroLogout()
        return
      }
      const sj = await st.json()
      setConnected(sj.connected === true)
      setGithubUser(sj.github_user || null)
      if (sj.connected) {
        const rj = await fetch(`${apiBase}/github/repos`, { headers: { ...apiHeaders(), ...ntroHeaders(ntroToken) } }).then(r => r.json())
        if (Array.isArray(rj.repos)) {
          setRepos(rj.repos)
          if (rj.repos.length > 0 && !selected) setSelected(rj.repos[0].full_name)
        }
      }
    } catch {
      setError('Could not reach the ECDAT backend.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, ntroToken])

  useEffect(() => { loadStatus() }, [loadStatus])

  // After the backend OAuth callback redirects back with ?github_connected=1
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('github_connected') === '1') {
      window.history.replaceState({}, '', window.location.pathname)
      loadStatus()
    }
    if (q.get('github_error')) {
      const map = {
        invalid_state: 'GitHub authorization expired or was reused. Please try Connect GitHub again.',
        cancelled: 'GitHub authorization was cancelled. Nothing was connected.',
        exchange_failed: 'GitHub authorization failed during token exchange. Try again.',
        user_failed: 'Connected to GitHub but could not read your account. Try again.',
      }
      setError(map[q.get('github_error')] || 'GitHub authorization failed. Try again.')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [loadStatus])

  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    setPhase(0)
    const t1 = setInterval(() => setElapsed(s => s + 1), 1000)
    const t2 = setInterval(() => setPhase(p => Math.min(p + 1, PHASE_LABELS.length - 1)), 12000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [loading])

  async function handleConnect() {
    setError(null)
    try {
      const res = await fetch(`${apiBase}/github/login`, { method: 'POST', headers: headers() })
      if (res.status === 401) { sessionStorage.removeItem(NTRO_TOKEN_KEY); onNtroLogout(); return }
      const body = await res.json()
      if (!res.ok) { setError(body.detail || 'GitHub connection failed.'); return }
      // REAL GitHub authorization — leave ECDAT for github.com.
      window.location.href = body.auth_url
    } catch {
      setError('Could not start GitHub authorization.')
    }
  }

  async function handleAnalyze() {
    setError(null)
    if (!isValidRepoName(selected)) { setError('Select a repository from the list.'); return }
    setLoading(true)
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 300_000)
    try {
      const res = await fetch(`${apiBase}/scan/github`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          repository: selected.trim(),
          ref: ref.trim() || null,
          context: scanContext,
          sensitive_keywords: sensitiveKeywords,
        }),
        signal: controller.signal,
      })
      clearTimeout(tid)
      if (res.status === 401) { sessionStorage.removeItem(NTRO_TOKEN_KEY); onNtroLogout(); return }
      if (!res.ok) {
        let detail = `Scan failed (HTTP ${res.status})`
        try { const b = await res.json(); detail = b.detail || detail } catch { /* non-JSON */ }
        setError(detail)
        return
      }
      const bom = await res.json()
      const repo = selected.trim()
      const sha = bom?.metadata?.component?.name?.split('@')[1] || ''
      onScanComplete(bom, formatGithubTarget(repo, sha))
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Scan timed out. Try a smaller repository.' : 'Scan failed. Check the backend and try again.')
    } finally {
      clearTimeout(tid)
      setLoading(false)
    }
  }

  return (
    <div>
      {/* NTRO identity badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        padding: '8px 12px', borderRadius: 6,
        background: `${DS.secondary}08`, border: `1px solid ${DS.secondary}25`,
      }}>
        <span style={{ fontSize: 12, color: DS.onSurface }}>
          <strong>NTRO Employee</strong> {ntroEmployee?.employee_id} · {ntroEmployee?.department}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
          background: `${DS.secondary}18`, color: DS.secondary,
          border: `1px solid ${DS.secondary}40`,
        }}>
          DEMO / PROTOTYPE
        </span>
        <button
          onClick={async () => {
            try { await fetch(`${apiBase}/github/logout`, { method: 'POST', headers: headers() }) } catch { /* best effort */ }
            sessionStorage.removeItem(NTRO_TOKEN_KEY)
            onNtroLogout()
          }}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: DS.muted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Sign out
        </button>
      </div>

      {configured === false && (
        <div style={{
          display: 'flex', gap: 8, padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          background: `${DS.error}08`, border: `1px solid ${DS.error}30`,
          fontSize: 12, color: DS.muted, lineHeight: 1.5,
        }}>
          <AlertTriangle size={13} color={DS.error} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><strong style={{ color: DS.error }}>GitHub not configured.</strong> {configMsg} Local scanning still works.</span>
        </div>
      )}

      {!connected ? (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, color: DS.muted, marginBottom: 8 }}>GitHub — Not connected</div>
          <button
            id="btn-github-connect"
            onClick={handleConnect}
            disabled={configured === false}
            title={configured === false ? 'Set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET on the backend first' : 'Authorize via github.com (tokens stay on the backend)'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px',
              borderRadius: 6, border: `1px solid ${DS.secondary}40`,
              background: configured === false ? 'transparent' : `${DS.secondary}14`,
              color: configured === false ? DS.muted : DS.secondary,
              fontSize: 13, fontWeight: 700,
              cursor: configured === false ? 'not-allowed' : 'pointer',
              opacity: configured === false ? 0.5 : 1,
            }}
          >
            <GitBranch size={13} />
            Connect GitHub
          </button>
          <p style={{ fontSize: 11, color: DS.muted, marginTop: 8 }}>
            Real GitHub authorization. ECDAT never asks for passwords, PATs, or SSH keys.
          </p>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, color: DS.emerald }}>
            <CheckCircle size={13} />
            GitHub — Connected ✓ {githubUser?.login ? `· ${githubUser.login}` : ''}
            <button
              onClick={loadStatus}
              title="Refresh repository list from GitHub"
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: DS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
            >
              <RefreshCw size={11} /> Refresh
            </button>
          </div>

          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted, marginBottom: 6 }}>
            Repository — select private repository
          </label>
          <select
            id="github-repo-select"
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{
              width: '100%', background: DS.surfaceHigh, border: `1px solid ${DS.outlineVar}`,
              borderRadius: 6, color: DS.onSurface, fontSize: 13,
              padding: '9px 10px', outline: 'none', boxSizing: 'border-box', marginBottom: 10,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {repos.length === 0 && <option value="">No repositories found</option>}
            {repos.map(r => (
              <option key={r.full_name} value={r.full_name}>
                {r.private ? '🔒' : '🌐'} {r.full_name}
              </option>
            ))}
          </select>

          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted, marginBottom: 6 }}>
            Ref <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional — branch / tag, default branch if empty)</span>
          </label>
          <input
            id="github-ref-input"
            type="text"
            value={ref}
            onChange={e => setRef(e.target.value)}
            placeholder="main"
            style={{
              width: '100%', background: DS.surfaceHigh, border: `1px solid ${DS.outlineVar}`,
              borderRadius: 6, color: DS.onSurface, fontSize: 13,
              padding: '9px 10px', outline: 'none', boxSizing: 'border-box', marginBottom: 12,
              fontFamily: "'JetBrains Mono', monospace",
            }}
            onFocus={e => (e.target.style.borderColor = DS.secondary)}
            onBlur={e => (e.target.style.borderColor = DS.outlineVar)}
          />

          <button
            id="btn-github-analyze"
            onClick={handleAnalyze}
            disabled={loading || !selected}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 6,
              background: loading || !selected ? '#374151' : '#f4f4f5', border: 'none',
              color: loading || !selected ? '#9ca3af' : '#09090b',
              fontSize: 14, fontWeight: 700, cursor: loading || !selected ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? PHASE_LABELS[phase] + (elapsed > 3 ? ` (${elapsed}s)` : '') : (
              <><Lock size={13} /> Analyze Repository</>
            )}
          </button>
        </div>
      )}

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderRadius: 4, background: `${DS.error}10`, border: `1px solid ${DS.error}40`,
          color: DS.error, fontSize: 12, marginTop: 12, fontFamily: "'JetBrains Mono', monospace",
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          {error}
        </div>
      )}
    </div>
  )
}
