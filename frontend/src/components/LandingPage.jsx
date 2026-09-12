/**
 * LandingPage.jsx — ECDAT v1.1-pqc
 * Unified multi-modal scanner entry point supporting:
 *   1. Local Codebase   — folder/ZIP drag-and-drop (zipped in-browser → /scan/upload)
 *   2. Remote GitHub    — URL text input → POST /scan (JSON)
 *   3. Binary File      — .exe/.dll/.so/.elf drag-and-drop → /scan/binary
 *   4. Container Image  — .tar drag-and-drop → /scan/container/upload
 *                       — image tag text → /scan/container (requires Docker on server)
 *
 * Input auto-detection:
 *   .exe/.dll/.so/.elf/.bin/.dylib → binary mode
 *   .tar                           → container mode
 *   .zip                           → local mode
 *   http(s)://                     → remote mode
 *   other text                     → container tag mode
 */
import { useState, useEffect, useRef } from 'react'
import {
  Shield, Search, Zap, GitBranch, Lock, AlertTriangle, CheckCircle,
  ArrowRight, Cpu, FolderOpen, X, Package, HardDrive, Box,
} from 'lucide-react'
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
  violet:      '#d8a2ff',
}

const MAX_UPLOAD_BYTES    = 200 * 1024 * 1024   // 200 MB — folders / ZIPs
const MAX_BINARY_BYTES    = 100 * 1024 * 1024   // 100 MB — binaries
const MAX_CONTAINER_BYTES = 500 * 1024 * 1024   // 500 MB — container tarballs
const SCAN_TIMEOUT_MS     = 300_000

// File extensions that map to each mode
const BINARY_EXTS    = new Set(['exe', 'dll', 'so', 'elf', 'bin', 'dylib', 'sys', 'o'])
const CONTAINER_EXTS = new Set(['tar'])
const LOCAL_EXTS     = new Set(['zip'])

const MODES = [
  {
    id: 'local',
    label: 'Local Folder',
    icon: FolderOpen,
    color: DS.primary,
    bg: 'rgba(192,193,255,0.08)',
    border: 'rgba(192,193,255,0.22)',
    description: 'Drop a local folder or ZIP',
    limit: '200 MB max',
  },
  {
    id: 'remote',
    label: 'GitHub URL',
    icon: GitBranch,
    color: DS.secondary,
    bg: 'rgba(76,215,246,0.08)',
    border: 'rgba(76,215,246,0.22)',
    description: 'Enter a public GitHub URL',
    limit: null,
  },
  {
    id: 'binary',
    label: 'Binary File',
    icon: Cpu,
    color: DS.tertiary,
    bg: 'rgba(255,183,131,0.08)',
    border: 'rgba(255,183,131,0.22)',
    description: 'Drop a compiled binary (.exe, .dll, .so, .elf…)',
    limit: '100 MB max',
  },
  {
    id: 'container',
    label: 'Container',
    icon: Package,
    color: DS.violet,
    bg: 'rgba(216,162,255,0.08)',
    border: 'rgba(216,162,255,0.22)',
    description: 'Drop a Docker .tar or enter an image tag',
    limit: '500 MB .tar max',
  },
]

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

// ── Auto-detect mode from a dropped file or typed text ──────────────────────
function detectModeFromFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (BINARY_EXTS.has(ext)) return 'binary'
  if (CONTAINER_EXTS.has(ext)) return 'container'
  if (LOCAL_EXTS.has(ext)) return 'local'
  return null
}

function detectModeFromText(text) {
  const t = text.trim()
  if (!t) return null
  if (t.startsWith('http://') || t.startsWith('https://')) return 'remote'
  return 'container' // treat bare text as a docker image tag
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ModeTab({ mode, active, onClick }) {
  const Icon = mode.icon
  return (
    <button
      onClick={onClick}
      title={mode.description}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '7px 10px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        transition: 'all 0.18s',
        background: active ? mode.color : 'transparent',
        color: active ? '#09090b' : DS.muted,
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.35)' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={12} />
      {mode.label}
    </button>
  )
}

