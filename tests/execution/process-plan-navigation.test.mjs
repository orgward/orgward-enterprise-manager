import assert from 'node:assert/strict';
import test from 'node:test';
import { currentProcessPlanFocusTarget, executionPlanInstanceRoute, linkedPlanInstanceRouteTarget, linkedProcessPlanTarget, processPlanFreshness, processPlanRevisionFocusTarget, selectLinkedProcessPlanInstance, sourceProcessDesignLink } from '../../public/process-plan-navigation.mjs';
import { decodeStudioRoute, encodeExecutionRoute, executionRunRouteTarget } from '../../public/shared-interactions.mjs';

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

test('assigned work deep links preserve the exact selected task within a shared plan instance', () => {
  const target = { ...linkedProcessPlanTarget(run, [{ id: projectId }]), taskId: 'task-approve' };
  const href = encodeExecutionRoute(projectId, target);
  assert.match(href, /&task=task-approve$/);
  assert.deepEqual(linkedPlanInstanceRouteTarget(`https://orgward.local${href}`, [{ id: projectId }]), {
    requested: true, target,
  });
  assert.deepEqual(linkedPlanInstanceRouteTarget(`https://orgward.local${href.replace('task=task-approve', 'task=bad%20id')}`, [{ id: projectId }]), {
    requested: true, target: null,
  });
});

test('software runtime deep links require exact software snapshot identity at the authenticated runtime load', () => {
  const softwarePlanId = 'software-delivery-0123456789abcdef0123456789abcdef';
  const target = { projectId, processPlanId: softwarePlanId, revision: 2,
    planInstanceId: 'abcdefab-cdef-abcd-efab-cdefabcdefab', selectionKey: `${softwarePlanId}\n2` };
  const href = encodeExecutionRoute(projectId, target);
  assert.match(href, /plan=software-delivery-0123456789abcdef0123456789abcdef/);
  assert.deepEqual(linkedPlanInstanceRouteTarget(`https://orgward.local${href}`, [{ id: projectId }]), {
    requested: true, target,
  });
  const softwareRun = { projectId, processTaskRef: { ...run.processTaskRef, processPlanId: softwarePlanId, revision: 2 } };
  assert.equal(linkedProcessPlanTarget(softwareRun, [{ id: projectId }]), null,
    'a linked execution run cannot authorize a software snapshot by ID alone');
  assert.deepEqual(linkedProcessPlanTarget(softwareRun, [{ id: projectId }], [
    { id: softwarePlanId, revision: 2, kind: 'software_delivery_runtime_plan' },
  ]), { ...target });
  assert.equal(encodeExecutionRoute(projectId, { ...target, processPlanId: 'software-delivery-invalid' }),
    `/execution.html?project=${projectId}`);
});

test('selected run route round-trips only an accessible saved run for exact keyboard re-entry', () => {
  const selectedRun = { id: 'execution-run-01234567-89ab-cdef-0123-456789abcdef', projectId };
  const route = encodeExecutionRoute(projectId, null, selectedRun.id);
  assert.equal(route, `/execution.html?project=${projectId}&run=${selectedRun.id}`);
  assert.deepEqual(executionRunRouteTarget(`https://orgward.local${route}`, [selectedRun]), {
    requested: true, target: { runId: selectedRun.id, projectId },
  });
  assert.deepEqual(executionRunRouteTarget(`https://orgward.local${route}`, []), { requested: true, target: null });
  assert.deepEqual(executionRunRouteTarget(`/execution.html?project=${projectId}&run=bad%20id`, [selectedRun]), {
    requested: true, target: null,
  });
  assert.deepEqual(executionRunRouteTarget('/execution.html', [selectedRun]), { requested: false, target: null });
  assert.equal(encodeExecutionRoute(projectId, { projectId, processId: 'process-customer-intake' }, selectedRun.id),
    `/execution.html?project=${projectId}&process=process-customer-intake`);
});

