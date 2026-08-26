/**
 * Dashboard.jsx
 * Main results wrapper rendered after a successful scan.
 * Lays out summary pills, the bar chart, and the inventory table
 * in a responsive dark-glass grid.
 */
import RiskChart from './RiskChart'
import InventoryTable from './InventoryTable'

// ── Summary pill ─────────────────────────────────────────────────────────────
function StatPill({ label, value, color, icon }) {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 rounded-2xl"
      style={{
        background: 'rgba(13,22,40,0.85)',
        border: `1px solid ${color}22`,
        backdropFilter: 'blur(12px)',
        boxShadow: `0 0 0 1px ${color}10, 0 8px 32px rgba(0,0,0,0.3)`,
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
        style={{ background: `${color}14`, border: `1px solid ${color}30` }}
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-black tabular-nums leading-none" style={{ color }}>
          {value}
        </p>
        <p className="text-xs font-medium mt-0.5" style={{ color: '#64748b' }}>
          {label}
        </p>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ bom }) {
  const summary    = bom.summary    || {}
  const components = bom.components || []

  return (
    <section
      id="dashboard"
      className="w-full space-y-6"
      style={{ animation: 'fade-up 0.5s ease both' }}
    >
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e2e8f0' }}>
            Scan Results
          </h2>
          <p className="text-xs mt-0.5 font-mono" style={{ color: '#4a5568' }}>
            Serial:{' '}
            <span style={{ color: '#63b3ed' }}>{bom.serialNumber || '—'}</span>
          </p>
        </div>
        <span
          className="px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider"
          style={{
            background: 'rgba(118,228,247,0.08)',
            border: '1px solid rgba(118,228,247,0.22)',
            color: '#76e4f7',
          }}
        >
          CycloneDX {bom.specVersion || '1.6'}
        </span>
      </div>

      {/* ── Summary pills ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatPill
          label="Total Findings"
          value={summary.total_findings ?? components.length}
          color="#63b3ed"
          icon="🔍"
        />
        <StatPill
          label="Critical"
          value={summary.critical_count ?? 0}
          color="#fc8181"
          icon="🚨"
        />
        <StatPill
          label="Low Risk"
          value={summary.low_count ?? 0}
          color="#68d391"
          icon="✅"
        />
      </div>

      {/* ── Chart + Table grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Bar chart (2/5 width on large screens) */}
        <div
          className="lg:col-span-2 rounded-2xl p-5"
          style={{
            background: 'rgba(13,22,40,0.85)',
            border: '1px solid rgba(99,179,237,0.1)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <h3
            className="text-xs font-semibold uppercase tracking-widest mb-4"
            style={{ color: '#63b3ed' }}
          >
            Algorithm Frequency
          </h3>
          <RiskChart components={components} />
        </div>

        {/* Inventory table (3/5 width on large screens) */}
        <div
          className="lg:col-span-3 rounded-2xl p-5"
          style={{
            background: 'rgba(13,22,40,0.85)',
            border: '1px solid rgba(99,179,237,0.1)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <h3
            className="text-xs font-semibold uppercase tracking-widest mb-4"
            style={{ color: '#63b3ed' }}
          >
            Cryptographic Asset Inventory
          </h3>
          <InventoryTable components={components} />
        </div>
      </div>
    </section>
  )
}
