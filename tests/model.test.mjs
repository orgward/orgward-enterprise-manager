import assert from 'node:assert/strict';
import test from 'node:test';
import { AREA_DEFINITIONS, addConversationTurn, createProject, editBlueprintObject, editProcessTaskGraph, planProcessTaskGraph, validateBlueprint } from '../src/model.mjs';
import { coverageAreaStateLabel, coverageForBlueprint } from '../public/coverage-dashboard.mjs';
import { compareBlueprintObjectVersions } from '../public/blueprint-comparison.mjs';
import { getOrCreatePlanRevisionCommand, getOrCreateProcessPlanCommand, processPlanCommandKey, processPlanFailureDisposition } from '../public/process-plan-command.mjs';

const ANSWERS = [
  'A repair membership that keeps small restaurant equipment working and reduces emergency downtime.',
  'Independent restaurant owners receive preventive maintenance, rapid triage, and clear repair histories.',
  'Monthly membership plus parts; launch must keep travel time, inventory, and cash exposure low.',
  'A human approves safety-critical repairs and spending. Scheduling and service records can be automated in the studio.',
];

function completeDiscovery() {
  const project = createProject('Service Loop');
  for (const answer of ANSWERS) addConversationTurn(project, answer);
  return project;
}

test('guided chat saves a scoped brief with assumptions and unknowns', () => {
  const project = completeDiscovery();
  assert.equal(project.phase, 'blueprint_ready');
  assert.equal(project.questionIndex, 4);
  assert.equal(project.conversation.filter((message) => message.role === 'user').length, 4);
  assert.match(project.brief.scope, /repair membership/);
  assert.ok(project.brief.assumptions.length >= 3);
  assert.ok(project.brief.unknowns.length >= 3);
  assert.equal(project.audit.at(-1).action, 'blueprint.generated');
});

test('generated blueprint covers every contracted area and retains epistemic metadata', () => {
  const blueprint = completeDiscovery().blueprintVersions[0];
  assert.equal(blueprint.version, 1);
  assert.equal(blueprint.epistemicStatus, 'proposed-design');
  assert.equal(blueprint.summary.areaCount, AREA_DEFINITIONS.length);
  assert.ok(blueprint.summary.objectCount >= 25);
  assert.ok(blueprint.summary.relationCount >= 30);
  for (const [key] of AREA_DEFINITIONS) {
    assert.equal(blueprint.areas[key].status, 'designed');
    assert.ok(blueprint.areas[key].items.length > 0);
    for (const object of blueprint.areas[key].items) {
      assert.ok(object.provenance.length > 0, `${object.id} must have provenance`);
      assert.ok(['low', 'medium', 'high'].includes(object.confidence));
    }
  }
  assert.equal(blueprint.integrity.valid, true);
  assert.equal(blueprint.integrity.errors.length, 0);
  assert.ok(blueprint.integrity.gaps.some((gap) => gap.id === 'gap-market-evidence'));
});

test('integrity checks catch missing areas, dangling links, and incomplete ownership', () => {
  const blueprint = structuredClone(completeDiscovery().blueprintVersions[0]);
  delete blueprint.areas.lifecycle;
  blueprint.relations.push({ id: 'broken-link', source: 'missing-object', target: 'goal-customer-outcome', type: 'owns' });
  const capability = blueprint.areas.capabilitiesProcesses.items.find((object) => object.type === 'capability');
  delete capability.owner;
  const result = validateBlueprint(blueprint);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'AREA_MISSING'));
  assert.ok(result.errors.some((error) => error.code === 'DANGLING_REFERENCE'));
  assert.ok(result.gaps.some((gap) => gap.id === `gap-owner-${capability.id}`));
});

