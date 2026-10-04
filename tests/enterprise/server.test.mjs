import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { addConversationTurn, createProject } from '../../src/model.mjs';
import { contentHash } from '../../src/platform/postgres.mjs';
import { digest, persistedDigest } from '../../src/sdlc/contracts.mjs';
import { startPostgres } from '../helpers/postgres.mjs';

const tenantId = 'tenant-enterprise-test';
const issuer = 'https://enterprise.example.test';
const subjects = ['owner', 'editor', 'reader', 'outsider', 'foreign'];
const roles = {
  owner: ['workspace-read', 'workspace-write'],
  editor: ['workspace-read', 'workspace-write'],
  reader: ['workspace-read'],
  outsider: ['workspace-read', 'workspace-write'],
  foreign: ['workspace-read', 'workspace-write'],
};
const identities = new Map(subjects.map((subject) => {
  const principal = `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`;
  return [subject, { issuer, subject, principal, tenantId: subject === 'foreign' ? 'tenant-enterprise-foreign' : tenantId,
    actorType: 'human', displayName: subject, roles: roles[subject], expiresAt: Math.floor(Date.now() / 1000) + 300 }];
}));

async function seedProject(postgres, name) {
  const project = createProject(name);
  for (const answer of [
    'A service that moves customer transfers safely.',
    'Small businesses that need reliable same-day transfers.',
    'We charge a per-transfer fee and focus on transparent status.',
    'Human approval remains required for exceptions and regulated controls.',
  ]) addConversationTurn(project, answer);
  const owner = identities.get('owner').principal;
  const editor = identities.get('editor').principal;
  const reader = identities.get('reader').principal;
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

async function startApp(postgres, root, { additionalIdentities = new Map(), executionProfiles } = {}) {
  const oidcAuthenticator = { authenticate: async (request) => {
    const subject = request.headers.authorization?.slice('Bearer '.length);
    return identities.get(subject) ?? additionalIdentities.get(subject) ?? null;
  } };
  const app = createApp({ databaseUrl: postgres.databaseUrl,
    dataDirectory: path.join(root, 'projects'), sdlcDirectory: path.join(root, 'sdlc'),
    executionDirectory: path.join(root, 'executions'), executionWorkspaceDirectory: path.join(root, 'workspaces'),
    oidcAuthenticator, ...(executionProfiles ? { executionProfiles } : {}) });
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

function enterpriseRoute(projectId, query = {}) {
  const params = new URLSearchParams(query);
  return `/api/v1/projects/${projectId}/enterprise${params.size ? `?${params}` : ''}`;
}
function currentView(base, subject, projectId, query = {}, expectedStatus = 200) {
  return request(base, subject, enterpriseRoute(projectId, query), {}, expectedStatus);
}
function commandBody(view, commandId, payload, expectedVersion = view.data.context.projectVersion) {
  return { schemaVersion: '1.0', commandId, expectedVersion,
    payload: { ...payload, blueprintId: view.data.context.blueprintId,
      blueprintVersion: view.data.context.blueprintVersion } };
}
function branchCommandBody(view, commandId, payload, expectedVersion = view.data.context.projectVersion) {
  const mergeCommand = ['prepare-merge', 'review-merge', 'apply-reviewed-merge'].includes(payload.kind);
  const source = mergeCommand ? view.data.branch.comparison : view.data.context;
  return { schemaVersion: '1.0', commandId, expectedVersion,
    payload: { ...payload, blueprintId: source.blueprintId ?? source.mainBlueprintId,
      blueprintVersion: source.blueprintVersion ?? source.mainBlueprintVersion,
      ...(view.data.branch ? { branchId: view.data.branch.id, branchRevision: view.data.branch.revision } : {}),
      ...(payload.kind === 'create-branch' ? { proposalId: view.data.context.proposalId ?? null } : {}) } };
}
async function postCommand(base, subject, projectId, body, status = 200) {
  return request(base, subject, `/api/v1/projects/${projectId}/enterprise/commands`, { method: 'POST', body }, status);
}
function items(blueprint) { return Object.values(blueprint.areas).flatMap((area) => area.items); }

test('enterprise scopes retain design identity across sixteen lenses, commands, history, and restart', async (t) => {
  const postgres = await startPostgres();
  let root;
  let instance;
  t.after(async () => {
    await closeApp(instance);
    if (root) await rm(root, { recursive: true, force: true });
    await postgres.close();
  });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-scope-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise scope fixture');
  const secondProject = await seedProject(postgres, 'Second enterprise scope fixture');
  const baseRoute = `/api/v1/projects/${project.id}/enterprise`;

  const ownerView = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: 'process-deliver' });
  const editorView = await currentView(instance.base, 'editor', project.id);
  const readerView = await currentView(instance.base, 'reader', project.id);
  assert.deepEqual(ownerView.data.permissions, { write: true, scopeAdmin: true, branchCreate: true, branchWrite: false, branchAdmin: false, processWrite: true, simulate: true });
  assert.deepEqual(editorView.data.permissions, { write: true, scopeAdmin: false, branchCreate: true, branchWrite: false, branchAdmin: false, processWrite: true, simulate: true });
  assert.deepEqual(readerView.data.permissions, { write: false, scopeAdmin: false, branchCreate: false, branchWrite: false, branchAdmin: false, processWrite: false, simulate: false });
  assert.equal(ownerView.data.selection.object.id, 'process-deliver');
  assert.equal(ownerView.data.selection.object.enterpriseScope, undefined);
  assert.equal(ownerView.data.selection.visible, true);
  assert.ok(ownerView.data.gaps.some((gap) => gap.code === 'LEGACY_SCOPE_UNKNOWN'));

  const originalIds = new Set(items(ownerView.data.blueprint).map((object) => object.id));
  for (const lens of ownerView.data.lenses) {
    const projection = await currentView(instance.base, 'owner', project.id, { lensId: lens.id, selectedId: 'process-deliver' });
    const graphIds = projection.data.graph.nodes.map((node) => node.id);
    assert.ok(graphIds.every((id) => originalIds.has(id)), `${lens.id} should retain canonical blueprint IDs`);
    assert.equal(projection.data.selection.object.id, 'process-deliver', `${lens.id} keeps the selected record addressable`);
    assert.equal(projection.data.selection.visible, lens.id === 'all' || lens.types === null || lens.types.includes('process'));
    if (!projection.data.selection.visible) assert.ok(projection.data.selection.hiddenBy.includes('lens'));
  }

  const editorAdminAttempt = await postCommand(instance.base, 'editor', project.id,
    commandBody(editorView, 'editor-create-scope-denied', { kind: 'create-scope', scopeType: 'organization', name: 'Denied Org', detail: 'Editor cannot administer scopes.', reason: 'Expected authority denial.' }), 403);
  assert.equal(editorAdminAttempt.error.code, 'ACTION_FORBIDDEN');
  const outsider = await currentView(instance.base, 'outsider', project.id, {}, 404);
  assert.equal(outsider.error.code, 'PROJECT_NOT_FOUND');
  const foreign = await request(instance.base, 'foreign', baseRoute, {}, 404);
  assert.equal(foreign.error.code, 'PROJECT_NOT_FOUND');

  const secondView = await currentView(instance.base, 'owner', secondProject.id);
  const foreignOrganizationResult = await postCommand(instance.base, 'owner', secondProject.id,
    commandBody(secondView, 'create-second-project-organization', { kind: 'create-scope', scopeType: 'organization',
      name: 'Second Project Org', detail: 'This organization belongs to a separate saved project.', ownerRoleId: 'role-founder', reason: 'Keep project scope explicit.' }), 200);
  const foreignOrganizationId = foreignOrganizationResult.data.affectedObjectId;

  let view = await currentView(instance.base, 'owner', project.id);
  const orgCommand = commandBody(view, 'create-enterprise-organization', { kind: 'create-scope', scopeType: 'organization',
    name: 'Northstar Group', detail: 'Parent organization for the proposed operating model.', ownerRoleId: 'role-founder', reason: 'Name the design boundary.' });
  const orgResult = await postCommand(instance.base, 'owner', project.id, orgCommand);
  assert.equal(orgResult.data.blueprintVersion, 2);
  const organizationId = orgResult.data.affectedObjectId;
  const orgReplay = await postCommand(instance.base, 'owner', project.id, orgCommand);
  assert.equal(orgReplay.meta.replayed, true);
  assert.equal(orgReplay.data.affectedObjectId, organizationId);
  assert.equal(orgReplay.data.projectVersion, orgResult.data.projectVersion);

  view = await currentView(instance.base, 'owner', project.id);
  const secondOrganizationResult = await postCommand(instance.base, 'owner', project.id,
    commandBody(view, 'create-south-enterprise-organization', { kind: 'create-scope', scopeType: 'organization',
      name: 'Southstar Group', detail: 'Separate proposed organizational scope.', ownerRoleId: 'role-founder', reason: 'Keep scope filters meaningful.' }));
  const southOrganizationId = secondOrganizationResult.data.affectedObjectId;

  view = await currentView(instance.base, 'owner', project.id);
  const crossProjectScope = await postCommand(instance.base, 'editor', project.id,
    commandBody(view, 'assign-foreign-project-scope', { kind: 'assign-object-scope', objectId: 'process-deliver',
      organizationId: foreignOrganizationId, legalEntityId: null, unitId: null, reason: 'A foreign project scope must be rejected.' }), 409);
  assert.equal(crossProjectScope.error.code, 'INVALID_ENTERPRISE_SCOPE');

  const invalidUnit = await postCommand(instance.base, 'owner', project.id,
    commandBody(view, 'create-unit-with-foreign-parent', { kind: 'create-scope', scopeType: 'unit',
      name: 'Mismatched Unit', detail: 'This unit uses a nonexistent organization.', ownerRoleId: null,
      organizationId: foreignOrganizationId, legalEntityId: null, parentUnitId: null, reason: 'Reject inconsistent hierarchy.' }), 409);
  assert.equal(invalidUnit.error.code, 'INVALID_ENTERPRISE_SCOPE');

  const legalResult = await postCommand(instance.base, 'owner', project.id,
    commandBody(view, 'create-enterprise-legal-entity', { kind: 'create-scope', scopeType: 'legal-entity',
      name: 'Northstar Services Ltd', detail: 'Proposed contracting entity.', ownerRoleId: 'role-founder', organizationId,
      jurisdiction: 'Human reported: England and Wales', reason: 'Record the proposed legal context.' }));
  const legalEntityId = legalResult.data.affectedObjectId;
  view = await currentView(instance.base, 'owner', project.id);
  const unitResult = await postCommand(instance.base, 'owner', project.id,
    commandBody(view, 'create-enterprise-unit', { kind: 'create-scope', scopeType: 'unit',
      name: 'Customer Operations', detail: 'Proposed service delivery unit.', ownerRoleId: 'role-operations', organizationId,
      legalEntityId, parentUnitId: null, reason: 'Place the delivery process in the design.' }));
  const unitId = unitResult.data.affectedObjectId;
  view = await currentView(instance.base, 'owner', project.id);
  const assignmentCommand = commandBody(view, 'assign-delivery-scope', { kind: 'assign-object-scope', objectId: 'process-deliver',
    organizationId, legalEntityId, unitId, reason: 'Link delivery to the proposed operating unit.' });
  const assignmentResult = await postCommand(instance.base, 'editor', project.id, assignmentCommand);
  assert.equal(assignmentResult.data.affectedObjectId, 'process-deliver');
  const assignedEnterprise = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  assert.equal(assignedEnterprise.data.selection.object.provenance.at(-1).source, 'workspace:enterprise-scope');

  view = await currentView(instance.base, 'owner', project.id);
  const readerAssignmentDenied = await postCommand(instance.base, 'reader', project.id,
    commandBody(view, 'reader-assignment-denied', { kind: 'assign-object-scope', objectId: 'process-learn',
      organizationId: null, legalEntityId: null, unitId: null, reason: 'Read permission cannot mutate saved design.' }), 403);
  assert.equal(readerAssignmentDenied.error.code, 'ACTION_FORBIDDEN');

  const projectBeforeLegacyEdit = (await request(instance.base, 'owner', `/api/v1/projects/${project.id}`)).data;
  const deliveryProcess = items(projectBeforeLegacyEdit.latestBlueprint).find((object) => object.id === 'process-deliver');
  const editResult = await request(instance.base, 'owner', `/api/v1/projects/${project.id}/blueprint/edits`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'legacy-edit-after-enterprise-assignment', expectedVersion: projectBeforeLegacyEdit.version,
    payload: { objectId: deliveryProcess.id, name: 'Deliver the Northstar service', detail: 'Complete and record the customer transfer.',
      ownerRoleName: 'Operations owner', trigger: deliveryProcess.trigger },
  } });
  const editedProcess = items(editResult.data.latestBlueprint).find((object) => object.id === 'process-deliver');
  assert.deepEqual(editedProcess.enterpriseScope, { organizationId, legalEntityId, unitId });
  assert.ok(editedProcess.provenance.some((entry) => entry.source === 'workspace:enterprise-scope'));
  assert.equal(editedProcess.provenance.at(-1).source, 'workspace:blueprint-edit');
  const editedEnterprise = await currentView(instance.base, 'owner', project.id);
  assert.ok(editedEnterprise.data.graph.links.some((link) => link.source === 'process-deliver' && link.target === organizationId && link.type === 'within-organization'));
  assert.ok(editedEnterprise.data.graph.links.some((link) => link.source === 'process-deliver' && link.target === legalEntityId && link.type === 'within-legal-entity'));
  assert.ok(editedEnterprise.data.graph.links.some((link) => link.source === 'process-deliver' && link.target === unitId && link.type === 'within-unit'));
  const persistedIds = new Set(items(editedEnterprise.data.blueprint).map((object) => object.id));
  for (const lens of editedEnterprise.data.lenses) {
    const projection = await currentView(instance.base, 'owner', project.id, { lensId: lens.id, selectedId: 'process-deliver' });
    assert.equal(projection.data.context.blueprintId, editedEnterprise.data.context.blueprintId);
    assert.ok(projection.data.graph.nodes.every((node) => persistedIds.has(node.id)));
    assert.equal(projection.data.selection.object.id, 'process-deliver');
    assert.equal(projection.data.selection.visible, lens.id === 'all' || lens.types === null || lens.types.includes('process'));
  }

  const publicationResult = await request(instance.base, 'owner', `/api/v1/projects/${project.id}/blueprint/publications`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'internally-publish-scoped-enterprise-design', expectedVersion: editResult.data.version,
    payload: { blueprintId: editResult.data.latestBlueprint.id, blueprintVersion: editResult.data.latestBlueprint.version, acknowledgeDisclosures: true },
  } });
  assert.equal(publicationResult.data.blueprintPublications.at(-1).blueprintId, editedEnterprise.data.context.blueprintId);
  const readerPublished = await request(instance.base, 'reader', `/api/v1/projects/${project.id}`);
  assert.equal(readerPublished.data.latestBlueprint.areas.capabilitiesProcesses.items.find((object) => object.id === 'process-deliver').enterpriseScope.organizationId, organizationId);

  view = await currentView(instance.base, 'owner', project.id, { lensId: 'all', scopeId: organizationId, selectedId: 'process-deliver' });
  assert.equal(view.data.selection.visible, true);
  assert.deepEqual(view.data.selection.object.enterpriseScope, { organizationId, legalEntityId, unitId });
  assert.ok(view.data.selection.object.provenance.some((entry) => entry.source === 'workspace:enterprise-scope'));
  assert.equal(view.data.selection.object.provenance.at(-1).source, 'workspace:blueprint-edit');
  assert.ok(view.data.graph.nodes.every((node) => originalIds.has(node.id) || [organizationId, legalEntityId, unitId].includes(node.id)));
  const unscopedCommand = commandBody(view, 'explicitly-unscope-review-process', { kind: 'assign-object-scope', objectId: 'process-learn',
    organizationId: null, legalEntityId: null, unitId: null, reason: 'Record no organizational assignment.' });
  await postCommand(instance.base, 'editor', project.id, unscopedCommand);
  const afterUnscope = await currentView(instance.base, 'owner', project.id);
  const explicitUnscoped = items(afterUnscope.data.blueprint).find((object) => object.id === 'process-learn');
  assert.deepEqual(explicitUnscoped.enterpriseScope, { organizationId: null, legalEntityId: null, unitId: null });
  assert.equal(afterUnscope.data.graph.nodes.find((node) => node.id === 'process-learn').scopeState, 'UNSCOPED');

  const hiddenSelection = await currentView(instance.base, 'owner', project.id,
    { lensId: 'L-01', scopeId: organizationId, selectedId: 'process-deliver' });
  assert.equal(hiddenSelection.data.selection.object.id, 'process-deliver');
  assert.equal(hiddenSelection.data.selection.visible, false);
  assert.deepEqual(hiddenSelection.data.selection.hiddenBy, ['lens']);
  const scopeHiddenSelection = await currentView(instance.base, 'owner', project.id,
    { lensId: 'all', scopeId: southOrganizationId, selectedId: 'process-deliver' });
  assert.equal(scopeHiddenSelection.data.selection.object.id, 'process-deliver');
  assert.equal(scopeHiddenSelection.data.selection.visible, false);
  assert.deepEqual(scopeHiddenSelection.data.selection.hiddenBy, ['scope']);

  const latest = await currentView(instance.base, 'owner', project.id);
  const currentVersion = latest.data.context.blueprintVersion;
  const history = await currentView(instance.base, 'owner', project.id, { blueprintVersion: '2' });
  assert.equal(history.data.context.isCurrent, false);
  assert.equal(history.data.permissions.write, false);
  assert.equal(history.data.permissions.scopeAdmin, false);
  assert.equal(history.data.blueprint.areas.responsibilityAuthority.items.find((object) => object.id === organizationId).name, 'Northstar Group');
  assert.equal(history.data.versions.length, currentVersion);

  const latestPayload = { kind: 'rename-scope', objectId: organizationId, name: 'Northstar Holdings',
    detail: 'Renamed proposed parent organization.', reason: 'Reflect the approved design terminology.' };
  const staleBlueprint = await postCommand(instance.base, 'owner', project.id,
    commandBody(history, 'stale-enterprise-blueprint', latestPayload, latest.data.context.projectVersion), 409);
  assert.equal(staleBlueprint.error.code, 'ENTERPRISE_BLUEPRINT_STALE');
  const staleProject = await postCommand(instance.base, 'owner', project.id,
    commandBody(latest, 'stale-enterprise-project-version', latestPayload, latest.data.context.projectVersion - 1), 409);
  assert.equal(staleProject.error.code, 'VERSION_CONFLICT');

  const renameCommand = commandBody(latest, 'rename-enterprise-organization', latestPayload);
  const renamed = await postCommand(instance.base, 'owner', project.id, renameCommand);
  const renamedVersion = renamed.data.projectVersion;
  const renamedReplay = await postCommand(instance.base, 'owner', project.id, renameCommand);
  assert.equal(renamedReplay.meta.replayed, true);
  assert.equal(renamedReplay.data.projectVersion, renamedVersion);

  const currentAfterRename = await currentView(instance.base, 'owner', project.id);
  assert.equal(currentAfterRename.data.scopes.find((scope) => scope.id === organizationId).name, 'Northstar Holdings');
  const immutableHistorical = await currentView(instance.base, 'owner', project.id, { blueprintVersion: '2' });
  assert.equal(immutableHistorical.data.blueprint.areas.responsibilityAuthority.items.find((object) => object.id === organizationId).name, 'Northstar Group');
  const inaccessible = await currentView(instance.base, 'owner', project.id, { lensId: 'L-99' }, 400);
  assert.equal(inaccessible.error.code, 'ENTERPRISE_LENS_NOT_FOUND');
  const absentVersion = await currentView(instance.base, 'owner', project.id, { blueprintVersion: '999' }, 404);
  assert.equal(absentVersion.error.code, 'ENTERPRISE_BLUEPRINT_NOT_FOUND');

  await closeApp(instance);
  instance = await startApp(postgres, root);
  const afterRestart = await currentView(instance.base, 'owner', project.id);
  assert.equal(afterRestart.data.context.projectVersion, renamedVersion);
  assert.equal(afterRestart.data.scopes.find((scope) => scope.id === organizationId).name, 'Northstar Holdings');
  const assignmentReplayAfterRestart = await postCommand(instance.base, 'editor', project.id, assignmentCommand);
  assert.equal(assignmentReplayAfterRestart.meta.replayed, true);
  assert.equal(assignmentReplayAfterRestart.data.affectedObjectId, 'process-deliver');
  assert.equal((await currentView(instance.base, 'owner', project.id)).data.context.projectVersion, renamedVersion);
  assert.ok(assignmentResult.data.blueprintVersion < afterRestart.data.context.blueprintVersion);
  assert.equal(legalResult.data.affectedObjectId, legalEntityId);
  assert.equal(unitResult.data.affectedObjectId, unitId);
  assert.equal(baseRoute, `/api/v1/projects/${project.id}/enterprise`);
});

