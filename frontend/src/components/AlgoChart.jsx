/**
 * AlgoChart.jsx
 * Custom horizontal bar chart designed precisely to match the requested image:
 * "Algorithm distribution", exact status colors (green/yellow/red), horizontal
 * bar tracks, right-aligned usage counts, and a bottom legend.
 */
import { useMemo } from 'react'

const DS = {
  surfaceLow:  '#1b1b23',
  surfaceHigh: '#292932',
  outlineVar:  '#464554',
  onSurface:   '#e4e1ed',
  onVariant:   '#c7c4d7',
  muted:       '#908fa0',
}

// Exact colors sampled from the reference image
const STATUS_COLORS = {
  safe:       '#55a362', // Green (quantum-safe)
  weakened:   '#b89e41', // Yellow/Gold (weakened)
  vulnerable: '#ba4f4d', // Red/Rose (vulnerable)
}

function bucketAlgoAndStatus(name = '', component) {
  const u = name.toUpperCase()
  
  if (u.includes('ML-KEM') || u.includes('KYBER')) return { label: 'ML-KEM', status: 'safe' }
  if (u.includes('AES')) return { label: 'AES', status: 'safe' }
  if (u.includes('HMAC')) return { label: 'HMAC', status: 'safe' }
  if (u.includes('SHA-2') || u.includes('SHA256') || u.includes('SHA512')) return { label: 'SHA-2', status: 'safe' }
  
  if (u.includes('SHA-1') || u.includes('SHA1')) return { label: 'SHA-1', status: 'weakened' }
  if (u.includes('3DES') || u.includes('RC4') || u.includes('MD5') || u.includes('DES')) return { label: '3DES / RC4 / MD5', status: 'weakened' }
  
  if (u.includes('RSA')) return { label: 'RSA', status: 'vulnerable' }
  if (u.includes('ECDSA') || u.includes('ECDH')) return { label: 'ECDSA / ECDH', status: 'vulnerable' }
  if (u.includes('ED25519') || u.includes('X25519')) return { label: 'Ed25519 / X25519', status: 'vulnerable' }
  if (u.includes('ECC') || u.includes('EC')) return { label: 'ECDSA / ECDH', status: 'vulnerable' }
  
  // Default fallback based on MOSCA risk level if available
  const risk = (component?.mosca?.risk_level || '').toUpperCase()
  if (risk === 'CRITICAL') return { label: name.split('-')[0] || 'Other', status: 'vulnerable' }
  if (risk === 'MEDIUM' || risk === 'LOW') return { label: name.split('-')[0] || 'Other', status: 'weakened' }
  
  return { label: name.split('-')[0] || 'Other', status: 'safe' }
}

export default function AlgoChart({ components = [] }) {
  const { data, totalUsages } = useMemo(() => {
    const counts = {}
    let total = 0
    components.forEach(c => {
      const { label, status } = bucketAlgoAndStatus(c.name, c)
      if (!counts[label]) counts[label] = { label, status, count: 0 }
      counts[label].count++
      total++
    })
    // Sort by count descending
    const sorted = Object.values(counts).sort((a, b) => b.count - a.count)
    return { data: sorted, totalUsages: total }
  }, [components])

  if (data.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: DS.muted }}>
        <p style={{ fontSize: 12 }}>No data — run a scan</p>
      </div>
    )
  }

  const maxCount = Math.max(...data.map(d => d.count))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* Header matching the image */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          paddingBottom: 14,
          marginBottom: 4,
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f8f8f2', margin: 0 }}>
          Algorithm distribution
        </h3>
        <span style={{ fontSize: 13, color: '#6272a4', fontFamily: "'JetBrains Mono', monospace" }}>
          {totalUsages} <span style={{ color: '#6272a4', fontFamily: 'Inter, sans-serif' }}>usages</span>
        </span>
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.map((item, idx) => {
          // Calculate percentage width (minimum 2% so very small counts are still visible)
          const pct = Math.max(2, (item.count / maxCount) * 100)
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Algorithm Name */}
              <div
                style={{
                  width: 150,
                  flexShrink: 0,
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#f8f8f2',
                }}
              >
                {item.label}
              </div>
              
              {/* Background Track + Foreground Bar */}
              <div
                style={{
                  flex: 1,
                  background: '#1a1b1e', // Dark track color from image
                  height: 10,
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div 
                  style={{ 
                    width: `${pct}%`, 
                    background: STATUS_COLORS[item.status], 
                    height: '100%', 
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }} 
                />
              </div>

              {/* Usage Count */}
              <div
                style={{
                  width: 32,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontSize: 14,
                  color: '#c7c4d7',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {item.count}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom Legend */}
      <div style={{ display: 'flex', gap: 24, paddingTop: 12 }}>
        {[
          { label: 'quantum-safe', color: STATUS_COLORS.safe },
          { label: 'weakened', color: STATUS_COLORS.weakened },
          { label: 'vulnerable', color: STATUS_COLORS.vulnerable },
        ].map(lg => (
          <div key={lg.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: lg.color,
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 13, color: '#6272a4' }}>{lg.label}</span>
          </div>
        ))}
      </div>

    </div>
  )
}
