import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGitHubVerifierProfile } from '../../src/execution/github-verifier-profile.mjs';

test('GitHub verifier profile is absent by default and pins only fixed operator executable and argv', () => {
  assert.equal(parseGitHubVerifierProfile(null), null);
  assert.equal(parseGitHubVerifierProfile(''), null);
  const profile = parseGitHubVerifierProfile(JSON.stringify({ id: 'unit-verifier', version: '2.1.0',
    executable: '/usr/bin/node', args: ['/opt/orgward/verify.mjs', '--fixed'], timeoutMs: 10_000 }));
  assert.equal(profile.id, 'unit-verifier');
  assert.equal(profile.version, '2.1.0');
  assert.equal(profile.timeoutMs, 10_000);
  assert.equal(profile.bubblewrapExecutable, '/usr/bin/bwrap');
  assert.equal(profile.profileHash.length, 64);
  assert.deepEqual(parseGitHubVerifierProfile(profile), profile, 'normalized profile can be safely reparsed by service construction');
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.args), true);
  assert.equal(Object.hasOwn(profile, 'environment'), false);
});

test('GitHub verifier profile rejects mutable, secret-bearing, shell and unbounded configuration', () => {
  const valid = { id: 'unit-verifier', version: '1.0.0', executable: '/usr/bin/node', args: ['/opt/verify.mjs'] };
  for (const bad of [
    '{not-json',
    { ...valid, extraMounts: ['/run/secrets'] },
    { ...valid, environment: { TOKEN: 'secret' } },
    { ...valid, executable: '/bin/sh', args: ['-c', 'npm test'] },
    { ...valid, executable: '/usr/bin/node', args: ['-c'] },
    { ...valid, executable: 'node' },
    { ...valid, timeoutMs: 99 },
    { ...valid, timeoutMs: 120_001 },
    { ...valid, args: Array(33).fill('arg') },
  ]) assert.throws(() => parseGitHubVerifierProfile(bad));
});
