import { connectedNodeIds, filterGraph, toggleType, zoomTransform } from './map-state.js';
import { apiErrorFrom, decodeStudioRoute, encodeStudioRoute, fieldErrorsFor } from './shared-interactions.mjs';
import { coverageAreaStateLabel, coverageForBlueprint } from './coverage-dashboard.mjs';
import { compareBlueprintObjectVersions } from './blueprint-comparison.mjs';

const state = {
  projects: [],
  project: null,
  view: 'blueprint',
  mapMode: 'graph',
  mapAreaFilter: null,
  coverageReturnContext: null,
  activeTypes: new Set(),
  selectedId: null,
  transform: { x: 0, y: 0, k: 1 },
  foundation: null,
  sessionRoles: [],
  draft: '',
  pendingCreate: null,
  pendingMessage: null,
  pendingBlueprintEdit: null,
  blueprintEditDraft: null,
  pendingActorBinding: null,
  pendingActorBindingEnable: null,
  requestedProjectId: null,
  restoringHistory: false,
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
  if (!response.ok) throw apiErrorFrom(result);
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
  return { projectId: state.project?.id ?? null, view: state.view, selectedId: state.selectedId, types: [...state.activeTypes], area: state.mapAreaFilter };
}

function syncRoute(mode = 'push') {
  if (state.restoringHistory || !mode) return;
  const url = encodeStudioRoute(currentRoute());
  window.history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', url);
}

function hasUnsavedDraft() { return Boolean(state.draft.trim() || state.pendingBlueprintEdit || state.blueprintEditDraft || state.pendingActorBinding || state.pendingActorBindingEnable); }

function allowRouteChange() {
  if (!hasUnsavedDraft()) return true;
  const prompt = state.pendingBlueprintEdit || state.blueprintEditDraft || state.pendingActorBinding ? 'Leave and discard this unsaved workspace change?' : 'Discard the unsent answer and leave this workspace?';
  const accepted = window.confirm(prompt);
  if (accepted) { state.pendingBlueprintEdit = null; state.blueprintEditDraft = null; state.pendingActorBinding = null; state.pendingActorBindingEnable = null; }
  return accepted;
}

function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

async function refreshProjects() {
  const result = await api('/api/v1/projects');
  state.projects = result.data;
  select.replaceChildren(element('option', { text: state.projects.length ? 'Choose project…' : 'No projects yet', attrs: { value: '' } }));
  for (const project of state.projects) select.append(element('option', { text: project.name, attrs: { value: project.id } }));
  select.value = state.project?.id ?? '';
}

function showWelcome({ history = 'push' } = {}) {
  state.requestedProjectId = null;
  state.pendingBlueprintEdit = null;
  state.blueprintEditDraft = null;
  state.pendingActorBinding = null;
  state.pendingActorBindingEnable = null;
  state.project = null;
  state.selectedId = null;
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
    state.requestedProjectId = result.data.id;
    state.pendingCreate = null;
    renderStudio();
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
  if (state.project?.id !== id) { state.pendingBlueprintEdit = null; state.blueprintEditDraft = null; state.pendingActorBinding = null; state.pendingActorBindingEnable = null; }
  state.requestedProjectId = id;
  try {
    showAppState('loading', 'Loading workspace', 'Restoring saved conversation, blueprint, and view state…');
    const result = await api(`/api/v1/projects/${id}`);
    if (state.requestedProjectId !== id) return;
    state.project = result.data;
    const validTypes = new Set(state.project.graph.types);
    state.activeTypes = new Set(route?.types?.filter((type) => validTypes.has(type)) ?? state.project.graph.types);
    if (!state.activeTypes.size) state.activeTypes = new Set(state.project.graph.types);
    state.selectedId = state.project.graph.nodes.some((node) => node.id === route?.selectedId) ? route.selectedId : null;
    state.mapAreaFilter = route?.area ?? null;
    state.coverageReturnContext = null;
    state.view = state.project.latestBlueprint && ['map', 'coverage'].includes(route?.view) ? route.view : 'blueprint';
    renderStudio();
    hideAppState();
    syncRoute(history);
  } catch (error) {
    showRequestFailure(error, () => loadProject(id, { history, route }));
  }
}

