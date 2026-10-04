import { ENTERPRISE_PROCESS_COMMANDS, enterpriseProcessCommandPayload } from './enterprise-process.mjs';
import { ENTERPRISE_ECONOMIC_COMMANDS, enterpriseEconomicCommandPayload } from './enterprise-economics.mjs';
import { ENTERPRISE_REFINEMENT_COMMANDS, enterpriseRefinementCommandPayload } from './enterprise-refinement.mjs';
import { ENTERPRISE_INTERCHANGE_COMMANDS, enterpriseInterchangeCommandPayload } from './enterprise-interchange.mjs';
import { ENTERPRISE_BRANCH_COMMANDS, enterpriseBranchWritable, enterpriseBranchCommandPayload, enterpriseCommandResultRoute } from './enterprise-branches.mjs';
import { connectedNodeIds, filterGraph, focusFirstMapResult, focusSelectedMapControl, graphAccessibilityAttributes, mapControlPressed, searchGraph, shouldStartMapPan, toggleType, zoomTransform } from './map-state.js';
import { apiErrorFrom, decodeStudioRoute, encodeExecutionRoute, encodeStudioRoute, fieldErrorsFor, founderConversationAnnouncement } from './shared-interactions.mjs';
import { coverageAreaStateLabel, coverageForBlueprint } from './coverage-dashboard.mjs';
import { compareBlueprintObjectVersions } from './blueprint-comparison.mjs';
import { renderOutcomeInbox } from './outcomes.mjs';
import { enterpriseContextFailure, enterpriseContextReadOnly, enterpriseStateSummary, enterpriseSourceAligned, hasEnterpriseContext, enterpriseQuery, enterpriseRequestPath, persistEnterpriseCommand, restoreEnterpriseCommand, persistEnterpriseInterchangeDraft, restoreEnterpriseInterchangeDraft, submitEnterpriseCommand, renderEnterpriseContext, renderEnterpriseObject, renderEnterpriseStewardshipPanel } from './enterprise.mjs';
import { renderProjectPortfolio } from './project-portfolio.mjs';

const state = {
  projects: [],
  project: null,
  view: 'blueprint',
  mapMode: 'graph',
  mapAreaFilter: null,
  mapSearch: '',
  coverageReturnContext: null,
  coverageScopeId: null,
  activeTypes: new Set(),
  selectedId: null,
  transform: { x: 0, y: 0, k: 1 },
  foundation: null,
  sessionRoles: [],
  sessionPrincipal: null,
  projectAccess: null,
  draft: '',
  pendingCreate: null,
  pendingMessage: null,
  pendingBlueprintEdit: null,
  blueprintEditDraft: null,
  pendingActorBinding: null,
  pendingActorBindingEnable: null,
  pendingAgentEnvelope: null,
  pendingBlueprintPublication: null,
  requestedProjectId: null,
  restoringHistory: false,
  enterpriseModel: null,
  enterpriseQuery: enterpriseQuery(),
  enterpriseGeneration: 0,
  enterpriseLoading: false,
  enterpriseError: null,
  enterpriseUnavailable: null,
  enterpriseExplicit: false,
  enterpriseBusy: false,
  enterpriseStatus: '',
  enterpriseSimulation: null,
  enterpriseProcessDraft: null,
  enterpriseIntegrityDraft: null,
  enterpriseEconomicDraft: null,
  enterpriseRefinementDraft: null,
  enterpriseInterchangeDraft: null,
  pendingEnterprise: null,
  enterpriseStorageAvailable: true,
  projectLoadGeneration: 0,
};

const typeColors = {
  goal: '#c9ff7e', strategy: '#a8d67b', customer: '#f1c278', offering: '#e99c65', economics: '#dd7e69',
  capability: '#71c6a1', process: '#65a7b7', 'actor-human': '#e6d7aa', 'actor-agent': '#a9a0df', role: '#c690cf',
  resource: '#8f9f78', information: '#6e9fc8', system: '#7c83ca', decision: '#d29e6d', risk: '#e57d70', control: '#cbb66a',
  metric: '#80c6cb', 'feedback-loop': '#81d58d', lifecycle: '#9daaa2',
};

const app = document.querySelector('#app');
const select = document.querySelector('#project-select');
const toast = document.querySelector('#toast');
const appState = document.querySelector('#app-state');
const appStateTitle = document.querySelector('#app-state-title');
const appStateMessage = document.querySelector('#app-state-message');
const appStateActions = document.querySelector('#app-state-actions');
const founderAnnouncement = document.querySelector('#founder-announcement');
const foundationBadge = document.querySelector('#foundation-badge');
const signOutButton = document.querySelector('#sign-out');

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  let result;
  try { result = await response.json(); }
  catch { throw apiErrorFrom(null, 'The server returned an unreadable response.'); }
  if (!response.ok) throw Object.assign(apiErrorFrom(result), { status: response.status });
  return result;
}

function command(payload, expectedVersion, commandId = `command:${crypto.randomUUID()}`) {
  return { schemaVersion: '1.0', commandId, ...(expectedVersion === undefined ? {} : { expectedVersion }), payload };
}

function showAppState(kind, title, message, actions = []) {
  appState.dataset.kind = kind;
  appStateTitle.textContent = title;
  appStateMessage.textContent = message;
  appStateActions.replaceChildren();
  for (const action of actions) {
    const button = element('button', { className: `button ${action.primary ? 'primary' : 'ghost'}`, text: action.label, attrs: { type: 'button' } });
    button.addEventListener('click', action.run);
    appStateActions.append(button);
  }
  appState.hidden = false;
  app.setAttribute('aria-busy', String(kind === 'loading'));
}

function hideAppState() {
  if (state.foundation?.operationMode === 'read_only_legacy') {
    appState.dataset.kind = 'info';
    appStateTitle.textContent = 'Read-only legacy inspection';
    appStateMessage.textContent = 'Changes and execution are disabled until PostgreSQL is configured.';
    appStateActions.replaceChildren();
    appState.hidden = false;
    app.setAttribute('aria-busy', 'false');
    document.querySelector('#new-project')?.setAttribute('disabled', '');
    document.querySelectorAll('#create-form input, #create-form button[type="submit"], #message-input, #message-form button[type="submit"]')
      .forEach((control) => { control.disabled = true; });
    return;
  }
  appState.hidden = true;
  app.setAttribute('aria-busy', 'false');
}

function showProjectSourceWarning() {
  const source = state.foundation?.sources?.projects;
  if (!source || source.status === 'current') return;
  document.querySelector('#create-form button[type="submit"]')?.setAttribute('disabled', '');
  showAppState('error', 'Project storage unavailable', 'The actual project count cannot be verified, so no zero or sample count has been substituted. Existing readable projects may still open.', [{
    label: 'Retry status', primary: true, run: () => window.location.reload(),
  }]);
}

function showRequestFailure(error, retry) {
  if (error.code === 'AUTHENTICATION_REQUIRED') {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`/sign-in.html?returnTo=${encodeURIComponent(returnTo)}`);
    return;
  }
  const denied = error.code === 'ACTION_FORBIDDEN';
  const conflict = error.code === 'VERSION_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT';
  const validation = error.code === 'INVALID_COMMAND' || error.code === 'INVALID_JSON';
  const title = denied ? 'Action denied' : conflict ? 'Saved version changed' : validation ? 'Check entered information' : 'Workspace unavailable';
  const actions = denied
    ? [{ label: 'View access status', primary: true, run: () => { window.location.href = '/platform.html#administration'; } }]
    : retry ? [{ label: conflict ? 'Reload current version' : 'Try again', primary: true, run: retry }] : [];
  showAppState(denied ? 'denied' : conflict ? 'conflict' : 'error', title, `${error.message}${error.correlationId ? ` Reference ${error.correlationId}.` : ''}`, actions);
}

async function refreshProjectListAfterSave() {
  try {
    await refreshProjects();
    hideAppState();
  } catch (error) {
    showAppState('error', 'Saved; project list unavailable', `${error.message} The completed action will not be submitted again.${error.correlationId ? ` Reference ${error.correlationId}.` : ''}`, [{
      label: 'Refresh project list', primary: true, run: refreshProjectListAfterSave,
    }]);
  }
}

function setFieldError(id, messages) {
  const output = document.querySelector(`#${id}`);
  if (!output) return;
  output.textContent = messages.join(' ');
  output.hidden = messages.length === 0;
}

function currentRoute() {
  return { projectId: state.project?.id ?? null, view: state.view, selectedId: state.selectedId, types: [...state.activeTypes], area: state.mapAreaFilter, ...(state.enterpriseExplicit ? state.enterpriseQuery : {}) };
}

function viewedBlueprint() {
  if (state.enterpriseLoading || state.enterpriseError) return null;
  return state.enterpriseModel ? state.enterpriseModel.blueprint : state.project?.latestBlueprint;
}

function viewedGraph() {
  if (state.enterpriseLoading || state.enterpriseError) return { nodes: [], links: [], types: [] };
  return state.enterpriseModel ? state.enterpriseModel.graph : state.project?.graph ?? { nodes: [], links: [], types: [] };
}

function enterpriseReadOnly() {
  return Boolean(state.enterpriseLoading || state.enterpriseError || state.enterpriseBusy || state.pendingEnterprise || enterpriseContextReadOnly(state.enterpriseModel?.context));
}

function retainEnterprise(value) {
  state.pendingEnterprise = value;
  try {
    persistEnterpriseCommand(localStorage, state.sessionPrincipal, state.project.id, value);
    state.enterpriseStorageAvailable = true;
  } catch { state.enterpriseStorageAvailable = false; }
}

function restoreEnterprise(projectId) {
  state.pendingEnterprise = null; state.enterpriseStorageAvailable = true;
  try {
    state.pendingEnterprise = restoreEnterpriseCommand(localStorage, state.sessionPrincipal, projectId);
  } catch (error) { state.enterpriseStorageAvailable = false; state.enterpriseStatus = `${error.message} Review project activity before issuing another command.`; }
  try { state.enterpriseInterchangeDraft = restoreEnterpriseInterchangeDraft(localStorage, state.sessionPrincipal, projectId); }
  catch (error) { state.enterpriseStorageAvailable = false; state.enterpriseStatus = `${error.message} The retained source evidence draft could not be restored.`; }
}

function retainEnterpriseInterchangeDraft(value) {
  state.enterpriseInterchangeDraft = value;
  try {
    persistEnterpriseInterchangeDraft(localStorage, state.sessionPrincipal, state.project.id, value);
    state.enterpriseStorageAvailable = true;
  } catch (error) {
    state.enterpriseStorageAvailable = false;
    state.enterpriseStatus = `${error.message} Keep this page open or download the source JSON before leaving.`;
  }
}

