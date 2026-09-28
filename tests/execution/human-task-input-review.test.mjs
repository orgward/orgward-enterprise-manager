import assert from 'node:assert/strict';
import test from 'node:test';
import { humanTaskInputDisclosureKey, humanTaskInputDisclosureOpen, processTaskHumanInputReview,
  rememberHumanTaskInputDisclosure } from '../../public/human-task-input-review.mjs';

const blueprint = (version, detail) => ({ id: 'blueprint-pinned', version, areas: {
  people: { items: [
    { id: 'actor-human', type: 'actor-human', name: 'Reviewer' },
    { id: 'actor-agent', type: 'actor-agent', name: 'Agent' },
  ] },
  information: { items: [{ id: 'information-need', type: 'information', name: 'Qualified need', detail }] },
} });
const project = { id: 'project-1', blueprintVersions: [blueprint(1, 'Pinned customer need.'), blueprint(2, 'Changed current customer need.')] };
const plan = { id: 'plan-1', revision: 3, source: { projectId: 'project-1', blueprintId: 'blueprint-pinned', blueprintVersion: 1 } };
const task = { id: 'task-review', assignee: { kind: 'blueprint-actor', actorId: 'actor-human' },
  inputs: [{ objectId: 'information-need', label: 'Qualified need', type: 'information' }] };

test('human input review resolves content from the plan’s exact pinned blueprint version', () => {
  assert.deepEqual(processTaskHumanInputReview({ task, plan, project }), {
    kind: 'inputs', blueprintVersion: 1, entries: [{ objectId: 'information-need', type: 'information',
      name: 'Qualified need', detail: 'Pinned customer need.' }],
  });
});

test('human input review fails closed for mismatched or malformed pinned references', () => {
  const unavailable = { kind: 'unavailable',
    label: 'Pinned task inputs are unavailable. Open the saved design to review its exact blueprint version.' };
  assert.deepEqual(processTaskHumanInputReview({ task, plan: { ...plan,
    source: { ...plan.source, projectId: 'another-project' } }, project }), unavailable);
  assert.deepEqual(processTaskHumanInputReview({ task, plan: { ...plan,
    source: { ...plan.source, blueprintVersion: 99 } }, project }), unavailable);
  assert.deepEqual(processTaskHumanInputReview({ task: { ...task, inputs: [
    { ...task.inputs[0], objectId: 'missing-input' },
  ] }, plan, project }), unavailable);
  assert.deepEqual(processTaskHumanInputReview({ task: { ...task, inputs: [
    { ...task.inputs[0], label: 'Forged label' },
  ] }, plan, project }), unavailable);
  assert.deepEqual(processTaskHumanInputReview({ task: { ...task, inputs: [task.inputs[0], task.inputs[0]] }, plan, project }), unavailable);
});

test('human input review bounds content and stays out of agent and unassigned task cards', () => {
  assert.deepEqual(processTaskHumanInputReview({ task: { ...task, inputs: [] }, plan, project }), {
    kind: 'inputs', blueprintVersion: 1, entries: [],
  });
  assert.equal(processTaskHumanInputReview({ task: { ...task,
    assignee: { kind: 'blueprint-actor', actorId: 'actor-agent' } }, plan, project }), null);
  assert.equal(processTaskHumanInputReview({ task: { ...task,
    assignee: { kind: 'unassigned' } }, plan, project }), null);
  const oversized = { ...project, blueprintVersions: [blueprint(1, 'x'.repeat(4097))] };
  assert.equal(processTaskHumanInputReview({ task, plan, project: oversized }).kind, 'unavailable');
  assert.equal(processTaskHumanInputReview({ task, plan: { ...plan, source: null }, project }).kind, 'unavailable');
});

test('expanded human input review stays attached to the exact project plan revision and task through rerenders', () => {
  const key = humanTaskInputDisclosureKey({ projectId: 'project:1', planId: 'plan/1', revision: 3, taskId: 'task 1' });
  const expanded = new Set();
  assert.equal(humanTaskInputDisclosureOpen(key, expanded), false);
  rememberHumanTaskInputDisclosure(key, true, expanded);
  assert.equal(humanTaskInputDisclosureOpen(key, expanded), true);
  assert.notEqual(humanTaskInputDisclosureKey({ projectId: 'project:1', planId: 'plan/1', revision: 4, taskId: 'task 1' }), key);
  rememberHumanTaskInputDisclosure(key, false, expanded);
  assert.equal(humanTaskInputDisclosureOpen(key, expanded), false);
  assert.equal(humanTaskInputDisclosureKey({ projectId: 'project-1', planId: 'plan-1', revision: 0, taskId: 'task-review' }), null);
});