function FileBadge({ icon: Icon, label, sublabel, color, onClear }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: `${color}10`, border: `1px solid ${color}35`,
      borderRadius: 6, padding: '10px 14px', marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 7,
          background: `${color}18`, border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={15} color={color} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: DS.onSurface, fontFamily: "'JetBrains Mono', monospace" }}>
            {label}
          </div>
          {sublabel && (
            <div style={{ fontSize: 11, color: DS.muted, marginTop: 1 }}>{sublabel}</div>
          )}
        </div>
      </div>
      <button
        onClick={onClear}
        style={{ background: 'none', border: 'none', color: DS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.color = DS.error)}
        onMouseLeave={e => (e.currentTarget.style.color = DS.muted)}
        title="Clear selection"
      >
        <X size={15} />
      </button>
    </div>
  )
}

function DropZone({ onFileClick, onDragOver, onDragLeave, onDrop, isDragging, icon: Icon, color, label, sublabel, limitLabel }) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onFileClick}
      style={{
        border: `2px dashed ${isDragging ? color : DS.outlineVar}`,
        borderRadius: 8,
        padding: '28px 20px',
        marginBottom: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        background: isDragging ? `${color}08` : 'transparent',
        transition: 'border-color 0.2s, background 0.2s',
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10,
        background: `${color}14`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={20} color={color} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: DS.onSurface, marginBottom: 4 }}>
          {label}
        </p>
        {sublabel && (
          <p style={{ fontSize: 12, color: DS.muted }}>{sublabel}</p>
        )}
      </div>
      {limitLabel && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          padding: '2px 8px', borderRadius: 9999,
          background: `${color}14`, color: color,
          border: `1px solid ${color}30`,
        }}>
          {limitLabel}
        </span>
      )}
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function LandingPage({ onScanComplete }) {
  const [inputMode,      setInputMode]      = useState('local')
  const [remoteUrl,      setRemoteUrl]      = useState('')
  const [containerTag,   setContainerTag]   = useState('')
  const [selectedFile,   setSelectedFile]   = useState(null)   // File object for binary/container/zip
  const [selectedFiles,  setSelectedFiles]  = useState(null)   // FileList for folder
  const [folderName,     setFolderName]     = useState('')
  const [isDragging,     setIsDragging]     = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)
  const [elapsed,        setElapsed]        = useState(0)
  const [dockerAvailable, setDockerAvailable] = useState(null) // null=checking, true, false

  const folderInputRef = useRef(null)
  const fileInputRef   = useRef(null)
  const timerRef       = useRef(null)

  // ── Fetch Docker status on mount ─────────────────────────────────────────
  useEffect(() => {
    fetch(`http://${window.location.hostname}:8000/health/docker`, {
      signal: AbortSignal.timeout(5000),
    })
      .then(r => r.json())
      .then(d => setDockerAvailable(d.docker === true))
      .catch(() => setDockerAvailable(false))
  }, [])

  // ── Elapsed timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [loading])

  const activeMode = MODES.find(m => m.id === inputMode) || MODES[0]

  // ── Mode switching ────────────────────────────────────────────────────────
  function switchMode(id) {
    setInputMode(id)
    setError(null)
    setSelectedFile(null)
    setSelectedFiles(null)
    setFolderName('')
    setRemoteUrl('')
    setContainerTag('')
    if (folderInputRef.current) folderInputRef.current.value = ''
    if (fileInputRef.current)   fileInputRef.current.value   = ''
  }

  // ── File auto-detection (drag-and-drop or single file picker) ────────────
  function handleDetectedFile(file) {
    const detected = detectModeFromFile(file)
    if (detected && detected !== inputMode) setInputMode(detected)
    setSelectedFile(file)
    setSelectedFiles(null)
    setFolderName('')
    setError(null)
  }

  // ── Folder picker handler ─────────────────────────────────────────────────
  function onFolderInputChange(e) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setSelectedFiles(files)
    const firstPath = files[0].webkitRelativePath || ''
    setFolderName(firstPath.split('/')[0] || 'Selected Folder')
    setSelectedFile(null)
    setError(null)
  }

  // ── Generic file picker handler ───────────────────────────────────────────
  function onFileInputChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    handleDetectedFile(f)
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  function onDragOver(e)  { e.preventDefault(); setIsDragging(true) }
  function onDragLeave()  { setIsDragging(false) }

  function onDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    const items = e.dataTransfer.items
    if (!items || items.length === 0) return

    // Check if it's a directory
    const firstEntry = items[0].webkitGetAsEntry?.()
    if (firstEntry?.isDirectory) {
      setInputMode('local')
      setFolderName(firstEntry.name)
      folderInputRef.current?.click()
      return
    }

    // Single file drop
    const file = e.dataTransfer.files?.[0]
    if (file) handleDetectedFile(file)
  }

  // ── Clear helpers ─────────────────────────────────────────────────────────
  function clearSelection() {
    setSelectedFile(null)
    setSelectedFiles(null)
    setFolderName('')
    if (folderInputRef.current) folderInputRef.current.value = ''
    if (fileInputRef.current)   fileInputRef.current.value   = ''
  }

  // ── API call helpers ──────────────────────────────────────────────────────
  async function postJson(url, body) {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(tid)
      if (!res.ok) {
        let detail = `Scan failed (HTTP ${res.status})`
        try { const b = await res.json(); detail = b.detail || b.message || detail } catch {}
        throw new Error(detail)
      }
      return await res.json()
    } finally {
      clearTimeout(tid)
    }
  }

  async function postForm(url, file, fieldName = 'file') {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
    try {
      const form = new FormData()
      form.append(fieldName, file, file.name || 'upload')
      const res = await fetch(url, { method: 'POST', body: form, signal: controller.signal })
      clearTimeout(tid)
      if (!res.ok) {
        let detail = `Scan failed (HTTP ${res.status})`
        try { const b = await res.json(); detail = b.detail || b.message || detail } catch {}
        throw new Error(detail)
      }
      return await res.json()
    } finally {
      clearTimeout(tid)
    }
  }

  const BASE = `http://${window.location.hostname}:8000`

  // ── Main scan dispatcher ──────────────────────────────────────────────────
  async function handleScan() {
    setError(null)
    setLoading(true)

    try {
      let bom = null
      let label = 'scan-result'

      // ── LOCAL CODEBASE ────────────────────────────────────────────────────
      if (inputMode === 'local') {
        // ZIP drop → single File
        if (selectedFile && selectedFile.name.toLowerCase().endsWith('.zip')) {
          if (selectedFile.size > MAX_UPLOAD_BYTES) {
            throw new Error(`ZIP is too large (${formatBytes(selectedFile.size)}). Maximum is 200 MB.`)
          }
          label = selectedFile.name
          bom   = await postForm(`${BASE}/scan/upload`, selectedFile)
        }
        // Folder → FileList
        else if (selectedFiles && selectedFiles.length > 0) {
          let totalBytes = 0
          for (let i = 0; i < selectedFiles.length; i++) totalBytes += selectedFiles[i].size
          if (totalBytes > MAX_UPLOAD_BYTES) {
            throw new Error(`Folder is too large (${formatBytes(totalBytes)}). Maximum is 200 MB.`)
          }
          // Zip in-browser
          const zip = new JSZip()
          for (let i = 0; i < selectedFiles.length; i++) {
            const f = selectedFiles[i]
            zip.file(f.webkitRelativePath || f.name, f)
          }
          const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } })
          const zipFile = new File([blob], `${folderName}.zip`, { type: 'application/zip' })
          label = folderName
          bom   = await postForm(`${BASE}/scan/upload`, zipFile)
        } else {
          throw new Error('Please select a local folder or drop a ZIP file first.')
        }
      }

      // ── REMOTE GITHUB ─────────────────────────────────────────────────────
      else if (inputMode === 'remote') {
        if (!remoteUrl.trim()) throw new Error('Please enter a GitHub repository URL.')
        label = remoteUrl.trim()
        bom   = await postJson(`${BASE}/scan`, { target_directory: remoteUrl.trim() })
      }

      // ── BINARY FILE ───────────────────────────────────────────────────────
      else if (inputMode === 'binary') {
        if (!selectedFile) throw new Error('Please drop or select a binary file (.exe, .dll, .so, .elf…).')
        if (selectedFile.size > MAX_BINARY_BYTES) {
          throw new Error(`Binary too large (${formatBytes(selectedFile.size)}). Maximum is 100 MB.`)
        }
        label = selectedFile.name
        bom   = await postForm(`${BASE}/scan/binary`, selectedFile)
      }

      // ── CONTAINER IMAGE ───────────────────────────────────────────────────
      else if (inputMode === 'container') {
        if (selectedFile) {
          // .tar upload
          if (selectedFile.size > MAX_CONTAINER_BYTES) {
            throw new Error(`Container archive too large (${formatBytes(selectedFile.size)}). Maximum is 500 MB.`)
          }
          label = selectedFile.name
          bom   = await postForm(`${BASE}/scan/container/upload`, selectedFile)
        } else if (containerTag.trim()) {
          // Image tag
          label = containerTag.trim()
          bom   = await postJson(`${BASE}/scan/container`, { image_tag: containerTag.trim() })
        } else {
          throw new Error('Please drop a .tar archive or enter a Docker image tag.')
        }
      }

      if (bom) onScanComplete(bom, label)

    } catch (err) {
      if (err.name === 'AbortError') {
        setError(`Scan timed out after ${Math.round(SCAN_TIMEOUT_MS / 60000)} minutes.`)
      } else if (err instanceof TypeError) {
        // Network error — use fallback
        console.warn('Backend unreachable, using fallback:', err.message)
        onScanComplete(FALLBACK_BOM, 'offline-demo')
      } else {
        setError(err.message || 'An unexpected error occurred.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Loading message based on mode ─────────────────────────────────────────
  function loadingMessage() {
    if (elapsed < 5) return 'Preparing…'
    if (inputMode === 'binary')    return `Extracting symbols & crypto patterns… (${elapsed}s)`
    if (inputMode === 'container') return `Unpacking image layers & scanning filesystem… (${elapsed}s)`
    if (elapsed < 20)              return `Uploading & scanning… (${elapsed}s)`
    return `Scanning cryptographic surface… (${elapsed}s)`
  }

  // ── Scan button label ─────────────────────────────────────────────────────
  function scanButtonLabel() {
    if (inputMode === 'binary')    return 'Scan Binary'
    if (inputMode === 'container') return 'Scan Container'
    if (inputMode === 'remote')    return 'Scan Repository'
    return 'Initiate Cryptographic Scan'
  }

  // ── Docker tooltip for disabled container tag input ───────────────────────
  const containerTagDisabled = inputMode === 'container' && dockerAvailable === false
  const dockerTooltip = 'Docker is not installed or not running on the server. Only .tar uploads are supported.'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: DS.bg, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>

      {/* ── Top Nav Bar ── */}
      <header style={{
        background: DS.surfaceLow,
        borderBottom: `1px solid ${DS.outlineVar}`,
        padding: '0 32px',
        height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={17} color={DS.primary} strokeWidth={1.8} />
          <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase', color: DS.onSurface }}>ECDAT</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999, background: `${DS.primary}18`, color: DS.primary, border: `1px solid ${DS.primary}40`, lineHeight: '18px' }}>
            v1.1-pqc
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {['SIH 2025', 'Documentation', 'NIST PQC'].map(link => (
            <span key={link} style={{ fontSize: 13, color: DS.muted, cursor: 'pointer' }}>{link}</span>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: `${DS.primary}14`, border: `1px solid ${DS.primary}40`, borderRadius: 4, padding: '4px 12px' }}>
            <Cpu size={12} color={DS.primary} />
            <span style={{ fontSize: 12, fontWeight: 600, color: DS.primary }}>CycloneDX 1.6</span>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '72px 32px 48px', textAlign: 'center', position: 'relative' }}>

        {/* Background glow */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 700, height: 320,
          background: `radial-gradient(ellipse at center, ${activeMode.color}14 0%, transparent 70%)`,
          pointerEvents: 'none', transition: 'background 0.4s',
        }} />

        {/* Status Badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: `${DS.primary}10`, border: `1px solid ${DS.primary}30`, borderRadius: 9999, padding: '5px 14px', marginBottom: 28 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: DS.emerald, display: 'inline-block' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: DS.primary, letterSpacing: '0.04em' }}>
            Enterprise DevSecOps · Cryptographic Risk Intelligence
          </span>
        </div>

        {/* Main Headline */}
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 900, lineHeight: 1.15, letterSpacing: '-0.02em', color: DS.onSurface, maxWidth: 900, marginBottom: 20 }}>
          Automated Cryptographic Discovery,{' '}
          <span style={{ color: DS.primary }}>Quantum Risk Assessment</span>{' '}
          &amp; Post-Quantum Migration.
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.7, color: DS.onVariant, maxWidth: 680, marginBottom: 48 }}>
          ECDAT is an enterprise DevSecOps engine that catalogues cryptographic assets across codebases, compiled binaries, and container images — modelling quantum exposure timelines and generating standard-compliant post-quantum migration paths.
        </p>

        {/* ── Scanner Card ── */}
        <div style={{ width: '100%', maxWidth: 740, background: DS.surfaceLow, border: `1px solid ${activeMode.border}`, borderRadius: 10, padding: 24, marginBottom: 16, transition: 'border-color 0.3s', boxShadow: `0 0 32px ${activeMode.color}08` }}>

          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: DS.muted, marginBottom: 14 }}>
            Unified Cryptographic Scanner
          </p>

          {/* 4-Mode Tab Toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: DS.surfaceHigh, borderRadius: 8, padding: 3 }}>
            {MODES.map(mode => (
              <ModeTab
                key={mode.id}
                mode={mode}
                active={inputMode === mode.id}
                onClick={() => switchMode(mode.id)}
              />
            ))}
          </div>

          {/* ── Mode description strip ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '8px 12px', background: `${activeMode.color}08`, borderRadius: 6, border: `1px solid ${activeMode.border}` }}>
            {(() => { const Icon = activeMode.icon; return <Icon size={13} color={activeMode.color} /> })()}
            <span style={{ fontSize: 12, color: activeMode.color, fontWeight: 500 }}>{activeMode.description}</span>
            {activeMode.limit && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999, background: `${activeMode.color}18`, color: activeMode.color, border: `1px solid ${activeMode.color}30` }}>
                {activeMode.limit}
              </span>
            )}
          </div>

          {/* Hidden inputs */}
          <input ref={folderInputRef} type="file" webkitdirectory="" multiple style={{ display: 'none' }} onChange={onFolderInputChange} />
          <input ref={fileInputRef}   type="file" style={{ display: 'none' }} onChange={onFileInputChange}
            accept={inputMode === 'binary' ? '.exe,.dll,.so,.elf,.bin,.dylib,.sys,.o' : inputMode === 'container' ? '.tar' : '.zip'}
          />

          {/* ── LOCAL MODE ── */}
          {inputMode === 'local' && (
            <>
              {(folderName || selectedFile) ? (
                <FileBadge
                  icon={FolderOpen}
                  label={folderName || selectedFile?.name}
                  sublabel={folderName ? `${selectedFiles?.length ?? 0} file${selectedFiles?.length !== 1 ? 's' : ''} selected` : formatBytes(selectedFile?.size || 0)}
                  color={DS.primary}
                  onClear={clearSelection}
                />
              ) : (
                <DropZone
                  icon={FolderOpen}
                  color={DS.primary}
                  label={<>Drop a folder here or <span style={{ color: DS.primary, textDecoration: 'underline' }}>browse</span></>}
                  sublabel="Folder is zipped in-browser — source code never leaves uncompressed"
                  limitLabel="Max 200 MB"
                  isDragging={isDragging}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onFileClick={() => folderInputRef.current?.click()}
                />
              )}
            </>
          )}

          {/* ── REMOTE MODE ── */}
          {inputMode === 'remote' && (
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <GitBranch size={14} color={DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                id="landing-remote-url-input"
                type="text"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                placeholder="https://github.com/example/sample-crypto-app"
                style={{
                  width: '100%', background: DS.surfaceHigh, border: `1px solid ${DS.outlineVar}`,
                  borderRadius: 6, color: DS.onSurface, fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13, padding: '10px 12px 10px 36px', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => (e.target.style.borderColor = DS.secondary)}
                onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
              />
            </div>
          )}

          {/* ── BINARY MODE ── */}
          {inputMode === 'binary' && (
            <>
              {selectedFile ? (
                <FileBadge
                  icon={Cpu}
                  label={selectedFile.name}
                  sublabel={`Binary · ${formatBytes(selectedFile.size)}`}
                  color={DS.tertiary}
                  onClear={clearSelection}
                />
              ) : (
                <DropZone
                  icon={HardDrive}
                  color={DS.tertiary}
                  label={<>Drop a binary here or <span style={{ color: DS.tertiary, textDecoration: 'underline' }}>browse</span></>}
                  sublabel=".exe · .dll · .so · .elf · .bin · .dylib — PE & ELF symbol analysis + crypto constant scan"
                  limitLabel="Max 100 MB"
                  isDragging={isDragging}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  onFileClick={() => fileInputRef.current?.click()}
                />
              )}
            </>
          )}

          {/* ── CONTAINER MODE ── */}
          {inputMode === 'container' && (
            <>
              {selectedFile ? (
                <FileBadge
                  icon={Package}
                  label={selectedFile.name}
                  sublabel={`Container image archive · ${formatBytes(selectedFile.size)}`}
                  color={DS.violet}
                  onClear={clearSelection}
                />
              ) : (
                <>
                  {/* Tar upload drop zone */}
                  <DropZone
                    icon={Box}
                    color={DS.violet}
                    label={<>Drop a <code style={{ background: `${DS.violet}18`, padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>.tar</code> archive or <span style={{ color: DS.violet, textDecoration: 'underline' }}>browse</span></>}
                    sublabel="docker save nginx:latest -o nginx.tar"
                    limitLabel="Max 500 MB"
                    isDragging={isDragging}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onFileClick={() => fileInputRef.current?.click()}
                  />

                  {/* Divider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ flex: 1, height: 1, background: DS.outlineVar }} />
                    <span style={{ fontSize: 11, color: DS.muted, fontWeight: 500 }}>or pull by tag</span>
                    <div style={{ flex: 1, height: 1, background: DS.outlineVar }} />
                  </div>

                  {/* Image tag input */}
                  <div
                    style={{ position: 'relative', marginBottom: 16 }}
                    title={containerTagDisabled ? dockerTooltip : ''}
                  >
                    <Package size={14} color={containerTagDisabled ? DS.outlineVar : DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    <input
                      id="landing-container-tag-input"
                      type="text"
                      value={containerTag}
                      disabled={containerTagDisabled}
                      onChange={e => setContainerTag(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !containerTagDisabled && handleScan()}
                      placeholder={containerTagDisabled ? 'Docker not installed on server' : 'nginx:latest · redis:7.0 · ubuntu:focal'}
                      style={{
                        width: '100%', background: containerTagDisabled ? DS.surfaceHigh : DS.surfaceHigh,
                        border: `1px solid ${containerTagDisabled ? DS.outlineVar : DS.outlineVar}`,
                        borderRadius: 6, color: containerTagDisabled ? DS.outline : DS.onSurface,
                        fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
                        padding: '10px 12px 10px 36px', outline: 'none', boxSizing: 'border-box',
                        opacity: containerTagDisabled ? 0.5 : 1,
                        cursor: containerTagDisabled ? 'not-allowed' : 'text',
                        transition: 'border-color 0.15s',
                      }}
                      onFocus={e => { if (!containerTagDisabled) e.target.style.borderColor = DS.violet }}
                      onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
                    />
                    {containerTagDisabled && (
                      <div style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <AlertTriangle size={12} color={DS.muted} />
                        <span style={{ fontSize: 10, color: DS.muted, whiteSpace: 'nowrap' }}>Docker unavailable</span>
                      </div>
                    )}
                  </div>

                  {/* Docker status notice */}
                  {dockerAvailable === false && (
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '8px 12px', borderRadius: 6,
                      background: `${DS.tertiary}0a`, border: `1px solid ${DS.tertiary}25`,
                      marginBottom: 16,
                    }}>
                      <AlertTriangle size={12} color={DS.tertiary} style={{ flexShrink: 0, marginTop: 1 }} />
                      <p style={{ fontSize: 11, color: DS.muted, lineHeight: 1.5, margin: 0 }}>
                        <span style={{ color: DS.tertiary, fontWeight: 600 }}>Docker not detected.</span>{' '}
                        Image-tag scanning is disabled. Install Docker Desktop and restart the backend to enable it.
                        You can still scan container images by dropping a <code style={{ background: `${DS.outlineVar}40`, padding: '0 4px', borderRadius: 3 }}>.tar</code> file above.
                      </p>
                    </div>
                  )}
                  {dockerAvailable === true && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16,
                      padding: '6px 10px', borderRadius: 6,
                      background: `${DS.emerald}08`, border: `1px solid ${DS.emerald}20`,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: DS.emerald, display: 'inline-block' }} />
                      <span style={{ fontSize: 11, color: DS.emerald, fontWeight: 500 }}>Docker is running — image-tag scanning enabled</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 4,
              background: `${DS.error}10`, border: `1px solid ${DS.error}40`,
              color: DS.error, fontSize: 12, marginBottom: 12,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              <AlertTriangle size={12} />
              {error}
            </div>
          )}

          {/* Scan Button */}
          <button
            id="btn-initiate-scan"
            onClick={handleScan}
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 6,
              background: loading ? '#374151' : '#f4f4f5',
              border: 'none',
              color: loading ? '#9ca3af' : '#09090b',
              fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s', letterSpacing: '0.01em',
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
                {loadingMessage()}
              </>
            ) : (
              <>
                <Shield size={14} fill="#09090b" strokeWidth={0} />
                {scanButtonLabel()}
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {SIH_CARDS.map(card => {
            const Icon = card.icon
            return (
              <div
                key={card.num}
                style={{
                  background: card.accentBg, border: `1px solid ${card.accentBorder}`,
                  borderRadius: 8, padding: 24,
                  display: 'flex', flexDirection: 'column', gap: 14,
                  position: 'relative', overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${card.accentColor}20, transparent 70%)`, pointerEvents: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${card.accentColor}18`, border: `1px solid ${card.accentColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} color={card.accentColor} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: `${card.accentColor}18`, color: card.accentColor, border: `1px solid ${card.accentColor}30` }}>{card.tag}</span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: DS.muted }}>{card.num}.</span>
                  </div>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: DS.onSurface, lineHeight: 1.3, margin: 0 }}>{card.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: DS.onVariant, margin: 0 }}>{card.plain}</p>
                <div style={{ height: 1, background: `${card.accentColor}15` }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <GitBranch size={12} color={card.accentColor} style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 12, lineHeight: 1.6, color: DS.muted, margin: 0 }}>{card.tech}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Tech Stack Footer Strip ── */}
      <div style={{
        borderTop: `1px solid ${DS.outlineVar}`,
        padding: '16px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, flexWrap: 'wrap',
        background: DS.surfaceLow,
      }}>
        {[
          ['Semgrep AST',         DS.secondary],
          ['Binary Analysis',     DS.tertiary],
          ['Container Scan',      DS.violet],
          ['CycloneDX 1.6',       DS.primary],
          ['NIST FIPS 203/204',   DS.emerald],
          ["Mosca's Theorem",     DS.tertiary],
          ['FastAPI Backend',     DS.muted],
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
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