function renderStudio() {
  app.replaceChildren(document.querySelector('#studio-template').content.cloneNode(true));
  document.querySelector('.studio').classList.toggle('complete', state.project.phase !== 'discovery');
  document.querySelector('#project-title').textContent = state.project.name;
  renderConversation();
  document.querySelector('#message-form').addEventListener('submit', sendMessage);
  const textarea = document.querySelector('#message-input');
  textarea.value = state.draft;
  textarea.addEventListener('input', () => {
    state.draft = textarea.value;
    if (state.pendingMessage && state.pendingMessage.content !== state.draft) state.pendingMessage = null;
    setFieldError('message-error', []);
  });
  for (const button of document.querySelectorAll('.view-tabs button')) button.addEventListener('click', () => setView(button.dataset.view));

  if (state.project.latestBlueprint) {
    document.querySelector('#workspace-empty').hidden = true;
    document.querySelector('#blueprint-workspace').hidden = false;
    document.querySelector('#blueprint-title').textContent = state.project.latestBlueprint.title;
    document.querySelector('#blueprint-version').textContent = state.project.latestBlueprint.version;
    if (!state.activeTypes.size) state.activeTypes = new Set(state.project.graph.types);
    renderBlueprint();
    setView(state.view, { history: null });
    setupMapControls();
  }
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
  const form = event.currentTarget;
  const textarea = form.elements['message-input'];
  const button = form.querySelector('button');
  state.draft = textarea.value;
  setFieldError('message-error', []);
  button.disabled = true;
  try {
    state.pendingMessage ??= { commandId: `message:${crypto.randomUUID()}`, content: state.draft };
    showAppState('loading', 'Saving answer', 'Keeping this draft until the server confirms its durable version…');
    const result = await api(`/api/v1/projects/${state.project.id}/messages`, {
      method: 'POST', body: JSON.stringify(command({ content: state.pendingMessage.content }, state.project.version, state.pendingMessage.commandId)),
    });
    state.project = result.data;
    state.pendingMessage = null;
    state.draft = '';
    if (state.project.latestBlueprint) {
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
  const area = state.project.latestBlueprint.areas[areaKey];
  if (!area) return;
  state.coverageReturnContext = {
    projectId: state.project.id, view: 'coverage', selectedId: state.selectedId,
    types: [...state.activeTypes], mapMode: state.mapMode, area: state.mapAreaFilter,
  };
  const node = area.items.find((item) => state.project.graph.nodes.some((graphNode) => graphNode.id === item.id));
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

function renderCoverage() {
  const target = document.querySelector('#coverage-view');
  if (!target || !state.project.latestBlueprint) return;
  const coverage = coverageForBlueprint(state.project.latestBlueprint);
  target.replaceChildren();
  target.append(element('div', { className: 'coverage-heading' }, [
    element('div', {}, [element('span', { className: 'eyebrow', text: 'Saved blueprint coverage' }), element('h3', { text: `Version ${coverage.blueprintVersion} · ${coverage.epistemicStatus.replaceAll('-', ' ')}` })]),
    element('p', { text: 'This is proposed design coverage. Founder chat and edit history provide provenance, not independent business evidence or verification.' }),
  ]));
  const totals = element('div', { className: 'coverage-counts', attrs: { 'aria-label': 'Coverage counts' } });
  for (const [value, label] of [[coverage.areaCounts.designed, 'Designed areas'], [coverage.areaCounts.unknown, 'Unknown areas'], [coverage.areaCounts.outOfScope, 'Out of scope'], [coverage.gaps.length, 'Open design gaps'], [coverage.assumptions.length, 'Untested assumptions'], [coverage.unknowns.length, 'Recorded unknowns']]) {
    totals.append(element('div', {}, [element('strong', { text: value }), element('span', { text: label })]));
  }
  target.append(totals);
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
  const blueprint = state.project.latestBlueprint;
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
  document.querySelector('#graph-mode').addEventListener('click', () => setMapMode('graph'));
  document.querySelector('#list-mode').addEventListener('click', () => setMapMode('list'));
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
      const area = state.project.latestBlueprint.areas[state.mapAreaFilter];
      areaContext.append(element('span', { text: `Coverage drill-in · ${area?.label ?? state.mapAreaFilter}` }));
      const back = element('button', { className: 'button ghost', text: 'Return to coverage', attrs: { type: 'button' } });
      back.addEventListener('click', returnToCoverage);
      areaContext.append(back);
    }
  }
  const filters = document.querySelector('#type-filters');
  filters.replaceChildren();
  for (const type of state.project.graph.types) {
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
  setMapMode(state.mapMode);
  renderDetail();
}

function visibleGraph() {
  const filtered = filterGraph(state.project.graph, state.activeTypes);
  if (!state.mapAreaFilter) return filtered;
  const nodes = filtered.nodes.filter((node) => node.area === state.mapAreaFilter);
  const ids = new Set(nodes.map((node) => node.id));
  return { ...filtered, nodes, links: filtered.links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
}

function nodePositions(nodes) {
  const byArea = new Map();
  for (const node of nodes) {
    if (!byArea.has(node.area)) byArea.set(node.area, []);
    byArea.get(node.area).push(node);
  }
  const allAreas = Object.keys(state.project.latestBlueprint.areas);
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
  const svg = svgElement('svg', { viewBox: '0 0 1200 760', role: 'img', 'aria-label': `${nodes.length} organisational objects and ${links.length} relationships` });
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
    const group = svgElement('g', { transform: `translate(${position.x} ${position.y})`, class: `graph-node${node.id === selected ? ' selected' : ''}${selected && !neighbors.has(node.id) ? ' dimmed' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${node.type}: ${node.name}` });
    group.append(svgElement('circle', { r: node.id === selected ? 12 : 9, fill: typeColors[node.type] ?? '#9daaa2' }));
    const label = svgElement('text', { x: '14', y: '4' }); label.textContent = node.name; group.append(label);
    const title = svgElement('title'); title.textContent = `${node.name} — ${node.detail}`; group.append(title);
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
  svg.addEventListener('pointerdown', (event) => { dragging = true; start = { x: event.clientX, y: event.clientY, tx: state.transform.x, ty: state.transform.y }; svg.classList.add('dragging'); svg.setPointerCapture(event.pointerId); });
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
      const row = element('button', { className: `list-row${node.id === state.selectedId ? ' selected' : ''}`, attrs: { type: 'button' } }, [
        element('i', { className: `type-dot type-${node.type}` }), element('span', { text: node.type.replaceAll('-', ' ') }),
        element('strong', { text: node.name }), element('small', { text: node.status }),
      ]);
      row.addEventListener('click', () => selectNode(node.id)); section.append(row);
    }
    canvas.append(section);
  }
}

function selectNode(id) {
  state.selectedId = id;
  if (state.mapMode === 'graph') renderGraph(); else renderList();
  renderDetail();
  syncRoute('push');
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
        const labels = { proposedInstructions: 'Proposed instructions', proposedScopeStatements: 'Proposed scope statements', proposedToolStatements: 'Proposed tool statements', proposedEscalationRules: 'Proposed escalation rules' };
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
        : key === 'proposedInstructions' ? 'Proposed instructions'
          : key === 'proposedScopeStatements' ? 'Proposed scope statements'
            : key === 'proposedToolStatements' ? 'Proposed tool statements'
              : key === 'proposedEscalationRules' ? 'Proposed escalation rules'
            : key[0].toUpperCase() + key.slice(1);
      entry.append(element('div', { className: 'history-diff' }, [
        element('b', { text: label }),
        element('p', { text: `Before: ${edit.before[key] || '—'}` }),
        element('p', { text: `After: ${edit.after[key] || '—'}` }),
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

function editField(form, labelText, name, value, { multiline = false, maxLength = 700, required = true } = {}) {
  const id = `blueprint-edit-${name}`;
  const label = element('label', { text: labelText, attrs: { for: id } });
  const control = element(multiline ? 'textarea' : 'input', { attrs: { id, name, ...(required ? { required: '' } : {}), maxlength: String(maxLength), 'aria-describedby': 'blueprint-edit-help' } });
  control.value = value ?? '';
  form.append(label, control);
  return control;
}

function renderBlueprintEditForm(node) {
  if (!state.sessionRoles.includes('workspace-write')) return null;
  const object = blueprintItem(state.project.latestBlueprint, node.id);
  if (!object || !['capability', 'process', 'role'].includes(object.type)) return null;
  const pending = state.pendingBlueprintEdit?.projectId === state.project.id && state.pendingBlueprintEdit?.payload.objectId === node.id ? state.pendingBlueprintEdit : null;
  const draft = state.blueprintEditDraft?.projectId === state.project.id && state.blueprintEditDraft?.objectId === node.id ? state.blueprintEditDraft.payload : null;
  const pendingPayload = pending?.payload;
  const form = element('form', { className: 'blueprint-edit-form' });
  form.append(element('h4', { text: 'Edit proposed design' }));
  form.append(element('p', { className: 'edit-help', text: 'Saving creates a new immutable proposed version. This does not enable the process or grant authority.', attrs: { id: 'blueprint-edit-help' } }));
  const name = editField(form, 'Name', 'name', pendingPayload?.name ?? draft?.name ?? object.name, { maxLength: 120 });
  const detail = editField(form, 'Detail', 'detail', pendingPayload?.detail ?? draft?.detail ?? object.detail, { multiline: true, maxLength: 700 });
  let ownerRole = null;
  if (object.type === 'capability' || object.type === 'process') {
    ownerRole = element('select', { attrs: { id: 'blueprint-edit-ownerRoleName', name: 'ownerRoleName', required: '', 'aria-describedby': 'blueprint-edit-help' } });
    const roles = Object.values(state.project.latestBlueprint.areas).flatMap((entry) => entry.items).filter((item) => item.type === 'role');
    for (const role of roles) ownerRole.append(element('option', { text: role.name, attrs: { value: role.name } }));
    const currentRole = roles.find((role) => role.id === object.owner);
    ownerRole.value = pendingPayload?.ownerRoleName ?? draft?.ownerRoleName ?? currentRole?.name ?? '';
    form.append(element('label', { text: 'Owner role', attrs: { for: ownerRole.id } }), ownerRole);
  }
  let trigger = null;
  let instructions = null;
  let scopeStatements = null;
  let toolStatements = null;
  let escalationRules = null;
  if (object.type === 'process') trigger = editField(form, 'Process trigger', 'trigger', pendingPayload?.trigger ?? draft?.trigger ?? object.trigger, { maxLength: 240 });
  if (object.type === 'role') {
    const existingScope = object.proposedScopeStatements ?? (object.authority ?? []).filter((value) => !(typeof value === 'string' && value.startsWith('decision-')));
    scopeStatements = editField(form, 'Proposed role scope statements (one per line)', 'proposedScopeStatements', (pendingPayload?.proposedScopeStatements ?? draft?.proposedScopeStatements ?? existingScope).join('\n'), { multiline: true, maxLength: 2900 });
    instructions = editField(form, 'Proposed instructions', 'proposedInstructions', pendingPayload?.proposedInstructions ?? draft?.proposedInstructions ?? object.proposedInstructions, { multiline: true, maxLength: 700 });
    const split = (value) => (Array.isArray(value) ? value : []).join('\n');
    toolStatements = editField(form, 'Proposed tools (one per line; optional)', 'proposedToolStatements', split(pendingPayload?.proposedToolStatements ?? draft?.proposedToolStatements ?? object.proposedToolStatements), { multiline: true, maxLength: 2900, required: false });
    escalationRules = editField(form, 'Proposed escalation rules (one per line; optional)', 'proposedEscalationRules', split(pendingPayload?.proposedEscalationRules ?? draft?.proposedEscalationRules ?? object.proposedEscalationRules), { multiline: true, maxLength: 2900, required: false });
    form.append(element('p', { className: 'edit-help', text: 'Scope, tools, escalation rules, and instructions are proposals only. They do not grant platform access, permissions, tool dispatch, or execution authority.' }));
  }
  const error = element('p', { className: 'field-error edit-error', attrs: { role: 'alert', 'aria-live': 'polite', hidden: '' } });
  const recovery = element('div', { className: 'edit-recovery' });
  const save = element('button', { className: 'button primary', text: 'Save new version', attrs: { type: 'submit' } });
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
    notify(`Draft is ready against blueprint version ${state.project.latestBlueprint.version}.`);
  });
  form.append(error, recovery, latestVersion, save);
  const values = () => ({ objectId: node.id, name: name.value.trim(), detail: detail.value.trim(),
    ...(ownerRole ? { ownerRoleName: ownerRole.value } : {}), ...(trigger ? { trigger: trigger.value.trim() } : {}),
    ...(instructions ? { proposedInstructions: instructions.value.trim() } : {}),
    ...(scopeStatements ? { proposedScopeStatements: scopeStatements.value.split('\n').map((line) => line.trim()).filter(Boolean) } : {}),
    ...(toolStatements ? { proposedToolStatements: toolStatements.value.split('\n').map((line) => line.trim()).filter(Boolean) } : {}),
    ...(escalationRules ? { proposedEscalationRules: escalationRules.value.split('\n').map((line) => line.trim()).filter(Boolean) } : {}) });
  const trackDraft = () => {
    const payload = values();
    const current = blueprintItem(state.project.latestBlueprint, node.id);
    const unchanged = payload.name === current.name && payload.detail === current.detail
      && (!ownerRole || payload.ownerRoleName === Object.values(state.project.latestBlueprint.areas).flatMap((entry) => entry.items).find((item) => item.id === current.owner)?.name)
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
        await loadProject(projectId, { history: 'replace', route: { view: 'map', selectedId, types: [...previousTypes] } });
        return;
      }
      state.project = result.data;
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
  if (!state.sessionRoles.includes('workspace-write')) return null;
  const actor = blueprintItem(state.project.latestBlueprint, node.id);
  if (!actor || !['actor-human', 'actor-agent'].includes(actor.type)) return null;
  const projectId = state.project.id;
  const blueprint = state.project.latestBlueprint;
  const expectedType = actor.type === 'actor-human' ? 'human' : 'workload';
  const section = element('section', { className: 'actor-binding-panel', attrs: { 'aria-labelledby': `actor-binding-heading-${node.id}` } });
  section.append(element('h4', { text: 'Propose identity binding', attrs: { id: `actor-binding-heading-${node.id}` } }));
  section.append(element('p', { className: 'edit-help', text: 'Bindings start proposed and are pinned to a blueprint version. Enabled confirms organizational responsibility only; neither status grants platform access, permissions, approval authority, tool dispatch, or execution authority. New blueprint versions do not inherit a proposal.' }));
  const message = element('p', { className: 'field-error edit-error', attrs: { role: 'status', 'aria-live': 'polite' } });
  message.textContent = 'Loading authorized workspace roster…';
  section.append(message);
  const panelPending = state.pendingActorBinding?.projectId === projectId && state.pendingActorBinding?.actorId === actor.id ? state.pendingActorBinding : null;
  const load = async () => {
    try {
      const [rosterResult, proposalsResult] = await Promise.all([
        api(`/api/v1/projects/${projectId}/members`),
        api(`/api/v1/projects/${projectId}/actor-bindings/proposals`),
      ]);
      if (state.project?.id !== projectId || state.selectedId !== actor.id) return;
      const roster = rosterResult.data.filter((member) => ['owner', 'editor'].includes(member.access) && member.actorType === expectedType);
      const proposals = proposalsResult.data.proposals.filter((proposal) => proposal.actorId === actor.id);
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
        const responsibilities = (selectedRole.responsibilities ?? []).map((id) => byId.get(id)?.name).filter(Boolean);
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
          entry.append(element('span', { text: `${proposal.roleName} → ${proposal.targetName} (${proposal.status === 'enabled' ? 'enabled organizational responsibility' : 'proposed'}; ${eligibility.map((value) => value.replaceAll('_', ' ')).join(', ')}). ${stateLabel}` }));
          if (proposal.status === 'proposed' && !stale && eligibility.length === 1 && eligibility[0] === 'eligible') {
            const pendingMatch = (candidate) => candidate?.projectId === projectId && candidate.actorId === proposal.actorId
              && candidate.roleId === proposal.roleId && candidate.blueprintVersion === proposal.blueprintVersion;
            let pendingEnable = pendingMatch(state.pendingActorBindingEnable) ? state.pendingActorBindingEnable : null;
            const enableButton = element('button', { className: 'button ghost', text: pendingEnable ? 'Retry same enable command' : 'Enable organizational assignment', attrs: { type: 'button' } });
            const enableFeedback = element('p', { className: 'field-error edit-error', attrs: { role: 'status', 'aria-live': 'polite' } });
            const sendEnable = async () => {
              pendingEnable ??= {
                projectId, actorId: proposal.actorId, roleId: proposal.roleId, blueprintVersion: proposal.blueprintVersion,
                expectedVersion: state.project.version, commandId: `actor-binding-enable:${crypto.randomUUID()}`,
              };
              state.pendingActorBindingEnable = pendingEnable;
              enableButton.disabled = true;
              enableFeedback.textContent = '';
              try {
                const result = await api(`/api/v1/projects/${projectId}/actor-bindings/proposals/enable`, {
                  method: 'POST', body: JSON.stringify(command({ actorId: pendingEnable.actorId, roleId: pendingEnable.roleId,
                    blueprintVersion: pendingEnable.blueprintVersion }, pendingEnable.expectedVersion, pendingEnable.commandId)),
                });
                if (state.project?.id !== projectId || state.requestedProjectId !== projectId) return;
                state.pendingActorBindingEnable = null;
                await loadProject(projectId, { history: 'replace', route: { ...currentRoute(), view: 'map', selectedId: actor.id } });
                notify(`Organizational responsibility enabled for blueprint v${pendingEnable.blueprintVersion}. No platform permissions or execution authority were granted.`);
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
            entry.append(enableButton, enableFeedback);
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
  const node = state.project.graph.nodes.find((entry) => entry.id === state.selectedId);
  if (!node) {
    detail.replaceChildren(element('p', { className: 'detail-placeholder', text: 'Select an object to inspect its design status, confidence, provenance, and relationships.' }));
    return;
  }
  const type = element('span', { className: `type type-${node.type}`, text: node.type.replaceAll('-', ' ') });
  const meta = element('div', { className: 'detail-meta' }, [
    element('div', {}, [element('b', { text: 'Status' }), element('span', { text: node.status })]),
    element('div', {}, [element('b', { text: 'Confidence' }), element('span', { text: node.confidence })]),
  ]);
  const connections = element('div', { className: 'connections' }, [element('h4', { text: 'Connections' })]);
  const relatedLinks = state.project.graph.links.filter((link) => link.source === node.id || link.target === node.id);
  for (const link of relatedLinks) {
    const otherId = link.source === node.id ? link.target : link.source;
    const other = state.project.graph.nodes.find((entry) => entry.id === otherId);
    if (!other) continue;
    const button = element('button', { text: `${link.type} · ${other.name}`, attrs: { type: 'button' } });
    button.addEventListener('click', () => { state.activeTypes.add(other.type); selectNode(other.id); });
    connections.append(button);
  }
  const content = [type, element('h3', { text: node.name }), element('p', { text: node.detail }), meta,
    element('p', { text: `Evidence: ${node.provenance?.at(-1)?.note ?? 'No provenance recorded'}` }), connections,
    versionHistoryFor(node)];
  const editForm = renderBlueprintEditForm(node);
  if (editForm) content.push(editForm);
  const actorBindingPanel = renderActorBindingPanel(node);
  if (actorBindingPanel) content.push(actorBindingPanel);
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
  foundationBadge.lastChild.textContent = ` ${state.foundation.identity.status === 'development_unverified' ? 'Development identity' : 'Authenticated workspace'}`;
  signOutButton.hidden = !session.authenticated;
  const route = decodeStudioRoute(window.location.href);
  if (route.projectId) await loadProject(route.projectId, { history: 'replace', route }); else showWelcome({ history: 'replace' });
  showProjectSourceWarning();
} catch (error) {
  app.replaceChildren();
  showRequestFailure(error, () => window.location.reload());
}
