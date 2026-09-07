/**
 * AuthPage.jsx — ECDAT v1.0-pqc
 *
 * Full-screen glassmorphism auth gate.
 * Tabs: Sign In / Sign Up.
 * Uses Supabase Auth (email + password).
 * When auth succeeds, calls onAuth(session) → parent unmounts this page.
 */

import { useState } from 'react'
import { Shield, Eye, EyeOff, AlertTriangle, Lock, Mail, UserPlus, LogIn } from 'lucide-react'
import { supabase } from '../supabase'

const DS = {
  bg:          '#13131b',
  surfaceLow:  '#1b1b23',
  surfaceHigh: '#292932',
  onSurface:   '#e4e1ed',
  onVariant:   '#c7c4d7',
  outlineVar:  '#464554',
  error:       '#ffb4ab',
  primary:     '#c0c1ff',
  secondary:   '#4cd7f6',
  emerald:     '#6ee7b7',
  muted:       '#908fa0',
}

export default function AuthPage({ onAuth }) {
  const [tab,         setTab]         = useState('signin')  // 'signin' | 'signup'
  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [showPw,      setShowPw]      = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  const [successMsg,  setSuccessMsg]  = useState(null)

  // ── Auth actions ────────────────────────────────────────────────────────────
  async function handleSignIn(e) {
    e.preventDefault()
    setError(null); setSuccessMsg(null); setLoading(true)
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) return setError(err.message)
    onAuth(data.session)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError(null); setSuccessMsg(null); setLoading(true)
    const { error: err } = await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (err) return setError(err.message)
    setSuccessMsg('Account created! Check your email to confirm, then sign in.')
  }

  async function handleForgotPassword() {
    if (!email.trim()) return setError('Enter your email address first.')
    setError(null); setLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email)
    setLoading(false)
    if (err) return setError(err.message)
    setSuccessMsg('Password reset email sent — check your inbox.')
  }

  const isSignIn = tab === 'signin'

  return (
    <div
      style={{
        minHeight:       '100vh',
        background:      DS.bg,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        fontFamily:      'Inter, sans-serif',
        padding:         '24px 16px',
        position:        'relative',
        overflow:        'hidden',
      }}
    >
      {/* ── Background radial glows ── */}
      <div style={{
        position: 'absolute', top: '-10%', left: '50%',
        transform: 'translateX(-50%)',
        width: 700, height: 400,
        background: `radial-gradient(ellipse at center, ${DS.primary}0f 0%, transparent 65%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-5%', right: '10%',
        width: 400, height: 300,
        background: `radial-gradient(ellipse at center, ${DS.secondary}0a 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* ── Logo ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `${DS.primary}1a`,
          border: `1px solid ${DS.primary}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={20} color={DS.primary} strokeWidth={1.8} />
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '0.12em', textTransform: 'uppercase', color: DS.onSurface }}>
            ECDAT
          </div>
          <div style={{ fontSize: 11, color: DS.muted }}>Cryptographic Discovery & Analysis Tool</div>
        </div>
      </div>

      {/* ── Auth Card ── */}
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: `${DS.surfaceLow}e8`,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${DS.outlineVar}`,
          borderRadius: 12,
          padding: 32,
          boxShadow: `0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px ${DS.primary}15 inset`,
        }}
      >
        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: 4,
          marginBottom: 28,
          background: DS.surfaceHigh,
          borderRadius: 8,
          padding: 3,
        }}>
          {[
            { id: 'signin', label: 'Sign In',  Icon: LogIn   },
            { id: 'signup', label: 'Sign Up',  Icon: UserPlus },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError(null); setSuccessMsg(null) }}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '8px 14px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.18s',
                background: tab === id ? DS.primary : 'transparent',
                color:      tab === id ? '#09090b'  : DS.muted,
                boxShadow:  tab === id ? '0 2px 8px rgba(0,0,0,0.4)' : 'none',
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={isSignIn ? handleSignIn : handleSignUp}>
          {/* Email */}
          <div style={{ marginBottom: 14, position: 'relative' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted, marginBottom: 6 }}>
              Email
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={13} color={DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                autoComplete="email"
                style={{
                  width: '100%',
                  background: DS.surfaceHigh,
                  border: `1px solid ${DS.outlineVar}`,
                  borderRadius: 6,
                  color: DS.onSurface,
                  fontSize: 14,
                  padding: '10px 12px 10px 36px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                  fontFamily: 'Inter, sans-serif',
                }}
                onFocus={e => (e.target.style.borderColor = DS.primary)}
                onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
              />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 20, position: 'relative' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: DS.muted, marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={13} color={DS.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              <input
                id="auth-password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder={isSignIn ? '••••••••' : 'Min. 6 characters'}
                autoComplete={isSignIn ? 'current-password' : 'new-password'}
                style={{
                  width: '100%',
                  background: DS.surfaceHigh,
                  border: `1px solid ${DS.outlineVar}`,
                  borderRadius: 6,
                  color: DS.onSurface,
                  fontSize: 14,
                  padding: '10px 40px 10px 36px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                  fontFamily: 'Inter, sans-serif',
                }}
                onFocus={e => (e.target.style.borderColor = DS.primary)}
                onBlur={e  => (e.target.style.borderColor = DS.outlineVar)}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: DS.muted,
                  display: 'flex', alignItems: 'center',
                }}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Inline messages */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '9px 12px', borderRadius: 6, marginBottom: 14,
              background: `${DS.error}12`, border: `1px solid ${DS.error}40`,
              color: DS.error, fontSize: 12,
            }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              {error}
            </div>
          )}
          {successMsg && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '9px 12px', borderRadius: 6, marginBottom: 14,
              background: `${DS.emerald}12`, border: `1px solid ${DS.emerald}40`,
              color: DS.emerald, fontSize: 12,
            }}>
              <span style={{ fontSize: 13 }}>✓</span>
              {successMsg}
            </div>
          )}

          {/* Submit */}
          <button
            id={isSignIn ? 'btn-sign-in' : 'btn-sign-up'}
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 24px',
              borderRadius: 7,
              background: loading ? '#374151' : DS.primary,
              border: 'none',
              color: loading ? '#9ca3af' : '#09090b',
              fontSize: 14, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.18s',
              letterSpacing: '0.01em',
              marginBottom: 14,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#d4d5ff' }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = DS.primary }}
          >
            {loading ? (
              <>
                <svg style={{ width: 14, height: 14, animation: 'spin-auth 1s linear infinite' }} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#6b7280" strokeWidth="2.5" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                {isSignIn ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              <>
                {isSignIn ? <LogIn size={14} /> : <UserPlus size={14} />}
                {isSignIn ? 'Sign In' : 'Create Account'}
              </>
            )}
          </button>

          {/* Forgot password (sign-in only) */}
          {isSignIn && (
            <div style={{ textAlign: 'center' }}>
              <button
                type="button"
                onClick={handleForgotPassword}
                style={{
                  background: 'none', border: 'none',
                  color: DS.muted, fontSize: 12,
                  cursor: 'pointer', textDecoration: 'underline',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = DS.primary)}
                onMouseLeave={e => (e.currentTarget.style.color = DS.muted)}
              >
                Forgot password?
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Footer note */}
      <p style={{ fontSize: 11, color: DS.muted, marginTop: 24, textAlign: 'center', maxWidth: 360 }}>
        ECDAT stores only your scan results (CycloneDX BOM) — never your source code.
      </p>

      <style>{`
        @keyframes spin-auth {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>
    </div>
  )
}
