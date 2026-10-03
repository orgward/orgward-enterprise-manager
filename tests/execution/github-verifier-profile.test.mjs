import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { githubCheckToolDigestsMatch, parseGitHubCheckPlan, parseGitHubVerifierProfile } from '../../src/execution/github-verifier-profile.mjs';

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

test('GitHub operator check plans are canonical, ordered, versioned and reject unsafe ambiguity', () => {
  const plan = parseGitHubCheckPlan({ id: 'customer-checks', version: '2.0.0', requiredChecks: [
    { id: 'unit', version: '1.0.0', executable: '/usr/bin/node', args: ['/opt/unit-check.mjs'], timeoutMs: 4000 },
    { id: 'contract', version: '1.2.0', executable: '/usr/bin/node', args: ['/opt/contract-check.mjs'], timeoutMs: 9000 },
  ] });
  assert.equal(plan.requiredChecks.length, 2);
  assert.equal(plan.requiredChecks[0].id, 'unit');
  assert.match(plan.requiredChecks[0].commandHash, /^[a-f0-9]{64}$/);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.equal(plan.legacySingleCheck, false);
  assert.equal(parseGitHubCheckPlan(plan).planHash, plan.planHash);
  const legacy = parseGitHubCheckPlan({ id: 'legacy', version: '1.0.0', executable: '/usr/bin/node', args: ['/opt/verify.mjs'] });
  assert.equal(legacy.legacySingleCheck, true);
  assert.throws(() => parseGitHubCheckPlan({ id: 'empty', version: '1.0.0', requiredChecks: [] }));
  assert.throws(() => parseGitHubCheckPlan({ id: 'duplicate', version: '1.0.0', requiredChecks: [
    { id: 'same', version: '1.0.0', executable: '/usr/bin/node', args: [] },
    { id: 'same', version: '1.0.0', executable: '/usr/bin/node', args: [] },
  ] }));
  assert.throws(() => parseGitHubCheckPlan({ id: 'unknown', version: '1.0.0', requiredChecks: [], modelPlan: true }));
});

test('GitHub check plan detects executable replacement after plan creation', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'orgward-check-tool-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'check-tool');
  const sandbox = path.join(directory, 'sandbox-tool');
  await writeFile(executable, 'fixed executable bytes');
  await writeFile(sandbox, 'fixed sandbox bytes');
  const plan = parseGitHubCheckPlan({ id: 'artifact-pin', version: '1.0.0', requiredChecks: [
    { id: 'test', version: '1.0.0', executable, args: [], bubblewrapExecutable: sandbox },
  ] });
  assert.match(plan.requiredChecks[0].toolDigest, /^[a-f0-9]{64}$/);
  assert.match(plan.requiredChecks[0].sandboxToolDigest, /^[a-f0-9]{64}$/);
  assert.equal(githubCheckToolDigestsMatch(plan.requiredChecks[0]), true);
  await writeFile(executable, 'replacement executable bytes');
  assert.equal(githubCheckToolDigestsMatch(plan.requiredChecks[0]), false,
    'execution must reject a tool replaced after its plan was created');
});
