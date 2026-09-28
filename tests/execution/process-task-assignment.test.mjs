import assert from 'node:assert/strict';
import test from 'node:test';
import { processTaskAssignmentTransparency } from '../../public/process-task-assignment.mjs';

const role = (overrides = {}) => ({ id: 'role-ops', type: 'role', name: 'Operations owner',
  detail: 'Own repeatable service delivery.', responsibilities: ['cap-delivery'],
  proposedInstructions: 'Review each saved outcome.',
  proposedScopeStatements: ['Sequence internal delivery'],
  proposedToolStatements: ['Delivery plan editor'],
  proposedEscalationRules: ['Escalate safety concerns to the owner'], ...overrides });

const projectWith = (actor = { id: 'actor-ops', type: 'actor-human', name: 'Morgan' }, selectedRole = role(), latestVersion = 7) => ({
  id: 'project-1', blueprintVersions: [
    { id: 'blueprint-1', version: 7, areas: { roles: { items: [selectedRole] }, people: { items: [actor] },
      capabilities: { items: [{ id: 'cap-delivery', type: 'capability', name: 'Service delivery' }] } } },
  ], latestBlueprint: { version: latestVersion },
});

const plan = { source: { projectId: 'project-1', blueprintId: 'blueprint-1', blueprintVersion: 7 } };
const taskFor = (actorId = 'actor-ops', roleId = 'role-ops') => ({ assignee: { kind: 'blueprint-actor', actorId, roleId } });
const enabledHumanBinding = { blueprintVersion: 7, actorId: 'actor-ops', roleId: 'role-ops', status: 'enabled',
  eligibilityStatus: ['eligible'], targetType: 'human', targetName: 'Morgan Example' };

