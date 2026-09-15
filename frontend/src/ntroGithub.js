// ntroGithub.js — pure, environment-agnostic helpers for the
// NTRO prototype + GitHub adapter. No browser globals here so the file
// stays runnable under `node --test` (see ntroGithub.test.js).
// Browser storage / fetch live in the React components.

export const NTRO_TOKEN_KEY = 'ntro-token'
export const NTRO_HEADER = 'X-NTRO-Token'

export function ntroHeaders(token) {
  return token ? { [NTRO_HEADER]: token } : {}
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function isValidRepoName(fullName) {
  return REPO_RE.test((fullName || '').trim())
}

export function formatGithubTarget(fullName, sha) {
  const short = (sha || '').slice(0, 12) || 'unknown'
  return `github:${fullName}@${short}`
}

export function parseGithubTarget(target) {
  if (typeof target !== 'string' || !target.startsWith('github:')) return null
  const rest = target.slice('github:'.length)
  const at = rest.lastIndexOf('@')
  if (at <= 0) return null
  const fullName = rest.slice(0, at)
  const sha = rest.slice(at + 1)
  if (!isValidRepoName(fullName)) return null
  return { fullName, sha }
}

export function isGithubTarget(target) {
  return parseGithubTarget(target) !== null
}

// Read safe GitHub provenance out of a decoded BOM (coverage[0] entry).
// Returns null for local scans. Never returns secrets — the backend never
// puts tokens in the BOM, and neither do we.
export function provenanceFromBom(bom) {
  const coverage = bom?.coverage
  const entry = Array.isArray(coverage) ? coverage[0] : null
  if (!entry || entry.sourceType !== 'github') return null
  if (!isValidRepoName(entry.repository || '')) return null
  return {
    sourceType: 'github',
    provider: 'github',
    repository: entry.repository,
    ref: entry.ref || '',
    commitSha: entry.commitSha || '',
    target: entry.target || formatGithubTarget(entry.repository, entry.commitSha),
  }
}

export function isGithubBom(bom) {
  return provenanceFromBom(bom) !== null
}
