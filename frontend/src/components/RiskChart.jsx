/**
 * RiskChart.jsx
 * Recharts BarChart — frequency of each cryptographic algorithm found.
 * Parses the `components` array, counts names, and renders a responsive
 * horizontal bar chart with a dark enterprise palette.
 */
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

// Colour sequence for bars (cycles if more than 6 algorithms)
const BAR_COLORS = [
  '#fc8181', // red   – often the critical ones (MD5, DES …)
  '#63b3ed', // blue
  '#b794f4', // purple
  '#f6ad55', // amber
  '#68d391', // green
  '#76e4f7', // cyan
]

// Custom tooltip with dark glass style
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="px-4 py-3 rounded-xl text-xs"
      style={{
        background: 'rgba(8,12,20,0.95)',
        border: '1px solid rgba(99,179,237,0.25)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        color: '#e2e8f0',
      }}
    >
      <p className="font-bold mb-1">{label}</p>
      <p style={{ color: payload[0]?.color }}>
        {payload[0]?.value} occurrence{payload[0]?.value !== 1 ? 's' : ''}
      </p>
    </div>
  )
}

export default function RiskChart({ components }) {
  // Build frequency map
  const freq = {}
  for (const c of components) {
    const name = c.name || 'Unknown'
    freq[name] = (freq[name] || 0) + 1
  }

  const data = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs" style={{ color: '#4a5568' }}>
        No data to chart
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={data.length * 48 + 32} minHeight={160}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
        barCategoryGap="30%"
      >
        <CartesianGrid
          horizontal={false}
          strokeDasharray="3 3"
          stroke="rgba(99,179,237,0.07)"
        />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: '#4a5568', fontSize: 10 }}
          axisLine={{ stroke: 'rgba(99,179,237,0.1)' }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={72}
          tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99,179,237,0.05)' }} />
        <Bar dataKey="count" radius={[0, 6, 6, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