test('enterprise state and time views keep human reports independent and future proposals off the main design', async (t) => {
  const postgres = await startPostgres();
  let root;
  let instance;
  t.after(async () => {
    await closeApp(instance);
    if (root) await rm(root, { recursive: true, force: true });
    await postgres.close();
  });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-time-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise temporal fixture');

  let view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const initial = view.data.selection.states;
  assert.deepEqual([initial.lifecycle.value, initial.review.value, initial.implementation.value, initial.observation.value],
    ['UNKNOWN', 'UNREVIEWED', 'UNKNOWN', 'UNKNOWN']);
  const report = async (subject, commandId, dimension, value, evidenceSummary = '') => {
    const body = commandBody(view, commandId, { kind: 'record-state', objectId: 'process-deliver', dimension, value,
      basisHash: initial.basisHash, reason: `Record the ${dimension} report.`, evidenceSummary });
    await postCommand(instance.base, subject, project.id, body);
  };
  await report('editor', 'report-lifecycle-active', 'lifecycle', 'ACTIVE', 'Owner reported the process is in use.');
  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  await report('editor', 'report-implementation-not-built', 'implementation', 'NOT_IMPLEMENTED');
  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  await report('editor', 'report-observation', 'observation', 'OBSERVED_UNVERIFIED', 'Owner reported a handoff on one recent case.');
  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  await report('owner', 'review-design-accepted', 'review', 'ACCEPTED');
  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const states = view.data.selection.states;
  assert.deepEqual([states.lifecycle.value, states.review.value, states.implementation.value, states.observation.value],
    ['ACTIVE', 'ACCEPTED', 'NOT_IMPLEMENTED', 'OBSERVED_UNVERIFIED']);
  assert.equal(states.lifecycle.evidenceKind, 'HUMAN_REPORTED');
  assert.equal(states.review.evidenceKind, 'HUMAN_REVIEW');
  assert.equal(states.observation.evidenceKind, 'HUMAN_REPORTED');
  assert.equal(states.observation.evidenceSummary, 'Owner reported a handoff on one recent case.');

  const futureStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const validityCommand = commandBody(view, 'declare-main-validity', { kind: 'set-validity',
    effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: futureStart,
    reason: 'Declare the current main design interval.' });
  await postCommand(instance.base, 'owner', project.id, validityCommand);
  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const baseBlueprintId = view.data.context.blueprintId;
  const baseBlueprintVersion = view.data.context.blueprintVersion;
  const baseProjectVersion = view.data.context.projectVersion;
  const proposalBody = commandBody(view, 'propose-future-delivery-design', { kind: 'propose-future-design',
    objectId: 'process-deliver', title: 'Future delivery design', name: 'Deliver the next-generation service',
    detail: 'Use the proposed future operating workflow.', effectiveFrom: futureStart, effectiveTo: null,
    reason: 'Stage a future design change for owner review.' });
  const proposalResult = await postCommand(instance.base, 'owner', project.id, proposalBody);
  const proposalId = proposalResult.data.proposalId;
  assert.match(proposalId, /^enterprise-proposal-/);
  assert.equal(proposalResult.data.blueprintId, baseBlueprintId);
  assert.equal(proposalResult.data.blueprintVersion, baseBlueprintVersion);
  const mainAfterProposal = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  assert.equal(mainAfterProposal.data.context.blueprintId, baseBlueprintId);
  assert.equal(mainAfterProposal.data.context.blueprintVersion, baseBlueprintVersion);
  assert.equal(mainAfterProposal.data.context.projectVersion, baseProjectVersion + 1);
  assert.equal(mainAfterProposal.data.selection.object.name, 'Deliver the core offering');
  assert.equal(mainAfterProposal.data.proposals[0].baseBlueprintId, baseBlueprintId);
  const badBaseBody = structuredClone(proposalBody);
  badBaseBody.commandId = 'propose-future-from-stale-base';
  badBaseBody.expectedVersion = mainAfterProposal.data.context.projectVersion;
  badBaseBody.payload.blueprintVersion -= 1;
  const staleProposal = await postCommand(instance.base, 'owner', project.id, badBaseBody, 409);
  assert.equal(staleProposal.error.code, 'ENTERPRISE_BLUEPRINT_STALE');

  const futureAt = new Date(Date.parse(futureStart) + 24 * 60 * 60 * 1000).toISOString();
  const futureProposal = await currentView(instance.base, 'owner', project.id,
    { proposalId, effectiveAt: futureAt, selectedId: 'process-deliver' });
  assert.equal(futureProposal.data.context.sourceKind, 'FUTURE_PROPOSAL');
  assert.equal(futureProposal.data.context.proposalId, proposalId);
  assert.equal(futureProposal.data.context.effectiveStatus, 'IN_RANGE');
  assert.equal(futureProposal.data.context.isCurrent, false);
  assert.equal(futureProposal.data.permissions.write, false);
  assert.equal(futureProposal.data.permissions.scopeAdmin, false);
  assert.deepEqual({ branchCreate: futureProposal.data.permissions.branchCreate,
    branchWrite: futureProposal.data.permissions.branchWrite, branchAdmin: futureProposal.data.permissions.branchAdmin },
  { branchCreate: true, branchWrite: false, branchAdmin: false });
  assert.equal(futureProposal.data.permissions.processWrite, false);
  assert.equal(futureProposal.data.permissions.simulate, true);
  assert.equal(futureProposal.data.selection.object.name, 'Deliver the next-generation service');
  assert.ok(mainAfterProposal.data.versions.every((entry) => entry.id !== futureProposal.data.context.blueprintId),
    'the proposal snapshot is not inserted into the main version history');
  const noMainAtFuture = await currentView(instance.base, 'owner', project.id, { effectiveAt: futureAt, selectedId: 'process-deliver' });
  assert.equal(noMainAtFuture.data.blueprint, null, 'a later proposal date does not promote the proposal into main history');
  assert.equal(noMainAtFuture.data.context.blueprintId, null);
  assert.equal(noMainAtFuture.data.context.effectiveStatus, 'UNKNOWN');
  const stillMain = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  assert.equal(stillMain.data.context.sourceKind, 'MAIN_DESIGN');
  assert.equal(stillMain.data.context.blueprintId, baseBlueprintId);
  const beforeRecorded = new Date(Date.parse(mainAfterProposal.data.proposals[0].recordedAt) - 1).toISOString();
  const notYetRecorded = await currentView(instance.base, 'owner', project.id,
    { proposalId, recordedAt: beforeRecorded }, 404);
  assert.equal(notYetRecorded.error.code, 'ENTERPRISE_CONTEXT_NOT_RECORDED');
  const recordedProposal = await currentView(instance.base, 'owner', project.id,
    { proposalId, recordedAt: mainAfterProposal.data.proposals[0].recordedAt });
  assert.equal(recordedProposal.data.context.proposalId, proposalId);
  const proposalSnapshotMutation = commandBody(futureProposal, 'mutate-future-snapshot', {
    kind: 'set-validity', effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null,
    reason: 'A proposal view cannot be used as the main mutation source.',
  });
  const rejectedProposalMutation = await postCommand(instance.base, 'owner', project.id, proposalSnapshotMutation, 409);
  assert.equal(rejectedProposalMutation.error.code, 'ENTERPRISE_BLUEPRINT_STALE');
  const contextClaimBody = commandBody(mainAfterProposal, 'claim-a-dated-main-write', {
    kind: 'set-validity', effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null,
    reason: 'The command schema does not accept caller-claimed view context.',
  });
  contextClaimBody.payload.effectiveAt = futureAt;
  const rejectedContextClaim = await postCommand(instance.base, 'owner', project.id, contextClaimBody, 400);
  assert.equal(rejectedContextClaim.error.code, 'INVALID_ENTERPRISE_COMMAND');

  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-learn' });
  const unrelatedMainEdit = commandBody(view, 'report-unrelated-main-state', { kind: 'record-state', objectId: 'process-learn',
    dimension: 'lifecycle', value: 'PLANNED', basisHash: view.data.selection.states.basisHash,
    reason: 'Record an unrelated main design report.' });
  const mainEditResult = await postCommand(instance.base, 'editor', project.id, unrelatedMainEdit);
  const staleProposalView = await currentView(instance.base, 'owner', project.id, { proposalId, selectedId: 'process-deliver' });
  assert.equal(staleProposalView.data.proposal.baseStale, true);
  assert.equal(staleProposalView.data.proposal.baseBlueprintId, baseBlueprintId);
  assert.equal(staleProposalView.data.selection.object.name, 'Deliver the next-generation service');

  const planResult = await request(instance.base, 'editor', `/api/v1/projects/${project.id}/process-plans`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'plan-process-from-main-only', expectedVersion: mainEditResult.data.projectVersion,
    payload: { processId: 'process-deliver' },
  } }, 201);
  const plan = planResult.data.processPlans.at(-1);
  assert.equal(plan.source.blueprintId, mainEditResult.data.blueprintId);
  assert.equal(plan.source.blueprintVersion, mainEditResult.data.blueprintVersion);
  assert.notEqual(plan.source.blueprintId, staleProposalView.data.context.blueprintId);
  const publicationResult = await request(instance.base, 'owner', `/api/v1/projects/${project.id}/blueprint/publications`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'publish-main-not-proposal', expectedVersion: planResult.data.version,
    payload: { blueprintId: planResult.data.latestBlueprint.id, blueprintVersion: planResult.data.latestBlueprint.version, acknowledgeDisclosures: true },
  } });
  assert.equal(publicationResult.data.blueprintPublications.at(-1).blueprintId, planResult.data.latestBlueprint.id);

  await closeApp(instance);
  instance = await startApp(postgres, root);
  const restartedProposal = await currentView(instance.base, 'owner', project.id, { proposalId, selectedId: 'process-deliver' });
  assert.equal(restartedProposal.data.proposal.baseStale, true);
  assert.equal(restartedProposal.data.selection.object.name, 'Deliver the next-generation service');
  const proposalReplay = await postCommand(instance.base, 'owner', project.id, proposalBody);
  assert.equal(proposalReplay.meta.replayed, true);
  assert.deepEqual(proposalReplay.data, proposalResult.data);
  assert.equal(proposalReplay.data.proposalId, proposalId);
  const mainAfterReplay = await currentView(instance.base, 'owner', project.id);
  assert.equal(mainAfterReplay.data.context.blueprintId, mainEditResult.data.blueprintId);
});

