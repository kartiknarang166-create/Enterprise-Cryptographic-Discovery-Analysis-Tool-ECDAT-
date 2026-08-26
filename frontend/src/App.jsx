import { useState, useCallback } from 'react'
import './index.css'

// ── Constants ──────────────────────────────────────────────────────────────
const API_URL = 'http://localhost:8000/scan'
const TARGET  = './dummy_target'

// ── Sub-components ─────────────────────────────────────────────────────────

function HeroShield() {
  return (
    <div className="relative flex items-center justify-center w-28 h-28 mx-auto mb-6">
      {/* Animated pulse rings */}
      <span
        className="absolute inset-0 rounded-full border-2 border-blue-400 opacity-30"
        style={{ animation: 'pulse-ring 2.4s ease-in-out infinite' }}
      />
      <span
        className="absolute inset-3 rounded-full border border-cyan-400 opacity-20"
        style={{ animation: 'pulse-ring 2.4s ease-in-out infinite 0.8s' }}
      />
      {/* Icon */}
      <div
        className="relative w-20 h-20 rounded-full flex items-center justify-center"
        style={{
          background: 'radial-gradient(circle, rgba(99,179,237,0.18) 0%, rgba(118,228,247,0.08) 100%)',
          border: '1.5px solid rgba(99,179,237,0.4)',
          boxShadow: '0 0 40px rgba(99,179,237,0.25), inset 0 0 20px rgba(99,179,237,0.08)',
        }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2L3 6V12C3 17 7.5 21.5 12 22C16.5 21.5 21 17 21 12V6L12 2Z"
            stroke="#63b3ed" strokeWidth="1.6" fill="rgba(99,179,237,0.1)"
          />
          <path
            d="M9 12L11 14L15 10"
            stroke="#76e4f7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}

function ScanButton({ onClick, loading }) {
  return (
    <button
      id="btn-run-scan"
      onClick={onClick}
      disabled={loading}
      className="relative overflow-hidden px-10 py-4 rounded-xl font-semibold text-sm tracking-widest uppercase transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: loading
          ? 'rgba(99,179,237,0.12)'
          : 'linear-gradient(135deg, rgba(99,179,237,0.22) 0%, rgba(118,228,247,0.14) 100%)',
        border: '1px solid rgba(99,179,237,0.45)',
        color: '#63b3ed',
        boxShadow: loading ? 'none' : '0 0 24px rgba(99,179,237,0.2), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
      onMouseEnter={e => {
        if (!loading) {
          e.currentTarget.style.boxShadow = '0 0 40px rgba(99,179,237,0.45), inset 0 1px 0 rgba(255,255,255,0.1)'
          e.currentTarget.style.border = '1px solid rgba(99,179,237,0.75)'
        }
      }}
      onMouseLeave={e => {
        if (!loading) {
          e.currentTarget.style.boxShadow = '0 0 24px rgba(99,179,237,0.2), inset 0 1px 0 rgba(255,255,255,0.06)'
          e.currentTarget.style.border = '1px solid rgba(99,179,237,0.45)'
        }
      }}
    >
      {loading ? (
        <span className="flex items-center gap-3">
          <svg
            className="w-4 h-4"
            style={{ animation: 'spin-slow 1s linear infinite' }}
            viewBox="0 0 24 24" fill="none"
          >
            <circle cx="12" cy="12" r="10" stroke="rgba(99,179,237,0.3)" strokeWidth="2" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="#63b3ed" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Scanning…
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="#63b3ed" strokeWidth="1.8"/>
            <path d="M21 21l-4.35-4.35" stroke="#63b3ed" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Run Cryptographic Scan
        </span>
      )}
    </button>
  )
}

function RiskBadge({ level }) {
  const isCritical = level === 'CRITICAL'
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wider uppercase"
      style={{
        background: isCritical ? 'rgba(252,129,129,0.15)' : 'rgba(104,211,145,0.15)',
        border: `1px solid ${isCritical ? 'rgba(252,129,129,0.5)' : 'rgba(104,211,145,0.5)'}`,
        color: isCritical ? '#fc8181' : '#68d391',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: isCritical ? '#fc8181' : '#68d391',
          boxShadow: `0 0 6px ${isCritical ? '#fc8181' : '#68d391'}`,
        }}
      />
      {level}
    </span>
  )
}

function SummaryBar({ summary }) {
  const pills = [
    { label: 'Total Findings', value: summary.total_findings, color: '#63b3ed' },
    { label: 'Critical',       value: summary.critical_count, color: '#fc8181' },
    { label: 'Low',            value: summary.low_count,      color: '#68d391' },
  ]
  return (
    <div className="flex flex-wrap gap-3 mb-6">
      {pills.map(p => (
        <div
          key={p.label}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg"
          style={{
            background: 'rgba(13,22,40,0.8)',
            border: `1px solid ${p.color}30`,
          }}
        >
          <span className="text-2xl font-black" style={{ color: p.color, fontVariantNumeric: 'tabular-nums' }}>
            {p.value}
          </span>
          <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>{p.label}</span>
        </div>
      ))}
    </div>
  )
}

function FindingCard({ component, index }) {
  const [expanded, setExpanded] = useState(false)
  const mosca   = component.mosca        || {}
  const rec     = component.recommendation || {}
  const evid    = (component.evidence?.occurrences || [])[0] || {}
  const isCrit  = mosca.risk_level === 'CRITICAL'

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-300"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${isCrit ? 'rgba(252,129,129,0.18)' : 'rgba(99,179,237,0.12)'}`,
        boxShadow: isCrit
          ? '0 4px 24px rgba(252,129,129,0.06)'
          : '0 4px 24px rgba(0,0,0,0.2)',
        animation: `fade-up 0.4s ease both`,
        animationDelay: `${index * 80}ms`,
      }}
    >
      {/* Card header */}
      <div
        className="flex items-start justify-between gap-4 p-5 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start gap-4 min-w-0">
          {/* Algorithm icon */}
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-black"
            style={{
              background: isCrit ? 'rgba(252,129,129,0.12)' : 'rgba(99,179,237,0.1)',
              border: `1px solid ${isCrit ? 'rgba(252,129,129,0.3)' : 'rgba(99,179,237,0.25)'}`,
              color: isCrit ? '#fc8181' : '#63b3ed',
            }}
          >
            {component.name?.slice(0, 3).toUpperCase() || '???'}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-bold text-sm" style={{ color: '#e2e8f0' }}>
                {component.name}
              </span>
              <RiskBadge level={mosca.risk_level || 'UNKNOWN'} />
              {component.cryptoProperties?.algorithmProperties?.primitive && (
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: 'rgba(183,148,244,0.12)', color: '#b794f4', border: '1px solid rgba(183,148,244,0.25)' }}
                >
                  {component.cryptoProperties.algorithmProperties.primitive}
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#94a3b8', maxWidth: 560 }}>
              {component.description?.slice(0, 120)}{component.description?.length > 120 ? '…' : ''}
            </p>
            {evid.location && (
              <p className="mt-1 text-xs font-mono" style={{ color: '#4a5568' }}>
                📁 {evid.location}
                {evid.line ? <span className="ml-2 text-blue-400">L{evid.line}</span> : null}
              </p>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        <svg
          className="flex-shrink-0 w-4 h-4 mt-1 transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', color: '#4a5568' }}
          viewBox="0 0 24 24" fill="none"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div
          className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4"
          style={{ borderTop: '1px solid rgba(99,179,237,0.08)' }}
        >
          {/* Mosca panel */}
          <div
            className="p-4 rounded-lg"
            style={{ background: 'rgba(8,12,20,0.6)', border: '1px solid rgba(99,179,237,0.1)' }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#63b3ed' }}>
              ⚛ Mosca's Theorem
            </h4>
            <div className="space-y-1.5 text-xs font-mono" style={{ color: '#94a3b8' }}>
              <div className="flex justify-between">
                <span>X (data sensitivity, yrs)</span>
                <span className="text-blue-300 font-bold">{mosca.x_years_data_sensitivity}</span>
              </div>
              <div className="flex justify-between">
                <span>Y (migration time, yrs)</span>
                <span className="text-blue-300 font-bold">{mosca.y_years_migration_time}</span>
              </div>
              <div className="flex justify-between">
                <span>Z (CRQC arrival, yrs)</span>
                <span className="text-blue-300 font-bold">{mosca.z_years_until_crqc}</span>
              </div>
              <div
                className="mt-2 pt-2 flex justify-between font-bold"
                style={{ borderTop: '1px solid rgba(99,179,237,0.12)', color: isCrit ? '#fc8181' : '#68d391' }}
              >
                <span>{mosca.equation}</span>
              </div>
            </div>
          </div>

          {/* Recommendation panel */}
          <div
            className="p-4 rounded-lg"
            style={{ background: 'rgba(8,12,20,0.6)', border: '1px solid rgba(183,148,244,0.12)' }}
          >
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#b794f4' }}>
              🔐 PQC Migration
            </h4>
            <p className="text-xs font-bold mb-1" style={{ color: '#e2e8f0' }}>{rec.action}</p>
            <p className="text-xs mb-2" style={{ color: '#94a3b8' }}>{rec.pqc_algorithm}</p>
            <p className="text-xs italic" style={{ color: '#4a5568' }}>{rec.rationale}</p>
            {rec.pqc_standard && rec.pqc_standard !== 'N/A (Classical)' && (
              <span
                className="mt-2 inline-block px-2 py-0.5 rounded text-xs font-bold"
                style={{ background: 'rgba(183,148,244,0.12)', color: '#b794f4', border: '1px solid rgba(183,148,244,0.3)' }}
              >
                {rec.pqc_standard}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RawJsonViewer({ data }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="mt-6 rounded-xl overflow-hidden"
      style={{ border: '1px solid rgba(99,179,237,0.1)' }}
    >
      <button
        id="btn-toggle-raw"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-semibold uppercase tracking-wider transition-colors duration-150"
        style={{
          background: 'rgba(13,22,40,0.9)',
          color: '#4a5568',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#63b3ed' }}
        onMouseLeave={e => { e.currentTarget.style.color = '#4a5568' }}
      >
        <span className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M16 18L22 12L16 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 6L2 12L8 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Raw CycloneDX 1.6 JSON
        </span>
        <svg
          className="w-4 h-4 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          viewBox="0 0 24 24" fill="none"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <pre
          id="raw-cyclonedx-output"
          className="p-5 overflow-x-auto text-xs leading-relaxed"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            background: '#080c14',
            color: '#68d391',
            maxHeight: 560,
            overflowY: 'auto',
          }}
        >
          <code>{JSON.stringify(data, null, 2)}</code>
        </pre>
      )}
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [bom,     setBom]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    setBom(null)

    try {
      const res = await fetch(API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_directory: TARGET }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setBom(data)
    } catch (err) {
      setError(err.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  const components = bom?.components || []

  return (
    <div className="min-h-screen" style={{ background: 'var(--gradient-hero)' }}>
      {/* ── Ambient background blobs ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #63b3ed, transparent 70%)' }}
        />
        <div
          className="absolute top-1/3 -right-32 w-80 h-80 rounded-full opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #b794f4, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-1/3 w-64 h-64 rounded-full opacity-[0.03]"
          style={{ background: 'radial-gradient(circle, #76e4f7, transparent 70%)' }}
        />
      </div>

      {/* ── Navigation ── */}
      <nav
        className="sticky top-0 z-50 px-8 py-4 flex items-center justify-between"
        style={{
          background: 'rgba(8,12,20,0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(99,179,237,0.08)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(99,179,237,0.12)', border: '1px solid rgba(99,179,237,0.3)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 6V12C3 17 7.5 21.5 12 22C16.5 21.5 21 17 21 12V6L12 2Z"
                stroke="#63b3ed" strokeWidth="1.6" fill="rgba(99,179,237,0.08)" />
            </svg>
          </div>
          <span className="font-black text-sm tracking-widest uppercase" style={{ color: '#e2e8f0' }}>ECDAT</span>
          <span
            className="px-2 py-0.5 rounded text-xs font-bold"
            style={{ background: 'rgba(99,179,237,0.1)', color: '#63b3ed', border: '1px solid rgba(99,179,237,0.2)' }}
          >
            v1.0
          </span>
        </div>
        <span className="text-xs" style={{ color: '#4a5568' }}>
          Enterprise Cryptographic Discovery &amp; Analysis
        </span>
      </nav>

      {/* ── Main content ── */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 py-16">
        {/* Hero */}
        <header className="text-center mb-14" style={{ animation: 'fade-up 0.6s ease both' }}>
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
          <p className="text-base mb-2 max-w-xl mx-auto" style={{ color: '#94a3b8' }}>
            AST-level scanning with Semgrep · CycloneDX 1.6 output ·{' '}
            <span style={{ color: '#b794f4' }}>Mosca's Theorem</span> risk scoring ·{' '}
            <span style={{ color: '#63b3ed' }}>NIST FIPS 203/204</span> recommendations
          </p>

          {/* Target badge */}
          <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-xs font-mono"
            style={{ background: 'rgba(13,22,40,0.8)', border: '1px solid rgba(99,179,237,0.12)', color: '#4a5568' }}>
            <span style={{ color: '#63b3ed' }}>POST</span>
            <span style={{ color: '#94a3b8' }}>localhost:8000/scan</span>
            <span>→</span>
            <span style={{ color: '#68d391' }}>{TARGET}</span>
          </div>

          <div className="mt-8">
            <ScanButton onClick={runScan} loading={loading} />
          </div>
        </header>

        {/* Error state */}
        {error && (
          <div
            id="scan-error"
            className="mb-8 p-5 rounded-xl flex items-start gap-4"
            style={{
              background: 'rgba(252,129,129,0.06)',
              border: '1px solid rgba(252,129,129,0.25)',
              animation: 'fade-up 0.3s ease both',
            }}
          >
            <svg className="flex-shrink-0 mt-0.5" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#fc8181" strokeWidth="1.6" />
              <path d="M12 8v4M12 16h.01" stroke="#fc8181" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <div>
              <p className="font-semibold text-sm mb-1" style={{ color: '#fc8181' }}>Scan Failed</p>
              <p className="text-xs" style={{ color: '#94a3b8' }}>{error}</p>
              <p className="text-xs mt-1" style={{ color: '#4a5568' }}>
                Make sure the FastAPI server is running on port 8000 and Semgrep is installed.
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {bom && (
          <section id="scan-results" style={{ animation: 'fade-up 0.5s ease both' }}>
            {/* Spec badge */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold mb-1" style={{ color: '#e2e8f0' }}>Scan Results</h2>
                <p className="text-xs" style={{ color: '#4a5568' }}>
                  Serial: <span className="font-mono" style={{ color: '#63b3ed' }}>{bom.serialNumber}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(118,228,247,0.08)', border: '1px solid rgba(118,228,247,0.2)', color: '#76e4f7' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 0 0 1.946-.806 3.42 3.42 0 0 1 4.438 0 3.42 3.42 0 0 0 1.946.806 3.42 3.42 0 0 1 3.138 3.138 3.42 3.42 0 0 0 .806 1.946 3.42 3.42 0 0 1 0 4.438 3.42 3.42 0 0 0-.806 1.946 3.42 3.42 0 0 1-3.138 3.138 3.42 3.42 0 0 0-1.946.806 3.42 3.42 0 0 1-4.438 0 3.42 3.42 0 0 0-1.946-.806 3.42 3.42 0 0 1-3.138-3.138 3.42 3.42 0 0 0-.806-1.946 3.42 3.42 0 0 1 0-4.438 3.42 3.42 0 0 0 .806-1.946 3.42 3.42 0 0 1 3.138-3.138z"
                    stroke="currentColor" strokeWidth="1.6" />
                </svg>
                CycloneDX {bom.specVersion}
              </div>
            </div>

            <SummaryBar summary={bom.summary} />

            {components.length === 0 ? (
              <div className="text-center py-16" style={{ color: '#4a5568' }}>
                <p className="text-4xl mb-3">✅</p>
                <p className="font-semibold">No cryptographic vulnerabilities detected.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {components.map((comp, i) => (
                  <FindingCard key={comp['bom-ref'] || i} component={comp} index={i} />
                ))}
              </div>
            )}

            <RawJsonViewer data={bom} />
          </section>
        )}

        {/* Empty state */}
        {!bom && !loading && !error && (
          <div
            className="text-center py-20"
            style={{ animation: 'fade-up 0.6s ease 0.3s both' }}
          >
            <div className="mx-auto mb-4 w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(13,22,40,0.8)', border: '1px solid rgba(99,179,237,0.1)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="#4a5568" strokeWidth="1.5"/>
                <path d="M21 21l-4.35-4.35" stroke="#4a5568" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="font-semibold" style={{ color: '#4a5568' }}>
              Click <span style={{ color: '#63b3ed' }}>Run Cryptographic Scan</span> to analyse {TARGET}
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
          ECDAT · Enterprise Cryptographic Discovery &amp; Analysis Tool · Hackathon Build
        </p>
      </footer>
    </div>
  )
}
