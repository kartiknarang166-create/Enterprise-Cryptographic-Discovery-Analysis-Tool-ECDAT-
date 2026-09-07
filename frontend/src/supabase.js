/**
 * supabase.js — ECDAT v1.0-pqc
 *
 * Initialises the Supabase JS client and exports helpers for:
 *   • Auth  (via supabase.auth.*)
 *   • Scan history CRUD  (scan_history table)
 *
 * ── What we store ──────────────────────────────────────────────────────────────
 * We intentionally store ONLY the CycloneDX BOM output and lightweight summary
 * metadata.  Raw source files are NEVER persisted to Supabase.
 *
 * Row shape (scan_history table):
 *   id          uuid   PK  auto-generated
 *   user_id     uuid   FK → auth.users
 *   scanned_at  timestamptz
 *   target      text   (repo URL or folder name — NOT the file tree)
 *   total       int    (total crypto assets found)
 *   critical    int    (critical-risk count)
 *   bom_json    jsonb  (full CycloneDX 1.6 BOM — the dashboard output)
 *
 * ── Supabase SQL (run once in the Supabase dashboard) ─────────────────────────
 *   create table scan_history (
 *     id         uuid primary key default gen_random_uuid(),
 *     user_id    uuid references auth.users(id) on delete cascade,
 *     scanned_at timestamptz default now(),
 *     target     text,
 *     total      int,
 *     critical   int,
 *     bom_json   jsonb
 *   );
 *   alter table scan_history enable row level security;
 *   create policy "Users can manage own scans"
 *     on scan_history for all using (auth.uid() = user_id);
 *
 * ── Environment variables (set in .env) ───────────────────────────────────────
 *   VITE_SUPABASE_URL              — your project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  — your public anon/publishable key
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL              || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY  || ''

// Guard: in dev without .env, we create a no-op stub so the UI doesn't crash.
// Real persistence only works when the env vars are set.
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : createNoOpClient()

// ── History helpers ────────────────────────────────────────────────────────────

/**
 * Persist a completed scan to the scan_history table.
 * Only stores the BOM + lightweight summary — never raw source code.
 *
 * @param {object} bom       — full CycloneDX BOM JSON returned by the backend
 * @param {string} target    — folder name or repo URL that was scanned
 * @param {string} userId    — auth.users.id of the signed-in user
 */
export async function saveHistoryEntry(bom, target, userId) {
  if (!isConfigured || !userId || !bom) return { error: 'not configured' }

  // Strip any internal flags before persisting
  const { _offlineMode, ...cleanBom } = bom
  const components = cleanBom?.components || []
  const summary    = cleanBom?.summary    || {}
  const total      = summary.total_findings  ?? components.length
  const critical   = summary.critical_count  ??
    components.filter(c => c.mosca?.risk_level === 'CRITICAL').length

  const { data, error } = await supabase
    .from('scan_history')
    .insert({
      user_id:  userId,
      target:   target || 'unknown',
      total,
      critical,
      bom_json: cleanBom,     // the full CycloneDX schema — no source files
    })
    .select()
    .single()

  if (error) console.error('[ECDAT] Failed to save scan history:', error.message)
  return { data, error }
}

/**
 * Fetch all history entries for the current user, newest first.
 * @param {string} userId
 */
export async function getHistory(userId) {
  if (!isConfigured || !userId) return { data: [], error: null }

  return supabase
    .from('scan_history')
    .select('id, scanned_at, target, total, critical, bom_json')
    .eq('user_id', userId)
    .order('scanned_at', { ascending: false })
}

/**
 * Delete a single history entry by ID (only the owner can do this via RLS).
 * @param {string} id — UUID of the scan_history row
 */
export async function deleteHistoryEntry(id) {
  if (!isConfigured || !id) return { error: 'not configured' }
  return supabase.from('scan_history').delete().eq('id', id)
}

// ── No-op stub for unconfigured environments ──────────────────────────────────
function createNoOpClient() {
  console.warn(
    '[ECDAT] Supabase not configured. Set VITE_SUPABASE_URL and ' +
    'VITE_SUPABASE_PUBLISHABLE_KEY in your .env file to enable auth and history.'
  )
  const noop = () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } })
  return {
    auth: {
      getSession:          () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange:   (cb) => { cb('SIGNED_OUT', null); return { data: { subscription: { unsubscribe: () => {} } } } },
      signInWithPassword:  noop,
      signUp:              noop,
      signOut:             noop,
      resetPasswordForEmail: noop,
    },
    from: () => ({
      insert:  () => ({ select: () => ({ single: noop }) }),
      select:  () => ({ eq: () => ({ order: noop }) }),
      delete:  () => ({ eq: noop }),
    }),
  }
}
