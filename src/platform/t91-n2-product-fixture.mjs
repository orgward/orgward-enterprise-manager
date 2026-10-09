import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { digest } from '../sdlc/contracts.mjs';
import { T91_N1_ORPHAN_PATH_HARNESS, T91_N2_AUTHORIZATION_HARNESS, T91_N2_MISSING_ASSERTION_HARNESS,
  T91_N3_DELETED_FAILING_TEST_HARNESS, T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH,
  T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH, T91_R1_CRITERION_RECOVERY_HARNESS,
  T91_R2_SHARED_DRAFT_RECOVERY_HARNESS, t91R1RecoveryFixtureHash, t91R2RecoveryFixtureHash,
  t91N1OrphanPathFixtureHash, t91N2AuthorizationInvocationFixtureHash, t91N2MissingAssertionFixtureHash,
  t91N3DeletedFailingTestFixtureHash } from '../sdlc/product-harness.mjs';
import { PostgresGitHubSourceStore } from './postgres-stores.mjs';
import { captureLocalRepositorySnapshot, localRepositoryDiff } from '../execution/local-repository-snapshot.mjs';
import { T91_DELETED_FAILING_TEST_SOURCE } from '../../tests/fixtures/t91-deleted-failing-test-source.mjs';

const FIXTURE_ISSUER = 'https://orgward.invalid/t91-product-fixture';
const FIXTURE_SUBJECT = 'n2-authorization-fixture-owner';
const FIXTURE_TENANT = 't91-fixture';
const INSTALLATION_ID = '123456789';
const REPOSITORY_ID = '987654321';
const BRANCH_REF = 'refs/heads/main';
const COMMIT_OID = 'c'.repeat(40);
const API_TIMEOUT_MS = 8_000;
const requirementContentHash = (requirement) => digest(Object.fromEntries(Object.entries(requirement ?? {})
  .filter(([key]) => !['processRunEvidenceLinks', 'processRunEvidenceReviews', 'processBehaviorTestPlans'].includes(key))));

const FILE_TEXT = Object.freeze({
  'README.md': '# Fixed OrgWard N2 fixture\nSynthetic source used only by the isolated product-path harness.\n',
  'src/process.mjs': `export function qualifyDemand(signal) {
  const repeated = signal?.repairCount >= 2;
  const highImpact = signal?.customerImpact === 'high';
  const need = repeated && highImpact ? 'prioritised-repair' : 'routine';
  return { need, repeated, highImpact };
}\n`,
  'test/process-contract.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyDemand } from '../src/process.mjs';
test('Pinned process learning check', () => {
  assert.deepEqual(qualifyDemand({ repairCount: 2, customerImpact: 'high' }),
    { need: 'prioritised-repair', repeated: true, highImpact: true });
});
`,
  'test/scenario-contract.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyDemand } from '../src/process.mjs';
test('Fixed synthetic scenario contract', () => {
  assert.deepEqual(qualifyDemand({ repairCount: 2, customerImpact: 'high' }),
    { need: 'prioritised-repair', repeated: true, highImpact: true });
});
`,
});

const TEMPLATE_FILES = Object.entries(FILE_TEXT).map(([filePath, content]) => ({
  path: filePath, mode: '100644', bytes: Buffer.from(content),
}));
const FIXTURE_TEMPLATE_HASH = digest({
  id: 't91-n2-authorization-synthetic-repository-v1',
  files: TEMPLATE_FILES.map(({ path: filePath, mode, bytes }) => ({ path: filePath, mode,
    size: bytes.length, contentHash: createHash('sha256').update(bytes).digest('hex') })),
});
if (FIXTURE_TEMPLATE_HASH !== T91_N2_PRODUCT_FIXTURE_TEMPLATE_HASH) {
  throw new Error('The fixed N2 fixture bytes do not match their registered template hash.');
}
const N3_TEMPLATE_FILES = [...TEMPLATE_FILES, { path: 'tests/learning.test.js', mode: '100644',
  bytes: Buffer.from(T91_DELETED_FAILING_TEST_SOURCE) }];
const N3_FIXTURE_TEMPLATE_HASH = digest({ id: 't91-n3-deleted-failing-test-synthetic-repository-v1',
  files: N3_TEMPLATE_FILES.map(({ path: filePath, mode, bytes }) => ({ path: filePath, mode,
    size: bytes.length, contentHash: createHash('sha256').update(bytes).digest('hex') })) });
export { T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH };
if (N3_FIXTURE_TEMPLATE_HASH !== T91_N3_PRODUCT_FIXTURE_TEMPLATE_HASH) {
  throw new Error('The fixed N3 fixture bytes do not match their registered template hash.');
}

function syntheticIdentity(subject = FIXTURE_SUBJECT, roles = ['tenant-admin', 'workspace-read', 'workspace-write'], actorType = 'human') {
  return { issuer: FIXTURE_ISSUER, subject,
    principal: `oidc:${createHash('sha256').update(`${FIXTURE_ISSUER}\n${subject}`).digest('hex')}`,
    displayName: 'Isolated N2 fixture owner', tenantId: FIXTURE_TENANT,
    roles, actorType,
    expiresAt: Math.floor(Date.now() / 1000) + 900 };
}

function command(commandId, payload, expectedVersion) {
  return { schemaVersion: '1.0', commandId,
    ...(expectedVersion === undefined ? {} : { expectedVersion }), payload };
}

function snapshotForFixture(templateFiles = TEMPLATE_FILES) {
  const files = templateFiles.map(({ path: filePath, mode, bytes }) => ({
    path: filePath, mode, size: bytes.length,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    blobSha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    contentBase64: bytes.toString('base64'),
  }));
  const manifest = files.map(({ path: filePath, mode, contentHash, size, blobSha }) => ({
    path: filePath, mode, contentHash, size, blobSha,
  }));
  const manifestDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const snapshotId = createHash('sha256').update(`${REPOSITORY_ID}\0${BRANCH_REF}\0${COMMIT_OID}\0github-read-snapshot-v1`).digest('hex');
  return { id: snapshotId, repositoryId: REPOSITORY_ID, branchRef: BRANCH_REF, commitOid: COMMIT_OID,
    treeOid: 'd'.repeat(40), treeDigest: manifestDigest, manifestDigest, policyVersion: 'github-read-snapshot-v1',
    fileCount: files.length, totalBytes: files.reduce((total, entry) => total + entry.size, 0), files };
}

function fixtureHeaders(token, body = false) {
  return { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) };
}

