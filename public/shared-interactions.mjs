const PROJECT_ID = /^project-[0-9a-f-]{36}$/;
const PROCESS_PLAN_ID = /^process-plan-[0-9a-f-]{36}$/i;
const PLAN_INSTANCE_ID = /^[0-9a-f-]{36}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/i;
const VIEWS = new Set(['blueprint', 'map', 'coverage']);
const AREA_KEYS = new Set(['purposeStrategy', 'customersOfferingsValueEconomics', 'capabilitiesProcesses', 'peopleAgents', 'responsibilityAuthority', 'resources', 'informationTechnology', 'governanceRiskControls', 'metricsFeedback', 'lifecycle']);

export function decodeStudioRoute(value = '/') {
  const url = new URL(value, 'http://orgward.local');
  const projectId = url.searchParams.get('project');
  const selectedId = url.searchParams.get('selected');
  const view = url.searchParams.get('view');
  const area = url.searchParams.get('area');
  const types = [...new Set((url.searchParams.get('types') ?? '').split(',').map((entry) => entry.trim()).filter((entry) => SAFE_ID.test(entry)))].sort();
  return {
    projectId: PROJECT_ID.test(projectId ?? '') ? projectId : null,
    view: VIEWS.has(view) ? view : 'blueprint',
    area: AREA_KEYS.has(area) ? area : null,
    selectedId: SAFE_ID.test(selectedId ?? '') ? selectedId : null,
    types,
  };
}

export function encodeStudioRoute({ projectId = null, view = 'blueprint', selectedId = null, types = [], area = null } = {}) {
  const params = new URLSearchParams();
  if (PROJECT_ID.test(projectId ?? '')) params.set('project', projectId);
  if (VIEWS.has(view) && view !== 'blueprint') params.set('view', view);
  if (AREA_KEYS.has(area)) params.set('area', area);
  if (SAFE_ID.test(selectedId ?? '')) params.set('selected', selectedId);
  const safeTypes = [...new Set(types.filter((entry) => SAFE_ID.test(entry)))].sort();
  if (safeTypes.length) params.set('types', safeTypes.join(','));
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export function encodeExecutionRoute(projectId = null, planTarget = null) {
  const studioRoute = encodeStudioRoute({ projectId });
  const url = new URL(studioRoute, 'http://orgward.local');
  if (PROJECT_ID.test(projectId ?? '') && planTarget?.projectId === projectId
    && SAFE_ID.test(planTarget.processId ?? '')) {
    url.searchParams.set('process', planTarget.processId);
  }
  if (PROJECT_ID.test(projectId ?? '') && planTarget?.projectId === projectId
    && PROCESS_PLAN_ID.test(planTarget.processPlanId ?? '')
    && Number.isSafeInteger(planTarget.revision) && planTarget.revision > 0
    && PLAN_INSTANCE_ID.test(planTarget.planInstanceId ?? '')) {
    url.searchParams.set('plan', planTarget.processPlanId);
    url.searchParams.set('revision', String(planTarget.revision));
    url.searchParams.set('instance', planTarget.planInstanceId);
  }
  return `/execution.html${url.search}`;
}

export function executionProjectContext(value, projects = []) {
  const requestedProjectId = decodeStudioRoute(value).projectId;
  const projectId = requestedProjectId && projects.some((project) => project.id === requestedProjectId)
    ? requestedProjectId : null;
  return { projectId, runProjectId: projectId, planningProjectId: projectId };
}

export function executionProcessTarget(value, projects = []) {
  const url = new URL(value, 'http://orgward.local');
  const requested = url.searchParams.has('process');
  if (!requested) return { requested: false, target: null };
  const projectId = decodeStudioRoute(url.href).projectId;
  const processId = url.searchParams.get('process');
  const projectVisible = projectId && Array.isArray(projects) && projects.some((project) => project.id === projectId);
  return {
    requested: true,
    target: projectVisible && SAFE_ID.test(processId ?? '') ? { projectId, processId } : null,
  };
}

export function fieldErrorsFor(error, field) {
  return (error?.fieldErrors ?? []).filter((entry) => entry.field === field).map((entry) => entry.message);
}

export function founderConversationAnnouncement(project, { answerSaved = false } = {}) {
  if (!project) return '';
  if (project.latestBlueprint) {
    return `Saved blueprint version ${project.latestBlueprint.version} loaded. The proposed design is ready to review.`;
  }
  const prompt = [...(project.conversation ?? [])].reverse().find((message) => message.role === 'assistant')?.content?.trim();
  if (!prompt) return answerSaved ? 'Your answer was saved.' : '';
  return `${answerSaved ? 'Answer saved.' : 'Current question.'} ${prompt}`;
}

export function apiErrorFrom(result, fallback = 'Request failed.') {
  const detail = result?.error ?? {};
  const error = new Error(detail.message || fallback);
  Object.assign(error, detail);
  return error;
}
