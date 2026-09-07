/**
 * InventoryPanel.jsx — ECDAT v1.0-pqc
 *
 * Full-screen overlay panel that shows the complete list of cryptographic assets.
 * Opened when the user clicks the "Inventory" tab in the dashboard header.
 *
 * Features:
 *  - Real-time search (algorithm, path, status, PQC target)
 *  - Sort by any column (click header)
 *  - Filter chips: All | Critical | Asymmetric | Symmetric | PQC-Ready
 *  - Paginated (30 rows + Load More) to keep rendering fast
 *  - CSV export of the current view
 *  - Closes on Escape key or ✕ button
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { X, Search, Download, ChevronUp, ChevronDown, Shield, AlertTriangle } from 'lucide-react'

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatus(c) {
  const risk = (c.mosca?.risk_level || '').toUpperCase()
  const type = (c.type || '').toLowerCase()
  if (type === 'library') return 'Deprecated'
  return risk === 'CRITICAL' ? 'Critical' : risk === 'LOW' ? 'Low' : 'Unknown'
}

function getSourcePath(c) {
  const occ  = c.evidence?.occurrences?.[0]
  if (!occ) return '—'
  const loc  = occ.location || ''
  const line = occ.line ? `:${occ.line}` : ''
  const short = loc.replace(/\\/g, '/').split('/dummy_target/').pop() || loc
  return short + line
}

function getTargetPQC(c) {
  if (c.recommendation?.pqc_algorithm) return c.recommendation.pqc_algorithm
  const action = c.recommendation?.action || c.description || ''
  const match  = action.match(/(?:ML-KEM|CRYSTALS-Kyber|SHA-3|AES-256|FALCON|SPHINCS\+|BIKE|HQC)/i)
  return match ? match[0] : '—'
}

function algoFamily(name = '') {
  const u = name.toUpperCase()
  if (u.includes('RSA') || u.includes('ECDSA') || u.includes('ECDH') || u.includes('DSA')) return 'asymmetric'
  if (u.includes('AES') || u.includes('SHA') || u.includes('MD5') || u.includes('DES') || u.includes('HMAC')) return 'symmetric'
  if (['ML-KEM','ML-DSA','KYBER','DILITHIUM','SLH-DSA','FALCON'].some(k => u.includes(k))) return 'pqc'
  return 'other'
}

const STATUS_BADGE = {
  Critical:   { bg: '#ffb4ab1a', color: '#ffb4ab' },
  Deprecated: { bg: '#ffb7831a', color: '#ffb783' },
  Low:        { bg: '#6ee7b71a', color: '#6ee7b7' },
  Unknown:    { bg: '#908fa01a', color: '#908fa0' },
}

const FILTERS = [
  { id: 'All',        label: 'All'        },
  { id: 'Critical',   label: '⚠ Critical' },
  { id: 'Asymmetric', label: 'Asymmetric' },
  { id: 'Symmetric',  label: 'Symmetric'  },
  { id: 'PQC-Ready',  label: '✓ PQC-Ready' },
]

const COLUMNS = [
  { key: 'name',    label: 'Algorithm'   },
  { key: 'status',  label: 'Status'      },
  { key: 'family',  label: 'Type'        },
  { key: 'path',    label: 'Source Path' },
  { key: 'pqc',     label: 'Target PQC'  },
]

const PAGE_SIZE = 30

// ── Component ─────────────────────────────────────────────────────────────────

export default function InventoryPanel({ components = [], onClose }) {
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState('All')
  const [sortKey,    setSortKey]    = useState('status')
  const [sortAsc,    setSortAsc]    = useState(true)
  const [page,       setPage]       = useState(1)

  // Close on Escape key
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Enrich components with derived fields once
  const enriched = useMemo(() => components.map(c => ({
    ...c,
    _status: getStatus(c),
    _path:   getSourcePath(c),
    _pqc:    getTargetPQC(c),
    _family: algoFamily(c.name),
  })), [components])

  // Filter + search
  const filtered = useMemo(() => {
    let list = enriched
    switch (filter) {
      case 'Critical':   list = list.filter(c => c._status === 'Critical'); break
      case 'Asymmetric': list = list.filter(c => c._family === 'asymmetric'); break
      case 'Symmetric':  list = list.filter(c => c._family === 'symmetric'); break
      case 'PQC-Ready':  list = list.filter(c => c._family === 'pqc'); break
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        (c.name  || '').toLowerCase().includes(q) ||
        c._path.toLowerCase().includes(q) ||
        c._pqc.toLowerCase().includes(q) ||
        c._status.toLowerCase().includes(q)
      )
    }
    return list
  }, [enriched, filter, search])

  // Sort
  const sorted = useMemo(() => {
    const order = { Critical: 0, Deprecated: 1, Low: 2, Unknown: 3 }
    return [...filtered].sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'name':   av = a.name   || ''; bv = b.name   || ''; break
        case 'status': av = order[a._status] ?? 9; bv = order[b._status] ?? 9; break
        case 'family': av = a._family || ''; bv = b._family || ''; break
        case 'path':   av = a._path  || ''; bv = b._path  || ''; break
        case 'pqc':    av = a._pqc   || ''; bv = b._pqc   || ''; break
        default:       return 0
      }
      if (typeof av === 'number') return sortAsc ? av - bv : bv - av
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [filtered, sortKey, sortAsc])

  const visible = sorted.slice(0, page * PAGE_SIZE)
  const hasMore = visible.length < sorted.length

  function handleSort(key) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
    setPage(1)
  }

  // CSV export
  const exportCSV = useCallback(() => {
    const header = 'Algorithm,Status,Type,Source Path,Target PQC'
    const rows   = sorted.map(c =>
      [c.name, c._status, c._family, c._path, c._pqc]
        .map(v => `"${(v || '').replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv  = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'ecdat-crypto-inventory.csv',
    })
    a.click()
  }, [sorted])

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <ChevronUp size={10} style={{ opacity: 0.2 }} />
    return sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />
  }

  return (
    <>
      {/* Backdrop — starts below the header */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 44, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.65)',
          zIndex: 98,
          animation: 'fadeInPanel 0.2s ease',
        }}
      />

      {/* Panel — slides down from below the sticky header */}
      <div
        style={{
          position: 'fixed',
          top: 44, left: 0, right: 0,
          bottom: 0,
          background: DS.bg,
          borderBottom: `2px solid ${DS.primary}50`,
          zIndex: 99,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideDownPanel 0.28s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* ── Panel Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${DS.outlineVar}`,
          background: DS.surfaceLow,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: `${DS.primary}18`, border: `1px solid ${DS.primary}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield size={14} color={DS.primary} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: DS.onSurface }}>
                Cryptographic Asset Inventory
              </div>
              <div style={{ fontSize: 11, color: DS.muted, marginTop: 1 }}>
                {components.length} total assets · {sorted.length} shown
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* CSV Export */}
            <button
              id="btn-inventory-export-csv"
              onClick={exportCSV}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 6,
                background: DS.surfaceHigh,
                border: `1px solid ${DS.outlineVar}`,
                color: DS.onVariant, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = DS.primary; e.currentTarget.style.color = DS.onSurface }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = DS.outlineVar; e.currentTarget.style.color = DS.onVariant }}
            >
              <Download size={12} />
              Export CSV
            </button>

            {/* Close */}
            <button
              id="btn-inventory-close"
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: DS.surfaceHigh,
                border: `1px solid ${DS.outlineVar}`,
                color: DS.muted, cursor: 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${DS.error}20`; e.currentTarget.style.color = DS.error }}
              onMouseLeave={e => { e.currentTarget.style.background = DS.surfaceHigh; e.currentTarget.style.color = DS.muted }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Search + Filters ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 20px',
          borderBottom: `1px solid ${DS.outlineVar}`,
          background: DS.surfaceLow,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}>
          {/* Search input */}
          <div style={{ position: 'relative', flex: '0 0 280px' }}>
            <Search size={13} color={DS.muted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              id="inventory-panel-search"
              type="text"
              placeholder="Search algorithm, path, status…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              style={{
                width: '100%',
                background: DS.surfaceHigh,
                border: `1px solid ${DS.outlineVar}`,
                borderRadius: 6,
                color: DS.onSurface,
                fontSize: 13,
                padding: '7px 10px 7px 32px',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'Inter, sans-serif',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = DS.primary)}
              onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
            />
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FILTERS.map(f => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); setPage(1) }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 9999,
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    background: active ? `${DS.primary}20` : DS.surfaceHigh,
                    border:     active ? `1px solid ${DS.primary}60` : `1px solid ${DS.outlineVar}`,
                    color:      active ? DS.primary : DS.muted,
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>

          <div style={{ marginLeft: 'auto', fontSize: 12, color: DS.muted }}>
            {sorted.length} / {enriched.length} assets
          </div>
        </div>

        {/* ── Table ── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {components.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: DS.muted }}>
              <AlertTriangle size={32} strokeWidth={1.2} />
              <p style={{ fontSize: 14 }}>Run a scan to populate the inventory.</p>
            </div>
          ) : sorted.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: DS.muted }}>
              <Search size={24} strokeWidth={1.2} />
              <p style={{ fontSize: 13 }}>No assets match your search.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr style={{ background: DS.surfaceHigh, borderBottom: `1px solid ${DS.outlineVar}` }}>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        textAlign: 'left',
                        padding: '9px 16px',
                        fontSize: 11, fontWeight: 700,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: sortKey === col.key ? DS.primary : DS.muted,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                        transition: 'color 0.15s',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {col.label}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((c, i) => {
                  const badge = STATUS_BADGE[c._status] || STATUS_BADGE.Unknown
                  return (
                    <tr
                      key={c['bom-ref'] || i}
                      style={{
                        borderBottom: `1px solid ${DS.outlineVar}`,
                        transition: 'background 0.1s',
                        cursor: 'default',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = `${DS.primary}08`)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Algorithm */}
                      <td style={{ padding: '9px 16px' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: DS.onSurface }}>
                          {c.name || '—'}
                        </span>
                      </td>

                      {/* Status badge */}
                      <td style={{ padding: '9px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          padding: '2px 9px', borderRadius: 9999,
                          background: badge.bg, color: badge.color,
                          fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                        }}>
                          {c._status}
                        </span>
                      </td>

                      {/* Family */}
                      <td style={{ padding: '9px 16px' }}>
                        <span style={{ fontSize: 12, color: DS.muted, textTransform: 'capitalize' }}>
                          {c._family}
                        </span>
                      </td>

                      {/* Source path */}
                      <td style={{ padding: '9px 16px' }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11, color: DS.secondary,
                          lineHeight: '18px',
                        }}>
                          {c._path}
                        </span>
                      </td>

                      {/* Target PQC */}
                      <td style={{ padding: '9px 16px' }}>
                        <span style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11, color: DS.onVariant,
                        }}>
                          {c._pqc}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Load more */}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <button
                onClick={() => setPage(p => p + 1)}
                style={{
                  padding: '8px 24px', borderRadius: 6,
                  background: DS.surfaceHigh,
                  border: `1px solid ${DS.outlineVar}`,
                  color: DS.onVariant, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = DS.primary)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = DS.outlineVar)}
              >
                Load more ({sorted.length - visible.length} remaining)
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeInPanel {
          from { opacity: 0 } to { opacity: 1 }
        }
        @keyframes slideDownPanel {
          from { transform: translateY(-100%) }
          to   { transform: translateY(0) }
        }
      `}</style>
    </>
  )
}