export async function runT91N2AuthorizationProductFixture({ createApp, databaseUrl, databaseName,
  databaseOid, fixtureClusterId, invocationId, fixtureTemplateHash = null,
  harness, fixtureCaseId: sourceCaseId, request: reservedRequest, pins, signal }) {
  const missingAssertion = harness?.subcaseId === 'N2.MISSING_ASSERTION';
  const recovery = harness?.subcaseId === 'R1';
  const sharedDraftRecovery = harness?.subcaseId === 'R2';
  const orphanPath = harness?.subcaseId === 'N1';
  const deletedFailingTest = harness?.subcaseId === 'N3';
  const modelBacked = missingAssertion || orphanPath || deletedFailingTest || recovery || sharedDraftRecovery;
  const registeredHarness = deletedFailingTest ? T91_N3_DELETED_FAILING_TEST_HARNESS
    : orphanPath ? T91_N1_ORPHAN_PATH_HARNESS
    : recovery ? T91_R1_CRITERION_RECOVERY_HARNESS
    : sharedDraftRecovery ? T91_R2_SHARED_DRAFT_RECOVERY_HARNESS
    : missingAssertion ? T91_N2_MISSING_ASSERTION_HARNESS : T91_N2_AUTHORIZATION_HARNESS;
  const expectedTemplateHash = deletedFailingTest ? N3_FIXTURE_TEMPLATE_HASH : FIXTURE_TEMPLATE_HASH;
  const templateFiles = deletedFailingTest ? N3_TEMPLATE_FILES : TEMPLATE_FILES;
  if (typeof createApp !== 'function' || harness?.id !== registeredHarness.id
    || harness?.version !== registeredHarness.version || reservedRequest?.subcaseId !== registeredHarness.subcaseId
    || reservedRequest?.mappingHash !== pins?.mappingHash || reservedRequest?.planHash !== pins?.planHash
    || reservedRequest?.datasetHash !== pins?.datasetHash || reservedRequest?.oracleHash !== pins?.oracleHash
    || (recovery && (reservedRequest?.oldPlanId !== pins?.oldPlanId
      || reservedRequest?.oldPlanHash !== pins?.oldPlanHash || reservedRequest?.oldLinkId !== pins?.oldLinkId
      || reservedRequest?.oldLinkHash !== pins?.oldLinkHash || reservedRequest?.oldRunId !== pins?.oldRunId))
    || (sharedDraftRecovery && (reservedRequest?.oldPlanId !== pins?.oldPlanId
      || reservedRequest?.oldPlanHash !== pins?.oldPlanHash || reservedRequest?.oldLinkId !== pins?.oldLinkId
      || reservedRequest?.oldLinkHash !== pins?.oldLinkHash || reservedRequest?.oldRunId !== pins?.oldRunId
      || reservedRequest?.selectedRequirementHash !== pins?.selectedRequirementHash
      || reservedRequest?.otherRequirementId !== pins?.otherRequirementId
      || reservedRequest?.otherRequirementHash !== pins?.otherRequirementHash))
    || (orphanPath && reservedRequest?.candidatePath !== T91_N1_ORPHAN_PATH_HARNESS.candidatePath)
    || (deletedFailingTest && (reservedRequest?.candidatePath !== T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath
      || pins?.sourceTestBytesHash !== T91_N3_DELETED_FAILING_TEST_HARNESS.sourceBytesHash
      || pins?.fixtureTemplateHash !== N3_FIXTURE_TEMPLATE_HASH))
    || !/^[a-f0-9]{64}$/.test(pins?.reservationHash ?? '')
    || (fixtureTemplateHash !== null && fixtureTemplateHash !== expectedTemplateHash)
    || typeof invocationId !== 'string') {
    throw Object.assign(new Error('The fixed N2 fixture request does not match its reserved harness pins.'), { code: 'FIXTURE_REQUEST_PIN_MISMATCH' });
  }
  const templateHash = expectedTemplateHash;
  const identity = syntheticIdentity();
  const agentIdentity = syntheticIdentity('n2-authorization-fixture-agent',
    ['tenant-admin', 'workspace-read', 'workspace-write'], 'workload');
  const reviewerIdentity = syntheticIdentity('n2-authorization-fixture-reviewer',
    ['tenant-admin', 'workspace-read', 'workspace-write', 'execution-approver']);
  const token = 't91-fixture-owner';
  const reviewerToken = 't91-fixture-reviewer';
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'orgward-t91-n2-fixture-'));
  let app = null;
  let providerServer = null;
  const fixedAgentProfileRoot = path.join(tempRoot, 'fixed-agent-profile');
  let listening = false;
  let closePromise = null;
  let setupSettled = false;
  const throwIfAborted = () => {
    if (signal?.aborted) throw Object.assign(new Error('The fixture invocation was aborted.'), { code: 'FIXTURE_ABORTED' });
  };
  const cleanup = async () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (app) {
        await new Promise((resolve) => {
          if (!app.server.listening) return resolve();
          app.server.close(() => resolve());
        });
        await app.close().catch(() => {});
      }
      if (providerServer?.listening) await new Promise((resolve) => providerServer.close(resolve));
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    })();
    return closePromise;
  };
  const onAbort = () => { if (setupSettled) void cleanup(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfAborted();
    if (modelBacked) await (await import('node:fs/promises')).mkdir(fixedAgentProfileRoot, { recursive: true, mode: 0o700 });
    const authenticator = { authenticate: async (req) => {
      if (req.headers.authorization === `Bearer ${token}`) return identity;
      if (req.headers.authorization === `Bearer ${reviewerToken}`) return reviewerIdentity;
      if (req.headers.authorization === 'Bearer t91-fixture-agent') return agentIdentity;
      return null;
    } };
    let providerPort;
    if (modelBacked) {
      providerServer = createServer(async (request, response) => {
        if (request.method === 'GET' && request.url === '/v1/models/gpt-fixture') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ id: 'gpt-fixture' }));
          return;
        }
        if (request.method === 'POST' && request.url === '/v1/responses') {
          let bodyText = '';
          for await (const chunk of request) bodyText += chunk;
          let updates = [];
          try {
            const prompt = JSON.parse(JSON.parse(bodyText).input);
            updates = prompt.selectedFiles.map((file) => ({ path: file.path, baseContentHash: file.contentHash,
              content: orphanPath || deletedFailingTest ? file.text
                : `${file.text}${String.fromCharCode(10)}${file.path.endsWith('.mjs') ? '// Fixed synthetic N2 candidate.' : 'Fixed synthetic N2 candidate.'}${String.fromCharCode(10)}` }));
          } catch { /* The real parser rejects malformed fixture output. */ }
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{
            type: 'output_text', text: JSON.stringify({ updates }),
          }] }] }));
          return;
        }
        response.writeHead(404);
        response.end();
      });
      await new Promise((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
      providerPort = providerServer.address().port;
    }
    app = createApp({ databaseUrl, dataDirectory: path.join(tempRoot, 'projects'),
      sdlcDirectory: path.join(tempRoot, 'sdlc'), executionDirectory: path.join(tempRoot, 'execution-runs'),
      executionWorkspaceDirectory: path.join(tempRoot, 'execution-workspaces'),
      oidcAuthenticator: authenticator, oidcBootstrapPrincipals: [{ issuer: FIXTURE_ISSUER,
        subject: FIXTURE_SUBJECT, tenantId: FIXTURE_TENANT }, { issuer: FIXTURE_ISSUER,
        subject: reviewerIdentity.subject, tenantId: FIXTURE_TENANT, roles: reviewerIdentity.roles },
        { issuer: FIXTURE_ISSUER, subject: agentIdentity.subject, tenantId: FIXTURE_TENANT,
          roles: agentIdentity.roles, actorType: 'workload' }],
      ...(modelBacked ? { executionProfiles: [{ id: 't91-n2-fixed-task-agent', label: 'Fixed synthetic N2 fixture model',
        kind: 'provider-openai', version: '1.0.0', credentialReference: 'secret-t91-n2-fixture-agent',
        model: 'gpt-fixture', openAiEndpoint: `http://127.0.0.1:${providerPort}/v1/responses` }] } : {}),
      githubVerifierProfile: { id: 't91-n2-fixed-inert-verifier', version: '1.0.0', requiredChecks: [
        { id: 't91-n2-inert-check', version: '1.0.0', executable: process.execPath,
          args: ['--test', '--test-reporter=tap', (recovery || sharedDraftRecovery)
            ? 'test/process-contract.test.mjs' : 'test/scenario-contract.test.mjs'], timeoutMs: 5_000 },
      ] },
      secretEncryptionKey: Buffer.alloc(32, 0x51),
      ...(modelBacked ? { openAiValidationEndpoint: `http://127.0.0.1:${providerPort}/v1/models` } : {}),
      githubFetchImpl: async () => {
        throw new Error('The isolated N2 fixture must not contact GitHub.');
      } });
    try { await app.init(); } finally { setupSettled = true; }
    throwIfAborted();
    const authz = await app.sessionStore.resolve(identity);
    throwIfAborted();
    if (!authz || !authz.roles.includes('tenant-admin') || !authz.roles.includes('workspace-write')) {
      throw new Error('The isolated fixture owner authority could not be bootstrapped.');
    }
    throwIfAborted();
    app.server.listen(0, '127.0.0.1');
    await Promise.race([once(app.server, 'listening'), new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture server startup timed out.')), API_TIMEOUT_MS))]);
    listening = true;
    const address = app.server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const requestApi = async (route, { method = 'GET', body, expectedStatus = 200, token: requestToken = token } = {}) => {
      throwIfAborted();
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]) : AbortSignal.timeout(API_TIMEOUT_MS);
      const response = await fetch(`${baseUrl}${route}`, { method, headers: fixtureHeaders(requestToken, body !== undefined),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: requestSignal });
      const value = await response.json().catch(() => ({}));
      if (expectedStatus !== null && response.status !== expectedStatus) {
        const safeMessage = String(value.error?.message ?? '').replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
          .replace(/(?:password|token|secret|credential)\s*[=:]\s*\S+/gi, '[redacted-credential]').slice(0, 180);
        throw Object.assign(new Error(`Fixture API request returned ${response.status} (${value.error?.code ?? 'no-code'}): ${safeMessage}`), {
          code: 'FIXTURE_API_UNEXPECTED_RESPONSE', status: response.status,
        });
      }
      return { response, value };
    };
    if (modelBacked) {
      const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
      await requestApi('/api/v1/secrets/secret-t91-n2-fixture-agent/openai-candidate', { method: 'PUT', expectedStatus: 200,
        body: command(`t91-n2-openai-stage-${invocationId}`, { value: 'synthetic-loopback-only-secret', model: 'gpt-fixture',
          reason: 'Use isolated N2 fixture model', expiresAt }, 0) });
      await requestApi('/api/v1/secrets/secret-t91-n2-fixture-agent/openai-candidate/validate', { method: 'POST', expectedStatus: 200,
        body: command(`t91-n2-openai-validate-${invocationId}`, { candidateVersion: 1 }, 0) });
      await requestApi('/api/v1/secrets/secret-t91-n2-fixture-agent/openai-candidate/activate', { method: 'POST', expectedStatus: 200,
        body: command(`t91-n2-openai-activate-${invocationId}`, { candidateVersion: 1, reason: 'Activate isolated N2 fixture model' }, 0) });
    }
    const tenant = FIXTURE_TENANT;
    const projectCreated = await requestApi('/api/v1/projects', { method: 'POST', expectedStatus: 201,
      body: command(`t91-fixture-project-${invocationId}`, { name: 'Synthetic N2 authorization fixture' }) });
    let project = projectCreated.value.data;
    const answers = [
      'A synthetic repair signal supports a test-only prioritisation example.',
      'This fixture demonstrates a process outcome in an isolated database.',
      'The sample has no customer, provider, or external business effect.',
      'A human owner records the synthetic process definition.',
    ];
    for (let index = 0; index < answers.length; index += 1) {
      const answer = await requestApi(`/api/v1/projects/${project.id}/messages`, { method: 'POST',
        body: command(`t91-fixture-answer-${index}-${invocationId}`, { content: answers[index] }, project.version) });
      project = answer.value.data;
    }
    const risk = project.latestBlueprint.areas.governanceRiskControls.items.find((entry) => entry.id === 'risk-unvalidated-demand');
    project = (await requestApi(`/api/v1/projects/${project.id}/blueprint/edits`, { method: 'POST',
      body: command(`t91-fixture-link-risk-${invocationId}`, { objectId: risk.id, name: risk.name,
        detail: risk.detail, processIds: ['process-learn'] }, project.version) })).value.data;

    if (modelBacked) {
      const agent = project.latestBlueprint.areas.peopleAgents.items.find((entry) => entry.id === 'actor-design-assistant');
      project = (await requestApi(`/api/v1/projects/${project.id}/blueprint/edits`, { method: 'POST',
        body: command(`t91-fixture-agent-role-${invocationId}`, { objectId: agent.id, name: agent.name,
          detail: agent.detail, assignedRoleIds: ['role-design-assistant', 'role-operations'] }, project.version) })).value.data;
      await requestApi(`/api/v1/projects/${project.id}`, { token: reviewerToken, expectedStatus: 404 });
      await requestApi(`/api/v1/projects/${project.id}`, { token: 't91-fixture-agent', expectedStatus: 403 });
      // The isolated fixture enrolls the reviewer through normal OIDC bootstrap first, then grants
      // the independently required approval role as trusted fixture authority (matching the
      // persistence test enrollment helper). Approval itself still uses the real route below.
      const reviewerRoles = await app.persistence.query(`update orgward.oidc_principals
        set roles = array(select distinct unnest(roles || array['execution-approver']::text[]) order by 1),
            authz_generation = authz_generation + 1, updated_at = now()
        where tenant_id=$1 and principal=$2 and status='active' and not ('execution-approver'=any(roles))
        returning authz_generation`, [tenant, reviewerIdentity.principal]);
      if (reviewerRoles.rowCount) await app.persistence.query(`insert into orgward.oidc_principal_events
        (tenant_id, principal, event_type, actor, authz_generation)
        values ($1,$2,'PrincipalClaimsUpdated',$2,$3)`, [tenant, reviewerIdentity.principal, reviewerRoles.rows[0].authz_generation]);
      await requestApi(`/api/v1/projects/${project.id}/members`, { method: 'POST', expectedStatus: 200,
        body: { principal: reviewerIdentity.principal, access: 'editor' } });
      await requestApi(`/api/v1/projects/${project.id}/members`, { method: 'POST', expectedStatus: 200,
        body: { principal: agentIdentity.principal, access: 'editor' } });
      const bindingRoute = `/api/v1/projects/${project.id}/actor-bindings/proposals`;
      const binding = await requestApi(bindingRoute, { method: 'POST', expectedStatus: 200,
        body: command(`t91-fixture-agent-binding-${invocationId}`, { actorId: 'actor-design-assistant',
          roleId: 'role-design-assistant', targetPrincipal: agentIdentity.principal,
          blueprintVersion: project.latestBlueprint.version }, project.version) });
      project = binding.value.data;
      project = (await requestApi(`${bindingRoute}/enable`, { method: 'POST',
        body: command(`t91-fixture-agent-enable-${invocationId}`, { actorId: 'actor-design-assistant',
          roleId: 'role-design-assistant', blueprintVersion: project.latestBlueprint.version,
          executionProfileIds: ['t91-n2-fixed-task-agent'] }, project.version) })).value.data;
      const founderBinding = await requestApi(bindingRoute, { method: 'POST', expectedStatus: 200,
        body: command(`t91-fixture-founder-binding-${invocationId}`, { actorId: 'actor-founder',
          roleId: 'role-founder', targetPrincipal: reviewerIdentity.principal,
          blueprintVersion: project.latestBlueprint.version }, project.version) });
      project = founderBinding.value.data;
      project = (await requestApi(`${bindingRoute}/enable`, { method: 'POST',
        body: command(`t91-fixture-founder-enable-${invocationId}`, { actorId: 'actor-founder', roleId: 'role-founder',
          blueprintVersion: project.latestBlueprint.version }, project.version) })).value.data;
    }

    const sourceStore = new PostgresGitHubSourceStore(app.persistence);
    const stateHash = createHash('sha256').update(`t91-fixture-install-${invocationId}`).digest('hex');
    const installation = { installationId: INSTALLATION_ID, appId: '123', accountId: '24680',
      accountLogin: 't91-synthetic-fixture', accountType: 'Organization' };
    await sourceStore.createInstallationIntent({ tenantId: tenant, projectId: project.id, principal: identity.principal,
      authzGeneration: authz.authzGeneration, stateHash, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await sourceStore.setProvisionalInstallationIntent({ tenantId: tenant, principal: identity.principal,
      authzGeneration: authz.authzGeneration, stateHash, installation });
    await sourceStore.completeInstallationIntent({ tenantId: tenant, principal: identity.principal,
      authzGeneration: authz.authzGeneration, stateHash, installation,
      githubUser: { githubUserId: '13579', githubUserLogin: 't91-fixture-owner' } });
    const snapshot = snapshotForFixture(templateFiles);
    await sourceStore.saveCapture({ tenantId: tenant, projectId: project.id, principal: identity.principal,
      authzGeneration: authz.authzGeneration,
      binding: { tenantId: tenant, projectId: project.id, installationId: INSTALLATION_ID,
        repositoryId: REPOSITORY_ID, repositoryName: 'orgward-fixtures/t91-n2-authorization',
        branchRef: BRANCH_REF, provider: 'github-app', credentialReference: `github-installation:${INSTALLATION_ID}` },
      snapshot });

    const plansRoute = `/api/v1/projects/${project.id}/process-plans`;
    const initialPlan = await requestApi(plansRoute, { method: 'POST', expectedStatus: 201,
      body: command(`t91-fixture-process-plan-${invocationId}`, { processId: 'process-review' }, project.version) });
    const plan = initialPlan.value.data.processPlans.at(-1);
    project = initialPlan.value.data;
    if (modelBacked) for (let revision = 2; revision <= 3; revision += 1) {
      const tasks = plan.tasks.map((task) => ({ taskId: task.id, title: task.title, detail: task.detail,
        dependencies: missingAssertion ? [] : task.dependencies,
        roleId: task.id === 'task-process-review' ? 'role-founder' : 'role-design-assistant',
        actorId: task.id === 'task-process-review' ? 'actor-founder' : 'actor-design-assistant' }));
      const updated = await requestApi(`${plansRoute}/${plan.id}/revisions`, { method: 'POST', expectedStatus: 200,
        body: command(`t91-fixture-process-revision-${revision}-${invocationId}`, { tasks }, project.version) });
      project = updated.value.data;
    }
    const latestProject = (await requestApi(`/api/v1/projects/${project.id}`)).value.data;
    const latestBlueprint = latestProject.latestBlueprint;
    const caseCreate = await requestApi('/api/sdlc/cases', { method: 'POST', expectedStatus: 201,
      body: { mode: 'golden', projectId: project.id, sourceObjectId: 'process-learn',
        expectedProjectVersion: latestProject.version, expectedBlueprintId: latestBlueprint.id,
        expectedBlueprintVersion: latestBlueprint.version } });
    const fixtureCaseId = caseCreate.value.id;
    const advanced = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/run`, { method: 'POST',
      body: { version: caseCreate.value.version, idempotencyKey: `t91-fixture-case-run-${invocationId}` } });
    let currentCase = advanced.value;
    let requirement = currentCase.artifacts.requirements.requirements.find((entry) => entry.processTrace?.process.id === 'process-learn');
    if (!requirement || requirement.processTrace.risk.status !== 'LINKED') throw new Error('The synthetic fixture requirement trace is incomplete.');
    if (sharedDraftRecovery) {
      currentCase = (await requestApi(`/api/sdlc/cases/${fixtureCaseId}/add-requirement`, { method: 'POST',
        body: { version: currentCase.version, expectedDraftRevision: currentCase.artifacts.requirements.draftRevision,
          statement: 'Requirement B: retain a separately authored synthetic process safeguard.',
          rationale: 'Initial rationale for the unrelated synthetic requirement.',
          acceptanceCriteria: ['The synthetic safeguard remains independently reviewable.'],
          traceRefIds: [currentCase.processRequirementTrace.process.id,
            currentCase.processRequirementTrace.outcome.outputRefs[0].id],
          idempotencyKey: `t91-r2-add-requirement-b-${invocationId}` },
      })).value;
      requirement = currentCase.artifacts.requirements.requirements.find((entry) => entry.processTrace?.process.id === 'process-learn');
      const otherRequirement = currentCase.artifacts.requirements.requirements.find((entry) => entry.id !== requirement?.id);
      if (!requirement || !otherRequirement) throw Object.assign(new Error('The R2 synthetic second requirement was not appended through the owner API.'), { code: 'FIXTURE_R2_REQUIREMENT_SETUP_FAILED' });
    }
    const criteria = { schemaVersion: 1, version: 1, criteria: [{ id: 'LEARN-OUTCOME',
      text: requirement.acceptanceCriteria[0], type: 'BUSINESS', mandatory: true,
      sourceRefId: requirement.processTrace.process.id, scopeRefId: requirement.processTrace.process.id }] };
    const edited = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/edit-requirements`, { method: 'POST',
      body: { version: currentCase.version, expectedDraftRevision: currentCase.artifacts.requirements.draftRevision,
        requirementId: requirement.id, changes: { criterionContract: criteria }, idempotencyKey: `t91-fixture-criterion-${invocationId}` } });
    currentCase = edited.value;
    requirement = currentCase.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
    const meta = await requestApi('/api/sdlc/meta');
    if (!meta.value.behaviorTestCheck?.available) throw new Error('The isolated behavior-test check is not available.');
    const selectedPaths = ['src/process.mjs', missingAssertion ? 'test/scenario-contract.test.mjs' : 'test/process-contract.test.mjs'];
    const assertions = [{ id: missingAssertion ? pins.requiredPlanAssertionId : 'fixture-learning-assertion',
      testName: missingAssertion ? pins.requiredPlanAssertionName : 'Pinned process learning check', criterionIndex: 0,
      criterionId: 'LEARN-OUTCOME', outcomeRefId: requirement.processTrace.outcome.outputRefs[0].id,
      scopeRefId: requirement.processTrace.process.id, riskRefId: 'risk-unvalidated-demand', checkId: meta.value.behaviorTestCheck.id }];
    const caseDefinitions = {
      positive: { definition: 'The synthetic process produces its pinned output after a named assertion passes.',
        sourceRefId: requirement.processTrace.outcome.outputRefs[0].id, criterionId: 'LEARN-OUTCOME',
        dataset: { repairCount: 2, customerImpact: 'high' },
        expectedOutput: { need: 'prioritised-repair', repeated: true, highImpact: true },
        assertionId: assertions[0].id, testPath: selectedPaths[1] },
      negative: { definition: 'A candidate without the required named assertion is rejected.',
        sourceRefId: requirement.processTrace.risk.refs[0].id, criterionId: 'LEARN-OUTCOME',
        dataset: { cases: [{ id: 'N1', mutation: 'ADD_UNMAPPED_PATH', path: 'src/unmapped.mjs' },
          { id: 'N2', criterionId: 'LEARN-OUTCOME', mandatory: true, assertions: [] },
          { id: 'N3', mutation: 'DELETE_UNAUTHORIZED_TEST', path: 'tests/learning.test.js', sourceExpectedExitCode: 1 }] },
        expectedOutput: { cases: [{ id: 'N1', status: 'FAILED', category: 'BEHAVIOR_CANDIDATE_ORPHAN_PATH', verifierDispatched: false },
          { id: 'N2', authorizationStatus: 400, planSaved: false, missingNamedAssertionLinkStatus: 409,
            missingNamedAssertionError: 'BEHAVIOR_CANDIDATE_REJECTED', caseVersionChanged: false, evidenceLinkCreated: false },
          { id: 'N3', status: 'FAILED', deletedPathRejected: true, verifierDispatched: false }] } },
      recovery: { definition: 'A criterion or shared-draft revision requires a newly pinned plan.',
        sourceRefId: requirement.processTrace.process.id, criterionId: 'LEARN-OUTCOME',
        dataset: { cases: [{ id: 'R1', fromCriterionVersion: 1, toCriterionVersion: 2, retainHistory: true },
          { id: 'R2', editTarget: 'OTHER_REQUIREMENT', change: 'RATIONALE', selectedRequirementUnchanged: true }] },
        expectedOutput: { cases: [{ id: 'R1', oldPlanStatus: 'REGENERATION_REQUIRED', oldLinkStatus: 'STALE',
          staleExecutionStatus: 409, staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE', newPlanBindsVersion: 2,
          oldPlanHashPreserved: true, newRunDistinct: true },
        { id: 'R2', oldPlanStatus: 'REGENERATION_REQUIRED', reason: 'SHARED_REQUIREMENTS_DRAFT_CHANGED',
          staleExecutionError: 'BEHAVIOR_TEST_PLAN_STALE', selectedRequirementHashPreserved: true, newPlanAppended: true }] } },
    };
    const fixturePlanRequest = { version: currentCase.version, draftRevision: currentCase.artifacts.requirements.draftRevision,
      requirementId: requirement.id, planId: plan.id, revision: modelBacked ? 3 : plan.revision, taskId: 'task-process-learn', assertions,
      fileMappings: [{ path: 'src/process.mjs', role: 'IMPLEMENTATION', criterionIds: ['LEARN-OUTCOME'] },
        { path: selectedPaths[1], role: 'TEST', criterionIds: ['LEARN-OUTCOME'] }],
      githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
      idempotencyKey: `t91-fixture-valid-control-${invocationId}`,
      evaluationContext: { effectiveAt: '2026-10-07T00:00:00.000Z',
        effectiveTimeSourceRefId: requirement.processTrace.process.inputs[0].id },
      caseDefinitions };
  const fixtureMapping = { mappingHash: pins.mappingHash, oldPlanHash: pins.oldPlanHash, oldLinkHash: pins.oldLinkHash,
    harnessId: harness.id, harnessVersion: harness.version, harnessHash: pins.harnessHash,
      assertionId: harness.assertionId, assertionHash: pins.assertionHash,
      ...(orphanPath ? { repositoryTreeDigest: pins.sourceTreeDigest } : {}) };
    if (deletedFailingTest) Object.assign(fixtureMapping, { repositoryTreeDigest: pins.sourceTreeDigest,
      sourceTestBytesHash: pins.sourceTestBytesHash, fixtureTemplateHash: pins.fixtureTemplateHash });
    let sourceStage = null;
    if (deletedFailingTest) {
      const sourceTestPath = path.join(tempRoot, 'source-stage', T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath);
      await mkdir(path.dirname(sourceTestPath), { recursive: true, mode: 0o700 });
      await writeFile(sourceTestPath, T91_DELETED_FAILING_TEST_SOURCE, { flag: 'wx', mode: 0o600 });
      const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test' };
      const sourceRun = spawnSync(process.execPath, ['--test', '--test-reporter=tap', sourceTestPath], { cwd: tempRoot, env,
        encoding: 'utf8', timeout: 20_000, maxBuffer: 20_000 });
      sourceStage = { path: T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath,
        bytesHash: createHash('sha256').update(T91_DELETED_FAILING_TEST_SOURCE).digest('hex'),
        treeDigest: snapshot.treeDigest, exitCode: Number.isInteger(sourceRun.status) ? sourceRun.status : null,
        tap: String(sourceRun.stdout ?? '').slice(0, 20_000), terminal: !sourceRun.error && Number.isInteger(sourceRun.status),
        error: String(sourceRun.error?.code ?? '').slice(0, 80) };
      if (!sourceStage.terminal || sourceStage.exitCode !== T91_N3_DELETED_FAILING_TEST_HARNESS.sourceExpectedExitCode) {
        const fixtureHash = t91N3DeletedFailingTestFixtureHash({ mapping: fixtureMapping,
          requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
        return { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
          reservationHash: pins.reservationHash, sourceCaseId, fixtureCaseId, sourceStage, candidate: null, run: null,
          verifierDispatchCount: 0 };
      }
    }
    const fixtureHash = t91N2AuthorizationInvocationFixtureHash({ mapping: fixtureMapping,
      requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
    const counts = async () => {
      const state = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const [audit, outbox] = await Promise.all([
        app.persistence.query(`select count(*)::int as count from orgward.audit_log
          where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenant, fixtureCaseId]),
        app.persistence.query(`select count(*)::int as count from orgward.outbox
          where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenant, fixtureCaseId]),
      ]);
      const runs = await app.persistence.query(`select count(*)::int as count from orgward.aggregates
        where tenant_id=$1 and aggregate_kind='execution_run'`, [tenant]);
      const plans = state.value.artifacts.processBehaviorTestPlans ?? [];
      const requirements = state.value.artifacts.requirements?.requirements ?? [];
      const links = requirements.flatMap((entry) => entry.processRunEvidenceLinks ?? []);
      const evaluations = links.flatMap((entry) => entry.behaviorEvaluation ? [entry.behaviorEvaluation] : []);
      const reviews = requirements.flatMap((entry) => entry.processRunEvidenceReviews ?? []);
      const snapshotState = { version: state.value.version, events: state.value.events, plans,
        links, evaluations, reviews, runCount: runs.rows[0].count,
        auditCount: audit.rows[0].count, outboxCount: outbox.rows[0].count };
      return { caseVersion: state.value.version, eventCount: state.value.events.length, planCount: plans.length,
        linkCount: links.length, evaluationCount: evaluations.length, reviewCount: reviews.length,
        runCount: snapshotState.runCount, auditCount: snapshotState.auditCount, outboxCount: snapshotState.outboxCount,
        digest: digest(snapshotState) };
    };
    if (recovery) {
      const runPlan = async (suffix, versionCase) => {
        const authorized = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-behavior-test-plans`, {
          method: 'POST', expectedStatus: 201, body: { ...fixturePlanRequest, version: versionCase.version,
            draftRevision: versionCase.artifacts.requirements.draftRevision,
            idempotencyKey: `t91-r1-plan-${suffix}-${invocationId}` },
        });
        const behaviorPlan = authorized.value.processBehaviorTestPlan;
        if (!behaviorPlan?.id || !/^[a-f0-9]{64}$/.test(behaviorPlan.planHash ?? '')) {
          throw Object.assign(new Error('The isolated R1 behavior plan lacks an immutable hash.'), { code: 'FIXTURE_PLAN_PIN_MISMATCH' });
        }
        const pending = await requestApi('/api/execution/process-task-runs', { method: 'POST', expectedStatus: 201,
          body: { schemaVersion: '1.0', commandId: `t91-r1-task-${suffix}-${invocationId}`, payload: {
            projectId: project.id, planId: plan.id, revision: 3, taskId: 'task-process-learn',
            profileId: 't91-n2-fixed-task-agent', githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
            behaviorTestCaseId: fixtureCaseId, behaviorTestPlanId: behaviorPlan.id,
          } },
        });
        const approved = await requestApi(`/api/execution/runs/${pending.value.id}/approve`, { method: 'POST',
          token: reviewerToken, body: { version: pending.value.version } });
        const completed = await requestApi(`/api/execution/runs/${pending.value.id}/execute`, { method: 'POST',
          body: { version: approved.value.version } });
        const run = completed.value;
        const check = run.execution?.repositoryCandidate?.checkReceipts?.find((entry) => entry.checkId === 't91-n2-inert-check');
        const outputHash = check?.outputHash ?? run.execution?.verification?.outputHash ?? null;
        if (run.status !== 'SUCCEEDED' || !/^[a-f0-9]{64}$/.test(outputHash ?? '')) {
          throw Object.assign(new Error(`The isolated R1 ${suffix} check did not produce a successful pinned TAP receipt.`), {
            code: 'FIXTURE_R1_CHECK_FAILED',
          });
        }
        const stateBeforeLink = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
        const linked = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-run-evidence`, { method: 'POST', expectedStatus: 201,
          body: { version: stateBeforeLink.value.version, draftRevision: stateBeforeLink.value.artifacts.requirements.draftRevision,
            requirementId: requirement.id, runId: pending.value.id, idempotencyKey: `t91-r1-link-${suffix}-${invocationId}` },
        });
        return { plan: behaviorPlan, run, runId: pending.value.id, check, checkOutputHash: outputHash,
          link: linked.value.processRunEvidenceLink };
      };
      const v1 = await runPlan('v1', currentCase);
      const beforeRevision = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const requirementV1 = beforeRevision.value.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
      const criterionV1 = requirementV1.criterionContract;
      if (criterionV1?.version !== 1) throw Object.assign(new Error('The isolated R1 source plan was not criterion v1.'), { code: 'FIXTURE_R1_SOURCE_VERSION_MISMATCH' });
      const revision = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/edit-requirements`, { method: 'POST',
        body: { version: beforeRevision.value.version,
          expectedDraftRevision: beforeRevision.value.artifacts.requirements.draftRevision, requirementId: requirement.id,
          changes: { criterionContract: { schemaVersion: 1, version: 2,
            criteria: criterionV1.criteria.map((entry) => ({ id: entry.id, text: entry.text,
              type: entry.type, mandatory: entry.mandatory, sourceRefId: entry.source.id, scopeRefId: entry.scope.id })) } },
          idempotencyKey: `t91-r1-criterion-v2-${invocationId}` },
      });
      const staleBefore = await counts();
      const staleResponse = await requestApi('/api/execution/process-task-runs', { method: 'POST', expectedStatus: null,
        body: { schemaVersion: '1.0', commandId: `t91-r1-stale-${invocationId}`, payload: {
          projectId: project.id, planId: plan.id, revision: 3, taskId: 'task-process-learn',
          profileId: 't91-n2-fixed-task-agent', githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
          behaviorTestCaseId: fixtureCaseId, behaviorTestPlanId: v1.plan.id,
        } },
      });
      const staleAfter = await counts();
      const staleCase = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const staleRequirement = staleCase.value.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
      const oldPlanAfter = staleRequirement.processBehaviorTestPlans.find((entry) => entry.id === v1.plan.id);
      const oldLinkAfter = staleRequirement.processRunEvidenceLinks.find((entry) => entry.id === v1.link.id);
      const old = { sourcePlanId: pins.oldPlanId, sourcePlanHash: pins.oldPlanHash,
        sourceLinkId: pins.oldLinkId, sourceLinkHash: pins.oldLinkHash, sourceRunId: pins.oldRunId,
        fixturePlanId: v1.plan.id, fixturePlanHash: v1.plan.planHash, fixtureCriterionContractVersion: v1.plan.criterionContractVersion,
        fixtureLinkId: v1.link.id, fixtureLinkHash: v1.link.linkHash, fixtureRunId: v1.runId,
        planStatusAfterRevision: oldPlanAfter?.regenerationStatus ?? null,
        linkStatusAfterRevision: oldLinkAfter?.applicability ?? null,
        oldPlanHashAfterRevision: oldPlanAfter?.planHash ?? null };
      const v2 = await runPlan('v2', staleCase.value);
      const finalCase = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const finalPlans = finalCase.value.artifacts.processBehaviorTestPlans ?? [];
      const finalRequirement = finalCase.value.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
      const retainedOld = finalPlans.find((entry) => entry.id === v1.plan.id);
      const newPlan = finalPlans.find((entry) => entry.id === v2.plan.id);
      const newLink = finalRequirement.processRunEvidenceLinks.find((entry) => entry.id === v2.link.id);
      const staleAttempt = { httpStatus: staleResponse.response.status, errorCode: staleResponse.value.error?.code ?? null,
        before: staleBefore, after: staleAfter };
      const fresh = { planId: newPlan?.id ?? null, planHash: newPlan?.planHash ?? null,
        criterionContractVersion: newPlan?.criterionContractVersion ?? null, runId: v2.runId,
        runStatus: v2.run.status, checkOutputHash: v2.checkOutputHash,
        linkId: newLink?.id ?? null, linkHash: newLink?.linkHash ?? null,
        linkPlanId: newLink?.behaviorEvaluation?.planId ?? null,
        linkPlanHash: newLink?.behaviorEvaluation?.planHash ?? null, linkRunId: newLink?.run?.id ?? null,
        oldPlanHashStillPresent: retainedOld?.planHash ?? null };
      const fixtureMappingForHash = { mappingHash: pins.mappingHash, oldPlanHash: pins.oldPlanHash,
        oldLinkHash: pins.oldLinkHash, harnessHash: pins.harnessHash };
      const fixtureHash = t91R1RecoveryFixtureHash({ mapping: fixtureMappingForHash,
        requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
      return { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
        reservationHash: pins.reservationHash, sourceCaseId, fixtureCaseId, old, staleAttempt, fresh };
    }
    if (sharedDraftRecovery) {
      const runPlan = async (suffix, versionCase) => {
        const authorized = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-behavior-test-plans`, {
          method: 'POST', expectedStatus: 201, body: { ...fixturePlanRequest, version: versionCase.version,
            draftRevision: versionCase.artifacts.requirements.draftRevision,
            idempotencyKey: `t91-r2-plan-${suffix}-${invocationId}` },
        });
        const behaviorPlan = authorized.value.processBehaviorTestPlan;
        if (!behaviorPlan?.id || !/^[a-f0-9]{64}$/.test(behaviorPlan.planHash ?? '')) {
          throw Object.assign(new Error('The isolated R2 behavior plan lacks an immutable hash.'), { code: 'FIXTURE_PLAN_PIN_MISMATCH' });
        }
        const pending = await requestApi('/api/execution/process-task-runs', { method: 'POST', expectedStatus: 201,
          body: { schemaVersion: '1.0', commandId: `t91-r2-task-${suffix}-${invocationId}`, payload: {
            projectId: project.id, planId: plan.id, revision: 3, taskId: 'task-process-learn',
            profileId: 't91-n2-fixed-task-agent', githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
            behaviorTestCaseId: fixtureCaseId, behaviorTestPlanId: behaviorPlan.id,
          } },
        });
        const approved = await requestApi(`/api/execution/runs/${pending.value.id}/approve`, { method: 'POST',
          token: reviewerToken, body: { version: pending.value.version } });
        const completed = await requestApi(`/api/execution/runs/${pending.value.id}/execute`, { method: 'POST',
          body: { version: approved.value.version } });
        const run = completed.value;
        const check = run.execution?.repositoryCandidate?.checkReceipts?.find((entry) => entry.checkId === 't91-n2-inert-check');
        const outputHash = check?.outputHash ?? run.execution?.verification?.outputHash ?? null;
        if (run.status !== 'SUCCEEDED' || !/^[a-f0-9]{64}$/.test(outputHash ?? '')) {
          throw Object.assign(new Error(`The isolated R2 ${suffix} check did not produce a successful pinned TAP receipt.`), {
            code: 'FIXTURE_R2_CHECK_FAILED',
          });
        }
        const stateBeforeLink = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
        const linked = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-run-evidence`, { method: 'POST', expectedStatus: 201,
          body: { version: stateBeforeLink.value.version, draftRevision: stateBeforeLink.value.artifacts.requirements.draftRevision,
            requirementId: requirement.id, runId: pending.value.id, idempotencyKey: `t91-r2-link-${suffix}-${invocationId}` },
        });
        return { plan: behaviorPlan, run, runId: pending.value.id, check, checkOutputHash: outputHash,
          link: linked.value.processRunEvidenceLink };
      };
      const v1 = await runPlan('v1', currentCase);
      const beforeEdit = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const requirementsBefore = beforeEdit.value.artifacts.requirements.requirements;
      const selectedBefore = requirementsBefore.find((entry) => entry.id === requirement.id);
      const otherBefore = requirementsBefore.find((entry) => entry.id !== requirement.id);
      const fixtureSelectedRequirementHash = requirementContentHash(selectedBefore);
      const ownerSelectedRequirementHash = pins.selectedRequirementHash;
      const ownerOtherRequirementId = pins.otherRequirementId;
      const ownerOtherRequirementHash = pins.otherRequirementHash;
      const editResponse = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/edit-requirements`, { method: 'POST',
        body: { version: beforeEdit.value.version, expectedDraftRevision: beforeEdit.value.artifacts.requirements.draftRevision,
          requirementId: otherBefore.id, changes: { rationale: 'Updated rationale after the original A plan was linked.' },
          idempotencyKey: `t91-r2-edit-requirement-b-${invocationId}` },
      });
      const editedCase = editResponse.value;
      const requirementsAfter = editedCase.artifacts.requirements.requirements;
      const selectedAfter = requirementsAfter.find((entry) => entry.id === requirement.id);
      const otherAfter = requirementsAfter.find((entry) => entry.id === otherBefore.id);
      const selectedRequirementHashAfter = requirementContentHash(selectedAfter);
      const otherRequirementHashAfter = requirementContentHash(otherAfter);
      const staleBefore = await counts();
      const staleResponse = await requestApi('/api/execution/process-task-runs', { method: 'POST', expectedStatus: null,
        body: { schemaVersion: '1.0', commandId: `t91-r2-stale-${invocationId}`, payload: {
          projectId: project.id, planId: plan.id, revision: 3, taskId: 'task-process-learn',
          profileId: 't91-n2-fixed-task-agent', githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
          behaviorTestCaseId: fixtureCaseId, behaviorTestPlanId: v1.plan.id,
        } },
      });
      const staleAfter = await counts();
      const staleState = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const staleRequirement = staleState.value.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
      const stalePlan = staleRequirement.processBehaviorTestPlans.find((entry) => entry.id === v1.plan.id);
      const stale = { httpStatus: staleResponse.response.status, errorCode: staleResponse.value.error?.code ?? null,
        before: staleBefore, after: staleAfter };
      const old = { sourcePlanId: pins.oldPlanId, sourcePlanHash: pins.oldPlanHash,
        sourceLinkId: pins.oldLinkId, sourceLinkHash: pins.oldLinkHash, sourceRunId: pins.oldRunId,
        fixturePlanId: v1.plan.id, fixturePlanHash: v1.plan.planHash, fixtureLinkId: v1.link.id,
        fixtureLinkHash: v1.link.linkHash, fixtureRunId: v1.runId, draftRevision: beforeEdit.value.artifacts.requirements.draftRevision,
        selectedRequirementHashBefore: fixtureSelectedRequirementHash,
        selectedRequirementHashAfter, ownerSelectedRequirementHash,
        ownerOtherRequirementId, ownerOtherRequirementHash,
        otherRequirementId: otherBefore.id, otherRequirementHashBefore: requirementContentHash(otherBefore),
        otherRequirementHashAfter, planStatusAfterEdit: stalePlan?.regenerationStatus ?? null,
        linkStatusAfterEdit: staleRequirement.processRunEvidenceLinks.find((entry) => entry.id === v1.link.id)?.applicability ?? null,
        regenerationReason: stalePlan?.regenerationReason ?? null, oldPlanHashAfterEdit: stalePlan?.planHash ?? null };
      const v2 = await runPlan('v2', staleState.value);
      const finalCase = await requestApi(`/api/sdlc/cases/${fixtureCaseId}`);
      const finalPlans = finalCase.value.artifacts.processBehaviorTestPlans ?? [];
      const finalRequirement = finalCase.value.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
      const retainedOldPlan = finalPlans.find((entry) => entry.id === v1.plan.id);
      const finalSelected = finalCase.value.artifacts.requirements.requirements.find((entry) => entry.id === requirement.id);
      const fresh = { planId: v2.plan.id, planHash: v2.plan.planHash,
        draftRevision: v2.plan.draftRevision, criterionContractVersion: v2.plan.criterionContractVersion,
        runId: v2.runId, runStatus: v2.run.status, checkOutputHash: v2.checkOutputHash,
        linkId: v2.link.id, linkHash: v2.link.linkHash, linkPlanId: v2.link.behaviorEvaluation?.planId,
        linkPlanHash: v2.link.behaviorEvaluation?.planHash, linkRunId: v2.link.run?.id,
        oldPlanHashStillPresent: retainedOldPlan?.planHash ?? null,
        oldLinkHashStillPresent: finalRequirement.processRunEvidenceLinks.find((entry) => entry.id === v1.link.id)?.linkHash ?? null,
        ownerSelectedRequirementHash: pins.selectedRequirementHash,
        fixtureSelectedRequirementHash: requirementContentHash(finalSelected) };
      const fixtureMappingForHash = { mappingHash: pins.mappingHash, oldPlanHash: pins.oldPlanHash,
        oldLinkHash: pins.oldLinkHash, selectedRequirementHash: pins.selectedRequirementHash,
        otherRequirementId: pins.otherRequirementId, otherRequirementHash: pins.otherRequirementHash,
        harnessHash: pins.harnessHash };
      const fixtureHash = t91R2RecoveryFixtureHash({ mapping: fixtureMappingForHash,
        requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
      return { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
        reservationHash: pins.reservationHash, sourceCaseId, fixtureCaseId, old, staleAttempt: stale, fresh };
    }
    if (missingAssertion) {
      const beforePlan = await counts();
      const authorized = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-behavior-test-plans`, {
        method: 'POST', expectedStatus: 201, body: { ...fixturePlanRequest, version: beforePlan.caseVersion,
          idempotencyKey: `t91-n2-missing-assertion-plan-${invocationId}` },
      });
      const behaviorPlanId = authorized.value.processBehaviorTestPlan?.id;
      const behaviorPlanHash = authorized.value.processBehaviorTestPlan?.planHash;
      if (!behaviorPlanId || !/^[a-f0-9]{64}$/.test(behaviorPlanHash ?? '')) {
        throw Object.assign(new Error('The isolated missing-assertion plan was not saved with a valid immutable hash.'), {
          code: 'FIXTURE_PLAN_PIN_MISMATCH',
        });
      }
      const authz = await app.sessionStore.resolve(identity);
      const profileReference = 'secret-t91-n2-fixture-agent';
      if (!authz?.roles.includes('workspace-write')) throw new Error('The fixture owner cannot execute the fixed process-task profile.');
      const taskRequest = await requestApi('/api/execution/process-task-runs', { method: 'POST', expectedStatus: 201,
        body: { schemaVersion: '1.0', commandId: `t91-n2-task-${invocationId}`, payload: {
          projectId: project.id, planId: plan.id, revision: 3, taskId: 'task-process-learn', profileId: 't91-n2-fixed-task-agent',
          githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
          behaviorTestCaseId: fixtureCaseId, behaviorTestPlanId: behaviorPlanId,
        } },
      });
      const pendingRun = taskRequest.value;
      const approvedRun = await requestApi(`/api/execution/runs/${pendingRun.id}/approve`, { method: 'POST', token: reviewerToken,
        body: { version: pendingRun.version } });
      const completed = await requestApi(`/api/execution/runs/${pendingRun.id}/execute`, { method: 'POST',
        body: { version: approvedRun.value.version } });
      const run = completed.value;
      const checkReceipt = run.execution?.repositoryCandidate?.checkReceipts?.find((entry) => entry.checkId === 't91-n2-inert-check');
      const checkOutput = checkReceipt?.stdout ?? run.execution?.verification?.stdout ?? '';
      const parsedAssertion = checkOutput.split(/\r?\n/).some((line) => line === `ok 1 - ${pins.requiredPlanAssertionName}`)
        ? { status: 'PASS', reason: null }
        : { status: 'UNKNOWN', reason: 'ASSERTION_RESULT_NOT_FOUND' };
      const beforeAttempt = await counts();
      const linkResponse = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-run-evidence`, { method: 'POST',
        expectedStatus: null, body: { version: beforeAttempt.caseVersion,
          draftRevision: currentCase.artifacts.requirements.draftRevision, requirementId: requirement.id,
          runId: pendingRun.id, idempotencyKey: `t91-n2-missing-assertion-link-${invocationId}` } });
      const afterAttempt = await counts();
      const expectedFailure = linkResponse.value.error?.details?.failedAssertions?.find((entry) => entry.id === pins.requiredPlanAssertionId);
      const fixtureHash = t91N2MissingAssertionFixtureHash({ mapping: { harnessId: harness.id,
        harnessVersion: harness.version, harnessHash: pins.harnessHash, assertionId: harness.assertionId,
        assertionHash: pins.assertionHash, requiredPlanAssertionId: pins.requiredPlanAssertionId,
        requiredPlanAssertionName: pins.requiredPlanAssertionName, requiredPlanAssertionHash: pins.requiredPlanAssertionHash },
        requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
      return { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
        reservationHash: pins.reservationHash, sourceCaseId,
        fixturePlan: { id: behaviorPlanId, planHash: behaviorPlanHash, httpStatus: authorized.response.status },
        run: { id: run.id, status: run.status, error: String(run.execution?.error ?? '').slice(0, 240),
          planId: behaviorPlanId, planHash: behaviorPlanHash,
          checkId: checkReceipt?.checkId ?? null, tapHash: digest(checkOutput),
          outputHash: checkReceipt?.outputHash ?? run.execution?.verification?.outputHash ?? null,
          check: checkReceipt ? { id: checkReceipt.checkId, status: checkReceipt.status ?? null,
            executionStatus: checkReceipt.executionStatus ?? null,
            exitCode: checkReceipt.exitCode ?? null, error: String(checkReceipt.error ?? '').slice(0, 240),
            checkVersion: checkReceipt.checkVersion ?? null, planHash: checkReceipt.planHash ?? null,
            commandHash: checkReceipt.commandHash ?? null,
          outputHash: checkReceipt.outputHash ?? null,
            candidateTreeDigest: checkReceipt.candidateTreeDigest ?? null,
            candidateTreeDigestAfter: checkReceipt.candidateTreeDigestAfter ?? null,
            stdoutTruncated: checkReceipt.stdoutTruncated === true, stderrTruncated: checkReceipt.stderrTruncated === true,
            stdout: String(checkReceipt.stdout ?? '').slice(0, 20_000), stderr: String(checkReceipt.stderr ?? '').slice(0, 20_000) } : null,
          assertion: { id: expectedFailure?.id ?? pins.requiredPlanAssertionId,
            name: expectedFailure?.name ?? pins.requiredPlanAssertionName,
            status: expectedFailure?.status ?? parsedAssertion.status,
            reason: expectedFailure?.reason ?? parsedAssertion.reason } },
        attempt: { terminal: linkResponse.response.status > 0, fixtureCaseId,
          httpStatus: linkResponse.response.status, errorCode: linkResponse.value.error?.code ?? null,
          before: beforeAttempt, after: afterAttempt } };
    }
    if (orphanPath || deletedFailingTest) {
      const beforePlan = await counts();
      const authorized = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-behavior-test-plans`, {
        method: 'POST', expectedStatus: 201, body: { ...fixturePlanRequest, version: beforePlan.caseVersion,
          idempotencyKey: `t91-n1-orphan-plan-${invocationId}` },
      });
      const behaviorPlanId = authorized.value.processBehaviorTestPlan?.id;
      const behaviorPlanHash = authorized.value.processBehaviorTestPlan?.planHash;
      if (!behaviorPlanId || !/^[a-f0-9]{64}$/.test(behaviorPlanHash ?? '')) throw Object.assign(
        new Error('The isolated N1 behavior plan was not saved with a valid immutable hash.'), { code: 'FIXTURE_PLAN_PIN_MISMATCH' });
      const taskRequest = await requestApi('/api/execution/process-task-runs', { method: 'POST', expectedStatus: 201,
        body: { schemaVersion: '1.0', commandId: `t91-n1-task-${invocationId}`, payload: {
          projectId: project.id, planId: plan.id, revision: 3, taskId: 'task-process-learn', profileId: 't91-n2-fixed-task-agent',
          githubSnapshotId: snapshot.id, githubSelectedPaths: selectedPaths,
          behaviorTestCaseId: fixtureCaseId, behaviorTestPlanId: behaviorPlanId,
        } },
      });
      const pendingRun = taskRequest.value;
      const approvedRun = await requestApi(`/api/execution/runs/${pendingRun.id}/approve`, { method: 'POST', token: reviewerToken,
        body: { version: pendingRun.version } });
      let candidateEvidence = null;
      let verifierDispatchCount = 0;
      const originalAdapterFactory = app.executionService.commandAdapterFactory;
      app.executionService.commandAdapterFactory = (options) => {
        verifierDispatchCount += 1;
        return originalAdapterFactory(options);
      };
      app.executionService.githubCandidateSnapshotAdapter = async ({ phase, run, snapshot, sourceSnapshot, workspace }) => {
        const source = snapshot ?? sourceSnapshot;
        if (run.id !== pendingRun.id) return phase === 'source' ? source : undefined;
        if (phase === 'source') return source;
        if (deletedFailingTest) {
          await rm(path.join(workspace, T91_N3_DELETED_FAILING_TEST_HARNESS.sourcePath), { force: false });
          const candidateSnapshot = await captureLocalRepositorySnapshot(workspace, { excludeGitDirectory: false });
          const changes = localRepositoryDiff(source, candidateSnapshot);
          const deleted = changes.filter((entry) => entry.change === 'deleted');
          candidateEvidence = { sourceTreeDigest: source.treeDigest, candidateTreeDigest: candidateSnapshot.treeDigest,
            changes, deletedPath: deleted.length === 1 ? deleted[0].path : null,
            deletedPathHash: deleted.length === 1 ? deleted[0].beforeHash : null };
          return;
        }
        await writeFile(path.join(workspace, T91_N1_ORPHAN_PATH_HARNESS.candidatePath),
          'export const unmappedCandidate = true;\n', { flag: 'wx', mode: 0o600 });
        const candidateSnapshot = await captureLocalRepositorySnapshot(workspace, { excludeGitDirectory: false });
        const changes = localRepositoryDiff(source, candidateSnapshot);
        const added = changes.filter((entry) => entry.change === 'added');
        candidateEvidence = { sourceTreeDigest: source.treeDigest, candidateTreeDigest: candidateSnapshot.treeDigest,
          changes, addedPath: added.length === 1 ? added[0].path : null,
          addedPathHash: added.length === 1 ? added[0].afterHash : null };
      };
      const run = await requestApi(`/api/execution/runs/${pendingRun.id}/execute`, { method: 'POST',
        body: { version: approvedRun.value.version } });
      app.executionService.githubCandidateSnapshotAdapter = null;
      app.executionService.commandAdapterFactory = originalAdapterFactory;
      if (deletedFailingTest) {
        const fixtureHash = t91N3DeletedFailingTestFixtureHash({ mapping: fixtureMapping,
          requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
        return { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
          reservationHash: pins.reservationHash, sourceCaseId, fixtureCaseId, sourceStage,
          source: { treeDigest: candidateEvidence?.sourceTreeDigest ?? snapshot.treeDigest,
            planTreeDigest: pins.sourceTreeDigest, sourceTestBytesHash: sourceStage?.bytesHash },
          candidate: { treeDigest: candidateEvidence?.candidateTreeDigest ?? null,
            deletedPath: candidateEvidence?.deletedPath ?? null, deletedPathHash: candidateEvidence?.deletedPathHash ?? null,
            changes: candidateEvidence?.changes ?? null },
          run: { id: run.value.id, status: run.value.status,
            errorCode: run.value.execution?.errorCode ?? null, error: String(run.value.execution?.error ?? '').slice(0, 240) },
          verifierDispatchCount };
      }
      const fixtureHash = t91N1OrphanPathFixtureHash({ mapping: fixtureMapping,
        requestHash: pins.fixtureRequestHash, fixtureTemplateHash: templateHash, invocationId });
      return { terminal: true, fixtureHash, fixtureTemplateHash: templateHash, invocationId,
        reservationHash: pins.reservationHash, sourceCaseId, fixtureCaseId,
        source: { treeDigest: candidateEvidence?.sourceTreeDigest ?? null, planTreeDigest: pins.sourceTreeDigest },
        candidate: { treeDigest: candidateEvidence?.candidateTreeDigest ?? null,
          addedPath: candidateEvidence?.addedPath ?? null, addedPathHash: candidateEvidence?.addedPathHash ?? null,
          changes: candidateEvidence?.changes ?? null },
        run: { id: run.value.id, status: run.value.status,
          errorCode: run.value.execution?.errorCode ?? null, error: String(run.value.execution?.error ?? '').slice(0, 240) },
        verifierDispatchCount };
    }
    const beforeControl = await counts();
    const control = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-behavior-test-plans`, {
      method: 'POST', expectedStatus: 201, body: { ...fixturePlanRequest, version: beforeControl.caseVersion,
        draftRevision: currentCase.artifacts.requirements.draftRevision,
        idempotencyKey: `t91-n2-control-${invocationId}` },
    });
    const acceptedPlanHash = control.value.processBehaviorTestPlan?.planHash;
    const afterControl = await counts();
    const beforeAttempt = afterControl;
    const attempt = await requestApi(`/api/sdlc/cases/${fixtureCaseId}/process-behavior-test-plans`, {
      method: 'POST', expectedStatus: null, body: { ...fixturePlanRequest, version: beforeAttempt.caseVersion,
        draftRevision: currentCase.artifacts.requirements.draftRevision, assertions: [],
        idempotencyKey: `t91-n2-empty-${invocationId}` },
    });
    const afterAttempt = await counts();
    const observation = { terminal: true, fixtureHash, invocationId, fixtureTemplateHash: templateHash,
      reservationHash: pins.reservationHash,
      fixtureDatabaseName: databaseName, fixtureDatabaseOid: databaseOid, fixtureClusterId,
      control: { terminal: true, fixtureCreated: Boolean(acceptedPlanHash), acceptedPlanHash,
        fixtureCaseId, httpStatus: control.response.status, errorCode: control.value.error?.code ?? null,
        fixtureHash, before: beforeControl, after: afterControl },
      attempt: { terminal: true, fixtureCaseId, httpStatus: attempt.response.status,
        errorCode: attempt.value.error?.code ?? null, fixtureHash, before: beforeAttempt, after: afterAttempt },
      sourceCaseId };
    return observation;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await cleanup();
    void databaseName;
    void databaseOid;
    void fixtureClusterId;
  }
}
