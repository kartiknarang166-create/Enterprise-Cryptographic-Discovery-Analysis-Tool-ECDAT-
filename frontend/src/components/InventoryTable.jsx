/**
 * InventoryTable.jsx
 * Filterable table of cryptographic assets.
 * Columns: Asset Name · Type · Risk Level · NIST Recommendation
 *
 * NIST recommendation is extracted from the `description` field by looking
 * for a "Recommendation:" or "Upgrade to" prefix, falling back to the
 * `recommendation.action` property if present.
 */
import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractNist(component) {
  // 1. Dedicated recommendation object (our backend schema)
  if (component.recommendation?.action) {
    const pqc = component.recommendation.pqc_algorithm
      ? ` → ${component.recommendation.pqc_algorithm}`
      : ''
    return component.recommendation.action + pqc
  }
  // 2. Parse description for "Recommendation:" keyword
  const desc = component.description || ''
  const match = desc.match(/[Rr]ecommend(?:ation)?[:\s]+([^.]+\.?)/i)
  if (match) return match[1].trim()
  // 3. Parse for "Upgrade to …"
  const upg = desc.match(/[Uu]pgrade to ([^.]+\.?)/i)
  if (upg) return upg[1].trim()
  // 4. Fallback
  return '—'
}

function riskColor(level) {
  switch ((level || '').toUpperCase()) {
    case 'CRITICAL': return { color: '#fc8181', bg: 'rgba(252,129,129,0.12)', border: 'rgba(252,129,129,0.35)' }
    case 'HIGH':     return { color: '#f6ad55', bg: 'rgba(246,173,85,0.12)',  border: 'rgba(246,173,85,0.35)'  }
    case 'MEDIUM':   return { color: '#76e4f7', bg: 'rgba(118,228,247,0.1)', border: 'rgba(118,228,247,0.3)'  }
    case 'LOW':      return { color: '#68d391', bg: 'rgba(104,211,145,0.12)', border: 'rgba(104,211,145,0.35)' }
    default:         return { color: '#64748b', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.25)' }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RiskBadge({ level }) {
  const c = riskColor(level)
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold tracking-wide"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color, boxShadow: `0 0 5px ${c.color}` }} />
      {level || 'UNKNOWN'}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InventoryTable({ components }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return components
    return components.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.type || '').toLowerCase().includes(q)
    )
  }, [components, query])

  return (
    <div className="flex flex-col gap-3">
      {/* Search bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{
          background: 'rgba(8,12,20,0.7)',
          border: '1px solid rgba(99,179,237,0.12)',
        }}
      >
        <Search size={14} color="#4a5568" />
        <input
          id="inventory-search"
          type="text"
          placeholder="Filter by asset name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-slate-600"
          style={{ color: '#e2e8f0' }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="text-slate-600 hover:text-slate-400 transition-colors text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(99,179,237,0.08)' }}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr style={{ background: 'rgba(8,12,20,0.9)', borderBottom: '1px solid rgba(99,179,237,0.1)' }}>
              {['Asset Name', 'Type', 'Risk Level', 'NIST Recommendation'].map(h => (
                <th
                  key={h}
                  className="text-left px-4 py-3 font-semibold uppercase tracking-widest"
                  style={{ color: '#4a5568' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10" style={{ color: '#4a5568' }}>
                  No assets match your search.
                </td>
              </tr>
            ) : (
              filtered.map((c, i) => {
                const riskLevel = c.mosca?.risk_level || 'UNKNOWN'
                const nist      = extractNist(c)
                return (
                  <tr
                    key={c['bom-ref'] || i}
                    className="transition-colors duration-150"
                    style={{
                      borderBottom: '1px solid rgba(99,179,237,0.06)',
                      background: i % 2 === 0 ? 'transparent' : 'rgba(99,179,237,0.02)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,179,237,0.05)')}
                    onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(99,179,237,0.02)')}
                  >
                    {/* Asset Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs flex-shrink-0"
                          style={{
                            background: 'rgba(99,179,237,0.1)',
                            border: '1px solid rgba(99,179,237,0.2)',
                            color: '#63b3ed',
                          }}
                        >
                          {(c.name || '?').slice(0, 3).toUpperCase()}
                        </div>
                        <span className="font-semibold" style={{ color: '#e2e8f0' }}>
                          {c.name || '—'}
                        </span>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3 font-mono" style={{ color: '#64748b' }}>
                      {c.type || '—'}
                    </td>

                    {/* Risk Level */}
                    <td className="px-4 py-3">
                      <RiskBadge level={riskLevel} />
                    </td>

                    {/* NIST Recommendation */}
                    <td className="px-4 py-3 max-w-xs" style={{ color: '#94a3b8' }}>
                      <span className="leading-relaxed">{nist}</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Row count */}
      <p className="text-xs text-right" style={{ color: '#4a5568' }}>
        Showing {filtered.length} of {components.length} asset{components.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
