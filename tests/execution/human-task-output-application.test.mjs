import test from 'node:test';
import assert from 'node:assert/strict';
import { humanTaskOutputApplicationState, humanTaskOutputCommand } from '../../public/human-task-output-application.mjs';
import { proposalDesignLink } from '../../public/proposal-review-state.mjs';

const project = {
  id: 'project-1', version: 2,
  latestBlueprint: { id: 'blueprint-1', version: 1, areas: { information: { items: [
    { id: 'information-result', type: 'information', name: 'Result', detail: 'Before' },
  ] } } },
  blueprintVersions: [{ id: 'blueprint-1', version: 1, areas: { information: { items: [
    { id: 'information-result', type: 'information', name: 'Result', detail: 'Before' },
  ] } } }], events: [],
};
const plan = { id: 'process-plan-1', revision: 1,
  source: { projectId: 'project-1', blueprintId: 'blueprint-1', blueprintVersion: 1 } };
const task = { id: 'task-review', outputs: [{ objectId: 'information-result', label: 'Result', type: 'information' }] };
const runtime = { projectId: 'project-1', processPlanId: plan.id, revision: 1,
  planInstanceId: 'instance-1', taskId: task.id, status: 'SUCCEEDED', canApplyHumanTaskOutput: true,
  events: [{ id: 'human-completion-event-1', type: 'HumanTaskCompleted', contentHash: 'c'.repeat(64), data: {
    taskId: task.id, processPlanId: plan.id, revision: 1, planInstanceId: 'instance-1', result: 'succeeded',
  } }] };

test('human output application requires exact succeeded task, information output, current owner capability and pin', () => {
  assert.deepEqual(humanTaskOutputApplicationState({ project, plan, task, runtime, output: task.outputs[0] }), {
    kind: 'ready', before: 'Before', outputName: 'Result', blueprintVersion: 1,
  });
  assert.equal(humanTaskOutputApplicationState({ project, plan, task,
    runtime: { ...runtime, status: 'IN_PROGRESS' }, output: task.outputs[0] }).kind, 'not-succeeded');
  assert.equal(humanTaskOutputApplicationState({ project, plan, task,
    runtime: { ...runtime, canApplyHumanTaskOutput: false }, output: task.outputs[0] }).kind, 'owner-review');
  assert.equal(humanTaskOutputApplicationState({ project, plan: { ...plan, source: { ...plan.source, projectId: 'project-other' } },
    task, runtime, output: task.outputs[0] }).kind, 'unavailable');
  assert.equal(humanTaskOutputApplicationState({ project, plan, task,
    runtime: { ...runtime, planInstanceId: 'instance-other' }, output: task.outputs[0] }).kind, 'ready');
  assert.equal(humanTaskOutputApplicationState({ project, plan, task,
    output: { ...task.outputs[0], type: 'decision' }, runtime }).kind, 'unavailable');
  const advanced = { ...project, latestBlueprint: { id: 'blueprint-2', version: 2, areas: {} } };
  assert.equal(humanTaskOutputApplicationState({ project: advanced, plan, task, runtime, output: task.outputs[0] }).kind, 'stale');
});

test('uncertain output retry retains the frozen original command ID and payload', () => {
  const first = humanTaskOutputCommand(null, { commandId: 'human-output:first', expectedVersion: 7,
    payload: { detail: 'Submitted detail', before: 'Before' } });
  const retry = humanTaskOutputCommand(first, { commandId: 'human-output:changed', expectedVersion: 8,
    payload: { detail: 'Edited after uncertainty' } });
  assert.equal(retry, first);
  assert.equal(retry.commandId, 'human-output:first');
  assert.equal(retry.expectedVersion, 7);
  assert.deepEqual(retry.payload, { detail: 'Submitted detail', before: 'Before' });
});