async function loadEnterpriseContext({ render = true, resetTypes = false } = {}) {
  const projectId = state.project?.id;
  if (!projectId || !state.project.latestBlueprint) return;
  const generation = ++state.enterpriseGeneration;
  const query = { ...state.enterpriseQuery };
  let aligning = false;
  state.enterpriseLoading = true; state.enterpriseError = null; state.enterpriseUnavailable = null; state.enterpriseModel = null;
  if (render) renderStudio();
  try {
    const result = await api(enterpriseRequestPath(projectId, query, state.selectedId));
    if (generation !== state.enterpriseGeneration || state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
    if (!enterpriseSourceAligned(state.project, result.data)) {
      aligning = true;
      const refreshed = await api(`/api/v1/projects/${encodeURIComponent(projectId)}`);
      if (generation !== state.enterpriseGeneration || state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
      if (!enterpriseSourceAligned(refreshed.data, result.data)) throw Object.assign(new Error('The design changed while this perspective was loading. Reload the requested context to inspect a consistent saved version.'), { requiresReadOnly: true });
      state.project = refreshed.data;
    }
    state.enterpriseModel = result.data;
    if (resetTypes) state.activeTypes = new Set(result.data.graph.types);
  } catch (error) {
    if (generation !== state.enterpriseGeneration || state.project?.id !== projectId) return;
    const failure = enterpriseContextFailure(state.enterpriseExplicit || aligning || error.requiresReadOnly, error.message);
    state.enterpriseError = failure.error; state.enterpriseUnavailable = failure.unavailable;
  } finally {
    if (generation === state.enterpriseGeneration && state.project?.id === projectId && state.requestedProjectId === projectId) {
      state.enterpriseLoading = false;
      if (render) { renderStudio(); syncRoute('replace'); }
    }
  }
}

async function changeEnterpriseContext(query, { preserveProcessDraft = false, preserveEconomicDraft = false, preserveRefinementDraft = false, preserveInterchangeDraft = false, preserveIntegrityDraft = false, selectedId = undefined } = {}) {
  if (!allowRouteChange({ preserveProcessDraft, preserveEconomicDraft, preserveRefinementDraft, preserveInterchangeDraft, preserveIntegrityDraft })) return;
  if (selectedId !== undefined) state.selectedId = selectedId;
  state.enterpriseExplicit = true;
  state.enterpriseQuery = query;
  state.mapAreaFilter = null; state.coverageReturnContext = null; state.view = 'map';
  syncRoute('push');
  if (state.enterpriseError) {
    await loadProject(state.project.id, { history: 'replace', route: { ...currentRoute(), types: [] } });
    return;
  }
  await loadEnterpriseContext({ resetTypes: true });
}

async function saveEnterpriseCommand(payload = null) {
  if (state.enterpriseBusy || state.enterpriseLoading || !state.project) return;
  const projectId = state.project.id;
  if (!state.pendingEnterprise) {
    const model = state.enterpriseModel;
    if (!payload || state.enterpriseError || !model) return;
    let boundPayload;
    if (ENTERPRISE_PROCESS_COMMANDS.includes(payload.kind)) {
      boundPayload = enterpriseProcessCommandPayload(model, payload);
      if (!boundPayload) return;
      state.enterpriseProcessDraft = boundPayload;
    } else if (ENTERPRISE_ECONOMIC_COMMANDS.includes(payload.kind)) {
      boundPayload = enterpriseEconomicCommandPayload(model, payload);
      if (!boundPayload) return;
      state.enterpriseEconomicDraft = boundPayload;
    } else if (ENTERPRISE_REFINEMENT_COMMANDS.includes(payload.kind)) {
      boundPayload = enterpriseRefinementCommandPayload(model, payload);
      if (!boundPayload) return;
      state.enterpriseRefinementDraft = boundPayload;
    } else if (ENTERPRISE_INTERCHANGE_COMMANDS.includes(payload.kind)) {
      boundPayload = enterpriseInterchangeCommandPayload(model, payload);
      if (!boundPayload) return;
      retainEnterpriseInterchangeDraft({ ...(state.enterpriseInterchangeDraft ?? {}), recordIds: payload.recordIds, sourceSelections: payload.selections,
        reason: payload.reason, bundle: payload.bundle });
    } else if (ENTERPRISE_BRANCH_COMMANDS.includes(payload.kind)) {
      boundPayload = enterpriseBranchCommandPayload(model, payload);
      if (!boundPayload) return;
    } else {
      if (enterpriseReadOnly() || !model.permissions?.write
        || (payload.kind === 'run-integrity-checks' && !model.permissions?.integrityRun)
        || (payload.kind === 'accept-integrity-exception' && !model.permissions?.integrityException)
        || ((['create-scope', 'rename-scope', 'set-validity', 'propose-future-design'].includes(payload.kind)
          || (payload.kind === 'record-state' && payload.dimension === 'review')) && !model.permissions.scopeAdmin)) return;
      boundPayload = { ...payload, blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion };
      if (payload.kind === 'run-integrity-checks') state.enterpriseIntegrityDraft = boundPayload;
    }
    retainEnterprise({ projectId, route: currentRoute(), envelope: command(boundPayload, model.context.projectVersion, `enterprise:${crypto.randomUUID()}`) });
  }
  const saved = state.pendingEnterprise;
  if (ENTERPRISE_PROCESS_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseProcessDraft = saved.envelope.payload;
  if (ENTERPRISE_ECONOMIC_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseEconomicDraft = saved.envelope.payload;
  if (ENTERPRISE_REFINEMENT_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseRefinementDraft = saved.envelope.payload;
  if (ENTERPRISE_INTERCHANGE_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseInterchangeDraft = {
    ...(state.enterpriseInterchangeDraft ?? {}), bundle: saved.envelope.payload.bundle,
    recordIds: saved.envelope.payload.recordIds, sourceSelections: saved.envelope.payload.selections,
    reason: saved.envelope.payload.reason };
  if (saved.envelope.payload.kind === 'run-integrity-checks') state.enterpriseIntegrityDraft = saved.envelope.payload;
  const sourceGeneration = state.enterpriseGeneration;
  state.enterpriseBusy = true;
  state.enterpriseStatus = 'Saving the exact proposed design change…';
  renderStudio();
  let result = null; let definitive = false;
  try {
    result = await submitEnterpriseCommand(api, projectId, saved);
    if (state.project?.id !== projectId) return;
    retainEnterprise(null);
    if (ENTERPRISE_PROCESS_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseProcessDraft = null;
    if (ENTERPRISE_ECONOMIC_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseEconomicDraft = null;
    if (ENTERPRISE_REFINEMENT_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseRefinementDraft = null;
    if (ENTERPRISE_INTERCHANGE_COMMANDS.includes(saved.envelope.payload.kind)) retainEnterpriseInterchangeDraft(null);
    if (saved.envelope.payload.kind === 'run-integrity-checks') state.enterpriseIntegrityDraft = null;
    if (result.data.simulation) state.enterpriseSimulation = result.data.simulation;
    state.enterpriseStatus = result.data.governanceCaseId ? `Saved governance decision ${saved.envelope.payload.kind.replaceAll('-', ' ')} as ${result.data.governanceStatus} at revision ${result.data.governanceRevision}. The proposed design was unchanged.`
      : result.data.stewardshipRevision ? `Saved information stewardship ${saved.envelope.payload.kind.replaceAll('-', ' ')} at assignment revision ${result.data.stewardshipRevision}${result.data.stewardshipOutcome ? ` with outcome ${result.data.stewardshipOutcome}` : ''}. The information definition was unchanged.`
      : result.data.integrityException ? `Recorded the human exception for finding ${result.data.integrityException.findingId} in report ${result.data.integrityException.reportId}. The finding remains unresolved and the integrity result is unchanged.`
      : result.data.acceptedClaims ? `Accepted ${result.data.acceptedClaims.length} reviewed source claims into one proposed design version from source snapshot ${result.data.acceptedClaims[0]?.sourceHash ?? 'unknown'}; first claim locator ${result.data.acceptedClaims[0]?.claimLocator ?? 'not supplied'}. No work was run or published.`
      : result.data.integrityAssessment ? `Saved the ${result.data.integrityAssessment.status} integrity and lineage assessment for its exact blueprint source. No design or operational state changed.`
      : result.data.economicEvaluation ? 'Saved the exact-source economic evaluation. It contains declared assumptions and reported capacity only.'
      : result.data.simulation ? 'Saved the deterministic simulation for its exact source. No work was performed.'
      : saved.envelope.payload.kind === 'apply-reviewed-merge' ? 'Owner-reviewed merge applied to the proposed main design. Publication and execution remain separate actions.'
      : result.data.branchId ? 'Saved the exact branch command. The draft and its reviewed candidate are shown below.'
      : result.data.proposalId ? 'Future design draft saved. Inspect the proposed snapshot below; the current main design remains its original source.'
      : 'Saved. The canonical record and its new design version are shown below.';
  } catch (error) {
    if (state.project?.id !== projectId) return;
    definitive = error.status >= 400 && error.status < 500 && error.status !== 408;
    if (definitive && ENTERPRISE_ECONOMIC_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseEconomicDraft = saved.envelope.payload;
    if (definitive && ENTERPRISE_REFINEMENT_COMMANDS.includes(saved.envelope.payload.kind)) state.enterpriseRefinementDraft = saved.envelope.payload;
    if (definitive && ENTERPRISE_INTERCHANGE_COMMANDS.includes(saved.envelope.payload.kind)) retainEnterpriseInterchangeDraft({
      ...(state.enterpriseInterchangeDraft ?? {}), bundle: saved.envelope.payload.bundle,
      recordIds: saved.envelope.payload.recordIds, sourceSelections: saved.envelope.payload.selections,
      reason: saved.envelope.payload.reason });
    if (definitive && saved.envelope.payload.kind === 'run-integrity-checks') state.enterpriseIntegrityDraft = saved.envelope.payload;
    if (definitive) retainEnterprise(null);
    state.enterpriseStatus = definitive ? `${error.message} ${ENTERPRISE_PROCESS_COMMANDS.includes(saved.envelope.payload.kind) ? 'The submitted process draft is retained for its original source. ' : ''}Review the refreshed requested design before submitting a new change.`
      : `${error.message} The response is uncertain. Recover the saved command before making another change.`;
  } finally { state.enterpriseBusy = false; }
  if (state.project?.id !== projectId) return;
  if (result?.data.simulation && (sourceGeneration !== state.enterpriseGeneration || (saved.route && saved.route.selectedId !== state.selectedId))) {
    renderStudio();
  } else if (result || definitive) {
    const route = enterpriseCommandResultRoute(saved.route ?? currentRoute(), saved.envelope.payload, result?.data ?? null);
    if (result?.data.economicEvaluation) {
      const source = result.data.economicEvaluation.source;
      Object.assign(route, { blueprintVersion: source.branchId || source.proposalId ? null : source.blueprintVersion,
        branchId: source.branchId, branchRevision: source.branchRevision, proposalId: source.proposalId,
        recordedAt: null, economicEvaluationId: result.data.economicEvaluation.id,
        selectedId: result.data.economicEvaluation.economicsId });
    }
    await loadProject(projectId, { history: 'replace', route });
  } else renderStudio();
}

function syncRoute(mode = 'push') {
  syncExecutionNavigation();
  if (state.restoringHistory || !mode) return;
  const url = encodeStudioRoute(currentRoute());
  window.history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', url);
}

function syncExecutionNavigation() {
  const link = document.querySelector('#execution-nav');
  if (link) {
    if (enterpriseReadOnly()) { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
    else { link.href = encodeExecutionRoute(state.project?.id ?? null); link.removeAttribute('aria-disabled'); }
  }
}

function hasUnsavedDraft({ includeProcessDraft = true, includeEconomicDraft = true, includeRefinementDraft = true, includeInterchangeDraft = true, includeIntegrityDraft = true } = {}) { return Boolean((includeProcessDraft && state.enterpriseProcessDraft)
  || (includeEconomicDraft && state.enterpriseEconomicDraft) || (includeRefinementDraft && state.enterpriseRefinementDraft)
  || (includeInterchangeDraft && state.enterpriseInterchangeDraft) || (includeIntegrityDraft && state.enterpriseIntegrityDraft)
  || state.draft.trim() || state.pendingBlueprintEdit || state.blueprintEditDraft
  || state.pendingActorBinding || state.pendingActorBindingEnable || state.pendingEnterprise); }

function allowRouteChange({ preserveProcessDraft = false, preserveEconomicDraft = false, preserveRefinementDraft = false, preserveInterchangeDraft = false, preserveIntegrityDraft = false } = {}) {
  if (state.enterpriseBusy || state.pendingEnterprise) { notify('Recover the saved enterprise command before leaving this workspace.'); return false; }
  if (!hasUnsavedDraft({ includeProcessDraft: !preserveProcessDraft, includeEconomicDraft: !preserveEconomicDraft,
    includeRefinementDraft: !preserveRefinementDraft, includeInterchangeDraft: !preserveInterchangeDraft,
    includeIntegrityDraft: !preserveIntegrityDraft })) return true;
  const prompt = state.pendingBlueprintEdit || state.blueprintEditDraft || state.pendingActorBinding
    || (!preserveProcessDraft && state.enterpriseProcessDraft) || (!preserveEconomicDraft && state.enterpriseEconomicDraft)
    || (!preserveRefinementDraft && state.enterpriseRefinementDraft)
    || (!preserveInterchangeDraft && state.enterpriseInterchangeDraft) || (!preserveIntegrityDraft && state.enterpriseIntegrityDraft)
    ? 'Leave and discard this unsaved workspace change?' : 'Discard the unsent answer and leave this workspace?';
  const accepted = window.confirm(prompt);
  if (accepted) {
    state.pendingBlueprintEdit = null; state.blueprintEditDraft = null; state.pendingActorBinding = null; state.pendingActorBindingEnable = null;
    if (!preserveProcessDraft) state.enterpriseProcessDraft = null;
    if (!preserveEconomicDraft) state.enterpriseEconomicDraft = null;
    if (!preserveRefinementDraft) state.enterpriseRefinementDraft = null;
    if (!preserveInterchangeDraft) retainEnterpriseInterchangeDraft(null);
    if (!preserveIntegrityDraft) state.enterpriseIntegrityDraft = null;
  }
  return accepted;
}

function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function announceFounderConversation(project, options) {
  founderAnnouncement.textContent = founderConversationAnnouncement(project, options);
}

async function refreshProjects() {
  const result = await api('/api/v1/projects');
  state.projects = result.data;
  select.replaceChildren(element('option', { text: state.projects.length ? 'Choose project…' : 'No projects yet', attrs: { value: '' } }));
  for (const project of state.projects) select.append(element('option', { text: project.name, attrs: { value: project.id } }));
  select.value = state.project?.id ?? '';
  renderPortfolio();
}

function renderPortfolio() {
  const target = document.querySelector('#portfolio-list');
  if (!target) return;
  target.replaceChildren(renderProjectPortfolio(state.projects, { el: element, onOpen: (id) => {
    if (!allowRouteChange()) return;
    state.draft = '';
    state.pendingMessage = null;
    select.value = id;
    loadProject(id);
  } }));
}

function showWelcome({ history = 'push' } = {}) {
  state.projectLoadGeneration += 1;
  state.enterpriseGeneration += 1; state.enterpriseModel = null; state.enterpriseError = null; state.enterpriseLoading = false;
  state.enterpriseUnavailable = null; state.enterpriseExplicit = false;
  state.enterpriseQuery = enterpriseQuery(); state.pendingEnterprise = null; state.enterpriseStatus = '';
  state.enterpriseSimulation = null; state.enterpriseProcessDraft = null; state.enterpriseEconomicDraft = null; state.enterpriseRefinementDraft = null; state.enterpriseInterchangeDraft = null; state.enterpriseIntegrityDraft = null;
  state.requestedProjectId = null;
  state.pendingBlueprintEdit = null;
  state.blueprintEditDraft = null;
  state.pendingActorBinding = null;
  state.pendingActorBindingEnable = null;
  state.project = null;
  state.projectAccess = null;
  state.selectedId = null;
  state.mapSearch = '';
  state.activeTypes = new Set();
  state.view = 'blueprint';
  state.mapAreaFilter = null;
  state.coverageReturnContext = null;
  state.draft = '';
  state.pendingMessage = null;
  app.replaceChildren(document.querySelector('#welcome-template').content.cloneNode(true));
  const form = document.querySelector('#create-form');
  form.addEventListener('submit', createProject);
  form.elements.name.addEventListener('input', () => {
    if (state.pendingCreate && state.pendingCreate.name !== form.elements.name.value) state.pendingCreate = null;
    setFieldError('project-name-error', []);
  });
  renderPortfolio();
  select.value = '';
  hideAppState();
  showProjectSourceWarning();
  syncRoute(history);
}

async function createProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.elements.name;
  const button = form.querySelector('button');
  setFieldError('project-name-error', []);
  button.disabled = true;
  try {
    showAppState('loading', 'Creating workspace', 'Saving the project and its first durable event…');
    state.pendingCreate ??= { commandId: `project:${crypto.randomUUID()}`, name: input.value };
    const result = await api('/api/v1/projects', { method: 'POST', body: JSON.stringify(command({ name: state.pendingCreate.name }, undefined, state.pendingCreate.commandId)) });
    state.project = result.data;
    select.value = result.data.id;
    state.projectAccess = result.data.createdBy === state.sessionPrincipal ? 'owner' : null;
    state.requestedProjectId = result.data.id;
    state.pendingCreate = null;
    renderStudio();
    announceFounderConversation(state.project);
    syncRoute();
    await refreshProjectListAfterSave();
    setTimeout(() => document.querySelector('#message-input')?.focus(), 0);
  } catch (error) {
    setFieldError('project-name-error', fieldErrorsFor(error, 'payload.name'));
    showRequestFailure(error, () => form.requestSubmit());
    button.disabled = false;
  }
}

async function loadProject(id, { history = 'push', route = null } = {}) {
  if (!id) return showWelcome({ history });
  const loadGeneration = ++state.projectLoadGeneration;
  if (state.project?.id !== id) state.enterpriseStatus = '';
  if (state.project?.id !== id) { state.pendingBlueprintEdit = null; state.blueprintEditDraft = null; state.pendingActorBinding = null; state.pendingActorBindingEnable = null; state.mapSearch = ''; }
  state.requestedProjectId = id;
  state.enterpriseGeneration += 1;
  try {
    showAppState('loading', 'Loading workspace', 'Restoring saved conversation, blueprint, and view state…');
    const result = await api(`/api/v1/projects/${id}`);
    if (state.requestedProjectId !== id || loadGeneration !== state.projectLoadGeneration) return;
    if (state.project?.id !== id) { state.enterpriseProcessDraft = null; state.enterpriseEconomicDraft = null; state.enterpriseRefinementDraft = null; state.enterpriseInterchangeDraft = null; state.enterpriseIntegrityDraft = null; state.enterpriseSimulation = null; }
    state.project = result.data;
    select.value = id;
    state.projectAccess = null;
    if (state.sessionPrincipal && state.sessionRoles.includes('workspace-write')) {
      try {
        const members = await api(`/api/v1/projects/${id}/members`);
        state.projectAccess = members.data.find((member) => member.principal === state.sessionPrincipal)?.access ?? null;
      } catch {
        // Readers cannot open the owner/editor roster; publication remains hidden.
      }
    }
    if (state.requestedProjectId !== id || loadGeneration !== state.projectLoadGeneration) return;
    const validTypes = new Set(state.project.graph.types);
    state.activeTypes = new Set(route?.types?.filter((type) => validTypes.has(type)) ?? state.project.graph.types);
    if (!state.activeTypes.size) state.activeTypes = new Set(state.project.graph.types);
    state.selectedId = route?.selectedId ?? null;
    state.mapAreaFilter = route?.area ?? null;
    state.coverageReturnContext = null;
    state.view = state.project.latestBlueprint && ['map', 'coverage'].includes(route?.view) ? route.view : 'blueprint';
    state.enterpriseQuery = enterpriseQuery(route ?? {});
    state.enterpriseExplicit = hasEnterpriseContext(route ?? {});
    state.enterpriseModel = null; state.enterpriseError = null; state.enterpriseLoading = false;
    restoreEnterprise(id);
    await loadEnterpriseContext({ render: false });
    if (state.requestedProjectId !== id || loadGeneration !== state.projectLoadGeneration) return;
    if (!state.enterpriseError) {
      const types = viewedGraph().types;
      state.activeTypes = new Set(route?.types?.filter((type) => types.includes(type)) ?? types);
      if (!state.activeTypes.size) state.activeTypes = new Set(types);
    }
    renderStudio();
    announceFounderConversation(state.project);
    hideAppState();
    syncRoute(history);
  } catch (error) {
    if (state.requestedProjectId !== id || loadGeneration !== state.projectLoadGeneration) return;
    showRequestFailure(error, () => loadProject(id, { history, route }));
  }
}

function renderStudio() {
  app.replaceChildren(document.querySelector('#studio-template').content.cloneNode(true));
  document.querySelector('.studio').classList.toggle('complete', state.project.phase !== 'discovery');
  document.querySelector('#project-title').textContent = state.project.name;
  setupGitHubOnboarding();
  if (!enterpriseReadOnly()) app.append(renderOutcomeInbox({ projectId: state.project.id, principal: state.sessionPrincipal, el: element, api }));
  renderConversation();
  document.querySelector('#message-form').addEventListener('submit', sendMessage);
  const textarea = document.querySelector('#message-input');
  textarea.value = state.draft;
  if (enterpriseReadOnly()) for (const control of document.querySelectorAll('#message-form input, #message-form textarea, #message-form button')) control.disabled = true;
  textarea.addEventListener('input', () => {
    state.draft = textarea.value;
    if (state.pendingMessage && state.pendingMessage.content !== state.draft) state.pendingMessage = null;
    setFieldError('message-error', []);
  });
  for (const button of document.querySelectorAll('.view-tabs button')) button.addEventListener('click', () => setView(button.dataset.view));

  if (state.project.latestBlueprint) {
    document.querySelector('#workspace-empty').hidden = true;
    document.querySelector('#blueprint-workspace').hidden = false;
    const contextPanel = renderEnterpriseContext({ model: state.enterpriseModel, query: state.enterpriseQuery,
      loading: state.enterpriseLoading || state.enterpriseBusy, error: state.enterpriseError, unavailable: state.enterpriseUnavailable,
      pending: state.pendingEnterprise, status: state.enterpriseStatus, storageAvailable: state.enterpriseStorageAvailable,
      integrityDraft: state.enterpriseIntegrityDraft,
      el: element, onContext: changeEnterpriseContext, onCommand: saveEnterpriseCommand,
      onInspectFinding: (finding) => changeEnterpriseContext({ lensId: 'all', scopeId: null, blueprintVersion: null,
        proposalId: null, effectiveAt: null, recordedAt: null, branchId: null, branchRevision: null,
        simulationId: null, economicEvaluationId: null }, { preserveProcessDraft: true, preserveEconomicDraft: true,
        preserveRefinementDraft: true, preserveInterchangeDraft: true, preserveIntegrityDraft: true,
        selectedId: finding.objectId ?? null }),
      onRetry: () => saveEnterpriseCommand(), onReload: () => loadEnterpriseContext() });
    document.querySelector('#blueprint-workspace').prepend(contextPanel);
    document.querySelector('#blueprint-title').textContent = viewedBlueprint()?.title ?? 'Requested saved design';
    document.querySelector('#blueprint-version').textContent = viewedBlueprint()?.version ?? 'unavailable';
    if (!state.activeTypes.size) state.activeTypes = new Set(state.project.graph.types);
    renderBlueprint();
    setView(state.view, { history: null });
    setupMapControls();
  }
}

async function refreshGitHubSnapshots() {
  const status = document.querySelector('#github-onboarding-status');
  const list = document.querySelector('#github-onboarding-snapshots');
  if (!status || !list || !state.project) return;
  status.textContent = 'Loading captured snapshots…';
  try {
    const result = await api(`/api/execution/github-repositories?projectId=${encodeURIComponent(state.project.id)}`);
    const form = document.querySelector('#github-onboarding-form');
    const connect = document.querySelector('#github-installation-connect');
    for (const control of form?.elements ?? []) control.disabled = !result.configured;
    if (connect) connect.disabled = !result.configured;
    const connected = new URLSearchParams(location.search).get('github_installation') === 'connected';
    status.textContent = connected ? 'GitHub App installation connected to this tenant.'
      : !result.available ? 'Repository snapshots require the PostgreSQL-backed installation.'
      : !result.configured ? 'GitHub App onboarding is disabled until the server operator configures the App and user OAuth callback.' : '';
    const installationSelect = document.querySelector('#github-onboarding-form select[name="installationId"]');
    const repositorySelect = document.querySelector('#github-onboarding-form select[name="repositoryId"]');
    const captureButton = document.querySelector('#github-onboarding-form button[type="submit"]');
    if (installationSelect) {
      installationSelect.replaceChildren(element('option', { text: result.installations?.length ? 'Choose a connected installation' : 'Connect an installation first', attrs: { value: '' } }));
      for (const installation of result.installations ?? []) installationSelect.append(element('option', {
        text: `${installation.accountLogin} · ${installation.accountType}`, attrs: { value: installation.installationId },
      }));
    }
    if (repositorySelect) {
      repositorySelect.replaceChildren(element('option', { text: 'Choose an installation first', attrs: { value: '' } }));
      repositorySelect.disabled = true;
    }
    if (captureButton) captureButton.disabled = true;
    list.replaceChildren();
    for (const repository of result.repositories ?? []) for (const snapshot of repository.snapshots ?? []) {
      const useSnapshot = element('a', { text: 'Use this snapshot in an Execution task', attrs: {
        href: encodeExecutionRoute(state.project.id, null, null, snapshot.id),
        'data-github-snapshot-handoff': snapshot.id,
      } });
      useSnapshot.addEventListener('click', (event) => {
        if (!allowRouteChange()) event.preventDefault();
      });
      list.append(element('li', {}, [
        element('span', { text: `${repository.repositoryName} · ${repository.branchRef} · ${snapshot.commitOid} · ${snapshot.fileCount} files / ${snapshot.totalBytes} bytes · tree ${snapshot.treeDigest}` }),
        useSnapshot,
      ]));
    }
  } catch (error) {
    status.textContent = error.message;
    list.replaceChildren();
  }
}

function setupGitHubOnboarding() {
  const panel = document.querySelector('#github-onboarding');
  if (!panel) return;
  const allowed = !enterpriseReadOnly() && state.projectAccess === 'owner' && state.sessionRoles.includes('tenant-admin');
  panel.hidden = !allowed;
  if (!allowed) return;
  const form = document.querySelector('#github-onboarding-form');
  const connect = document.querySelector('#github-installation-connect');
  const installationSelect = form.elements.installationId;
  const repositorySelect = form.elements.repositoryId;
  const captureButton = form.querySelector('button[type="submit"]');
  installationSelect.addEventListener('change', async () => {
    const installationId = installationSelect.value;
    repositorySelect.replaceChildren(element('option', { text: installationId ? 'Loading accessible repositories…' : 'Choose an installation first', attrs: { value: '' } }));
    repositorySelect.disabled = true;
    captureButton.disabled = true;
    if (!installationId) return;
    const status = document.querySelector('#github-onboarding-status');
    status.textContent = 'Checking this installation and loading its accessible repositories…';
    try {
      const result = await api(`/api/execution/github-installations/${encodeURIComponent(installationId)}/repositories?projectId=${encodeURIComponent(state.project.id)}`);
      if (installationSelect.value !== installationId) return;
      repositorySelect.replaceChildren(element('option', { text: 'Choose an accessible repository', attrs: { value: '' } }));
      for (const repository of result.repositories ?? []) {
        const branch = repository.defaultBranch ? ` · default ${repository.defaultBranch}` : '';
        repositorySelect.append(element('option', { text: `${repository.fullName}${branch}`, attrs: { value: repository.repositoryId } }));
      }
      repositorySelect.disabled = false;
      status.textContent = result.repositories?.length ? 'Choose a repository currently accessible to this installation.'
        : 'This installation currently has no accessible repositories.';
    } catch (error) {
      if (installationSelect.value === installationId) status.textContent = error.message;
    }
  });
  repositorySelect.addEventListener('change', () => { captureButton.disabled = !repositorySelect.value; });
  connect.addEventListener('click', async () => {
    const status = document.querySelector('#github-onboarding-status');
    connect.disabled = true;
    status.textContent = 'Starting a one-time GitHub installation flow…';
    try {
      const result = await api('/api/execution/github-installation/start', { method: 'POST',
        body: JSON.stringify({ projectId: state.project.id }) });
      const continueLink = element('a', { text: 'Continue to GitHub in a new tab', attrs: {
        href: result.authorizationUrl, target: '_blank', rel: 'noopener noreferrer',
      } });
      status.replaceChildren(document.createTextNode('One-time connection flow ready. '), continueLink);
      connect.disabled = false;
    } catch (error) { status.textContent = error.message; connect.disabled = false; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = document.querySelector('#github-onboarding-status');
    button.disabled = true;
    status.textContent = 'Checking installation access and capturing the pinned source…';
    try {
      await api('/api/execution/github-repositories', { method: 'POST', body: JSON.stringify({
        projectId: state.project.id,
        installationId: form.elements.installationId.value.trim(),
        repositoryId: form.elements.repositoryId.value.trim(),
        branchRef: form.elements.branchRef.value.trim(),
      }) });
      status.textContent = 'Immutable source snapshot captured and saved.';
      await refreshGitHubSnapshots();
    } catch (error) {
      status.textContent = error.message;
    } finally { button.disabled = false; }
  });
  if (new URLSearchParams(location.search).get('github_installation') === 'connected') {
    document.querySelector('#github-onboarding-status').textContent = 'GitHub App installation connected to this tenant.';
  }
  void refreshGitHubSnapshots();
}

function renderConversation() {
  const project = state.project;
  const container = document.querySelector('#conversation');
  for (const message of project.conversation) {
    const author = message.role === 'assistant' ? 'OrgWard' : 'You';
    const card = element('article', { className: `message ${message.role}` }, [
      element('header', {}, [element('span'), document.createTextNode(author)]),
      element('p', { text: message.content }),
    ]);
    container.append(card);
  }
  container.scrollTop = container.scrollHeight;
  document.querySelectorAll('.discovery-progress i').forEach((bar, index) => bar.classList.toggle('complete', index < project.questionIndex));
  const form = document.querySelector('#message-form');
  if (project.phase !== 'discovery') {
    form.classList.add('complete');
    document.querySelector('#question-count').textContent = 'Discovery complete · Blueprint saved';
  } else {
    document.querySelector('#question-count').textContent = `Question ${project.questionIndex + 1} of 4`;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (enterpriseReadOnly()) return;
  const form = event.currentTarget;
  const textarea = form.elements['message-input'];
  const button = form.querySelector('button');
  state.draft = textarea.value;
  setFieldError('message-error', []);
  button.disabled = true;
  const projectId = state.project.id;
  try {
    state.pendingMessage ??= { commandId: `message:${crypto.randomUUID()}`, content: state.draft };
    showAppState('loading', 'Saving answer', 'Keeping this draft until the server confirms its durable version…');
    const result = await api(`/api/v1/projects/${projectId}/messages`, {
      method: 'POST', body: JSON.stringify(command({ content: state.pendingMessage.content }, state.project.version, state.pendingMessage.commandId)),
    });
    if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
    state.project = result.data;
    state.pendingMessage = null;
    state.draft = '';
    if (!state.project.latestBlueprint) announceFounderConversation(state.project, { answerSaved: true });
    if (state.project.latestBlueprint) {
      await loadEnterpriseContext({ render: false });
      if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
      state.activeTypes = new Set(state.project.graph.types);
      state.view = 'blueprint';
      notify('Blueprint saved with integrity checks.');
    }
    renderStudio();
    syncRoute('replace');
    if (state.project.latestBlueprint) await refreshProjectListAfterSave(); else hideAppState();
    setTimeout(() => document.querySelector('#message-input')?.focus(), 0);
  } catch (error) {
    setFieldError('message-error', fieldErrorsFor(error, 'payload.content'));
    showRequestFailure(error, error.code === 'VERSION_CONFLICT'
      ? async () => { await loadProject(state.project.id, { history: null, route: currentRoute() }); document.querySelector('#message-input')?.focus(); }
      : () => form.requestSubmit());
    button.disabled = false;
  }
}

function setView(view, { history = 'push' } = {}) {
  state.view = view;
  document.querySelector('#blueprint-view').hidden = view !== 'blueprint';
  document.querySelector('#map-view').hidden = view !== 'map';
  document.querySelector('#coverage-view').hidden = view !== 'coverage';
  document.querySelectorAll('.view-tabs button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.view === view)));
  if (view === 'coverage') renderCoverage();
  if (view === 'map') {
    if (window.matchMedia('(max-width: 560px)').matches && state.mapMode === 'graph') state.mapMode = 'list';
    renderMap();
  }
  syncRoute(history);
}

function drillToCoverageArea(areaKey) {
  const area = viewedBlueprint()?.areas[areaKey];
  if (!area) return;
  state.coverageReturnContext = {
    projectId: state.project.id, view: 'coverage', selectedId: state.selectedId,
    types: [...state.activeTypes], mapMode: state.mapMode, area: state.mapAreaFilter,
  };
  const node = area.items.find((item) => viewedGraph().nodes.some((graphNode) => graphNode.id === item.id));
  state.mapAreaFilter = areaKey;
  state.activeTypes = new Set(area.items.map((item) => item.type));
  state.selectedId = node?.id ?? null;
  state.mapMode = 'list';
  setView('map');
}

function returnToCoverage() {
  const context = state.coverageReturnContext;
  if (context?.projectId === state.project.id) {
    state.selectedId = context.selectedId;
    state.activeTypes = new Set(context.types);
    state.mapMode = context.mapMode;
    state.mapAreaFilter = context.area;
  } else state.mapAreaFilter = null;
  state.coverageReturnContext = null;
  setView('coverage');
}

function appendPublicationDisclosure(list, values, emptyMessage, labelFor = (value) => value) {
  if (!values.length) list.append(element('li', { text: emptyMessage }));
  else for (const value of values) list.append(element('li', { text: labelFor(value) }));
}

function renderBlueprintPublication(coverage) {
  const section = element('section', { className: 'blueprint-publication', attrs: { 'aria-labelledby': 'blueprint-publication-heading' } });
  section.append(element('h4', { text: 'Internal design baseline', attrs: { id: 'blueprint-publication-heading' } }));
  const latest = state.project.latestBlueprint;
  const publication = (state.project.blueprintPublications ?? []).at(-1) ?? null;
  if (publication) {
    section.append(element('p', { text: latest.version > publication.blueprintVersion
      ? `Published internal design baseline: blueprint v${publication.blueprintVersion}. Newer proposed draft: v${latest.version}.`
      : `Published internal design baseline: blueprint v${publication.blueprintVersion}.` }));
  } else {
    section.append(element('p', { text: 'No internal design baseline has been published. This record will not mean complete, verified, ready, or operational.' }));
  }
  section.append(element('p', { text: `Review proposed blueprint v${latest.version} (${latest.title}) and these disclosures before publishing the internal baseline.` }));
  section.append(element('p', { className: 'edit-help', text: 'Publication remains inside this private project. It does not verify evidence, grant permissions, enable assignments, or change operational status.' }));

  const areas = Object.entries(latest.areas ?? {});
  const unknownAreas = areas.filter(([, area]) => area.status === 'unknown');
  const outOfScopeAreas = areas.filter(([, area]) => area.status === 'out_of_scope');
  const disclosures = element('div', { className: 'publication-disclosures' });
  const gaps = element('ul', { attrs: { 'aria-label': 'Open design gaps to record' } });
  appendPublicationDisclosure(gaps, coverage.gaps, 'No open design gaps recorded; this does not mean verified.', (gap) => `${gap.severity} · ${gap.action}`);
  disclosures.append(element('h5', { text: `Open design gaps (${coverage.gaps.length})` }), gaps);
  const areaList = element('ul', { attrs: { 'aria-label': 'Unknown and out-of-scope areas to record' } });
  appendPublicationDisclosure(areaList, unknownAreas, 'No areas marked unknown.', ([key, area]) => `${area.label ?? key} — unknown`);
  appendPublicationDisclosure(areaList, outOfScopeAreas, 'No areas marked out of scope.', ([key, area]) => `${area.label ?? key} — out of scope`);
  disclosures.append(element('h5', { text: 'Unknown and out-of-scope areas' }), areaList);
  const assumptions = element('ul', { attrs: { 'aria-label': 'Untested assumptions to record' } });
  appendPublicationDisclosure(assumptions, coverage.assumptions, 'No assumptions recorded; this does not mean verified.');
  disclosures.append(element('h5', { text: `Untested assumptions (${coverage.assumptions.length})` }), assumptions);
  const unknowns = element('ul', { attrs: { 'aria-label': 'Recorded unknowns to retain' } });
  appendPublicationDisclosure(unknowns, coverage.unknowns, 'No recorded unknowns.');
  disclosures.append(element('h5', { text: `Recorded unknowns (${coverage.unknowns.length})` }), unknowns);
  section.append(disclosures);
  if (state.projectAccess !== 'owner' || !state.sessionPrincipal || !state.sessionRoles.includes('workspace-write')) return section;

  const form = element('form', { className: 'publication-acknowledgment' });
  const acknowledgmentId = 'publication-disclosure-acknowledgment';
  const checkbox = element('input', { attrs: { id: acknowledgmentId, name: 'acknowledgeDisclosures', type: 'checkbox', required: '' } });
  form.append(element('label', { className: 'publication-acknowledgment-option', attrs: { for: acknowledgmentId } }, [
    checkbox, element('span', { text: 'I reviewed the gaps, unknown and out-of-scope areas, assumptions, and recorded unknowns above.' }),
  ]));
  const message = element('p', { className: 'publication-message', attrs: { role: 'status', 'aria-live': 'polite' } });
  const submit = element('button', { className: 'button primary', text: `Publish blueprint v${latest.version} as internal design baseline`, attrs: { type: 'submit' } });
  form.append(submit, message);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!checkbox.checked) return;
    const projectId = state.project.id;
    const payload = { blueprintId: latest.id, blueprintVersion: latest.version, acknowledgeDisclosures: true };
    const existing = state.pendingBlueprintPublication?.projectId === projectId
      && state.pendingBlueprintPublication.payload.blueprintId === latest.id ? state.pendingBlueprintPublication : null;
    const pending = existing ?? {
      projectId, payload, expectedVersion: state.project.version,
      commandId: `blueprint-publication:${crypto.randomUUID()}`,
    };
    state.pendingBlueprintPublication = pending;
    submit.disabled = true;
    message.textContent = 'Saving the immutable publication record…';
    try {
      const result = await api(`/api/v1/projects/${projectId}/blueprint/publications`, {
        method: 'POST', body: JSON.stringify(command(pending.payload, pending.expectedVersion, pending.commandId)),
      });
      if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
      state.pendingBlueprintPublication = null;
      state.project = result.data;
      state.projectAccess = 'owner';
      await loadEnterpriseContext({ render: false });
      if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
      renderStudio();
      notify(`Published blueprint v${latest.version} as an internal design baseline.`);
    } catch (failure) {
      message.textContent = `${failure.message}${failure.correlationId ? ` Reference ${failure.correlationId}.` : ''}`;
      submit.disabled = false;
      if (failure.code === 'VERSION_CONFLICT' || failure.code === 'BLUEPRINT_PUBLICATION_NOT_LATEST') {
        state.pendingBlueprintPublication = null;
        const reload = element('button', { className: 'button ghost', text: 'Reload the latest blueprint', attrs: { type: 'button' } });
        reload.addEventListener('click', () => loadProject(projectId, { history: 'replace', route: { view: 'coverage' } }));
        message.append(document.createTextNode(' '), reload);
      } else if (failure.retryable || !failure.code) {
        const retry = element('button', { className: 'button ghost', text: 'Retry publication', attrs: { type: 'button' } });
        retry.addEventListener('click', () => form.requestSubmit());
        message.append(document.createTextNode(' '), retry);
      }
    }
  });
  section.append(form);
  return section;
}

function renderCoverage() {
  const target = document.querySelector('#coverage-view');
  if (!target) return;
  if (!viewedBlueprint()) { target.replaceChildren(); return; }
  let coverage = coverageForBlueprint(viewedBlueprint(), { scopeId: state.coverageScopeId });
  if (state.coverageScopeId && !coverage.scope) {
    state.coverageScopeId = null;
    coverage = coverageForBlueprint(viewedBlueprint());
  }
  target.replaceChildren();
  if (!enterpriseReadOnly()) target.append(renderBlueprintPublication(coverage));
  else target.append(element('p', { text: 'This saved context is read only. Publication requires the current saved design.' }));
  target.append(element('div', { className: 'coverage-heading' }, [
    element('div', {}, [element('span', { className: 'eyebrow', text: 'Saved blueprint coverage' }), element('h3', { text: `Version ${coverage.blueprintVersion} · ${coverage.epistemicStatus.replaceAll('-', ' ')}` })]),
    element('p', { text: 'This is proposed design coverage. Founder chat and edit history provide provenance, not independent business evidence or verification.' }),
  ]));
  const totals = element('div', { className: 'coverage-counts', attrs: { 'aria-label': 'Coverage counts' } });
  for (const [value, label] of [[coverage.areaCounts.designed, 'Designed areas'], [coverage.areaCounts.unknown, 'Unknown areas'], [coverage.areaCounts.outOfScope, 'Out of scope'], [coverage.gaps.length, 'Open design gaps'], [coverage.assumptions.length, 'Untested assumptions'], [coverage.unknowns.length, 'Recorded unknowns']]) {
    totals.append(element('div', {}, [element('strong', { text: value }), element('span', { text: label })]));
  }
  target.append(totals);
  const scopeLabel = element('label', { text: 'Organizational scope for the 16 perspective summaries' });
  const scopeSelect = element('select', { attrs: { 'aria-label': 'Organizational scope for completeness' } });
  scopeSelect.append(element('option', { text: 'All saved design objects', attrs: { value: '' } }));
  for (const scope of coverage.availableScopes) scopeSelect.append(element('option', {
    text: `${scope.type.replaceAll('-', ' ')} · ${scope.name}`, attrs: { value: scope.id },
  }));
  scopeSelect.value = coverage.scope?.id ?? '';
  scopeSelect.addEventListener('change', () => { state.coverageScopeId = scopeSelect.value || null; renderCoverage(); });
  scopeLabel.append(scopeSelect);
  target.append(scopeLabel, element('p', { className: 'coverage-scope-note', text: 'The six legacy area groupings below remain project-wide; the scope selector applies to the 16 perspective summaries only.' }));
  if (coverage.scope) target.append(element('p', { className: 'coverage-scope-note', text: `Showing ${coverage.scope.objectCount} objects assigned to ${coverage.scope.type} “${coverage.scope.name}”. ${coverage.excludedByScope} other design objects are outside this scope.` }));
  target.append(element('section', { className: 'coverage-multiaxis', attrs: { 'aria-label': 'Explainable multi-axis completeness across 16 enterprise perspectives' } }, [
    element('h4', { text: 'Multi-axis completeness · 16 enterprise perspectives' }),
    element('p', { text: 'Each perspective reports separate model, organizational scope, relationship, design-gap, provenance/confidence and declared-time axes. Counts overlap across perspectives and are not a readiness score or verification claim.' }),
  ]));
  const axes = target.querySelector('.coverage-multiaxis');
  const perspectiveGrid = element('div', { className: 'coverage-perspective-grid' });
  for (const perspective of coverage.perspectives) {
    const card = element('details', { className: 'coverage-perspective' });
    const missing = perspective.missingTypes.length ? ` · absent types: ${perspective.missingTypes.join(', ')}` : '';
    card.append(element('summary', { text: `${perspective.id} · ${perspective.label} · ${perspective.objectCount} scoped objects${missing}` }));
    const list = element('ul');
    const typeCoverage = Object.entries(perspective.typeCounts).map(([type, count]) => `${type} ${count}`).join(' · ') || 'No typed records';
    list.append(element('li', { text: `Model types: ${typeCoverage}. Counts are records in the selected perspective.` }));
    list.append(element('li', { text: `Organizational scope across ${perspective.scope.totalPerspectiveRecords} records in this lens: ${perspective.scope.scoped} assigned · ${perspective.scope.unscoped} explicitly unscoped · ${perspective.scope.unknown} unknown. The selected scope filters the records shown above.` }));
    list.append(element('li', { text: `Relationships: ${perspective.relationships.internal} within selected perspective/scope · ${perspective.relationships.crossingLens} cross-lens · ${perspective.relationships.crossingScope} cross-scope · ${perspective.relationships.crossingBoth} crossing both boundaries · ${perspective.relationships.dangling} with a missing endpoint.` }));
    list.append(element('li', { text: `Design records: ${perspective.design.recordStatus.designed} designed · ${perspective.design.recordStatus.unknown} explicitly unknown · ${perspective.design.recordStatus.out_of_scope} out of scope; ${perspective.design.objectSpecificGaps} record-specific gaps · ${perspective.design.areaContextGaps} area-level context gaps (${perspective.design.highSeverityGaps} high/critical) · ${perspective.design.provenanceRecords} provenance records.` }));
    list.append(element('li', { text: `Recorded confidence: ${perspective.design.confidence.low} low, ${perspective.design.confidence.medium} medium, ${perspective.design.confidence.high} high. Confidence is not evidence strength.` }));
    list.append(element('li', { text: `Time applicability: ${perspective.time.status === 'DECLARED' ? `${perspective.time.validity.effectiveFrom ?? 'start unspecified'} to ${perspective.time.validity.effectiveTo ?? 'end unspecified'}; ${perspective.time.validity.evidenceKind ?? 'declared'}` : 'unknown; no validity interval is declared.'}` }));
    if (perspective.scope.assignments.length) list.append(element('li', { text: `Scope records: ${perspective.scope.assignments.map((scope) => `${scope.type} “${scope.name}” (${scope.objectCount})`).join('; ')}.` }));
    card.append(list); perspectiveGrid.append(card);
  }
  axes.append(perspectiveGrid);
  target.append(element('p', { className: 'coverage-overlap', text: 'Lens area counts overlap: Customers, offerings, value & economics appears in both Commercial and Financial & resources. Do not add lens totals.' }));
  const lenses = element('div', { className: 'coverage-lenses' });
  for (const lens of coverage.lenses) {
    const card = element('section', { className: 'coverage-lens', attrs: { 'aria-labelledby': `coverage-lens-${lens.id}` } });
    card.append(element('h4', { text: lens.label, attrs: { id: `coverage-lens-${lens.id}` } }));
    card.append(element('p', { className: 'coverage-lens-counts', text: `${lens.objectCount} proposed objects · ${lens.gapCount} gaps (${lens.highGapCount} high severity) · ${lens.unknownObjectCount} unknown objects · ${lens.outOfScopeObjectCount} out-of-scope objects` }));
    card.append(element('p', { className: 'coverage-confidence', text: `Recorded confidence: ${lens.confidence.low} low, ${lens.confidence.medium} medium, ${lens.confidence.high} high · ${lens.provenanceCount} provenance records. Confidence is not evidence strength; provenance records source history, not verification.` }));
    for (const area of lens.areas) {
      const row = element('div', { className: 'coverage-area' });
      row.append(element('div', {}, [element('strong', { text: area.label }), element('span', { text: coverageAreaStateLabel(area) })]));
      if (area.unknownCount || area.outOfScopeCount) row.append(element('span', { className: 'coverage-unknown-note', text: `${area.unknownCount} object(s) explicitly unknown · ${area.outOfScopeCount} object(s) explicitly out of scope` }));
      if (area.status === 'designed' && area.objectCount) {
        const button = element('button', { className: 'button ghost', text: 'Open this area in map list', attrs: { type: 'button' } });
        button.addEventListener('click', () => drillToCoverageArea(area.key));
        row.append(button);
      } else {
        const note = !area.exists ? 'The area is absent from this saved blueprint; its coverage is unknown.'
          : area.status === 'unknown' ? 'The area is explicitly marked unknown; no design coverage is claimed.'
            : area.status === 'out_of_scope' ? 'The area is explicitly out of scope; no design is claimed.'
              : 'The area is marked designed but contains no objects; inspect the integrity gaps.';
        row.append(element('span', { className: 'coverage-unknown-note', text: note }));
      }
      if (area.gaps.length) {
        const list = element('ul', { className: 'coverage-gap-list' });
        for (const gap of area.gaps) list.append(element('li', {}, [element('strong', { text: `${gap.severity} gap` }), document.createTextNode(` · Next: ${gap.action}`)]));
        row.append(list);
      }
      card.append(row);
    }
    lenses.append(card);
  }
  target.append(lenses);
  const confidence = element('section', { className: 'coverage-notes' }, [element('h4', { text: 'Assumptions and unknowns' })]);
  confidence.append(element('p', { text: `Recorded object confidence: ${coverage.confidence.low} low, ${coverage.confidence.medium} medium, ${coverage.confidence.high} high. Confidence is attached to proposed objects; no independent evidence is represented by this count.` }));
  confidence.append(element('p', { text: `${coverage.provenanceCount} provenance records are retained across the blueprint. Founder chat and later edits identify origin only; they are not independent evidence.` }));
  for (const [title, items] of [['Untested assumptions', coverage.assumptions], ['Unknowns recorded in the brief', coverage.unknowns]]) {
    confidence.append(element('h5', { text: title }));
    const list = element('ul');
    if (!items.length) list.append(element('li', { text: 'None recorded; absence does not mean verified.' }));
    for (const item of items) list.append(element('li', { text: item }));
    confidence.append(list);
  }
  if (coverage.errors.length) {
    const errors = element('section', { className: 'coverage-notes', attrs: { 'aria-label': 'Integrity errors' } }, [element('h4', { text: 'Integrity errors' })]);
    const list = element('ul');
    for (const error of coverage.errors) list.append(element('li', { text: `${error.code}: ${error.message}` }));
    errors.append(list); target.append(errors);
  }
  target.append(confidence);
}

function renderBlueprint() {
  const blueprint = viewedBlueprint();
  if (!blueprint) return;
  const brief = state.project.brief;
  const view = document.querySelector('#blueprint-view');
  const summary = element('div', { className: 'summary-strip' });
  for (const [value, label] of [
    [blueprint.summary.areaCount, 'Design areas'], [blueprint.summary.objectCount, 'Linked objects'],
    [blueprint.summary.relationCount, 'Relationships'], [blueprint.integrity.gaps.length, 'Visible gaps'],
  ]) summary.append(element('div', {}, [element('strong', { text: value }), element('span', { text: label })]));
  view.append(summary);

  const briefCard = element('section', { className: 'brief-card' }, [
    element('div', { className: 'eyebrow', text: 'Saved business scope' }),
    element('h3', { text: brief.title }),
    element('p', { text: brief.scope }),
    element('div', { className: 'brief-columns' }, [
      element('div', {}, [element('b', { text: 'Customer value' }), element('p', { text: brief.customerValue })]),
      element('div', {}, [element('b', { text: 'Economics & constraints' }), element('p', { text: brief.economicsAndConstraints })]),
    ]),
  ]);
  view.append(briefCard);

  view.append(element('p', { className: 'integrity-line' }, [
    element('i'), document.createTextNode(`${blueprint.integrity.valid ? 'Reference and structure checks passed' : 'Integrity errors found'} · ${blueprint.epistemicStatus.replace('-', ' ')} · confidence and provenance retained`),
  ]));
  const grid = element('div', { className: 'area-grid' });
  for (const entry of Object.values(blueprint.areas)) {
    const list = element('ul');
    for (const object of entry.items) list.append(element('li', { text: object.name }));
    grid.append(element('article', { className: 'area-card' }, [
      element('header', {}, [element('h3', { text: entry.label }), element('span', { text: entry.status.replace('_', ' ') })]), list,
    ]));
  }
  view.append(grid);
  const gaps = element('section', { className: 'gaps' }, [element('h3', { text: 'Actionable gaps' })]);
  for (const gap of blueprint.integrity.gaps) gaps.append(element('div', { className: 'gap' }, [element('b', { text: gap.severity }), element('span', { text: gap.action })]));
  view.append(gaps);
}

function setupMapControls() {
  const search = document.querySelector('#map-search');
  search.value = state.mapSearch;
  search.addEventListener('input', () => {
    state.mapSearch = search.value;
    renderMap();
  });
  document.querySelector('#graph-mode').addEventListener('click', () => setMapMode('graph'));
  document.querySelector('#list-mode').addEventListener('click', () => setMapMode('list'));
  document.querySelector('#map-results-jump').addEventListener('click', () => {
    const canvas = document.querySelector(state.mapMode === 'graph' ? '#graph-canvas' : '#list-canvas');
    focusFirstMapResult(canvas, state.mapMode);
  });
  document.querySelector('#zoom-in').addEventListener('click', () => zoomBy(1.2));
  document.querySelector('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
  document.querySelector('#zoom-reset').addEventListener('click', () => { state.transform = { x: 0, y: 0, k: 1 }; renderGraph(); });
}

function setMapMode(mode) {
  state.mapMode = mode;
  document.querySelector('#graph-mode').setAttribute('aria-pressed', String(mode === 'graph'));
  document.querySelector('#list-mode').setAttribute('aria-pressed', String(mode === 'list'));
  document.querySelector('#graph-canvas').hidden = mode !== 'graph';
  document.querySelector('#list-canvas').hidden = mode !== 'list';
  document.querySelector('#zoom-in').hidden = mode !== 'graph';
  document.querySelector('#zoom-out').hidden = mode !== 'graph';
  document.querySelector('#zoom-reset').hidden = mode !== 'graph';
  if (mode === 'graph') renderGraph(); else renderList();
}

function renderMap() {
  const areaContext = document.querySelector('#map-area-context');
  if (areaContext) {
    areaContext.replaceChildren();
    areaContext.hidden = !state.mapAreaFilter;
    if (state.mapAreaFilter) {
      const area = viewedBlueprint()?.areas[state.mapAreaFilter];
      areaContext.append(element('span', { text: `Coverage drill-in · ${area?.label ?? state.mapAreaFilter}` }));
      const back = element('button', { className: 'button ghost', text: 'Return to coverage', attrs: { type: 'button' } });
      back.addEventListener('click', returnToCoverage);
      areaContext.append(back);
    }
  }
  const filters = document.querySelector('#type-filters');
  filters.replaceChildren();
  for (const type of viewedGraph().types) {
    const button = element('button', {
      className: `type-${type}`,
      text: type.replaceAll('-', ' '),
      attrs: { type: 'button', 'aria-pressed': String(state.activeTypes.has(type)) },
    });
    button.addEventListener('click', () => {
      state.activeTypes = toggleType(state.activeTypes, type);
      renderMap();
      syncRoute('replace');
    });
    filters.append(button);
  }
  const mapSearchStatus = document.querySelector('#map-search-status');
  const matches = visibleGraph();
  document.querySelector('#map-results-jump').disabled = matches.nodes.length === 0;
  const total = viewedGraph().nodes.filter((node) => state.activeTypes.has(node.type)
    && (!state.mapAreaFilter || node.area === state.mapAreaFilter)).length;
  const selectedIsOutsideResults = state.selectedId && !matches.nodes.some((node) => node.id === state.selectedId);
  if (state.mapSearch.trim()) {
    mapSearchStatus.textContent = matches.nodes.length
      ? `${matches.nodes.length} of ${total} objects match. Search covers names, details, types, and areas.${selectedIsOutsideResults ? ' The selected object remains open in details.' : ''}`
      : `No objects match “${state.mapSearch.trim()}”. Clear the search or adjust the type filters.${selectedIsOutsideResults ? ' The selected object remains open in details.' : ''}`;
  } else {
    mapSearchStatus.textContent = `Showing ${total} objects. Search names, details, types, and areas.`;
  }
  setMapMode(state.mapMode);
  renderDetail();
}

function visibleGraph() {
  const filtered = filterGraph(viewedGraph(), state.activeTypes);
  let areaFiltered = filtered;
  if (state.mapAreaFilter) {
    const nodes = filtered.nodes.filter((node) => node.area === state.mapAreaFilter);
    const ids = new Set(nodes.map((node) => node.id));
    areaFiltered = { ...filtered, nodes, links: filtered.links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
  }
  return searchGraph(areaFiltered, state.mapSearch);
}

function nodePositions(nodes) {
  const byArea = new Map();
  for (const node of nodes) {
    if (!byArea.has(node.area)) byArea.set(node.area, []);
    byArea.get(node.area).push(node);
  }
  const allAreas = Object.keys(viewedBlueprint()?.areas ?? {});
  const positions = new Map();
  for (const [area, areaNodes] of byArea) {
    const areaIndex = allAreas.indexOf(area);
    const angle = (areaIndex / allAreas.length) * Math.PI * 2 - Math.PI / 2;
    const cx = 600 + Math.cos(angle) * 275;
    const cy = 380 + Math.sin(angle) * 260;
    areaNodes.forEach((node, index) => {
      const localAngle = (index / areaNodes.length) * Math.PI * 2 + angle;
      const radius = areaNodes.length === 1 ? 0 : Math.min(54, 18 + areaNodes.length * 7);
      positions.set(node.id, { x: cx + Math.cos(localAngle) * radius, y: cy + Math.sin(localAngle) * radius });
    });
  }
  return positions;
}

function renderGraph() {
  const canvas = document.querySelector('#graph-canvas');
  if (!canvas) return;
  canvas.replaceChildren();
  const { nodes, links } = visibleGraph();
  const positions = nodePositions(nodes);
  const svg = svgElement('svg', { viewBox: '0 0 1200 760', ...graphAccessibilityAttributes(nodes.length, links.length) });
  const world = svgElement('g', { transform: transformValue() });
  const selected = state.selectedId;
  const neighbors = connectedNodeIds(links, selected);

  for (const link of links) {
    const source = positions.get(link.source); const target = positions.get(link.target);
    if (!source || !target) continue;
    const related = selected && (link.source === selected || link.target === selected);
    const line = svgElement('line', { x1: source.x, y1: source.y, x2: target.x, y2: target.y, class: `graph-link${related ? ' related' : ''}${selected && !related ? ' dimmed' : ''}` });
    line.append(svgElement('title'));
    line.firstChild.textContent = link.type;
    world.append(line);
  }
  for (const node of nodes) {
    const position = positions.get(node.id);
    const group = svgElement('g', { transform: `translate(${position.x} ${position.y})`, class: `graph-node${node.id === selected ? ' selected' : ''}${selected && !neighbors.has(node.id) ? ' dimmed' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${node.type}: ${node.name}`, 'aria-pressed': mapControlPressed(node.id, selected) });
    group.append(svgElement('circle', { r: node.id === selected ? 12 : 9, fill: typeColors[node.type] ?? '#9daaa2' }));
    const label = svgElement('text', { x: '14', y: '4' }); label.textContent = node.name; group.append(label);
    const title = svgElement('title'); title.textContent = `${node.name} — ${node.detail} · ${enterpriseStateSummary(node.states)}`; group.append(title);
    group.addEventListener('click', (event) => { event.stopPropagation(); selectNode(node.id); });
    group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id); } });
    world.append(group);
  }
  svg.append(world);
  enablePanZoom(svg);
  canvas.append(svg);
}

function transformValue() {
  const { x, y, k } = state.transform;
  return `translate(${x} ${y}) scale(${k})`;
}

function zoomBy(factor, point = { x: 600, y: 380 }) {
  state.transform = zoomTransform(state.transform, factor, point);
  renderGraph();
}

function enablePanZoom(svg) {
  let dragging = false; let start = null;
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const point = { x: ((event.clientX - rect.left) / rect.width) * 1200, y: ((event.clientY - rect.top) / rect.height) * 760 };
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, point);
  }, { passive: false });
  svg.addEventListener('pointerdown', (event) => {
    if (!shouldStartMapPan(event.target)) return;
    dragging = true; start = { x: event.clientX, y: event.clientY, tx: state.transform.x, ty: state.transform.y };
    svg.classList.add('dragging'); svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    state.transform.x = start.tx + (event.clientX - start.x) * (1200 / rect.width);
    state.transform.y = start.ty + (event.clientY - start.y) * (760 / rect.height);
    svg.firstChild?.setAttribute('transform', transformValue());
  });
  const end = () => { dragging = false; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('click', (event) => { if (event.target === svg) selectNode(null); });
}

function renderList() {
  const canvas = document.querySelector('#list-canvas');
  canvas.replaceChildren();
  const { nodes } = visibleGraph();
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.areaLabel)) groups.set(node.areaLabel, []);
    groups.get(node.areaLabel).push(node);
  }
  for (const [area, areaNodes] of groups) {
    const section = element('section', { className: 'list-area' }, [element('h3', { text: area })]);
    for (const node of areaNodes) {
      const row = element('button', { className: `list-row${node.id === state.selectedId ? ' selected' : ''}`, attrs: { type: 'button', 'aria-pressed': mapControlPressed(node.id, state.selectedId), title: enterpriseStateSummary(node.states) } }, [
        element('i', { className: `type-dot type-${node.type}` }), element('span', { text: node.type.replaceAll('-', ' ') }),
        element('strong', { text: node.name }), element('small', { text: `Design: ${node.status}` }),
      ]);
      row.addEventListener('click', () => selectNode(node.id)); section.append(row);
    }
    canvas.append(section);
  }
}

function selectNode(id) {
  const selectedChanged = state.selectedId !== id;
  if (selectedChanged) state.enterpriseQuery.simulationId = null;
  state.selectedId = id;
  let needsStateProjection = false;
  if (state.enterpriseModel) {
    const projected = state.enterpriseModel.graph.nodes.find((node) => node.id === id);
    const visible = Boolean(projected);
    const states = projected?.states ?? (state.enterpriseModel.selection?.object?.id === id ? state.enterpriseModel.selection.states : null);
    state.enterpriseModel.selection = { object: blueprintItem(state.enterpriseModel.blueprint, id), states, visible,
      hiddenBy: visible ? [] : ['current lens or design scope'] };
    needsStateProjection = Boolean(id && state.enterpriseModel.selection.object && (!states || (selectedChanged && state.enterpriseModel.selection.object.type === 'process')));
  }
  if (state.mapMode === 'graph') renderGraph(); else renderList();
  renderDetail();
  const mapCanvas = document.querySelector(state.mapMode === 'graph' ? '#graph-canvas' : '#list-canvas');
  focusSelectedMapControl(mapCanvas, state.mapMode, id);
  syncRoute('push');
  if (needsStateProjection) loadEnterpriseContext();
}

function blueprintItem(blueprint, id) {
  return Object.values(blueprint?.areas ?? {}).flatMap((entry) => entry.items).find((item) => item.id === id) ?? null;
}

function versionComparisonFor(node) {
  const versions = [...state.project.blueprintVersions].sort((left, right) => left.version - right.version);
  const panel = element('section', { className: 'blueprint-version-comparison', attrs: { 'aria-labelledby': `version-compare-heading-${node.id}` } });
  panel.append(element('h4', { text: 'Compare saved versions', attrs: { id: `version-compare-heading-${node.id}` } }));
  if (!versions.length) {
    panel.append(element('p', { text: 'No saved blueprint versions are available for comparison.' }));
    return panel;
  }
  const fromId = `version-compare-from-${node.id}`;
  const toId = `version-compare-to-${node.id}`;
  const fromSelect = element('select', { attrs: { id: fromId, name: 'fromVersion', 'aria-describedby': `version-compare-help-${node.id}` } });
  const toSelect = element('select', { attrs: { id: toId, name: 'toVersion', 'aria-describedby': `version-compare-help-${node.id}` } });
  for (const blueprint of versions) {
    const label = `Version ${blueprint.version} · ${(blueprint.epistemicStatus ?? 'unknown status').replaceAll('-', ' ')}`;
    fromSelect.append(element('option', { text: label, attrs: { value: blueprint.version } }));
    toSelect.append(element('option', { text: label, attrs: { value: blueprint.version } }));
  }
  const currentIndex = versions.length - 1;
  fromSelect.value = String(versions[Math.max(0, currentIndex - 1)].version);
  toSelect.value = String(versions[currentIndex].version);
  const helpId = `version-compare-help-${node.id}`;
  panel.append(
    element('p', { className: 'edit-help', text: 'Comparison uses saved blueprint content only. It does not include restricted identity-binding records.', attrs: { id: helpId } }),
    element('label', { text: 'From version', attrs: { for: fromId } }), fromSelect,
    element('label', { text: 'To version', attrs: { for: toId } }), toSelect,
  );
  const output = element('div', { className: 'version-compare-result', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
  const render = () => {
    const result = compareBlueprintObjectVersions(versions, node.id, Number(fromSelect.value), Number(toSelect.value));
    output.replaceChildren(
      element('p', { text: `Blueprint v${result.fromVersion} (${(result.fromEpistemicStatus ?? 'unavailable').replaceAll('-', ' ')}) → v${result.toVersion} (${(result.toEpistemicStatus ?? 'unavailable').replaceAll('-', ' ')}).` }),
    );
    if (!result.fromExists || !result.toExists) {
      const absentVersions = [!result.fromExists ? `version ${result.fromVersion}` : null, !result.toExists ? `version ${result.toVersion}` : null].filter(Boolean).join(' and ');
      output.append(element('p', { text: `${node.name} is not represented in ${absentVersions}.` }));
    }
    if (result.fromExists && result.toExists) {
      output.append(element('p', { text: `Object status: ${result.fromStatus ?? 'unknown'} → ${result.toStatus ?? 'unknown'}.` }));
      if (result.fields.length) {
        const changes = element('ul', { attrs: { 'aria-label': 'Changed object fields' } });
        const labels = { proposedInstructions: 'Proposed instructions', proposedScopeStatements: 'Proposed scope statements', proposedToolStatements: 'Proposed tool statements', proposedEscalationRules: 'Proposed escalation rules', capabilityName: 'Linked capability', inputDecisionNames: 'Decision inputs', outputDecisionNames: 'Decision outputs', feedbackGoalName: 'Steering goal', feedbackDecisionNames: 'Decisions guiding this feedback loop', decisionMakerRoleName: 'Decision maker role', decisionScopeNames: 'Business design in scope', strategyGoalNames: 'Goals this strategy supports' };
        labels.responsibilityNames = 'Accountable responsibilities';
        const display = (value) => value === null || value === undefined ? 'Not recorded' : Array.isArray(value) ? (value.length ? value.join('; ') : 'None recorded') : String(value);
        for (const change of result.fields) changes.append(element('li', { text: `${labels[change.field] ?? change.field}: ${display(change.before)} → ${display(change.after)}` }));
        output.append(element('h5', { text: 'Changed object fields' }), changes);
      } else output.append(element('p', { text: 'No displayed object fields changed.' }));
    }
    const added = element('ul', { attrs: { 'aria-label': 'Added relationships' } }, result.linksAdded.map((link) => element('li', { text: link })));
    const removed = element('ul', { attrs: { 'aria-label': 'Removed relationships' } }, result.linksRemoved.map((link) => element('li', { text: link })));
    output.append(element('h5', { text: 'Related-link changes' }));
    output.append(element('p', { text: result.linksAdded.length ? 'Added' : 'No relationships added.' }));
    if (result.linksAdded.length) output.append(added);
    output.append(element('p', { text: result.linksRemoved.length ? 'Removed' : 'No relationships removed.' }));
    if (result.linksRemoved.length) output.append(removed);
  };
  fromSelect.addEventListener('change', render);
  toSelect.addEventListener('change', render);
  render();
  panel.append(output);
  return panel;
}

function versionHistoryFor(node) {
  const section = element('section', { className: 'blueprint-edit-history' }, [element('h4', { text: 'Version history' })]);
  section.append(versionComparisonFor(node));
  const edits = state.project.blueprintVersions.slice(1).filter((blueprint) => blueprint.edit?.objectId === node.id);
  if (!edits.length) {
    section.append(element('p', { text: 'No saved edits for this object yet.' }));
    return section;
  }
  for (const blueprint of edits) {
    const edit = blueprint.edit;
    const entry = element('article', { className: 'version-history-entry' });
    entry.append(element('strong', { text: `Version ${blueprint.version - 1} → ${blueprint.version}` }));
    entry.append(element('small', { text: `Saved by ${edit.actor} · ${new Date(edit.at).toLocaleString()}` }));
    for (const key of edit.changedFields) {
      const label = key === 'ownerRoleName' ? 'Owner role'
        : key === 'enterpriseScope' ? 'Proposed design scope'
        : key === 'servesCustomerNames' ? 'Customers served'
        : key === 'enabledByCapabilityNames' ? 'Enabling capabilities'
        : key === 'inputInformationNames' ? 'Information inputs'
        : key === 'outputInformationNames' ? 'Information outputs'
        : key === 'inputDecisionNames' ? 'Decision inputs'
        : key === 'outputDecisionNames' ? 'Decision outputs'
        : key === 'feedbackGoalName' ? 'Steering goal'
        : key === 'feedbackDecisionNames' ? 'Decisions guiding this feedback loop'
        : key === 'capabilityName' ? 'Linked capability'
        : key === 'evidenceMetricNames' ? 'Evidence metrics'
        : key === 'capabilityMetricNames' ? 'Capability metrics'
        : key === 'readInformationName' ? 'Information source'
        : key === 'consumerLoopName' ? 'Feedback loop'
        : key === 'mitigatingControlName' ? 'Mitigating control'
        : key === 'assignedRoleNames' ? 'Organizational roles'
        : key === 'responsibilityNames' ? 'Accountable responsibilities'
        : key === 'metricName' ? 'Metric'
        : key === 'decisionMakerRoleName' ? 'Decision maker role'
          : key === 'decisionScopeNames' ? 'Business design in scope'
            : key === 'strategyGoalNames' ? 'Goals this strategy supports'
        : key === 'proposedInstructions' ? 'Proposed instructions'
          : key === 'proposedScopeStatements' ? 'Proposed scope statements'
            : key === 'proposedToolStatements' ? 'Proposed tool statements'
              : key === 'proposedEscalationRules' ? 'Proposed escalation rules'
            : key[0].toUpperCase() + key.slice(1);
      const display = (value) => value === null ? 'None' : Array.isArray(value) ? (value.length ? value.join(', ') : 'None')
        : key === 'enterpriseScope' && value ? ['organizationId', 'legalEntityId', 'unitId'].map((field) => `${({ organizationId: 'Organization', legalEntityId: 'Legal entity', unitId: 'Unit' })[field]}: ${blueprintItem(blueprint, value[field])?.name ?? 'None'}`).join(' · ')
          : typeof value === 'object' ? JSON.stringify(value) : (value || '—');
      entry.append(element('div', { className: 'history-diff' }, [
        element('b', { text: label }),
        element('p', { text: `Before: ${display(edit.before[key])}` }),
        element('p', { text: `After: ${display(edit.after[key])}` }),
      ]));
    }
    const relationChanges = element('div', { className: 'history-links' }, [element('b', { text: 'Affected relationships' })]);
    const relationList = (label, relations) => {
      const list = element('div', { className: 'history-relation-set' }, [element('span', { text: label })]);
      for (const link of relations) list.append(element('p', { text: `${link.source} ${link.type} ${link.target}` }));
      return list;
    };
    relationChanges.append(relationList('Before', edit.relationsBefore), relationList('After', edit.relationsAfter));
    entry.append(relationChanges);
    section.append(entry);
  }
  return section;
}

function editField(form, labelText, name, value, { multiline = false, maxLength = 700, required = true, readOnly = false } = {}) {
  const id = `blueprint-edit-${name}`;
  const label = element('label', { text: labelText, attrs: { for: id } });
  const control = element(multiline ? 'textarea' : 'input', { attrs: { id, name, ...(required ? { required: '' } : {}), ...(readOnly ? { readonly: '' } : {}), maxlength: String(maxLength), 'aria-describedby': 'blueprint-edit-help' } });
  control.value = value ?? '';
  form.append(label, control);
  return control;
}

function renderBlueprintEditForm(node) {
  const branchEditing = enterpriseBranchWritable(state.enterpriseModel) && !state.enterpriseLoading && !state.enterpriseBusy && !state.enterpriseError && !state.pendingEnterprise;
  if ((!branchEditing && (enterpriseReadOnly() || (state.enterpriseModel && !state.enterpriseModel.permissions.write))) || !state.sessionRoles.includes('workspace-write')) return null;
  const sourceBlueprint = branchEditing ? state.enterpriseModel.blueprint : state.project.latestBlueprint;
  const object = blueprintItem(sourceBlueprint, node.id);
  if (!object || !['goal', 'strategy', 'customer', 'offering', 'economics', 'capability', 'process', 'role',
    'decision', 'resource', 'information', 'system', 'risk', 'control', 'metric', 'feedback-loop', 'lifecycle', 'actor-human', 'actor-agent'].includes(object.type)) return null;
  const pending = !branchEditing && state.pendingBlueprintEdit?.projectId === state.project.id && state.pendingBlueprintEdit?.payload.objectId === node.id ? state.pendingBlueprintEdit : null;
  const draft = state.blueprintEditDraft?.projectId === state.project.id && state.blueprintEditDraft?.objectId === node.id ? state.blueprintEditDraft.payload : null;
  const pendingPayload = pending?.payload;
  const form = element('form', { className: 'blueprint-edit-form', attrs: { 'data-enterprise-action': branchEditing ? 'edit-branch-object' : 'edit-main-object' } });
  form.append(element('h4', { text: branchEditing ? 'Edit selected draft record' : 'Edit proposed design' }));
  const currentReadSource = object.type === 'metric' ? blueprintItem(sourceBlueprint, object.reads) : null;
  const editsInformationSource = object.type === 'metric' && (currentReadSource?.type === 'information'
    || object.reads === null || object.reads === undefined);
  const editsMetricLink = ['goal', 'economics'].includes(object.type);
  const identityActor = ['actor-human', 'actor-agent'].includes(object.type);
  form.append(element('p', { className: 'edit-help', text: identityActor
    ? 'Actor name and detail are fixed identity labels. Saving creates a new immutable proposed version. Role links are organizational design only and do not change identity, permissions, authority, or execution.'
    : object.type === 'offering'
    ? 'Saving creates a new immutable proposed version. Customer and capability links describe the proposed offering only; they do not grant access, assignments, or operational status.'
    : object.type === 'strategy'
      ? 'Saving creates a new immutable proposed version. Goal links track strategy design intent; they do not show goal achievement or grant authority to act.'
    : object.type === 'decision'
      ? 'Saving creates a new immutable proposed version. Decision maker and scope are proposed design only, not an endorsement or approval. They do not grant platform permissions, approval rights, agent actions, or execution authority.'
    : object.type === 'process'
      ? 'Saving creates a new immutable proposed version. Information and decision flows are separate design links; decision links do not approve decisions, trigger execution, or change permission state.'
      : object.type === 'feedback-loop'
        ? 'Saving creates a new immutable proposed version. The goal link records proposed steering intent, not evidence of achievement or approval. Evidence metrics remain design references and do not verify results or activate monitoring.'
      : object.type === 'risk'
        ? 'Saving creates a new immutable proposed version. A mitigating control is a proposed design relationship; it does not accept the risk or authorize operations.'
        : object.type === 'capability'
          ? 'Saving creates a new immutable proposed version. Capability metric links are proposed measurement references; they do not verify results or operational status.'
        : editsInformationSource
          ? 'Saving creates a new immutable proposed version. This proposes which information record the metric reads; it does not verify evidence or change operational status.'
          : object.type === 'metric'
            ? 'Saving creates a new immutable proposed version. Metric sources and feedback-loop links remain proposed references; they do not verify results or activate monitoring.'
          : editsMetricLink
            ? 'Saving creates a new immutable proposed version. Metric links are proposed design references; they do not verify results or change operational status.'
      : 'Saving creates a new immutable proposed version. Text edits do not verify evidence or change links, ownership, assignments, or operational status.', attrs: { id: 'blueprint-edit-help' } }));
  const name = editField(form, 'Name', 'name', pendingPayload?.name ?? draft?.name ?? object.name, { maxLength: 120, readOnly: identityActor });
  const detail = editField(form, 'Detail', 'detail', pendingPayload?.detail ?? draft?.detail ?? object.detail, { multiline: true, maxLength: 700, readOnly: identityActor });
  let servingCustomers = null;
  let enablingCapabilities = null;
  if (object.type === 'offering') {
    servingCustomers = element('fieldset', { className: 'serving-customer-select', attrs: { 'aria-describedby': `serves-customer-help-${node.id}` } });
    servingCustomers.append(element('legend', { text: 'Customers served' }));
    servingCustomers.append(element('p', { className: 'edit-help', text: 'Select the customer groups this proposed offering serves.', attrs: { id: `serves-customer-help-${node.id}` } }));
    const customers = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'customer');
    const selected = new Set(pendingPayload?.servesCustomerIds ?? draft?.servesCustomerIds ?? object.serves ?? []);
    for (const customer of customers) {
      const id = `blueprint-serves-${node.id}-${customer.id}`;
      const checkbox = element('input', { attrs: { id, name: 'servesCustomerIds', type: 'checkbox', value: customer.id } });
      checkbox.checked = selected.has(customer.id);
      servingCustomers.append(element('label', { className: 'serving-customer-option', attrs: { for: id } }, [
        checkbox, element('span', { text: customer.name }),
      ]));
    }
    if (!customers.length) servingCustomers.append(element('p', { className: 'edit-help', text: 'Add a customer record before linking an offering.' }));
    form.append(servingCustomers);

    enablingCapabilities = element('fieldset', { className: 'offering-enabledby-select', attrs: { 'aria-describedby': `enabled-by-capability-help-${node.id}` } });
    enablingCapabilities.append(element('legend', { text: 'Capabilities this offering depends on' }));
    enablingCapabilities.append(element('p', { className: 'edit-help', text: 'Select proposed capabilities that enable the offering design. These links do not activate services or grant authority.', attrs: { id: `enabled-by-capability-help-${node.id}` } }));
    const capabilities = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'capability');
    const selectedCapabilities = new Set(pendingPayload?.enabledByCapabilityIds ?? draft?.enabledByCapabilityIds ?? object.enabledBy ?? []);
    for (const capability of capabilities) {
      const id = `blueprint-enabled-by-${node.id}-${capability.id}`;
      const checkbox = element('input', { attrs: { id, name: 'enabledByCapabilityIds', type: 'checkbox', value: capability.id } });
      checkbox.checked = selectedCapabilities.has(capability.id);
      enablingCapabilities.append(element('label', { className: 'offering-enabledby-option', attrs: { for: id } }, [
        checkbox, element('span', { text: capability.name }),
      ]));
    }
    if (!capabilities.length) enablingCapabilities.append(element('p', { className: 'edit-help', text: 'Add a capability record before linking an offering.' }));
    form.append(enablingCapabilities);
  }
  let ownerRole = null;
  const ownerEditableTypes = ['goal', 'strategy', 'economics', 'capability', 'process', 'resource', 'information', 'system',
    'risk', 'control', 'metric', 'feedback-loop', 'lifecycle'];
  if (ownerEditableTypes.includes(object.type)) {
    ownerRole = element('select', { attrs: { id: 'blueprint-edit-ownerRoleName', name: 'ownerRoleName', required: '', 'aria-describedby': 'blueprint-edit-help' } });
    const roles = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'role');
    for (const role of roles) ownerRole.append(element('option', { text: role.name, attrs: { value: role.name } }));
    const currentRole = roles.find((role) => role.id === object.owner);
    ownerRole.value = pendingPayload?.ownerRoleName ?? draft?.ownerRoleName ?? currentRole?.name ?? '';
    form.append(element('label', { text: 'Owner role', attrs: { for: ownerRole.id } }), ownerRole);
    form.append(element('p', { className: 'edit-help', text: 'Owner role is proposed accountability only. It does not grant platform access, task assignment authority, or permission to run work.' }));
  }
  let trigger = null;
  let instructions = null;
  let responsibilitySelect = null;
  let scopeStatements = null;
  let toolStatements = null;
  let escalationRules = null;
  let inputInformation = null;
  let outputInformation = null;
  let inputDecisions = null;
  let outputDecisions = null;
  let processResources = null;
  let processSystems = null;
  let processCapability = null;
  let evidenceMetrics = null;
  let feedbackGoal = null;
  let feedbackDecisions = null;
  let capabilityMetrics = null;
  let informationSource = null;
  let linkedMetric = null;
  let linkedFeedbackLoop = null;
  let mitigatingControl = null;
  let assignedRoles = null;
  let strategyGoals = null;
  let decisionMaker = null;
  let decisionScope = null;
  if (object.type === 'strategy') {
    const goals = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'goal');
    strategyGoals = element('fieldset', { className: 'strategy-goal-select', attrs: { 'aria-describedby': `strategy-goal-help-${node.id}` } });
    strategyGoals.append(element('legend', { text: 'Goals this strategy supports' }));
    strategyGoals.append(element('p', { className: 'edit-help', text: 'Select existing goals this proposed strategy is intended to support. These links show design intent, not achievement.', attrs: { id: `strategy-goal-help-${node.id}` } }));
    const selected = new Set(pendingPayload?.strategyGoalIds ?? draft?.strategyGoalIds
      ?? (object.goals ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'goal'));
    for (const goal of goals) {
      const id = `blueprint-strategy-goal-${node.id}-${goal.id}`;
      const checkbox = element('input', { attrs: { id, name: 'strategyGoalIds', type: 'checkbox', value: goal.id } });
      checkbox.checked = selected.has(goal.id);
      strategyGoals.append(element('label', { className: 'strategy-goal-option', attrs: { for: id } }, [checkbox, element('span', { text: goal.name })]));
    }
    if (!goals.length) strategyGoals.append(element('p', { className: 'edit-help', text: 'Add a goal record before linking strategy intent.' }));
    form.append(strategyGoals);
  }
  if (object.type === 'decision') {
    decisionMaker = element('select', { attrs: { id: `blueprint-decision-maker-${node.id}`, name: 'decisionMakerRoleId', 'aria-describedby': `decision-maker-help-${node.id}` } });
    decisionMaker.append(element('option', { text: 'No proposed decision maker', attrs: { value: '' } }));
    const roles = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'role');
    for (const role of roles) decisionMaker.append(element('option', { text: role.name, attrs: { value: role.id } }));
    decisionMaker.value = pendingPayload && Object.hasOwn(pendingPayload, 'decisionMakerRoleId')
      ? pendingPayload.decisionMakerRoleId ?? ''
      : draft && Object.hasOwn(draft, 'decisionMakerRoleId') ? draft.decisionMakerRoleId ?? '' : object.by ?? '';
    form.append(element('label', { text: 'Proposed decision maker role', attrs: { for: decisionMaker.id } }), decisionMaker,
      element('p', { className: 'edit-help', text: 'This records who the design proposes should make the decision. It does not grant platform permissions, approval rights, agent actions, or execution authority.', attrs: { id: `decision-maker-help-${node.id}` } }));

    const decisionScopeTypes = new Set(['goal', 'strategy', 'customer', 'offering', 'economics', 'capability', 'process', 'resource', 'information', 'system', 'risk', 'control', 'metric', 'feedback-loop', 'lifecycle']);
    const targets = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => decisionScopeTypes.has(item.type));
    decisionScope = element('fieldset', { className: 'decision-scope-select', attrs: { 'aria-describedby': `decision-scope-help-${node.id}` } });
    decisionScope.append(element('legend', { text: 'Business design in scope' }));
    decisionScope.append(element('p', { className: 'edit-help', text: 'Select the existing design records this proposed decision governs. This does not authorize changes or operations.', attrs: { id: `decision-scope-help-${node.id}` } }));
    const selected = new Set(pendingPayload?.decisionScopeIds ?? draft?.decisionScopeIds
      ?? (object.scope ?? []).filter((id) => decisionScopeTypes.has(blueprintItem(sourceBlueprint, id)?.type)));
    for (const target of targets) {
      const id = `blueprint-decision-scope-${node.id}-${target.id}`;
      const checkbox = element('input', { attrs: { id, name: 'decisionScopeIds', type: 'checkbox', value: target.id } });
      checkbox.checked = selected.has(target.id);
      decisionScope.append(element('label', { className: 'decision-scope-option', attrs: { for: id } }, [checkbox, element('span', { text: `${target.name} · ${target.type}` })]));
    }
    if (!targets.length) decisionScope.append(element('p', { className: 'edit-help', text: 'Add a business design record before defining decision scope.' }));
    form.append(decisionScope);
  }
  if (['actor-human', 'actor-agent'].includes(object.type)) {
    assignedRoles = element('fieldset', { className: 'actor-role-select', attrs: { 'aria-describedby': `assigned-roles-help-${node.id}` } });
    assignedRoles.append(element('legend', { text: 'Proposed organizational roles' }));
    assignedRoles.append(element('p', { className: 'edit-help', text: 'These links describe proposed organizational assignment only. They do not grant platform permissions or authority, or enable execution.', attrs: { id: `assigned-roles-help-${node.id}` } }));
    const roles = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'role');
    const selectedIds = pendingPayload?.assignedRoleIds ?? draft?.assignedRoleIds
      ?? (object.assignedRoles ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'role');
    const selected = new Set(selectedIds);
    for (const role of roles) {
      const id = `blueprint-assigned-role-${node.id}-${role.id}`;
      const checkbox = element('input', { attrs: { id, name: 'assignedRoleIds', type: 'checkbox', value: role.id } });
      checkbox.checked = selected.has(role.id);
      assignedRoles.append(element('label', { className: 'actor-role-option', attrs: { for: id } }, [checkbox, element('span', { text: role.name })]));
    }
    if (!roles.length) assignedRoles.append(element('p', { className: 'edit-help', text: 'Add a role record before linking an organizational assignment.' }));
    form.append(assignedRoles);
  }
  if (object.type === 'process') {
    trigger = editField(form, 'Process trigger', 'trigger', pendingPayload?.trigger ?? draft?.trigger ?? object.trigger, { maxLength: 240 });
    processCapability = element('select', { attrs: { id: `blueprint-process-capability-${node.id}`, name: 'capabilityId', 'aria-describedby': `process-capability-help-${node.id}` } });
    processCapability.append(element('option', { text: 'No linked capability', attrs: { value: '' } }));
    const capabilities = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'capability');
    for (const capability of capabilities) processCapability.append(element('option', { text: capability.name, attrs: { value: capability.id } }));
    const selectedCapability = pendingPayload && Object.hasOwn(pendingPayload, 'capabilityId')
      ? pendingPayload.capabilityId
      : draft && Object.hasOwn(draft, 'capabilityId') ? draft.capabilityId : object.capability ?? null;
    processCapability.value = selectedCapability ?? '';
    form.append(element('label', { text: 'Proposed linked capability', attrs: { for: processCapability.id } }), processCapability);
    form.append(element('p', { className: 'edit-help', text: 'This proposed process-to-capability link records design intent only. It does not assign work, activate a capability, or grant authority.', attrs: { id: `process-capability-help-${node.id}` } }));
    const information = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'information');
    const makeInformationPicker = (direction, relationIds) => {
      const field = direction === 'input' ? 'inputInformationIds' : 'outputInformationIds';
      const group = element('fieldset', { className: 'process-information-select', attrs: { 'aria-describedby': `${field}-help-${node.id}` } });
      group.append(element('legend', { text: direction === 'input' ? 'Information inputs' : 'Information outputs' }));
      group.append(element('p', { className: 'edit-help', text: direction === 'input'
        ? 'Select existing information records this proposed process receives.'
        : 'Select existing information records this proposed process produces. Decision outputs are edited separately.', attrs: { id: `${field}-help-${node.id}` } }));
      const selectedIds = pendingPayload?.[field] ?? draft?.[field] ?? (object[relationIds] ?? []).filter((id) => information.some((item) => item.id === id));
      const selected = new Set(selectedIds);
      for (const record of information) {
        const id = `blueprint-${field}-${node.id}-${record.id}`;
        const checkbox = element('input', { attrs: { id, name: field, type: 'checkbox', value: record.id } });
        checkbox.checked = selected.has(record.id);
        group.append(element('label', { className: 'process-information-option', attrs: { for: id } }, [checkbox, element('span', { text: record.name })]));
      }
      if (!information.length) group.append(element('p', { className: 'edit-help', text: 'Add an information record before linking it to this process.' }));
      form.append(group);
      return group;
    };
    inputInformation = makeInformationPicker('input', 'inputs');
    outputInformation = makeInformationPicker('output', 'outputs');
    const decisions = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'decision');
    const makeDecisionPicker = (direction, relationIds) => {
      const field = direction === 'input' ? 'inputDecisionIds' : 'outputDecisionIds';
      const group = element('fieldset', { className: 'process-decision-select', attrs: { 'aria-describedby': `${field}-help-${node.id}` } });
      group.append(element('legend', { text: direction === 'input' ? 'Decision inputs' : 'Decision outputs' }));
      group.append(element('p', { className: 'edit-help', text: direction === 'input'
        ? 'Select existing decision records this proposed process receives as design context. This does not approve decisions or authorize execution.'
        : 'Select existing decision records this proposed process is intended to produce. This does not approve a decision, trigger execution, or change permissions.', attrs: { id: `${field}-help-${node.id}` } }));
      const selectedIds = pendingPayload?.[field] ?? draft?.[field]
        ?? (object[relationIds] ?? []).filter((id) => decisions.some((item) => item.id === id));
      const selected = new Set(selectedIds);
      for (const decision of decisions) {
        const id = `blueprint-${field}-${node.id}-${decision.id}`;
        const checkbox = element('input', { attrs: { id, name: field, type: 'checkbox', value: decision.id } });
        checkbox.checked = selected.has(decision.id);
        group.append(element('label', { className: 'process-decision-option', attrs: { for: id } }, [checkbox, element('span', { text: decision.name })]));
      }
      if (!decisions.length) group.append(element('p', { className: 'edit-help', text: 'Add a decision record before linking it to this process.' }));
      form.append(group);
      return group;
    };
    inputDecisions = makeDecisionPicker('input', 'inputs');
    outputDecisions = makeDecisionPicker('output', 'outputs');
    const makeDependencyPicker = (type, field, relationIds) => {
      const records = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === type);
      const group = element('fieldset', { className: 'process-dependency-select', attrs: { 'aria-describedby': `${field}-help-${node.id}` } });
      const label = type === 'resource' ? 'Resources' : 'Systems';
      group.append(element('legend', { text: `Proposed ${label.toLowerCase()}` }));
      group.append(element('p', { className: 'edit-help', text: `Select existing ${label.toLowerCase()} records linked to this proposed process. These design links do not allocate resources, operate systems, or grant authority.`, attrs: { id: `${field}-help-${node.id}` } }));
      const selectedIds = pendingPayload?.[field] ?? draft?.[field] ?? (object[relationIds] ?? []).filter((id) => records.some((item) => item.id === id));
      const selected = new Set(selectedIds);
      for (const record of records) {
        const id = `blueprint-${field}-${node.id}-${record.id}`;
        const checkbox = element('input', { attrs: { id, name: field, type: 'checkbox', value: record.id } });
        checkbox.checked = selected.has(record.id);
        group.append(element('label', { className: 'process-dependency-option', attrs: { for: id } }, [checkbox, element('span', { text: record.name })]));
      }
      if (!records.length) group.append(element('p', { className: 'edit-help', text: `Add a ${type} record before linking it to this process.` }));
      form.append(group);
      return group;
    };
    processResources = makeDependencyPicker('resource', 'resourceIds', 'resources');
    processSystems = makeDependencyPicker('system', 'systemIds', 'systems');
  }
  if (object.type === 'feedback-loop') {
    feedbackGoal = element('select', { attrs: { id: `blueprint-feedback-goal-${node.id}`, name: 'feedbackGoalId', 'aria-describedby': `feedback-goal-help-${node.id}` } });
    feedbackGoal.append(element('option', { text: 'No proposed steering goal', attrs: { value: '' } }));
    const goals = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'goal');
    for (const goal of goals) feedbackGoal.append(element('option', { text: goal.name, attrs: { value: goal.id } }));
    feedbackGoal.value = pendingPayload && Object.hasOwn(pendingPayload, 'feedbackGoalId')
      ? pendingPayload.feedbackGoalId ?? ''
      : draft && Object.hasOwn(draft, 'feedbackGoalId') ? draft.feedbackGoalId ?? '' : object.goal ?? '';
    form.append(element('label', { text: 'Proposed steering goal', attrs: { for: feedbackGoal.id } }), feedbackGoal,
      element('p', { className: 'edit-help', text: 'Choose an optional existing goal this proposed loop steers toward. This link is not evidence of goal achievement or approval.', attrs: { id: `feedback-goal-help-${node.id}` } }));
    feedbackDecisions = element('fieldset', { className: 'feedback-decision-select', attrs: { 'aria-describedby': `feedback-decisions-help-${node.id}` } });
    feedbackDecisions.append(element('legend', { text: 'Decisions guiding this feedback loop (proposed)' }));
    feedbackDecisions.append(element('p', { className: 'edit-help', text: 'Describes the intended design relationship; it does not approve a decision or authorize work.', attrs: { id: `feedback-decisions-help-${node.id}` } }));
    const decisions = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'decision');
    const selectedDecisions = new Set(pendingPayload?.feedbackDecisionIds ?? draft?.feedbackDecisionIds
      ?? (object.decisionIds ?? []).filter((id) => decisions.some((decision) => decision.id === id)));
    for (const decision of decisions) {
      const id = `blueprint-feedback-decision-${node.id}-${decision.id}`;
      const checkbox = element('input', { attrs: { id, name: 'feedbackDecisionIds', type: 'checkbox', value: decision.id } });
      checkbox.checked = selectedDecisions.has(decision.id);
      feedbackDecisions.append(element('label', { className: 'feedback-decision-option', attrs: { for: id } }, [checkbox, element('span', { text: decision.name })]));
    }
    if (!decisions.length) feedbackDecisions.append(element('p', { className: 'edit-help', text: 'Add a decision record before linking it to this feedback loop.' }));
    form.append(feedbackDecisions);
    evidenceMetrics = element('fieldset', { className: 'feedback-evidence-select', attrs: { 'aria-describedby': `evidence-metrics-help-${node.id}` } });
    evidenceMetrics.append(element('legend', { text: 'Evidence metrics' }));
    evidenceMetrics.append(element('p', { className: 'edit-help', text: 'Select existing metrics this proposed feedback loop uses as evidence. Decision inputs and outputs are edited separately.', attrs: { id: `evidence-metrics-help-${node.id}` } }));
    const metrics = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'metric');
    const selected = new Set(pendingPayload?.evidenceMetricIds ?? draft?.evidenceMetricIds ?? (object.evidence ?? []).filter((id) => metrics.some((item) => item.id === id)));
    for (const metric of metrics) {
      const id = `blueprint-evidence-metric-${node.id}-${metric.id}`;
      const checkbox = element('input', { attrs: { id, name: 'evidenceMetricIds', type: 'checkbox', value: metric.id } });
      checkbox.checked = selected.has(metric.id);
      evidenceMetrics.append(element('label', { className: 'feedback-evidence-option', attrs: { for: id } }, [checkbox, element('span', { text: metric.name })]));
    }
    if (!metrics.length) evidenceMetrics.append(element('p', { className: 'edit-help', text: 'Add a metric record before linking evidence.' }));
    form.append(evidenceMetrics);
  }
  if (object.type === 'capability') {
    capabilityMetrics = element('fieldset', { className: 'capability-metrics-select', attrs: { 'aria-describedby': `capability-metrics-help-${node.id}` } });
    capabilityMetrics.append(element('legend', { text: 'Capability metrics' }));
    capabilityMetrics.append(element('p', { className: 'edit-help', text: 'Select existing metric records related to this proposed capability. These links do not verify performance.', attrs: { id: `capability-metrics-help-${node.id}` } }));
    const metrics = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'metric');
    const selectedIds = pendingPayload?.capabilityMetricIds ?? draft?.capabilityMetricIds
      ?? (object.metrics ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'metric');
    const selected = new Set(selectedIds);
    for (const metric of metrics) {
      const id = `blueprint-capability-metric-${node.id}-${metric.id}`;
      const checkbox = element('input', { attrs: { id, name: 'capabilityMetricIds', type: 'checkbox', value: metric.id } });
      checkbox.checked = selected.has(metric.id);
      capabilityMetrics.append(element('label', { className: 'capability-metric-option', attrs: { for: id } }, [checkbox, element('span', { text: metric.name })]));
    }
    if (!metrics.length) capabilityMetrics.append(element('p', { className: 'edit-help', text: 'Add a metric record before linking capability metrics.' }));
    form.append(capabilityMetrics);
  }
  if (editsInformationSource) {
    informationSource = element('select', { attrs: { id: `blueprint-read-source-${node.id}`, name: 'readInformationId', 'aria-describedby': `read-source-help-${node.id}` } });
    informationSource.append(element('option', { text: 'No information source', attrs: { value: '' } }));
    const informationRecords = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'information');
    for (const record of informationRecords) informationSource.append(element('option', { text: record.name, attrs: { value: record.id } }));
    informationSource.value = pendingPayload && Object.hasOwn(pendingPayload, 'readInformationId')
      ? pendingPayload.readInformationId ?? ''
      : draft && Object.hasOwn(draft, 'readInformationId') ? draft.readInformationId ?? '' : object.reads ?? '';
    form.append(element('label', { text: 'Information source', attrs: { for: informationSource.id } }), informationSource,
      element('p', { className: 'edit-help', text: 'Choose one information record or clear the source.', attrs: { id: `read-source-help-${node.id}` } }));
  }
  if (object.type === 'metric') {
    linkedFeedbackLoop = element('select', { attrs: { id: `blueprint-feedback-loop-${node.id}`, name: 'consumerLoopId', 'aria-describedby': `feedback-loop-help-${node.id}` } });
    linkedFeedbackLoop.append(element('option', { text: 'No feedback loop', attrs: { value: '' } }));
    const feedbackLoops = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'feedback-loop');
    for (const feedbackLoop of feedbackLoops) linkedFeedbackLoop.append(element('option', { text: feedbackLoop.name, attrs: { value: feedbackLoop.id } }));
    linkedFeedbackLoop.value = pendingPayload && Object.hasOwn(pendingPayload, 'consumerLoopId')
      ? pendingPayload.consumerLoopId ?? ''
      : draft && Object.hasOwn(draft, 'consumerLoopId') ? draft.consumerLoopId ?? '' : object.consumerLoop ?? '';
    form.append(element('label', { text: 'Feedback loop that consumes this metric', attrs: { for: linkedFeedbackLoop.id } }), linkedFeedbackLoop,
      element('p', { className: 'edit-help', text: 'Choose one existing feedback loop or clear the proposed link. This does not activate monitoring.', attrs: { id: `feedback-loop-help-${node.id}` } }));
  }
  if (object.type === 'risk') {
    mitigatingControl = element('select', { attrs: { id: `blueprint-mitigating-control-${node.id}`, name: 'mitigatingControlId', 'aria-describedby': `mitigating-control-help-${node.id}` } });
    mitigatingControl.append(element('option', { text: 'No mitigating control', attrs: { value: '' } }));
    const controls = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'control');
    for (const control of controls) mitigatingControl.append(element('option', { text: control.name, attrs: { value: control.id } }));
    mitigatingControl.value = pendingPayload && Object.hasOwn(pendingPayload, 'mitigatingControlId')
      ? pendingPayload.mitigatingControlId ?? ''
      : draft && Object.hasOwn(draft, 'mitigatingControlId') ? draft.mitigatingControlId ?? '' : object.control ?? '';
    form.append(element('label', { text: 'Mitigating control', attrs: { for: mitigatingControl.id } }), mitigatingControl,
      element('p', { className: 'edit-help', text: 'Choose one existing control or clear the proposed link. This does not accept the risk or grant authority.', attrs: { id: `mitigating-control-help-${node.id}` } }));
  }
  if (editsMetricLink) {
    const group = element('fieldset', { className: 'goal-economics-metric-select', attrs: { 'aria-describedby': `metric-link-help-${node.id}` } });
    group.append(element('legend', { text: 'Metric link' }));
    group.append(element('p', { className: 'edit-help', text: 'Choose one existing metric or clear this proposed link.', attrs: { id: `metric-link-help-${node.id}` } }));
    linkedMetric = element('select', { attrs: { id: `blueprint-metric-link-${node.id}`, name: 'metricId' } });
    linkedMetric.append(element('option', { text: 'No metric', attrs: { value: '' } }));
    const metrics = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'metric');
    for (const metric of metrics) linkedMetric.append(element('option', { text: metric.name, attrs: { value: metric.id } }));
    linkedMetric.value = pendingPayload && Object.hasOwn(pendingPayload, 'metricId')
      ? pendingPayload.metricId ?? ''
      : draft && Object.hasOwn(draft, 'metricId') ? draft.metricId ?? '' : object.metric ?? '';
    group.append(element('label', { text: 'Metric', attrs: { for: linkedMetric.id } }), linkedMetric);
    form.append(group);
  }
  if (object.type === 'role') {
    responsibilitySelect = element('fieldset', { className: 'role-responsibility-select', attrs: { 'aria-describedby': `role-responsibility-help-${node.id}` } });
    responsibilitySelect.append(element('legend', { text: 'Accountable responsibilities' }));
    responsibilitySelect.append(element('p', { className: 'edit-help', text: 'Select goals, capabilities, processes, and systems this role is accountable for. These are organizational design links only.', attrs: { id: `role-responsibility-help-${node.id}` } }));
    const roleTargetTypes = new Set(['goal', 'capability', 'process', 'system']);
    const roleTargets = Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).filter((item) => roleTargetTypes.has(item.type));
    const selectedResponsibilities = new Set(pendingPayload?.responsibilityIds ?? draft?.responsibilityIds ?? (object.responsibilities ?? []).filter((id) => roleTargetTypes.has(blueprintItem(sourceBlueprint, id)?.type)));
    for (const target of roleTargets) {
      const id = `blueprint-role-responsibility-${node.id}-${target.id}`;
      const checkbox = element('input', { attrs: { id, name: 'responsibilityIds', type: 'checkbox', value: target.id } });
      checkbox.checked = selectedResponsibilities.has(target.id);
      responsibilitySelect.append(element('label', { className: 'role-responsibility-option', attrs: { for: id } }, [checkbox, element('span', { text: `${target.name} · ${target.type}` })]));
    }
    if (!roleTargets.length) responsibilitySelect.append(element('p', { className: 'edit-help', text: 'Add a goal, capability, process, or system before linking a responsibility.' }));
    form.append(responsibilitySelect);
    const existingScope = object.proposedScopeStatements ?? (object.authority ?? []).filter((value) => !(typeof value === 'string' && value.startsWith('decision-')));
    scopeStatements = editField(form, 'Proposed role scope statements (one per line)', 'proposedScopeStatements', (pendingPayload?.proposedScopeStatements ?? draft?.proposedScopeStatements ?? existingScope).join('\n'), { multiline: true, maxLength: 2900 });
    instructions = editField(form, 'Proposed instructions', 'proposedInstructions', pendingPayload?.proposedInstructions ?? draft?.proposedInstructions ?? object.proposedInstructions, { multiline: true, maxLength: 700 });
    const split = (value) => (Array.isArray(value) ? value : []).join('\n');
    toolStatements = editField(form, 'Proposed tools (one per line; optional)', 'proposedToolStatements', split(pendingPayload?.proposedToolStatements ?? draft?.proposedToolStatements ?? object.proposedToolStatements), { multiline: true, maxLength: 2900, required: false });
    escalationRules = editField(form, 'Proposed escalation rules (one per line; optional)', 'proposedEscalationRules', split(pendingPayload?.proposedEscalationRules ?? draft?.proposedEscalationRules ?? object.proposedEscalationRules), { multiline: true, maxLength: 2900, required: false });
    form.append(element('p', { className: 'edit-help', text: 'Scope, tools, escalation rules, and instructions are proposals only. They do not grant platform access, permissions, tool dispatch, or execution authority.' }));
  }
  const branchReason = branchEditing ? editField(form, 'Reason for this draft revision', 'reason', '', { multiline: true, maxLength: 500 }) : null;
  const error = element('p', { className: 'field-error edit-error', attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' } });
  const recovery = element('div', { className: 'edit-recovery' });
  const save = element('button', { className: 'button primary', text: branchEditing ? 'Save new branch revision' : 'Save new version', attrs: { type: 'submit' } });
  const latestVersion = element('button', { className: 'button ghost', text: 'Use current version', attrs: { type: 'button', hidden: '' } });
  if (pending?.needsReview) {
    error.textContent = 'This draft is retained after a version conflict. Review the latest history, then use the current version before resubmitting.';
    error.hidden = false;
    latestVersion.hidden = false;
    save.disabled = true;
  }
  latestVersion.addEventListener('click', () => {
    if (!state.pendingBlueprintEdit) return;
    state.pendingBlueprintEdit.expectedVersion = state.project.version;
    state.pendingBlueprintEdit.needsReview = false;
    if (state.pendingBlueprintEdit.needsNewCommandId) {
      state.pendingBlueprintEdit.commandId = `blueprint-edit:${crypto.randomUUID()}`;
      state.pendingBlueprintEdit.needsNewCommandId = false;
    }
    latestVersion.hidden = true;
    error.hidden = true;
    save.disabled = false;
    notify(`Draft is ready against blueprint version ${sourceBlueprint.version}.`);
  });
  form.append(error, recovery, latestVersion, save);
  const values = () => ({ objectId: node.id, name: name.value.trim(), detail: detail.value.trim(),
    ...(ownerRole ? { ownerRoleName: ownerRole.value } : {}), ...(trigger ? { trigger: trigger.value.trim() } : {}),
    ...(servingCustomers ? { servesCustomerIds: [...servingCustomers.querySelectorAll('input[name="servesCustomerIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(enablingCapabilities ? { enabledByCapabilityIds: [...enablingCapabilities.querySelectorAll('input[name="enabledByCapabilityIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(inputInformation ? { inputInformationIds: [...inputInformation.querySelectorAll('input[name="inputInformationIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(outputInformation ? { outputInformationIds: [...outputInformation.querySelectorAll('input[name="outputInformationIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(inputDecisions ? { inputDecisionIds: [...inputDecisions.querySelectorAll('input[name="inputDecisionIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(outputDecisions ? { outputDecisionIds: [...outputDecisions.querySelectorAll('input[name="outputDecisionIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(processResources ? { resourceIds: [...processResources.querySelectorAll('input[name="resourceIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(processSystems ? { systemIds: [...processSystems.querySelectorAll('input[name="systemIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(processCapability ? { capabilityId: processCapability.value || null } : {}),
    ...(evidenceMetrics ? { evidenceMetricIds: [...evidenceMetrics.querySelectorAll('input[name="evidenceMetricIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(feedbackGoal ? { feedbackGoalId: feedbackGoal.value || null } : {}),
    ...(feedbackDecisions ? { feedbackDecisionIds: [...feedbackDecisions.querySelectorAll('input[name="feedbackDecisionIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(capabilityMetrics ? { capabilityMetricIds: [...capabilityMetrics.querySelectorAll('input[name="capabilityMetricIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(assignedRoles ? { assignedRoleIds: [...assignedRoles.querySelectorAll('input[name="assignedRoleIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(informationSource ? { readInformationId: informationSource.value || null } : {}),
    ...(linkedMetric ? { metricId: linkedMetric.value || null } : {}),
    ...(linkedFeedbackLoop ? { consumerLoopId: linkedFeedbackLoop.value || null } : {}),
    ...(mitigatingControl ? { mitigatingControlId: mitigatingControl.value || null } : {}),
    ...(decisionMaker ? { decisionMakerRoleId: decisionMaker.value || null } : {}),
    ...(decisionScope ? { decisionScopeIds: [...decisionScope.querySelectorAll('input[name="decisionScopeIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(strategyGoals ? { strategyGoalIds: [...strategyGoals.querySelectorAll('input[name="strategyGoalIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(responsibilitySelect ? { responsibilityIds: [...responsibilitySelect.querySelectorAll('input[name="responsibilityIds"]:checked')].map((control) => control.value).sort() } : {}),
    ...(instructions ? { proposedInstructions: instructions.value.trim() } : {}),
    ...(scopeStatements ? { proposedScopeStatements: scopeStatements.value.split('\n').map((line) => line.trim()).filter(Boolean) } : {}),
    ...(toolStatements ? { proposedToolStatements: toolStatements.value.split('\n').map((line) => line.trim()).filter(Boolean) } : {}),
    ...(escalationRules ? { proposedEscalationRules: escalationRules.value.split('\n').map((line) => line.trim()).filter(Boolean) } : {}) });
  const trackDraft = () => {
    const payload = values();
    const current = blueprintItem(sourceBlueprint, node.id);
    const unchanged = payload.name === current.name && payload.detail === current.detail
      && (!ownerRole || payload.ownerRoleName === Object.values(sourceBlueprint.areas).flatMap((entry) => entry.items).find((item) => item.id === current.owner)?.name)
      && (!servingCustomers || JSON.stringify(payload.servesCustomerIds) === JSON.stringify([...(current.serves ?? [])].sort()))
      && (!enablingCapabilities || JSON.stringify(payload.enabledByCapabilityIds) === JSON.stringify([...(current.enabledBy ?? [])].sort()))
      && (!inputInformation || JSON.stringify(payload.inputInformationIds) === JSON.stringify([...(current.inputs ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'information')].sort()))
      && (!outputInformation || JSON.stringify(payload.outputInformationIds) === JSON.stringify([...(current.outputs ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'information')].sort()))
      && (!inputDecisions || JSON.stringify(payload.inputDecisionIds) === JSON.stringify([...(current.inputs ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'decision')].sort()))
      && (!outputDecisions || JSON.stringify(payload.outputDecisionIds) === JSON.stringify([...(current.outputs ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'decision')].sort()))
      && (!processResources || JSON.stringify(payload.resourceIds) === JSON.stringify([...(current.resources ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'resource')].sort()))
      && (!processSystems || JSON.stringify(payload.systemIds) === JSON.stringify([...(current.systems ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'system')].sort()))
      && (!processCapability || payload.capabilityId === (blueprintItem(sourceBlueprint, current.capability)?.type === 'capability' ? current.capability : null))
      && (!evidenceMetrics || JSON.stringify(payload.evidenceMetricIds) === JSON.stringify([...(current.evidence ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'metric')].sort()))
      && (!feedbackGoal || payload.feedbackGoalId === (blueprintItem(sourceBlueprint, current.goal)?.type === 'goal' ? current.goal : null))
      && (!feedbackDecisions || JSON.stringify(payload.feedbackDecisionIds) === JSON.stringify([...(current.decisionIds ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'decision')].sort()))
      && (!capabilityMetrics || JSON.stringify(payload.capabilityMetricIds) === JSON.stringify([...(current.metrics ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'metric')].sort()))
      && (!assignedRoles || JSON.stringify(payload.assignedRoleIds) === JSON.stringify([...(current.assignedRoles ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'role')].sort()))
      && (!informationSource || payload.readInformationId === (blueprintItem(sourceBlueprint, current.reads)?.type === 'information' ? current.reads : null))
      && (!linkedMetric || payload.metricId === (current.metric ?? null))
      && (!linkedFeedbackLoop || payload.consumerLoopId === (current.consumerLoop ?? null))
      && (!mitigatingControl || payload.mitigatingControlId === (current.control ?? null))
      && (!decisionMaker || payload.decisionMakerRoleId === (current.by ?? null))
      && (!decisionScope || JSON.stringify(payload.decisionScopeIds) === JSON.stringify([...(current.scope ?? []).filter((id) => ['goal', 'strategy', 'customer', 'offering', 'economics', 'capability', 'process', 'resource', 'information', 'system', 'risk', 'control', 'metric', 'feedback-loop', 'lifecycle'].includes(blueprintItem(sourceBlueprint, id)?.type))].sort()))
      && (!strategyGoals || JSON.stringify(payload.strategyGoalIds) === JSON.stringify([...(current.goals ?? []).filter((id) => blueprintItem(sourceBlueprint, id)?.type === 'goal')].sort()))
      && (!responsibilitySelect || JSON.stringify(payload.responsibilityIds) === JSON.stringify([...(current.responsibilities ?? []).filter((id) => ['goal', 'capability', 'process', 'system'].includes(blueprintItem(sourceBlueprint, id)?.type))].sort()))
      && (!trigger || payload.trigger === current.trigger)
      && (!instructions || payload.proposedInstructions === current.proposedInstructions)
      && (!scopeStatements || JSON.stringify(payload.proposedScopeStatements) === JSON.stringify(current.proposedScopeStatements ?? (current.authority ?? []).filter((value) => !(typeof value === 'string' && value.startsWith('decision-')))))
      && (!toolStatements || JSON.stringify(payload.proposedToolStatements) === JSON.stringify(current.proposedToolStatements ?? []))
      && (!escalationRules || JSON.stringify(payload.proposedEscalationRules) === JSON.stringify(current.proposedEscalationRules ?? []));
    state.blueprintEditDraft = unchanged ? null : { projectId: state.project.id, objectId: node.id, payload };
  };
  form.addEventListener('input', trackDraft);
  form.addEventListener('change', trackDraft);
  const submit = async (commandId, payload, expectedVersion) => {
    state.pendingBlueprintEdit ??= { projectId: state.project.id, commandId, payload, expectedVersion, needsReview: false };
    const projectId = state.project.id;
    save.disabled = true;
    error.hidden = true;
    try {
      const result = await api(`/api/v1/projects/${projectId}/blueprint/edits`, {
        method: 'POST', body: JSON.stringify(command(payload, expectedVersion, commandId)),
      });
      if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
      const previousTypes = new Set(state.activeTypes);
      const selectedId = state.selectedId;
      state.pendingBlueprintEdit = null;
      state.blueprintEditDraft = null;
      if (result.meta.replayed) {
        await loadProject(projectId, { history: 'replace', route: { ...currentRoute(), view: 'map', selectedId, types: [...previousTypes], blueprintVersion: null } });
        return;
      }
      state.project = result.data;
      state.enterpriseQuery.blueprintVersion = null;
      await loadEnterpriseContext({ render: false });
      if (state.project?.id !== projectId) return;
      state.activeTypes = new Set([...previousTypes].filter((typeValue) => state.project.graph.types.includes(typeValue)));
      state.selectedId = selectedId;
      state.view = 'map';
      renderStudio();
      hideAppState();
      syncRoute('replace');
      notify(`Saved blueprint version ${state.project.latestBlueprint.version}.`);
    } catch (failure) {
      if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
      error.replaceChildren(document.createTextNode(failure.message));
      error.hidden = false;
      save.disabled = false;
      if (failure.code === 'VERSION_CONFLICT' || failure.code === 'IDEMPOTENCY_CONFLICT') {
        state.pendingBlueprintEdit = { projectId, commandId, payload, expectedVersion, needsReview: true,
          needsNewCommandId: failure.code === 'IDEMPOTENCY_CONFLICT' };
        showRequestFailure(failure, () => loadProject(projectId, {
          history: 'replace', route: { view: 'map', selectedId: node.id, types: [...state.activeTypes] },
        }));
      } else if (failure.code === 'AUTHENTICATION_REQUIRED') showRequestFailure(failure);
      else if (failure.retryable || !failure.code) {
        const retry = element('button', { className: 'button ghost', text: 'Retry this save', attrs: { type: 'button' } });
        retry.addEventListener('click', () => submit(commandId, payload, expectedVersion));
        error.append(document.createTextNode(' '), retry);
      }
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const payload = values();
    if (branchEditing) {
      if (!form.reportValidity()) return;
      state.blueprintEditDraft = null;
      saveEnterpriseCommand({ kind: 'edit-branch-object', edit: payload, reason: branchReason.value.trim() });
      return;
    }
    const existing = state.pendingBlueprintEdit?.projectId === state.project.id && state.pendingBlueprintEdit?.payload.objectId === node.id ? state.pendingBlueprintEdit : null;
    let pendingEdit = existing;
    if (!pendingEdit || JSON.stringify(pendingEdit.payload) !== JSON.stringify(payload)) {
      pendingEdit = { projectId: state.project.id, commandId: `blueprint-edit:${crypto.randomUUID()}`, payload, expectedVersion: state.project.version, needsReview: existing?.needsReview ?? false };
      state.pendingBlueprintEdit = pendingEdit;
    }
    state.blueprintEditDraft = null;
    if (pendingEdit.needsReview) return;
    submit(pendingEdit.commandId, pendingEdit.payload, pendingEdit.expectedVersion);
  });
  return form;
}

function renderActorBindingPanel(node) {
  if (enterpriseReadOnly() || (state.enterpriseModel && !state.enterpriseModel.permissions.write) || !state.sessionRoles.includes('workspace-write')) return null;
  const actor = blueprintItem(state.project.latestBlueprint, node.id);
  if (!actor || !['actor-human', 'actor-agent'].includes(actor.type)) return null;
  const projectId = state.project.id;
  const blueprint = state.project.latestBlueprint;
  const expectedType = actor.type === 'actor-human' ? 'human' : 'workload';
  const section = element('section', { className: 'actor-binding-panel', attrs: { 'aria-labelledby': `actor-binding-heading-${node.id}` } });
  section.append(element('h4', { text: 'Propose identity binding', attrs: { id: `actor-binding-heading-${node.id}` } }));
  section.append(element('p', { className: 'edit-help', text: 'Bindings start proposed and are pinned to a blueprint version. A project owner must enable a proposal before the assigned identity can take part in supervised agent runs. This confirms the actor and role only; it does not grant platform access, permissions, approval authority, or tool dispatch. New blueprint versions do not inherit a proposal.' }));
  const message = element('p', { className: 'field-error edit-error', attrs: { role: 'status', 'aria-live': 'polite' } });
  message.textContent = 'Loading authorized workspace roster…';
  section.append(message);
  const panelPending = state.pendingActorBinding?.projectId === projectId && state.pendingActorBinding?.actorId === actor.id ? state.pendingActorBinding : null;
  const load = async () => {
    try {
      const [rosterResult, proposalsResult, executionMetaResult] = await Promise.all([
        api(`/api/v1/projects/${projectId}/members`),
        api(`/api/v1/projects/${projectId}/actor-bindings/proposals`),
        api('/api/execution/meta'),
      ]);
      if (state.project?.id !== projectId || state.selectedId !== actor.id) return;
      const roster = rosterResult.data.filter((member) => ['owner', 'editor'].includes(member.access) && member.actorType === expectedType);
      const proposals = proposalsResult.data.proposals.filter((proposal) => proposal.actorId === actor.id);
      const executionProfiles = executionMetaResult.profiles ?? [];
      const linkedRoleIds = new Set([...(actor.assignedRoles ?? []), ...blueprint.relations.filter((relation) => relation.source === actor.id && relation.type === 'assigned-to').map((relation) => relation.target)]);
      const roles = Object.values(blueprint.areas).flatMap((area) => area.items).filter((item) => item.type === 'role' && linkedRoleIds.has(item.id));
      const currentPairs = new Set(proposals.filter((proposal) => proposal.blueprintVersion === blueprint.version).map((proposal) => `${proposal.actorId}\n${proposal.roleId}`));
      const form = element('form', { className: 'actor-binding-form' });
      const roleId = `actor-binding-role-${actor.id}`;
      const roleSelect = element('select', { attrs: { id: roleId, name: 'roleId', required: '', 'aria-describedby': `actor-binding-help-${node.id}` } });
      for (const role of roles) roleSelect.append(element('option', { text: role.name, attrs: { value: role.id } }));
      if (panelPending?.blueprintVersion === blueprint.version && roles.some((role) => role.id === panelPending.roleId)) roleSelect.value = panelPending.roleId;
      const rolePreview = element('div', { className: 'actor-role-preview', attrs: { 'aria-live': 'polite', 'aria-label': 'Selected role proposal details' } });
      const renderRolePreview = () => {
        const selectedRole = roles.find((role) => role.id === roleSelect.value);
        if (!selectedRole) { rolePreview.replaceChildren(element('p', { text: 'No linked role is available.' })); return; }
        const items = Object.values(blueprint.areas).flatMap((area) => area.items);
        const byId = new Map(items.map((item) => [item.id, item]));
        const decisions = new Set(items.filter((item) => item.type === 'decision').map((item) => item.id));
        const linkedDecisions = blueprint.relations.filter((relation) => relation.target === selectedRole.id && relation.type === 'authorises').map((relation) => byId.get(relation.source)?.name).filter(Boolean);
        const responsibilities = (selectedRole.responsibilities ?? []).filter((id) => ['goal', 'capability', 'process', 'system'].includes(byId.get(id)?.type))
          .map((id) => byId.get(id)?.name).filter(Boolean);
        const scope = selectedRole.proposedScopeStatements ?? (selectedRole.authority ?? []).filter((value) => !(typeof value === 'string' && value.startsWith('decision-')));
        const tools = selectedRole.proposedToolStatements ?? [];
        const escalations = selectedRole.proposedEscalationRules ?? [];
        rolePreview.replaceChildren(
          element('p', { text: 'All role details below are proposals only; they grant no platform access, permissions, tool dispatch, or execution authority.' }),
          element('h5', { text: 'Linked responsibilities' }),
          responsibilities.length ? element('ul', {}, responsibilities.map((name) => element('li', { text: name }))) : element('p', { text: 'No linked responsibilities.' }),
          element('h5', { text: 'Linked decisions' }),
          linkedDecisions.length ? element('ul', {}, linkedDecisions.map((name) => element('li', { text: name }))) : element('p', { text: 'No linked decisions.' }),
          element('h5', { text: 'Proposed scope statements' }),
          scope.length ? element('ul', {}, scope.map((statement) => element('li', { text: statement }))) : element('p', { text: 'No proposed scope statements.' }),
          element('h5', { text: 'Proposed tools' }),
          tools.length ? element('ul', {}, tools.map((statement) => element('li', { text: statement }))) : element('p', { text: 'No proposed tools.' }),
          element('h5', { text: 'Proposed escalation rules' }),
          escalations.length ? element('ul', {}, escalations.map((statement) => element('li', { text: statement }))) : element('p', { text: 'No proposed escalation rules.' }),
          element('h5', { text: 'Proposed instructions' }),
          element('p', { text: selectedRole.proposedInstructions || 'No proposed instructions.' }),
        );
      };
      renderRolePreview();
      const targetId = `actor-binding-target-${actor.id}`;
      const targetSelect = element('select', { attrs: { id: targetId, name: 'targetPrincipal', required: '', 'aria-describedby': `actor-binding-help-${node.id}` } });
      for (const member of roster) targetSelect.append(element('option', {
        text: `${member.displayName} · ${member.access}`,
        attrs: { value: member.principal },
      }));
      if (panelPending && roster.some((member) => member.principal === panelPending.targetPrincipal)) targetSelect.value = panelPending.targetPrincipal;
      form.append(element('p', { text: `Choose an active ${expectedType} identity already on this project as owner or editor.` }));
      form.append(element('label', { text: 'Blueprint role', attrs: { for: roleId } }), roleSelect);
      form.append(rolePreview);
      form.append(element('label', { text: 'Workspace member', attrs: { for: targetId } }), targetSelect);
      const save = element('button', { className: 'button primary', text: 'Save proposed binding', attrs: { type: 'submit' } });
      const noEligibleChoice = !roles.length || !roster.length;
      if (noEligibleChoice) {
        save.disabled = true;
        message.textContent = !roles.length ? 'This actor has no linked role in the current blueprint.' : `No active ${expectedType} owner or editor is available in this workspace.`;
      } else { message.textContent = ''; }
      form.append(save);
      const updateRoleEligibility = () => {
        const alreadyProposed = currentPairs.has(`${actor.id}\n${roleSelect.value}`);
        save.disabled = noEligibleChoice || alreadyProposed;
        if (alreadyProposed) message.textContent = `A proposal already exists for this actor and role in blueprint v${blueprint.version}.`;
        else if (!noEligibleChoice) message.textContent = '';
      };
      roleSelect.addEventListener('change', updateRoleEligibility);
      roleSelect.addEventListener('change', renderRolePreview);
      updateRoleEligibility();
      for (const group of [
        { status: 'proposed', heading: 'Proposed assignments' },
        { status: 'enabled', heading: 'Enabled organizational assignments' },
      ]) {
        const groupProposals = proposals.filter((proposal) => proposal.status === group.status);
        form.append(element('h5', { text: group.heading }));
        if (!groupProposals.length) {
          form.append(element('p', { text: group.status === 'enabled' ? 'No enabled organizational assignments.' : 'No proposed actor-to-role assignments.' }));
          continue;
        }
        const list = element('ul', { className: 'actor-binding-proposals', attrs: { 'aria-label': group.heading } });
        for (const proposal of groupProposals) {
          const stale = proposal.blueprintVersion !== proposal.currentBlueprintVersion;
          const eligibility = proposal.eligibilityStatus ?? (stale ? ['stale_blueprint'] : proposal.targetStatus === 'active_project_member' ? ['eligible'] : ['no_longer_eligible']);
          const stateLabel = stale ? `Pinned to v${proposal.blueprintVersion}; not carried to current v${proposal.currentBlueprintVersion}.` : 'Pinned to the current blueprint version.';
          const entry = element('li');
          entry.append(element('span', { text: `${proposal.roleName} → ${proposal.targetName} (${proposal.status === 'enabled' ? 'enabled organizational responsibility' : 'proposed'}${proposal.executionProfileIds?.length ? ` · allowed profiles ${proposal.executionProfileIds.join(', ')}` : ''}; ${eligibility.map((value) => value.replaceAll('_', ' ')).join(', ')}). ${stateLabel}` }));
          if (proposal.status === 'proposed' && !stale && eligibility.length === 1 && eligibility[0] === 'eligible') {
            if (state.projectAccess !== 'owner') {
              entry.append(element('p', { className: 'edit-help', text: 'A project owner must enable this identity binding before it can be used by supervised agent runs.' }));
              list.append(entry);
              continue;
            }
            const pendingMatch = (candidate) => candidate?.projectId === projectId && candidate.actorId === proposal.actorId
              && candidate.roleId === proposal.roleId && candidate.blueprintVersion === proposal.blueprintVersion;
            let pendingEnable = pendingMatch(state.pendingActorBindingEnable) ? state.pendingActorBindingEnable : null;
            let profileChecks = [];
            let profilePicker = null;
            if (actor.type === 'actor-agent') {
              profilePicker = element('fieldset', { className: 'actor-agent-profile-envelope' });
              profilePicker.append(element('legend', { text: 'Allowed execution profiles (choose up to 8)' }));
              const pendingProfiles = new Set(pendingEnable?.executionProfileIds ?? []);
              for (const profile of executionProfiles) {
                const checkbox = element('input', { attrs: { type: 'checkbox', value: profile.id,
                  ...(pendingProfiles.has(profile.id) ? { checked: true } : {}) } });
                profileChecks.push(checkbox);
                profilePicker.append(element('label', {}, [checkbox, element('span', { text: `${profile.label} · ${profile.kind}` })]));
              }
              profilePicker.append(element('p', { className: 'edit-help', text: 'The agent may request only a selected profile for tasks assigned to this exact actor, role and blueprint version.' }));
              entry.append(profilePicker);
            }
            const enableButton = element('button', { className: 'button ghost', text: pendingEnable ? 'Retry same enable command' : 'Enable organizational assignment', attrs: { type: 'button' } });
            const selectedExecutionProfileIds = () => profileChecks.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
            const updateEnableAvailability = () => {
              const selectedIds = selectedExecutionProfileIds();
              for (const checkbox of profileChecks) checkbox.disabled = Boolean(pendingEnable)
                || (!checkbox.checked && selectedIds.length >= 8);
              enableButton.disabled = Boolean(actor.type === 'actor-agent' && pendingEnable && !pendingEnable.executionProfileIds?.length)
                || (actor.type === 'actor-agent' && selectedIds.length < 1);
            };
            updateEnableAvailability();
            const enableFeedback = element('p', { className: 'field-error edit-error', attrs: { role: 'status', 'aria-live': 'polite' } });
            const sendEnable = async () => {
              pendingEnable ??= {
                projectId, actorId: proposal.actorId, roleId: proposal.roleId, blueprintVersion: proposal.blueprintVersion,
                ...(actor.type === 'actor-agent' ? { executionProfileIds: selectedExecutionProfileIds() } : {}),
                expectedVersion: state.project.version, commandId: `actor-binding-enable:${crypto.randomUUID()}`,
              };
              state.pendingActorBindingEnable = pendingEnable;
              updateEnableAvailability();
              enableButton.disabled = true;
              enableFeedback.textContent = '';
              try {
                const result = await api(`/api/v1/projects/${projectId}/actor-bindings/proposals/enable`, {
                  method: 'POST', body: JSON.stringify(command({ actorId: pendingEnable.actorId, roleId: pendingEnable.roleId,
                    blueprintVersion: pendingEnable.blueprintVersion,
                    ...(pendingEnable.executionProfileIds ? { executionProfileIds: pendingEnable.executionProfileIds } : {}) },
                  pendingEnable.expectedVersion, pendingEnable.commandId)),
                });
                if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
                state.pendingActorBindingEnable = null;
                await loadProject(projectId, { history: 'replace', route: { ...currentRoute(), view: 'map', selectedId: actor.id } });
                notify(actor.type === 'actor-agent'
                  ? `Agent identity enabled for blueprint v${pendingEnable.blueprintVersion} with profiles: ${pendingEnable.executionProfileIds.join(', ')}. Every task run still requires separate approval.`
                  : `Organizational responsibility enabled for blueprint v${pendingEnable.blueprintVersion}. No platform permissions or approval authority were granted.`);
              } catch (failure) {
                if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
                enableFeedback.textContent = failure.message;
                enableButton.disabled = false;
                if (failure.retryable || !failure.code) enableButton.textContent = 'Retry same enable command';
                else {
                  state.pendingActorBindingEnable = null;
                  enableButton.hidden = true;
                }
              }
            };
            enableButton.addEventListener('click', () => void sendEnable());
            profileChecks.forEach((checkbox) => checkbox.addEventListener('change', updateEnableAvailability));
            entry.append(enableButton, enableFeedback);
          }
          if (proposal.status === 'enabled' && actor.type === 'actor-agent' && !proposal.executionProfileIds?.length) {
            if (state.projectAccess !== 'owner') {
              entry.append(element('p', { className: 'edit-help', text: 'This legacy agent binding has no approved execution profiles. A project owner must configure its envelope before it can start agent runs.' }));
            } else {
              const pendingMatch = (candidate) => candidate?.projectId === projectId && candidate.actorId === proposal.actorId
                && candidate.roleId === proposal.roleId && candidate.blueprintVersion === proposal.blueprintVersion;
              let pendingEnvelope = pendingMatch(state.pendingAgentEnvelope) ? state.pendingAgentEnvelope : null;
              const picker = element('fieldset', { className: 'actor-agent-profile-envelope' });
              picker.append(element('legend', { text: 'Configure legacy agent profile envelope (choose up to 8)' }));
              const pendingProfiles = new Set(pendingEnvelope?.executionProfileIds ?? []);
              const checks = [];
              for (const profile of executionProfiles) {
                const checkbox = element('input', { attrs: { type: 'checkbox', value: profile.id,
                  ...(pendingProfiles.has(profile.id) ? { checked: true } : {}) } });
                checks.push(checkbox);
                picker.append(element('label', {}, [checkbox, element('span', { text: `${profile.label} · ${profile.kind}` })]));
              }
              const button = element('button', { className: 'button ghost', text: pendingEnvelope ? 'Retry same envelope command' : 'Save agent profile envelope', attrs: { type: 'button' } });
              const status = element('p', { className: 'field-error edit-error', attrs: { role: 'status', 'aria-live': 'polite' } });
              const selectedIds = () => checks.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
              const updateAvailability = () => {
                for (const checkbox of checks) checkbox.disabled = Boolean(pendingEnvelope)
                  || (!checkbox.checked && selectedIds().length >= 8);
                button.disabled = pendingEnvelope ? !pendingEnvelope.executionProfileIds?.length : selectedIds().length < 1;
              };
              updateAvailability();
              const configure = async () => {
                pendingEnvelope ??= { projectId, actorId: proposal.actorId, roleId: proposal.roleId,
                  blueprintVersion: proposal.blueprintVersion, executionProfileIds: selectedIds(),
                  expectedVersion: state.project.version, commandId: `actor-envelope:${crypto.randomUUID()}` };
                state.pendingAgentEnvelope = pendingEnvelope;
                updateAvailability();
                button.disabled = true;
                try {
                  await api(`/api/v1/projects/${projectId}/actor-bindings/envelope`, { method: 'POST',
                    body: JSON.stringify(command({ actorId: pendingEnvelope.actorId, roleId: pendingEnvelope.roleId,
                      blueprintVersion: pendingEnvelope.blueprintVersion,
                      executionProfileIds: pendingEnvelope.executionProfileIds }, pendingEnvelope.expectedVersion, pendingEnvelope.commandId)) });
                  if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
                  state.pendingAgentEnvelope = null;
                  await loadProject(projectId, { history: 'replace', route: { ...currentRoute(), view: 'map', selectedId: actor.id } });
                } catch (failure) {
                  if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
                  status.textContent = failure.message;
                  if (failure.retryable || !failure.code) button.textContent = 'Retry same envelope command';
                  else { state.pendingAgentEnvelope = null; button.hidden = true; }
                  button.disabled = false;
                }
              };
              button.addEventListener('click', () => void configure());
              checks.forEach((checkbox) => checkbox.addEventListener('change', updateAvailability));
              picker.append(element('p', { className: 'edit-help', text: 'The empty legacy binding remains unusable for agent runs until this owner-selected envelope is saved.' }));
              entry.append(picker, button, status);
            }
          }
          list.append(entry);
        }
        form.append(list);
      }
      const feedback = element('p', { className: 'field-error edit-error', attrs: { role: 'alert', 'aria-live': 'polite' } });
      form.append(feedback);
      const matchesPending = (candidate) => candidate?.projectId === projectId && candidate.actorId === actor.id
        && candidate.roleId === roleSelect.value && candidate.targetPrincipal === targetSelect.value
        && candidate.blueprintVersion === blueprint.version;
      const send = async (pending) => {
        feedback.textContent = '';
        save.disabled = true;
        try {
          await api(`/api/v1/projects/${projectId}/actor-bindings/proposals`, {
            method: 'POST', body: JSON.stringify(command({ actorId: actor.id, roleId: pending.roleId,
              targetPrincipal: pending.targetPrincipal, blueprintVersion: pending.blueprintVersion }, pending.expectedVersion, pending.commandId)),
          });
          if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
          state.pendingActorBinding = null;
          state.view = 'map';
          state.selectedId = actor.id;
          await loadProject(projectId, { history: 'replace', route: { ...currentRoute(), view: 'map', selectedId: actor.id } });
          notify(`Identity binding proposed for blueprint v${pending.blueprintVersion}. No authority was granted.`);
        } catch (failure) {
          if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
          feedback.textContent = failure.message;
          save.disabled = false;
          if (failure.code === 'VERSION_CONFLICT' || failure.code === 'BLUEPRINT_VERSION_STALE' || failure.code === 'AUTHORITY_GENERATION_STALE') {
            state.pendingActorBinding = null;
            const reload = element('button', { className: 'button ghost', text: 'Reload workspace and choose again', attrs: { type: 'button' } });
            reload.addEventListener('click', () => loadProject(projectId, { history: 'replace', route: currentRoute() }));
            feedback.append(document.createTextNode(' '), reload);
          } else if (failure.retryable || !failure.code) {
            const retry = element('button', { className: 'button ghost', text: 'Retry this proposal', attrs: { type: 'button' } });
            retry.addEventListener('click', () => send(pending));
            feedback.append(document.createTextNode(' '), retry);
          }
        }
      };
      if (panelPending && panelPending.blueprintVersion === blueprint.version
        && currentPairs.has(`${actor.id}\n${panelPending.roleId}`)) {
        const replayNotice = element('p', { className: 'edit-help', text: 'The prior response was uncertain and this proposal is now listed. Retry the same command to confirm its saved result.' });
        const retrySaved = element('button', { className: 'button ghost', text: 'Retry same proposal command', attrs: { type: 'button' } });
        retrySaved.addEventListener('click', () => void send(panelPending));
        form.prepend(replayNotice);
        form.append(retrySaved);
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const pending = matchesPending(panelPending) ? panelPending : {
          projectId, actorId: actor.id, roleId: roleSelect.value, targetPrincipal: targetSelect.value,
          blueprintVersion: blueprint.version, expectedVersion: state.project.version,
          commandId: `actor-binding:${crypto.randomUUID()}`,
        };
        state.pendingActorBinding = pending;
        void send(pending);
      });
      section.replaceChildren(section.firstChild, section.children[1], help, message, form);
    } catch (failure) {
      if (state.project?.id === projectId && state.selectedId === actor.id) message.textContent = `Binding roster unavailable: ${failure.message}`;
    }
  };
  const help = element('p', { className: 'sr-only', text: 'The selected identity must be active and an owner or editor in this workspace. Proposals do not authorize execution.', attrs: { id: `actor-binding-help-${node.id}` } });
  section.append(help);
  void load();
  return section;
}

function renderDetail() {
  const detail = document.querySelector('#object-detail');
  if (!detail) return;
  const blueprint = viewedBlueprint();
  const object = blueprintItem(blueprint, state.selectedId);
  const node = viewedGraph().nodes.find((entry) => entry.id === state.selectedId) ?? object;
  if (!node) {
    detail.replaceChildren(element('p', { className: 'detail-placeholder', text: state.selectedId ? 'The requested selected object is unavailable in this saved context. Choose an available record or another saved version.' : 'Select an object to inspect its design status, confidence, provenance, and relationships.' }));
    return;
  }
  const type = element('span', { className: `type type-${node.type}`, text: node.type.replaceAll('-', ' ') });
  const meta = element('div', { className: 'detail-meta' }, [
    element('div', {}, [element('b', { text: 'Design status' }), element('span', { text: node.status })]),
    element('div', {}, [element('b', { text: 'Confidence' }), element('span', { text: node.confidence })]),
  ]);
  const connections = element('div', { className: 'connections' }, [element('h4', { text: 'Connections' })]);
  const relatedLinks = (blueprint?.relations ?? []).filter((link) => link.source === node.id || link.target === node.id);
  for (const link of relatedLinks) {
    const otherId = link.source === node.id ? link.target : link.source;
    const other = blueprintItem(blueprint, otherId);
    if (!other) continue;
    const button = element('button', { text: `${link.type} · ${other.name}`, attrs: { type: 'button' } });
    button.addEventListener('click', () => { state.activeTypes.add(other.type); selectNode(other.id); });
    connections.append(button);
  }
  const interchangeOwner = { projectId: state.project?.id, principal: state.sessionPrincipal, generation: state.projectLoadGeneration };
  const isCurrentInterchangeContext = () => state.project?.id === interchangeOwner.projectId
    && state.sessionPrincipal === interchangeOwner.principal && state.projectLoadGeneration === interchangeOwner.generation;
  const content = [type, element('h3', { text: node.name }), element('p', { text: node.detail }), meta,
    element('p', { text: `Evidence: ${node.provenance?.at(-1)?.note ?? 'No provenance recorded'}` }), connections,
    versionHistoryFor(node)];
  if (state.enterpriseModel && object) content.push(renderEnterpriseObject({ projectId: state.project?.id, model: state.enterpriseModel, object,
    pending: state.pendingEnterprise, loading: state.enterpriseLoading || state.enterpriseBusy, simulation: state.enterpriseSimulation, processDraft: state.enterpriseProcessDraft,
    economicDraft: state.enterpriseEconomicDraft, refinementDraft: state.enterpriseRefinementDraft, interchangeDraft: state.enterpriseInterchangeDraft,
    selectedSimulationId: state.enterpriseQuery.simulationId, el: element, api, onCommand: saveEnterpriseCommand,
    onDraftChange: (value) => { if (isCurrentInterchangeContext()) retainEnterpriseInterchangeDraft(value); },
    isCurrentContext: isCurrentInterchangeContext,
    onInspectDraft: (query, selectedId) => changeEnterpriseContext(query, { preserveProcessDraft: true, preserveEconomicDraft: true, preserveRefinementDraft: true, preserveInterchangeDraft: true, preserveIntegrityDraft: true, selectedId }),
    onSimulationSelection: (simulationId) => changeEnterpriseContext({ ...state.enterpriseQuery, simulationId }),
    economicEvaluationId: state.enterpriseQuery.economicEvaluationId,
    onEconomicEvaluationSelection: (economicEvaluationId) => changeEnterpriseContext({ ...state.enterpriseQuery, economicEvaluationId }),
    onInspectEconomicEvaluation: (evaluation) => changeEnterpriseContext({ ...state.enterpriseQuery,
      blueprintVersion: evaluation.source.branchId || evaluation.source.proposalId ? null : evaluation.source.blueprintVersion,
      branchId: evaluation.source.branchId, branchRevision: evaluation.source.branchRevision,
      proposalId: evaluation.source.proposalId, recordedAt: null, economicEvaluationId: evaluation.id }, { selectedId: evaluation.economicsId }),
    onInspectSimulation: (simulation) => changeEnterpriseContext({ ...state.enterpriseQuery, blueprintVersion: simulation.source.branchId || simulation.source.proposalId ? null : simulation.source.blueprintVersion, branchId: simulation.source.branchId, branchRevision: simulation.source.branchRevision, proposalId: simulation.source.proposalId, recordedAt: null, simulationId: simulation.id }, { selectedId: simulation.source.processId }) }));
  const savedProcess = !enterpriseReadOnly() && node.type === 'process' ? blueprintItem(state.project.latestBlueprint, node.id) : null;
  if (savedProcess?.type === 'process') {
    const planLink = element('a', {
      className: 'button', text: 'Plan this process in Execution',
      attrs: { href: encodeExecutionRoute(state.project.id, { projectId: state.project.id, processId: savedProcess.id }) },
    });
    planLink.addEventListener('click', (event) => {
      if (!allowRouteChange()) event.preventDefault();
    });
    content.push(planLink);
  }
  const editForm = renderBlueprintEditForm(node);
  if (editForm) content.push(editForm);
  const actorBindingPanel = renderActorBindingPanel(node);
  if (actorBindingPanel) content.push(actorBindingPanel);
  if (state.enterpriseModel && object?.type === 'information') {
    const stewardshipPanel = renderEnterpriseStewardshipPanel({ model: state.enterpriseModel,
      pending: state.pendingEnterprise, loading: state.enterpriseLoading || state.enterpriseBusy,
      el: element, onCommand: saveEnterpriseCommand });
    if (stewardshipPanel) content.push(stewardshipPanel);
  }
  detail.replaceChildren(...content);
}

select.addEventListener('change', () => {
  if (!allowRouteChange()) { select.value = state.project?.id ?? ''; return; }
  state.draft = '';
  state.pendingMessage = null;
  loadProject(select.value);
});
document.querySelector('#new-project').addEventListener('click', () => {
  if (!allowRouteChange()) return;
  showWelcome();
});
signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Sign-out could not be completed.');
    window.location.assign('/sign-in.html?signed_out=1');
  } catch (error) {
    notify(error.message);
    signOutButton.disabled = false;
  }
});
window.addEventListener('beforeunload', (event) => { if (hasUnsavedDraft()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('popstate', async () => {
  if (!allowRouteChange()) { window.history.forward(); return; }
  state.draft = '';
  state.pendingMessage = null;
  state.restoringHistory = true;
  const route = decodeStudioRoute(window.location.href);
  if (route.projectId) await loadProject(route.projectId, { history: null, route }); else showWelcome({ history: null });
  state.restoringHistory = false;
});

try {
  showAppState('loading', 'Loading workspace', 'Checking actual records and available capabilities…');
  const [foundation, , session] = await Promise.all([api('/api/v1/foundation'), refreshProjects(), fetch('/auth/session').then((response) => response.json())]);
  state.foundation = foundation.data;
  state.sessionRoles = session.roles ?? [];
  state.sessionPrincipal = session.principal ?? null;
  foundationBadge.lastChild.textContent = ` ${state.foundation.identity.status === 'development_unverified' ? 'Development identity' : 'Authenticated workspace'}`;
  signOutButton.hidden = !session.authenticated;
  const route = decodeStudioRoute(window.location.href);
  if (route.projectId) await loadProject(route.projectId, { history: 'replace', route }); else showWelcome({ history: 'replace' });
  showProjectSourceWarning();
} catch (error) {
  app.replaceChildren();
  showRequestFailure(error, () => window.location.reload());
}
