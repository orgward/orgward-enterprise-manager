const PROJECT_ID = /^project-[0-9a-f-]{36}$/;
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

export function fieldErrorsFor(error, field) {
  return (error?.fieldErrors ?? []).filter((entry) => entry.field === field).map((entry) => entry.message);
}

export function apiErrorFrom(result, fallback = 'Request failed.') {
  const detail = result?.error ?? {};
  const error = new Error(detail.message || fallback);
  Object.assign(error, detail);
  return error;
}