test('enterprise process definitions and simulations stay typed, bounded, source-bound and separate from actual work', async (t) => {
  const postgres = await startPostgres();
  let root;
  let instance;
  t.after(async () => {
    await closeApp(instance);
    if (root) await rm(root, { recursive: true, force: true });
    await postgres.close();
  });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-process-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise process simulation fixture');
  let view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  assert.equal(view.data.processModel.limits.loopIterations, 10);
  assert.equal(view.data.permissions.processWrite, true);
  assert.equal(view.data.permissions.simulate, true);
  const decisionTable = {
    schemaVersion: '1.0', hitPolicy: 'FIRST_MATCH', defaultOutcome: null,
    inputs: [{ informationId: 'information-customer-signal', valueType: 'number' }],
    rules: [
      { id: 'priority-high', outcome: 'APPROVE', conditions: [{ informationId: 'information-customer-signal', operator: 'gte', value: 5 }] },
      { id: 'priority-low', outcome: 'REVIEW', conditions: [{ informationId: 'information-customer-signal', operator: 'lt', value: 5 }] },
      { id: 'loop-continue', outcome: 'CONTINUE', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 1 }] },
      { id: 'loop-stop', outcome: 'STOP', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 2 }] },
    ],
  };
  const tableCommand = commandBody(view, 'process-define-priority-table', {
    kind: 'define-decision-table', objectId: 'decision-priority', decisionTable, reason: 'Define explicit typed routing outcomes.' });
  const tableResult = await postCommand(instance.base, 'editor', project.id, tableCommand);
  assert.equal(tableResult.data.affectedObjectId, 'decision-priority');
  const tableReplay = await postCommand(instance.base, 'editor', project.id, tableCommand);
  assert.equal(tableReplay.meta.replayed, true);
  assert.deepEqual(tableReplay.data, tableResult.data);

  view = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const flow = {
    schemaVersion: '1.0', startStepId: 'intake',
    steps: [
      { id: 'intake', kind: 'manual', title: 'Review qualified request', processId: 'process-deliver', roleId: 'role-operations',
        inputIds: ['information-customer-signal'], outputIds: ['information-delivery-result'], nextStepId: 'gate', exceptionStepId: 'exception' },
      { id: 'gate', kind: 'decision', title: 'Route by saved decision rule', decisionId: 'decision-priority',
        routes: [{ outcome: 'APPROVE', targetStepId: 'fork' }, { outcome: 'REVIEW', targetStepId: 'exception' }] },
      { id: 'fork', kind: 'fork', title: 'Design independent review paths', branchStepIds: ['check-a', 'check-b'], joinStepId: 'join' },
      { id: 'check-a', kind: 'manual', title: 'Check customer details', processId: 'process-deliver', roleId: 'role-operations',
        inputIds: ['information-customer-signal'], outputIds: ['information-delivery-result'], nextStepId: 'join', exceptionStepId: null },
      { id: 'check-b', kind: 'manual', title: 'Check delivery capacity', processId: 'process-deliver', roleId: 'role-operations',
        inputIds: [], outputIds: [], nextStepId: 'join', exceptionStepId: null },
      { id: 'join', kind: 'join', title: 'Wait for both checks', forkStepId: 'fork', mode: 'ALL', nextStepId: 'loop' },
      { id: 'loop', kind: 'loop', title: 'Bounded correction cycle', decisionId: 'decision-priority', continueOutcome: 'CONTINUE',
        bodyStepId: 'loop-work', exitStepId: 'done', maxIterations: 2 },
      { id: 'loop-work', kind: 'manual', title: 'Record one correction', processId: 'process-deliver', roleId: 'role-operations',
        inputIds: [], outputIds: ['information-delivery-result'], nextStepId: 'loop-return', exceptionStepId: null },
      { id: 'loop-return', kind: 'loop-return', title: 'Return to bound check', loopStepId: 'loop' },
      { id: 'exception', kind: 'manual-exception', title: 'Escalate for human review', processId: 'process-review', roleId: 'role-founder',
        inputIds: ['information-customer-signal'], outputIds: ['information-delivery-result'], nextStepId: 'exception-done', exceptionStepId: null },
      { id: 'exception-done', kind: 'end', title: 'Stop at human review boundary' },
      { id: 'done', kind: 'end', title: 'Finish proposed delivery path' },
    ],
  };
  const flowCommand = commandBody(view, 'process-define-delivery-flow', {
    kind: 'define-process-flow', objectId: 'process-deliver', processFlow: flow, reason: 'Save bounded delivery and exception paths.' });
  const flowResult = await postCommand(instance.base, 'editor', project.id, flowCommand);
  assert.equal(flowResult.data.affectedObjectId, 'process-deliver');
  const invalidReferenceView = await currentView(instance.base, 'owner', project.id);
  const badFlow = structuredClone(flow);
  badFlow.steps[0].roleId = 'decision-priority';
  const invalidReference = await postCommand(instance.base, 'editor', project.id,
    commandBody(invalidReferenceView, 'process-invalid-role-reference', { kind: 'define-process-flow', objectId: 'process-deliver',
      processFlow: badFlow, reason: 'Reject a decision used as a human role.' }), 400);
  assert.equal(invalidReference.error.code, 'INVALID_PROCESS_REFERENCE');

  const scenario = { inputs: [{ informationId: 'information-customer-signal', value: 10 }],
    activityOutcomes: [
      { stepId: 'intake', iteration: 0, outcome: 'SUCCEEDED' },
      { stepId: 'check-a', iteration: 0, outcome: 'SUCCEEDED' },
      { stepId: 'check-b', iteration: 0, outcome: 'SUCCEEDED' },
      { stepId: 'loop-work', iteration: 1, outcome: 'SUCCEEDED' },
    ],
    decisionChoices: [{ stepId: 'loop', iteration: 0, outcome: 'CONTINUE' }, { stepId: 'loop', iteration: 1, outcome: 'STOP' }], stepLimit: 100 };
  const simulate = async (subject, commandId, query = {}, scenarioValue = scenario, status = 200) => {
    const exactView = await currentView(instance.base, subject, project.id, query);
    const body = commandBody(exactView, commandId, { kind: 'simulate-process', processId: 'process-deliver', scenario: scenarioValue,
      reason: 'Inspect a declared hypothetical only.' });
    if (exactView.data.context.branchId) Object.assign(body.payload, { branchId: exactView.data.context.branchId,
      branchRevision: exactView.data.context.branchRevision });
    return { result: await postCommand(instance.base, subject, project.id, body, status), body, view: exactView };
  };
  const readerSimulation = await simulate('reader', 'process-reader-simulation-denied', {}, scenario, 403);
  assert.equal(readerSimulation.result.error.code, 'ACTION_FORBIDDEN');

  const firstSimulation = await simulate('editor', 'process-simulate-complete', { selectedId: 'process-deliver' });
  const simSource = firstSimulation.view;
  const saved = firstSimulation.result.data.simulation;
  assert.deepEqual(simSource.data.selection.object.processFlow, flow);
  assert.deepEqual(simSource.data.blueprint.areas.governanceRiskControls.items.find((object) => object.id === 'decision-priority').decisionTable, decisionTable);
  assert.ok(simSource.data.graph.links.some((link) => link.source === 'process-deliver' && link.target === 'decision-priority' && link.type === 'flow-uses-decision'));
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.meaning, 'SIMULATION_ONLY');
  assert.equal(saved.source.blueprintId, simSource.data.context.blueprintId);
  assert.equal(saved.source.blueprintVersion, simSource.data.context.blueprintVersion);
  assert.equal(saved.source.snapshotHash, simSource.data.context.snapshotHash);
  assert.equal(saved.sourceLabels.records['process-deliver'], 'Deliver the core offering');
  assert.ok(saved.trace.some((step) => step.status === 'FORKED'));
  assert.ok(saved.trace.some((step) => step.status === 'JOINED'));
  assert.ok(saved.trace.some((step) => step.status === 'RETURNED'));
  assert.ok(saved.trace.some((step) => step.status === 'ENDED'));
  assert.ok(saved.trace.every((step) => step.meaning !== 'ACTUAL_WORK'));
  const fullRead = await currentView(instance.base, 'owner', project.id,
    { selectedId: 'process-deliver', simulationId: saved.id });
  assert.equal(fullRead.data.simulation.id, saved.id);
  assert.equal(fullRead.data.simulation.resultHash, saved.resultHash);
  const summary = fullRead.data.simulations.find((entry) => entry.id === saved.id);
  assert.equal(summary.traceLength, saved.trace.length);
  assert.equal(Object.hasOwn(summary, 'trace'), false, 'history lists keep detailed trace behind an exact result selection');
  assert.equal(Object.hasOwn(summary, 'scenario'), false);
  const beforeSimulation = new Date(Date.parse(saved.createdAt) - 1).toISOString();
  const hiddenByCutoff = await currentView(instance.base, 'owner', project.id,
    { selectedId: 'process-deliver', simulationId: saved.id, recordedAt: beforeSimulation }, 404);
  assert.equal(hiddenByCutoff.error.code, 'ENTERPRISE_CONTEXT_NOT_RECORDED');
  const cutoffIncludesSaved = await currentView(instance.base, 'owner', project.id,
    { selectedId: 'process-deliver', simulationId: saved.id, recordedAt: saved.createdAt });
  assert.equal(cutoffIncludesSaved.data.simulation.id, saved.id);
  const completeReplay = await postCommand(instance.base, 'editor', project.id, firstSimulation.body);
  assert.equal(completeReplay.meta.replayed, true);
  assert.equal(completeReplay.data.simulation.id, saved.id);
  assert.equal(completeReplay.data.simulation.resultHash, saved.resultHash);

  const exceptionScenario = { ...scenario,
    activityOutcomes: [{ stepId: 'intake', iteration: 0, outcome: 'SUCCEEDED' }, { stepId: 'exception', iteration: 0, outcome: 'SUCCEEDED' }],
    decisionChoices: [{ stepId: 'gate', iteration: 0, outcome: 'REVIEW' }] };
  const exceptionRun = await simulate('editor', 'process-simulate-human-exception', { selectedId: 'process-deliver' }, exceptionScenario);
  assert.equal(exceptionRun.result.data.simulation.status, 'COMPLETED');
  assert.ok(exceptionRun.result.data.simulation.trace.some((entry) => entry.stepId === 'exception' && entry.meaning === 'SCENARIO_ASSUMPTION'));
  assert.ok(exceptionRun.result.data.simulation.trace.find((entry) => entry.stepId === 'gate').meaning === 'SCENARIO_ASSUMPTION');

  const mainBeforeBranch = await currentView(instance.base, 'owner', project.id);
  const branchCreated = await postCommand(instance.base, 'editor', project.id,
    branchCommandBody(mainBeforeBranch, 'process-create-exact-source-branch', { kind: 'create-branch', title: 'Process simulation branch',
      reason: 'Bind a separate hypothetical to this saved process flow.' }));
  const branchId = branchCreated.data.branchId;
  const branchBase = await currentView(instance.base, 'editor', project.id, { branchId, selectedId: 'process-deliver' });
  assert.equal(branchBase.data.permissions.processWrite, true);
  assert.equal(branchBase.data.branch.baseBlueprintId, mainBeforeBranch.data.context.blueprintId);
  assert.equal(branchBase.data.branch.baseBlueprintVersion, mainBeforeBranch.data.context.blueprintVersion);
  assert.equal(branchBase.data.branch.comparison.mainSnapshotHash, mainBeforeBranch.data.context.snapshotHash);
  assert.deepEqual(branchBase.data.branch.comparison.relations, { currentAdded: [], currentRemoved: [], branchAdded: [], branchRemoved: [] });
  const branchSimulation = await simulate('editor', 'process-simulate-branch-head',
    { branchId, branchRevision: String(branchBase.data.context.branchRevision), selectedId: 'process-deliver' });
  assert.equal(branchSimulation.result.data.simulation.source.branchId, branchId);
  assert.equal(branchSimulation.result.data.simulation.source.branchRevision, branchBase.data.context.branchRevision);
  assert.equal(branchSimulation.result.data.simulation.source.blueprintId, branchBase.data.context.blueprintId);
  const mainStillExact = await currentView(instance.base, 'owner', project.id);
  assert.equal(mainStillExact.data.context.blueprintId, mainBeforeBranch.data.context.blueprintId);
  assert.equal(mainStillExact.data.context.blueprintVersion, mainBeforeBranch.data.context.blueprintVersion);

  const unsupportedPlan = await request(instance.base, 'editor', `/api/v1/projects/${project.id}/process-plans`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'process-simulation-does-not-authorize-work', expectedVersion: mainStillExact.data.context.projectVersion,
    payload: { processId: 'process-deliver' },
  } }, 409);
  assert.equal(unsupportedPlan.error.code, 'PROCESS_FLOW_RUNTIME_UNSUPPORTED');

  const beforeHistorical = await currentView(instance.base, 'owner', project.id);
  await postCommand(instance.base, 'owner', project.id, commandBody(beforeHistorical, 'process-add-later-main-version', {
    kind: 'create-scope', scopeType: 'organization', name: 'Later organization', detail: 'A later main design version.',
    ownerRoleId: 'role-founder', reason: 'Create a later version so saved-flow history is read-only.' }));
  const historical = await currentView(instance.base, 'owner', project.id, { blueprintVersion: String(flowResult.data.blueprintVersion), selectedId: 'process-deliver' });
  assert.equal(historical.data.context.isCurrent, false);
  const historicalSimulation = await simulate('editor', 'process-simulate-historical', { blueprintVersion: String(flowResult.data.blueprintVersion), selectedId: 'process-deliver' });
  assert.equal(historicalSimulation.result.data.simulation.source.blueprintId, historical.data.context.blueprintId);
  assert.equal(historicalSimulation.result.data.simulation.source.blueprintVersion, historical.data.context.blueprintVersion);
  const currentForStale = await currentView(instance.base, 'owner', project.id);
  const staleSourceBody = commandBody(currentForStale, 'process-simulate-stale-source', { kind: 'simulate-process', processId: 'process-deliver', scenario,
    reason: 'A prior blueprint is not the latest command source.' });
  staleSourceBody.payload.blueprintVersion = historical.data.context.blueprintVersion;
  const stale = await postCommand(instance.base, 'editor', project.id, staleSourceBody, 409);
  assert.equal(stale.error.code, 'PROCESS_SIMULATION_SOURCE_STALE');

  const blockedScenario = { ...scenario, inputs: [{ informationId: 'information-customer-signal', value: null }], decisionChoices: [],
    activityOutcomes: scenario.activityOutcomes.filter((entry) => entry.stepId === 'intake' || entry.stepId === 'exception') };
  const blocked = await simulate('editor', 'process-simulate-unknown-input', { selectedId: 'process-deliver' }, blockedScenario);
  assert.equal(blocked.result.data.simulation.status, 'BLOCKED');
  assert.equal(blocked.result.data.simulation.trace.find((entry) => entry.stepId === 'gate').status, 'UNKNOWN');
  assert.equal(blocked.result.data.simulation.unresolved[0].status, 'UNKNOWN');
  const bounded = await simulate('editor', 'process-simulate-step-limit', { selectedId: 'process-deliver' }, { ...scenario, stepLimit: 1 });
  assert.equal(bounded.result.data.simulation.status, 'LIMIT_REACHED');
  assert.ok(bounded.result.data.simulation.trace.length <= 1, 'the bounded trace cannot exceed the saved simulation step cap');

  const uniqueView = await currentView(instance.base, 'owner', project.id);
  const ambiguousTable = { ...decisionTable, hitPolicy: 'UNIQUE', defaultOutcome: 'STOP', rules: [
    { id: 'overlap-one', outcome: 'APPROVE', conditions: [{ informationId: 'information-customer-signal', operator: 'gte', value: 5 }] },
    { id: 'overlap-two', outcome: 'REVIEW', conditions: [{ informationId: 'information-customer-signal', operator: 'gte', value: 3 }] },
    { id: 'loop-continue', outcome: 'CONTINUE', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 1 }] },
    { id: 'loop-stop', outcome: 'STOP', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 2 }] },
  ] };
  const ambiguousResult = await postCommand(instance.base, 'editor', project.id,
    commandBody(uniqueView, 'process-define-ambiguous-table', { kind: 'define-decision-table', objectId: 'decision-priority',
      decisionTable: ambiguousTable, reason: 'Demonstrate overlap as a visible conflict.' }));
  const conflicted = await simulate('editor', 'process-simulate-unique-conflict', {}, { ...scenario, decisionChoices: [] });
  assert.equal(conflicted.result.data.simulation.status, 'CONFLICTED');
  assert.equal(conflicted.result.data.simulation.unresolved.find((entry) => entry.stepId === 'gate').status, 'CONFLICTED');
  const explicitUnknownChoice = await simulate('editor', 'process-simulate-explicit-unknown-choice', {}, { ...scenario,
    decisionChoices: [{ stepId: 'gate', iteration: 0, outcome: null }] });
  assert.equal(explicitUnknownChoice.result.data.simulation.status, 'BLOCKED');
  assert.equal(explicitUnknownChoice.result.data.simulation.trace.find((entry) => entry.stepId === 'gate').status, 'UNKNOWN');
  assert.equal(explicitUnknownChoice.result.data.simulation.unresolved.find((entry) => entry.stepId === 'gate').status, 'UNKNOWN');
  const projectWithoutPlans = await request(instance.base, 'owner', `/api/v1/projects/${project.id}`);
  assert.equal((projectWithoutPlans.data.processPlans ?? []).length, 0,
    'simulation history remains separate from actual process plans');

  const projectReadBeforeRestart = await request(instance.base, 'owner', `/api/v1/projects/${project.id}`);
  const mainBeforeRestart = projectReadBeforeRestart.data.latestBlueprint.id;
  assert.equal(projectReadBeforeRestart.data.latestBlueprint.id, ambiguousResult.data.blueprintId);
  await closeApp(instance);
  instance = await startApp(postgres, root);
  const restartView = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  assert.equal(restartView.data.context.blueprintId, mainBeforeRestart);
  const savedAfterRestart = restartView.data.simulations;
  assert.ok(savedAfterRestart.some((entry) => entry.id === saved.id && entry.resultHash === saved.resultHash));
  assert.ok(savedAfterRestart.some((entry) => entry.id === historicalSimulation.result.data.simulation.id));
  assert.ok(savedAfterRestart.some((entry) => entry.id === branchSimulation.result.data.simulation.id));
  const exactAfterRestart = await currentView(instance.base, 'owner', project.id,
    { selectedId: 'process-deliver', simulationId: saved.id });
  assert.deepEqual(exactAfterRestart.data.simulation, saved);
  const simulationReplayAfterRestart = await postCommand(instance.base, 'editor', project.id, firstSimulation.body);
  assert.equal(simulationReplayAfterRestart.meta.replayed, true);
  assert.equal(simulationReplayAfterRestart.data.simulation.id, saved.id);
  assert.equal(simulationReplayAfterRestart.data.simulation.resultHash, saved.resultHash);
  assert.ok(flowResult.data.blueprintVersion < ambiguousResult.data.blueprintVersion);
});

