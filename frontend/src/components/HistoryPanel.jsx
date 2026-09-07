/**
 * HistoryPanel.jsx — ECDAT v1.0-pqc
 *
 * Shows all previous scans stored in Supabase (scan_history table).
 * Stored data: scan metadata + CycloneDX BOM JSON only — no source code.
 *
 * Features:
 *  - Chronological list of past scans
 *  - Click any row to reload that BOM into the current session
 *  - Delete individual entries
 *  - Empty state, loading state, error state
 */

import { useState, useEffect, useCallback } from 'react'
import { Clock, Trash2, RefreshCw, ChevronRight, Shield, AlertTriangle, Database } from 'lucide-react'
import { getHistory, deleteHistoryEntry } from '../supabase'

const DS = {
  bg:          '#13131b',
  surfaceLow:  '#1b1b23',
  surfaceHigh: '#292932',
  onSurface:   '#e4e1ed',
  onVariant:   '#c7c4d7',
  outlineVar:  '#464554',
  error:       '#ffb4ab',
  tertiary:    '#ffb783',
  emerald:     '#6ee7b7',
  primary:     '#c0c1ff',
  secondary:   '#4cd7f6',
  muted:       '#908fa0',
}

function formatDate(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleString('en-IN', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function shortId(id = '') {
  return id.split('-')[0].toUpperCase()
}

export default function HistoryPanel({ userId, onLoadScan }) {
  const [history,    setHistory]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [hovered,    setHovered]    = useState(null)

  const fetchHistory = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await getHistory(userId)
    setLoading(false)
    if (err) return setError(err.message)
    setHistory(data || [])
  }, [userId])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!window.confirm('Delete this scan from history?')) return
    setDeletingId(id)
    await deleteHistoryEntry(id)
    setHistory(prev => prev.filter(h => h.id !== id))
    setDeletingId(null)
  }

  function handleLoad(entry) {
    if (!entry.bom_json) return
    onLoadScan(entry.bom_json, entry.target)
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (!userId) {
    return (
      <div style={containerStyle}>
        <EmptyState
          icon={<Shield size={36} strokeWidth={1.2} color={DS.muted} />}
          title="Sign in to view scan history"
          sub="Your scan results are saved securely per-account."
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: DS.muted }}>
          <svg style={{ width: 28, height: 28, animation: 'spin-history 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke={`${DS.primary}30`} strokeWidth="2" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke={DS.primary} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 13 }}>Loading scan history…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 6,
          background: `${DS.error}12`, border: `1px solid ${DS.error}40`,
          color: DS.error, fontSize: 13,
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          {error}
          <button
            onClick={fetchHistory}
            style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', color: DS.primary,
              fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div style={containerStyle}>
        <EmptyState
          icon={<Clock size={36} strokeWidth={1.2} color={DS.muted} />}
          title="No scan history yet"
          sub="Completed scans will appear here automatically."
        />
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={15} color={DS.primary} />
          <span style={{ fontSize: 14, fontWeight: 700, color: DS.onSurface }}>Scan History</span>
          <span style={{
            fontSize: 11, fontWeight: 700,
            padding: '1px 8px', borderRadius: 9999,
            background: `${DS.primary}18`, color: DS.primary,
            border: `1px solid ${DS.primary}30`,
          }}>
            {history.length} session{history.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          id="btn-history-refresh"
          onClick={fetchHistory}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: DS.surfaceHigh,
            border: `1px solid ${DS.outlineVar}`,
            borderRadius: 6, padding: '5px 12px',
            color: DS.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = DS.primary; e.currentTarget.style.color = DS.primary }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = DS.outlineVar; e.currentTarget.style.color = DS.muted }}
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '100px 1fr 80px 80px 100px 36px',
        gap: 8,
        padding: '6px 14px',
        background: DS.bg,
        borderRadius: '6px 6px 0 0',
        border: `1px solid ${DS.outlineVar}`,
        borderBottom: 'none',
      }}>
        {['Scan ID', 'Target', 'Assets', 'Critical', 'Date', ''].map(h => (
          <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ border: `1px solid ${DS.outlineVar}`, borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {history.map((entry, i) => {
          const isHovered = hovered === entry.id
          const isDeleting = deletingId === entry.id
          const isLast = i === history.length - 1

          return (
            <div
              key={entry.id}
              onClick={() => handleLoad(entry)}
              onMouseEnter={() => setHovered(entry.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '100px 1fr 80px 80px 100px 36px',
                gap: 8,
                padding: '11px 14px',
                borderBottom: isLast ? 'none' : `1px solid ${DS.outlineVar}`,
                background: isHovered ? `${DS.primary}08` : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.1s',
                alignItems: 'center',
                opacity: isDeleting ? 0.4 : 1,
              }}
            >
              {/* Scan ID */}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, fontWeight: 700,
                color: DS.primary,
                background: `${DS.primary}12`,
                border: `1px solid ${DS.primary}25`,
                borderRadius: 4, padding: '1px 6px',
                display: 'inline-block',
              }}>
                {shortId(entry.id)}
              </span>

              {/* Target */}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, color: DS.secondary,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {entry.target || 'unknown'}
              </span>

              {/* Total assets */}
              <span style={{ fontSize: 13, fontWeight: 700, color: DS.onSurface }}>
                {entry.total ?? '—'}
              </span>

              {/* Critical count */}
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: (entry.critical ?? 0) > 0 ? DS.error : DS.emerald,
              }}>
                {entry.critical ?? '—'}
              </span>

              {/* Date */}
              <span style={{ fontSize: 11, color: DS.muted }}>
                {formatDate(entry.scanned_at)}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={e => handleDelete(e, entry.id)}
                  disabled={isDeleting}
                  title="Delete this scan"
                  style={{
                    background: 'none', border: 'none',
                    color: isHovered ? DS.error : DS.outlineVar,
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    padding: 4, borderRadius: 4,
                    transition: 'color 0.15s',
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p style={{ fontSize: 11, color: DS.muted, marginTop: 10, textAlign: 'right' }}>
        Click any row to reload that scan into the dashboard.
      </p>

      <style>{`
        @keyframes spin-history {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

const containerStyle = {
  padding: '20px 0',
  display: 'flex',
  flexDirection: 'column',
}

function EmptyState({ icon, title, sub }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '56px 0', gap: 12, color: DS.muted,
    }}>
      {icon}
      <p style={{ fontSize: 14, fontWeight: 600, color: DS.onVariant, marginTop: 4 }}>{title}</p>
      <p style={{ fontSize: 12, textAlign: 'center', maxWidth: 320 }}>{sub}</p>
    </div>
  )
}
