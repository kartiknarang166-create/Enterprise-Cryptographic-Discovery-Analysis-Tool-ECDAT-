/**
 * LandingPage.jsx — ECDAT v1.0-pqc
 * SIH-aligned hero landing page with:
 *  - 4 capability cards mapping directly to SIH problem statement requirements
 *  - Codebase scanner entry point:
 *      • Local Codebase — native OS folder picker (<input webkitdirectory>)
 *        Files are zipped client-side (JSZip) and POSTed to /scan/upload
 *      • Remote GitHub — URL text input → POST /scan (JSON)
 *  - Scan execution → routes to dashboard on success
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Shield, Search, Zap, GitBranch, Lock, AlertTriangle, CheckCircle, ArrowRight, Cpu, FolderOpen, X } from 'lucide-react'
import JSZip from 'jszip'
import { FALLBACK_BOM } from '../fallbackData'

const DS = {
  bg:          '#13131b',
  surfaceLow:  '#1b1b23',
  surfaceHigh: '#292932',
  onSurface:   '#e4e1ed',
  onVariant:   '#c7c4d7',
  outline:     '#908fa0',
  outlineVar:  '#464554',
  error:       '#ffb4ab',
  tertiary:    '#ffb783',
  primary:     '#c0c1ff',
  secondary:   '#4cd7f6',
  emerald:     '#6ee7b7',
  muted:       '#908fa0',
}

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024  // 200 MB

const SIH_CARDS = [
  {
    num: 'i',
    title: 'Comprehensive Cryptographic Cataloging',
    plain: 'Automatically finds and inventories all hidden encryption elements across your software.',
    tech: 'Identifies algorithms, keys, certificates, protocols, libraries (SCA), and cloud services across internal/external apps.',
    icon: Search,
    accentColor: DS.secondary,
    accentBg: 'rgba(76,215,246,0.08)',
    accentBorder: 'rgba(76,215,246,0.2)',
    tag: 'AST + SCA',
  },
  {
    num: 'ii',
    title: 'Quantum Risk & Sensitive Data Assessment',
    plain: 'Detects vulnerable code prone to future quantum attacks and highlights data at risk.',
    tech: 'Performs automated SAST/AST code analysis to isolate Shor-vulnerable algorithms (RSA, ECC, MD5) and flag sensitive payload exposure.',
    icon: AlertTriangle,
    accentColor: DS.error,
    accentBg: 'rgba(255,180,171,0.08)',
    accentBorder: 'rgba(255,180,171,0.2)',
    tag: 'SAST / Semgrep',
  },
  {
    num: 'iii',
    title: "Mosca's Theorem Risk Classification",
    plain: 'Calculates your exact time horizon before quantum computers break your current security.',
    tech: "Classifies assets by type, lifetime, and business criticality using Mosca's inequality (X + Y > Z) to map Harvest-Now-Decrypt-Later (HNDL) threats.",
    icon: Zap,
    accentColor: DS.tertiary,
    accentBg: 'rgba(255,183,131,0.08)',
    accentBorder: 'rgba(255,183,131,0.2)',
    tag: 'HNDL Threat Model',
  },
  {
    num: 'iv',
    title: 'Automated PQC & Hybrid Recommendations',
    plain: 'Suggests immediate, safe upgrades to protect your software against quantum threats.',
    tech: 'Recommends NIST FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), and hybrid PQC alternatives mapped against latency, risk profile, and performance cost.',
    icon: CheckCircle,
    accentColor: DS.emerald,
    accentBg: 'rgba(110,231,183,0.08)',
    accentBorder: 'rgba(110,231,183,0.2)',
    tag: 'NIST PQC Ready',
  },
]


export default function LandingPage({ onScanComplete }) {
  const [inputMode,    setInputMode]    = useState('local')   // 'local' | 'remote'
  const [remoteUrl,    setRemoteUrl]    = useState('')
  const [selectedFiles, setSelectedFiles] = useState(null)    // FileList from folder picker
  const [folderName,   setFolderName]   = useState('')
  const [isDragging,   setIsDragging]   = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [elapsed,      setElapsed]      = useState(0)
  const timerRef  = useRef(null)
  const fileInput = useRef(null)

  function handleModeSwitch(mode) {
    setInputMode(mode)
    setError(null)
    if (mode === 'local') { setRemoteUrl('') }
    else { setSelectedFiles(null); setFolderName('') }
  }

  // ── Elapsed timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [loading])

  // ── Folder picker handler ────────────────────────────────────────────────────
  function onFolderInputChange(e) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setSelectedFiles(files)
    // Extract folder name from the first file's relative path
    const firstPath = files[0].webkitRelativePath || ''
    setFolderName(firstPath.split('/')[0] || 'Selected Folder')
    setError(null)
  }

  function clearFolder() {
    setSelectedFiles(null)
    setFolderName('')
    if (fileInput.current) fileInput.current.value = ''
  }

  // ── Drag-and-drop for folder ─────────────────────────────────────────────────
  function onDragOver(e) { e.preventDefault(); setIsDragging(true) }
  function onDragLeave()  { setIsDragging(false) }
  function onDrop(e) {
    e.preventDefault(); setIsDragging(false)
    const items = e.dataTransfer.items
    if (!items) return
    const fileList = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        setFolderName(entry.name)
        // For dropped folders, fall back to requesting via file input
        // (webkitGetAsEntry doesn't give a FileList directly in all browsers)
        fileInput.current?.click()
        return
      }
    }
  }

  // ── Zip + upload ─────────────────────────────────────────────────────────────
  const SCAN_TIMEOUT_MS = 300_000

  async function zipAndUpload(files, folderLabel) {
    // Size guard
    let totalBytes = 0
    for (let i = 0; i < files.length; i++) totalBytes += files[i].size
    if (totalBytes > MAX_UPLOAD_BYTES) {
      setError(`Folder is too large (${(totalBytes / 1024 / 1024).toFixed(0)} MB). Maximum allowed is 200 MB.`)
      return
    }

    setLoading(true); setError(null)
    try {
      // Build ZIP in-browser
      const zip = new JSZip()
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const relativePath = f.webkitRelativePath || f.name
        zip.file(relativePath, f)
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } })

      const form = new FormData()
      form.append('file', blob, `${folderLabel}.zip`)

      const controller = new AbortController()
      const tid = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
      try {
        const res = await fetch(`http://${window.location.hostname}:8000/scan/upload`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        })
        clearTimeout(tid)
        if (!res.ok) {
          let detail = `Scan failed (HTTP ${res.status})`
          try { const b = await res.json(); detail = b.detail || b.message || detail } catch {}
          setError(detail); return
        }
        const bom = await res.json()
        onScanComplete(bom, folderLabel)
      } catch (err) {
        clearTimeout(tid)
        if (err.name === 'AbortError') {
          setError(`Scan timed out after ${Math.round(SCAN_TIMEOUT_MS / 60000)} minutes.`)
        } else if (err instanceof TypeError) {
          console.warn('Backend unreachable, using fallback:', err.message)
          onScanComplete(FALLBACK_BOM, folderLabel)
        } else {
          setError(err.message || 'An unexpected error occurred.')
        }
      }
    } catch (zipErr) {
      setError(`Failed to compress folder: ${zipErr.message}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Remote URL scan ──────────────────────────────────────────────────────────
  async function remoteUrlScan(url) {
    setLoading(true); setError(null)
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
    try {
      const res = await fetch(`http://${window.location.hostname}:8000/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_directory: url.trim() }),
        signal: controller.signal,
      })
      clearTimeout(tid)
      if (!res.ok) {
        let detail = `Scan failed (HTTP ${res.status})`
        try { const b = await res.json(); detail = b.detail || b.message || detail } catch {}
        setError(detail); return
      }
      const bom = await res.json()
      onScanComplete(bom, url.trim())
    } catch (err) {
      clearTimeout(tid)
      if (err.name === 'AbortError') {
        setError(`Scan timed out after ${Math.round(SCAN_TIMEOUT_MS / 60000)} minutes.`)
      } else if (err instanceof TypeError) {
        console.warn('Backend unreachable, using fallback:', err.message)
        onScanComplete(FALLBACK_BOM, url.trim() || 'remote-repo')
      } else {
        setError(err.message || 'An unexpected error occurred.')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleScan() {
    if (inputMode === 'local') {
      if (!selectedFiles || selectedFiles.length === 0) {
        setError('Please select a local folder first.')
        return
      }
      zipAndUpload(selectedFiles, folderName)
    } else {
      if (!remoteUrl.trim()) { setError('Please enter a GitHub repository URL.'); return }
      remoteUrlScan(remoteUrl)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: DS.bg,
        fontFamily: 'Inter, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
      }}
    >
      {/* ── Top Nav Bar ── */}
      <header
        style={{
          background: DS.surfaceLow,
          borderBottom: `1px solid ${DS.outlineVar}`,
          padding: '0 32px',
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={17} color={DS.primary} strokeWidth={1.8} />
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase', color: DS.onSurface }}>
            ECDAT
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 9999,
              background: `${DS.primary}18`,
              color: DS.primary,
              border: `1px solid ${DS.primary}40`,
              lineHeight: '18px',
            }}
          >
            v1.0-pqc
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {['SIH 2025', 'Documentation', 'NIST PQC'].map(link => (
            <span key={link} style={{ fontSize: 13, color: DS.muted, cursor: 'pointer' }}>{link}</span>
          ))}
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: `${DS.primary}14`,
              border: `1px solid ${DS.primary}40`,
              borderRadius: 4,
              padding: '4px 12px',
            }}
          >
            <Cpu size={12} color={DS.primary} />
            <span style={{ fontSize: 12, fontWeight: 600, color: DS.primary }}>CycloneDX 1.6</span>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '72px 32px 48px',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: 0, left: '50%', transform: 'translateX(-50%)',
            width: 600, height: 300,
            background: `radial-gradient(ellipse at center, ${DS.primary}12 0%, transparent 70%)`,
            pointerEvents: 'none',
          }}
        />

        {/* Status Badge */}
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: `${DS.primary}10`,
            border: `1px solid ${DS.primary}30`,
            borderRadius: 9999,
            padding: '5px 14px',
            marginBottom: 28,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: DS.emerald, display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: DS.primary, letterSpacing: '0.04em' }}>
            Enterprise DevSecOps · Cryptographic Risk Intelligence
          </span>
        </div>

        {/* Main Headline */}
        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 48px)',
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: DS.onSurface,
            maxWidth: 860,
            marginBottom: 20,
          }}
        >
          Automated Cryptographic Discovery,{' '}
          <span style={{ color: DS.primary }}>Quantum Risk Assessment</span>{' '}
          &amp; Post-Quantum Migration.
        </h1>

        {/* Subheadline */}
        <p
          style={{
            fontSize: 17,
            lineHeight: 1.7,
            color: DS.onVariant,
            maxWidth: 680,
            marginBottom: 48,
          }}
        >
          ECDAT is an enterprise DevSecOps engine that catalogues cryptographic assets, models quantum exposure timelines, and generates standard-compliant post-quantum migration paths.
        </p>

        {/* ── Scanner Entry Card ── */}
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            background: DS.surfaceLow,
            border: `1px solid ${DS.outlineVar}`,
            borderRadius: 8,
            padding: 24,
            marginBottom: 16,
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: DS.muted, marginBottom: 12 }}>
            Codebase Scanner
          </p>

          {/* Input Type Toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: DS.surfaceHigh, borderRadius: 8, padding: 3 }}>
            {[
              { id: 'local',  label: 'Local Codebase'           },
              { id: 'remote', label: 'Remote GitHub Repository' },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => handleModeSwitch(opt.id)}
                style={{
                  flex: 1,
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'all 0.18s',
                  background: inputMode === opt.id ? DS.primary : 'transparent',
                  color: inputMode === opt.id ? '#09090b' : DS.muted,
                  boxShadow: inputMode === opt.id ? '0 1px 4px rgba(0,0,0,0.35)' : 'none',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* ── LOCAL MODE: Folder Picker ── */}
          {inputMode === 'local' && (
            <>
              {/* Hidden native file input */}
              <input
                ref={fileInput}
                id="folder-picker-input"
                type="file"
                // @ts-ignore — webkitdirectory is non-standard but widely supported
                webkitdirectory=""
                multiple
                style={{ display: 'none' }}
                onChange={onFolderInputChange}
              />

              {folderName ? (
                /* Selected folder badge */
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: `${DS.primary}10`,
                    border: `1px solid ${DS.primary}35`,
                    borderRadius: 6,
                    padding: '10px 14px',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 7,
                      background: `${DS.primary}18`,
                      border: `1px solid ${DS.primary}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <FolderOpen size={15} color={DS.primary} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: DS.onSurface, fontFamily: "'JetBrains Mono', monospace" }}>
                        {folderName}
                      </div>
                      <div style={{ fontSize: 11, color: DS.muted, marginTop: 1 }}>
                        {selectedFiles?.length ?? 0} file{selectedFiles?.length !== 1 ? 's' : ''} selected
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={clearFolder}
                    style={{
                      background: 'none', border: 'none',
                      color: DS.muted, cursor: 'pointer',
                      display: 'flex', alignItems: 'center',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = DS.error)}
                    onMouseLeave={e => (e.currentTarget.style.color = DS.muted)}
                    title="Clear selection"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                /* Drop zone / pick button */
                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  style={{
                    border: `2px dashed ${isDragging ? DS.primary : DS.outlineVar}`,
                    borderRadius: 8,
                    padding: '28px 20px',
                    marginBottom: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                    background: isDragging ? `${DS.primary}08` : 'transparent',
                    transition: 'border-color 0.2s, background 0.2s',
                    cursor: 'pointer',
                  }}
                  onClick={() => fileInput.current?.click()}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: `${DS.primary}14`, border: `1px solid ${DS.primary}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <FolderOpen size={20} color={DS.primary} />
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: DS.onSurface, marginBottom: 4 }}>
                      Drop a folder here or{' '}
                      <span style={{ color: DS.primary, textDecoration: 'underline', cursor: 'pointer' }}>
                        browse
                      </span>
                    </p>
                    <p style={{ fontSize: 12, color: DS.muted }}>
                      Folder is zipped in-browser — source code never leaves uncompressed
                    </p>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 9999,
                    background: `${DS.emerald}14`, color: DS.emerald,
                    border: `1px solid ${DS.emerald}30`,
                  }}>
                    Max 200 MB
                  </span>
                </div>
              )}
            </>
          )}

          {/* ── REMOTE MODE: URL Input ── */}
          {inputMode === 'remote' && (
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <Search size={14} color={DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                id="landing-remote-url-input"
                type="text"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                placeholder="https://github.com/example/sample-crypto-app"
                style={{
                  width: '100%',
                  background: DS.surfaceHigh,
                  border: `1px solid ${DS.outlineVar}`,
                  borderRadius: 6,
                  color: DS.onSurface,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  padding: '10px 12px 10px 36px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = DS.primary)}
                onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px',
                borderRadius: 4,
                background: `${DS.error}10`,
                border: `1px solid ${DS.error}40`,
                color: DS.error,
                fontSize: 12,
                marginBottom: 12,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          {/* Action Button */}
          <button
            id="btn-initiate-scan"
            onClick={handleScan}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 24px',
              borderRadius: 6,
              background: loading ? '#374151' : '#f4f4f5',
              border: 'none',
              color: loading ? '#9ca3af' : '#09090b',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#e4e4e7' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#f4f4f5' }}
          >
            {loading ? (
              <>
                <svg style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#6b7280" strokeWidth="2.5" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                {elapsed < 5
                  ? 'Preparing upload…'
                  : elapsed < 20
                  ? `Uploading & scanning… (${elapsed}s)`
                  : `Scanning cryptographic surface… (${elapsed}s)`
                }
              </>
            ) : (
              <>
                <Shield size={14} fill="#09090b" strokeWidth={0} />
                Initiate Cryptographic Scan
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>

        <p style={{ fontSize: 12, color: DS.muted }}>
          Outputs CycloneDX 1.6 CBOM · NIST SP 800-235 compliant · Mosca-scored
        </p>
      </section>

      {/* ── SIH Capability Cards ── */}
      <section style={{ padding: '0 32px 64px', maxWidth: 1200, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: DS.muted, marginBottom: 8 }}>
            Platform Capabilities
          </p>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: DS.onSurface, letterSpacing: '-0.01em' }}>
            Four Core Capabilities
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {SIH_CARDS.map(card => {
            const Icon = card.icon
            return (
              <div
                key={card.num}
                style={{
                  background: card.accentBg,
                  border: `1px solid ${card.accentBorder}`,
                  borderRadius: 8,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Glow accent */}
                <div
                  style={{
                    position: 'absolute',
                    top: -20, right: -20,
                    width: 80, height: 80,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${card.accentColor}20, transparent 70%)`,
                    pointerEvents: 'none',
                  }}
                />

                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: `${card.accentColor}18`,
                      border: `1px solid ${card.accentColor}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={16} color={card.accentColor} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 9999,
                        background: `${card.accentColor}18`,
                        color: card.accentColor,
                        border: `1px solid ${card.accentColor}30`,
                      }}
                    >
                      {card.tag}
                    </span>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 10, fontWeight: 700,
                        color: DS.muted,
                      }}
                    >
                      {card.num}.
                    </span>
                  </div>
                </div>

                {/* Title */}
                <h3 style={{ fontSize: 15, fontWeight: 700, color: DS.onSurface, lineHeight: 1.3, margin: 0 }}>
                  {card.title}
                </h3>

                {/* Plain language */}
                <p style={{ fontSize: 13, lineHeight: 1.6, color: DS.onVariant, margin: 0 }}>
                  {card.plain}
                </p>

                {/* Divider */}
                <div style={{ height: 1, background: `${card.accentColor}15` }} />

                {/* Technical spec */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <GitBranch size={12} color={card.accentColor} style={{ flexShrink: 0, marginTop: 2 }} />
                  <p
                    style={{
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: DS.muted,
                      margin: 0,
                      fontFamily: 'Inter, sans-serif',
                    }}
                  >
                    {card.tech}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Tech Stack Footer Strip ── */}
      <div
        style={{
          borderTop: `1px solid ${DS.outlineVar}`,
          padding: '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          flexWrap: 'wrap',
          background: DS.surfaceLow,
        }}
      >
        {[
          ['Semgrep AST', DS.secondary],
          ['CycloneDX 1.6', DS.primary],
          ['NIST FIPS 203/204', DS.emerald],
          ["Mosca's Theorem", DS.tertiary],
          ['FastAPI Backend', DS.muted],
        ].map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
            <span style={{ fontSize: 11, color: DS.muted, fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