test('coverage dashboard reports proposed scope, unknowns, gaps, confidence and provenance without claiming evidence', () => {
  const blueprint = structuredClone(completeDiscovery().blueprintVersions[0]);
  blueprint.areas.purposeStrategy.status = 'unknown';
  blueprint.areas.lifecycle.status = 'out_of_scope';
  blueprint.areas.customersOfferingsValueEconomics.items[0].status = 'unknown';
  blueprint.integrity.gaps.push({ id: 'gap-example-critical', severity: 'critical', area: 'purposeStrategy', action: 'Confirm the intended strategic scope.' });
  const dashboard = coverageForBlueprint(blueprint);
  assert.equal(dashboard.lenses.length, 6);
  assert.equal(dashboard.areaCounts.designed, 8);
  assert.equal(dashboard.areaCounts.unknown, 1);
  assert.equal(dashboard.areaCounts.outOfScope, 1);
  const commercial = dashboard.lenses.find((lens) => lens.id === 'commercial');
  assert.equal(commercial.unknownAreaCount, 1);
  assert.equal(commercial.highGapCount, 2, 'high and critical integrity gaps are counted as high severity');
  assert.ok(commercial.areas.find((area) => area.key === 'purposeStrategy').gaps.some((gap) => gap.action.includes('Confirm')));
  assert.ok(dashboard.assumptions.length > 0);
  assert.ok(dashboard.unknowns.length > 0);
  assert.ok(dashboard.provenanceCount > 0);
  assert.equal(dashboard.epistemicStatus, 'proposed-design');
  assert.equal(Object.hasOwn(dashboard, 'readinessPercent'), false);
  assert.equal(Object.hasOwn(dashboard, 'verifiedCount'), false);
  assert.equal(Object.hasOwn(dashboard, 'evidenceCount'), false);
  assert.equal(commercial.objectCount, 5, 'the combined value/economics area may be visible in more than one lens');
  assert.ok(commercial.confidence.low + commercial.confidence.medium + commercial.confidence.high > 0);
  const missingAreaBlueprint = structuredClone(blueprint);
  delete missingAreaBlueprint.areas.informationTechnology;
  const missingCoverage = coverageForBlueprint(missingAreaBlueprint);
  assert.equal(missingCoverage.areaCounts.missing, 1);
  const missingArea = missingCoverage.lenses.find((lens) => lens.id === 'technology-information').areas[0];
  assert.equal(missingArea.status, 'unknown');
  assert.equal(coverageAreaStateLabel(missingArea), 'not represented');
});

test('coverage read model follows an edited immutable version and retains proposed epistemic status', () => {
  const project = completeDiscovery();
  const first = coverageForBlueprint(project.blueprintVersions[0]);
  const updated = editBlueprintObject(project, {
    objectId: 'capability-delivery', name: 'Offer delivery', detail: 'Deliver and record the promised result.', ownerRoleName: 'Operations owner',
  }, 'founder');
  const current = coverageForBlueprint(updated);
  assert.equal(first.blueprintVersion, 1);
  assert.equal(current.blueprintVersion, 2);
  assert.equal(current.epistemicStatus, 'proposed-design');
  assert.equal(current.provenanceCount, first.provenanceCount + 1);
  assert.equal(project.blueprintVersions[0].areas.capabilitiesProcesses.items.find((item) => item.id === 'capability-delivery').detail,
    'Reliably create and deliver the promised customer result.');
});

test('saved process planning creates a proposed dependency graph from blueprint links only', () => {
  const project = completeDiscovery();
  const plan = planProcessTaskGraph(project, 'process-deliver', 'founder');
  assert.equal(plan.state, 'planned');
  assert.equal(plan.epistemicStatus, 'proposed-design');
  assert.deepEqual(plan.source, {
    projectId: project.id, blueprintId: project.blueprintVersions[0].id,
    blueprintVersion: 1, processId: 'process-deliver', processName: 'Deliver the core offering',
  });
  assert.deepEqual(plan.tasks.map((task) => task.id), ['task-process-learn', 'task-process-deliver']);
  const root = plan.tasks.at(-1);
  assert.deepEqual(root.dependencies, ['task-process-learn']);
  assert.equal(root.status, 'planned');
  assert.deepEqual(root.inputs.map((item) => item.objectId), ['information-prioritised-need']);
  assert.deepEqual(root.outputs.map((item) => item.objectId), ['information-delivery-result']);
  assert.equal(root.assignee.kind, 'role-reference');
  assert.equal(root.assignee.roleId, 'role-operations');
  assert.equal(root.assignee.state, 'unassigned');
  assert.equal(Object.hasOwn(root.assignee, 'principal'), false);
  assert.equal(Object.hasOwn(plan, 'execution'), false);
  assert.ok(plan.tasks.every((task) => task.status === 'planned'));
  assert.throws(() => planProcessTaskGraph(project, 'not-a-process', 'founder'), { code: 'BLUEPRINT_PROCESS_NOT_FOUND' });
});

