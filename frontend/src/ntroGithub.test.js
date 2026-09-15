import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ntroHeaders, NTRO_HEADER, isValidRepoName, formatGithubTarget,
  parseGithubTarget, isGithubTarget, provenanceFromBom, isGithubBom,
} from './ntroGithub.js'

test('NTRO header helper only emits the session header', () => {
  assert.deepEqual(ntroHeaders('abc'), { [NTRO_HEADER]: 'abc' })
  assert.deepEqual(ntroHeaders(''), {})
  assert.deepEqual(ntroHeaders(null), {})
})

test('GitHub disconnected/connected state helpers', () => {
  assert.equal(isValidRepoName('octo/private-repo'), true)
  assert.equal(isValidRepoName('not a repo'), false)
  assert.equal(isValidRepoName('../../etc'), false)
  assert.equal(isValidRepoName('https://github.com/o/r.git'), false)
})

test('repository selection target format is safe and reversible', () => {
  const target = formatGithubTarget('octo/private-repo', 'abc123def456789')
  assert.equal(target, 'github:octo/private-repo@abc123def456')
  assert.deepEqual(parseGithubTarget(target), { fullName: 'octo/private-repo', sha: 'abc123def456' })
  assert.equal(isGithubTarget(target), true)
  assert.equal(isGithubTarget('./dummy_target'), false)
  assert.equal(isGithubTarget('github:../../evil@x'), false)
})

test('GitHub scan completion carries provenance, never secrets', () => {
  const bom = { coverage: [{ sourceType: 'github', provider: 'github', repository: 'octo/private-repo',
    ref: 'main', commitSha: 'abc123', target: 'github:octo/private-repo@abc123' }] }
  const prov = provenanceFromBom(bom)
  assert.equal(prov.repository, 'octo/private-repo')
  assert.equal(isGithubBom(bom), true)
  assert.equal(JSON.stringify(prov).includes('token'), false)
  assert.equal(provenanceFromBom({ coverage: [] }), null)
  assert.equal(isGithubBom({ metadata: {} }), false)
})

test('loading/error state shapes stay backward compatible', () => {
  // Local scans have no coverage entry — provenance helpers degrade to null.
  assert.equal(provenanceFromBom({}), null)
  assert.equal(parseGithubTarget(null), null)
})
