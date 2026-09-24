import test from 'node:test';
import assert from 'node:assert/strict';
import { revokeOrgwardCreatedOpenAiServiceAccount, OPENAI_ADMIN_REVOCATION_LIMITS } from '../../src/platform/openai-admin-revocation.mjs';

const target = Object.freeze({
  organizationId: 'org_test_123', projectId: 'proj_test_456',
  serviceAccountId: 'svcacct_test_789', apiKeyId: 'key_test_abc',
  provenance: 'orgward_created_exclusive_service_account',
});

test('Admin revocation retrieves then deletes only the exact dedicated account at the fixed OpenAI origin', async () => {
  const requests = [];
  const result = await revokeOrgwardCreatedOpenAiServiceAccount({
    adminApiKey: 'server-only-test-admin-key', target,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return options.method === 'GET'
        ? new Response(JSON.stringify({ id: target.serviceAccountId }), { status: 200 })
        : new Response(JSON.stringify({ id: target.serviceAccountId, deleted: true }), { status: 200 });
    },
  });
  assert.deepEqual(result, { status: 'confirmed', serviceAccountId: target.serviceAccountId, evidence: 'exact_delete_response' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `https://api.openai.com/v1/organization/projects/${target.projectId}/service_accounts/${target.serviceAccountId}`);
  assert.deepEqual(requests.map(({ options }) => options.method), ['GET', 'DELETE']);
  assert.equal(requests[1].options.redirect, 'error');
  assert.equal(requests[1].options.headers.authorization, 'Bearer server-only-test-admin-key');
  assert.equal(requests[1].options.headers['openai-organization'], target.organizationId);
  assert.equal(OPENAI_ADMIN_REVOCATION_LIMITS.timeoutMs, 8_000);
  assert.equal(OPENAI_ADMIN_REVOCATION_LIMITS.maxResponseBytes, 8_192);
});

test('raw staged credentials and incomplete targets are never eligible for provider deletion', async () => {
  let calls = 0;
  for (const unsafe of [
    { ...target, provenance: 'externally_staged_raw_key' },
    { ...target, apiKeyId: null },
    { ...target, projectId: undefined },
  ]) {
    const result = await revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: 'server-only-test-admin-key', target: unsafe,
      fetchImpl: async () => { calls += 1; throw new Error('must not be called'); } });
    assert.deepEqual(result, { status: 'unconfirmed', reason: 'target_not_eligible' });
  }
  assert.equal(calls, 0);
});

test('Admin key validator accepts the configured 2,048-byte maximum and rejects larger values', async () => {
  const maximumKey = 'k'.repeat(2_048);
  let calls = 0;
  const accepted = await revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: maximumKey, target,
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.headers.authorization, `Bearer ${maximumKey}`);
      return new Response(null, { status: 404 });
    } });
  assert.equal(accepted.status, 'confirmed');
  assert.equal(calls, 1);

  await assert.rejects(revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: `${maximumKey}k`, target,
    fetchImpl: async () => { calls += 1; throw new Error('must not be called'); } }), /credential is unavailable/);
  assert.equal(calls, 1);
});

test('provider failures and exact-target mismatches remain unconfirmed', async (t) => {
  const cases = [
    ['timeout', async () => { throw new Error('timeout'); }],
    ['provider error', async () => new Response('ignored', { status: 500 })],
    ['malformed retrieval', async () => new Response('{', { status: 200 })],
    ['different retrieved account id', async () => new Response(JSON.stringify({ id: 'svcacct_other' }), { status: 200 })],
  ];
  for (const [name, fetchImpl] of cases) await t.test(name, async () => {
    const result = await revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: 'server-only-test-admin-key', target, fetchImpl });
    assert.equal(result.status, 'unconfirmed');
  });
  await t.test('missing deletion confirmation', async () => {
    let calls = 0;
    const result = await revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: 'server-only-test-admin-key', target,
      fetchImpl: async () => ++calls === 1
        ? new Response(JSON.stringify({ id: target.serviceAccountId }), { status: 200 })
        : new Response(JSON.stringify({ id: target.serviceAccountId, deleted: false }), { status: 200 }) });
    assert.equal(calls, 2);
    assert.equal(result.status, 'unconfirmed');
  });
});

test('exact project-scoped retrieval proving absence reconciles a lost delete response without another delete', async () => {
  const methods = [];
  const result = await revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: 'server-only-test-admin-key', target,
    fetchImpl: async (_url, options) => { methods.push(options.method); return new Response(null, { status: 404 }); } });
  assert.deepEqual(methods, ['GET']);
  assert.deepEqual(result, { status: 'confirmed', serviceAccountId: target.serviceAccountId, evidence: 'exact_project_account_absent' });
});

test('a retrieved foreign account id is never deleted', async () => {
  const methods = [];
  const result = await revokeOrgwardCreatedOpenAiServiceAccount({ adminApiKey: 'server-only-test-admin-key', target,
    fetchImpl: async (_url, options) => { methods.push(options.method); return new Response(JSON.stringify({ id: 'svcacct_foreign' }), { status: 200 }); } });
  assert.deepEqual(methods, ['GET']);
  assert.equal(result.status, 'unconfirmed');
});
