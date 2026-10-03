import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { addConversationTurn, createProject } from '../../src/model.mjs';
import { contentHash } from '../../src/platform/postgres.mjs';
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
async function postCommand(base, subject, projectId, body, status = 200) {
  return request(base, subject, `/api/v1/projects/${projectId}/enterprise/commands`, { method: 'POST', body }, status);
}
function items(blueprint) { return Object.values(blueprint.areas).flatMap((area) => area.items); }

test('enterprise scopes retain design identity across sixteen lenses, commands, history, and restart', async (t) => {
  const postgres = await startPostgres();
  t.after(() => postgres.close());
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-enterprise-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let instance = await startApp(postgres, root);
  t.after(async () => closeApp(instance));
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
  assert.deepEqual(ownerView.data.permissions, { write: true, scopeAdmin: true });
  assert.deepEqual(editorView.data.permissions, { write: true, scopeAdmin: false });
  assert.deepEqual(readerView.data.permissions, { write: false, scopeAdmin: false });
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
