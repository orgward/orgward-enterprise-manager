import assert from 'node:assert/strict';
import test from 'node:test';
import { executionPlanInstanceRoute, linkedPlanInstanceRouteTarget, linkedProcessPlanTarget, selectLinkedProcessPlanInstance, sourceProcessDesignLink } from '../../public/process-plan-navigation.mjs';
import { decodeStudioRoute, encodeExecutionRoute } from '../../public/shared-interactions.mjs';

const projectId = 'project-01234567-89ab-cdef-0123-456789abcdef';
const run = {
  projectId,
  processTaskRef: {
    processPlanId: 'process-plan-01234567-89ab-cdef-0123-456789abcdef',
    revision: 3,
    planInstanceId: 'abcdefab-cdef-abcd-efab-cdefabcdefab',
  },
};

test('linked plan navigation requires a visible project and valid plan revision/instance references', () => {
  assert.deepEqual(linkedProcessPlanTarget(run, [{ id: projectId }]), {
    projectId,
    processPlanId: run.processTaskRef.processPlanId,
    revision: 3,
    planInstanceId: run.processTaskRef.planInstanceId,
    selectionKey: `${run.processTaskRef.processPlanId}\n3`,
  });
  assert.equal(linkedProcessPlanTarget({ ...run, processTaskRef: null }, [{ id: projectId }]), null);
  assert.equal(linkedProcessPlanTarget(run, []), null);
  for (const invalidRef of [
    { ...run.processTaskRef, processPlanId: 'bad-plan-id' },
    { ...run.processTaskRef, revision: 0 },
    { ...run.processTaskRef, revision: 1.5 },
    { ...run.processTaskRef, planInstanceId: 'not-a-uuid' },
  ]) {
    assert.equal(linkedProcessPlanTarget({ ...run, processTaskRef: invalidRef }, [{ id: projectId }]), null);
  }
});

test('linked plan return selects the exact immutable revision and instance', () => {
  const selected = new Map();
  const target = selectLinkedProcessPlanInstance(run, [{ id: projectId }], selected);
  assert.equal(target.revision, 3);
  assert.equal(target.planInstanceId, run.processTaskRef.planInstanceId);
  assert.equal(selected.get(`${run.processTaskRef.processPlanId}\n3`), run.processTaskRef.planInstanceId);
});

test('linked plan route round-trips exact visible project, revision, and instance references', () => {
  const target = linkedProcessPlanTarget(run, [{ id: projectId }]);
  const href = encodeExecutionRoute(projectId, target);
  assert.deepEqual(linkedPlanInstanceRouteTarget(`https://orgward.local${href}`, [{ id: projectId }]), {
    requested: true, target,
  });
  assert.equal(executionPlanInstanceRoute(projectId, target), href);
  assert.deepEqual(linkedPlanInstanceRouteTarget(`https://orgward.local${href}`, []), { requested: true, target: null });
  for (const query of [
    `?project=${projectId}&plan=bad&revision=3&instance=${run.processTaskRef.planInstanceId}`,
    `?project=${projectId}&plan=${run.processTaskRef.processPlanId}&revision=3.5&instance=${run.processTaskRef.planInstanceId}`,
    `?project=${projectId}&plan=${run.processTaskRef.processPlanId}&revision=3&instance=bad`,
    `?project=${projectId}&plan=${run.processTaskRef.processPlanId}&revision=3`,
  ]) {
    assert.deepEqual(linkedPlanInstanceRouteTarget(`https://orgward.local/execution.html${query}`, [{ id: projectId }]), {
      requested: true, target: null,
    });
  }
  assert.deepEqual(linkedPlanInstanceRouteTarget('/execution.html', [{ id: projectId }]), { requested: false, target: null });
  assert.equal(encodeExecutionRoute(projectId, { ...target, projectId: 'project-other' }), `/execution.html?project=${projectId}`);
});

test('saved plan card links to its available source process in the same project map', () => {
  const processId = 'process-customer-intake';
  const blueprint = {
    id: 'blueprint-01234567-89ab-cdef-0123-456789abcdef', version: 4,
    areas: { capabilitiesProcesses: { items: [{ id: processId, type: 'process', name: 'Customer intake' }] } },
  };
  const project = {
    id: projectId, blueprintVersions: [blueprint], latestBlueprint: blueprint,
    graph: { nodes: [{ id: processId, type: 'process' }] },
  };
  const plan = { source: { projectId, blueprintId: blueprint.id, blueprintVersion: 4, processId, processName: 'Customer intake' } };
  const link = sourceProcessDesignLink(plan, project);
  assert.equal(link.label, 'Open source process: Customer intake');
  assert.deepEqual(decodeStudioRoute(link.href), {
    projectId, view: 'map', area: null, selectedId: processId, types: [],
  });
  assert.equal(sourceProcessDesignLink(plan, { ...project, id: 'project-invalid' }), null);
  assert.equal(sourceProcessDesignLink(plan, { ...project, id: projectId.toUpperCase() }), null);
  assert.equal(sourceProcessDesignLink({ ...plan, source: { ...plan.source, projectId: 'project-wrong' } }, project), null);
  assert.equal(sourceProcessDesignLink({ ...plan, source: { ...plan.source, processId: 'bad id' } }, project), null);
  assert.equal(sourceProcessDesignLink(plan, { ...project, graph: { nodes: [] } }), null);
  assert.equal(sourceProcessDesignLink(plan, { ...project, latestBlueprint: { areas: {} } }), null);
});
