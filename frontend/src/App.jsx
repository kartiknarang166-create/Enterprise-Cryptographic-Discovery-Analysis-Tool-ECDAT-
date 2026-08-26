/**
 * App.jsx  —  ECDAT Frontend Entry Point
 *
 * Features:
 *  • Backend status indicator  (polls GET /health every 15 s)
 *  • Editable target_directory input (default: ./dummy_target)
 *  • POST /scan with strict try/catch — exact error rendered on screen
 *  • Dashboard (RiskChart + InventoryTable) rendered on success
 *  • Collapsible Raw CycloneDX JSON viewer
 *
 * Note: ERR_CONNECTION_REFUSED in the browser console is expected when the
 * FastAPI server is not running. Start it with:
 *   cd backend && python -m uvicorn main:app --reload
 */
import { useState, useCallback, useEffect } from 'react'
import { Shield, Search, AlertCircle, ChevronDown, Code2, Activity } from 'lucide-react'
import Dashboard from './components/Dashboard'
import './index.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE    = 'http://localhost:8000'
const SCAN_URL    = `${API_BASE}/scan`
const HEALTH_URL  = `${API_BASE}/health`   // dedicated liveness endpoint, not /docs
const DEFAULT_DIR = './dummy_target'
const HEALTH_POLL_MS = 15_000              // poll every 15 s to keep console quiet

// ── Backend Status Dot ────────────────────────────────────────────────────────
function BackendStatus({ status }) {
  const configs = {
    checking: { color: '#f6ad55', label: 'Checking…',  glow: '#f6ad5560' },
    online:   { color: '#68d391', label: 'API Online',  glow: '#68d39160' },
    offline:  { color: '#fc8181', label: 'API Offline', glow: '#fc818160' },
  }
  const c = configs[status] || configs.checking

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(13,22,40,0.7)', border: `1px solid ${c.color}25` }}>
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          background: c.color,
          boxShadow: `0 0 8px ${c.glow}`,
          animation: status === 'online' ? 'pulse-ring 2s ease-in-out infinite' : 'none',
        }}
      />
      <span className="text-xs font-medium" style={{ color: c.color }}>{c.label}</span>
    </div>
  )
}

// ── Hero Shield ───────────────────────────────────────────────────────────────
function HeroShield() {
  return (
    <div className="relative flex items-center justify-center w-28 h-28 mx-auto mb-6">
      <span className="absolute inset-0 rounded-full border-2 border-blue-400 opacity-20" style={{ animation: 'pulse-ring 2.4s ease-in-out infinite' }} />
      <span className="absolute inset-3 rounded-full border border-cyan-400 opacity-15" style={{ animation: 'pulse-ring 2.4s ease-in-out infinite 0.9s' }} />
      <div
        className="relative w-20 h-20 rounded-full flex items-center justify-center"
        style={{
          background: 'radial-gradient(circle, rgba(99,179,237,0.18) 0%, rgba(118,228,247,0.06) 100%)',
          border: '1.5px solid rgba(99,179,237,0.38)',
          boxShadow: '0 0 48px rgba(99,179,237,0.22), inset 0 0 20px rgba(99,179,237,0.07)',
        }}
      >
        <Shield size={34} color="#63b3ed" strokeWidth={1.5} />
      </div>
    </div>
  )
}

