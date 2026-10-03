import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpReleaseAdapter } from '../../src/release/adapter.mjs';
import { parseReleaseEnvironments, releaseCandidateBinding, releaseEnvironmentSnapshot } from '../../src/release/contracts.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { h, readyCandidate, releaseBuildBytes } from './candidate-fixture.mjs';

const owner = `oidc:${h('a')}`;
const approver = `oidc:${h('b')}`;
const executor = `oidc:${h('c')}`;

function environment(overrides = {}) {
  return { id: 'production', tenantId: 'tenant-a', projectId: 'project-12345678-1234-4234-8234-123456789012',
    label: 'Production', assetIds: ['service-api'], riskClass: 'high', actions: ['release', 'rollback'],
    authority: { requesters: [owner], approvers: [approver], executors: [executor] },
    adapter: { kind: 'http-release-v1', endpoint: 'http://127.0.0.1:4100', authorizationToken: 'fixture-token' },
    ...overrides };
}

test('release candidate binding accepts only exact GitHub success, passed checks and two matching durable builds', () => {
  const run = readyCandidate();
  const binding = releaseCandidateBinding(run);
  assert.equal(binding.runId, run.id);
  assert.equal(binding.candidateEvidenceHash, run.execution.evidenceHash);
  assert.deepEqual(binding.artifactSetIds, ['build-one', 'build-two']);
  assert.equal(binding.outputManifest[0].path, 'dist/app.js');
  assert.equal(binding.outputManifestHash, digest(binding.outputManifest));
});

test('release candidate binding rejects legacy, incomplete, stale and mismatched evidence', () => {
  const cases = [
    ['legacy success', (run) => { run.execution.repositoryCandidate.source.type = 'local'; }],
    ['incomplete checks', (run) => { run.execution.repositoryCandidate.checkPlan.legacySingleCheck = true; }],
    ['missing required check receipt', (run) => { run.execution.repositoryCandidate.checkReceipts = []; }],
    ['one build only', (run) => { run.execution.repositoryCandidate.buildReceipt.runs.pop(); }],
    ['candidate changed after checks', (run) => { run.execution.repositoryCandidate.treeDigest = h('f'); }],
    ['non-successful run', (run) => { run.status = 'FAILED'; }],
    ['terminal receipt mismatch', (run) => { run.events.at(-1).data.candidateEvidenceHash = h('f'); }],
  ];
  for (const [label, mutate] of cases) {
    const run = readyCandidate();
    mutate(run);
    assert.throws(() => releaseCandidateBinding(run), { code: 'RELEASE_CANDIDATE_NOT_READY' }, label);
  }
});

test('release environment parsing canonicalizes safe authority while keeping adapter credentials out of snapshots', () => {
  const [parsed] = parseReleaseEnvironments([environment({ assetIds: ['service-api', 'database'] })]);
  assert.deepEqual(parsed.assetIds, ['database', 'service-api']);
  assert.equal(parsed.configurationHash, digest({ id: parsed.id, tenantId: parsed.tenantId, projectId: parsed.projectId,
    label: parsed.label, assetIds: parsed.assetIds, riskClass: parsed.riskClass, actions: parsed.actions,
    authority: parsed.authority, adapter: { kind: 'http-release-v1', endpoint: 'http://127.0.0.1:4100', timeoutMs: 30_000 } }));
  const snapshot = releaseEnvironmentSnapshot(parsed);
  assert.equal(JSON.stringify(snapshot).includes('fixture-token'), false);
  assert.equal(parsed.adapter.authorizationToken, 'fixture-token');
});

test('release environment parsing rejects unsafe endpoints, incomplete authority and ambiguous assets', () => {
  const invalid = [
    environment({ adapter: { kind: 'http-release-v1', endpoint: 'http://release.example.test' } }),
    environment({ authority: { requesters: [owner], approvers: [], executors: [executor] } }),
    environment({ assetIds: ['service-api', 'service-api'] }),
    environment({ actions: ['release', 'release'] }),
  ];
  for (const row of invalid) assert.throws(() => parseReleaseEnvironments([row]));
});

test('HTTP release adapter sends the approved exact output bytes and fixes identity headers', async () => {
  const [configured] = parseReleaseEnvironments([environment()]);
  const candidate = releaseCandidateBinding(readyCandidate());
  let observed;
  const adapter = new HttpReleaseAdapter(configured.adapter, async (url, options) => {
    observed = { url, options, payload: JSON.parse(options.body) };
    return { ok: true, body: [Buffer.from(JSON.stringify({ version: 'protected-release-result-v1',
      actionId: action.id, requestHash: action.requestHash, environmentId: configured.id,
      configurationHash: configured.configurationHash, candidateEvidenceHash: action.request.candidate.candidateEvidenceHash,
      outputManifestHash: action.request.candidate.outputManifestHash, status: 'APPLIED', health: 'healthy',
      healthCheckId: 'health-17', observedAt: action.dispatch.dispatchedAt }))] };
  });
  const action = { id: 'release-action-17', requestHash: h('d'), dispatch: { dispatchedAt: new Date().toISOString() },
    request: { environment: { id: configured.id, configurationHash: configured.configurationHash },
      candidate: { candidateEvidenceHash: candidate.candidateEvidenceHash, outputManifestHash: candidate.outputManifestHash } } };
  const outputs = [{ ...candidate.outputManifest[0], contentBase64: releaseBuildBytes.toString('base64') }];
  const observation = await adapter.execute(action, outputs);
  assert.equal(observed.url, 'http://127.0.0.1:4100/actions');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers.authorization, 'Bearer fixture-token');
  assert.equal(observed.options.headers['idempotency-key'], action.id);
  assert.deepEqual(observed.payload.outputs, outputs);
  assert.deepEqual(Buffer.from(observed.payload.outputs[0].contentBase64, 'base64'), releaseBuildBytes);
  assert.equal(observation.status, 'APPLIED');
  assert.equal(observation.health, 'healthy');
});