test('collapsed assignment summary separates planned actor selection from enabled target resolution', () => {
  const selected = processTaskAssignmentTransparency({ task: taskFor(), plan, project: projectWith(),
    bindings: [enabledHumanBinding], bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.equal(selected.disclosureSummary, 'Planned actor specified · Enabled target resolved');
  assert.equal(selected.disclosureSummary.includes('Morgan Example'), false);

  const stale = processTaskAssignmentTransparency({ task: taskFor(), plan, project: projectWith(),
    bindings: [{ ...enabledHumanBinding, eligibilityStatus: ['stale_blueprint'], targetName: 'Stale target canary' }],
    bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.equal(stale.disclosureSummary, 'Planned actor specified · Enabled target unresolved');

  const unavailable = processTaskAssignmentTransparency({ task: taskFor(), plan, project: projectWith(),
    bindings: [enabledHumanBinding], bindingProjectId: 'project-1', bindingReadAvailable: false });
  assert.equal(unavailable.disclosureSummary, 'Planned actor specified · Enabled target unresolved');

  const unselected = processTaskAssignmentTransparency({
    task: { assignee: { kind: 'role-reference', roleId: 'role-ops', state: 'unassigned' } }, plan,
    project: projectWith(), bindings: [enabledHumanBinding], bindingProjectId: 'project-1', bindingReadAvailable: true,
  });
  assert.equal(unselected.disclosureSummary, 'Planned actor unresolved · Enabled target unresolved');
});

test('pinned human assignment presents proposed role guidance and a truthful checkpoint boundary', () => {
  const view = processTaskAssignmentTransparency({ task: taskFor(), plan, project: projectWith(),
    bindings: [enabledHumanBinding], bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.equal(view.roleName, 'Operations owner');
  assert.equal(view.guidanceLabel, 'Proposed blueprint role guidance · not enabled authority or tools');
  assert.deepEqual(view.responsibility, ['Own repeatable service delivery.', 'Service delivery']);
  assert.deepEqual(view.scopeAndAuthority, ['Sequence internal delivery']);
  assert.deepEqual(view.instructions, ['Review each saved outcome.']);
  assert.deepEqual(view.tools, ['Delivery plan editor']);
  assert.deepEqual(view.escalationRules, ['Escalate safety concerns to the owner']);
  assert.equal(view.assignee, 'Morgan · human');
  assert.equal(view.organizationalTarget, 'Morgan Example');
  assert.match(view.permissionBoundary, /Only the enabled bound human identity/);
});

test('pinned agent assignment labels proposed tools and separates workload binding from execution authority', () => {
  const project = projectWith({ id: 'actor-ops', type: 'actor-agent', name: 'Delivery agent' });
  const view = processTaskAssignmentTransparency({ task: taskFor(), plan, project,
    bindings: [{ ...enabledHumanBinding, targetType: 'workload', targetName: 'Ops workload' }],
    bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.equal(view.assignee, 'Delivery agent · agent');
  assert.equal(view.organizationalTarget, 'Ops workload');
  assert.match(view.guidanceLabel, /Proposed/);
  assert.deepEqual(view.tools, ['Delivery plan editor']);
  assert.match(view.permissionBoundary, /does not grant or impersonate execution authority/);
  assert.match(view.permissionBoundary, /only after separate approval/);
});

test('missing role guidance is explicit and unresolved assignments do not disclose stale target names', () => {
  const project = projectWith({ id: 'actor-ops', type: 'actor-agent', name: 'Delivery agent' }, role({
    detail: '', responsibilities: [], proposedInstructions: '', proposedScopeStatements: [],
    proposedToolStatements: [], proposedEscalationRules: [],
  }));
  const view = processTaskAssignmentTransparency({ task: taskFor(), plan, project,
    bindings: [{ ...enabledHumanBinding, status: 'proposed', targetName: 'Do not show this name' }],
    bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.deepEqual(view.responsibility, ['Not specified']);
  assert.deepEqual(view.scopeAndAuthority, ['Not specified']);
  assert.deepEqual(view.instructions, ['Not specified']);
  assert.deepEqual(view.tools, ['Not specified']);
  assert.deepEqual(view.escalationRules, ['Not specified']);
  assert.equal(view.organizationalTarget, 'Unresolved');
  assert.equal(JSON.stringify(view).includes('Do not show this name'), false);
});

test('stale pinned binding stays unresolved while guidance comes from the old pinned blueprint', () => {
  const old = projectWith({ id: 'actor-ops', type: 'actor-agent', name: 'Older agent' });
  old.blueprintVersions.unshift({ ...old.blueprintVersions[0], id: 'blueprint-old', version: 6,
    areas: { ...old.blueprintVersions[0].areas, roles: { items: [role({ detail: 'Pinned old responsibility.' })] } } });
  const oldPlan = { source: { projectId: 'project-1', blueprintId: 'blueprint-old', blueprintVersion: 6 } };
  const view = processTaskAssignmentTransparency({ task: taskFor(), plan: oldPlan, project: old,
    bindings: [{ ...enabledHumanBinding, blueprintVersion: 6, eligibilityStatus: ['stale_blueprint'], targetName: 'Stale target' }],
    bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.equal(view.responsibility[0], 'Pinned old responsibility.');
  assert.equal(view.organizationalTarget, 'Unresolved');
  assert.equal(view.assignee, 'Older agent · agent');
});

test('binding identity type must match the pinned human or agent actor', () => {
  const view = processTaskAssignmentTransparency({ task: taskFor(), plan, project: projectWith(),
    bindings: [{ ...enabledHumanBinding, targetType: 'workload', targetName: 'Mismatched workload' }],
    bindingProjectId: 'project-1', bindingReadAvailable: true });
  assert.equal(view.organizationalTarget, 'Unresolved');
});

test('role reference without a selected actor shows pinned role guidance but keeps assignee and enabled target unresolved', () => {
  const view = processTaskAssignmentTransparency({
    task: { assignee: { kind: 'role-reference', roleId: 'role-ops', roleName: 'Operations owner', state: 'unassigned' } },
    plan,
    project: projectWith(),
    bindings: [{ ...enabledHumanBinding, targetName: 'Enabled identity canary' }],
    bindingProjectId: 'project-1', bindingReadAvailable: true,
  });

  assert.equal(view.pinnedBlueprintAvailable, true);
  assert.equal(view.roleName, 'Operations owner');
  assert.equal(view.responsibility[0], 'Own repeatable service delivery.');
  assert.deepEqual(view.scopeAndAuthority, ['Sequence internal delivery']);
  assert.equal(view.assignee, 'Not specified');
  assert.equal(view.organizationalTarget, 'Unresolved');
  assert.match(view.permissionBoundary, /no resolved human or agent execution target/);
  assert.equal(JSON.stringify(view).includes('Enabled identity canary'), false);
});