test('manual process flow gates actual human work by audited decision routes, forks, loops, exceptions and instance control', async (t) => {
  const postgres = await startPostgres();
  let root;
  let instance;
  t.after(async () => {
    await closeApp(instance);
    if (root) await rm(root, { recursive: true, force: true });
    await postgres.close();
  });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-manual-flow-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise actual manual flow fixture');
  const getProject = (subject = 'owner') => request(instance.base, subject, `/api/v1/projects/${project.id}`);
  const bindingRoute = `/api/v1/projects/${project.id}/actor-bindings/proposals`;
  let enterpriseView = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const decisionTable = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', defaultOutcome: 'STOP',
    inputs: [{ informationId: 'information-customer-signal', valueType: 'number' }], rules: [
      { id: 'route-high', conditions: [{ informationId: 'information-customer-signal', operator: 'gte', value: 5 }], outcome: 'HIGH' },
      { id: 'route-low', conditions: [{ informationId: 'information-customer-signal', operator: 'lt', value: 5 }], outcome: 'LOW' },
      { id: 'loop-continue', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 1 }], outcome: 'CONTINUE' },
      { id: 'loop-stop', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 2 }], outcome: 'STOP' },
    ] };
  const tableResult = await postCommand(instance.base, 'owner', project.id,
    commandBody(enterpriseView, 'manual-flow-decision-table', { kind: 'define-decision-table', objectId: 'decision-priority', decisionTable,
      reason: 'Define explicit human outcomes for routing and the bounded correction decision.' }));
  enterpriseView = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const manual = (id, kind, title, nextStepId, exceptionStepId = null) => ({ id, kind, title,
    processId: 'process-deliver', roleId: 'role-founder', inputIds: ['information-customer-signal'], outputIds: [], nextStepId, exceptionStepId });
  const processFlow = { schemaVersion: '1.0', startStepId: 'start', steps: [
    manual('start', 'manual', 'Verify transfer request', 'gate'),
    { id: 'gate', kind: 'decision', title: 'Select work route', decisionId: 'decision-priority', routes: [
      { outcome: 'HIGH', targetStepId: 'fork' }, { outcome: 'LOW', targetStepId: 'low-work' }] },
    { id: 'fork', kind: 'fork', title: 'Run parallel reviews', branchStepIds: ['check-a', 'check-b'], joinStepId: 'join' },
    manual('check-a', 'manual', 'Verify customer details', 'join', 'exception'),
    manual('check-b', 'manual', 'Verify delivery capacity', 'join'),
    manual('exception', 'manual-exception', 'Resolve failed customer check', 'join'),
    { id: 'join', kind: 'join', title: 'Wait for both checks', forkStepId: 'fork', mode: 'ALL', nextStepId: 'loop' },
    { id: 'loop', kind: 'loop', title: 'Choose correction or finish', decisionId: 'decision-priority', continueOutcome: 'CONTINUE',
      bodyStepId: 'correction', exitStepId: 'flow-end', maxIterations: 2 },
    manual('correction', 'manual', 'Record a correction', 'loop-return'),
    { id: 'loop-return', kind: 'loop-return', title: 'Return to correction decision', loopStepId: 'loop' },
    manual('low-work', 'manual', 'Review low risk transfer', 'low-end'),
    { id: 'low-end', kind: 'end', title: 'Low risk route complete' },
    { id: 'flow-end', kind: 'end', title: 'Transfer review complete' },
  ] };
  const flowResult = await postCommand(instance.base, 'owner', project.id,
    commandBody(enterpriseView, 'manual-flow-save-definition', { kind: 'define-process-flow', objectId: 'process-deliver', processFlow,
      reason: 'Save manual approval, parallel review, exception and bounded correction routes.' }));
  assert.ok(tableResult.data.blueprintVersion < flowResult.data.blueprintVersion);

  let projectView = await getProject();
  const bindingPayload = { actorId: 'actor-founder', roleId: 'role-founder',
    targetPrincipal: identities.get('editor').principal, blueprintVersion: projectView.data.latestBlueprint.version };
  projectView = await request(instance.base, 'owner', bindingRoute, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-flow-editor-binding-proposal', expectedVersion: projectView.data.version,
    payload: bindingPayload,
  } });
  projectView = await request(instance.base, 'owner', `${bindingRoute}/enable`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-flow-editor-binding-enable', expectedVersion: projectView.data.version,
    payload: { actorId: bindingPayload.actorId, roleId: bindingPayload.roleId, blueprintVersion: bindingPayload.blueprintVersion },
  } });
  projectView = await getProject();
  const planned = await request(instance.base, 'owner', `/api/v1/projects/${project.id}/process-plans`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-flow-compile', expectedVersion: projectView.data.version,
    payload: { processId: 'process-deliver', mode: 'manual-flow', blueprintId: flowResult.data.blueprintId,
      blueprintVersion: flowResult.data.blueprintVersion },
  } }, 201);
  let plan = planned.data.processPlans.at(-1);
  assert.equal(plan.kind, 'manual_process_flow_plan');
  assert.equal(plan.source.blueprintId, flowResult.data.blueprintId);
  assert.equal(plan.source.blueprintVersion, flowResult.data.blueprintVersion);
  const findTask = (stepId, iteration = 0) => plan.tasks.find((task) => task.flowRef.stepId === stepId && task.flowRef.iteration === iteration);
  assert.ok(findTask('correction', 1));
  assert.ok(findTask('correction', 2));
  assert.equal(findTask('correction', 3), undefined, 'the compiled task set cannot exceed the saved loop bound');
  const revisionRoute = `/api/v1/projects/${project.id}/process-plans/${plan.id}/revisions`;
  const assigned = await request(instance.base, 'owner', revisionRoute, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-flow-human-assignment', expectedVersion: planned.data.version,
    payload: { tasks: plan.tasks.map((task) => ({ taskId: task.id, title: task.title, detail: task.detail,
      dependencies: task.dependencies, roleId: 'role-founder', actorId: 'actor-founder' })) },
  } }, 200);
  plan = assigned.data.processPlans.filter((entry) => entry.id === plan.id).at(-1);
  assert.equal(plan.revision, 2);
  assert.ok(plan.tasks.every((task) => task.assignee.actorId === 'actor-founder' && task.assignee.roleId === 'role-founder'));

  const runtimeRoute = `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`;
  const runtimeRead = (subject = 'owner') => request(instance.base, subject, runtimeRoute);
  const taskAction = (action, subject, commandId, payload, status = 201) => request(instance.base, subject,
    `/api/execution/process-task-instances/${action}`, { method: 'POST', body: { schemaVersion: '1.0', commandId, payload } }, status);
  const start = (stepId, instanceId = null, subject = 'editor', suffix = stepId, iteration = 0, status = 201) => {
    const task = findTask(stepId, iteration);
    assert.ok(task, `compiled task ${stepId}#${iteration} exists`);
    return taskAction('start', subject, `manual-flow-start-${suffix}`, { projectId: project.id, planId: plan.id,
      revision: plan.revision, planInstanceId: instanceId, taskId: task.id }, status);
  };
  const complete = (stepId, instanceId, suffix, { result = 'succeeded', decisionChoice = undefined, status = 201, subject = 'editor', iteration = 0 } = {}) => {
    const task = findTask(stepId, iteration);
    assert.ok(task, `compiled task ${stepId}#${iteration} exists`);
    const payload = { projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId: instanceId,
      taskId: task.id, result, evidence: [`Evidence for ${stepId} iteration ${iteration}.`], ...(decisionChoice ? { decisionChoice } : {}) };
    const body = { schemaVersion: '1.0', commandId: `manual-flow-complete-${suffix}`, payload };
    return { body, request: taskAction('complete', subject, body.commandId, payload, status) };
  };
  const refreshInstances = async (subject = 'owner') => (await runtimeRead(subject)).instances;
  const instanceRow = (rows, instanceId, taskId) => rows.find((row) => row.planInstanceId === instanceId && row.taskId === taskId);
  const gate = findTask('gate');
  const unactivatedGateStart = await start('gate', null, 'editor', 'gate-before-root', 0, 409);
  assert.equal(unactivatedGateStart.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  const startedRoot = await start('start', null, 'editor', 'root');
  const planInstanceId = startedRoot.planInstanceId;
  assert.match(planInstanceId, /^[0-9a-f-]{36}$/i);
  const rootTask = findTask('start');
  const rootStartIdempotent = await taskAction('start', 'editor', 'manual-flow-start-root', {
    projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId: null, taskId: rootTask.id,
  }, 200);
  assert.equal(rootStartIdempotent.meta.replayed, true);
  assert.equal(rootStartIdempotent.planInstanceId, planInstanceId);

  let row = instanceRow(await refreshInstances('editor'), planInstanceId, rootTask.id);
  assert.ok(row.activation.identity);
  assert.equal(row.activation.planInstanceId, planInstanceId);
  const paused = await request(instance.base, 'editor', '/api/execution/process-task-instances/pause', { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-flow-pause-active-root', payload: { projectId: project.id, planInstanceId,
      version: row.instanceControl.version, reason: 'Hold before the first human outcome is recorded.' },
  } });
  assert.equal(paused.status, 'PAUSE_REQUESTED');
  const pausedStartDenied = await start('gate', planInstanceId, 'editor', 'gate-paused-request', 0, 409);
  assert.equal(pausedStartDenied.error.code, 'PROCESS_INSTANCE_PAUSED');
  const rootCompletion = complete('start', planInstanceId, 'root', { status: 201 });
  const completedRoot = await rootCompletion.request;
  assert.equal(completedRoot.status, 'SUCCEEDED');
  row = instanceRow(await refreshInstances('owner'), planInstanceId, rootTask.id);
  assert.equal(row.instanceControl.status, 'PAUSED');
  assert.ok(row.instanceControl.events.some((event) => event.type === 'ProcessTaskInstancePaused'));
  const pausedGateDenied = await start('gate', planInstanceId, 'editor', 'gate-paused', 0, 409);
  assert.equal(pausedGateDenied.error.code, 'PROCESS_INSTANCE_PAUSED');

  await closeApp(instance);
  instance = await startApp(postgres, root);
  row = instanceRow(await refreshInstances('owner'), planInstanceId, rootTask.id);
  assert.equal(row.instanceControl.status, 'PAUSED', 'pause state and activation survive PostgreSQL app restart');
  const resumed = await request(instance.base, 'owner', '/api/execution/process-task-instances/resume', { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-flow-owner-resume', payload: { projectId: project.id, planInstanceId, version: row.instanceControl.version },
  } });
  assert.equal(resumed.status, 'ACTIVE');

  assert.equal((await start('gate', planInstanceId, 'editor', 'gate')).status, 'IN_PROGRESS');
  const incompleteChoice = await taskAction('complete', 'editor', 'manual-flow-gate-without-choice', {
    projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId, taskId: gate.id,
    result: 'succeeded', evidence: ['Input checked.'],
  }, 400);
  assert.equal(incompleteChoice.error.code, 'INVALID_HUMAN_DECISION_CHOICE', 'direct completion cannot skip its required declared outcome, observations or reason');
  const highChoice = { outcome: 'HIGH', observations: [{ informationId: 'information-customer-signal', value: 10 }], reason: 'The recorded score follows the high route.' };
  const gateCompletion = complete('gate', planInstanceId, 'gate', { decisionChoice: highChoice });
  const completedGate = await gateCompletion.request;
  assert.equal(completedGate.outcome.decisionChoice.outcome, 'HIGH');
  const highChoiceHash = completedGate.outcome.decisionChoice.choiceHash;
  assert.ok(highChoiceHash);
  const skippedStartDenied = await start('low-work', planInstanceId, 'editor', 'low-route-not-selected', 0, 409);
  assert.equal(skippedStartDenied.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  await start('check-a', planInstanceId, 'editor', 'check-a');
  const escalation = await taskAction('escalate', 'editor', 'manual-flow-escalate-check-a', {
    projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId, taskId: findTask('check-a').id,
    reason: 'A second person must resolve this failed verification.', evidence: ['The customer record could not be verified.'],
  });
  assert.equal(escalation.status, 'ESCALATED');
  const escalatedCompletionDenied = await taskAction('complete', 'editor', 'manual-flow-complete-escalated-check-a', {
    projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId, taskId: findTask('check-a').id,
    result: 'failed', evidence: ['Must wait for owner resolution.'],
  }, 409);
  assert.equal(escalatedCompletionDenied.error.code, 'PROCESS_TASK_ESCALATION_ACTIVE');
  const resolution = await taskAction('resolve', 'owner', 'manual-flow-owner-resolve-check-a-failed', {
    projectId: project.id, planId: plan.id, revision: plan.revision, planInstanceId, taskId: findTask('check-a').id,
    disposition: 'failed', reason: 'Verification failed; route through the declared handler.', evidence: ['Owner reviewed the exception.'],
  });
  assert.equal(resolution.status, 'FAILED');
  let rows = await refreshInstances('owner');
  let activation = instanceRow(rows, planInstanceId, rootTask.id).activation;
  assert.equal(activation.tasks.find((entry) => entry.taskId === findTask('exception').id).state, 'READY');
  assert.equal(activation.steps.find((entry) => entry.stepId === 'join').state, 'WAITING');
  await start('exception', planInstanceId, 'editor', 'exception');
  await complete('exception', planInstanceId, 'exception').request;
  await start('check-b', planInstanceId, 'editor', 'check-b');
  await complete('check-b', planInstanceId, 'check-b').request;
  rows = await refreshInstances('owner');
  activation = instanceRow(rows, planInstanceId, rootTask.id).activation;
  assert.equal(activation.steps.find((entry) => entry.stepId === 'join').state, 'SUCCEEDED');
  assert.equal(activation.tasks.find((entry) => entry.taskId === findTask('loop', 0).id).state, 'READY');

  for (let iteration = 0; iteration < 2; iteration += 1) {
    await start('loop', planInstanceId, 'editor', `loop-${iteration}`, iteration);
    await complete('loop', planInstanceId, `loop-${iteration}`, { iteration, decisionChoice: {
      outcome: 'CONTINUE', observations: [{ informationId: 'information-customer-signal', value: 1 }], reason: 'Continue within the saved bound.' } }).request;
    await start('correction', planInstanceId, 'editor', `correction-${iteration + 1}`, iteration + 1);
    await complete('correction', planInstanceId, `correction-${iteration + 1}`, { iteration: iteration + 1 }).request;
  }
  await start('loop', planInstanceId, 'editor', 'loop-exit', 2);
  const stopChoice = { outcome: 'STOP', observations: [{ informationId: 'information-customer-signal', value: 2 }], reason: 'Finish at the declared loop bound.' };
  await complete('loop', planInstanceId, 'loop-exit', { iteration: 2, decisionChoice: stopChoice }).request;
  rows = await refreshInstances('owner');
  activation = instanceRow(rows, planInstanceId, rootTask.id).activation;
  assert.equal(activation.state, 'COMPLETED');
  assert.equal(activation.tasks.find((entry) => entry.taskId === findTask('low-work').id).state, 'SKIPPED');
  const finalLoopRuntime = instanceRow(rows, planInstanceId, findTask('loop', 2).id);
  assert.equal(finalLoopRuntime.outcome.decisionChoice.outcome, 'STOP');
  assert.equal(finalLoopRuntime.outcome.decisionChoice.advisory.status, 'CONFLICTED',
    'the saved human STOP choice remains authoritative even when the typed observations disagree');
  assert.ok(finalLoopRuntime.events.some((event) => event.type === 'HumanTaskCompleted'
    && event.data?.decisionChoice?.choiceHash === finalLoopRuntime.outcome.decisionChoice.choiceHash));
  assert.equal(finalLoopRuntime.outcome.decisionChoice.meaning, 'HUMAN_REPORTED_CHOICE');
  const savedPlan = (await getProject()).data.processPlans.filter((entry) => entry.id === plan.id).at(-1);
  assert.equal(savedPlan.revision, plan.revision);
  assert.equal(savedPlan.source.blueprintHash, plan.source.blueprintHash);
  await closeApp(instance);
  instance = await startApp(postgres, root);
  rows = await refreshInstances('owner');
  const exactRestarted = instanceRow(rows, planInstanceId, gate.id);
  assert.equal(exactRestarted.outcome.decisionChoice.choiceHash, highChoiceHash);
  assert.deepEqual(exactRestarted.outcome.decisionChoice.observations, highChoice.observations);
  assert.equal(instanceRow(rows, planInstanceId, rootTask.id).instanceControl.status, 'ACTIVE');
  assert.equal(instanceRow(rows, planInstanceId, rootTask.id).activation.state, 'COMPLETED');
  const gateReplay = await taskAction('complete', 'editor', gateCompletion.body.commandId, gateCompletion.body.payload, 200);
  assert.equal(gateReplay.meta.replayed, true);
  assert.equal(gateReplay.outcome.decisionChoice.choiceHash, highChoiceHash);
});