test('planned graph edits append immutable revisions and reject bad references, cycles and bounds', () => {
  const project = completeDiscovery();
  const original = planProcessTaskGraph(project, 'process-deliver', 'founder');
  project.processPlans = [original];
  const edits = original.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail,
    dependencies: [...task.dependencies], roleId: task.assignee.roleId ?? null, actorId: null,
  }));
  edits[1].title = 'Coordinate and record delivery';
  edits[1].detail = 'Coordinate delivery and record its result.';
  edits[1].roleId = 'role-founder';
  edits[1].actorId = 'actor-founder';
  const revision = editProcessTaskGraph(project, original.id, { tasks: edits }, 'founder');
  assert.equal(revision.revision, 2);
  assert.equal(revision.state, 'planned');
  assert.ok(revision.tasks.every((task) => task.status === 'planned'));
  assert.equal(revision.tasks[1].title, 'Coordinate and record delivery');
  assert.deepEqual(revision.tasks[1].assignee, { kind: 'blueprint-actor', actorId: 'actor-founder', roleId: 'role-founder' });
  assert.deepEqual(revision.tasks[1].inputs, original.tasks[1].inputs);
  assert.deepEqual(revision.tasks[1].outputs, original.tasks[1].outputs);
  assert.equal(original.revision, 1);
  assert.equal(original.tasks[1].title, 'Deliver the core offering');

  const currentEdits = revision.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail,
    dependencies: [...task.dependencies], roleId: task.assignee.roleId ?? null,
    actorId: task.assignee.actorId ?? null,
  }));
  const cycle = structuredClone(currentEdits);
  cycle[0].dependencies = [cycle[1].taskId];
  cycle[1].dependencies = [cycle[0].taskId];
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: cycle }, 'founder'), { code: 'PROCESS_GRAPH_CYCLE' });
  const selfDependency = structuredClone(currentEdits);
  selfDependency[0].dependencies = [selfDependency[0].taskId];
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: selfDependency }, 'founder'), { code: 'INVALID_PROCESS_PLAN_DEPENDENCY' });
  const missingDependency = structuredClone(currentEdits);
  missingDependency[0].dependencies = ['task-missing'];
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: missingDependency }, 'founder'), { code: 'INVALID_PROCESS_PLAN_DEPENDENCY' });
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: currentEdits.slice(1) }, 'founder'), { code: 'INVALID_PROCESS_PLAN_EDIT' });
  const invalidRole = structuredClone(currentEdits);
  invalidRole[0].roleId = 'role-outside-blueprint';
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: invalidRole }, 'founder'), { code: 'INVALID_PROCESS_PLAN_ROLE' });
  const mismatchedActor = structuredClone(currentEdits);
  mismatchedActor[1].roleId = 'role-operations';
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: mismatchedActor }, 'founder'), { code: 'INVALID_PROCESS_PLAN_ACTOR_ROLE' });
  const oversized = structuredClone(currentEdits);
  oversized[0].title = 'x'.repeat(121);
  assert.throws(() => editProcessTaskGraph(project, original.id, { tasks: oversized }, 'founder'), { code: 'INVALID_PROCESS_PLAN_TEXT' });
  const badReference = structuredClone(project);
  badReference.processPlans.at(-1).tasks[0].inputs[0].label = 'Forged input';
  assert.throws(() => editProcessTaskGraph(badReference, original.id, { tasks: currentEdits }, 'founder'), { code: 'INVALID_PROCESS_PLAN_REFERENCE' });
  assert.equal(project.processPlans.length, 2, 'failed edits do not append revisions');
});

test('uncertain process-plan save retries reuse the command by project and process', () => {
  const pending = new Map();
  let generated = 0;
  const createId = () => `plan-${++generated}`;
  const first = getOrCreateProcessPlanCommand(pending, 'project-a', 'process-deliver', { version: 4 }, createId);
  assert.equal(first.commandId, 'plan-1');
  assert.equal(first.expectedVersion, 4);
  assert.equal(processPlanFailureDisposition(new Error('socket closed')), 'retry');
  const retry = getOrCreateProcessPlanCommand(pending, 'project-a', 'process-deliver', { version: 5 }, createId);
  assert.equal(retry, first);
  assert.equal(retry.commandId, 'plan-1');
  assert.equal(retry.expectedVersion, 4, 'retry keeps the exact submitted expectedVersion');
  const anotherProject = getOrCreateProcessPlanCommand(pending, 'project-b', 'process-deliver', { version: 1 }, createId);
  const anotherProcess = getOrCreateProcessPlanCommand(pending, 'project-a', 'process-review', { version: 4 }, createId);
  assert.notEqual(anotherProject.commandId, first.commandId);
  assert.notEqual(anotherProcess.commandId, first.commandId);
  assert.equal(pending.has(processPlanCommandKey('project-a', 'process-deliver')), true);
  const revisionPayload = { tasks: [{ taskId: 'task-process-deliver', title: 'Review' }] };
  const revision = getOrCreatePlanRevisionCommand(pending, 'project-a', 'process-plan-a', { version: 8 }, revisionPayload, createId);
  revisionPayload.tasks[0].title = 'Changed after submit';
  const revisionRetry = getOrCreatePlanRevisionCommand(pending, 'project-a', 'process-plan-a', { version: 9 }, revisionPayload, createId);
  assert.equal(revisionRetry, revision);
  assert.equal(revisionRetry.expectedVersion, 8);
  assert.equal(revisionRetry.payload.tasks[0].title, 'Review');
  assert.equal(processPlanFailureDisposition({ status: 409, code: 'VERSION_CONFLICT' }), 'reload');
  assert.equal(processPlanFailureDisposition({ status: 400, code: 'BLUEPRINT_PROCESS_NOT_FOUND' }), 'reload');
  assert.equal(processPlanFailureDisposition({ status: 409, code: 'PROCESS_GRAPH_CYCLE', message: 'Cycle.' }), 'discard');
  assert.equal(processPlanFailureDisposition({ status: 429, retryable: true }), 'retry');
  assert.equal(processPlanFailureDisposition({ status: 400 }), 'discard');
});

