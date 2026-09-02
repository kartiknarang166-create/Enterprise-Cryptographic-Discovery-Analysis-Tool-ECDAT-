/**
 * InventoryTable.jsx — DESIGN.md refactor
 *
 * Changes:
 *  - Surface tokens: #1b1b23 bg, #464554 outline-variant borders
 *  - JetBrains Mono on Source Path + Target PQC cells (data-mono)
 *  - Row dividers: 1px horizontal ONLY — no vertical grid lines
 *  - Badge radius: 9999px (pill), 10% opacity semantic bg + solid foreground text
 *  - Filter tabs: clear default/active state backgrounds with DESIGN.md colors
 *  - Header cells: label-caps style (Inter 11px 700 0.05em uppercase)
 */
import { useState, useMemo } from 'react'

// ── DESIGN.md tokens (local copy for component isolation) ─────────────────────
const DS = {
  surfaceLow:  '#1b1b23',
  surfaceHigh: '#292932',
  bg:          '#13131b',
  onSurface:   '#e4e1ed',
  onVariant:   '#c7c4d7',
  outline:     '#908fa0',
  outlineVar:  '#464554',
  error:       '#ffb4ab',   // Rose — Quantum Critical
  tertiary:    '#ffb783',   // Amber — Deprecated
  emerald:     '#6ee7b7',   // Compliant
  secondary:   '#4cd7f6',   // Cyan — Source Path highlight
  primary:     '#c0c1ff',
  muted:       '#908fa0',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatus(component) {
  const risk = (component.mosca?.risk_level || '').toUpperCase()
  const type = (component.type || '').toLowerCase()
  if (type === 'library') return 'Deprecated'
  return risk === 'CRITICAL' ? 'Critical' : risk === 'LOW' ? 'Low' : 'Unknown'
}

function getSourcePath(component) {
  const occ = component.evidence?.occurrences?.[0]
  if (!occ) return '—'
  const loc  = occ.location || ''
  const line = occ.line ? `:${occ.line}` : ''
  const short = loc.replace(/\\/g, '/').split('/dummy_target/').pop() || loc
  return short + line
}

function getTargetPQC(component) {
  if (component.recommendation?.pqc_algorithm) return component.recommendation.pqc_algorithm
  const action = component.recommendation?.action || component.description || ''
  const match  = action.match(/(?:ML-KEM|CRYSTALS-Kyber|SHA-3|AES-256|FALCON|SPHINCS\+|BIKE|HQC)/i)
  if (match) return match[0]
  return '—'
}

function algoFamily(name = '') {
  const u = name.toUpperCase()
  if (u.includes('RSA') || u.includes('ECDSA') || u.includes('ECDH') || u.includes('DSA')) return 'asymmetric'
  if (u.includes('AES') || u.includes('SHA') || u.includes('MD5') || u.includes('DES') || u.includes('HMAC')) return 'symmetric'
  return 'other'
}

// Badge config: 10% opacity semantic bg, solid text foreground
const STATUS_CFG = {
  Critical:   { bg: '#ffb4ab1a', color: '#ffb4ab' },
  Deprecated: { bg: '#ffb7831a', color: '#ffb783' },
  Low:        { bg: '#6ee7b71a', color: '#6ee7b7' },
  Unknown:    { bg: '#908fa01a', color: '#908fa0' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.Unknown
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 8px',
        borderRadius: 9999,          // DESIGN.md: pill = 9999px
        background: cfg.bg,
        color: cfg.color,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  )
}

const FILTERS = ['All', 'Critical Risk', 'Asymmetric', 'Symmetric/Hash']

// Active filter: semantic-coloured background + border
// Default filter: surface-high bg, outline-variant border
function filterStyle(f, active) {
  if (!active) {
    return {
      background: DS.surfaceHigh,
      border: `1px solid ${DS.outlineVar}`,
      color: DS.muted,
    }
  }
  if (f === 'Critical Risk') {
    return {
      background: `${DS.error}1a`,
      border: `1px solid ${DS.error}60`,
      color: DS.error,
    }
  }
  return {
    background: `${DS.primary}1a`,
    border: `1px solid ${DS.primary}60`,
    color: DS.primary,
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function InventoryTable({ components = [], searchQuery = '', onFilterChange }) {
  const [activeFilter, setActiveFilter] = useState('All')

  function handleFilterChange(f) {
    setActiveFilter(f)
    if (onFilterChange) onFilterChange(f)
  }

  const filtered = useMemo(() => {
    let result = components
    switch (activeFilter) {
      case 'Critical Risk':   result = components.filter(c => getStatus(c) === 'Critical'); break;
      case 'Asymmetric':      result = components.filter(c => algoFamily(c.name) === 'asymmetric'); break;
      case 'Symmetric/Hash':  result = components.filter(c => algoFamily(c.name) === 'symmetric'); break;
      default:                result = components; break;
    }

    if (searchQuery && searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase()
      result = result.filter(c => 
        (c.name || '').toLowerCase().includes(q) ||
        getSourcePath(c).toLowerCase().includes(q) ||
        getTargetPQC(c).toLowerCase().includes(q)
      )
    }
    return result
  }, [components, activeFilter, searchQuery])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Filter tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: activeFilter === f ? 700 : 500,
              cursor: 'pointer',
              transition: 'background 0.12s, color 0.12s, border-color 0.12s',
              ...filterStyle(f, activeFilter === f),
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table — overflow-x for narrow viewports */}
      <div style={{ overflowX: 'auto', borderRadius: 4, border: `1px solid ${DS.outlineVar}` }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',   // ensures no vertical grid lines
            tableLayout: 'auto',
          }}
        >
          {/* Header — label-caps: Inter 11px 700 0.05em uppercase */}
          <thead>
            <tr
              style={{
                background: DS.bg,
                borderBottom: `1px solid ${DS.outlineVar}`,
              }}
            >
              {['Algorithm', 'Status', 'Source Path', 'Target PQC', 'Inspect (AST)'].map(h => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '8px 14px',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: DS.muted,
                    whiteSpace: 'nowrap',
                    // No border-right — no vertical lines
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ textAlign: 'center', padding: '28px 0', fontSize: 12, color: DS.muted }}
                >
                  No findings match this filter.
                </td>
              </tr>
            ) : (
              filtered.map((c, i) => {
                const status = getStatus(c)
                const path   = getSourcePath(c)
                const pqc    = getTargetPQC(c)
                return (
                  <tr
                    key={c['bom-ref'] || i}
                    style={{
                      // Horizontal divider only — strictly no vertical lines (borderCollapse=collapse + no td border-right)
                      borderBottom: `1px solid ${DS.outlineVar}`,
                      background: 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = `${DS.primary}08`)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Algorithm — Inter, on-surface */}
                    <td style={{ padding: '8px 14px' }}>
                      <span
                        style={{
                          fontFamily: 'Inter, sans-serif',
                          fontSize: 13,
                          fontWeight: 600,
                          color: DS.onSurface,
                        }}
                      >
                        {c.name || '—'}
                      </span>
                    </td>

                    {/* Status — pill badge */}
                    <td style={{ padding: '8px 14px' }}>
                      <StatusBadge status={status} />
                    </td>

                    {/* Source Path — JetBrains Mono (data-mono) */}
                    <td style={{ padding: '8px 14px' }}>
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12,
                          color: DS.secondary,
                          lineHeight: '18px',
                        }}
                      >
                        {path}
                      </span>
                    </td>

                    {/* Target PQC — JetBrains Mono (data-mono) */}
                    <td style={{ padding: '8px 14px' }}>
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 12,
                          color: DS.onVariant,
                          lineHeight: '18px',
                        }}
                      >
                        {pqc}
                      </span>
                    </td>

                    {/* Inspect (AST) */}
                    <td style={{ padding: '8px 14px' }}>
                      <button
                        style={{
                          background: 'none',
                          border: 'none',
                          color: DS.primary,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                        onClick={() => alert(`Inspecting ${c.name} at ${path}`)}
                      >
                        View Code
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Row count */}
      <p style={{ fontSize: 11, color: DS.muted, textAlign: 'right', marginTop: 6 }}>
        {filtered.length} / {components.length} asset{components.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
