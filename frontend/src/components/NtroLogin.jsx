/**
 * NtroLogin.jsx — Prototype NTRO Secure Access (FICTIONAL / DEMO ONLY).
 *
 * This login does NOT verify real NTRO employment. It authenticates against
 * a small demo dataset on the backend (see backend/ntro_auth.py) so the
 * private-repository workflow can be exercised. The UI always labels the
 * account as DEMO / PROTOTYPE.
 */
import { useState } from 'react'
import { Shield, AlertTriangle, Lock, IdCard } from 'lucide-react'

const DS = {
  surfaceHigh: '#292932',
  onSurface: '#e4e1ed',
  onVariant: '#c7c4d7',
  outlineVar: '#464554',
  error: '#ffb4ab',
  primary: '#c0c1ff',
  secondary: '#4cd7f6',
  emerald: '#6ee7b7',
  muted: '#908fa0',
}

export default function NtroLogin({ apiBase, onLogin }) {
  const [employeeId, setEmployeeId] = useState('NTRO-DEMO-001')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/ntro/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId.trim(), password }),
      })
      if (!res.ok) {
        let detail = 'Sign in failed. Check your Employee ID and password.'
        try { const b = await res.json(); detail = b.detail || detail } catch { /* non-JSON */ }
        // Never echo passwords; the backend never returns them either.
        setError(detail)
        return
      }
      const data = await res.json()
      onLogin(data.token, data.employee)
    } catch {
      setError('Could not reach the ECDAT backend. Is it running on port 8000?')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', background: DS.surfaceHigh,
    border: `1px solid ${DS.outlineVar}`, borderRadius: 6,
    color: DS.onSurface, fontSize: 13, padding: '10px 12px 10px 36px',
    outline: 'none', boxSizing: 'border-box', fontFamily: "'JetBrains Mono', monospace",
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Shield size={15} color={DS.primary} />
        <span style={{ fontSize: 13, fontWeight: 700, color: DS.onSurface }}>NTRO Secure Access</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
          background: `${DS.secondary}18`, color: DS.secondary,
          border: `1px solid ${DS.secondary}40`,
        }}>
          DEMO / PROTOTYPE
        </span>
      </div>
      <p style={{ fontSize: 11, color: DS.muted, margin: '0 0 14px', lineHeight: 1.5 }}>
        Prototype environment — fictional NTRO employee account. Not real employment verification.
      </p>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted, marginBottom: 6 }}>
        Employee ID
      </label>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <IdCard size={13} color={DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          id="ntro-employee-id"
          type="text"
          value={employeeId}
          onChange={e => setEmployeeId(e.target.value)}
          placeholder="NTRO-DEMO-001"
          autoComplete="username"
          style={inputStyle}
          onFocus={e => (e.target.style.borderColor = DS.primary)}
          onBlur={e => (e.target.style.borderColor = DS.outlineVar)}
        />
      </div>

      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted, marginBottom: 6 }}>
        Password
      </label>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Lock size={13} color={DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          id="ntro-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          style={inputStyle}
          onFocus={e => (e.target.style.borderColor = DS.primary)}
          onBlur={e => (e.target.style.borderColor = DS.outlineVar)}
        />
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          borderRadius: 4, background: `${DS.error}10`, border: `1px solid ${DS.error}40`,
          color: DS.error, fontSize: 12, marginBottom: 12,
        }}>
          <AlertTriangle size={12} style={{ flexShrink: 0 }} />
          {error}
        </div>
      )}

      <button
        id="btn-ntro-sign-in"
        type="submit"
        disabled={loading}
        style={{
          width: '100%', padding: '11px 24px', borderRadius: 6,
          background: loading ? '#374151' : '#f4f4f5', border: 'none',
          color: loading ? '#9ca3af' : '#09090b',
          fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Verifying…' : 'Sign in'}
      </button>
    </form>
  )
}
