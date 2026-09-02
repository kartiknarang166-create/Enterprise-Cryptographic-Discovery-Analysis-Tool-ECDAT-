/**
 * App.jsx — ECDAT v1.0-pqc
 * Orchestrates two views:
 *   1. Landing Page (LandingPage.jsx) — default
 *   2. Analytics Dashboard — shown after a successful scan
 *
 * Key wiring:
 *  - Landing scan result → setBom → setView('dashboard')
 *  - "∧" footer button → toggles CycloneDX JSON overlay drawer
 *  - activeInventoryFilter lifted to App so AlgoChart mirrors InventoryTable filter
 *  - DESIGN.md tokens throughout
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Shield, Wifi, Bell, Download, X,
  Database, AlertTriangle, CheckCircle, Zap, Home,
} from 'lucide-react'
import LandingPage    from './components/LandingPage'
import InventoryTable from './components/InventoryTable'
import AlgoChart      from './components/AlgoChart'
import MoscaWidget    from './components/MoscaWidget'
import './index.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE       = 'http://localhost:8000'
const HEALTH_URL     = `${API_BASE}/health`
const HEALTH_POLL_MS = 15_000
const DEFAULT_DIR    = './dummy_target'

// ── DESIGN.md semantic tokens ──────────────────────────────────────────────────
const DS = {
  bg:           '#13131b',
  surfaceLow:   '#1b1b23',
  surfaceHigh:  '#292932',
  surfaceBright:'#393841',
  onSurface:    '#e4e1ed',
  onVariant:    '#c7c4d7',
  outline:      '#908fa0',
  outlineVar:   '#464554',
  error:        '#ffb4ab',
  errorCont:    '#93000a',
  tertiary:     '#ffb783',
  primary:      '#c0c1ff',
  secondary:    '#4cd7f6',
  emerald:      '#6ee7b7',
  muted:        '#908fa0',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function summarise(bom) {
  const components = bom?.components || []
  const summary    = bom?.summary    || {}
  const total      = summary.total_findings ?? components.length
  const critical   = summary.critical_count ??
    components.filter(c => c.mosca?.risk_level === 'CRITICAL').length
  return { total, critical, components, hasExposure: critical > 0 }
}

function moscaDefaults(components) {
  const first = components.find(c => c.mosca?.risk_level === 'CRITICAL') || components[0]
  if (!first?.mosca) return { x: 20, y: 5, z: 10 }
  return {
    x: first.mosca.x_years_data_sensitivity || 5,
    y: first.mosca.y_years_migration_time    || 3,
    z: first.mosca.z_years_until_crqc        || 7,
  }
}

// ── NavTab ────────────────────────────────────────────────────────────────────
function NavTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? DS.onSurface : DS.muted,
        borderBottom: active ? `2px solid ${DS.primary}` : '2px solid transparent',
        paddingBottom: 10,
        paddingTop: 12,
        background: 'none',
        border: 'none',
        borderBottom: active ? `2px solid ${DS.primary}` : '2px solid transparent',
        cursor: 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = DS.onVariant }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = DS.muted }}
    >
      {label}
    </button>
  )
}

// ── SummaryCard ───────────────────────────────────────────────────────────────
function SummaryCard({
  title, subtitle, value, valueColor,
  icon: Icon, leftAccent,
  tag, tagBg, tagColor,
  children,
}) {
  const borderLeft = leftAccent
    ? `2px solid ${leftAccent}`
    : `1px solid ${DS.outlineVar}`

  return (
    <div
      style={{
        background: DS.surfaceLow,
        borderLeft,
        borderTop:    `1px solid ${DS.outlineVar}`,
        borderRight:  `1px solid ${DS.outlineVar}`,
        borderBottom: `1px solid ${DS.outlineVar}`,
        borderRadius: 4,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 90,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {Icon && <Icon size={13} style={{ color: leftAccent || DS.muted, flexShrink: 0 }} />}
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: DS.muted }}>
            {title}
          </span>
        </div>
        {tag && (
          <span
            style={{
              fontSize: 10, fontWeight: 700,
              padding: '2px 8px', borderRadius: 9999,
              background: tagBg, color: tagColor,
              flexShrink: 0, lineHeight: '16px',
            }}
          >
            {tag}
          </span>
        )}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: valueColor || DS.onSurface, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: DS.muted, marginTop: 2 }}>{subtitle}</div>
      {children}
    </div>
  )
}

// ── CycloneDX JSON Drawer Overlay ─────────────────────────────────────────────
function CycloneDXDrawer({ bom, onClose }) {
  const json = useMemo(() => JSON.stringify(bom, null, 2), [bom])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.65)',
          zIndex: 200,
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Drawer panel — slides up from bottom */}
      <div
        style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          height: '70vh',
          background: DS.surfaceLow,
          borderTop: `2px solid ${DS.primary}60`,
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.25s ease',
        }}
      >
        {/* Drawer header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px',
            borderBottom: `1px solid ${DS.outlineVar}`,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, color: DS.onSurface }}>&lt;&gt;</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: DS.onSurface }}>
              CycloneDX 1.6 CBOM — Full Schema Output
            </span>
            {bom?.serialNumber && (
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11, color: DS.muted,
                  background: DS.surfaceHigh,
                  padding: '2px 8px', borderRadius: 4,
                }}
              >
                {bom.serialNumber}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: DS.muted, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* JSON content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          <pre
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              lineHeight: 1.6,
              color: DS.onVariant,
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {json}
          </pre>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view,        setView]        = useState('landing')   // 'landing' | 'dashboard'
  const [apiStatus,   setApiStatus]   = useState('checking')
  const [targetDir,   setTargetDir]   = useState(DEFAULT_DIR)
  const [bom,         setBom]         = useState(null)
  const [activeTab,   setActiveTab]   = useState('Dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [bomDrawerOpen, setBomDrawerOpen] = useState(false)
  // Lifted filter state — keeps AlgoChart in sync with InventoryTable
  const [inventoryFilter, setInventoryFilter] = useState('All')

  // ── Health polling ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const r = await fetch(HEALTH_URL, { method: 'GET', signal: AbortSignal.timeout(4000) })
        if (!cancelled) setApiStatus(r.ok ? 'online' : 'offline')
      } catch {
        if (!cancelled) setApiStatus('offline')
      }
    }
    check()
    const id = setInterval(check, HEALTH_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // ── Called by LandingPage on successful scan ───────────────────────────────
  function handleScanComplete(result, dir) {
    setBom(result)
    setTargetDir(dir || DEFAULT_DIR)
    setView('dashboard')
    setInventoryFilter('All')
  }

  // ── In-dashboard re-scan ───────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_directory: targetDir.trim() || DEFAULT_DIR }),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status} ${res.statusText}`
        try { const b = await res.json(); detail = b.detail || b.message || detail } catch { /* ignore */ }
        throw new Error(detail)
      }
      setBom(await res.json())
      setInventoryFilter('All')
    } catch (err) {
      setError(err.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [targetDir])

  // ── Export ─────────────────────────────────────────────────────────────────
  function exportJson() {
    if (!bom) return
    const blob = new Blob([JSON.stringify(bom, null, 2)], { type: 'application/json' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'cyclonedx-bom.json',
    })
    a.click()
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const { total, critical, components, hasExposure } = useMemo(
    () => bom ? summarise(bom) : { total: 0, critical: 0, components: [], hasExposure: false },
    [bom]
  )
  const mosca = useMemo(() => moscaDefaults(components), [components])

  const apiCfg = {
    checking: { color: DS.tertiary,  label: 'Checking…'    },
    online:   { color: DS.emerald,   label: 'API Connected' },
    offline:  { color: DS.error,     label: 'API Offline'   },
  }[apiStatus]

  // ── Landing view ───────────────────────────────────────────────────────────
  if (view === 'landing') {
    return <LandingPage onScanComplete={handleScanComplete} />
  }

  // ── Dashboard view ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: DS.bg, fontFamily: 'Inter, sans-serif' }}>

      {/* ════════════ TOP HEADER BAR ════════════ */}
      <header
        id="app-header"
        style={{
          background: DS.surfaceLow,
          borderBottom: `1px solid ${DS.outlineVar}`,
          height: 44,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 16, flexShrink: 0 }}>
          <Shield size={15} color={DS.primary} strokeWidth={1.8} />
          <span style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: DS.onSurface }}>
            ECDAT
          </span>
          <span
            style={{
              fontSize: 10, fontWeight: 700,
              padding: '1px 6px', borderRadius: 9999,
              background: `${DS.primary}18`, color: DS.primary,
              border: `1px solid ${DS.primary}40`, lineHeight: '16px',
            }}
          >
            v1.0-pqc
          </span>
        </div>

        {/* Back to landing */}
        <button
          onClick={() => setView('landing')}
          title="Back to Home"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none',
            color: DS.muted, cursor: 'pointer',
            fontSize: 12, padding: '0 8px',
            borderRight: `1px solid ${DS.outlineVar}`,
            marginRight: 12,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = DS.onVariant)}
          onMouseLeave={e => (e.currentTarget.style.color = DS.muted)}
        >
          <Home size={13} />
          Home
        </button>

        {/* Directory input + Run */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 16, flexShrink: 0 }}>
          <input
            id="input-target-directory"
            type="text"
            value={targetDir}
            onChange={e => setTargetDir(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runScan()}
            style={{
              background: DS.surfaceHigh,
              border: `1px solid ${DS.outlineVar}`,
              borderRadius: 4,
              color: DS.secondary,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              padding: '3px 10px',
              width: 168,
              outline: 'none',
              caretColor: DS.primary,
              transition: 'border-color 0.15s',
            }}
            onFocus={e  => (e.target.style.borderColor = DS.primary)}
            onBlur={e   => (e.target.style.borderColor = DS.outlineVar)}
          />
          <button
            id="btn-run-scan"
            onClick={runScan}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 14px', borderRadius: 4,
              background: loading ? '#52525b' : '#f4f4f5',
              border: 'none',
              color: '#09090b',
              fontSize: 12, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'background 0.15s, opacity 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#e4e4e7' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#f4f4f5' }}
          >
            {loading ? (
              <svg style={{ width: 11, height: 11, animation: 'spin-slow 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#52525b" strokeWidth="2.5" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#09090b" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            ) : null}
            {loading ? 'Scanning…' : 'Run'}
          </button>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: 'flex', alignItems: 'stretch', gap: 24, flexShrink: 0 }}>
          {['Dashboard', 'Inventory', 'Policy', 'Compliance'].map(tab => (
            <NavTab key={tab} label={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)} />
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Right utilities */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* API status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: apiCfg.color,
                boxShadow: `0 0 5px ${apiCfg.color}`,
                display: 'inline-block',
                animation: apiStatus === 'online' ? 'pulse-dot 2s ease-in-out infinite' : 'none',
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 500, color: apiCfg.color }}>{apiCfg.label}</span>
          </div>

          {/* Export */}
          <button
            id="btn-export-json"
            onClick={exportJson}
            disabled={!bom}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 4,
              background: DS.surfaceHigh,
              border: `1px solid ${DS.outlineVar}`,
              color: bom ? DS.onVariant : DS.outline,
              fontSize: 12, fontWeight: 500,
              cursor: bom ? 'pointer' : 'not-allowed',
              opacity: bom ? 1 : 0.4,
              transition: 'border-color 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (bom) { e.currentTarget.style.borderColor = DS.primary; e.currentTarget.style.color = DS.onSurface } }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = DS.outlineVar; e.currentTarget.style.color = bom ? DS.onVariant : DS.outline }}
          >
            <Download size={11} />
            Export CycloneDX JSON
          </button>

          <Wifi size={14} color={DS.outline} />

          {/* Bell */}
          <div style={{ position: 'relative' }}>
            <Bell size={14} color={DS.outline} />
            {critical > 0 && (
              <span
                style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 14, height: 14, borderRadius: '50%',
                  background: DS.error, color: '#690005',
                  fontSize: 8, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {critical > 9 ? '9+' : critical}
              </span>
            )}
          </div>

          {/* Avatar */}
          <div
            style={{
              width: 24, height: 24, borderRadius: '50%',
              background: `${DS.primary}28`,
              border: `1px solid ${DS.primary}50`,
              color: DS.primary,
              fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            U
          </div>
        </div>
      </header>

      {/* ════════════ MAIN CONTENT ════════════ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px 0', gap: 12 }}>

        {/* Error banner */}
        {error && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', borderRadius: 4,
              background: `${DS.error}14`, border: `1px solid ${DS.error}50`,
              color: DS.error, fontSize: 12,
            }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{error}</span>
            <button
              onClick={() => setError(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: DS.outline, cursor: 'pointer', fontSize: 13 }}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── 4 Summary Cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, animation: 'fade-up 0.4s ease both' }}>
          <SummaryCard
            title="Total Cryptographic Assets"
            subtitle="Scanned from AST & Manifests"
            value={bom ? total : '—'}
            valueColor={DS.onSurface}
            icon={Database}
          />
          <SummaryCard
            title="Quantum-Critical Assets"
            subtitle="Immediate migration recommended"
            value={bom ? (critical > 0 ? `${critical} Critical` : '0 Critical') : '—'}
            valueColor={critical > 0 ? DS.error : DS.emerald}
            icon={AlertTriangle}
            leftAccent={DS.error}
            tag={bom && critical > 0 ? 'RSA/ECC' : undefined}
            tagBg={`${DS.error}1a`}
            tagColor={DS.error}
          />
          <SummaryCard
            title="CBOM Standard"
            subtitle="(cryptographic-asset)"
            value="CycloneDX v1.6"
            valueColor={DS.secondary}
            icon={CheckCircle}
          />
          {/* Mosca Card */}
          <div
            style={{
              background: DS.surfaceLow,
              borderLeft: `2px solid ${DS.tertiary}`,
              borderTop: `1px solid ${DS.outlineVar}`,
              borderRight: `1px solid ${DS.outlineVar}`,
              borderBottom: `1px solid ${DS.outlineVar}`,
              borderRadius: 4, padding: 14,
              display: 'flex', flexDirection: 'column', gap: 6, minHeight: 90,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={13} style={{ color: DS.tertiary }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: DS.muted }}>
                Mosca Exposure
              </span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: DS.onSurface, lineHeight: 1 }}>
              {hasExposure ? 'Active' : 'Low'}
            </div>
            <span
              style={{
                alignSelf: 'flex-start', fontSize: 10, fontWeight: 700,
                padding: '2px 8px', borderRadius: 9999, lineHeight: '16px',
                background: hasExposure ? `${DS.tertiary}1a` : `${DS.emerald}1a`,
                color: hasExposure ? DS.tertiary : DS.emerald,
              }}
            >
              {hasExposure ? 'Active Quantum Exposure' : 'Low Exposure'}
            </span>
            <div style={{ fontSize: 11, color: DS.muted }}>Harvest-Now-Decrypt-Later risk</div>
          </div>
        </div>

        {/* ── Stacked content ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', animation: 'fade-up 0.5s ease 0.1s both' }}>

          {/* Cryptographic Inventory */}
          <div
            style={{
              width: '100%', background: DS.surfaceLow,
              border: `1px solid ${DS.outlineVar}`, borderRadius: 4,
              padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <h2 style={{ fontSize: 14, fontWeight: 600, color: DS.onSurface }}>
              Cryptographic Inventory
            </h2>

            {/* Search */}
            <input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', background: DS.surfaceHigh,
                border: `1px solid ${DS.outlineVar}`, borderRadius: 4,
                color: DS.onSurface, padding: '6px 12px',
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />

            {!bom && (
              <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: DS.outline }}>
                <Shield size={28} strokeWidth={1.2} />
                <p style={{ fontSize: 12, textAlign: 'center' }}>Run a scan to see results</p>
              </div>
            )}

            {loading && (
              <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: DS.primary }}>
                <svg style={{ width: 18, height: 18, animation: 'spin-slow 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke={`${DS.primary}30`} strokeWidth="2" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke={DS.primary} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span style={{ fontSize: 12 }}>Scanning…</span>
              </div>
            )}

            {bom && !loading && (
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <InventoryTable
                  components={components}
                  searchQuery={searchQuery}
                  onFilterChange={setInventoryFilter}
                />
              </div>
            )}
          </div>

          {/* Algorithm Breakdown — mirrors inventory filter */}
          <div
            style={{
              width: '100%', background: DS.surfaceLow,
              border: `1px solid ${DS.outlineVar}`, borderRadius: 4,
              padding: 14,
            }}
          >
            <AlgoChart components={components} filterMode={inventoryFilter} />
          </div>

          {/* Mosca Widget */}
          <div style={{ width: '100%' }}>
            <MoscaWidget initialX={mosca.x} initialY={mosca.y} initialZ={mosca.z} />
          </div>
        </div>
      </main>

      {/* ════════════ STICKY FOOTER — CycloneDX Output Bar ════════════ */}
      <footer
        style={{
          background: DS.surfaceHigh,
          borderTop: `2px solid ${DS.primary}40`,
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          position: 'sticky',
          bottom: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: DS.secondary }}>&lt;&gt;</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: DS.onSurface }}>
            CycloneDX 1.6 Standardized Schema Output
          </span>
          {bom && (
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, color: DS.muted,
                background: DS.surfaceLow,
                padding: '2px 8px', borderRadius: 4,
                border: `1px solid ${DS.outlineVar}`,
              }}
            >
              {bom.serialNumber}
            </span>
          )}
        </div>

        {/* ∧ Toggle button — opens drawer */}
        <button
          id="btn-cdx-drawer-toggle"
          onClick={() => { if (bom) setBomDrawerOpen(v => !v) }}
          disabled={!bom}
          title={bom ? 'View full CycloneDX JSON output' : 'Run a scan first'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: bom ? `${DS.primary}14` : 'transparent',
            border: `1px solid ${bom ? `${DS.primary}40` : DS.outlineVar}`,
            borderRadius: 4, padding: '4px 12px',
            color: bom ? DS.primary : DS.muted,
            fontSize: 13, fontWeight: 700,
            cursor: bom ? 'pointer' : 'not-allowed',
            opacity: bom ? 1 : 0.4,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (bom) { e.currentTarget.style.background = `${DS.primary}28`; e.currentTarget.style.borderColor = `${DS.primary}70` } }}
          onMouseLeave={e => { if (bom) { e.currentTarget.style.background = `${DS.primary}14`; e.currentTarget.style.borderColor = `${DS.primary}40` } }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>{bomDrawerOpen ? '∨' : '∧'}</span>
          <span style={{ fontSize: 12 }}>View JSON</span>
        </button>
      </footer>

      {/* CycloneDX Drawer */}
      {bomDrawerOpen && bom && (
        <CycloneDXDrawer bom={bom} onClose={() => setBomDrawerOpen(false)} />
      )}

      <style>{`
        @keyframes spin-slow { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1 } 50% { opacity: 0.4 }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(8px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>
    </div>
  )
}