test('GitHub onboarding handoff routes only a valid immutable snapshot ID in its project context', () => {
  const snapshotId = 'a'.repeat(64);
  assert.equal(encodeExecutionRoute(projectId, null, null, snapshotId),
    `/execution.html?project=${projectId}&githubSnapshot=${snapshotId}`);
  assert.equal(encodeExecutionRoute(projectId, null, null, 'a'.repeat(63)), `/execution.html?project=${projectId}`);
  assert.equal(encodeExecutionRoute('invalid', null, null, snapshotId), '/execution.html');
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

test('historical process plans link directly to the current saved process for replanning', () => {
  const processId = 'process-customer-intake';
  const process = { id: processId, type: 'process', name: 'Customer intake' };
  const oldBlueprint = {
    id: 'blueprint-01234567-89ab-cdef-0123-456789abcdef', version: 4,
    areas: { capabilitiesProcesses: { items: [process] } },
  };
  const latestBlueprint = {
    ...oldBlueprint, version: 5,
    areas: { capabilitiesProcesses: { items: [{ ...process, name: 'Updated customer intake' }] } },
  };
  const project = {
    id: projectId, blueprintVersions: [oldBlueprint, latestBlueprint], latestBlueprint,
    graph: { nodes: [process] },
  };
  const plan = { source: { projectId, blueprintId: oldBlueprint.id, blueprintVersion: 4, processId, processName: 'Customer intake' } };
  const freshness = processPlanFreshness(plan, project);
  assert.equal(freshness.historical, true);
  assert.equal(freshness.link.label, 'Plan current Customer intake in Execution');
  assert.deepEqual(decodeStudioRoute(freshness.link.href), {
    projectId, view: 'blueprint', area: null, selectedId: null, types: [],
  });
  const route = new URL(freshness.link.href, 'http://orgward.local');
  assert.equal(route.pathname, '/execution.html');
  assert.equal(route.searchParams.get('project'), projectId);
  assert.equal(route.searchParams.get('process'), processId);
  assert.deepEqual(processPlanFreshness({ ...plan, source: { ...plan.source, blueprintVersion: 5 } }, project), {
    historical: false, link: null,
  });
  const compatibleManualPlan = { ...plan, kind: 'manual_process_flow_plan', blueprintApplicability: {
    status: 'CURRENT_VIEW_ONLY_COMPATIBLE', pinnedBlueprintId: oldBlueprint.id, pinnedBlueprintVersion: 4,
  } };
  assert.deepEqual(processPlanFreshness(compatibleManualPlan, project), {
    historical: false, compatible: true, link: null,
    explanation: 'Only process-step titles or display order changed; this plan remains pinned to its original blueprint.',
  });
  const materialStale = processPlanFreshness({ ...compatibleManualPlan, blueprintApplicability: { status: 'STALE' } }, project);
  assert.equal(materialStale.historical, true);
  assert.equal(materialStale.compatible, false);
  assert.equal(materialStale.link.label, 'Plan current Customer intake in Execution');
  const recoveryRoute = new URL(materialStale.link.href, 'http://orgward.local');
  assert.equal(recoveryRoute.pathname, '/execution.html');
  assert.equal(recoveryRoute.searchParams.get('process'), processId);
  assert.deepEqual(compatibleManualPlan.source, plan.source, 'compatible usability preserves the original source pins');
  assert.deepEqual(processPlanFreshness(plan, { ...project, latestBlueprint: { ...latestBlueprint, areas: {} } }), {
    historical: true, link: null,
  });
  assert.deepEqual(processPlanFreshness(plan, { ...project, id: 'project-invalid' }), {
    historical: false, link: null,
  });
});

test('new-plan focus target prefers the successful save event and ignores stale or invalid plans', () => {
  const processId = 'process-customer-intake';
  const latestBlueprint = {
    id: 'blueprint-01234567-89ab-cdef-0123-456789abcdef', version: 5,
    areas: { capabilitiesProcesses: { items: [{ id: processId, type: 'process' }] } },
  };
  const currentPlanId = 'process-plan-01234567-89ab-cdef-0123-456789abcdef';
  const replayedPlanId = 'process-plan-11234567-89ab-cdef-0123-456789abcdef';
  const oldPlanId = 'process-plan-21234567-89ab-cdef-0123-456789abcdef';
  const plan = (id, version, revision = 1) => ({ id, revision, source: {
    projectId, processId, blueprintId: latestBlueprint.id, blueprintVersion: version,
  } });
  const project = {
    id: projectId, latestBlueprint,
    processPlans: [plan(currentPlanId, 5, 1), plan(currentPlanId, 5, 2), plan(replayedPlanId, 5), plan(oldPlanId, 4)],
  };
  assert.deepEqual(currentProcessPlanFocusTarget(project, processId, replayedPlanId), {
    processPlanId: replayedPlanId, revision: 1,
  });
  assert.deepEqual(currentProcessPlanFocusTarget(project, processId), {
    processPlanId: replayedPlanId, revision: 1,
  });
  assert.deepEqual(currentProcessPlanFocusTarget({ ...project, processPlans: [plan(currentPlanId, 5, 1), plan(currentPlanId, 5, 2), plan(oldPlanId, 4)] }, processId), {
    processPlanId: currentPlanId, revision: 2,
  });
  assert.equal(currentProcessPlanFocusTarget(project, 'missing-process'), null);
  assert.equal(currentProcessPlanFocusTarget({ ...project, processPlans: [] }, processId), null);
  assert.deepEqual(currentProcessPlanFocusTarget(project, processId, 'not-a-plan-id'), {
    processPlanId: replayedPlanId, revision: 1,
  });
});

test('revised-plan focus target uses only a valid saved-revision response event', () => {
  const event = {
    type: 'ProcessTaskGraphRevised',
    data: { planId: 'process-plan-01234567-89ab-cdef-0123-456789abcdef', revision: 4 },
  };
  assert.deepEqual(processPlanRevisionFocusTarget(event), {
    processPlanId: event.data.planId, revision: 4,
  });
  for (const invalidEvent of [
    null,
    { ...event, type: 'ProcessTaskGraphPlanned' },
    { ...event, data: { ...event.data, planId: 'untrusted-plan' } },
    { ...event, data: { ...event.data, revision: 0 } },
    { ...event, data: { ...event.data, revision: 1.5 } },
    { ...event, data: ['not-an-event-payload'] },
  ]) assert.equal(processPlanRevisionFocusTarget(invalidEvent), null);
});
