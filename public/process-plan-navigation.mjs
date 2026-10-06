import { decodeStudioRoute, encodeExecutionRoute, encodeStudioRoute } from './shared-interactions.mjs';

const PROCESS_PLAN_ID = /^(?:process-plan-[0-9a-f-]{36}|software-delivery-[a-f0-9]{32})$/i;
const SOFTWARE_PLAN_ID = /^software-delivery-[a-f0-9]{32}$/i;
const PLAN_INSTANCE_ID = /^[0-9a-f-]{36}$/i;
const PROJECT_ID = /^project-[0-9a-f-]{36}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/i;

export function linkedProcessPlanTarget(run, visibleProjects, verifiedRuntimePlans = []) {
  const ref = run?.processTaskRef;
  if (!ref || !Array.isArray(visibleProjects) || !visibleProjects.some((project) => project.id === run.projectId)
    || !PROCESS_PLAN_ID.test(ref.processPlanId ?? '')
    || (SOFTWARE_PLAN_ID.test(ref.processPlanId) && !verifiedRuntimePlans.some((plan) =>
      plan?.kind === 'software_delivery_runtime_plan' && plan.id === ref.processPlanId && Number(plan.revision) === ref.revision))
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

export function selectLinkedProcessPlanInstance(run, visibleProjects, selectedPlanInstances, verifiedRuntimePlans = []) {
  const target = linkedProcessPlanTarget(run, visibleProjects, verifiedRuntimePlans);
  if (!target || !(selectedPlanInstances instanceof Map)) return null;
  selectedPlanInstances.set(target.selectionKey, target.planInstanceId);
  return target;
}

export function linkedPlanInstanceRouteTarget(value, visibleProjects) {
  const url = new URL(value, 'http://orgward.local');
  const requested = ['plan', 'revision', 'instance', 'task'].some((key) => url.searchParams.has(key));
  if (!requested) return { requested: false, target: null };
  const route = decodeStudioRoute(url.href);
  const revisionText = url.searchParams.get('revision');
  const revision = revisionText && /^(?:[1-9]\d*)$/.test(revisionText) ? Number(revisionText) : NaN;
  const taskId = url.searchParams.get('task');
  const hasTask = url.searchParams.has('task');
  const ref = { processPlanId: url.searchParams.get('plan'), revision,
    planInstanceId: url.searchParams.get('instance'), ...(hasTask ? { taskId } : {}) };
  const target = route.projectId && Array.isArray(visibleProjects)
    && visibleProjects.some((project) => project.id === route.projectId)
    && PROCESS_PLAN_ID.test(ref.processPlanId ?? '') && Number.isSafeInteger(ref.revision) && ref.revision > 0
    && PLAN_INSTANCE_ID.test(ref.planInstanceId ?? '') && (!hasTask || SAFE_ID.test(taskId ?? ''))
    ? { projectId: route.projectId, processPlanId: ref.processPlanId, revision: ref.revision,
      planInstanceId: ref.planInstanceId, ...(hasTask ? { taskId } : {}), selectionKey: `${ref.processPlanId}\n${ref.revision}` }
    : null;
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

export function processPlanFreshness(plan, project) {
  const source = plan?.source;
  const latestVersion = project?.latestBlueprint?.version;
  if (!PROJECT_ID.test(project?.id ?? '') || source?.projectId !== project.id
    || !Number.isSafeInteger(source.blueprintVersion) || source.blueprintVersion < 1
    || !Number.isSafeInteger(latestVersion) || latestVersion < 1) {
    return { historical: false, link: null };
  }
  const historical = source.blueprintVersion < latestVersion;
  if (!historical || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(source.processId ?? '')) {
    return { historical, link: null };
  }
  const currentProcessExists = Object.values(project.latestBlueprint?.areas ?? {}).some((area) =>
    (area.items ?? []).some((item) => item.id === source.processId && item.type === 'process'))
    && (project.graph?.nodes ?? []).some((node) => node.id === source.processId && node.type === 'process');
  return {
    historical,
    link: currentProcessExists ? {
      label: `Plan current ${source.processName} in Execution`,
      href: encodeExecutionRoute(project.id, { projectId: project.id, processId: source.processId }),
    } : null,
  };
}

export function currentProcessPlanFocusTarget(project, processId, preferredPlanId = null) {
  const latest = project?.latestBlueprint;
  if (!PROJECT_ID.test(project?.id ?? '') || !/^blueprint-[0-9a-f-]{36}$/i.test(latest?.id ?? '')
    || !Number.isSafeInteger(latest.version) || latest.version < 1
    || !/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(processId ?? '')) return null;
  const savedProcessExists = Object.values(latest.areas ?? {}).some((area) =>
    (area.items ?? []).some((item) => item.id === processId && item.type === 'process'));
  if (!savedProcessExists) return null;
  const currentPlans = (project.processPlans ?? []).filter((plan) => plan?.source?.projectId === project.id
    && plan.source.processId === processId && plan.source.blueprintId === latest.id
    && plan.source.blueprintVersion === latest.version && PROCESS_PLAN_ID.test(plan.id ?? ''));
  const preferred = currentPlans.find((plan) => plan.id === preferredPlanId);
  const planId = preferred?.id ?? currentPlans.at(-1)?.id;
  if (!planId) return null;
  const revision = currentPlans.filter((plan) => plan.id === planId)
    .map((plan) => plan.revision)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .reduce((latestRevision, value) => Math.max(latestRevision, value), 0);
  return revision ? { processPlanId: planId, revision } : null;
}

export function processPlanRevisionFocusTarget(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'ProcessTaskGraphRevised') return null;
  const planId = event.data?.planId;
  const revision = event.data?.revision;
  if (!PROCESS_PLAN_ID.test(planId ?? '') || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { processPlanId: planId, revision };
}