test('applied status requires exact checkpoint event and a saved applied blueprint, then survives projected reload state', () => {
  const appliedBlueprint = { id: 'blueprint-2', version: 2, areas: { information: { items: [
    { id: 'information-result', type: 'information', name: 'Result', detail: 'Owner entered', provenance: [{
      source: 'workspace:human-task-output', projectId: 'project-1', planId: plan.id, revision: 1,
      planInstanceId: runtime.planInstanceId, taskId: task.id, outputObjectId: 'information-result',
      sourceEventId: 'human-completion-event-1', sourceEventHash: 'c'.repeat(64), contentHash: 'b'.repeat(64),
    }] },
  ] } } };
  const saved = { ...project, version: 3, graph: { nodes: [{ id: 'information-result' }] }, latestBlueprint: appliedBlueprint,
    blueprintVersions: [...project.blueprintVersions, appliedBlueprint],
    events: [{ eventId: 'event-output-applied-1', type: 'HumanTaskOutputApplied', data: {
      projectId: 'project-1', planId: plan.id, revision: 1, planInstanceId: runtime.planInstanceId,
      taskId: task.id, outputObjectId: 'information-result', blueprintId: 'blueprint-1', blueprintVersion: 1,
      appliedBlueprintId: 'blueprint-2', appliedBlueprintVersion: 2, humanTaskEventId: 'human-completion-event-1',
      humanTaskEventHash: 'c'.repeat(64), contentHash: 'b'.repeat(64), evidenceContextOnly: true,
  } }],
  };
  assert.deepEqual(humanTaskOutputApplicationState({ project: saved, plan, task, runtime, output: task.outputs[0] }), {
    kind: 'applied', eventId: 'event-output-applied-1', projectId: 'project-1', planId: 'process-plan-1',
    revision: 1, planInstanceId: 'instance-1', taskId: 'task-review', outputObjectId: 'information-result',
    appliedBlueprintVersion: 2, currentBlueprintVersion: 2, currentDetail: 'Owner entered',
  });
  const routableProject = { ...saved, id: 'project-01234567-89ab-cdef-0123-456789abcdef' };
  assert.deepEqual(proposalDesignLink(routableProject, { status: 'applied', objectId: 'information-result', blueprintVersion: 2 }), {
    href: '/?project=project-01234567-89ab-cdef-0123-456789abcdef&view=map&selected=information-result', label: 'Open updated design',
  });
  const mismatched = { ...saved, events: [{ ...saved.events[0], data: { ...saved.events[0].data, taskId: 'another-task' } }] };
  const mismatchedState = humanTaskOutputApplicationState({ project: mismatched, plan, task, runtime, output: task.outputs[0] });
  assert.equal(mismatchedState.kind, 'stale');
  assert.equal(mismatchedState.kind === 'applied'
    ? proposalDesignLink(saved, { status: 'applied', objectId: mismatchedState.outputObjectId,
      blueprintVersion: mismatchedState.appliedBlueprintVersion }) : null, null,
  'a task-mismatched apply event cannot offer an output design link');
  const graphMissing = { ...routableProject, graph: { nodes: [] } };
  assert.deepEqual(proposalDesignLink(graphMissing, { status: 'applied', objectId: 'information-result', blueprintVersion: 2 }), {
    href: '/?project=project-01234567-89ab-cdef-0123-456789abcdef', label: 'Open current design',
  });
  assert.equal(proposalDesignLink(routableProject, { status: 'applied', objectId: 'untrusted-object', blueprintVersion: 2 })?.label,
    'Open current design', 'an absent object never becomes a selected design target');
  const invalidVersion = { ...saved, events: [{ ...saved.events[0], data: { ...saved.events[0].data, appliedBlueprintVersion: 0 } }] };
  assert.equal(humanTaskOutputApplicationState({ project: invalidVersion, plan, task, runtime, output: task.outputs[0] }).kind, 'stale');
  const provenance = appliedBlueprint.areas.information.items[0].provenance[0];
  for (const [field, value] of [
    ['planId', 'another-plan'], ['revision', 2], ['planInstanceId', 'another-instance'],
    ['taskId', 'another-task'], ['outputObjectId', 'another-output'],
    ['sourceEventId', 'another-completion-event'], ['sourceEventHash', 'd'.repeat(64)], ['contentHash', 'e'.repeat(64)],
  ]) {
    const mismatchedProvenance = { ...saved, blueprintVersions: saved.blueprintVersions.map((blueprint) => blueprint.id === 'blueprint-2'
      ? { ...blueprint, areas: { information: { items: [{ ...appliedBlueprint.areas.information.items[0],
        provenance: [{ ...provenance, [field]: value }] }] } } } : blueprint) };
    assert.equal(humanTaskOutputApplicationState({ project: mismatchedProvenance, plan, task, runtime,
      output: task.outputs[0] }).kind, 'unavailable', `mismatched ${field} provenance never presents an output as applied`);
  }
  const missingAppliedOutput = { ...saved, blueprintVersions: saved.blueprintVersions.map((blueprint) => blueprint.id === 'blueprint-2'
    ? { ...blueprint, areas: { information: { items: [] } } } : blueprint) };
  assert.equal(humanTaskOutputApplicationState({ project: missingAppliedOutput, plan, task, runtime, output: task.outputs[0] }).kind,
    'unavailable', 'an apply event cannot stand in for a missing output in its referenced blueprint version');
  const mismatchedAppliedOutput = { ...saved, blueprintVersions: saved.blueprintVersions.map((blueprint) => blueprint.id === 'blueprint-2'
    ? { ...blueprint, areas: { information: { items: [{ ...appliedBlueprint.areas.information.items[0], name: 'Different output' }] } } } : blueprint) };
  assert.equal(humanTaskOutputApplicationState({ project: mismatchedAppliedOutput, plan, task, runtime, output: task.outputs[0] }).kind,
    'unavailable', 'the applied blueprint must contain the exact declared information object');
});