// ── Raw JSON Viewer ───────────────────────────────────────────────────────────
function RawJsonViewer({ data }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-6 rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(99,179,237,0.1)' }}>
      <button
        id="btn-toggle-raw"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-semibold uppercase tracking-wider transition-colors duration-150 group"
        style={{ background: 'rgba(8,12,20,0.9)', color: '#4a5568' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#63b3ed')}
        onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
      >
        <span className="flex items-center gap-2">
          <Code2 size={14} />
          Raw CycloneDX 1.6 JSON
        </span>
        <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <pre
          id="raw-cyclonedx-output"
          className="p-5 overflow-x-auto text-xs leading-relaxed"
          style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            background: '#060a10',
            color: '#68d391',
            maxHeight: 520,
            overflowY: 'auto',
          }}
        >
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      )}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [targetDir,     setTargetDir]     = useState(DEFAULT_DIR)
  const [bom,           setBom]           = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)

  // ── Poll backend health ────────────────────────────────────────────────────
  // Uses GET /health (JSON liveness probe). ERR_CONNECTION_REFUSED in the
  // browser devtools Network tab is expected when the backend is stopped —
  // the browser always logs refused connections even when caught in try/catch.
  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const r = await fetch(HEALTH_URL, {
          method: 'GET',
          mode: 'cors',
          signal: AbortSignal.timeout(4000),
        })
        if (!cancelled) setBackendStatus(r.ok ? 'online' : 'offline')
      } catch {
        // Network error / refused — backend is down
        if (!cancelled) setBackendStatus('offline')
      }
    }

    check()                                        // immediate first check
    const id = setInterval(check, HEALTH_POLL_MS)  // then every 15 s
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // ── Run scan ───────────────────────────────────────────────────────────────
  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    setBom(null)

    try {
      const res = await fetch(SCAN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_directory: targetDir.trim() || DEFAULT_DIR }),
      })

      if (!res.ok) {
        let detail = `HTTP ${res.status} ${res.statusText}`
        try {
          const body = await res.json()
          detail = body.detail || body.message || detail
        } catch { /* keep the status-line fallback */ }
        throw new Error(detail)
      }

      const data = await res.json()
      setBom(data)
    } catch (err) {
      // Exact error message rendered on screen (network failures, CORS, API errors)
      setError(err.message || 'Unknown error — check the browser console for details.')
    } finally {
      setLoading(false)
    }
  }, [targetDir])

  const handleKeyDown = (e) => { if (e.key === 'Enter') runScan() }

  return (
    <div className="min-h-screen" style={{ background: 'var(--gradient-hero)' }}>

      {/* Ambient blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #63b3ed, transparent 70%)' }} />
        <div className="absolute top-1/3 -right-32 w-80 h-80 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, #b794f4, transparent 70%)' }} />
        <div className="absolute bottom-0 left-1/3 w-64 h-64 rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #76e4f7, transparent 70%)' }} />
      </div>

      {/* ── Navbar ── */}
      <nav
        className="sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between"
        style={{
          background: 'rgba(8,12,20,0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(99,179,237,0.08)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,179,237,0.12)', border: '1px solid rgba(99,179,237,0.28)' }}>
            <Shield size={16} color="#63b3ed" strokeWidth={1.6} />
          </div>
          <span className="font-black text-sm tracking-widest uppercase" style={{ color: '#e2e8f0' }}>ECDAT</span>
          <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(99,179,237,0.1)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.2)' }}>v1.0</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs" style={{ color: '#4a5568' }}>
            <Activity size={12} />
            <span>localhost:8000</span>
          </div>
          <BackendStatus status={backendStatus} />
        </div>
      </nav>

      {/* ── Main ── */}
      <main className="relative z-10 max-w-6xl mx-auto px-6 py-14">

        {/* Hero */}
        <header className="text-center mb-12" style={{ animation: 'fade-up 0.6s ease both' }}>
          <HeroShield />

          <h1
            className="text-4xl md:text-5xl font-black mb-4 leading-tight"
            style={{
              background: 'linear-gradient(135deg, #e2e8f0 0%, #63b3ed 50%, #76e4f7 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Cryptographic Discovery
          </h1>
          <p className="text-sm mb-8 max-w-xl mx-auto leading-relaxed" style={{ color: '#94a3b8' }}>
            AST-level scanning with Semgrep · CycloneDX 1.6 ·{' '}
            <span style={{ color: '#b794f4' }}>Mosca's Theorem</span> risk scoring ·{' '}
            <span style={{ color: '#63b3ed' }}>NIST FIPS 203/204</span> migration
          </p>

          {/* Target directory input + Scan button */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-lg mx-auto">
            <div
              className="relative flex-1 w-full"
              style={{ filter: 'drop-shadow(0 0 12px rgba(99,179,237,0.08))' }}
            >
              <input
                id="input-target-directory"
                type="text"
                value={targetDir}
                onChange={e => setTargetDir(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="./dummy_target"
                className="w-full px-4 py-3 rounded-xl text-sm font-mono outline-none transition-all duration-200"
                style={{
                  background: 'rgba(13,22,40,0.9)',
                  border: '1px solid rgba(99,179,237,0.2)',
                  color: '#68d391',
                  caretColor: '#63b3ed',
                }}
                onFocus={e => (e.target.style.border = '1px solid rgba(99,179,237,0.55)')}
                onBlur={e  => (e.target.style.border = '1px solid rgba(99,179,237,0.2)')}
              />
            </div>

            <button
              id="btn-run-scan"
              onClick={runScan}
              disabled={loading || backendStatus === 'offline'}
              className="flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-semibold tracking-wider uppercase transition-all duration-200 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: loading
                  ? 'rgba(99,179,237,0.1)'
                  : 'linear-gradient(135deg, rgba(99,179,237,0.2) 0%, rgba(118,228,247,0.12) 100%)',
                border: '1px solid rgba(99,179,237,0.4)',
                color: '#63b3ed',
                boxShadow: loading ? 'none' : '0 0 20px rgba(99,179,237,0.18)',
              }}
              onMouseEnter={e => { if (!loading) { e.currentTarget.style.boxShadow = '0 0 36px rgba(99,179,237,0.4)'; e.currentTarget.style.borderColor = 'rgba(99,179,237,0.7)' } }}
              onMouseLeave={e => { if (!loading) { e.currentTarget.style.boxShadow = '0 0 20px rgba(99,179,237,0.18)'; e.currentTarget.style.borderColor = 'rgba(99,179,237,0.4)' } }}
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4" style={{ animation: 'spin-slow 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(99,179,237,0.25)" strokeWidth="2" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#63b3ed" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Scanning…
                </>
              ) : (
                <>
                  <Search size={15} />
                  Run Scan
                </>
              )}
            </button>
          </div>

          {/* API endpoint badge */}
          <div
            className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-lg text-xs font-mono"
            style={{ background: 'rgba(13,22,40,0.7)', border: '1px solid rgba(99,179,237,0.1)', color: '#4a5568' }}
          >
            <span style={{ color: '#63b3ed' }}>POST</span>
            <span style={{ color: '#94a3b8' }}>localhost:8000/scan</span>
            <span>→</span>
            <span style={{ color: '#68d391' }}>{targetDir || DEFAULT_DIR}</span>
          </div>
        </header>

        {/* ── Error banner ── */}
        {error && (
          <div
            id="scan-error"
            className="mb-8 p-5 rounded-2xl flex items-start gap-4"
            style={{
              background: 'rgba(252,129,129,0.06)',
              border: '1px solid rgba(252,129,129,0.28)',
              animation: 'fade-up 0.3s ease both',
            }}
          >
            <AlertCircle size={18} color="#fc8181" className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm mb-1" style={{ color: '#fc8181' }}>Scan Failed</p>
              <p className="text-xs leading-relaxed font-mono" style={{ color: '#e2e8f0' }}>{error}</p>
              <p className="text-xs mt-2" style={{ color: '#4a5568' }}>
                Ensure the FastAPI server is running on port 8000 and Semgrep is installed.
              </p>
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {bom && (
          <>
            <Dashboard bom={bom} />
            <RawJsonViewer data={bom} />
          </>
        )}

        {/* ── Empty state ── */}
        {!bom && !loading && !error && (
          <div className="text-center py-20" style={{ animation: 'fade-up 0.6s ease 0.3s both' }}>
            <div
              className="mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(13,22,40,0.8)', border: '1px solid rgba(99,179,237,0.1)' }}
            >
              <Search size={28} color="#4a5568" strokeWidth={1.5} />
            </div>
            <p className="font-semibold" style={{ color: '#4a5568' }}>
              Enter a target directory and click{' '}
              <span style={{ color: '#63b3ed' }}>Run Scan</span>
            </p>
            <p className="text-xs mt-1" style={{ color: '#2d3748' }}>
              Semgrep · CycloneDX 1.6 · Mosca's Theorem · NIST FIPS 203/204
            </p>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 text-center pb-10" style={{ color: '#2d3748' }}>
        <p className="text-xs">
          ECDAT · Enterprise Cryptographic Discovery &amp; Analysis Tool · v1.0
        </p>
      </footer>
    </div>
  )
}
