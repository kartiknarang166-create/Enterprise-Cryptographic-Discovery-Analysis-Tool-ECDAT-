/**
 * App.jsx — ECDAT v1.0-pqc
 * Orchestrates all views:
 *   1. AuthPage        — shown when not logged in
 *   2. Landing Page    — scanner entry point
 *   3. Analytics Dashboard — shown after a successful scan
 *
 * Key additions:
 *  - Supabase auth gating (entire app)
 *  - InventoryPanel overlay (triggered by Inventory nav tab)
 *  - HistoryPanel tab (replaces Policy + Compliance)
 *  - Scan history saved to Supabase after every successful scan
 *  - Signed-in user email shown in header avatar; Sign Out button
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Shield, Wifi, Bell, Download, X,
  Database, AlertTriangle, CheckCircle, Zap, Home, LogOut,
} from 'lucide-react'
import LandingPage    from './components/LandingPage'
import InventoryTable from './components/InventoryTable'
import InventoryPanel from './components/InventoryPanel'
import HistoryPanel   from './components/HistoryPanel'
import AlgoChart      from './components/AlgoChart'
import MoscaWidget    from './components/MoscaWidget'
import AuthPage       from './components/AuthPage'
import { FALLBACK_BOM } from './fallbackData'
import { supabase, saveHistoryEntry } from './supabase'
import './index.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE       = `http://${window.location.hostname}:8000`
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
  const pqcReady   = components.filter(c => {
    const name = (c.name || c.algorithm || '').toLowerCase()
    return name.includes('ml-kem') || name.includes('ml-dsa') || name.includes('kyber') ||
           name.includes('dilithium') || name.includes('slh-dsa') || name.includes('falcon')
  }).length
  const pqcPct     = total > 0 ? Math.round((pqcReady / total) * 100) : 0
  return { total, critical, components, hasExposure: critical > 0, pqcPct }
}

function moscaDefaults(components) {
  if (!components || components.length === 0) return { x: 0, y: 0, z: 0 }
  const first = components.find(c => c.mosca?.risk_level === 'CRITICAL') || components[0]
  if (!first?.mosca) return { x: 0, y: 0, z: 0 }
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
  // ── Auth state ─────────────────────────────────────────────────────────────
  const [session,     setSession]     = useState(undefined)  // undefined = checking, null = logged out, object = logged in
  const [user,        setUser]        = useState(null)

  // ── App view ────────────────────────────────────────────────────────────────
  const [view,        setView]        = useState('landing')   // 'landing' | 'dashboard'
  const [apiStatus,   setApiStatus]   = useState('checking')
  const [targetDir,   setTargetDir]   = useState(DEFAULT_DIR)
  const [bom,         setBom]         = useState(null)
  const [activeTab,   setActiveTab]   = useState('Dashboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [bomDrawerOpen, setBomDrawerOpen] = useState(false)
  const [inventoryPanelOpen, setInventoryPanelOpen] = useState(false)
  const [inventoryFilter, setInventoryFilter] = useState('All')

  // ── Auth: check session on mount, subscribe to changes ─────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      setUser(sess?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    setView('landing')
    setBom(null)
    setActiveTab('Dashboard')
  }

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
  async function handleScanComplete(result, dir) {
    setBom(result)
    setTargetDir(dir || DEFAULT_DIR)
    setView('dashboard')
    setInventoryFilter('All')

    // Persist to Supabase (summary + BOM only — no source files)
    if (user?.id) {
      await saveHistoryEntry(result, dir, user.id)
    }
  }

  // ── History: load a past scan ──────────────────────────────────────────────
  function handleLoadHistoryScan(historicBom, target) {
    setBom(historicBom)
    setTargetDir(target || DEFAULT_DIR)
    setInventoryFilter('All')
    setActiveTab('Dashboard')
  }

  // ── In-dashboard re-scan ───────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (loading) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [loading])

  const SCAN_TIMEOUT_MS = 300_000

  const runScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
    try {
      const res = await fetch(`${API_BASE}/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ target_directory: targetDir.trim() || DEFAULT_DIR }),
        signal:  controller.signal,
      })
      if (!res.ok) {
        let detail = `Scan failed (HTTP ${res.status})`
        try {
          const b = await res.json()
          detail = b.detail || b.message || detail
        } catch { /* body not JSON */ }
        setError(detail)
        return
      }
      const result = await res.json()
      setBom(result)
      setInventoryFilter('All')

      // Persist to Supabase
      if (user?.id) await saveHistoryEntry(result, targetDir.trim() || DEFAULT_DIR, user.id)
    } catch (err) {
      if (err.name === 'AbortError') {
        setError(`Scan timed out after ${Math.round(SCAN_TIMEOUT_MS / 60000)} minutes. Try a smaller repo.`)
      } else if (err instanceof TypeError) {
        console.warn('Backend unreachable, using fallback data:', err.message)
        setBom(FALLBACK_BOM)
        setInventoryFilter('All')
      } else {
        setError(err.message || 'An unexpected error occurred.')
      }
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }, [targetDir, user])

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
  const { total, critical, components, hasExposure, pqcPct } = useMemo(
    () => bom ? summarise(bom) : { total: 0, critical: 0, components: [], hasExposure: false, pqcPct: 0 },
    [bom]
  )
  const mosca = useMemo(() => moscaDefaults(components), [components])

  const apiCfg = {
    checking: { color: DS.tertiary,  label: 'Checking…'    },
    online:   { color: DS.emerald,   label: 'API Connected' },
    offline:  { color: DS.error,     label: 'API Offline'   },
  }[apiStatus]

  // ── Auth: still checking ────────────────────────────────────────────────────
  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: DS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg style={{ width: 32, height: 32, animation: 'spin-app 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke={`${DS.primary}30`} strokeWidth="2" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke={DS.primary} strokeWidth="2" strokeLinecap="round" />
        </svg>
        <style>{`@keyframes spin-app { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // ── Auth: not logged in ─────────────────────────────────────────────────────
  if (!session) {
    return <AuthPage onAuth={(sess) => { setSession(sess); setUser(sess?.user ?? null) }} />
  }

  // ── Landing view ───────────────────────────────────────────────────────────
  if (view === 'landing') {
    return <LandingPage onScanComplete={handleScanComplete} />
  }

  // ── Dashboard view ─────────────────────────────────────────────────────────
  const NAV_TABS = ['Dashboard', 'Inventory', 'History']

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: DS.bg, fontFamily: 'Inter, sans-serif' }}>

      {/* InventoryPanel overlay */}
      {inventoryPanelOpen && (
        <InventoryPanel
          components={components}
          onClose={() => setInventoryPanelOpen(false)}
        />
      )}

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
          {NAV_TABS.map(tab => (
            <NavTab
              key={tab}
              label={tab}
              active={activeTab === tab && tab !== 'Inventory'}
              onClick={() => {
                if (tab === 'Inventory') {
                  // Open as overlay panel instead of switching tab content
                  setInventoryPanelOpen(true)
                } else {
                  setActiveTab(tab)
                }
              }}
            />
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

          {/* User avatar + sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              title={user?.email || 'Signed in'}
              style={{
                width: 26, height: 26, borderRadius: '50%',
                background: `${DS.primary}28`,
                border: `1px solid ${DS.primary}50`,
                color: DS.primary,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, cursor: 'default',
              }}
            >
              {(user?.email?.[0] || 'U').toUpperCase()}
            </div>
            <button
              id="btn-sign-out"
              onClick={handleSignOut}
              title="Sign out"
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none',
                color: DS.muted, cursor: 'pointer',
                fontSize: 11, fontWeight: 500,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = DS.error)}
              onMouseLeave={e => (e.currentTarget.style.color = DS.muted)}
            >
              <LogOut size={12} />
            </button>
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

        {/* ── History Tab ── */}
        {activeTab === 'History' && (
          <HistoryPanel
            userId={user?.id}
            onLoadScan={handleLoadHistoryScan}
          />
        )}

        {/* ── Dashboard Tab ── */}
        {activeTab === 'Dashboard' && (
          <>
            {/* 4 Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, animation: 'fade-up 0.4s ease both' }}>
              <SummaryCard
                title="Total Cryptographic Assets"
                subtitle="Scanned from AST & Manifests"
                value={bom ? total : '—'}
                valueColor={DS.onSurface}
                icon={Database}
              />
              <SummaryCard
                title="Quantum-Vulnerable Assets"
                subtitle="Immediate migration recommended"
                value={bom ? (critical > 0 ? `${critical} Quantum-Vulnerable` : '0 Vulnerable') : '—'}
                valueColor={critical > 0 ? DS.error : DS.emerald}
                icon={AlertTriangle}
                leftAccent={DS.error}
                tag={bom && critical > 0 ? 'RSA/ECC' : undefined}
                tagBg={`${DS.error}1a`}
                tagColor={DS.error}
              />
              <SummaryCard
                title="PQC Migration Progress"
                subtitle="(Target NIST FIPS 203/204)"
                value={bom ? `${pqcPct}% PQC Migrated` : '—'}
                valueColor={pqcPct >= 50 ? DS.emerald : DS.tertiary}
                icon={CheckCircle}
                leftAccent={pqcPct >= 50 ? DS.emerald : DS.tertiary}
                tag={bom ? (pqcPct >= 50 ? 'On Track' : 'Needs Work') : undefined}
                tagBg={pqcPct >= 50 ? `${DS.emerald}1a` : `${DS.tertiary}1a`}
                tagColor={pqcPct >= 50 ? DS.emerald : DS.tertiary}
              />
              <SummaryCard
                title="Cryptographic Risk Score"
                subtitle="Assets requiring urgent PQC upgrade"
                value={bom ? (critical > 0 ? `${critical} / ${total}` : '0 at Risk') : '—'}
                valueColor={critical > 0 ? DS.error : DS.emerald}
                icon={Zap}
                leftAccent={critical > 0 ? DS.error : DS.emerald}
                tag={bom ? (critical > 0 ? 'Action Required' : 'Secure') : undefined}
                tagBg={critical > 0 ? `${DS.error}1a` : `${DS.emerald}1a`}
                tagColor={critical > 0 ? DS.error : DS.emerald}
              />
            </div>

            {/* Stacked content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', animation: 'fade-up 0.5s ease 0.1s both' }}>

              {/* Cryptographic Inventory */}
              <div
                style={{
                  width: '100%', background: DS.surfaceLow,
                  border: `1px solid ${DS.outlineVar}`, borderRadius: 4,
                  padding: 14, display: 'flex', flexDirection: 'column', gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ fontSize: 14, fontWeight: 600, color: DS.onSurface }}>
                    Cryptographic Inventory
                  </h2>
                  {bom && (
                    <button
                      onClick={() => setInventoryPanelOpen(true)}
                      style={{
                        fontSize: 12, fontWeight: 600,
                        color: DS.primary, background: `${DS.primary}12`,
                        border: `1px solid ${DS.primary}30`,
                        borderRadius: 6, padding: '4px 12px',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${DS.primary}22`; e.currentTarget.style.borderColor = `${DS.primary}60` }}
                      onMouseLeave={e => { e.currentTarget.style.background = `${DS.primary}12`; e.currentTarget.style.borderColor = `${DS.primary}30` }}
                    >
                      View Full List ↗
                    </button>
                  )}
                </div>

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
                    fontFamily: 'Inter, sans-serif',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => (e.target.style.borderColor = DS.primary)}
                  onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
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

              {/* Algorithm Breakdown */}
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
          </>
        )}
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
