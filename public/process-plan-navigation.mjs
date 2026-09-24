import { decodeStudioRoute, encodeExecutionRoute, encodeStudioRoute } from './shared-interactions.mjs';

const PROCESS_PLAN_ID = /^process-plan-[0-9a-f-]{36}$/i;
const PLAN_INSTANCE_ID = /^[0-9a-f-]{36}$/i;
const PROJECT_ID = /^project-[0-9a-f-]{36}$/;

export function linkedProcessPlanTarget(run, visibleProjects) {
  const ref = run?.processTaskRef;
  if (!ref || !Array.isArray(visibleProjects) || !visibleProjects.some((project) => project.id === run.projectId)
    || !PROCESS_PLAN_ID.test(ref.processPlanId ?? '')
    || !Number.isSafeInteger(ref.revision) || ref.revision < 1
    || !PLAN_INSTANCE_ID.test(ref.planInstanceId ?? '')) return null;
  return {
    projectId: run.projectId,
    processPlanId: ref.processPlanId,
    revision: ref.revision,
    planInstanceId: ref.planInstanceId,
    selectionKey: `${ref.processPlanId}\n${ref.revision}`,
  };
}

export function selectLinkedProcessPlanInstance(run, visibleProjects, selectedPlanInstances) {
  const target = linkedProcessPlanTarget(run, visibleProjects);
  if (!target || !(selectedPlanInstances instanceof Map)) return null;
  selectedPlanInstances.set(target.selectionKey, target.planInstanceId);
  return target;
}

export function linkedPlanInstanceRouteTarget(value, visibleProjects) {
  const url = new URL(value, 'http://orgward.local');
  const requested = ['plan', 'revision', 'instance'].some((key) => url.searchParams.has(key));
  if (!requested) return { requested: false, target: null };
  const route = decodeStudioRoute(url.href);
  const revisionText = url.searchParams.get('revision');
  const revision = revisionText && /^(?:[1-9]\d*)$/.test(revisionText) ? Number(revisionText) : NaN;
  const target = linkedProcessPlanTarget({
    projectId: route.projectId,
    processTaskRef: {
      processPlanId: url.searchParams.get('plan'), revision,
      planInstanceId: url.searchParams.get('instance'),
    },
  }, visibleProjects);
  return { requested: true, target };
}

export function executionPlanInstanceRoute(projectId, target) {
  if (!target || target.projectId !== projectId) return encodeExecutionRoute(projectId);
  return encodeExecutionRoute(projectId, target);
}

export function sourceProcessDesignLink(plan, project) {
  const source = plan?.source;
  if (!PROJECT_ID.test(project?.id ?? '') || source?.projectId !== project.id || !/^blueprint-[0-9a-f-]{36}$/i.test(source.blueprintId ?? '')
    || !Number.isSafeInteger(source.blueprintVersion) || source.blueprintVersion < 1
    || typeof source.processId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(source.processId)) return null;
  const pinnedBlueprint = project.blueprintVersions?.find((entry) => entry.id === source.blueprintId
    && entry.version === source.blueprintVersion);
  const processExists = (blueprint) => Object.values(blueprint?.areas ?? {}).some((area) =>
    (area.items ?? []).some((item) => item.id === source.processId && item.type === 'process'));
  if (!processExists(pinnedBlueprint) || !processExists(project.latestBlueprint)
    || !(project.graph?.nodes ?? []).some((node) => node.id === source.processId && node.type === 'process')) return null;
  return {
    label: `Open source process: ${source.processName}`,
    href: encodeStudioRoute({ projectId: project.id, view: 'map', selectedId: source.processId }),
  };
}
