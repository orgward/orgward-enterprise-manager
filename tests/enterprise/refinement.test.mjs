import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRefinementTrace, refinementModelErrors, refinementModelRelations } from '../../src/enterprise/refinement.mjs';

const objects = [
  { id: 'goal-safe-service', name: 'Safe service', type: 'goal', refines: [] },
  { id: 'capability-screening', name: 'Screen transfers', type: 'capability', refines: ['goal-safe-service'] },
  { id: 'process-review', name: 'Review exception', type: 'process', refines: ['capability-screening'] },
  { id: 'task-check-evidence', name: 'Check evidence', type: 'process', refines: ['process-review'] },
];

test('refinement relations and reverse trace project saved parent and child paths without mutating the blueprint', () => {
  const before = structuredClone(objects);
  assert.deepEqual(refinementModelErrors(objects), []);
  assert.deepEqual(refinementModelRelations(objects).map(({ source, target, type }) => ({ source, target, type })), [
    { source: 'capability-screening', target: 'goal-safe-service', type: 'refines' },
    { source: 'process-review', target: 'capability-screening', type: 'refines' },
    { source: 'task-check-evidence', target: 'process-review', type: 'refines' },
  ]);
  const trace = projectRefinementTrace(objects, 'process-review');
  assert.equal(trace.status, 'LINKED');
  assert.deepEqual(trace.ancestors.map(({ id, depth, path }) => ({ id, depth, path })), [
    { id: 'capability-screening', depth: 1, path: ['process-review', 'capability-screening'] },
    { id: 'goal-safe-service', depth: 2, path: ['process-review', 'capability-screening', 'goal-safe-service'] },
  ]);
  assert.deepEqual(trace.descendants.map(({ id, depth, path }) => ({ id, depth, path })), [
    { id: 'task-check-evidence', depth: 1, path: ['process-review', 'task-check-evidence'] },
  ]);
  assert.equal(trace.meaning, 'PROPOSED_DESIGN_TRACE');
  assert.deepEqual(objects, before);
});

test('refinement validation rejects cycles, self links, missing targets and excessive links', () => {
  const byId = new Map(objects.map((object) => [object.id, object]));
  assert.ok(refinementModelErrors([
    { ...objects[0], refines: ['task-check-evidence'] },
    ...objects.slice(1),
  ]).some((error) => error.code === 'REFINEMENT_CYCLE'));
  assert.ok(refinementModelErrors([{ ...objects[0], refines: ['goal-safe-service'] }]).some((error) => error.code === 'INVALID_REFINEMENT_REFERENCE'));
  assert.ok(refinementModelErrors([{ ...objects[0], refines: ['missing-record'] }]).some((error) => error.code === 'INVALID_REFINEMENT_REFERENCE'));
  const tooMany = [...byId.keys()].filter((id) => id !== objects[0].id);
  tooMany.push('other-1', 'other-2', 'other-3', 'other-4', 'other-5', 'other-6', 'other-7', 'other-8', 'other-9', 'other-10');
  assert.ok(refinementModelErrors([{ ...objects[0], refines: tooMany }]).some((error) => error.code === 'INVALID_REFINEMENT_REFERENCE'));
  const longChain = Array.from({ length: 34 }, (_, index) => ({ id: `layer-${index}`, name: `Layer ${index}`, type: 'capability',
    ...(index < 33 ? { refines: [`layer-${index + 1}`] } : {}) }));
  assert.ok(refinementModelErrors(longChain).some((error) => error.code === 'REFINEMENT_DEPTH_LIMIT'));
});

test('reverse trace marks a wide result incomplete at its per-direction bound', () => {
  const selected = { id: 'goal-root', name: 'Root goal', type: 'goal' };
  const children = Array.from({ length: 260 }, (_, index) => ({ id: `process-child-${index}`, name: `Child ${index}`, type: 'process', refines: [selected.id] }));
  const trace = projectRefinementTrace([selected, ...children], selected.id);
  assert.equal(trace.status, 'TRUNCATED');
  assert.equal(trace.complete, false);
  assert.equal(trace.descendants.length, 256);
  assert.deepEqual(trace.truncated, { ancestors: false, descendants: true });
});