test('role edits version proposed scope separately and migrate only valid legacy decision links', () => {
  const project = completeDiscovery();
  const original = project.blueprintVersions[0];
  const founder = original.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  assert.ok(founder.proposedScopeStatements.length > 0);
  assert.equal(Object.hasOwn(founder, 'authority'), false);
  const legacy = structuredClone(original);
  const legacyFounder = legacy.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  delete legacyFounder.proposedScopeStatements;
  legacyFounder.authority = ['Recommend a weekly review', 'decision-priority', 'decision-does-not-exist'];
  delete legacyFounder.decisionIds;
  delete legacyFounder.proposedToolStatements;
  delete legacyFounder.proposedEscalationRules;
  project.blueprintVersions[0] = legacy;
  const next = editBlueprintObject(project, {
    objectId: 'role-founder', name: legacyFounder.name, detail: legacyFounder.detail,
    proposedInstructions: 'Keep recommendations reviewable and proposed.',
    proposedScopeStatements: ['Recommend a weekly review', 'Record risks for human review'],
    proposedToolStatements: ['Coverage map', 'Version history'],
    proposedEscalationRules: ['Escalate critical risk to a human owner'],
  }, 'founder');
  const edited = next.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  assert.deepEqual(edited.proposedScopeStatements, ['Recommend a weekly review', 'Record risks for human review']);
  assert.deepEqual(edited.proposedToolStatements, ['Coverage map', 'Version history']);
  assert.deepEqual(edited.proposedEscalationRules, ['Escalate critical risk to a human owner']);
  assert.deepEqual(edited.decisionIds, ['decision-priority']);
  assert.equal(Object.hasOwn(edited, 'authority'), false);
  assert.ok(next.relations.some((relation) => relation.source === 'decision-priority' && relation.target === 'role-founder'));
  assert.equal(next.relations.some((relation) => relation.source === 'decision-does-not-exist'), false);
  assert.equal(legacyFounder.authority[0], 'Recommend a weekly review', 'the prior immutable version keeps its legacy payload');
  assert.equal(Object.hasOwn(legacyFounder, 'proposedToolStatements'), false, 'a legacy version remains without newly introduced metadata');
  assert.equal(next.epistemicStatus, 'proposed-design');
  assert.equal(edited.status, 'designed', 'proposed text does not alter model status or grant execution permissions');
  assert.deepEqual(next.edit.before.proposedScopeStatements, ['Recommend a weekly review']);
  assert.deepEqual(next.edit.after.proposedScopeStatements, ['Recommend a weekly review', 'Record risks for human review']);
  assert.deepEqual(next.edit.before.proposedToolStatements, []);
  assert.deepEqual(next.edit.after.proposedToolStatements, ['Coverage map', 'Version history']);
  assert.deepEqual(next.edit.before.proposedEscalationRules, []);
  assert.deepEqual(next.edit.after.proposedEscalationRules, ['Escalate critical risk to a human owner']);
  assert.throws(() => editBlueprintObject(project, {
    objectId: 'role-founder', name: edited.name, detail: edited.detail,
    proposedInstructions: edited.proposedInstructions, proposedScopeStatements: edited.proposedScopeStatements,
    authority: ['decision-priority'],
  }, 'founder'), /fields that do not apply/);
  assert.throws(() => editBlueprintObject(project, {
    objectId: 'role-founder', name: edited.name, detail: edited.detail,
    proposedInstructions: edited.proposedInstructions, proposedScopeStatements: edited.proposedScopeStatements,
    proposedToolStatements: Array.from({ length: 13 }, (_, index) => `Tool ${index}`),
  }, 'founder'), /up to 12 proposed tool statements/);
  assert.throws(() => editBlueprintObject(project, {
    objectId: 'role-founder', name: edited.name, detail: edited.detail,
    proposedInstructions: edited.proposedInstructions, proposedScopeStatements: edited.proposedScopeStatements,
    proposedEscalationRules: Array.from({ length: 13 }, (_, index) => `Rule ${index}`),
  }, 'founder'), /up to 12 proposed escalation rules/);
});

