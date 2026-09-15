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
import { encodeBom } from './cbom'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL              || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY  || ''

// Guard: in dev without .env, we create a no-op stub so the UI doesn't crash.
// Real persistence only works when the env vars are set.
const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : createNoOpClient()

// ── Offline history cache (localStorage) ──────────────────────────────────────
// Cache is per-user so multiple accounts on the same device don't share history.

function cacheKey(userId) {
  return `ecdat_history_${userId}`
}

function readCache(userId) {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeCache(userId, entries) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(entries))
  } catch (e) {
    console.warn('[ECDAT] Failed to write history cache:', e)
  }
}

/** Prepend a single entry to the user's localStorage cache. */
function prependToCache(userId, entry) {
  const existing = readCache(userId)
  // Avoid duplicates (e.g. if save is called twice)
  const deduped  = existing.filter(e => e.id !== entry.id)
  writeCache(userId, [entry, ...deduped])
}

/** Remove a single entry from the localStorage cache by id. */
export function removeFromCache(userId, id) {
  const existing = readCache(userId)
  writeCache(userId, existing.filter(e => e.id !== id))
}

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
  const cleanBom = encodeBom(bom, { stripSource: true })
  // Source evidence is session-only; keep raw code out of persisted history.
  cleanBom.components = (cleanBom.components || []).map(component => ({
    ...component,
    ...(component.properties && {
      properties: component.properties.filter(property => !property.name.startsWith('ecdat:source:')),
    }),
  }))
  const components = cleanBom?.components || []
  const summary    = bom?.summary    || {}
  const total      = summary.total_findings  ?? components.length
  const critical   = summary.critical_count  ??
    components.filter(c => c.mosca?.risk_level === 'CRITICAL').length

  // Build the entry optimistically so we can always cache it.
  const optimisticEntry = {
    id:         crypto.randomUUID(),
    scanned_at: new Date().toISOString(),
    target:     target || 'unknown',
    total,
    critical,
    bom_json:   cleanBom,
  }

  // Pre-cache immediately (even before Supabase responds) so the scan is
  // visible in the History panel during the same offline/online session.
  prependToCache(userId, optimisticEntry)

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

  if (error) {
    console.error('[ECDAT] Failed to save scan history:', error.message)
  } else if (data) {
    // Replace the optimistic entry with the real server row (has correct id).
    removeFromCache(userId, optimisticEntry.id)
    prependToCache(userId, data)
  }

  return { data, error }
}

/**
 * Fetch all history entries for the current user, newest first.
 * @param {string} userId
 */
export async function getHistory(userId) {
  if (!userId) return { data: [], error: null }

  // If the browser is offline or Supabase is not configured, serve from cache.
  if (!navigator.onLine || !isConfigured) {
    const cached = readCache(userId)
    return { data: cached, error: null, fromCache: true }
  }

  try {
    // Race the Supabase request against a 5-second timeout.
    // This prevents an endless loading spinner if the venue has a captive portal
    // or if Supabase is slow/unreachable even though navigator.onLine is true.
    const timeoutMs = 5000
    const abortCtrl = new AbortController()
    const timeoutId = setTimeout(() => abortCtrl.abort(), timeoutMs)

    let result
    try {
      result = await supabase
        .from('scan_history')
        .select('id, scanned_at, target, total, critical, bom_json')
        .eq('user_id', userId)
        .order('scanned_at', { ascending: false })
        .abortSignal(abortCtrl.signal)
    } finally {
      clearTimeout(timeoutId)
    }

    if (result.error) {
      // Network / Supabase error — fall back to cache
      console.warn('[ECDAT] getHistory failed, serving from cache:', result.error.message)
      const cached = readCache(userId)
      return { data: cached, error: null, fromCache: true }
    }

    // Success — persist fresh data to cache for next offline session
    writeCache(userId, result.data || [])
    return { ...result, fromCache: false }
  } catch (err) {
    // Unexpected fetch failure or timeout (e.g. DNS failure / abort)
    console.warn('[ECDAT] getHistory threw, serving from cache:', err)
    const cached = readCache(userId)
    return { data: cached, error: null, fromCache: true }
  }
}

/**
 * Delete a single history entry by ID (only the owner can do this via RLS).
 * @param {string} id — UUID of the scan_history row
 */
export async function deleteHistoryEntry(id, userId) {
  // Always remove from local cache first so the UI reflects the change offline.
  if (userId) removeFromCache(userId, id)

  if (!isConfigured || !id) return { error: 'not configured' }

  if (!navigator.onLine) {
    // Offline — cache already updated, signal success.
    return { data: null, error: null }
  }

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
