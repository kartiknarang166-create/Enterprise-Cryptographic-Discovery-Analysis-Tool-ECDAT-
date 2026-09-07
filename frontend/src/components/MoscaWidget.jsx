/**
 * MoscaWidget.jsx — DESIGN.md refactor
 *
 * Changes:
 *  - Formula "X + Y > Z": each variable color-coded to match its progress bar below
 *  - Interactive HTML range sliders REPLACED with flat non-interactive progress bars
 *  - Verdict card: solid #93000a (error-container) background, centered Rose text only
 *    — raw arithmetic string removed
 *  - Surface tokens: #1b1b23 bg, #464554 borders
 *  - Typography: Inter UI, JetBrains Mono for year values (data-mono)
 */
import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'

// ── DESIGN.md tokens ──────────────────────────────────────────────────────────
const DS = {
  surfaceLow: '#1b1b23',
  outlineVar: '#464554',
  onSurface:  '#e4e1ed',
  onVariant:  '#c7c4d7',
  muted:      '#908fa0',
  error:      '#ffb4ab',        // Rose — Quantum Critical
  errorCont:  '#93000a',        // error-container — solid Verdict bg
  // Per-variable colors matching progress bars
  xColor:     '#c0c1ff',        // primary / indigo  → Data Shelf-Life
  yColor:     '#4cd7f6',        // secondary / cyan  → Migration Time
  zColor:     '#ffb783',        // tertiary / amber  → Quantum Horizon
  emerald:    '#6ee7b7',
}

// ── Flat progress bar (non-interactive — no thumb) ───────────────────────────
function ProgressBar({ label, value, min, max, color, yearValue }) {
  const pct = Math.round(((value - min) / (max - min)) * 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {/* Label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: DS.muted }}>{label}</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            fontWeight: 600,
            color,
            lineHeight: '18px',
          }}
        >
          {yearValue}y
        </span>
      </div>
      {/* Track */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: DS.outlineVar,
          overflow: 'hidden',
        }}
      >
        {/* Fill — flat, no thumb, pointer-events none */}
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            borderRadius: 2,
            background: color,
            pointerEvents: 'none',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}

// ── Main Widget ───────────────────────────────────────────────────────────────
export default function MoscaWidget({ initialX = 20, initialY = 5, initialZ = 10 }) {
  const [x, setX] = useState(initialX)
  const [y, setY] = useState(initialY)
  const [z, setZ] = useState(initialZ)

  useEffect(() => { setX(initialX) }, [initialX])
  useEffect(() => { setY(initialY) }, [initialY])
  useEffect(() => { setZ(initialZ) }, [initialZ])

  const exposed = (x + y) > z

  return (
    <div
      style={{
        background: DS.surfaceLow,
        border: `1px solid ${DS.outlineVar}`,
        borderRadius: 4,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        height: '100%',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 11, fontWeight: 700,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            color: DS.muted,
          }}
        >
          Mosca's Theorem Widget
        </span>
        <Info size={13} color={DS.outlineVar} />
      </div>

      {/* Formula — each variable color-coded to its bar below */}
      <div style={{ textAlign: 'center', padding: '4px 0' }}>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.15em' }}>
          <span style={{ color: DS.xColor }}>X</span>
          <span style={{ color: DS.muted, margin: '0 6px' }}>+</span>
          <span style={{ color: DS.yColor }}>Y</span>
          <span style={{ color: DS.muted, margin: '0 6px' }}>&gt;</span>
          <span style={{ color: DS.zColor }}>Z</span>
        </span>
      </div>

      {/* Progress bars — flat, non-interactive, color matches formula variable */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ProgressBar
          label="Data Shelf-Life (X)"
          value={x} min={1} max={30}
          color={DS.xColor}
          yearValue={x}
        />
        <ProgressBar
          label="Migration Time (Y)"
          value={y} min={1} max={15}
          color={DS.yColor}
          yearValue={y}
        />
        <ProgressBar
          label="Quantum Horizon (Z)"
          value={z} min={1} max={30}
          color={DS.zColor}
          yearValue={z}
        />
      </div>

      {/* Verdict banner — bold warning strip */}
      <div
        style={{
          borderRadius: 6,
          border: `1.5px solid ${exposed ? '#ff6b6b' : DS.emerald + '70'}`,
          background: exposed
            ? 'linear-gradient(135deg, rgba(180,30,30,0.55) 0%, rgba(120,10,10,0.45) 100%)'
            : 'linear-gradient(135deg, rgba(110,231,183,0.15) 0%, rgba(52,211,153,0.08) 100%)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Top row: label + badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Pulsing dot */}
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: exposed ? '#ff6b6b' : DS.emerald,
                boxShadow: exposed ? '0 0 0 3px rgba(255,107,107,0.25)' : `0 0 0 3px ${DS.emerald}30`,
                animation: exposed ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: exposed ? '#ffcdd2' : DS.emerald,
              }}
            >
              {exposed ? '⚠ Mosca Verdict' : '✓ Mosca Verdict'}
            </span>
          </div>
          {/* X+Y > Z badge */}
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 4,
              background: exposed ? 'rgba(255,107,107,0.18)' : 'rgba(110,231,183,0.15)',
              border: `1px solid ${exposed ? 'rgba(255,107,107,0.45)' : DS.emerald + '50'}`,
              color: exposed ? '#ffcdd2' : DS.emerald,
            }}
          >
            {x}+{y} &gt; {z} = {exposed ? 'FAIL' : 'PASS'}
          </span>
        </div>

        {/* Main verdict text */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: exposed ? '#ffffff' : DS.emerald,
            lineHeight: 1.35,
            textShadow: exposed ? '0 1px 8px rgba(0,0,0,0.6)' : 'none',
          }}
        >
          {exposed
            ? 'Exposed to Harvest-Now-Decrypt-Later'
            : 'Low Quantum Exposure Risk'}
        </div>

        {/* Sub-note */}
        {exposed && (
          <div
            style={{
              fontSize: 10,
              color: 'rgba(255,205,210,0.75)',
              lineHeight: 1.4,
            }}
          >
            Current crypto assets are vulnerable before CRQC arrival. Migrate to NIST PQC standards immediately.
          </div>
        )}
      </div>
    </div>
  )
}