test('saved blueprint object comparison reports field and link deltas without exposing non-blueprint metadata', () => {
  const project = completeDiscovery();
  const original = project.blueprintVersions[0];
  const selected = original.areas.capabilitiesProcesses.items.find((item) => item.id === 'capability-delivery');
  const previousName = selected.name;
  selected.internalIdentityBinding = { principal: 'restricted-principal', label: 'Restricted person' };
  const next = editBlueprintObject(project, {
    objectId: selected.id, name: 'Partner service delivery', detail: 'Coordinate reliable repair service and record outcomes.',
    ownerRoleName: 'Founder / enterprise owner',
  }, 'founder');
  const comparison = compareBlueprintObjectVersions(project.blueprintVersions, selected.id, 1, 2);
  assert.equal(comparison.fromExists, true);
  assert.equal(comparison.toExists, true);
  assert.equal(comparison.fromEpistemicStatus, 'proposed-design');
  assert.deepEqual(comparison.fields.map((change) => change.field), ['name', 'detail']);
  assert.ok(comparison.linksAdded.some((link) => link.includes('Founder / enterprise owner owns Partner service delivery')));
  assert.ok(comparison.linksRemoved.some((link) => link.includes(`Operations owner owns ${previousName}`)));
  assert.equal(JSON.stringify(comparison).includes('restricted-principal'), false);
  assert.equal(JSON.stringify(comparison).includes('Restricted person'), false);

  const renamedRelated = structuredClone(next);
  renamedRelated.version = 3;
  renamedRelated.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder').name = 'Enterprise sponsor';
  project.blueprintVersions.push(renamedRelated);
  const renameComparison = compareBlueprintObjectVersions(project.blueprintVersions, selected.id, 2, 3);
  assert.deepEqual(renameComparison.linksAdded, []);
  assert.deepEqual(renameComparison.linksRemoved, [], 'renaming a connected object keeps the relationship identity stable');

  const missingFrom = structuredClone(project.blueprintVersions[0]);
  missingFrom.areas.capabilitiesProcesses.items = missingFrom.areas.capabilitiesProcesses.items.filter((item) => item.id !== selected.id);
  project.blueprintVersions[0] = missingFrom;
  const absentAtStart = compareBlueprintObjectVersions(project.blueprintVersions, selected.id, 1, 2);
  assert.equal(absentAtStart.fromExists, false);
  assert.equal(absentAtStart.toExists, true);
  const missingTo = structuredClone(next);
  missingTo.version = 4;
  missingTo.areas.capabilitiesProcesses.items = missingTo.areas.capabilitiesProcesses.items.filter((item) => item.id !== selected.id);
  project.blueprintVersions.push(missingTo);
  const absentAtEnd = compareBlueprintObjectVersions(project.blueprintVersions, selected.id, 3, 4);
  assert.equal(absentAtEnd.fromExists, true);
  assert.equal(absentAtEnd.toExists, false);
  assert.ok(absentAtEnd.linksRemoved.length > 0, 'links from the represented version are shown as removed when the object is absent later');
});

test('blueprint comparison normalizes absent optional role proposals on older versions', () => {
  const project = completeDiscovery();
  const legacy = structuredClone(project.blueprintVersions[0]);
  const role = legacy.areas.responsibilityAuthority.items.find((item) => item.id === 'role-founder');
  delete role.proposedInstructions;
  delete role.proposedToolStatements;
  delete role.proposedEscalationRules;
  project.blueprintVersions[0] = legacy;
  const current = structuredClone(legacy);
  current.version = 2;
  const currentRole = current.areas.responsibilityAuthority.items.find((item) => item.id === role.id);
  currentRole.proposedInstructions = '';
  currentRole.proposedToolStatements = [];
  currentRole.proposedEscalationRules = [];
  project.blueprintVersions.push(current);
  const comparison = compareBlueprintObjectVersions(project.blueprintVersions, role.id, 1, 2);
  assert.equal(comparison.fields.some((change) => ['proposedInstructions', 'proposedToolStatements', 'proposedEscalationRules'].includes(change.field)), false);
});