test('saved manual flow routes audited human choices through a governed local agent to a restarted human checkpoint', async (t) => {
  const postgres = await startPostgres();
  let root;
  let instance;
  t.after(async () => {
    await closeApp(instance);
    if (root) await rm(root, { recursive: true, force: true });
    await postgres.close();
  });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-manual-agent-flow-'));
  const extraIdentity = (subject, actorType, identityRoles) => ({ issuer, subject,
    principal: `oidc:${createHash('sha256').update(`${issuer}\n${subject}`).digest('hex')}`,
    tenantId, actorType, displayName: subject, roles: identityRoles, expiresAt: Math.floor(Date.now() / 1000) + 300 });
  const additionalIdentities = new Map([
    ['flow-agent', extraIdentity('flow-agent', 'workload', ['workspace-read', 'workspace-write'])],
    ['flow-approver', extraIdentity('flow-approver', 'human', ['workspace-read', 'workspace-write', 'execution-approver'])],
  ]);
  const profileRoot = path.join(root, 'fixed-agent-profile');
  const executionProfiles = [{ id: 'flow-fixed-agent', label: 'Fixed local flow agent', kind: 'command', version: '1.0.0',
    executable: process.execPath, args: ['-e', "process.stdout.write('fixed local flow result')"], workspaceRoot: profileRoot },
  { id: 'flow-fixed-agent-failure', label: 'Fixed local failing flow agent', kind: 'command', version: '1.0.0',
    executable: process.execPath, args: ['-e', "process.stderr.write('fixed local flow failure');process.exit(17)"], workspaceRoot: profileRoot }];
  const inMemoryExecution = { status: 'FAILED', omittedByJson: undefined };
  assert.notEqual(digest(inMemoryExecution), persistedDigest(inMemoryExecution));
  assert.equal(persistedDigest(inMemoryExecution), contentHash({ status: 'FAILED' }));
  instance = await startApp(postgres, root, { additionalIdentities, executionProfiles });
  for (const identity of [...identities.values(), ...additionalIdentities.values()]) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Governed manual agent flow fixture');
  for (const subject of ['flow-agent', 'flow-approver']) {
    await postgres.query(`insert into orgward.project_memberships
      (tenant_id,project_id,principal,access,granted_by) values ($1,$2,$3,'editor',$4)`,
    [tenantId, project.id, additionalIdentities.get(subject).principal, identities.get('owner').principal]);
  }
  const getProject = (subject = 'owner') => request(instance.base, subject, `/api/v1/projects/${project.id}`);
  let projectRead = await getProject();
  const flowView = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const decisionTable = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', defaultOutcome: null,
    inputs: [{ informationId: 'information-customer-signal', valueType: 'number' }], rules: [
      { id: 'route-human', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 0 }], outcome: 'HUMAN' },
      { id: 'route-agent', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 1 }], outcome: 'AGENT' },
      { id: 'loop-continue', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 2 }], outcome: 'CONTINUE' },
      { id: 'loop-stop', conditions: [{ informationId: 'information-customer-signal', operator: 'eq', value: 3 }], outcome: 'STOP' },
    ] };
  const savedTable = await postCommand(instance.base, 'owner', project.id,
    commandBody(flowView, 'manual-agent-flow-table', { kind: 'define-decision-table', objectId: 'decision-priority', decisionTable,
      reason: 'Pin explicit human routes and bounded-loop outcomes.' }));
  const latestView = await currentView(instance.base, 'owner', project.id, { selectedId: 'process-deliver' });
  const manual = (id, title, roleId, nextStepId, { kind = 'manual', exceptionStepId = null } = {}) => ({ id, kind, title,
    processId: 'process-deliver', roleId, inputIds: ['information-customer-signal'], outputIds: [], nextStepId, exceptionStepId });
  const processFlow = { schemaVersion: '1.0', startStepId: 'start', steps: [
    manual('start', 'Review transfer request', 'role-founder', 'gate'),
    { id: 'gate', kind: 'decision', title: 'Choose review route', decisionId: 'decision-priority', routes: [
      { outcome: 'AGENT', targetStepId: 'agent-work' }, { outcome: 'HUMAN', targetStepId: 'human-alternate' }] },
    manual('agent-work', 'Prepare a bounded review result', 'role-design-assistant', 'human-checkpoint', { exceptionStepId: 'agent-failure-handler' }),
    manual('human-checkpoint', 'Verify the agent result', 'role-founder', 'loop'),
    manual('human-alternate', 'Review without agent assistance', 'role-founder', 'flow-end'),
    manual('agent-failure-handler', 'Review the agent failure', 'role-founder', 'flow-end', { kind: 'manual-exception' }),
    { id: 'loop', kind: 'loop', title: 'Human correction decision', decisionId: 'decision-priority', continueOutcome: 'CONTINUE',
      bodyStepId: 'correction', exitStepId: 'flow-end', maxIterations: 1 },
    manual('correction', 'Record a bounded correction', 'role-founder', 'loop-return'),
    { id: 'loop-return', kind: 'loop-return', title: 'Return to correction decision', loopStepId: 'loop' },
    { id: 'flow-end', kind: 'end', title: 'Review complete' },
  ] };
  const savedFlow = await postCommand(instance.base, 'owner', project.id,
    commandBody(latestView, 'manual-agent-flow-save', { kind: 'define-process-flow', objectId: 'process-deliver', processFlow,
      reason: 'Route one human decision through a fixed local agent and a human checkpoint.' }));
  assert.ok(savedTable.data.blueprintVersion < savedFlow.data.blueprintVersion);

  projectRead = await getProject();
  const bindingRoute = `/api/v1/projects/${project.id}/actor-bindings/proposals`;
  const bind = async ({ actorId, roleId, subject, suffix }) => {
    const payload = { actorId, roleId, targetPrincipal: additionalIdentities.get(subject)?.principal ?? identities.get(subject).principal,
      blueprintVersion: projectRead.data.latestBlueprint.version };
    projectRead = await request(instance.base, 'owner', bindingRoute, { method: 'POST', body: {
      schemaVersion: '1.0', commandId: `manual-agent-bind-${suffix}`, expectedVersion: projectRead.data.version, payload,
    } });
    projectRead = await request(instance.base, 'owner', `${bindingRoute}/enable`, { method: 'POST', body: {
      schemaVersion: '1.0', commandId: `manual-agent-enable-${suffix}`, expectedVersion: projectRead.data.version,
      payload: { actorId, roleId, blueprintVersion: payload.blueprintVersion },
    } });
  };
  await bind({ actorId: 'actor-founder', roleId: 'role-founder', subject: 'editor', suffix: 'human' });
  await bind({ actorId: 'actor-design-assistant', roleId: 'role-design-assistant', subject: 'flow-agent', suffix: 'agent' });
  projectRead = await getProject();
  const plansRoute = `/api/v1/projects/${project.id}/process-plans`;
  const planned = await request(instance.base, 'owner', plansRoute, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-agent-flow-compile', expectedVersion: projectRead.data.version,
    payload: { processId: 'process-deliver', mode: 'manual-flow', blueprintId: savedFlow.data.blueprintId,
      blueprintVersion: savedFlow.data.blueprintVersion },
  } }, 201);
  const plan = planned.data.processPlans.at(-1);
  const task = (stepId, iteration = 0) => plan.tasks.find((entry) => entry.flowRef.stepId === stepId && entry.flowRef.iteration === iteration);
  const assignments = (override = {}) => plan.tasks.map((entry) => {
    const assignment = override[entry.flowRef.stepId] ?? (entry.flowRef.stepId === 'agent-work'
      ? { roleId: 'role-design-assistant', actorId: 'actor-design-assistant' }
      : { roleId: 'role-founder', actorId: 'actor-founder' });
    return { taskId: entry.id, title: entry.title, detail: entry.detail, dependencies: entry.dependencies, ...assignment };
  });
  const revisionRoute = `${plansRoute}/${plan.id}/revisions`;
  for (const stepId of ['gate', 'loop']) {
    const invalid = await request(instance.base, 'owner', revisionRoute, { method: 'POST', body: {
      schemaVersion: '1.0', commandId: `manual-agent-deny-agent-${stepId}`, expectedVersion: planned.data.version,
      payload: { tasks: assignments({ [stepId]: { roleId: 'role-design-assistant', actorId: 'actor-design-assistant' } }) },
    } }, 409);
    assert.equal(invalid.error.code, 'PROCESS_FLOW_HUMAN_DECISION_REQUIRED');
  }
  const assigned = await request(instance.base, 'owner', revisionRoute, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'manual-agent-flow-human-and-agent-assignments', expectedVersion: planned.data.version,
    payload: { tasks: assignments() },
  } }, 200);
  const planRevision = assigned.data.processPlans.filter((entry) => entry.id === plan.id).at(-1);
  assert.equal(planRevision.revision, 2);
  const flowAgentTask = planRevision.tasks.find((entry) => entry.flowRef.stepId === 'agent-work');
  assert.equal(flowAgentTask.assignee.actorId, 'actor-design-assistant');

  const runtimeRoute = `/api/execution/process-task-instances?projectId=${encodeURIComponent(project.id)}`;
  const runtimeRead = async (subject = 'owner') => (await request(instance.base, subject, runtimeRoute)).instances;
  const action = (name, subject, commandId, payload, status = 201) => request(instance.base, subject,
    `/api/execution/process-task-instances/${name}`, { method: 'POST', body: { schemaVersion: '1.0', commandId, payload } }, status);
  const startTask = (stepId, instanceId, suffix, status = 201) => action('start', 'editor', `manual-agent-start-${suffix}`, {
    projectId: project.id, planId: plan.id, revision: planRevision.revision, planInstanceId: instanceId, taskId: task(stepId).id,
  }, status);
  const completeTask = (stepId, instanceId, suffix, options = {}, status = 201) => action('complete', 'editor', `manual-agent-complete-${suffix}`, {
    projectId: project.id, planId: plan.id, revision: planRevision.revision, planInstanceId: instanceId, taskId: task(stepId).id,
    result: 'succeeded', evidence: [`Verified ${stepId} in the authored flow.`], ...options,
  }, status);
  const createAgentRun = (instanceId, commandId, status = 201) => request(instance.base, 'editor', '/api/execution/process-task-runs', { method: 'POST', body: {
    schemaVersion: '1.0', commandId, payload: { projectId: project.id, planId: plan.id, revision: planRevision.revision,
      ...(instanceId === null ? {} : { planInstanceId: instanceId }), taskId: flowAgentTask.id, profileId: 'flow-fixed-agent' },
  } }, status);
  const createAgentRunWithProfile = (instanceId, commandId, profileId, status = 201) => request(instance.base, 'editor', '/api/execution/process-task-runs', { method: 'POST', body: {
    schemaVersion: '1.0', commandId, payload: { projectId: project.id, planId: plan.id, revision: planRevision.revision,
      planInstanceId: instanceId, taskId: flowAgentTask.id, profileId },
  } }, status);
  const denyBeforeRoute = await createAgentRun(null, 'manual-agent-request-before-root', 409);
  assert.equal(denyBeforeRoute.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  const createInstance = async (suffix, gateOutcome) => {
    const started = await startTask('start', null, `${suffix}-root`);
    const instanceId = started.planInstanceId;
    await completeTask('start', instanceId, `${suffix}-root`);
    await startTask('gate', instanceId, `${suffix}-gate`);
    const decisionChoice = { outcome: gateOutcome, observations: [{ informationId: 'information-customer-signal', value: gateOutcome === 'AGENT' ? 1 : 0 }],
      reason: `Human owner selects ${gateOutcome} for this instance.` };
    await completeTask('gate', instanceId, `${suffix}-gate`, { decisionChoice });
    return instanceId;
  };
  const alternateInstance = await createInstance('alternate', 'HUMAN');
  const denyUnselected = await createAgentRun(alternateInstance, 'manual-agent-request-unselected', 409);
  assert.equal(denyUnselected.error.code, 'PROCESS_TASK_DEPENDENCY_UNSATISFIED');

  const cancelledInstance = await createInstance('cancelled', 'AGENT');
  const cancelledRequest = await createAgentRun(cancelledInstance, 'manual-agent-request-cancelled');
  const cancelledRun = await request(instance.base, 'editor', `/api/execution/runs/${cancelledRequest.id}/cancel`, { method: 'POST', body: {
    commandId: 'manual-agent-cancel-before-approval', projectId: project.id, version: cancelledRequest.version,
  } });
  assert.equal(cancelledRun.status, 'CANCELLED');
  let cancelledRows = await runtimeRead();
  const cancelledAgentRuntime = cancelledRows.find((row) => row.planInstanceId === cancelledInstance && row.taskId === flowAgentTask.id);
  assert.equal(cancelledAgentRuntime.status, 'CANCELLED');
  assert.equal(cancelledAgentRuntime.activation.tasks.find((entry) => entry.taskId === task('human-checkpoint').id).state, 'WAITING');
  assert.equal(cancelledAgentRuntime.activation.tasks.find((entry) => entry.taskId === task('agent-failure-handler').id).state, 'WAITING');

  const failedInstance = await createInstance('failed', 'AGENT');
  const failedRequest = await createAgentRunWithProfile(failedInstance, 'manual-agent-request-failure', 'flow-fixed-agent-failure');
  let failedRows = await runtimeRead();
  let failedAgentRuntime = failedRows.find((row) => row.planInstanceId === failedInstance && row.taskId === flowAgentTask.id);
  assert.equal(failedAgentRuntime.activation.tasks.find((entry) => entry.taskId === task('agent-failure-handler').id).state, 'WAITING');
  assert.equal(failedAgentRuntime.activation.tasks.find((entry) => entry.taskId === task('human-checkpoint').id).state, 'WAITING');
  const failedApproval = await request(instance.base, 'flow-approver', `/api/execution/runs/${failedRequest.id}/approve`, { method: 'POST', body: { version: failedRequest.version } });
  const failedRun = await request(instance.base, 'editor', `/api/execution/runs/${failedRequest.id}/execute`, { method: 'POST', body: { version: failedApproval.version } });
  assert.equal(failedRun.status, 'FAILED');
  assert.equal(failedRun.execution.status, 'FAILED');
  assert.equal(failedRun.execution.exitCode, 17, 'the configured local command, rather than startup or sandbox failure, produced the declared failed result');
  const failedEvent = failedRun.events.find((entry) => entry.type === 'ExecutionFailed');
  const failedStoredExecution = await postgres.query(`select state->'execution' as execution from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, failedRun.id]);
  assert.equal(failedStoredExecution.rowCount, 1);
  assert.equal(failedEvent.data.executionHash, contentHash(failedStoredExecution.rows[0].execution));
  const failedAudit = await postgres.query(`select aggregate_version from orgward.audit_log
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and event_type='ExecutionFailed'`,
  [tenantId, failedRun.id]);
  assert.equal(failedAudit.rowCount, 1);
  failedRows = await runtimeRead();
  failedAgentRuntime = failedRows.find((row) => row.planInstanceId === failedInstance && row.taskId === flowAgentTask.id);
  const failedStatusEvent = failedAgentRuntime.events.find((entry) => entry.type === 'ProcessTaskRunStatusChanged'
    && entry.data.runId === failedRun.id && entry.data.status === 'FAILED');
  assert.equal(Number(failedAudit.rows[0].aggregate_version), Number(failedStatusEvent.data.runVersion));
  assert.equal(failedAgentRuntime.activation.tasks.find((entry) => entry.taskId === task('agent-failure-handler').id).state, 'READY');
  assert.equal(failedAgentRuntime.activation.tasks.find((entry) => entry.taskId === task('human-checkpoint').id).state, 'SKIPPED');

  const activeInstance = await createInstance('successful', 'AGENT');
  const agentRequest = await createAgentRun(activeInstance, 'manual-agent-request-success');
  assert.equal(agentRequest.status, 'AWAITING_APPROVAL');
  assert.equal(agentRequest.processTaskRef.flowBinding.snapshotHash, planRevision.snapshotHash);
  assert.equal(agentRequest.processTaskRef.flowBinding.definitionHash, planRevision.flow.definitionHash);
  assert.match(agentRequest.processTaskRef.flowBinding.activationIdentity, /^[a-f0-9]{64}$/);
  const approved = await request(instance.base, 'flow-approver', `/api/execution/runs/${agentRequest.id}/approve`, { method: 'POST', body: { version: agentRequest.version } });
  const executed = await request(instance.base, 'editor', `/api/execution/runs/${agentRequest.id}/execute`, { method: 'POST', body: { version: approved.version } });
  assert.equal(executed.status, 'SUCCEEDED');
  assert.equal(executed.execution.stdout, 'fixed local flow result');
  const succeededEvent = executed.events.find((entry) => entry.type === 'ExecutionSucceeded');
  const succeededStoredExecution = await postgres.query(`select state->'execution' as execution from orgward.aggregates
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2`, [tenantId, executed.id]);
  assert.equal(succeededStoredExecution.rowCount, 1);
  assert.equal(succeededEvent.data.executionHash, contentHash(succeededStoredExecution.rows[0].execution));
  const terminalAudit = await postgres.query(`select aggregate_version from orgward.audit_log
    where tenant_id=$1 and aggregate_kind='execution_run' and aggregate_id=$2 and event_type='ExecutionSucceeded'`,
  [tenantId, executed.id]);
  assert.equal(terminalAudit.rowCount, 1);
  let rows = await runtimeRead();
  const agentRuntime = rows.find((row) => row.planInstanceId === activeInstance && row.taskId === flowAgentTask.id);
  assert.equal(agentRuntime.status, 'SUCCEEDED');
  const statusEvent = agentRuntime.events.find((entry) => entry.type === 'ProcessTaskRunStatusChanged'
    && entry.data.runId === executed.id && entry.data.status === 'SUCCEEDED');
  assert.equal(Number(terminalAudit.rows[0].aggregate_version), Number(statusEvent.data.runVersion),
    'terminal run audit version matches the linked task status receipt');
  assert.equal(agentRuntime.activation.tasks.find((entry) => entry.taskId === task('human-checkpoint').id).state, 'READY');
  await closeApp(instance);
  instance = await startApp(postgres, root, { additionalIdentities, executionProfiles });
  rows = await runtimeRead();
  const restartedAgent = rows.find((row) => row.planInstanceId === activeInstance && row.taskId === flowAgentTask.id);
  assert.equal(restartedAgent.activation.tasks.find((entry) => entry.taskId === task('human-checkpoint').id).state, 'READY');
  await startTask('human-checkpoint', activeInstance, 'after-restart-human');
  await completeTask('human-checkpoint', activeInstance, 'after-restart-human');
  rows = await runtimeRead();
  assert.equal(rows.find((row) => row.planInstanceId === activeInstance && row.taskId === task('human-checkpoint').id).status, 'SUCCEEDED');
  assert.equal(rows.find((row) => row.planInstanceId === cancelledInstance && row.taskId === flowAgentTask.id).activation.tasks
    .find((entry) => entry.taskId === task('human-checkpoint').id).state, 'WAITING');
});

test('enterprise economics save typed capacity, evaluate exact sources and keep omitted demand unknown', async (t) => {
  const postgres = await startPostgres(); let root; let instance;
  t.after(async () => { await closeApp(instance); if (root) await rm(root, { recursive: true, force: true }); await postgres.close(); });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-economics-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise economics fixture');
  let view = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: 'economics-launch' });
  const send = async (payload, commandId, subject = 'owner', expectedStatus = 200) => {
    const response = await request(instance.base, subject, `/api/v1/projects/${project.id}/enterprise/commands`, {
      method: 'POST', body: commandBody(view, commandId, payload),
    }, expectedStatus);
    if (expectedStatus < 400) view = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: 'economics-launch' });
    return response;
  };
  const interval = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z', timezone: 'UTC' };
  const quantity = (value, unit) => ({ value, unit, source: 'Fixture owner report' });
  const money = (minorUnits, perUnit = undefined) => ({ minorUnits, currency: 'USD', decimalPlaces: 2,
    ...(perUnit ? { perUnit } : {}), source: 'Fixture accounting assumption' });
  await send({ kind: 'define-resource-plan', objectId: 'resource-operating-capacity', reason: 'Record the whole-window capacity basis.', resourcePlan: {
    schemaVersion: '1.0', provider: 'Owner-reported staffing plan', windows: [{ id: 'delivery-window', window: interval,
      capacity: quantity(40, 'hours'), available: quantity(40, 'hours'), allocations: [] }],
  } }, 'enterprise-economics-resource-plan');
  await send({ kind: 'define-economic-scenario', objectId: 'economics-launch', reason: 'Model declared launch assumptions.', economicScenario: {
    schemaVersion: '1.0', offeringId: 'offering-core', processIds: ['process-deliver'], window: interval,
    volume: quantity(100, 'transfers'), unitPrice: money(0, 'transfers'), unitVariableCost: money(0, 'transfers'),
    fixedCost: money(0), availableFunding: money(0), resourceDemands: [],
  } }, 'enterprise-economics-scenario');
  const evaluationResponse = await send({ kind: 'evaluate-economic-scenario', objectId: 'economics-launch', reason: 'Review the saved declared scenario.' },
    'enterprise-economics-evaluation');
  const evaluation = evaluationResponse.data.economicEvaluation;
  assert.match(evaluation.id, /^economic-evaluation-[0-9a-f-]{36}$/);
  assert.equal(evaluation.status, 'UNKNOWN');
  assert.equal(evaluation.metrics.breakEvenVolume.status, 'CALCULATED');
  assert.equal(evaluation.metrics.breakEvenVolume.value, 0);
  assert.equal(evaluation.resources[0].metrics.required.status, 'UNKNOWN');
  assert.ok(evaluation.warnings.some((warning) => warning.code === 'RESOURCE_DEMAND_UNKNOWN'
    && warning.processId === 'process-deliver' && warning.resourceId === 'resource-operating-capacity'));
  assert.equal(evaluation.sourceLabels.records['process-deliver'], 'Deliver the core offering');
  const exact = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: 'economics-launch', economicEvaluationId: evaluation.id });
  assert.equal(exact.data.economics.evaluation.id, evaluation.id);
  assert.equal(exact.data.economics.evaluation.matchesSelectedSource, true);
  assert.equal(exact.data.economics.evaluations.length, 1);
  const createBranchBody = branchCommandBody(view, 'enterprise-economics-create-branch', { kind: 'create-branch',
    title: 'Capacity alternative', reason: 'Review an isolated capacity assumption.' });
  const createdBranch = await postCommand(instance.base, 'owner', project.id, createBranchBody);
  const branchId = createdBranch.data.branchId;
  let branchView = await currentView(instance.base, 'owner', project.id, { lensId: 'all', branchId, selectedId: 'resource-operating-capacity' });
  const branchPlan = structuredClone(branchView.data.blueprint.areas.resources.items.find((entry) => entry.id === 'resource-operating-capacity').resourcePlan);
  branchPlan.provider = 'Branch-specific staffing report';
  const branchPlanBody = branchCommandBody(branchView, 'enterprise-economics-branch-resource-plan', { kind: 'define-resource-plan',
    objectId: 'resource-operating-capacity', reason: 'Record the branch-specific staffing basis.', resourcePlan: branchPlan });
  const branchPlanResult = await postCommand(instance.base, 'owner', project.id, branchPlanBody);
  assert.equal(branchPlanResult.data.branchRevision, 2);
  const branchPlanReplay = await postCommand(instance.base, 'owner', project.id, branchPlanBody);
  assert.equal(branchPlanReplay.meta.replayed, true);
  branchView = await currentView(instance.base, 'owner', project.id, { lensId: 'all', branchId, selectedId: 'resource-operating-capacity' });
  assert.equal(branchView.data.branch.revision, 2);

  const readerView = await currentView(instance.base, 'reader', project.id, { lensId: 'all', selectedId: 'economics-launch' });
  await request(instance.base, 'reader', `/api/v1/projects/${project.id}/enterprise/commands`, {
    method: 'POST', body: commandBody(readerView, 'enterprise-economics-reader-denied', { kind: 'evaluate-economic-scenario',
      objectId: 'economics-launch', reason: 'Attempt unauthorized evaluation.' }),
  }, 403);
  view = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: 'economics-launch' });
  const staleScenario = { ...view.data.blueprint.areas.customersOfferingsValueEconomics.items.find((entry) => entry.id === 'economics-launch').economicScenario,
    fixedCost: money(100) };
  await send({ kind: 'define-economic-scenario', objectId: 'economics-launch', reason: 'Revise the current assumptions after the saved evaluation.', economicScenario: staleScenario },
    'enterprise-economics-revise-after-evaluation');
  const newerSource = await currentView(instance.base, 'owner', project.id,
    { lensId: 'all', selectedId: 'economics-launch', economicEvaluationId: evaluation.id });
  assert.equal(newerSource.data.economics.evaluation.matchesSelectedSource, false);
  const beforeEvaluation = new Date(Date.parse(evaluation.createdAt) - 1).toISOString();
  const cutoff = await currentView(instance.base, 'owner', project.id,
    { lensId: 'all', selectedId: 'economics-launch', economicEvaluationId: evaluation.id, recordedAt: beforeEvaluation }, 404);
  assert.equal(cutoff.error.code, 'ENTERPRISE_CONTEXT_NOT_RECORDED');
  await closeApp(instance);
  instance = await startApp(postgres, root);
  const restored = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: 'economics-launch',
    blueprintVersion: evaluation.source.blueprintVersion, economicEvaluationId: evaluation.id });
  assert.equal(restored.data.economics.evaluation.id, evaluation.id);
  assert.equal(restored.data.economics.evaluation.resultHash, evaluation.resultHash);
  assert.equal(restored.data.economics.evaluation.matchesSelectedSource, true);
});

test('saved refinement links update canonical relations, reject cycles and trace exact branch revisions', async (t) => {
  const postgres = await startPostgres(); let root; let instance;
  t.after(async () => { await closeApp(instance); if (root) await rm(root, { recursive: true, force: true }); await postgres.close(); });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-refinement-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise refinement fixture');
  let view = await currentView(instance.base, 'owner', project.id, { lensId: 'all' });
  const objects = Object.values(view.data.blueprint.areas).flatMap((area) => area.items);
  assert.ok(objects.length >= 2);
  const parent = objects[0]; const child = objects[1];
  const payload = { kind: 'define-refinement', objectId: child.id, refines: [parent.id], reason: 'Record a proposed decomposition.' };
  const command = commandBody(view, 'enterprise-refinement-main', payload);
  const saved = await postCommand(instance.base, 'owner', project.id, command);
  assert.equal(saved.data.blueprintVersion, view.data.context.blueprintVersion + 1);
  const replay = await postCommand(instance.base, 'owner', project.id, command);
  assert.equal(replay.meta.replayed, true);
  view = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: parent.id });
  assert.ok(view.data.blueprint.relations.some((relation) => relation.source === child.id && relation.target === parent.id && relation.type === 'refines'));
  assert.equal(view.data.refinementTrace.status, 'LINKED');
  assert.equal(view.data.refinementTrace.descendants.find((entry) => entry.id === child.id).path.join('/'), `${parent.id}/${child.id}`);
  assert.match(view.data.refinementTrace.traceHash, /^[a-f0-9]{64}$/);

  const cycle = await postCommand(instance.base, 'owner', project.id,
    commandBody(view, 'enterprise-refinement-cycle', { kind: 'define-refinement', objectId: parent.id,
      refines: [child.id], reason: 'Reject the proposed cycle.' }), 409);
  assert.equal(cycle.error.code, 'INVALID_REFINEMENT');
  const selfLink = await postCommand(instance.base, 'owner', project.id,
    commandBody(view, 'enterprise-refinement-self-link', { kind: 'define-refinement', objectId: parent.id,
      refines: [parent.id], reason: 'Reject a self link as a client error.' }), 400);
  assert.equal(selfLink.error.code, 'INVALID_REFINEMENT_REFERENCE');
  view = await currentView(instance.base, 'owner', project.id, { lensId: 'all' });
  const branchCreated = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(view, 'enterprise-refinement-branch-create', { kind: 'create-branch', title: 'Refinement review', reason: 'Review an alternate decomposition.' }));
  const branchId = branchCreated.data.branchId;
  const branchTarget = objects[2]; const branchSource = objects[3];
  assert.ok(branchTarget && branchSource);
  const branchView = await currentView(instance.base, 'owner', project.id, { lensId: 'all', branchId, selectedId: branchTarget.id });
  const branchPayload = { kind: 'define-refinement', objectId: branchSource.id, refines: [branchTarget.id], reason: 'Review branch-only decomposition.' };
  const branchCommand = branchCommandBody(branchView, 'enterprise-refinement-branch-save', branchPayload);
  const branchSaved = await postCommand(instance.base, 'owner', project.id, branchCommand);
  assert.equal(branchSaved.data.branchRevision, 2);
  const branchReplay = await postCommand(instance.base, 'owner', project.id, branchCommand);
  assert.equal(branchReplay.meta.replayed, true);
  const exactBranch = await currentView(instance.base, 'owner', project.id, { lensId: 'all', branchId, branchRevision: '2', selectedId: branchTarget.id });
  assert.equal(exactBranch.data.refinementTrace.descendants.find((entry) => entry.id === branchSource.id).depth, 1);
  const mainAgain = await currentView(instance.base, 'owner', project.id, { lensId: 'all', selectedId: branchTarget.id });
  assert.equal(mainAgain.data.refinementTrace.descendants.length, 0, 'the branch refinement remains isolated from proposed main design');
});

test('enterprise branches merge exact typed changes only after a current owner review', async (t) => {
  const postgres = await startPostgres();
  let root;
  let instance;
  t.after(async () => {
    await closeApp(instance);
    if (root) await rm(root, { recursive: true, force: true });
    await postgres.close();
  });
  root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-branches-'));
  instance = await startApp(postgres, root);
  for (const identity of identities.values()) {
    await postgres.query(`insert into orgward.oidc_principals
      (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
    [identity.principal, identity.issuer, identity.tenantId, identity.actorType, identity.displayName, identity.roles]);
  }
  const project = await seedProject(postgres, 'Enterprise branch fixture');
  const reviewer = { issuer, subject: 'branch-reviewer', principal: `oidc:${createHash('sha256').update(`${issuer}\nbranch-reviewer`).digest('hex')}`,
    tenantId, actorType: 'human', displayName: 'branch-reviewer', roles: ['workspace-read', 'workspace-write'],
    expiresAt: Math.floor(Date.now() / 1000) + 300 };
  identities.set('branch-reviewer', reviewer);
  t.after(() => identities.delete('branch-reviewer'));
  await postgres.query(`insert into orgward.oidc_principals
    (principal,issuer,tenant_id,actor_type,display_name,roles) values ($1,$2,$3,$4,$5,$6::text[])`,
  [reviewer.principal, reviewer.issuer, reviewer.tenantId, reviewer.actorType, reviewer.displayName, reviewer.roles]);
  await postgres.query(`insert into orgward.project_memberships
    (tenant_id,project_id,principal,access,granted_by) values ($1,$2,$3,'editor',$4)`,
  [tenantId, project.id, reviewer.principal, identities.get('owner').principal]);

  const readMain = (subject = 'owner') => currentView(instance.base, subject, project.id);
  const readBranch = (subject, branchId, branchRevision = null) => currentView(instance.base, subject, project.id,
    { branchId, ...(branchRevision === null ? {} : { branchRevision }), selectedId: 'process-deliver' });
  let serial = 0;
  const createMainOrg = async (name) => {
    const view = await readMain();
    const result = await postCommand(instance.base, 'owner', project.id, commandBody(view, `branch-main-scope-${++serial}`, {
      kind: 'create-scope', scopeType: 'organization', name, detail: `Scope ${name}.`, ownerRoleId: 'role-founder',
      reason: `Create ${name} as canonical main design.` }));
    return result.data.affectedObjectId;
  };
  const baseOrganizationId = await createMainOrg('Base organization');
  const mainOrganizationId = await createMainOrg('Main organization');
  const draftOrganizationId = await createMainOrg('Draft organization');
  let view = await readMain();
  await postCommand(instance.base, 'editor', project.id, commandBody(view, 'branch-set-base-process-scope', {
    kind: 'assign-object-scope', objectId: 'process-deliver', organizationId: baseOrganizationId,
    legalEntityId: null, unitId: null, reason: 'Set the branch base scope.' }));
  view = await readMain();
  const readerCreate = await postCommand(instance.base, 'reader', project.id,
    branchCommandBody(view, 'reader-cannot-create-branch', { kind: 'create-branch', title: 'Denied branch', reason: 'Read-only identity.' }), 403);
  assert.equal(readerCreate.error.code, 'ACTION_FORBIDDEN');

  const initialBlueprint = view.data.blueprint;
  const baseProcess = items(initialBlueprint).find((entry) => entry.id === 'process-deliver');
  const role = items(initialBlueprint).find((entry) => entry.id === baseProcess.owner);
  const createBranch = await postCommand(instance.base, 'editor', project.id,
    branchCommandBody(view, 'create-delivery-branch', { kind: 'create-branch', title: 'Delivery redesign branch', reason: 'Explore an isolated design alternative.' }));
  const branchId = createBranch.data.branchId;
  assert.equal(createBranch.data.branchRevision, 1);
  const branchRoute = `/api/v1/projects/${project.id}/enterprise?branchId=${branchId}`;
  const foreignBranch = await request(instance.base, 'foreign', branchRoute, {}, 404);
  assert.equal(foreignBranch.error.code, 'PROJECT_NOT_FOUND');

  let draft = await readBranch('editor', branchId);
  assert.equal(draft.data.context.sourceKind, 'BRANCH_DRAFT');
  assert.equal(draft.data.context.isCurrent, false);
  assert.equal(draft.data.permissions.branchWrite, true);
  assert.equal(draft.data.branch.status, 'DRAFT');
  assert.equal(draft.data.branch.revision, 1);
  assert.ok(draft.data.versions.every((entry) => entry.id !== draft.data.context.blueprintId), 'branch snapshots do not enter main version history');
  const invalidTypedEdit = branchCommandBody(draft, 'branch-rejects-missing-information', { kind: 'edit-branch-object',
    edit: { objectId: 'process-deliver', name: 'Invalid branch process', detail: 'References absent information.', ownerRoleName: role.name,
      trigger: baseProcess.trigger, inputInformationIds: ['information-missing-target'], outputInformationIds: baseProcess.outputs },
    reason: 'The missing typed target must be rejected.' });
  const invalidTypedResult = await postCommand(instance.base, 'editor', project.id, invalidTypedEdit, 400);
  assert.equal(invalidTypedResult.error.code, 'INVALID_BLUEPRINT_RELATION');
  assert.equal((await readBranch('editor', branchId)).data.branch.revision, 1);

  const mainOnlyCreateView = await readMain();
  const mainOnlyResult = await postCommand(instance.base, 'owner', project.id,
    commandBody(mainOnlyCreateView, 'create-main-only-scope-after-branch', { kind: 'create-scope', scopeType: 'organization',
      name: 'Main-only organization', detail: 'Canonical main-only addition.', ownerRoleId: 'role-founder',
      reason: 'Add one main-only organization.' }));
  const mainOnlyOrganizationId = mainOnlyResult.data.affectedObjectId;

  draft = await readBranch('owner', branchId);
  const branchOnlyCreate = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(draft, 'create-draft-only-scope', { kind: 'edit-branch-scope',
      change: { kind: 'create-scope', scopeType: 'organization', name: 'Draft-only organization',
        detail: 'Canonical draft-only addition.', ownerRoleId: 'role-founder' }, reason: 'Add one draft-only organization.' }));
  const draftOnlyOrganizationId = branchOnlyCreate.data.affectedObjectId;
  draft = await readBranch('editor', branchId);
  const branchProcess = items(draft.data.blueprint).find((entry) => entry.id === 'process-deliver');
  const branchEdit = await postCommand(instance.base, 'editor', project.id,
    branchCommandBody(draft, 'edit-branch-process', { kind: 'edit-branch-object', edit: {
      objectId: branchProcess.id, name: 'Draft delivery process', detail: 'Draft-specific delivery detail.',
      ownerRoleName: role.name, trigger: branchProcess.trigger, inputInformationIds: ['information-delivery-result'],
      outputInformationIds: branchProcess.outputs,
    }, reason: 'Change process name, reference array and details in the isolated draft.' }));
  draft = await readBranch('owner', branchId);
  const draftScope = await postCommand(instance.base, 'editor', project.id,
    branchCommandBody(draft, 'assign-draft-process-scope', { kind: 'edit-branch-scope',
      change: { kind: 'assign-object-scope', objectId: 'process-deliver', organizationId: draftOrganizationId,
        legalEntityId: null, unitId: null }, reason: 'Change the process scope in the isolated draft.' }));
  assert.equal(draftScope.data.branchRevision, branchEdit.data.branchRevision + 1);

  const mainProject = (await request(instance.base, 'owner', `/api/v1/projects/${project.id}`)).data;
  const mainProcess = items(mainProject.latestBlueprint).find((entry) => entry.id === 'process-deliver');
  const mainEdit = await request(instance.base, 'owner', `/api/v1/projects/${project.id}/blueprint/edits`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'edit-main-process-against-branch', expectedVersion: mainProject.version,
    payload: { objectId: mainProcess.id, name: 'Main delivery process', detail: 'Main-specific delivery detail.',
      ownerRoleName: role.name, trigger: mainProcess.trigger, inputInformationIds: ['information-customer-signal'],
      outputInformationIds: mainProcess.outputs },
  } });
  view = await readMain();
  const mainScopeChange = await postCommand(instance.base, 'editor', project.id,
    commandBody(view, 'assign-main-process-scope', { kind: 'assign-object-scope', objectId: 'process-deliver',
      organizationId: mainOrganizationId, legalEntityId: null, unitId: null, reason: 'Change main process scope.' }));
  view = await readMain();
  const compare = await readBranch('editor', branchId);
  assert.equal(compare.data.branch.comparison.mainBlueprintId, mainScopeChange.data.blueprintId);
  const conflicts = compare.data.branch.comparison.conflicts;
  const conflict = (field) => conflicts.find((row) => row.objectId === 'process-deliver' && row.field === field);
  assert.equal(conflict('name')?.kind, 'CONTENT');
  assert.equal(conflict('inputs')?.kind, 'REFERENCE');
  assert.equal(conflict('enterpriseScope')?.kind, 'SCOPE');
  const changes = compare.data.branch.comparison.changes;
  assert.ok(changes.some((row) => row.objectId === mainOnlyOrganizationId && row.field === '$object' && !row.basePresent && row.currentPresent && !row.proposedPresent));
  assert.ok(changes.some((row) => row.objectId === draftOnlyOrganizationId && row.field === '$object' && !row.basePresent && !row.currentPresent && row.proposedPresent));
  assert.ok(compare.data.branch.comparison.relations.currentAdded.length + compare.data.branch.comparison.relations.branchAdded.length > 0);

  const resolutionFor = (projection) => projection.data.branch.comparison.conflicts.map((row) => ({ conflictId: row.conflictId,
    choice: ['name', 'enterpriseScope'].includes(row.field) ? 'branch' : 'current' }));
  const staleBranchSource = branchCommandBody(compare, 'merge-revision-source-is-current', { kind: 'prepare-merge', resolutions: resolutionFor(compare), reason: 'Build the exact three-way candidate.' });
  const unresolved = structuredClone(staleBranchSource);
  unresolved.commandId = 'merge-missing-resolution'; unresolved.payload.resolutions.pop();
  const unresolvedResult = await postCommand(instance.base, 'owner', project.id, unresolved, 409);
  assert.equal(unresolvedResult.error.code, 'ENTERPRISE_MERGE_CONFLICTS');
  const badChoice = structuredClone(staleBranchSource);
  badChoice.commandId = 'merge-invalid-resolution-choice'; badChoice.payload.resolutions[0].choice = 'automatic';
  const badChoiceResult = await postCommand(instance.base, 'owner', project.id, badChoice, 400);
  assert.equal(badChoiceResult.error.code, 'INVALID_ENTERPRISE_BRANCH_COMMAND');

  const planBeforeMerge = await request(instance.base, 'editor', `/api/v1/projects/${project.id}/process-plans`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'plan-main-while-draft-open', expectedVersion: view.data.context.projectVersion,
    payload: { processId: 'process-deliver' },
  } }, 201);
  assert.equal(planBeforeMerge.data.processPlans.at(-1).source.blueprintId, mainScopeChange.data.blueprintId);
  const publicationBeforeMerge = await request(instance.base, 'owner', `/api/v1/projects/${project.id}/blueprint/publications`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'publish-main-while-draft-open', expectedVersion: planBeforeMerge.data.version,
    payload: { blueprintId: planBeforeMerge.data.latestBlueprint.id, blueprintVersion: planBeforeMerge.data.latestBlueprint.version, acknowledgeDisclosures: true },
  } });
  assert.equal(publicationBeforeMerge.data.blueprintPublications.at(-1).blueprintId, mainScopeChange.data.blueprintId);

  const afterPublication = await readBranch('owner', branchId);
  const candidateOne = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(afterPublication, 'prepare-merge-one', { kind: 'prepare-merge', resolutions: resolutionFor(afterPublication), reason: 'Prepare immutable merge candidate one.' }));
  const candidateOneView = await readBranch('owner', branchId);
  assert.equal(candidateOneView.data.branch.candidate.id, candidateOne.data.candidateId);
  assert.equal(candidateOneView.data.branch.candidate.status, 'PENDING');
  assert.equal(candidateOneView.data.branch.candidate.mainBlueprintId, mainScopeChange.data.blueprintId);
  assert.equal(candidateOneView.data.branch.candidate.branchRevision, afterPublication.data.branch.revision);
  const editorReview = await postCommand(instance.base, 'editor', project.id,
    branchCommandBody(candidateOneView, 'editor-review-denied', { kind: 'review-merge', candidateId: candidateOne.data.candidateId,
      candidateHash: candidateOne.data.candidateHash, decision: 'ACCEPT', reason: 'Editor lacks merge review authority.' }), 403);
  assert.equal(editorReview.error.code, 'ACTION_FORBIDDEN');
  const rejected = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(candidateOneView, 'reject-merge-candidate-one', { kind: 'review-merge', candidateId: candidateOne.data.candidateId,
      candidateHash: candidateOne.data.candidateHash, decision: 'REJECT', reason: 'Reject this exact merge candidate.' }));
  assert.equal(rejected.data.candidateId, candidateOne.data.candidateId);
  const rejectedView = await readBranch('owner', branchId);
  assert.equal(rejectedView.data.branch.candidate.status, 'REJECTED');
  const secondDecision = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(rejectedView, 'second-review-is-denied', { kind: 'review-merge', candidateId: candidateOne.data.candidateId,
      candidateHash: candidateOne.data.candidateHash, decision: 'ACCEPT', reason: 'A rejected candidate is immutable.' }), 409);
  assert.equal(secondDecision.error.code, 'ENTERPRISE_MERGE_ALREADY_REVIEWED');
  const rejectedApply = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(rejectedView, 'rejected-merge-cannot-apply', { kind: 'apply-reviewed-merge', candidateId: candidateOne.data.candidateId,
      candidateHash: candidateOne.data.candidateHash, reason: 'A rejected candidate must not apply.' }), 409);
  assert.equal(rejectedApply.error.code, 'ENTERPRISE_MERGE_REVIEW_REQUIRED');

  const mainPlan = items(rejectedView.data.blueprint).find((entry) => entry.id === 'process-deliver');
  const changedBranch = await postCommand(instance.base, 'editor', project.id,
    branchCommandBody(rejectedView, 'revise-branch-after-rejected-candidate', { kind: 'edit-branch-object', edit: {
      objectId: mainPlan.id, name: 'Draft delivery process', detail: 'Draft detail after rejection.', ownerRoleName: role.name,
      trigger: mainPlan.trigger, inputInformationIds: ['information-delivery-result'], outputInformationIds: mainPlan.outputs,
    }, reason: 'A new revision invalidates prior candidate review.' }));
  const changedBranchView = await readBranch('owner', branchId);
  assert.equal(changedBranchView.data.branch.candidate.status, 'STALE');
  const staleReview = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(changedBranchView, 'stale-candidate-review-denied', { kind: 'review-merge', candidateId: candidateOne.data.candidateId,
      candidateHash: candidateOne.data.candidateHash, decision: 'ACCEPT', reason: 'Changed branch revision requires a fresh candidate.' }), 409);
  assert.equal(staleReview.error.code, 'ENTERPRISE_MERGE_STALE');

  const candidateTwo = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(changedBranchView, 'prepare-merge-two', { kind: 'prepare-merge', resolutions: resolutionFor(changedBranchView), reason: 'Prepare candidate after draft revision.' }));
  const candidateTwoView = await readBranch('owner', branchId);
  await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(candidateTwoView, 'review-merge-two', { kind: 'review-merge', candidateId: candidateTwo.data.candidateId,
      candidateHash: candidateTwo.data.candidateHash, decision: 'ACCEPT', reason: 'Review the exact current draft candidate.' }));
  const beforeMainStale = await request(instance.base, 'owner', `/api/v1/projects/${project.id}`);
  const processLearn = items(beforeMainStale.data.latestBlueprint).find((entry) => entry.id === 'process-learn');
  const processLearnRole = items(beforeMainStale.data.latestBlueprint).find((entry) => entry.id === processLearn.owner);
  await request(instance.base, 'owner', `/api/v1/projects/${project.id}/blueprint/edits`, { method: 'POST', body: {
    schemaVersion: '1.0', commandId: 'invalidate-reviewed-main-source', expectedVersion: beforeMainStale.data.version,
    payload: { objectId: processLearn.id, name: 'Updated discovery process', detail: 'Change main after review.',
      ownerRoleName: processLearnRole.name, trigger: processLearn.trigger },
  } });
  const mainChangedBranchView = await readBranch('owner', branchId);
  assert.equal(mainChangedBranchView.data.branch.candidate.status, 'STALE');
  const changedMainApply = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(mainChangedBranchView, 'apply-after-main-change', { kind: 'apply-reviewed-merge', candidateId: candidateTwo.data.candidateId,
      candidateHash: candidateTwo.data.candidateHash, reason: 'The changed main source invalidates this candidate.' }), 409);
  assert.equal(changedMainApply.error.code, 'ENTERPRISE_MERGE_STALE');

  const candidateThree = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(mainChangedBranchView, 'prepare-merge-three', { kind: 'prepare-merge', resolutions: resolutionFor(mainChangedBranchView), reason: 'Prepare after current main changed.' }));
  const candidateThreeView = await readBranch('owner', branchId);
  await postgres.query(`update orgward.project_memberships set access='editor' where tenant_id=$1 and project_id=$2 and principal=$3`,
    [tenantId, project.id, identities.get('owner').principal]);
  await postgres.query(`update orgward.project_memberships set access='owner', generation=generation+1
    where tenant_id=$1 and project_id=$2 and principal=$3`, [tenantId, project.id, reviewer.principal]);
  const reviewerAtApproval = await postgres.query(`select m.generation as membership_generation, p.authz_generation
    from orgward.project_memberships m join orgward.oidc_principals p on p.tenant_id=m.tenant_id and p.principal=m.principal
    where m.tenant_id=$1 and m.project_id=$2 and m.principal=$3`, [tenantId, project.id, reviewer.principal]);
  await postCommand(instance.base, 'branch-reviewer', project.id,
    branchCommandBody(candidateThreeView, 'review-merge-three', { kind: 'review-merge', candidateId: candidateThree.data.candidateId,
      candidateHash: candidateThree.data.candidateHash, decision: 'ACCEPT', reason: 'Accept the current immutable candidate.' }));
  await postgres.query(`update orgward.project_memberships set access='editor', generation=generation+1
    where tenant_id=$1 and project_id=$2 and principal=$3`, [tenantId, project.id, reviewer.principal]);
  await postgres.query(`update orgward.project_memberships set access='owner' where tenant_id=$1 and project_id=$2 and principal=$3`,
    [tenantId, project.id, identities.get('owner').principal]);
  await request(instance.base, 'owner', `/api/v1/projects/${project.id}/members/${reviewer.principal}/revoke`, { method: 'POST', body: {} });
  await request(instance.base, 'owner', `/api/v1/projects/${project.id}/members`, { method: 'POST', body: { principal: reviewer.principal, access: 'editor' } });
  await postgres.query(`update orgward.project_memberships set access='editor' where tenant_id=$1 and project_id=$2 and principal=$3`,
    [tenantId, project.id, identities.get('owner').principal]);
  await postgres.query(`update orgward.project_memberships set access='owner', generation=generation+1
    where tenant_id=$1 and project_id=$2 and principal=$3`, [tenantId, project.id, reviewer.principal]);
  const reviewerAfterRegrant = await postgres.query(`select m.generation as membership_generation, p.authz_generation
    from orgward.project_memberships m join orgward.oidc_principals p on p.tenant_id=m.tenant_id and p.principal=m.principal
    where m.tenant_id=$1 and m.project_id=$2 and m.principal=$3`, [tenantId, project.id, reviewer.principal]);
  assert.ok(Number(reviewerAfterRegrant.rows[0].membership_generation) > Number(reviewerAtApproval.rows[0].membership_generation));
  assert.equal(Number(reviewerAfterRegrant.rows[0].authz_generation), Number(reviewerAtApproval.rows[0].authz_generation),
    'the principal authority generation stays unchanged while project membership is revoked and restored');
  const afterReviewerGenerationChange = await readBranch('owner', branchId);
  const projectBeforeRevokedReviewApply = (await request(instance.base, 'owner', `/api/v1/projects/${project.id}`)).data;
  const revokedReviewerApply = await postCommand(instance.base, 'branch-reviewer', project.id,
    branchCommandBody(afterReviewerGenerationChange, 'regrant-does-not-restore-old-review', { kind: 'apply-reviewed-merge',
      candidateId: candidateThree.data.candidateId, candidateHash: candidateThree.data.candidateHash,
      reason: 'An old approval cannot survive reviewer membership revocation and regrant.' }), 403);
  assert.equal(revokedReviewerApply.error.code, 'ENTERPRISE_MERGE_REVIEW_AUTHORITY_STALE');
  const mainAfterRevokedReviewApply = await readMain();
  assert.equal(mainAfterRevokedReviewApply.data.context.blueprintId, mainChangedBranchView.data.branch.comparison.mainBlueprintId,
    'a revoked approval does not create a main blueprint version');
  assert.equal(mainAfterRevokedReviewApply.data.context.blueprintVersion, mainChangedBranchView.data.branch.comparison.mainBlueprintVersion);
  const projectAfterRevokedReviewApply = (await request(instance.base, 'owner', `/api/v1/projects/${project.id}`)).data;
  assert.equal(projectAfterRevokedReviewApply.version, projectBeforeRevokedReviewApply.version,
    'the denied apply does not append a project command or main revision');
  await postgres.query(`update orgward.project_memberships set access='editor', generation=generation+1
    where tenant_id=$1 and project_id=$2 and principal=$3`, [tenantId, project.id, reviewer.principal]);
  await postgres.query(`update orgward.project_memberships set access='owner' where tenant_id=$1 and project_id=$2 and principal=$3`,
    [tenantId, project.id, identities.get('owner').principal]);

  const candidateFour = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(afterReviewerGenerationChange, 'prepare-merge-four', { kind: 'prepare-merge', resolutions: resolutionFor(afterReviewerGenerationChange), reason: 'Prepare a fresh candidate after reviewer revocation.' }));
  const candidateFourView = await readBranch('owner', branchId);
  await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(candidateFourView, 'review-merge-four', { kind: 'review-merge', candidateId: candidateFour.data.candidateId,
      candidateHash: candidateFour.data.candidateHash, decision: 'ACCEPT', reason: 'Current owner accepts exact candidate.' }));
  const approved = await readBranch('owner', branchId);
  assert.equal(approved.data.branch.candidate.status, 'ACCEPTED');
  const replayBody = branchCommandBody(approved, 'apply-reviewed-merge-four', { kind: 'apply-reviewed-merge',
    candidateId: candidateFour.data.candidateId, candidateHash: candidateFour.data.candidateHash,
    reason: 'Apply the explicitly reviewed candidate to proposed main.' });
  const versionBeforeApply = approved.data.context.projectVersion;
  const currentBeforeApply = await readMain();
  assert.equal(currentBeforeApply.data.context.blueprintId, approved.data.branch.comparison.mainBlueprintId);
  const projectBeforeApply = (await request(instance.base, 'owner', `/api/v1/projects/${project.id}`)).data;
  const applied = await postCommand(instance.base, 'owner', project.id, replayBody);
  assert.notEqual(applied.data.blueprintId, currentBeforeApply.data.context.blueprintId);
  assert.equal(applied.data.blueprintVersion, currentBeforeApply.data.context.blueprintVersion + 1);
  assert.equal(applied.data.projectVersion, versionBeforeApply + 1);
  const appliedReplay = await postCommand(instance.base, 'owner', project.id, replayBody);
  assert.equal(appliedReplay.meta.replayed, true);
  assert.deepEqual(appliedReplay.data, applied.data);
  const mainAfterApply = await readMain();
  assert.equal(mainAfterApply.data.context.blueprintId, applied.data.blueprintId);
  assert.equal(mainAfterApply.data.context.blueprintVersion, applied.data.blueprintVersion);
  assert.equal(mainAfterApply.data.blueprint.epistemicStatus, 'proposed-design');
  const projectAfterApply = (await request(instance.base, 'owner', `/api/v1/projects/${project.id}`)).data;
  assert.equal(projectAfterApply.blueprintPublications.length, projectBeforeApply.blueprintPublications.length,
    'merge does not publish the proposed main blueprint');
  assert.equal(projectAfterApply.processPlans.length, projectBeforeApply.processPlans.length,
    'merge does not create new operational work');
  const mergedProcess = items(mainAfterApply.data.blueprint).find((entry) => entry.id === 'process-deliver');
  assert.equal(mergedProcess.name, 'Draft delivery process');
  assert.deepEqual(mergedProcess.inputs.filter((id) => id.startsWith('information-')), ['information-customer-signal'], 'the explicit current choice wins the reference-array conflict');
  assert.equal(mergedProcess.enterpriseScope.organizationId, draftOrganizationId, 'the explicit draft choice wins the scope conflict');
  const mergedNames = items(mainAfterApply.data.blueprint).map((entry) => entry.name);
  assert.ok(mergedNames.includes('Main-only organization'));
  assert.ok(mergedNames.includes('Draft-only organization'));
  assert.ok(mainAfterApply.data.graph.links.some((link) => link.source === 'process-deliver' && link.target === draftOrganizationId && link.type === 'within-organization'));
  const appliedBranch = await readBranch('owner', branchId);
  assert.equal(appliedBranch.data.branch.status, 'MERGED');
  assert.equal(appliedBranch.data.branch.candidate.status, 'APPLIED');
  assert.equal(appliedBranch.data.permissions.branchWrite, false);
  const historicalDraft = await readBranch('owner', branchId, 1);
  assert.equal(historicalDraft.data.branch.isHead, false);
  assert.equal(historicalDraft.data.permissions.branchWrite, false);

  await closeApp(instance);
  instance = await startApp(postgres, root);
  const afterRestart = await readMain();
  assert.equal(afterRestart.data.context.blueprintId, applied.data.blueprintId);
  const applyReplayAfterRestart = await postCommand(instance.base, 'owner', project.id, replayBody);
  assert.equal(applyReplayAfterRestart.meta.replayed, true);
  assert.deepEqual(applyReplayAfterRestart.data, applied.data);

  const futureBase = await readMain();
  const futureBranchResult = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(futureBase, 'create-future-branch', { kind: 'create-branch', title: 'Future dated branch', reason: 'Keep this work inactive until its date.' }));
  const futureBranchId = futureBranchResult.data.branchId;
  let futureBranch = await readBranch('owner', futureBranchId);
  const futureStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(futureBranch, 'set-future-branch-interval', { kind: 'set-branch-validity', effectiveFrom: futureStart,
      effectiveTo: null, reason: 'Declare a future-only merge interval.' }));
  futureBranch = await readBranch('owner', futureBranchId);
  const futureCandidate = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(futureBranch, 'prepare-future-branch-candidate', { kind: 'prepare-merge', resolutions: [], reason: 'Prepare future-dated branch candidate.' }));
  futureBranch = await readBranch('owner', futureBranchId);
  assert.equal(futureBranch.data.branch.candidate.eligibility.status, 'FUTURE');
  await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(futureBranch, 'review-future-branch-candidate', { kind: 'review-merge', candidateId: futureCandidate.data.candidateId,
      candidateHash: futureCandidate.data.candidateHash, decision: 'ACCEPT', reason: 'Review, but do not activate, future work.' }));
  futureBranch = await readBranch('owner', futureBranchId);
  const futureApply = await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(futureBranch, 'future-branch-cannot-auto-apply', { kind: 'apply-reviewed-merge', candidateId: futureCandidate.data.candidateId,
      candidateHash: futureCandidate.data.candidateHash, reason: 'A future effective date does not authorize activation.' }), 409);
  assert.equal(futureApply.error.code, 'ENTERPRISE_MERGE_NOT_EFFECTIVE');
  const unchangedMain = await readMain();
  assert.equal(unchangedMain.data.context.blueprintId, applied.data.blueprintId);
  futureBranch = await readBranch('owner', futureBranchId);
  await postCommand(instance.base, 'owner', project.id,
    branchCommandBody(futureBranch, 'abandon-future-branch', { kind: 'abandon-branch', reason: 'Abandon the unmerged future branch.' }));
  const abandoned = await readBranch('owner', futureBranchId);
  assert.equal(abandoned.data.branch.status, 'ABANDONED');
  assert.equal(abandoned.data.permissions.branchWrite, false);
});
