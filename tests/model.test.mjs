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

test('blueprint owner changes require one unique proposed role and retain prior versions', () => {
  const project = completeDiscovery();
  const first = project.blueprintVersions[0];
  const goal = first.areas.purposeStrategy.items.find((item) => item.id === 'goal-customer-outcome');
  const updated = editBlueprintObject(project, {
    objectId: goal.id, name: goal.name, detail: goal.detail, ownerRoleName: 'Operations owner',
  }, 'founder');
  const editedGoal = updated.areas.purposeStrategy.items.find((item) => item.id === goal.id);
  assert.equal(editedGoal.owner, 'role-operations', 'the blueprint stores the role reference, not a principal identity');
  assert.ok(updated.relations.some((relation) => relation.source === 'role-operations' && relation.target === goal.id && relation.type === 'owns'));
  assert.equal(updated.relations.some((relation) => relation.source === 'role-founder' && relation.target === goal.id && relation.type === 'owns'), false);
  assert.equal(updated.edit.before.ownerRoleName, 'Founder / enterprise owner');
  assert.equal(updated.edit.after.ownerRoleName, 'Operations owner');
  assert.ok(updated.edit.changedFields.includes('ownerRoleName'));
  assert.equal(first.areas.purposeStrategy.items.find((item) => item.id === goal.id).owner, 'role-founder');

  const ambiguousProject = completeDiscovery();
  const roles = ambiguousProject.blueprintVersions[0].areas.responsibilityAuthority.items;
  const duplicate = structuredClone(roles.find((item) => item.id === 'role-operations'));
  duplicate.id = 'role-operations-duplicate';
  duplicate.name = 'Founder / enterprise owner';
  roles.push(duplicate);
  assert.throws(() => editBlueprintObject(ambiguousProject, {
    objectId: 'goal-customer-outcome', name: 'A different goal', detail: 'Keep accountability unambiguous.',
    ownerRoleName: 'Founder / enterprise owner',
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
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

test('a required human checkpoint is inserted as a distinct pinned graph task before its target', () => {
  const project = completeDiscovery();
  const original = planProcessTaskGraph(project, 'process-deliver', 'founder');
  project.processPlans = [original];
  const payload = { tasks: original.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail, dependencies: [...task.dependencies],
    roleId: task.assignee.roleId ?? null, actorId: null,
  })), humanCheckpoint: {
    beforeTaskId: 'task-process-deliver', title: 'Approve repair scope',
    detail: 'A bound human verifies the repair scope before delivery.', roleId: 'role-founder', actorId: 'actor-founder',
  } };
  const revision = editProcessTaskGraph(project, original.id, payload, 'founder');
  const checkpoint = revision.tasks.find((task) => task.id !== 'task-process-learn' && task.id !== 'task-process-deliver');
  const target = revision.tasks.find((task) => task.id === 'task-process-deliver');
  assert.equal(revision.revision, 2);
  assert.equal(revision.tasks.length, original.tasks.length + 1);
  assert.match(checkpoint.id, /^task-human-checkpoint-/);
  assert.equal(checkpoint.sourceProcessId, target.sourceProcessId);
  assert.deepEqual(checkpoint.dependencies, ['task-process-learn']);
  assert.deepEqual(target.dependencies, [checkpoint.id]);
  assert.deepEqual(checkpoint.inputs, target.inputs);
  assert.deepEqual(checkpoint.outputs, target.outputs);
  assert.deepEqual(checkpoint.assignee, { kind: 'blueprint-actor', actorId: 'actor-founder', roleId: 'role-founder' });
  assert.deepEqual(original.tasks.at(-1).dependencies, ['task-process-learn']);
  assert.equal(new Set(revision.changedTasks).size, revision.changedTasks.length, 'a changed target appears only once');
  assert.ok(revision.changedTasks.includes(checkpoint.id));
  assert.ok(revision.changedTasks.includes(target.id));
  const currentEdits = revision.tasks.map((task) => ({
    taskId: task.id, title: task.title, detail: task.detail, dependencies: [...task.dependencies],
    roleId: task.assignee.roleId ?? null, actorId: task.assignee.actorId ?? null,
  }));
  const badActor = { tasks: structuredClone(currentEdits) };
  badActor.tasks.find((task) => task.taskId === checkpoint.id).actorId = 'actor-design-assistant';
  assert.throws(() => editProcessTaskGraph(project, original.id, badActor, 'founder'), { code: 'INVALID_PROCESS_PLAN_ACTOR_ROLE' });
  const cycle = { tasks: structuredClone(currentEdits) };
  cycle.tasks.find((task) => task.taskId === 'task-process-learn').dependencies = ['task-process-deliver'];
  assert.throws(() => editProcessTaskGraph(project, original.id, cycle, 'founder'), { code: 'PROCESS_GRAPH_CYCLE' });
  const unknownField = structuredClone(payload);
  unknownField.tasks = structuredClone(currentEdits);
  unknownField.humanCheckpoint.authority = 'owner';
  assert.throws(() => editProcessTaskGraph(project, original.id, unknownField, 'founder'), { code: 'INVALID_PROCESS_PLAN_CHECKPOINT' });
  assert.equal(project.processPlans.length, 2, 'invalid insertions do not append revisions');
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

test('process dependency edits replace typed resource and system refs and report names', () => {
  const project = completeDiscovery();
  const blueprint = project.blueprintVersions[0];
  const objects = Object.values(blueprint.areas).flatMap((area) => area.items);
  const process = objects.find((item) => item.id === 'process-learn');
  const resources = objects.filter((item) => item.type === 'resource');
  const systems = objects.filter((item) => item.type === 'system');
  const owner = objects.find((item) => item.id === process.owner);
  const originalInputs = [...process.inputs];
  const originalOutputs = [...process.outputs];
  process.resources = [...(process.resources ?? []), systems[0].id];
  process.systems = [...(process.systems ?? []), resources[0].id];
  const next = editBlueprintObject(project, {
    objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, resourceIds: [resources.at(-1).id], systemIds: [systems.at(-1).id],
  }, 'founder');
  const edited = Object.values(next.areas).flatMap((area) => area.items).find((item) => item.id === process.id);
  assert.deepEqual(edited.resources, [systems[0].id, resources.at(-1).id]);
  assert.deepEqual(edited.systems, [resources[0].id, systems.at(-1).id]);
  assert.deepEqual(edited.inputs, originalInputs);
  assert.deepEqual(edited.outputs, originalOutputs);
  assert.deepEqual(next.edit.before.resourceNames, ['Founder attention']);
  assert.deepEqual(next.edit.after.resourceNames, [resources.at(-1).name]);
  assert.deepEqual(next.edit.before.systemNames, ['OrgWard Enterprise Studio']);
  assert.deepEqual(next.edit.after.systemNames, [systems.at(-1).name]);
  assert.ok(next.relations.some((link) => link.source === resources.at(-1).id && link.target === process.id && link.type === 'resources'));
  assert.ok(next.relations.some((link) => link.source === systems.at(-1).id && link.target === process.id && link.type === 'supports'));
  assert.equal(next.relations.filter((link) => link.source === systems.at(-1).id && link.target === process.id && link.type === 'supports').length, 1);
  const removedSystem = editBlueprintObject(project, {
    objectId: process.id, name: 'Discover and qualify demand without a linked system', detail: process.detail,
    ownerRoleName: owner.name, trigger: process.trigger, systemIds: [],
  }, 'founder');
  const remainingSystem = Object.values(removedSystem.areas).flatMap((area) => area.items).find((item) => item.id === systems.at(-1).id);
  assert.ok(!remainingSystem.supports.includes(process.id));
  assert.ok(remainingSystem.supports.includes('process-deliver'));
  assert.ok(remainingSystem.supports.includes('process-review'));
  assert.ok(!removedSystem.relations.some((link) => link.source === systems.at(-1).id && link.target === process.id && link.type === 'supports'));
  assert.equal(removedSystem.relations.filter((link) => link.source === systems.at(-1).id && link.target === 'process-deliver' && link.type === 'supports').length, 1);
  assert.throws(() => editBlueprintObject(project, {
    objectId: process.id, name: 'Changed process', detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, resourceIds: [resources[0].id, resources[0].id],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: process.id, name: 'Changed process', detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, systemIds: [resources[0].id],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: process.id, name: 'Changed process', detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, resourceIds: ['resource-missing'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
});

test('process capability edits synchronize reverse realisers, preserve other processes, and record names', () => {
  const project = completeDiscovery();
  const blueprint = project.blueprintVersions[0];
  const objects = Object.values(blueprint.areas).flatMap((area) => area.items);
  const process = objects.find((item) => item.id === 'process-learn');
  const owner = objects.find((item) => item.id === process.owner);
  const beforeCapability = objects.find((item) => item.id === process.capability);
  const targetCapability = objects.find((item) => item.id === 'capability-steering');
  const originalInputs = [...process.inputs];
  const originalOutputs = [...process.outputs];
  const next = editBlueprintObject(project, {
    objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, capabilityId: targetCapability.id,
  }, 'founder');
  const nextObjects = Object.values(next.areas).flatMap((area) => area.items);
  const edited = nextObjects.find((item) => item.id === process.id);
  assert.equal(edited.capability, targetCapability.id);
  assert.ok(!nextObjects.find((item) => item.id === beforeCapability.id).realisers.includes(process.id));
  assert.ok(nextObjects.find((item) => item.id === targetCapability.id).realisers.includes('process-review'));
  assert.ok(nextObjects.find((item) => item.id === targetCapability.id).realisers.includes(process.id));
  assert.deepEqual(edited.inputs, originalInputs);
  assert.deepEqual(edited.outputs, originalOutputs);
  assert.deepEqual(next.edit.before.capabilityName, beforeCapability.name);
  assert.deepEqual(next.edit.after.capabilityName, targetCapability.name);
  assert.equal(next.relations.filter((link) => link.source === process.id && link.target === targetCapability.id && link.type === 'realises').length, 1);
  const cleared = editBlueprintObject(project, {
    objectId: process.id, name: 'Discover and qualify demand without a capability link', detail: process.detail,
    ownerRoleName: owner.name, trigger: process.trigger, capabilityId: null,
  }, 'founder');
  const clearedObjects = Object.values(cleared.areas).flatMap((area) => area.items);
  assert.equal(clearedObjects.find((item) => item.id === process.id).capability, null);
  assert.deepEqual(clearedObjects.find((item) => item.id === targetCapability.id).realisers, ['process-review']);
  assert.ok(!cleared.relations.some((link) => link.source === process.id && link.target === targetCapability.id && link.type === 'realises'));
  assert.throws(() => editBlueprintObject(project, {
    objectId: process.id, name: 'Changed process', detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, capabilityId: 'capability-missing',
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: process.id, name: 'Changed process', detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, capabilityId: 'resource-founder-time',
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
});

test('process decision inputs and outputs are separate from information flow and retain other links', () => {
  const project = completeDiscovery();
  const blueprint = project.blueprintVersions[0];
  const objects = Object.values(blueprint.areas).flatMap((area) => area.items);
  const process = objects.find((item) => item.id === 'process-review');
  const owner = objects.find((item) => item.id === process.owner);
  const decision = objects.find((item) => item.id === 'decision-priority');
  const next = editBlueprintObject(project, {
    objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, inputDecisionIds: [decision.id], outputDecisionIds: [],
  }, 'founder');
  const edited = Object.values(next.areas).flatMap((area) => area.items).find((item) => item.id === process.id);
  assert.deepEqual(edited.inputs, ['information-delivery-result', decision.id]);
  assert.deepEqual(edited.outputs, []);
  assert.deepEqual(next.edit.before.inputDecisionNames, []);
  assert.deepEqual(next.edit.after.inputDecisionNames, [decision.name]);
  assert.deepEqual(next.edit.before.outputDecisionNames, [decision.name]);
  assert.deepEqual(next.edit.after.outputDecisionNames, []);
  assert.ok(next.relations.some((link) => link.source === decision.id && link.target === process.id && link.type === 'input-to'));
  assert.ok(!next.relations.some((link) => link.source === process.id && link.target === decision.id && link.type === 'produces'));
  assert.ok(next.relations.some((link) => link.source === 'information-delivery-result' && link.target === process.id && link.type === 'input-to'));
  const infoOnly = editBlueprintObject({ ...project, blueprintVersions: [...project.blueprintVersions, next] }, {
    objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, inputInformationIds: [], outputInformationIds: ['information-delivery-result'],
  }, 'founder');
  const infoOnlyProcess = Object.values(infoOnly.areas).flatMap((area) => area.items).find((item) => item.id === process.id);
  assert.deepEqual(infoOnlyProcess.inputs, [decision.id], 'an information edit retains the selected decision input');
  assert.deepEqual(infoOnlyProcess.outputs, ['information-delivery-result']);
  assert.ok(infoOnly.relations.some((link) => link.source === decision.id && link.target === process.id && link.type === 'input-to'));
  assert.ok(infoOnly.relations.some((link) => link.source === process.id && link.target === 'information-delivery-result' && link.type === 'produces'));
  for (const [field, targets] of [
    ['inputDecisionIds', [decision.id, decision.id]],
    ['outputDecisionIds', ['system-studio']],
  ]) {
    assert.throws(() => editBlueprintObject(project, {
      objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: owner.name,
      trigger: process.trigger, [field]: targets,
    }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  }
  assert.throws(() => editBlueprintObject(project, {
    objectId: process.id, name: process.name, detail: process.detail, ownerRoleName: owner.name,
    trigger: process.trigger, inputDecisionIds: ['decision-missing'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
});

test('feedback-loop steering goal is optional and preserves evidence, decision and operating design', () => {
  const project = completeDiscovery();
  const blueprint = project.blueprintVersions[0];
  const loop = blueprint.areas.metricsFeedback.items.find((item) => item.id === 'loop-weekly-steering');
  const before = structuredClone(loop);
  const cleared = editBlueprintObject(project, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackGoalId: null,
  }, 'founder');
  const clearedLoop = cleared.areas.metricsFeedback.items.find((item) => item.id === loop.id);
  assert.equal(clearedLoop.goal, null);
  for (const field of ['evidence', 'decisionIds', 'owner', 'cadence', 'threshold']) assert.deepEqual(clearedLoop[field], before[field]);
  assert.equal(cleared.edit.before.feedbackGoalName, 'Deliver the promised customer outcome');
  assert.equal(cleared.edit.after.feedbackGoalName, null);
  assert.ok(!cleared.relations.some((link) => link.source === loop.id && link.type === 'steers'));

  const linked = editBlueprintObject({ ...project, blueprintVersions: [...project.blueprintVersions, cleared] }, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackGoalId: 'goal-customer-outcome',
  }, 'founder');
  const linkedLoop = linked.areas.metricsFeedback.items.find((item) => item.id === loop.id);
  assert.equal(linkedLoop.goal, 'goal-customer-outcome');
  for (const field of ['evidence', 'decisionIds', 'owner', 'cadence', 'threshold']) assert.deepEqual(linkedLoop[field], before[field]);
  assert.equal(linked.edit.before.feedbackGoalName, null);
  assert.equal(linked.edit.after.feedbackGoalName, 'Deliver the promised customer outcome');
  assert.ok(linked.relations.some((link) => link.source === loop.id && link.target === 'goal-customer-outcome' && link.type === 'steers'));
  assert.throws(() => editBlueprintObject(project, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackGoalId: 'process-deliver',
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackGoalId: 'goal-missing',
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
});

test('feedback-loop decision links are editable proposed design and remain derived', () => {
  const base = completeDiscovery();
  const blueprint = structuredClone(base.blueprintVersions[0]);
  blueprint.areas.governanceRiskControls.items.push({
    id: 'decision-customer-recovery', type: 'decision', name: 'Customer recovery review',
    detail: 'Choose a customer recovery response from the review evidence.', status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:feedback-decision', note: 'Alternate decision fixture for proposed loop design.' }],
  });
  blueprint.summary.objectCount += 1;
  blueprint.integrity = validateBlueprint(blueprint);
  const project = { ...base, blueprintVersions: [blueprint] };
  const loop = blueprint.areas.metricsFeedback.items.find((item) => item.id === 'loop-weekly-steering');
  const before = structuredClone(loop);
  const authorises = (version) => version.relations.filter((link) => link.target === loop.id && link.type === 'authorises');
  const replacement = editBlueprintObject(project, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackDecisionIds: ['decision-customer-recovery'],
  }, 'founder');
  const replacementLoop = replacement.areas.metricsFeedback.items.find((item) => item.id === loop.id);
  assert.deepEqual(replacementLoop.decisionIds, ['decision-customer-recovery']);
  for (const field of ['evidence', 'goal', 'owner', 'cadence', 'threshold']) assert.deepEqual(replacementLoop[field], before[field]);
  assert.deepEqual(authorises(replacement), [{
    id: 'decision-customer-recovery--authorises--loop-weekly-steering',
    source: 'decision-customer-recovery', target: loop.id, type: 'authorises',
  }]);
  assert.deepEqual(replacement.edit.before.feedbackDecisionNames, ['Operating priority decision']);
  assert.deepEqual(replacement.edit.after.feedbackDecisionNames, ['Customer recovery review']);

  const cleared = editBlueprintObject({ ...project, blueprintVersions: [blueprint, replacement] }, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackDecisionIds: [],
  }, 'founder');
  const clearedLoop = cleared.areas.metricsFeedback.items.find((item) => item.id === loop.id);
  assert.deepEqual(clearedLoop.decisionIds, []);
  for (const field of ['evidence', 'goal', 'owner', 'cadence', 'threshold']) assert.deepEqual(clearedLoop[field], before[field]);
  assert.deepEqual(authorises(cleared), []);
  assert.deepEqual(cleared.edit.before.feedbackDecisionNames, ['Customer recovery review']);
  assert.deepEqual(cleared.edit.after.feedbackDecisionNames, []);

  const restored = editBlueprintObject({ ...project, blueprintVersions: [blueprint, replacement, cleared] }, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackDecisionIds: ['decision-priority'],
  }, 'founder');
  assert.deepEqual(restored.areas.metricsFeedback.items.find((item) => item.id === loop.id).decisionIds, ['decision-priority']);
  assert.deepEqual(restored.edit.before.feedbackDecisionNames, []);
  assert.deepEqual(restored.edit.after.feedbackDecisionNames, ['Operating priority decision']);
  assert.throws(() => editBlueprintObject(project, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackDecisionIds: ['process-deliver'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: loop.id, name: loop.name, detail: loop.detail, feedbackDecisionIds: ['decision-missing'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
});

test('decision edits replace proposed maker and scope links without granting authority', () => {
  const project = completeDiscovery();
  const original = project.blueprintVersions[0];
  const decision = original.areas.governanceRiskControls.items.find((item) => item.id === 'decision-priority');
  const next = editBlueprintObject(project, {
    objectId: decision.id, name: 'Service recovery decision', detail: 'Choose the corrective action from outcome and risk evidence.',
    decisionMakerRoleId: 'role-operations', decisionScopeIds: ['goal-customer-outcome', 'process-deliver', 'risk-unsafe-automation'],
  }, 'founder');
  const edited = next.areas.governanceRiskControls.items.find((item) => item.id === decision.id);
  assert.equal(edited.by, 'role-operations');
  assert.deepEqual(edited.scope, ['goal-customer-outcome', 'process-deliver', 'risk-unsafe-automation']);
  assert.ok(next.relations.some((link) => link.source === 'role-operations' && link.target === decision.id && link.type === 'decides'));
  assert.ok(next.relations.some((link) => link.source === decision.id && link.target === 'process-deliver' && link.type === 'governs'));
  assert.deepEqual(next.edit.before.decisionMakerRoleName, 'Founder / enterprise owner');
  assert.deepEqual(next.edit.after.decisionMakerRoleName, 'Operations owner');
  assert.deepEqual(next.edit.before.decisionScopeNames, ['Deliver the promised customer outcome', 'Enterprise steering']);
  assert.deepEqual(next.edit.after.decisionScopeNames, ['Deliver the core offering', 'Deliver the promised customer outcome', 'Unapproved automated action']);
  assert.equal(original.areas.governanceRiskControls.items.find((item) => item.id === decision.id).by, 'role-founder');
  assert.equal(edited.status, 'designed');
  assert.equal(next.epistemicStatus, 'proposed-design');
  assert.throws(() => editBlueprintObject(project, {
    objectId: decision.id, name: decision.name, detail: decision.detail,
    decisionMakerRoleId: 'system-studio', decisionScopeIds: decision.scope,
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: decision.id, name: decision.name, detail: decision.detail,
    decisionMakerRoleId: decision.by, decisionScopeIds: ['role-founder'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: decision.id, name: decision.name, detail: decision.detail,
    decisionMakerRoleId: decision.by, decisionScopeIds: ['scope-missing'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
});

test('strategy goal links replace only goal references and remain design intent', () => {
  const project = completeDiscovery();
  const original = project.blueprintVersions[0];
  const nextGoal = {
    id: 'goal-repeat-service', type: 'goal', name: 'Reduce repeat customer disruption',
    detail: 'Restore essential equipment quickly and prevent repeat disruption.',
    status: 'designed', confidence: 'medium',
    provenance: [{ source: 'test:strategy-goal', note: 'Goal fixture for strategy traceability.' }],
  };
  original.areas.purposeStrategy.items.push(nextGoal);
  original.summary.objectCount += 1;
  original.integrity = validateBlueprint(original);
  const strategy = original.areas.purposeStrategy.items.find((item) => item.id === 'strategy-focused-launch');
  strategy.goals = ['goal-customer-outcome'];
  const next = editBlueprintObject(project, {
    objectId: strategy.id, name: strategy.name, detail: strategy.detail,
    ownerRoleName: 'Founder / enterprise owner', strategyGoalIds: [nextGoal.id],
  }, 'founder');
  const edited = next.areas.purposeStrategy.items.find((item) => item.id === strategy.id);
  assert.deepEqual(edited.goals, [nextGoal.id]);
  assert.equal(edited.owner, 'role-founder', 'the existing accountability reference is retained');
  assert.deepEqual(next.edit.before.strategyGoalNames, ['Deliver the promised customer outcome']);
  assert.deepEqual(next.edit.after.strategyGoalNames, ['Reduce repeat customer disruption']);
  assert.ok(next.relations.some((link) => link.source === strategy.id && link.target === nextGoal.id && link.type === 'supports'));
  assert.equal(next.relations.some((link) => link.source === strategy.id && link.target === 'goal-customer-outcome' && link.type === 'supports'), false);
  assert.equal(edited.status, 'designed');
  assert.equal(next.epistemicStatus, 'proposed-design');
  assert.throws(() => editBlueprintObject(project, {
    objectId: strategy.id, name: strategy.name, detail: strategy.detail,
    ownerRoleName: 'Founder / enterprise owner', strategyGoalIds: [nextGoal.id, nextGoal.id],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: strategy.id, name: strategy.name, detail: strategy.detail,
    ownerRoleName: 'Founder / enterprise owner', strategyGoalIds: ['system-studio'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
  assert.throws(() => editBlueprintObject(project, {
    objectId: strategy.id, name: strategy.name, detail: strategy.detail,
    ownerRoleName: 'Founder / enterprise owner', strategyGoalIds: ['goal-missing'],
  }, 'founder'), (error) => error.code === 'INVALID_BLUEPRINT_RELATION');
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
