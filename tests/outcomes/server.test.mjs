import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { addConversationTurn, createProject, latestBlueprint } from '../../src/model.mjs';
import { contentHash } from '../../src/platform/postgres.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const tenantId = 'tenant-outcome-test';
const issuer = 'https://outcomes.example.test';
const subjects = ['owner', 'editor', 'reader', 'outsider', 'foreign'];
const roles = { owner: ['workspace-read', 'workspace-write'], editor: ['workspace-read', 'workspace-write'],
  reader: ['workspace-read'], outsider: ['workspace-read', 'workspace-write'] };
const identities = new Map(subjects.map((subject) => {
  const principal = `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  return [subject, { issuer, subject, principal, tenantId: subject === 'foreign' ? 'tenant-outcome-foreign' : tenantId, actorType: 'human', displayName: subject,
    roles: roles[subject], expiresAt: Math.floor(Date.now() / 1000) + 300 }];
}));
const hash = (char) => char.repeat(64);

async function seedProject(postgres) {
  const owner = identities.get('owner').principal;
  const editor = identities.get('editor').principal;
  const reader = identities.get('reader').principal;
  const project = createProject('Outcome follow-up fixture');
  for (const answer of [
    'A service that moves customer transfers safely.',
    'Small businesses that need reliable same-day transfers.',
    'We charge a per-transfer fee and focus on transparent status.',
    'Human approval remains required for exceptions and regulated controls.',
  ]) addConversationTurn(project, answer);
  const now = new Date().toISOString();
  Object.assign(project, { tenantId, version: 1, createdBy: owner, updatedBy: owner, updatedAt: now,
    events: [], commandRecords: {}, memberships: [
      { principal: owner, access: 'owner', revokedAt: null },
      { principal: editor, access: 'editor', revokedAt: null },
      { principal: reader, access: 'reader', revokedAt: null },
    ] });
  await postgres.query(`insert into orgward.aggregates
    (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
    values ($1,'project',$2,$3,$4::jsonb,$5,$6)`,
  [tenantId, project.id, project.version, JSON.stringify(project), contentHash(project), now]);
  await postgres.query(`insert into orgward.project_memberships
    (tenant_id,project_id,principal,access,granted_by)
    values ($1,$2,$3,'owner',$3),($1,$2,$4,'editor',$3),($1,$2,$5,'reader',$3)`,
  [tenantId, project.id, owner, editor, reader]);
  return project;
}

async function seedSources(postgres, project) {
  const runId = `execution-run-${randomUUID()}`;
  const foreignRunId = `execution-run-${randomUUID()}`;
  const now = new Date().toISOString();
  for (const [id, scopedProject] of [[runId, project.id], [foreignRunId, `project-${randomUUID()}`]]) {
    const run = { id, tenantId, projectId: scopedProject, version: 1, status: 'COMPLETED',
      title: id === runId ? 'Transfer reconciliation task' : 'Another project task',
      execution: { evidenceHash: hash(id === runId ? 'a' : 'b') }, createdAt: now, updatedAt: now };
    await postgres.query(`insert into orgward.aggregates
      (tenant_id,aggregate_kind,aggregate_id,version,state,state_hash,updated_at)
      values ($1,'execution_run',$2,1,$3::jsonb,$4,$5)`,
    [tenantId, id, JSON.stringify(run), contentHash(run), now]);
    await postgres.query(`insert into orgward.aggregate_project_scopes
      (tenant_id,aggregate_kind,aggregate_id,project_id) values ($1,'execution_run',$2,$3)`, [tenantId, id, scopedProject]);
  }
  const actionId = `release-action-${randomUUID()}`;
  const request = { version: 'protected-release-request-v1', kind: 'release',
    environment: { id: 'production', configurationHash: hash('c') },
    candidate: { runId, candidateEvidenceHash: hash('d'), candidateTreeDigest: hash('e') } };
  const action = { id: actionId, version: 3, status: 'SUCCEEDED', request, requestHash: digest(request),
    observations: [{ status: 'APPLIED', health: 'healthy', recordedAt: now }], events: [] };
  await postgres.query(`insert into orgward.protected_release_actions
    (tenant_id,project_id,action_id,environment_id,state,state_hash,created_at)
    values ($1,$2,$3,'production',$4::jsonb,$5,$6)`,
  [tenantId, project.id, actionId, JSON.stringify(action), contentHash(action), now]);
  return { runId, foreignRunId, actionId, action };
}

async function startApp(postgres, root) {
  const oidcAuthenticator = { authenticate: async (request) => {
    const subject = request.headers.authorization?.slice('Bearer '.length);
    return identities.get(subject) ?? null;
  } };
  const app = createApp({ databaseUrl: postgres.databaseUrl,
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'executions'), executionWorkspaceDirectory: path.join(root, 'workspaces'),
    oidcAuthenticator });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function closeApp(instance) {
  if (!instance) return;
  instance.app.server.closeIdleConnections?.();
  await new Promise((resolve, reject) => instance.app.server.close((error) => error ? reject(error) : resolve()));
  await instance.app.close();
}

async function request(base, subject, route, { method = 'GET', body } = {}, expectedStatus = 200) {
  const response = await fetch(`${base}${route}`, { method,
    headers: { authorization: `Bearer ${subject}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(value));
  return value;
}

function createBody({ commandId, source, title = 'Transfer outcome', category = 'incident' }) {
  return { commandId, title, category, source, ownerPrincipal: identities.get('owner').principal };
}
function actionBody(commandId, expectedVersion, fields) { return { commandId, expectedVersion, ...fields }; }
function outcomeRoute(projectId, outcomeId, operation = '') {
  return `/api/v1/projects/${projectId}/outcomes/${outcomeId}${operation ? `/${operation}` : ''}`;
}

test('customer outcomes bind real sources, preserve reported evidence, and create one owned, scoped follow-up case across restart', async (t) => {
  const postgres = await startPostgres();
  t.after(() => postgres.close());
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-customer-outcomes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres);
  const sources = await seedSources(postgres, project);
  const baseRoute = `/api/v1/projects/${project.id}/outcomes`;
  let instance = await startApp(postgres, root);
  t.after(async () => closeApp(instance));
  const initial = await request(instance.base, 'editor', baseRoute);
  assert.deepEqual(initial.outcomes, []);
  assert.ok(initial.sources.tasks.some((entry) => entry.runId === sources.runId));
  assert.ok(initial.sources.releases.some((entry) => entry.actionId === sources.actionId));
  assert.ok(initial.sources.design.objects.some((entry) => entry.id === 'goal-customer-outcome'));

  const taskCreate = createBody({ commandId: 'create-task-outcome', source: { kind: 'task', runId: sources.runId } });
  const taskCreated = await request(instance.base, 'editor', baseRoute, { method: 'POST', body: taskCreate }, 201);
  assert.equal(taskCreated.outcome.source.kind, 'task');
  assert.equal(taskCreated.outcome.source.runVersion, 1);
  assert.equal(taskCreated.outcome.source.evidenceKind, undefined);
  const duplicateCreate = await request(instance.base, 'editor', baseRoute, { method: 'POST', body: taskCreate });
  assert.equal(duplicateCreate.replayed, true);
  assert.equal(duplicateCreate.outcome.id, taskCreated.outcome.id);

  const manualCreated = await request(instance.base, 'editor', baseRoute, { method: 'POST', body: createBody({
    commandId: 'create-manual-outcome', title: 'Customer reported transfer delay', category: 'support',
    source: { kind: 'manual', summary: 'A customer reports a delayed transfer; this report is not independently verified.' },
  }) }, 201);
  assert.equal(manualCreated.outcome.source.evidenceKind, 'HUMAN_REPORTED');
  assert.match(manualCreated.outcome.source.summary, /not independently verified/);
  const manualObservation = await request(instance.base, 'editor', outcomeRoute(project.id, manualCreated.outcome.id, 'observe'), {
    method: 'POST', body: { commandId: 'observe-manual-support-item', expectedVersion: 1, window: 'Customer report only', measures: [
      { id: 'reported-delay', name: 'Transfer delay verified', dimension: 'business', actual: null, target: null,
        comparison: 'eq', unit: 'boolean', evidenceSummary: '', observedAt: null },
    ] },
  });
  assert.equal(manualObservation.outcome.latestEvaluation.business, 'UNKNOWN');
  const rejectedProposal = await request(instance.base, 'editor', outcomeRoute(project.id, manualCreated.outcome.id, 'propose'), {
    method: 'POST', body: actionBody('propose-manual-support-learning', 2, { title: 'Verify transfer timing first',
      recommendation: 'Collect a timestamped operational sample.', rationale: 'The only evidence is an unverified report.',
      observationHash: manualObservation.outcome.latestEvaluation.observationHash }),
  });
  const rejected = await request(instance.base, 'owner', outcomeRoute(project.id, manualCreated.outcome.id, 'review'), {
    method: 'POST', body: actionBody('reject-manual-support-learning', 3, { proposalHash: rejectedProposal.outcome.proposals[0].proposalHash,
      decision: 'reject', reason: 'Collect operational evidence before proposing a design change.' }),
  });
  assert.equal(rejected.outcome.proposals[0].status, 'REJECTED');
  assert.equal(rejected.outcome.proposals[0].review.decision, 'reject');

  const releaseCreated = await request(instance.base, 'editor', baseRoute, { method: 'POST', body: createBody({
    commandId: 'create-release-outcome', title: 'Production release follow-up', category: 'improvement',
    source: { kind: 'release', actionId: sources.actionId },
  }) }, 201);
  assert.equal(releaseCreated.outcome.source.statusAtCapture, 'SUCCEEDED');
  assert.equal(releaseCreated.outcome.source.requestHash, sources.action.requestHash);
  assert.equal(releaseCreated.outcome.source.candidateEvidenceHash, sources.action.request.candidate.candidateEvidenceHash);
  const changedRelease = { ...sources.action, version: sources.action.version + 1, status: 'FAILED' };
  await postgres.query(`update orgward.protected_release_actions set state=$4::jsonb,state_hash=$5
    where tenant_id=$1 and project_id=$2 and action_id=$3`,
  [tenantId, project.id, sources.actionId, JSON.stringify(changedRelease), contentHash(changedRelease)]);
  const immutableReleaseOutcome = await request(instance.base, 'editor', outcomeRoute(project.id, releaseCreated.outcome.id));
  assert.equal(immutableReleaseOutcome.outcome.source.statusAtCapture, 'SUCCEEDED',
    'captured release evidence remains immutable when the source action later changes');

  const foreignSource = await request(instance.base, 'editor', baseRoute, { method: 'POST', body: createBody({
    commandId: 'create-foreign-task-outcome', source: { kind: 'task', runId: sources.foreignRunId },
  }) }, 404);
  assert.equal(foreignSource.error.code, 'OUTCOME_SOURCE_NOT_FOUND');
  const outsider = await request(instance.base, 'outsider', baseRoute, {}, 403);
  assert.equal(outsider.error.code, 'ACTION_FORBIDDEN');
  const foreignTenant = await request(instance.base, 'foreign', baseRoute, {}, 403);
  assert.equal(foreignTenant.error.code, 'ACTION_FORBIDDEN');

  const outcomeId = taskCreated.outcome.id;
  const observePath = outcomeRoute(project.id, outcomeId, 'observe');
  const observationTime = new Date(Date.now() - 120_000).toISOString();
  const firstObservation = { commandId: 'observe-transfer-window-1', expectedVersion: 1,
    window: '1–7 October', measures: [
      { id: 'successful-runs', name: 'Successful transfer runs', dimension: 'technical', actual: 9, target: 8,
        comparison: 'gte', unit: 'count', evidenceSummary: 'Saved task results reviewed by the operator.', observedAt: observationTime },
      { id: 'control-review', name: 'Control review coverage', dimension: 'control', actual: null, target: 1,
        comparison: 'gte', unit: 'ratio', evidenceSummary: '', observedAt: null },
      { id: 'manual-work', name: 'Manual handling rate', dimension: 'business', actual: 42, target: 50,
        comparison: 'gte', unit: 'percent', evidenceSummary: 'Operator reported sample.', observedAt: observationTime },
    ] };
  const observed = await request(instance.base, 'editor', observePath, { method: 'POST', body: firstObservation });
  assert.deepEqual(observed.outcome.latestEvaluation && {
    technical: observed.outcome.latestEvaluation.technical,
    control: observed.outcome.latestEvaluation.control,
    business: observed.outcome.latestEvaluation.business,
  }, { technical: 'MET', control: 'UNKNOWN', business: 'NOT_MET' });
  assert.ok(observed.outcome.observations[0].measures.every((measure) => measure.evidenceKind === 'HUMAN_REPORTED'));
  assert.equal(observed.outcome.latestEvaluation.evidenceKind, 'HUMAN_REPORTED');
  const staleVersion = await request(instance.base, 'editor', observePath, { method: 'POST', body: {
    ...firstObservation, commandId: 'stale-version-observation', expectedVersion: 1,
  } }, 409);
  assert.equal(staleVersion.error.code, 'OUTCOME_VERSION_CONFLICT');

  const proposalBody = (commandId, expectedVersion, observationHash) => actionBody(commandId, expectedVersion, {
    title: 'Bound retries for transfer processing', recommendation: 'Add a bounded retry for transient failures.',
    rationale: 'The reported business outcome missed its target while a control dimension remains unknown.', observationHash,
  });
  const firstProposal = await request(instance.base, 'editor', outcomeRoute(project.id, outcomeId, 'propose'), {
    method: 'POST', body: proposalBody('propose-stale-learning', 2, observed.outcome.latestEvaluation.observationHash),
  });
  const deniedReview = await request(instance.base, 'editor', outcomeRoute(project.id, outcomeId, 'review'), {
    method: 'POST', body: actionBody('editor-cannot-review', 3, { proposalHash: firstProposal.outcome.proposals[0].proposalHash,
      decision: 'accept', reason: 'Independent project owner review required.' }),
  }, 403);
  assert.ok(deniedReview.error.code);

  const secondObservation = await request(instance.base, 'owner', observePath, { method: 'POST', body: {
    commandId: 'observe-transfer-window-2', expectedVersion: 3, window: '8 October', measures: [
      { id: 'business-check', name: 'Sampled transfer completion', dimension: 'business', actual: 7, target: 8,
        comparison: 'gte', unit: 'count', evidenceSummary: 'Human reviewed support sample.', observedAt: observationTime },
    ] } });
  const staleReview = await request(instance.base, 'owner', outcomeRoute(project.id, outcomeId, 'review'), {
    method: 'POST', body: actionBody('review-stale-learning', 4, { proposalHash: firstProposal.outcome.proposals[0].proposalHash,
      decision: 'accept', reason: 'This review refers to an older observation.' }),
  }, 409);
  assert.equal(staleReview.error.code, 'OUTCOME_REVIEW_STALE');
  assert.equal(secondObservation.outcome.latestEvaluation.business, 'NOT_MET');

  const secondProposal = await request(instance.base, 'editor', outcomeRoute(project.id, outcomeId, 'propose'), {
    method: 'POST', body: proposalBody('propose-current-learning', 4, secondObservation.outcome.latestEvaluation.observationHash),
  });
  const proposalHash = secondProposal.outcome.proposals.at(-1).proposalHash;
  const accepted = await request(instance.base, 'owner', outcomeRoute(project.id, outcomeId, 'review'), {
    method: 'POST', body: actionBody('accept-current-learning', 5, { proposalHash, decision: 'accept', reason: 'Accept as an evidence-linked next action.' }),
  });
  assert.equal(accepted.outcome.proposals.at(-1).status, 'ACCEPTED');
  assert.equal(accepted.outcome.proposals.at(-1).review.principal, identities.get('owner').principal);

  const assigned = await request(instance.base, 'owner', outcomeRoute(project.id, outcomeId, 'assign'), {
    method: 'POST', body: actionBody('assign-outcome-owner', 6, { ownerPrincipal: identities.get('editor').principal,
      reason: 'The editor owns transfer operations.' }),
  });
  assert.equal(assigned.outcome.ownerPrincipal, identities.get('editor').principal);
  const assignedStatus = await request(instance.base, 'editor', outcomeRoute(project.id, outcomeId, 'status'), {
    method: 'POST', body: actionBody('set-outcome-in-progress', 7, { status: 'IN_PROGRESS', reason: 'Investigation started.' }),
  });
  assert.equal(assignedStatus.outcome.status, 'IN_PROGRESS');
  await postgres.query(`update orgward.project_memberships set revoked_at=now(),revoked_by=$4
    where tenant_id=$1 and project_id=$2 and principal=$3`,
  [tenantId, project.id, identities.get('editor').principal, identities.get('owner').principal]);
  const revokedAssignee = await request(instance.base, 'editor', outcomeRoute(project.id, outcomeId, 'status'), {
    method: 'POST', body: actionBody('revoked-owner-cannot-update', 8, { status: 'RESOLVED', reason: 'Revoked project access.' }),
  }, 403);
  assert.equal(revokedAssignee.error.code, 'ACTION_FORBIDDEN');
  const design = (await request(instance.base, 'owner', baseRoute)).sources.design;
  const followUpPath = outcomeRoute(project.id, outcomeId, 'follow-up');
  const followUpBody = (commandId, expectedVersion, projectVersion, blueprintVersion) => actionBody(commandId, expectedVersion, {
    proposalHash, expectedProjectVersion: projectVersion, expectedBlueprintId: design.blueprintId,
    expectedBlueprintVersion: blueprintVersion, sourceObjectId: 'goal-customer-outcome',
  });
  const revokedOwnerFollowUp = await request(instance.base, 'owner', followUpPath, { method: 'POST', body: followUpBody(
    'follow-up-revoked-item-owner', 8, design.projectVersion, design.blueprintVersion) }, 409);
  assert.equal(revokedOwnerFollowUp.error.code, 'OUTCOME_OWNER_REASSIGN_REQUIRED');
  const casesBeforeReassignment = await postgres.query(`select count(*)::int as count from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='change_case' and state->'outcomeLineage'->>'outcomeId'=$2`, [tenantId, outcomeId]);
  assert.equal(casesBeforeReassignment.rows[0].count, 0, 'revoked item ownership cannot create linked work');
  const reassigned = await request(instance.base, 'owner', outcomeRoute(project.id, outcomeId, 'assign'), {
    method: 'POST', body: actionBody('reassign-after-member-revocation', 8, { ownerPrincipal: identities.get('owner').principal,
      reason: 'Restore accountability to the active project owner.' }),
  });
  assert.equal(reassigned.outcome.ownerPrincipal, identities.get('owner').principal);

  const staleDesign = await request(instance.base, 'owner', followUpPath, { method: 'POST', body: followUpBody(
    'follow-up-stale-blueprint', 9, design.projectVersion, design.blueprintVersion + 1) }, 409);
  assert.equal(staleDesign.error.code, 'SOURCE_BINDING_STALE');

  const followUpCommand = followUpBody('create-follow-up-case', 9, design.projectVersion, design.blueprintVersion);
  const followUp = await request(instance.base, 'owner', followUpPath, { method: 'POST', body: followUpCommand });
  assert.equal(followUp.replayed, false);
  assert.match(followUp.caseHref, new RegExp(`^/sdlc\\.html\\?case=${followUp.case.id}$`));
  assert.equal(followUp.case.projectId, project.id);
  assert.equal(followUp.case.outcomeLineage.outcomeId, outcomeId);
  assert.equal(followUp.case.outcomeLineage.proposalHash, proposalHash);
  assert.equal(followUp.case.sourceBinding.snapshot.id, 'goal-customer-outcome');
  assert.equal(followUp.case.status, 'DRAFT', 'creating the case records next work without executing it');
  assert.equal(followUp.case.currentStage, 'S0');
  const caseRead = await request(instance.base, 'owner', `/api/sdlc/cases/${followUp.case.id}`);
  assert.equal(caseRead.id, followUp.case.id);
  assert.equal(caseRead.outcomeLineage.reviewHash, followUp.outcome.proposals.at(-1).review.reviewHash);
  const scopeRow = await postgres.query(`select project_id from orgward.aggregate_project_scopes
    where tenant_id=$1 and aggregate_kind='change_case' and aggregate_id=$2`, [tenantId, followUp.case.id]);
  assert.deepEqual(scopeRow.rows, [{ project_id: project.id }]);
  const caseCount = await postgres.query(`select count(*)::int as count from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='change_case' and state->'outcomeLineage'->>'outcomeId'=$2`, [tenantId, outcomeId]);
  assert.equal(caseCount.rows[0].count, 1);

  await closeApp(instance);
  instance = await startApp(postgres, root);
  const reloaded = await request(instance.base, 'owner', outcomeRoute(project.id, outcomeId));
  assert.equal(reloaded.outcome.status, 'IN_PROGRESS');
  assert.equal(reloaded.outcome.proposals.at(-1).followUpCaseId, followUp.case.id);
  const replayedFollowUp = await request(instance.base, 'owner', followUpPath, { method: 'POST', body: followUpCommand });
  assert.equal(replayedFollowUp.replayed, true);
  assert.equal(replayedFollowUp.case.id, followUp.case.id);
  assert.equal(replayedFollowUp.caseHref, followUp.caseHref);
  const countAfterReplay = await postgres.query(`select count(*)::int as count from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='change_case' and state->'outcomeLineage'->>'outcomeId'=$2`, [tenantId, outcomeId]);
  assert.equal(countAfterReplay.rows[0].count, 1, 'follow-up replay returns the saved case without creating a duplicate');
  const firstStage = await request(instance.base, 'owner', `/api/sdlc/cases/${followUp.case.id}/advance`, {
    method: 'POST', body: { version: caseRead.version, idempotencyKey: 'advance-outcome-follow-up-once' },
  });
  assert.equal(firstStage.command.action, 'advance');
  assert.equal(firstStage.command.steps, 1);
  assert.notEqual(firstStage.currentStage, 'S0', 'the linked change case accepts its first provider-free stage action');
  const exported = await request(instance.base, 'owner', `${outcomeRoute(project.id, outcomeId)}/export`);
  assert.equal(exported.version, 'orgward-outcome-export-v1');
  assert.equal(exported.projectId, project.id);
  assert.equal(exported.outcome.id, outcomeId);
  assert.equal(exported.exportHash, digest({ version: exported.version, projectId: exported.projectId, outcome: exported.outcome }));
  const previewPath = `${baseRoute}/import-preview`;
  const preview = await request(instance.base, 'owner', previewPath, { method: 'POST', body: { bundle: exported } });
  assert.equal(preview.preview.exportHash, exported.exportHash);
  assert.equal(preview.preview.evidenceKind, 'HUMAN_REPORTED');
  assert.equal(preview.preview.authorityImported, false);
  assert.equal(preview.preview.observationCount, exported.outcome.observations.length);
  const readerPreview = await request(instance.base, 'reader', previewPath, { method: 'POST', body: { bundle: exported } }, 403);
  assert.equal(readerPreview.error.code, 'ACTION_FORBIDDEN');
  const forgedBundle = structuredClone(exported);
  forgedBundle.outcome.title = 'Altered after export';
  const corruptPreview = await request(instance.base, 'owner', previewPath, { method: 'POST', body: { bundle: forgedBundle } }, 400);
  assert.equal(corruptPreview.error.code, 'INVALID_OUTCOME_IMPORT');
  const importBody = { commandId: 'import-reviewed-outcome', bundle: exported,
    ownerPrincipal: identities.get('owner').principal, expectedImportHash: preview.preview.importHash };
  const wrongOwner = await request(instance.base, 'owner', `${baseRoute}/import`, { method: 'POST', body: {
    ...importBody, commandId: 'import-invalid-owner', ownerPrincipal: identities.get('outsider').principal,
  } }, 403);
  assert.equal(wrongOwner.error.code, 'OUTCOME_OWNER_UNAVAILABLE');
  const imported = await request(instance.base, 'owner', `${baseRoute}/import`, { method: 'POST', body: importBody }, 201);
  assert.notEqual(imported.outcome.id, outcomeId);
  assert.equal(imported.outcome.status, 'OPEN');
  assert.equal(imported.outcome.ownerPrincipal, identities.get('owner').principal);
  assert.equal(imported.outcome.importedFrom.authorityImported, false);
  assert.equal(imported.outcome.importedFrom.exportHash, exported.exportHash);
  assert.equal(imported.outcome.proposals.length, 0, 'reviews and follow-up case links are not portable authority');
  assert.ok(imported.outcome.observations.every((observation) => observation.evidenceKind === 'HUMAN_REPORTED'));
  assert.equal(imported.outcome.latestEvaluation.business, exported.outcome.latestEvaluation.business);

  await closeApp(instance);
  instance = await startApp(postgres, root);
  const importedReplay = await request(instance.base, 'owner', `${baseRoute}/import`, { method: 'POST', body: importBody });
  assert.equal(importedReplay.replayed, true);
  assert.equal(importedReplay.outcome.id, imported.outcome.id);
  const importedRead = await request(instance.base, 'owner', outcomeRoute(project.id, imported.outcome.id));
  assert.equal(importedRead.outcome.importedFrom.authorityImported, false);
  const importedCases = await postgres.query(`select count(*)::int as count from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='change_case' and state->'outcomeLineage'->>'outcomeId'=$2`, [tenantId, outcomeId]);
  assert.equal(importedCases.rows[0].count, 1);
});
