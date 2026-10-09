import { canAcceptIntentEvaluation, caseUiModel, contextManifestPresentation, createSourceSelectionGuard, eligibleActorBindings, intentEvaluationAcceptancePresentation, n3StageStatusCopy, processBehaviorScenarioExecutionPresentation, processBehaviorTestPlanPresentation, processEvidenceReviewPresentation, processRunEvidencePresentation, productHarnessEligiblePlanGroups, productHarnessRequestFormVisibility, repositoryCheckObservationPresentation, savedProjectPinSummary, sentinelAssessmentChoices, sourceBindingDesignRoute } from './sdlc-view.mjs';
import { encodeExecutionRoute, encodeStudioRoute } from './shared-interactions.mjs';
import { clearPendingSoftwareStart, createSoftwareStartFlightGuard, pendingSoftwareStartKey } from './software-runtime-start.mjs';
import { openInitialCase, sourceObjectPreview } from './sdlc-routing.mjs';

const state = { meta: null, projects: [], sourceProject: null, activeSourceProject: null, behaviorRepositories: [], sourceSelectionGuard: createSourceSelectionGuard(), cases: [], changeCase: null, softwareDeliveryPlans: [], actorBindings: [], tab: 'overview', authenticated: false, principal: null, tenantId: '', sessionId: '' };
const softwareStartFlights = createSoftwareStartFlightGuard();
let caseSelectionId = 0;
function syncCaseRoute(id = null) {
  const route = new URL(window.location.href);
  if (id) route.searchParams.set('case', id); else route.searchParams.delete('case');
  history.replaceState(null, '', `${route.pathname}${route.search}${route.hash}`);
}
const app = document.querySelector('#sdlc-app');
const list = document.querySelector('#case-list');
const toast = document.querySelector('#sdlc-toast');

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of Array.isArray(children) ? children : [children]) if (child) node.append(child);
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Request failed.');
    error.status = response.status;
    error.code = typeof result.error === 'object' ? result.error?.code ?? null : null;
    error.details = typeof result.error === 'object' ? result.error?.details ?? null : null;
    error.currentVersion = typeof result.error === 'object' ? result.error?.currentVersion ?? null : null;
    throw error;
  }
  return result;
}

function notify(message) {
  toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function uid(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

async function refreshCases() {
  state.cases = (await api('/api/sdlc/cases')).cases;
  renderCaseList();
}

function renderCaseList() {
  list.replaceChildren();
  if (!state.cases.length) return list.append(el('p', { className: 'case-list-empty', text: 'No governed changes yet. Create the reference case to begin.' }));
  for (const item of state.cases) {
    const button = el('button', { className: `case-link${item.id === state.changeCase?.id ? ' active' : ''}`, attrs: { type: 'button' } }, [
      el('strong', { text: item.title }), el('span', {}, [el('i', { text: item.currentStage ?? 'Complete' }), el('i', { text: item.status.replace('_', ' ') })]),
    ]);
    button.addEventListener('click', () => loadCase(item.id)); list.append(button);
  }
}

function showWelcome({ requestedProjectId = null, exactProjectRequested = false } = {}) {
  caseSelectionId += 1;
  syncCaseRoute();
  state.changeCase = null; state.tab = 'overview';
  app.replaceChildren(document.querySelector('#sdlc-welcome').content.cloneNode(true));
  const select = document.querySelector('#mutation-select');
  for (const [value, entry] of Object.entries(state.meta.mutations)) select.append(el('option', { text: entry.label, attrs: { value } }));
  const projectSelect = document.querySelector('#case-project');
  if (exactProjectRequested) projectSelect.append(el('option', { text: 'Choose an available workspace…', attrs: { value: '' } }));
  for (const project of state.projects) projectSelect.append(el('option', { text: project.name, attrs: { value: project.id } }));
  if (exactProjectRequested) projectSelect.value = state.projects.some((project) => project.id === requestedProjectId) ? requestedProjectId : '';
  if (!state.projects.length) document.querySelector('#case-form button[type="submit"]').disabled = true;
  projectSelect.addEventListener('change', () => loadSourceProject(projectSelect.value));
  select.addEventListener('change', renderMutationExpectation);
  document.querySelector('#case-sentinel-assessment').addEventListener('change', renderSourcePreview);
  document.querySelector('#case-sentinel-scope').addEventListener('change', renderSourcePreview);
  document.querySelector('#case-form').addEventListener('submit', createCase);
  if (projectSelect.value) loadSourceProject(projectSelect.value);
  renderMutationExpectation(); renderCaseList();
}

async function loadSourceProject(projectId) {
  const ticket = state.sourceSelectionGuard.begin(projectId);
  const objectSelect = document.querySelector('#case-source-object');
  const sentinelSelect = document.querySelector('#case-sentinel-assessment');
  const preview = document.querySelector('#source-preview');
  const submitButton = document.querySelector('#case-form button[type="submit"]');
  submitButton.disabled = true;
  preview.textContent = 'Loading the selected project’s current saved design…';
  objectSelect.replaceChildren(el('option', { text: 'Choose a saved design object…', attrs: { value: '' } })); state.sourceProject = null;
  sentinelSelect.replaceChildren(el('option', { text: 'Create as explicitly unassessed', attrs: { value: '' } })); sentinelSelect.disabled = true;
  try {
    const projectResult = await api(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    const project = projectResult.data;
    if (!state.sourceSelectionGuard.isCurrent(ticket, document.querySelector('#case-project')?.value ?? null)) return;
    state.sourceProject = project;
    const matchingAssessments = sentinelAssessmentChoices(project);
    for (const report of matchingAssessments) sentinelSelect.append(el('option', { text: `${report.status} · ${report.profile?.id} v${report.profile?.version} · assessed aggregate v${report.source.assessedAggregateVersion} · ${report.id}`,
      attrs: { value: report.id, 'data-report-hash': report.reportHash } }));
    sentinelSelect.disabled = false;
    document.querySelector('#sentinel-source-preview').textContent = matchingAssessments.length
      ? 'Select one exact saved report. Its immutable profile and report hashes will be pinned to this case; coverage remains limited to the declared profile.'
      : 'No assessment matches this exact blueprint. The case can be created as NOT_ASSESSED, but context planning will be blocked.';
    const objects = Object.values(project.latestBlueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
    for (const object of objects) objectSelect.append(el('option', { text: `${object.name} · ${object.type}`, attrs: { value: object.id } }));
    if (!objects.length) {
      objectSelect.replaceChildren(el('option', { text: 'No saved blueprint objects', attrs: { value: '' } }));
      submitButton.disabled = true;
      preview.textContent = 'This project has no saved blueprint objects yet.';
    } else {
      objectSelect.value = '';
      submitButton.disabled = true;
      renderSourcePreview();
    }
    objectSelect.onchange = renderSourcePreview;
  } catch (error) {
    if (!state.sourceSelectionGuard.isCurrent(ticket, document.querySelector('#case-project')?.value ?? null)) return;
    preview.textContent = error.message;
    submitButton.disabled = true;
  }
}

function renderSourcePreview() {
  const project = state.sourceProject;
  const selected = document.querySelector('#case-source-object').value;
  const item = Object.values(project?.latestBlueprint?.areas ?? {}).flatMap((area) => area.items ?? []).find((entry) => entry.id === selected);
  document.querySelector('#source-preview').textContent = sourceObjectPreview(project, item);
  document.querySelector('#case-form button[type="submit"]').disabled = !item;
  const report = project?.enterpriseSentinelAssessments?.find((entry) => entry.id === document.querySelector('#case-sentinel-assessment').value);
  const requiredScope = document.querySelector('#case-sentinel-scope').value;
  document.querySelector('#sentinel-source-preview').textContent = report
    ? `${report.status} within ${report.profile.id} v${report.profile.version} · report ${report.reportHash} · limited process-accountability coverage. Unsupported domains remain unknown.`
    : project ? requiredScope === 'PROCESS_ACCOUNTABILITY'
      ? 'No exact Sentinel report selected. The required process-accountability scope will block planning.'
      : 'No exact Sentinel report selected. Sentinel remains explicitly unknown and is not required for planning.'
      : 'Select a project to load Sentinel assessments.';
}

function renderMutationExpectation() {
  const value = document.querySelector('#mutation-select').value;
  const mutation = state.meta.mutations[value];
  document.querySelector('#mutation-expectation').textContent = mutation.expectedGate ? `Expected proof: ${mutation.expectedGate} blocks this fault.` : 'Expected proof: the case reaches protected human release approval.';
}

async function createCase(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  const submittedProjectId = form.elements.projectId.value;
  form.elements.projectId.disabled = true;
  form.elements.sourceObjectId.disabled = true;
  form.elements.sentinelAssessmentId.disabled = true;
  try {
    const project = state.sourceProject;
    if (!project?.latestBlueprint) throw new Error('Choose a project with a saved blueprint before creating a change case.');
    const selectedObjectId = form.elements.sourceObjectId.value;
    const selectedReport = form.elements.sentinelAssessmentId.value
      ? project.enterpriseSentinelAssessments?.find((entry) => entry.id === form.elements.sentinelAssessmentId.value) : null;
    const sourceExists = Object.values(project.latestBlueprint.areas ?? {}).flatMap((area) => area.items ?? []).some((item) => item.id === selectedObjectId);
    if (project.id !== form.elements.projectId.value || !sourceExists) {
      throw new Error('The selected project or design object changed while loading. Select the source again.');
    }
    state.changeCase = await api('/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
      mode: 'golden', projectId: project.id, sourceObjectId: selectedObjectId,
      expectedProjectVersion: project.version, expectedBlueprintId: project.latestBlueprint.id,
      expectedBlueprintVersion: project.latestBlueprint.version,
      sentinelRequiredScope: form.elements.sentinelRequiredScope.value,
      sentinelAssessmentId: selectedReport?.id ?? null, sentinelReportHash: selectedReport?.reportHash ?? null,
      rawIntent: form.elements.rawIntent.value,
      mutation: form.elements.mutation.value,
    }) });
    state.activeSourceProject = project;
    syncCaseRoute(state.changeCase.id);
    await refreshCases(); renderCase(); notify('Governed change case created.');
  } catch (error) {
    notify(error.message);
    form.elements.projectId.disabled = false;
    form.elements.sourceObjectId.disabled = false;
    form.elements.sentinelAssessmentId.disabled = false;
    button.disabled = !(state.sourceProject?.id === submittedProjectId && form.elements.projectId.value === submittedProjectId
      && Boolean(form.elements.sourceObjectId.value));
  }
}

async function loadCase(id) {
  if (!state.cases.some((entry) => entry.id === id)) { notify('This change case is unavailable to your current identity. Choose an available case.'); return; }
  const selectionId = ++caseSelectionId;
  try {
    const [changeCase, projectResult] = await Promise.all([api(`/api/sdlc/cases/${id}`), api('/api/v1/projects')]);
    if (selectionId !== caseSelectionId) return;
    let activeSourceProject = null; let softwareDeliveryPlans = []; let actorBindings = []; let behaviorRepositories = [];
    if (changeCase.sourceBinding) {
      try {
        const detail = await api(`/api/v1/projects/${encodeURIComponent(changeCase.projectId)}`);
        if (detail.data?.id === changeCase.projectId) activeSourceProject = detail.data;
      } catch { activeSourceProject = null; }
    }
    if (state.authenticated && changeCase.sourceBinding && changeCase.artifacts.plan) {
      try { softwareDeliveryPlans = (await api(`/api/sdlc/cases/${id}/software-delivery-plans`)).plans; }
      catch { softwareDeliveryPlans = []; }
      try {
        const bindings = await api(`/api/v1/projects/${encodeURIComponent(changeCase.projectId)}/actor-bindings/proposals`);
        actorBindings = eligibleActorBindings(bindings, changeCase.sourceBinding.blueprintVersion);
      } catch { actorBindings = []; }
    }
    if (state.authenticated && changeCase.sourceBinding) {
      try { behaviorRepositories = ((await api(`/api/execution/local-repositories?projectId=${encodeURIComponent(changeCase.projectId)}`)).repositories ?? [])
        .filter((entry) => entry.kind === 'github'); } catch { behaviorRepositories = []; }
    }
    if (selectionId !== caseSelectionId) return;
    state.changeCase = changeCase; state.projects = projectResult.data; state.activeSourceProject = activeSourceProject; state.behaviorRepositories = behaviorRepositories; state.softwareDeliveryPlans = softwareDeliveryPlans; state.actorBindings = actorBindings; state.tab = 'overview';
    syncCaseRoute(id);
    renderCase(); renderCaseList();
  }
  catch (error) { notify(error.message); }
}

async function compileSoftwarePlan(button) {
  const changeCase = state.changeCase;
  const project = state.projects.find((entry) => entry.id === changeCase?.projectId);
  if (!changeCase || !project || !state.authenticated || state.principal !== changeCase.accountableOwner) return;
  button.disabled = true;
  try {
    await api(`/api/sdlc/cases/${changeCase.id}/compile-software-plan`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedProjectVersion: project.version, idempotencyKey: uid('compile-software-plan') }),
    });
    state.softwareDeliveryPlans = (await api(`/api/sdlc/cases/${changeCase.id}/software-delivery-plans`)).plans;
    renderCase(); notify('Inert software delivery draft compiled and saved.');
  } catch (error) { notify(error.message); await loadCase(changeCase.id); }
}

async function saveSoftwarePlanAssignments(form, currentDraft, entry) {
  const changeCase = state.changeCase;
  const project = state.projects.find((item) => item.id === changeCase?.projectId);
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const assignments = currentDraft.tasks.map((task) => {
      const binding = form.elements[`task:${task.id}`].value;
      const { actorId, roleId, targetPrincipal } = JSON.parse(binding);
      return { taskId: task.id, actorId, roleId, targetPrincipal };
    });
    await api(`/api/sdlc/cases/${encodeURIComponent(changeCase.id)}/software-delivery-plans/${encodeURIComponent(currentDraft.id)}/assignment-review`, {
      method: 'POST', body: JSON.stringify({
        expectedProjectVersion: project.version, expectedCaseVersion: changeCase.version,
        expectedReviewRevision: entry.assignmentReview?.revision ?? 0, draftHash: currentDraft.contentHash,
        idempotencyKey: uid('software-assignment-review'), assignments,
      }),
    });
    const { plans } = await api(`/api/sdlc/cases/${encodeURIComponent(changeCase.id)}/software-delivery-plans`);
    state.softwareDeliveryPlans = plans;
    renderCase(); notify('Owner-reviewed assignments saved as an inert snapshot. They are not executable.');
  } catch (error) { notify(error.message); await loadCase(changeCase.id); state.tab = 'delivery'; renderCase(); }
  finally { submit.disabled = false; }
}

async function promoteSoftwarePlan(button, entry) {
  const changeCase = state.changeCase;
  const project = state.projects.find((item) => item.id === changeCase?.projectId);
  button.disabled = true;
  try {
    await api(`/api/sdlc/cases/${encodeURIComponent(changeCase.id)}/software-delivery-plans/${encodeURIComponent(entry.plan.id)}/promote`, {
      method: 'POST', body: JSON.stringify({ expectedProjectVersion: project.version, expectedCaseVersion: changeCase.version,
        expectedReviewRevision: entry.assignmentReview.revision, idempotencyKey: uid('software-runtime-promotion') }),
    });
    await loadCase(changeCase.id); state.tab = 'delivery'; renderCase();
    notify('Human checkpoint plan promoted. No tasks or runs started.');
  } catch (error) { notify(error.message); await loadCase(changeCase.id); state.tab = 'delivery'; renderCase(); }
  finally { button.disabled = false; }
}

async function startSoftwarePlanInstance(button, entry) {
  const changeCase = state.changeCase;
  const scope = { tenantId: state.tenantId, sessionId: state.sessionId, principal: state.principal ?? '',
    projectId: changeCase.projectId, caseId: changeCase.id, planId: entry.plan.id, revision: entry.promotion.runtimeRevision };
  const pending = pendingSoftwareStartKey(window.localStorage, scope, () => uid('software-runtime-instance'));
  if (!softwareStartFlights.begin(pending.storageKey)) return;
  button.disabled = true;
  try {
    const { result } = await api(`/api/sdlc/cases/${encodeURIComponent(changeCase.id)}/software-delivery-plans/${encodeURIComponent(entry.plan.id)}/start-instance`, {
      method: 'POST', body: JSON.stringify({ runtimeRevision: entry.promotion.runtimeRevision, idempotencyKey: pending.idempotencyKey }),
    });
    if (!result?.planInstanceId) throw new Error('The start receipt did not include an instance ID.');
    clearPendingSoftwareStart(window.localStorage, pending.storageKey);
    window.location.assign(encodeExecutionRoute(changeCase.projectId, {
      processPlanId: result.planId, revision: result.revision, planInstanceId: result.planInstanceId,
    }));
  } catch (error) { notify(error.message); button.disabled = false; }
  finally { softwareStartFlights.end(pending.storageKey); }
}

async function command(action, payload = {}) {
  const current = state.changeCase;
  const pinned = caseUiModel(current, state.meta, state.activeSourceProject).sourceBinding;
  if (current.sourceBinding && (!current.sourceBindingIntegrity?.valid || pinned?.state !== 'CURRENT')) {
    notify(!current.sourceBindingIntegrity?.valid
      ? 'Pinned source integrity failed. This case is read-only; create a new case from a verified saved design.'
      : 'The saved design has advanced. This case is read-only; create a new case from the current blueprint.');
    return;
  }
  try {
    state.changeCase = await api(`/api/sdlc/cases/${current.id}/${action}`, {
      method: 'POST', body: JSON.stringify({ version: current.version, idempotencyKey: uid(action), ...(state.authenticated ? {} : { actor: 'studio-operator' }), ...payload }),
    });
    await refreshCases(); renderCase(); notify(action === 'run' ? 'Advanced to the next governed checkpoint.' : 'Change case updated.');
  } catch (error) { notify(error.message); await loadCase(current.id); }
}

function renderCase() {
  const changeCase = state.changeCase;
  app.replaceChildren(document.querySelector('#case-workspace').content.cloneNode(true));
  document.querySelector('#case-kicker').textContent = `${changeCase.currentStage ?? 'Complete'} · ${changeCase.riskClass} risk · ${changeCase.autonomyLevel}`;
  document.querySelector('#case-title').textContent = changeCase.title;
  document.querySelector('#case-intent').textContent = changeCase.intent.statement;
  const sourceState = caseUiModel(changeCase, state.meta, state.activeSourceProject).sourceBinding;
  const sourceBlockReason = changeCase.sourceBinding && (!changeCase.sourceBindingIntegrity?.valid || sourceState?.state !== 'CURRENT')
    ? !changeCase.sourceBindingIntegrity?.valid
      ? 'Pinned source integrity failed. This case is read-only; create a new case from a verified saved design.'
      : sourceState?.state === 'PINNED_OLDER_VERSION'
        ? 'The saved design has advanced since this case was created. This case is read-only; create a new case from the current blueprint to continue.'
        : 'The pinned project is unavailable. This case is read-only until a verified current source can be loaded.'
    : null;
  if (sourceBlockReason) app.querySelector('.case-workspace').prepend(el('div', { className: 'checkpoint-callout source-case-warning', text: sourceBlockReason }));
  const status = document.querySelector('#case-status'); status.textContent = changeCase.status.replace('_', ' '); status.className = `status-pill status-${changeCase.status}`;
  document.querySelector('#step-case').addEventListener('click', () => command('advance'));
  document.querySelector('#run-case').addEventListener('click', () => command('run'));
  const canRun = !sourceBlockReason && !['BLOCKED', 'FAILED', 'NEEDS_HUMAN', 'PASSED', 'STOPPED'].includes(changeCase.status);
  document.querySelector('#step-case').disabled = !canRun; document.querySelector('#run-case').disabled = !canRun;
  renderStages(); renderTabs(); renderContent(); renderCheckpoint();
  if (sourceBlockReason) document.querySelectorAll('#checkpoint-panel button, #case-content button, #case-content input, #case-content textarea, #case-content select').forEach((control) => { control.disabled = true; });
  renderCaseList();
}

function renderStages() {
  const rail = document.querySelector('#stage-rail');
  for (const [index, stage] of state.meta.stages.entries()) {
    const decision = [...state.changeCase.gateHistory].reverse().find((entry) => entry.gate === stage.gate);
    const classes = ['stage-cell'];
    if (index < state.changeCase.currentStageIndex || state.changeCase.status === 'PASSED') classes.push('done');
    if (index === state.changeCase.currentStageIndex) classes.push('current');
    if (index === state.changeCase.currentStageIndex && decision && decision.status !== 'PASSED') classes.push('blocked');
    rail.append(el('div', { className: classes.join(' '), attrs: { title: `${stage.gate} — ${stage.gateLabel}` } }, [el('b', { text: stage.id }), el('span', { text: stage.label })]));
  }
}

function renderTabs() {
  for (const button of document.querySelectorAll('#case-tabs button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
    button.addEventListener('click', () => { state.tab = button.dataset.tab; renderContent(); renderTabsSelection(); });
  }
}

function renderTabsSelection() {
  document.querySelectorAll('#case-tabs button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === state.tab)));
}

function renderContent() {
  const content = document.querySelector('#case-content'); content.replaceChildren();
  const renderers = { overview: renderOverview, context: renderContext, impact: renderImpact, requirements: renderRequirements, proofs: renderProofs, architecture: renderArchitecture, delivery: renderDelivery, assurance: renderAssurance, evidence: renderEvidence };
  renderers[state.tab](content);
}

function metric(value, label) { return el('div', { className: 'metric-card' }, [el('b', { text: value }), el('span', { text: label })]); }
function section(title, children = []) { return el('section', { className: 'content-section' }, [el('h3', { text: title }), ...(Array.isArray(children) ? children : [children])]); }
function empty(message) { return el('div', { className: 'empty-artifact', text: message }); }

function renderOverview(content) {
  const c = state.changeCase;
  const ui = caseUiModel(c, state.meta);
  content.append(el('div', { className: 'metric-grid' }, [metric(`${c.metrics.stagePasses}/${state.meta.stages.length}`, 'Stages passed'), metric(c.evidenceLedger.length, 'Evidence records'), metric(c.clarifications.length, 'Clarifications'), metric(`v${c.intent.revision}`, 'Intent revision')]));
  const tags = el('div', { className: 'tag-list' });
  for (const value of [...c.intent.desiredOutcomes, ...c.intent.constraints, ...c.intent.nonGoals]) tags.append(el('span', { className: 'tag', text: value }));
  content.append(section('Business intent', el('div', { className: 'intent-panel' }, [el('blockquote', { text: c.intent.statement }), tags])));
  content.append(section('Control queue', workspaceQueue(ui.queue)));
  content.append(section('Clarify intent', clarificationWorkbench(c, ui.clarifications)));
  const gates = el('div');
  for (const decision of c.gateHistory.slice(-5).reverse()) gates.append(gateCard(decision));
  content.append(section('Latest gate decisions', gates.childNodes.length ? gates : empty('No gate has run yet. Run the first stage to evaluate intent quality.')));
  content.append(section('Machine-queryable lineage', lineageView(c.traceability)));
  const learningProposals = c.artifacts.learning?.proposals ?? [];
  if (learningProposals.length) {
    content.append(section('Proposed design corrections', learningProposals.map((proposal) => el('article', { className: 'checkpoint-callout' }, [
      el('b', { text: `${proposal.title} · ${proposal.status.replaceAll('_', ' ')}` }),
      ...(proposal.proposedClaim ? [el('p', { text: proposal.proposedClaim })] : []),
      ...(proposal.evidence ? [el('p', { text: `Observation ${proposal.evidence.observationRef} · SHA-256 ${proposal.evidence.observationHash} · release ${proposal.evidence.releaseRef}` })] : []),
      el('p', { text: proposal.authorityRequired ? `Review by ${proposal.reviewOwner ?? 'the accountable owner'} is required. This proposal does not change the saved design or authorize another release.` : 'This proposal is not applied automatically.' }),
    ]))));
  }
}

function workspaceQueue(queue) {
  const wrapper = el('div', { className: 'workspace-queue' });
  wrapper.append(el('article', { className: 'next-action-card' }, [
    el('span', { text: 'Next allowed action' }),
    el('strong', { text: queue.nextAction.label }),
    el('p', { text: queue.nextAction.reason }),
  ]));
  const columns = el('div', { className: 'workspace-queue-columns' });
  const questions = el('div', {}, [el('h4', { text: `Questions · ${queue.questions.length}` })]);
  for (const item of queue.questions) questions.append(el('div', { className: 'queue-row' }, [
    el('b', { text: item.status }), el('span', { text: item.question }),
  ]));
  if (!queue.questions.length) questions.append(el('small', { text: 'No unresolved questions.' }));
  const gaps = el('div', {}, [el('h4', { text: `Proof gaps · ${queue.proofGaps.length}` })]);
  for (const item of queue.proofGaps) gaps.append(el('div', { className: 'queue-row' }, [
    el('b', { text: item.status }), el('span', { text: item.criterion }),
  ]));
  if (!queue.proofGaps.length) gaps.append(el('small', { text: 'No current required-proof gaps.' }));
  const failures = el('div', {}, [el('h4', { text: `Failed evidence · ${queue.failedResults.length}` })]);
  for (const item of queue.failedResults.slice().reverse()) failures.append(el('div', { className: 'queue-row' }, [
    el('b', { text: item.status }), el('span', { text: item.summary }),
  ]));
  if (!queue.failedResults.length) failures.append(el('small', { text: 'No failed or indeterminate results.' }));
  columns.append(questions, gaps, failures); wrapper.append(columns);
  return wrapper;
}

function clarificationWorkbench(changeCase, clarifications) {
  const wrapper = el('div', { className: 'clarification-workbench' });
  for (const item of clarifications) {
    const card = el('article', { className: 'clarification-card' }, [
      el('header', {}, [el('strong', { text: item.question }), el('span', { text: item.status })]),
      el('p', { text: `${item.rationale} · updates ${item.targetField}` }),
    ]);
    if (item.answer) card.append(el('blockquote', { text: item.answer }));
    if (item.control === 'ANSWER') {
      const form = el('form', { className: 'clarification-form' }, [
        el('input', { attrs: { name: 'answer', required: '', placeholder: `Answer as ${item.eligibleRespondent}` } }),
        el('button', { className: 'button primary', text: 'Save answer', attrs: { type: 'submit' } }),
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        command('answer-clarification', { actor: item.eligibleRespondent, questionRef: item.id, answer: event.currentTarget.elements.answer.value });
      });
      card.append(form);
    } else if (item.control === 'RECONCILE') {
      const button = el('button', { className: 'button primary', text: 'Reconcile into intent', attrs: { type: 'button' } });
      button.addEventListener('click', () => command('reconcile-clarification', { actor: changeCase.accountableOwner, questionRef: item.id }));
      card.append(button);
    } else if (item.status === 'RECONCILED') {
      card.append(el('small', { text: `Included in intent v${item.intentRevisionAfter}` }));
    } else {
      card.append(el('small', { text: `Superseded by intent v${changeCase.intent.revision}; no action is available.` }));
    }
    wrapper.append(card);
  }
  if (!changeCase.artifacts.requirements) {
    const form = el('form', { className: 'clarification-new' }, [
      el('input', { attrs: { name: 'question', required: '', placeholder: 'Ask one consequential question' } }),
      el('select', { attrs: { name: 'targetField' } }, [
        el('option', { text: 'Non-goal', attrs: { value: 'nonGoals' } }),
        el('option', { text: 'Desired outcome', attrs: { value: 'desiredOutcomes' } }),
        el('option', { text: 'Constraint', attrs: { value: 'constraints' } }),
        el('option', { text: 'Assumption', attrs: { value: 'assumptions' } }),
      ]),
      el('button', { className: 'button ghost', text: 'Open question', attrs: { type: 'submit' } }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      command('clarify', {
        question: event.currentTarget.elements.question.value,
        targetField: event.currentTarget.elements.targetField.value,
        rationale: 'The answer changes the intended outcome or delivery boundary.',
        eligibleRespondent: changeCase.accountableOwner,
      });
    });
    wrapper.append(form);
  }
  return wrapper;
}

function gateCard(decision) {
  const stage = state.meta.stages.find((entry) => entry.gate === decision.gate);
  const card = el('article', { className: `gate-card ${decision.status}` }, [el('header', {}, [el('h4', { text: `${decision.gate} · ${stage?.gateLabel ?? stage?.label ?? 'Gate'}` }), el('span', { className: `status-${decision.status}`, text: decision.status.replace('_', ' ') })])]);
  if (decision.findings.length) for (const item of decision.findings) card.append(el('p', { text: `${item.severity}: ${item.message} — ${item.remediation}` }));
  else card.append(el('p', { text: 'All blocking rules passed with recorded evaluator evidence.' }));
  return card;
}

function lineageView(trace) {
  if (!trace.nodes.length) return empty('Traceability appears as governed artifacts are produced.');
  const order = ['Intent', 'Requirement', 'ArchitectureDecision', 'WorkItem', 'ChangeSet', 'Verification', 'Release', 'Outcome', 'FollowUp'];
  const row = el('div', { className: 'lineage' });
  let first = true;
  for (const type of order) {
    const nodes = trace.nodes.filter((entry) => entry.type === type);
    if (!nodes.length) continue;
    if (!first) row.append(el('span', { className: 'lineage-arrow', text: '→' })); first = false;
    row.append(el('div', { className: 'lineage-node' }, [el('b', { text: type }), el('span', { text: nodes.length > 1 ? `${nodes.length} linked records` : nodes[0].label.slice(0, 44) })]));
  }
  return row;
}

function renderContext(content) {
  const context = state.changeCase.artifacts.context;
  if (!context) return content.append(empty('Context discovery has not run yet.'));
  const manifest = contextManifestPresentation(context);
  content.append(section('Synthetic reference context coverage', [
    el('p', { attrs: { role: 'status' }, text: 'This matrix evaluates the synthetic reference organization only. It does not certify coverage of the selected saved project.' }),
    ...context.coverage.map((entry) => el('div', { className: 'coverage-row' }, [el('b', { text: entry.domain }), el('div', { className: 'coverage-track' }, [el('i', { className: entry.score >= 1 ? 'coverage-full' : 'coverage-empty' })]), el('span', { className: entry.status === 'PASSED' ? 'status-PASS' : 'status-FAIL', text: `${Math.round(entry.score * 100)}%` })])),
  ]));
  content.append(section('Provenance manifest', [el('p', { text: `${context.evidenceRefs.length} evidence references · ${manifest.manifest}` }), el('p', { text: 'Authoritative, approved, informative, and untrusted sources remain distinguishable. Untrusted content never becomes instruction.' })]));
  content.append(section('Enterprise context source', [
    el('p', { text: manifest.enterprise }),
    el('p', { attrs: { role: 'status' }, text: manifest.enterpriseStatus }),
  ]));
  content.append(section('Intent guardrails', [
    el('p', { text: `Intent ${manifest.guardrails.intentRef}` }),
    el('h4', { text: 'Constraints' }),
    manifest.guardrails.constraints.length ? el('ul', {}, manifest.guardrails.constraints.map((entry) => el('li', { text: entry })))
      : el('p', { attrs: { role: 'status' }, text: 'No constraints are recorded in this context manifest.' }),
    el('h4', { text: 'Non-goals' }),
    manifest.guardrails.nonGoals.length ? el('ul', {}, manifest.guardrails.nonGoals.map((entry) => el('li', { text: entry })))
      : el('p', { attrs: { role: 'status' }, text: 'No non-goals are recorded in this context manifest.' }),
  ]));
  content.append(section('Synthetic-context unknown dependencies', manifest.unknownDependencies.length
    ? el('ul', {}, manifest.unknownDependencies.map((entry) => el('li', { text: `${entry.domain}: ${entry.description}` })))
    : el('p', { attrs: { role: 'status' }, text: 'No synthetic-context unknown dependencies are recorded in this manifest.' })));
  content.append(section('Synthetic-context excluded dependencies', manifest.excludedDependencies.length
    ? el('ul', {}, manifest.excludedDependencies.map((entry) => el('li', { text: `${entry.objectRef} · ${entry.status} · ${entry.sourceId} · ${entry.reason}` })))
    : el('p', { attrs: { role: 'status' }, text: 'No synthetic-context dependencies are explicitly excluded in this manifest.' })));
  content.append(section('Saved-project manifest pin', [el('p', { text: savedProjectPinSummary(context) }),
    el('small', { text: 'Enterprise context below is the synthetic reference organization; this saved-project pin covers only the exact selected project and blueprint.' })]));
  if (manifest.savedProjectCoverage) {
    const projectCoverage = manifest.savedProjectCoverage;
    content.append(section('Saved-project source coverage · PARTIAL', [
      el('p', { attrs: { role: 'status' }, text: `Exact saved-source pin SHA-256 ${projectCoverage.sourcePinHash}${projectCoverage.processTraceHash ? ` · process trace SHA-256 ${projectCoverage.processTraceHash}` : ''} · coverage ${projectCoverage.status}. Only listed source records are represented.` }),
      ...(projectCoverage.schemaVersion >= 2 ? [
        el('h4', { text: 'Declared candidate universe' }),
        el('p', { attrs: { role: 'status' }, text: `${projectCoverage.candidateUniverse?.kind ?? 'Unavailable'} · exhaustive only within this declared scope: ${projectCoverage.candidateUniverse?.exhaustive === true ? 'yes' : 'no'}. ${projectCoverage.candidateUniverse?.description ?? 'Candidate scope unavailable.'}` }),
        el('p', { text: `Classification SHA-256 ${projectCoverage.classificationHash ?? 'unavailable'} · project pin SHA-256 ${projectCoverage.sourcePins?.projectPinHash ?? 'unavailable'} · blueprint snapshot ${projectCoverage.sourcePins?.blueprintSnapshotHash ?? 'unavailable'} · enterprise context v${projectCoverage.sourcePins?.enterpriseContext?.version ?? 'unavailable'} (${projectCoverage.sourcePins?.enterpriseContext?.authorityStatus ?? 'authority unavailable'}) · Sentinel profile ${projectCoverage.sourcePins?.sentinel?.availableProfile?.id ?? 'unavailable'}@${projectCoverage.sourcePins?.sentinel?.availableProfile?.version ?? 'unavailable'} (${projectCoverage.sourcePins?.sentinel?.availableProfile?.hash ?? 'hash unavailable'}) · evaluator ${projectCoverage.sourcePins?.sentinel?.availableProfile?.evaluatorRevision ?? 'unavailable'} · assessment ${projectCoverage.sourcePins?.sentinel?.assessmentId ?? 'not selected'} · report ${projectCoverage.sourcePins?.sentinel?.reportHash ?? 'unavailable'} · assessed profile ${projectCoverage.sourcePins?.sentinel?.profileId ?? 'unavailable'}@${projectCoverage.sourcePins?.sentinel?.profileVersion ?? 'unavailable'} (${projectCoverage.sourcePins?.sentinel?.profileHash ?? 'hash unavailable'})` }),
        el('h4', { text: 'Relevant context requirements' }),
        projectCoverage.contextRequirements.length ? el('ul', {}, projectCoverage.contextRequirements.map((entry) => el('li', { text: `${entry.domain} · ${entry.criticality} · authority ${entry.authorityRequirement} · freshness ${entry.freshnessRequirement}` })))
          : el('p', { attrs: { role: 'status' }, text: 'No context requirements are pinned in this project coverage record.' }),
        el('h4', { text: 'Saved-project candidate classifications' }),
        projectCoverage.classifications.length ? el('ul', {}, projectCoverage.classifications.map((entry) => el('li', { text: `${entry.status} · ${entry.domain} · ${entry.objectRef ?? 'unidentified'} · ${entry.reason} · content ${entry.contentHash ?? 'unavailable'} · source ${entry.provenance?.kind ?? 'unavailable'}` })))
          : el('p', { attrs: { role: 'status' }, text: 'No candidate classifications are recorded.' }),
      ] : []),
      el('h4', { text: 'Represented from the selected saved source' }),
      projectCoverage.represented.length ? el('ul', {}, projectCoverage.represented.map((entry) => el('li', { text: `${entry.domain} · ${entry.objectType} ${entry.objectRef} · content SHA-256 ${entry.contentHash}${entry.snapshotHash ? ` · snapshot SHA-256 ${entry.snapshotHash}` : ''}` })))
        : el('p', { attrs: { role: 'status' }, text: 'No source records are represented.' }),
      el('h4', { text: 'Saved-project dependencies not retrieved' }),
      projectCoverage.unknownDependencies.length ? el('ul', {}, projectCoverage.unknownDependencies.map((entry) => el('li', { text: `${entry.domain}: UNKNOWN · ${entry.description}` })))
        : el('p', { attrs: { role: 'status' }, text: 'No saved-project unknowns are recorded.' }),
      el('p', { attrs: { role: 'status' }, text: `Saved-project exclusions: ${projectCoverage.excludedDependencies.status} · ${projectCoverage.excludedDependencies.reason}` }),
    ]));
  }
  if (context.relevantRequirements) {
    content.append(section('Pinned accepted requirements', [
      el('p', { text: `Baseline v${context.relevantRequirements.baselineVersion} · SHA-256 ${context.relevantRequirements.contentHash} · evidence ${context.relevantRequirements.evidenceRef}` }),
      el('ul', {}, context.relevantRequirements.requirements.map((requirement) => el('li', { text: `${requirement.id} · ${requirement.statement} · ${requirement.priority}` }))),
    ]));
  } else {
    content.append(section('Accepted requirements in context', el('p', { attrs: { role: 'status' }, text: manifest.requirements.summary })));
  }
  const binding = caseUiModel(state.changeCase, state.meta, state.activeSourceProject).sourceBinding;
  if (binding) {
    if (!state.changeCase.sourceBindingIntegrity?.valid) {
      content.append(section('Saved-design source integrity failure', [
        el('p', { text: 'The stored pin does not match its recorded snapshot and cannot be trusted or used to continue this case.' }),
        el('p', { text: 'This case is read-only. Create a new case from a verified current saved design.' }),
      ]));
      return;
    }
    const sourceRoute = sourceBindingDesignRoute(state.changeCase, state.activeSourceProject);
    content.append(section('Pinned saved-design evidence', [
      el('p', { text: `${binding.snapshot.name} · ${binding.objectType} · ${binding.snapshot.detail}` }),
      el('p', { text: `Project ${binding.projectId} v${binding.projectVersion} · blueprint ${binding.blueprintId} v${binding.blueprintVersion} · schema v${binding.blueprintSchemaVersion}` }),
      el('p', { text: `Source SHA-256 ${binding.sourceHash} · binding integrity ${binding.bindingHash} · evidence ${context.sourceBindingEvidenceRef}` }),
      el('p', { attrs: { role: 'status', 'data-sentinel-pin': binding.sentinelContext?.state ?? 'UNASSESSED_LEGACY' }, text:
        binding.sentinelContext?.state === 'ASSESSED'
          ? `Pinned Sentinel assessment ${binding.sentinelContext.assessment.id} · ${binding.sentinelContext.assessment.profileId} v${binding.sentinelContext.assessment.profileVersion} · profile SHA-256 ${binding.sentinelContext.assessment.profileHash} · report SHA-256 ${binding.sentinelContext.assessment.reportHash} · assessed aggregate v${binding.sentinelContext.assessment.assessedAggregateVersion}.`
          : binding.bindingSchemaVersion === 2 ? `Sentinel context: NOT ASSESSED for this exact design; required scope ${binding.sentinelContext.requiredScope}.`
            : 'Sentinel context: UNASSESSED LEGACY binding; no assessment is inferred from current reports.' }),
      el('p', { text: binding.state === 'PINNED_OLDER_VERSION' ? 'Pinned version: this project has a newer saved design. The case still uses this original snapshot.' : binding.state === 'CURRENT' ? 'Pinned version: the case uses this exact current saved design snapshot.' : 'Pinned version: current project state is unavailable; the case retains this exact saved snapshot.' }),
      ...(binding.invalidation ? [el('div', { className: 'source-invalidation' }, [
        el('b', { text: binding.invalidation.status === 'DEPENDENCIES_STALE' ? 'Dependent artifacts are stale' : 'Pinned source is stale' }),
        el('p', { text: binding.invalidation.reason }),
        ...(binding.invalidation.staleArtifacts.length ? [el('ul', {}, binding.invalidation.staleArtifacts.map((artifact) => el('li', { text: `${artifact.type} · ${artifact.referenceLabel} ${artifact.reference}` })))] : []),
        el('small', { text: 'Stored artifact contents remain available as historical evidence.' }),
      ])] : []),
      ...(sourceRoute ? [el('a', { className: 'button ghost', text: 'Open exact pinned design object', attrs: { href: sourceRoute } })] : []),
      el('small', { text: 'Other context coverage is from the synthetic reference organization; it is not evidence from this project.' }),
    ]));
  }
}

function renderImpact(content) {
  const artifact = state.changeCase.artifacts.impact;
  if (!artifact) return content.append(empty('Impact analysis has not run yet.'));
  const grid = el('div', { className: 'impact-grid' });
  const sourceIntegrityValid = !state.changeCase.sourceBinding || state.changeCase.sourceBindingIntegrity?.valid;
  for (const impact of artifact.impacts) {
    if (impact.isRequestedSource && !sourceIntegrityValid) continue;
    grid.append(el('article', { className: 'impact-card' }, [el('b', { text: impact.objectRef }), el('span', { text: `${impact.objectType} · ${impact.impactType}${impact.isRequestedSource ? ' · requested saved-design source' : ''}` }), el('p', { text: impact.reason }), ...(impact.sourceHash ? [el('small', { text: `Pinned source SHA-256 ${impact.sourceHash}` })] : [])]));
  }
  if (!sourceIntegrityValid) content.append(section('Saved-design source integrity failure', el('p', { text: 'The requested source row is hidden because its stored pin failed verification. This case is read-only.' })));
  content.append(section('Enterprise impact set', grid));
  content.append(el('p', { className: 'mutation-expectation', text: 'The requested source row is pinned from the saved blueprint. Relationships in the remaining impact set and its critic are synthetic reference-model analysis.' }));
  content.append(section('Independent critic', el('p', { text: `Golden-set recall ${Math.round(artifact.critic.recall * 100)}% · precision ${Math.round(artifact.critic.precision * 100)}% · ${artifact.critic.missing.length} omitted dependencies.` })));
}

function table(headers, rows) {
  const value = el('table', { className: 'data-table' });
  value.append(el('thead', {}, el('tr', {}, headers.map((header) => el('th', { text: header })))));
  value.append(el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((cell) => typeof cell === 'string' ? el('td', { text: cell }) : el('td', {}, cell))))));
  return value;
}

function renderCriterionContractEditor(card, requirement) {
  const changeCase = state.changeCase;
  const owner = state.authenticated && state.principal === changeCase.accountableOwner;
  if (!owner || !requirement.processTrace || changeCase.currentStage !== 'S4'
    || changeCase.artifacts.requirements.acceptedBaseline) return;
  const prior = requirement.criterionContract ?? null;
  const sourceOptions = requirement.criterionSources ?? [];
  const scopeOptions = sourceOptions.filter((entry) => ['process', 'capability', 'system', 'resource'].includes(entry.type));
  const form = el('form', { className: 'criterion-contract-form' });
  form.append(el('p', { text: prior
    ? `Version ${prior.version} is current. Legacy strings remain UNKNOWN; prior mandatory criteria cannot be removed or downgraded in this increment.`
    : 'Legacy string criteria are UNKNOWN until the accountable owner explicitly versions their type, mandatory status, source and scope. No classification is inferred.' }));
  const rows = [];
  requirement.acceptanceCriteria.forEach((text, index) => {
    const previous = prior?.criteria?.[index];
    const row = el('fieldset', { className: 'criterion-contract-row' });
    row.append(el('legend', { text: `Criterion ${index + 1}: ${text}` }));
    const id = el('input', { attrs: { required: 'required', maxlength: '80', 'aria-label': `Criterion ${index + 1} stable ID` } });
    id.value = previous?.id ?? `criterion-${index + 1}`;
    const type = el('select', { attrs: { required: 'required', 'aria-label': `Criterion ${index + 1} type` } });
    type.append(el('option', { text: 'Choose criterion type', attrs: { value: '' } }));
    for (const value of ['BUSINESS', 'TECHNICAL', 'GUARDRAIL']) type.append(el('option', { text: value, attrs: { value } }));
    type.value = previous?.type ?? '';
    const mandatory = el('input', { attrs: { type: 'checkbox', 'aria-label': `Criterion ${index + 1} is mandatory` } });
    mandatory.checked = previous?.mandatory === true || requirement.priority === 'MUST';
    mandatory.disabled = requirement.priority === 'MUST' || prior?.mandatoryFloor?.includes(previous?.id);
    const source = el('select', { attrs: { required: 'required', 'aria-label': `Criterion ${index + 1} source pin` } });
    source.append(el('option', { text: 'Choose exact source', attrs: { value: '' } }));
    sourceOptions.forEach((entry) => source.append(el('option', { text: `${entry.type} · ${entry.id} · ${entry.snapshotHash.slice(0, 12)}`, attrs: { value: entry.id } })));
    source.value = previous?.source?.id ?? '';
    const scope = el('select', { attrs: { required: 'required', 'aria-label': `Criterion ${index + 1} scope pin` } });
    scope.append(el('option', { text: 'Choose exact scope', attrs: { value: '' } }));
    scopeOptions.forEach((entry) => scope.append(el('option', { text: `${entry.type} · ${entry.id} · ${entry.snapshotHash.slice(0, 12)}`, attrs: { value: entry.id } })));
    scope.value = previous?.scope?.id ?? '';
    row.append(el('label', { text: 'Stable criterion ID' }, id), el('label', { text: 'Criterion type' }, type),
      el('label', { text: 'Mandatory obligation' }, mandatory), el('label', { text: 'Source' }, source), el('label', { text: 'Scope' }, scope));
    type.addEventListener('change', () => { if (type.value === 'GUARDRAIL') mandatory.checked = true; });
    form.append(row); rows.push({ id, type, mandatory, source, scope, text });
  });
  form.append(el('p', { className: 'muted', text: 'MUST requirements force all criteria mandatory; guardrails cannot be optional. Superseding or removing an obligation is unavailable here and fails closed.' }));
  const save = el('button', { className: 'button primary', text: `Save criterion baseline v${(prior?.version ?? 0) + 1}`, attrs: { type: 'submit' } });
  form.append(save);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (rows.some((row) => !row.id.value.trim() || !row.type.value || !row.source.value || !row.scope.value
      || ((row.type.value === 'GUARDRAIL' || requirement.priority === 'MUST') && !row.mandatory.checked))) return;
    try {
      state.changeCase = await api(`/api/sdlc/cases/${changeCase.id}/edit-requirements`, { method: 'POST', body: JSON.stringify({
        version: changeCase.version, expectedDraftRevision: changeCase.artifacts.requirements.draftRevision,
        requirementId: requirement.id, idempotencyKey: uid('criterion-baseline'), changes: { criterionContract: {
          schemaVersion: 1, version: (prior?.version ?? 0) + 1,
          criteria: rows.map((row) => ({ id: row.id.value.trim(), text: row.text, type: row.type.value,
            mandatory: row.mandatory.checked, sourceRefId: row.source.value, scopeRefId: row.scope.value })),
        } },
      }) });
      await refreshCases(); renderCase(); notify('Versioned requirement criteria saved with exact source and scope pins.');
    } catch (error) { notify(error.message); await loadCase(changeCase.id); }
  });
  card.append(section('Version requirement criteria', form));
}

function renderBehaviorTestPlanForm(card, requirement, artifact) {
  const changeCase = state.changeCase;
  const trace = requirement.processTrace;
  const check = state.meta?.behaviorTestCheck;
  const owner = state.authenticated && state.principal === changeCase.accountableOwner;
  if (!owner || artifact.acceptedBaseline || changeCase.currentStage !== 'S4') return;
  if (!requirement.criterionContract) {
    card.append(section('Behavior tests unavailable', el('p', { text: 'Legacy string criteria are UNKNOWN. The accountable owner must create a versioned obligation baseline before authorizing checks.' })));
    return;
  }
  const plans = (state.activeSourceProject?.processPlans ?? []).filter((plan) => plan.source?.blueprintId === trace.source.blueprintId
    && Number(plan.source?.blueprintVersion) === Number(trace.source.blueprintVersion));
  const tasks = plans.flatMap((plan) => (plan.tasks ?? []).filter((task) => task.sourceProcessId === trace.process.id)
    .map((task) => ({ plan, task })));
  const savedPlans = requirement.processBehaviorTestPlans ?? [];
  const stalePlan = savedPlans.find((plan) => plan.regenerationStatus === 'REGENERATION_REQUIRED');
  const currentCriterionVersion = requirement.criterionContract.version;
  if (savedPlans.length) card.append(section('Authorized behavior test plans', savedPlans.map((plan) => {
    const view = processBehaviorTestPlanPresentation(plan);
    const assertions = (plan.assertions ?? []).map((assertion) => `${assertion.testName} → criterion ${assertion.criterionIndex + 1}`).join(' · ');
    const link = el('a', { className: 'button secondary', text: 'Open exact task to request the pinned check', attrs: {
      href: encodeExecutionRoute(changeCase.projectId, null, null, null, { projectId: changeCase.projectId, caseId: changeCase.id, planId: plan.id }),
    } });
    return el('article', { className: 'checkpoint-callout' }, [
      el('strong', { text: view?.heading ?? `Pre-run plan ${plan.id} · applicability unknown` }),
      el('p', { attrs: { role: 'status' }, text: view?.status ?? 'Plan applicability is unavailable; do not treat as current.' }),
      el('p', { text: view?.pins ?? `Plan SHA-256 ${plan.planHash}` }),
      el('p', { text: `Process plan ${plan.processPlan?.id} v${plan.processPlan?.revision} · task ${plan.processPlan?.taskId} · plan SHA-256 ${plan.planHash}` }),
      el('p', { text: `Repository snapshot ${view?.repositorySnapshotId ?? 'unavailable'} · tree SHA-256 ${plan.repository?.treeDigest} · selected files ${plan.repository?.selectedFiles?.map((entry) => entry.path).join(', ')}` }),
      ...(view?.contextPins ? [el('p', { text: `Context pins · ${view.contextPins}` })] : []),
      ...(view?.scenarioCases?.length ? [el('ul', { className: 'evaluation-case-definitions' }, view.scenarioCases.map((entry) => el('li', { text: entry }))),
        el('p', { attrs: { role: 'status' }, text: `Scenario mappings ${view.scenarioMappingsStatus ?? 'INCOMPLETE'}. OWNER_PROPOSED_UNVERIFIED mappings require a repository-check run; all scenarios remain NOT_EXECUTED and have not been independently reviewed.` })] : []),
      el('p', { text: `Assertions: ${assertions}. This authorizes a check before execution; it does not authorize effects or state business truth.` }),
      link,
    ]);
  })));
  const form = el('form', { className: 'process-behavior-plan-form', attrs: { 'aria-label': `Authorize behavior tests for ${requirement.id}` } });
  form.append(el('h4', { text: stalePlan ? `Regenerate v${currentCriterionVersion} plan` : 'Authorize pre-run behavior checks' }),
    el('p', { text: stalePlan
      ? `The old plan remains readable and pinned to criterion baseline v${stalePlan.criterionContractVersion}; its linked evidence is STALE. Create a new immutable plan for current baseline v${currentCriterionVersion}. The old plan cannot authorize execution. Business truth stays UNVERIFIED.`
      : 'This immutable plan maps every draft criterion to one named test and pins an exact saved process task, repository snapshot, selected files, and configured check before execution. Results remain code-check evidence; business truth stays UNVERIFIED.' }));
  if (!check?.available) return card.append(section('Behavior test plan unavailable', [form,
    el('p', { text: 'No single fixed repository check is configured for assertion evaluation.' })]));
  if (!tasks.length) return card.append(section('Behavior test plan unavailable', [form,
    el('p', { text: 'No saved process task matches this exact blueprint and process.' })]));
  if (!state.behaviorRepositories.length) return card.append(section('Behavior test plan unavailable', [form,
    el('p', { text: 'No saved GitHub repository snapshot is available in this project.' })]));
  const planSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved process task for behavior assertions' } });
  planSelect.append(el('option', { text: 'Choose a saved process task', attrs: { value: '' } }));
  tasks.forEach(({ plan, task }, index) => planSelect.append(el('option', { text: `${plan.name ?? plan.id} v${plan.revision} · ${task.title} (${task.id})`, attrs: { value: String(index) } })));
  const repositorySelect = el('select', { attrs: { required: 'required', 'aria-label': 'Pinned GitHub snapshot for behavior assertions' } });
  repositorySelect.append(el('option', { text: 'Choose a saved GitHub snapshot', attrs: { value: '' } }));
  state.behaviorRepositories.forEach((repository, index) => repositorySelect.append(el('option', {
    text: `${repository.repositoryName ?? repository.label} · ${repository.branchRef ?? ''} @ ${(repository.commitOid ?? '').slice(0, 12)} · ${repository.fileCount} files`, attrs: { value: String(index) },
  })));
  const paths = el('textarea', { attrs: { required: 'required', rows: '2', maxlength: '8192', 'aria-label': 'Exact repository file paths to pin', placeholder: 'tests/example.test.mjs, src/example.mjs' } });
  const pathMappings = el('textarea', { attrs: { required: 'required', rows: '3', maxlength: '8192', 'aria-label': 'Candidate file to criterion mapping', placeholder: 'src/example.mjs | IMPLEMENTATION | criterion-1' } });
  const effectiveAt = el('input', { attrs: { required: 'required', maxlength: '24', 'aria-label': 'Effective time context (UTC)', placeholder: '2026-10-07T12:00:00.000Z' } });
  const effectiveTimeSource = el('select', { attrs: { required: 'required', 'aria-label': 'Effective time source process input' } });
  effectiveTimeSource.append(el('option', { text: 'Choose exact process input', attrs: { value: '' } }));
  trace.process.inputs.forEach((entry) => effectiveTimeSource.append(el('option', { text: `${entry.name} (${entry.id}) · ${entry.snapshotHash}`, attrs: { value: entry.id } })));
  const caseRows = {};
  const caseDefinitions = el('div', { className: 'intent-evaluation-case-form' });
  for (const type of ['positive', 'negative', 'recovery']) {
    const fieldset = el('fieldset', { className: 'intent-evaluation-case-row' }, [el('legend', { text: `${type[0].toUpperCase()}${type.slice(1)} case definition` })]);
    const definition = el('textarea', { attrs: { required: 'required', minlength: '12', maxlength: '600', rows: '2', 'aria-label': `${type} case definition` } });
    const sourceRef = el('select', { attrs: { required: 'required', 'aria-label': `${type} case exact source` } });
    sourceRef.append(el('option', { text: 'Choose exact source pin', attrs: { value: '' } }));
    const refs = type === 'positive' ? trace.outcome.outputRefs.concat(trace.outcome.metricRefs)
      : type === 'negative' ? trace.risk.refs
        : [{ id: trace.process.id, name: trace.process.name, snapshotHash: trace.source.processSnapshotHash }, ...trace.process.inputs, ...trace.process.outputs];
    refs.forEach((entry) => sourceRef.append(el('option', { text: `${entry.name ?? entry.id} (${entry.id}) · ${entry.snapshotHash}`, attrs: { value: entry.id } })));
    const criterion = el('select', { attrs: { required: 'required', 'aria-label': `${type} case criterion` } });
    criterion.append(el('option', { text: 'Choose exact criterion', attrs: { value: '' } }));
    requirement.criterionContract.criteria.forEach((entry) => criterion.append(el('option', { text: `${entry.id} · ${entry.text}`, attrs: { value: entry.id } })));
    const dataset = el('textarea', { attrs: { rows: '3', maxlength: '4096',
      'aria-label': `${type} typed dataset JSON`, placeholder: 'Enter owner-authored JSON object' } });
    const expectedOutput = el('textarea', { attrs: { rows: '3', maxlength: '4096',
      'aria-label': `${type} expected output oracle JSON`, placeholder: 'Enter owner-authored expected output JSON object' } });
    const testPath = el('input', { attrs: { maxlength: '512',
      'aria-label': `${type} exact pinned test file path`, placeholder: 'Exact selected repository test path' } });
    const assertion = el('select', { attrs: { 'aria-label': `${type} exact executable assertion` } });
    assertion.append(el('option', { text: 'Choose exact assertion', attrs: { value: '' } }));
    fieldset.append(el('label', { text: 'Owner-authored case definition' }, definition),
      el('label', { text: 'Saved process source' }, sourceRef), el('label', { text: 'Criterion' }, criterion),
      el('label', { text: 'Typed dataset (JSON object)' }, dataset),
      el('label', { text: 'Expected output / oracle (JSON object)' }, expectedOutput),
      el('label', { text: 'Exact test file in selected repository snapshot' }, testPath),
      el('label', { text: 'Exact executable assertion' }, assertion),
      el('p', { className: 'muted', attrs: { 'data-case-mapping-status': type },
        text: 'Mapping INCOMPLETE · enter dataset and oracle together; exact test mapping can be added later · case NOT_EXECUTED.' }));
    const caseRow = { definition, sourceRef, criterion, dataset, expectedOutput, testPath, assertion };
    const updateMappingStatus = () => {
      const hasDataset = Boolean(dataset.value.trim());
      const hasOracle = Boolean(expectedOutput.value.trim());
      const hasTestPath = Boolean(testPath.value.trim());
      const hasAssertion = Boolean(assertion.value);
      const status = hasDataset && hasOracle && hasTestPath && hasAssertion ? 'OWNER_PROPOSED_UNVERIFIED'
        : hasDataset !== hasOracle ? 'INCOMPLETE · enter dataset and oracle together'
          : hasDataset && hasOracle && !hasTestPath && !hasAssertion
            ? 'INCOMPLETE · dataset/oracle captured; exact test mapping is a later step'
            : hasDataset && hasOracle && hasTestPath !== hasAssertion
              ? 'INCOMPLETE · complete the exact test path and assertion together'
              : 'INCOMPLETE · capture the dataset/oracle pair first';
      fieldset.querySelector(`[data-case-mapping-status="${type}"]`).textContent = `Mapping ${status} · case NOT_EXECUTED.`;
    };
    [dataset, expectedOutput, testPath, assertion].forEach((control) => control.addEventListener('input', updateMappingStatus));
    assertion.addEventListener('change', updateMappingStatus);
    caseRow.updateMappingStatus = updateMappingStatus;
    caseRows[type] = caseRow;
    caseDefinitions.append(fieldset);
  }
  form.append(el('label', { text: 'Exact saved process task' }, planSelect),
    el('label', { text: 'Repository snapshot' }, repositorySelect),
    el('label', { text: 'Selected file paths (comma or newline separated)' }, paths),
    el('label', { text: 'Map each changed candidate path (path | role | criterion IDs)' }, pathMappings),
    el('fieldset', { className: 'evaluation-context-form' }, [el('legend', { text: 'Evaluation context pins' }),
      el('label', { text: 'Effective time (UTC, owner asserted)' }, effectiveAt),
      el('label', { text: 'Effective time source' }, effectiveTimeSource),
      el('p', { className: 'muted', text: 'Workspace and branch/commit pins are resolved from the selected saved project and repository snapshot. Effective time and the three case definitions are author assertions, not execution results.' })]),
    caseDefinitions,
    el('p', { className: 'muted', text: 'Map every selected path. Changed, deleted or renamed paths without a pre-run criterion mapping are rejected before checks execute.' }),
    el('p', { className: 'muted', text: 'Capture a complete dataset/oracle pair now if its exact test mapping is not ready. The pair is saved with mapping INCOMPLETE; add the exact selected test path and assertion together later. The scenario remains NOT_EXECUTED until reviewed and run.' }),
    el('p', { className: 'muted', text: `Configured check ${check.id} v${check.version} · command SHA-256 ${check.commandHash} · plan SHA-256 ${check.planHash}` }));
  const scopeOptions = [{ id: trace.process.id, name: trace.process.name, type: 'process' },
    ...trace.scope.capabilityRefs, ...trace.scope.systemRefs, ...trace.scope.resourceRefs];
  for (const [criterionIndex, criterion] of requirement.criterionContract.criteria.entries()) {
    const fieldset = el('fieldset', { className: 'behavior-assertion-row' }, [
      el('legend', { text: `${criterion.mandatory ? 'Mandatory' : 'Optional'} ${criterion.type} · ${criterion.id}: ${criterion.text}` }),
    ]);
    const testName = el('input', { attrs: { required: 'required', maxlength: '240', 'aria-label': `Exact TAP test name for criterion ${criterionIndex + 1}` } });
    const outcome = el('select', { attrs: { required: 'required', 'aria-label': `Business outcome reference for criterion ${criterionIndex + 1}` } });
    outcome.append(el('option', { text: 'Choose outcome', attrs: { value: '' } }));
    trace.outcome.outputRefs.forEach((entry) => outcome.append(el('option', { text: `${entry.type} · ${entry.name} (${entry.id})`, attrs: { value: entry.id } })));
    const scope = el('select', { attrs: { required: 'required', 'aria-label': `Process scope for criterion ${criterionIndex + 1}` } });
    const pinnedScope = scopeOptions.find((entry) => entry.id === criterion.scope.id);
    scope.append(el('option', { text: `${criterion.scope.type} · ${pinnedScope?.name ?? criterion.scope.id} (${criterion.scope.id})`, attrs: { value: criterion.scope.id } }));
    const risk = el('select', { attrs: { required: 'required', 'aria-label': `Risk reference for criterion ${criterionIndex + 1}` } });
    risk.append(el('option', { text: 'Choose linked risk', attrs: { value: '' } }));
    trace.risk.refs.forEach((entry) => risk.append(el('option', { text: `${entry.id} · SHA-256 ${entry.snapshotHash}`, attrs: { value: entry.id } })));
    if (trace.risk.status === 'UNKNOWN' && trace.risk.refs.length === 0) risk.append(el('option', {
      text: 'Risk state UNKNOWN · no linked risk was present in the pinned process', attrs: { value: 'UNKNOWN' },
    }));
    fieldset.append(el('label', { text: 'Exact test name in check output' }, testName),
      el('label', { text: 'Declared outcome' }, outcome), el('label', { text: 'Declared process scope' }, scope),
      el('label', { text: 'Linked risk' }, risk));
    form.append(fieldset);
    const assertionId = uid('assertion');
    fieldset.dataset.assertionId = assertionId;
    for (const row of Object.values(caseRows)) {
      const option = el('option', { text: `${assertionId} · enter exact test name below`, attrs: { value: assertionId } });
      row.assertion.append(option);
      testName.addEventListener('input', () => { option.textContent = `${assertionId} · ${testName.value.trim() || 'enter exact test name below'}`; });
    }
  }
  const submit = el('button', { className: 'button primary', text: stalePlan ? `Create v${currentCriterionVersion} plan` : 'Authorize immutable pre-run plan', attrs: { type: 'submit' } });
  form.append(submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = state.changeCase;
    const selectedTask = tasks[Number(planSelect.value)];
    const selectedRepository = state.behaviorRepositories[Number(repositorySelect.value)];
    if (!selectedTask || !selectedRepository || state.principal !== current.accountableOwner) return;
    const assertionRows = [...form.querySelectorAll('.behavior-assertion-row')];
    const assertions = assertionRows.map((row, criterionIndex) => ({
      id: row.dataset.assertionId, testName: row.querySelector('input[aria-label^="Exact TAP"]')?.value.trim(),
      criterionIndex, criterionId: requirement.criterionContract.criteria[criterionIndex].id,
      outcomeRefId: row.querySelector('select[aria-label^="Business outcome"]')?.value,
      scopeRefId: row.querySelector('select[aria-label^="Process scope"]')?.value,
      riskRefId: row.querySelector('select[aria-label^="Risk reference"]')?.value, checkId: check.id,
    }));
    const selectedPaths = [...new Set(paths.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean))];
    const fileMappings = pathMappings.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [filePath, role, rawCriteria] = line.split('|').map((value) => value.trim());
      return { path: filePath, role, criterionIds: (rawCriteria ?? '').split(',').map((value) => value.trim()).filter(Boolean) };
    });
    let caseDefinitionInput;
    try {
      caseDefinitionInput = Object.fromEntries(Object.entries(caseRows).map(([type, row]) => {
        const entry = { definition: row.definition.value.trim(), sourceRefId: row.sourceRef.value, criterionId: row.criterion.value };
        const hasDataset = Boolean(row.dataset.value.trim());
        const hasOracle = Boolean(row.expectedOutput.value.trim());
        const hasTestPath = Boolean(row.testPath.value.trim());
        const hasAssertion = Boolean(row.assertion.value);
        if (hasDataset !== hasOracle) throw new Error('Enter both the dataset and expected output oracle together.');
        if (hasTestPath !== hasAssertion) throw new Error('Enter the exact test path and assertion together.');
        if ((hasTestPath || hasAssertion) && !(hasDataset && hasOracle)) {
          throw new Error('Capture the dataset and expected output oracle before adding the test mapping.');
        }
        if (hasDataset && hasOracle) {
          Object.assign(entry, { dataset: JSON.parse(row.dataset.value), expectedOutput: JSON.parse(row.expectedOutput.value) });
          if (hasTestPath && hasAssertion) Object.assign(entry, { testPath: row.testPath.value.trim(), assertionId: row.assertion.value });
        }
        return [type, entry];
      }));
    } catch {
      notify('Enter valid JSON objects; dataset and expected output oracle must be paired, and test path and assertion must be paired.');
      return;
    }
    submit.disabled = true;
    try {
      state.changeCase = await api(`/api/sdlc/cases/${current.id}/process-behavior-test-plans`, { method: 'POST', body: JSON.stringify({
        version: current.version, draftRevision: artifact.draftRevision, requirementId: requirement.id,
        planId: selectedTask.plan.id, revision: selectedTask.plan.revision, taskId: selectedTask.task.id,
        assertions, fileMappings, githubSnapshotId: selectedRepository.snapshotId, githubSelectedPaths: selectedPaths,
        evaluationContext: { effectiveAt: effectiveAt.value.trim(), effectiveTimeSourceRefId: effectiveTimeSource.value },
        caseDefinitions: caseDefinitionInput,
        idempotencyKey: uid('authorize-behavior-plan'),
      }) });
      await refreshCases(); renderCase();
      notify('Immutable pre-run behavior test plan saved with exact process and repository pins. No test was run; business truth remains UNVERIFIED.');
    } catch (error) { submit.disabled = false; notify(error.message); await loadCase(current.id); }
  });
  card.append(section('Behavior test plan', form));
}

function renderProductHarnessMappings(card, requirement) {
  const current = state.changeCase;
  const { plans, r1Plans, r2Plans } = productHarnessEligiblePlanGroups(requirement);
  const mappings = (current.artifacts?.processBehaviorProductHarnessMappings ?? [])
    .filter((entry) => entry.requirementId === requirement.id);
  const authorizationMappings = mappings.filter((entry) => entry.subcaseId === 'N2.AUTHORIZATION');
  const missingAssertionMappings = mappings.filter((entry) => entry.subcaseId === 'N2.MISSING_ASSERTION');
  const deletedFailingTestMappings = mappings.filter((entry) => entry.subcaseId === 'N3');
  const reviews = current.artifacts?.processBehaviorProductHarnessMappingReviews ?? [];
  const executions = (current.artifacts?.processBehaviorProductHarnessExecutions ?? [])
    .filter((entry) => entry.mappingId && mappings.some((mapping) => mapping.id === entry.mappingId));
  const owner = state.authenticated && state.principal === current.accountableOwner;
  const requestFormVisibility = productHarnessRequestFormVisibility({ owner, plans, r1Plans, r2Plans });
  const controls = [];
  const fixtureStatus = current.productHarnessCapabilities?.n2AuthorizationFixture ?? 'NOT_CONFIGURED';
  const orphanPathFixtureStatus = current.productHarnessCapabilities?.n1OrphanPathFixture ?? 'NOT_CONFIGURED';
  const missingAssertionFixtureStatus = current.productHarnessCapabilities?.n2MissingAssertionFixture ?? 'NOT_CONFIGURED';
  const deletedFailingTestFixtureStatus = current.productHarnessCapabilities?.n3DeletedFailingTestFixture ?? 'UNAVAILABLE';
  const r1RecoveryFixtureStatus = current.productHarnessCapabilities?.r1RecoveryFixture ?? 'NOT_CONFIGURED';
  const r2RecoveryFixtureStatus = current.productHarnessCapabilities?.r2RecoveryFixture ?? 'NOT_CONFIGURED';
  const fixtureAvailable = fixtureStatus === 'AVAILABLE';
  const fixtureStatusCopy = fixtureStatus === 'UNAVAILABLE'
    ? 'The isolated N2 fixture is configured but unavailable. Execution is disabled and no reservation will be created. An operator can verify the dedicated writable fixture cluster, protected administrator URL, fixture-admin CREATEDB permission, and narrow application-role permission for pg_control_system() identity checks.'
    : 'The N2.AUTHORIZATION fixture provider is not configured. Mapping review is available, but execution is disabled and no reservation will be created. An operator can configure a dedicated writable fixture cluster, its protected administrator URL, and fixture-admin CREATEDB permission.';
  if (owner && !fixtureAvailable) controls.push(el('p', { attrs: { role: 'status' }, text: fixtureStatusCopy }));
  if (owner && orphanPathFixtureStatus !== 'AVAILABLE') controls.push(el('p', { attrs: { role: 'status' }, text: `N1 orphan-path fixture status: ${orphanPathFixtureStatus}. The fixed ${'src/unmapped.mjs'} candidate check is disabled until its isolated provider is available; no reservation will be created.` }));
  if (requestFormVisibility.subcaseForms) {
    const planSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved plan for fixed N2 authorization harness' } }, [
      el('option', { text: 'Choose saved plan', attrs: { value: '' } }),
      ...plans.map((plan) => el('option', { text: `${plan.id} · ${plan.planHash}`, attrs: { value: plan.id } })),
    ]);
    const submit = el('button', { className: 'button secondary', text: 'Request independent review of N2.AUTHORIZATION mapping', attrs: { type: 'submit' } });
    const form = el('form', { className: 'product-harness-mapping-request-form' }, [
      el('label', { text: 'Fixed subcase' }, el('select', { attrs: { disabled: 'disabled', 'aria-label': 'Fixed product subcase' } }, [
        el('option', { text: 'N2.AUTHORIZATION · fixed local API denial check', attrs: { value: 'N2.AUTHORIZATION', selected: 'selected' } }),
      ])),
      el('label', { text: 'Saved plan' }, planSelect), submit,
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        submit.disabled = true;
        state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mappings`, { method: 'POST', body: JSON.stringify({
          version: current.version, planId: planSelect.value, subcaseId: 'N2.AUTHORIZATION', idempotencyKey: uid('n2-product-harness-map'),
        }) });
        await refreshCases(); renderCase(); notify('Fixed N2.AUTHORIZATION mapping saved for independent review; scenario remains NOT EXECUTED.');
      } catch (error) { submit.disabled = false; notify(error.message); await loadCase(current.id); }
    });
    controls.push(form);

    const orphanPlanSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved plan for N1 orphan path safeguard' } }, [
      el('option', { text: 'Choose saved plan', attrs: { value: '' } }),
      ...plans.map((plan) => el('option', { text: `${plan.id} · ${plan.planHash}`, attrs: { value: plan.id } })),
    ]);
    const orphanSubmit = el('button', { className: 'button secondary', text: 'Request independent review of N1 orphan-path mapping', attrs: { type: 'submit' } });
    const orphanForm = el('form', { className: 'product-harness-n1-request-form' }, [
      el('label', { text: 'Fixed subcase' }, el('select', { attrs: { disabled: 'disabled', 'aria-label': 'Fixed N1 product subcase' } }, [
        el('option', { text: 'N1 · add exactly src/unmapped.mjs and reject before verifier dispatch', attrs: { value: 'N1', selected: 'selected' } }),
      ])),
      el('label', { text: 'Saved plan' }, orphanPlanSelect), orphanSubmit,
    ]);
    orphanForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        orphanSubmit.disabled = true;
        state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mappings`, { method: 'POST', body: JSON.stringify({
          version: current.version, planId: orphanPlanSelect.value, subcaseId: 'N1', idempotencyKey: uid('n1-product-harness-map'),
        }) });
        await refreshCases(); renderCase(); notify('N1 mapping saved for independent review; candidate execution remains NOT EXECUTED.');
      } catch (error) { orphanSubmit.disabled = false; notify(error.message); await loadCase(current.id); }
    });
    controls.push(orphanForm);

    const missingPlanSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved plan for N2 missing assertion safeguard' } }, [
      el('option', { text: 'Choose saved plan', attrs: { value: '' } }),
      ...plans.map((plan) => el('option', { text: `${plan.id} · ${plan.planHash}`, attrs: { value: plan.id } })),
    ]);
    const missingSubmit = el('button', { className: 'button secondary', text: 'Request independent review of N2.MISSING_ASSERTION mapping', attrs: { type: 'submit' } });
    const missingForm = el('form', { className: 'product-harness-missing-assertion-request-form' }, [
      el('label', { text: 'Fixed subcase' }, el('select', { attrs: { disabled: 'disabled', 'aria-label': 'Fixed missing assertion subcase' } }, [
        el('option', { text: 'N2.MISSING_ASSERTION · omitted named assertion link denial', attrs: { value: 'N2.MISSING_ASSERTION', selected: 'selected' } }),
      ])),
      el('label', { text: 'Saved plan' }, missingPlanSelect), missingSubmit,
    ]);
    missingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        missingSubmit.disabled = true;
        state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mappings`, { method: 'POST', body: JSON.stringify({
          version: state.changeCase.version, planId: missingPlanSelect.value, subcaseId: 'N2.MISSING_ASSERTION',
          idempotencyKey: uid('n2-missing-assertion-map'),
        }) });
        await refreshCases(); renderCase(); notify('N2.MISSING_ASSERTION mapping saved for independent review; no run or evidence-link attempt has occurred.');
      } catch (error) { missingSubmit.disabled = false; notify(error.message); await loadCase(current.id); }
    });
    controls.push(missingForm);

    const n3PlanSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved plan for N3 deleted failing test safeguard' } }, [
      el('option', { text: 'Choose saved plan', attrs: { value: '' } }),
      ...plans.map((plan) => el('option', { text: `${plan.id} · ${plan.planHash}`, attrs: { value: plan.id } })),
    ]);
    const n3Submit = el('button', { className: 'button secondary', text: 'Request independent review of N3 deleted-test mapping', attrs: { type: 'submit' } });
    const n3Form = el('form', { className: 'product-harness-n3-request-form' }, [
      el('p', { text: 'N3 has two stages: Original test fails on the pinned source bytes; then Unauthorized deletion is rejected for exactly tests/learning.test.js. Execution remains disabled until the fixed isolated N3 runner is available.' }),
      el('label', { text: 'Fixed subcase' }, el('select', { attrs: { disabled: 'disabled', 'aria-label': 'Fixed N3 product subcase' } }, [
        el('option', { text: 'N3 · prove the source test fails, then reject deleting that exact test', attrs: { value: 'N3', selected: 'selected' } }),
      ])),
      el('label', { text: 'Saved plan' }, n3PlanSelect), n3Submit,
    ]);
    n3Form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        n3Submit.disabled = true;
        state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mappings`, { method: 'POST', body: JSON.stringify({
          version: state.changeCase.version, planId: n3PlanSelect.value, subcaseId: 'N3', idempotencyKey: uid('n3-deleted-test-map'),
        }) });
        await refreshCases(); renderCase(); notify('N3 source-failure/deletion mapping saved for independent review; neither stage has executed.');
      } catch (error) { n3Submit.disabled = false; notify(error.message); await loadCase(current.id); }
    });
    controls.push(n3Form);

  }
  if (requestFormVisibility.r1RecoveryForm) {
    const r1PlanSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved v1 plan with linked evidence for R1 recovery' } }, [
      el('option', { text: 'Choose historical v1 plan and passing link', attrs: { value: '' } }),
      ...r1Plans.map((plan) => el('option', { text: `${plan.id} · criterion v${plan.criterionContractVersion} · ${plan.planHash}`,
        attrs: { value: plan.id } })),
    ]);
    const r1Submit = el('button', { className: 'button secondary', text: 'Request independent review of R1 v1→v2 recovery', attrs: { type: 'submit' } });
    const r1Form = el('form', { className: 'product-harness-r1-request-form' }, [
      el('p', { text: 'R1 binds an existing v1 plan and its passing evidence link. The fixed recovery check will prove stale v1 denial and distinct v2 evidence; no recovery stage has run yet.' }),
      el('label', { text: 'Historical v1 plan and linked passing evidence' }, r1PlanSelect), r1Submit,
    ]);
    r1Form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        r1Submit.disabled = true;
        state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mappings`, { method: 'POST', body: JSON.stringify({
          version: state.changeCase.version, planId: r1PlanSelect.value, subcaseId: 'R1', idempotencyKey: uid('r1-recovery-map'),
        }) });
        await refreshCases(); renderCase(); notify('R1 mapping saved with the v1 plan/link pins for independent review; recovery has not executed.');
      } catch (error) { r1Submit.disabled = false; notify(error.message); await loadCase(current.id); }
    });
    controls.push(r1Form);
  }
  if (requestFormVisibility.r2RecoveryForm) {
    const r2PlanSelect = el('select', { attrs: { required: 'required', 'aria-label': 'Saved passing plan with linked evidence for R2 shared draft recovery' } }, [
      el('option', { text: 'Choose saved plan with passing evidence', attrs: { value: '' } }),
      ...r2Plans.map((plan) => el('option', { text: `${plan.id} · draft revision ${plan.draftRevision} · ${plan.planHash}`,
        attrs: { value: plan.id } })),
    ]);
    const r2Submit = el('button', { className: 'button secondary', text: 'Request independent review of R2 shared-draft recovery', attrs: { type: 'submit' } });
    const r2Form = el('form', { className: 'product-harness-r2-request-form' }, [
      el('p', { text: 'R2 edits only the rationale of a different requirement after the selected requirement has a passing linked plan. The saved plan must become REGENERATION_REQUIRED for SHARED_REQUIREMENTS_DRAFT_CHANGED; stale execution is denied, then a separately reviewed plan, run, and link are created. The selected requirement and old evidence remain pinned.' }),
      el('label', { text: 'Saved plan for selected requirement A' }, r2PlanSelect), r2Submit,
    ]);
    r2Form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        r2Submit.disabled = true;
        state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mappings`, { method: 'POST', body: JSON.stringify({
          version: state.changeCase.version, planId: r2PlanSelect.value, subcaseId: 'R2', idempotencyKey: uid('r2-shared-draft-map'),
        }) });
        await refreshCases(); renderCase(); notify('R2 mapping saved with the selected and unrelated requirement pins for independent review; recovery has not executed.');
      } catch (error) { r2Submit.disabled = false; notify(error.message); await loadCase(current.id); }
    });
    controls.push(r2Form);
  }
  const saved = mappings.map((mapping) => {
    const review = reviews.find((entry) => entry.mappingId === mapping.id);
    const execution = executions.find((entry) => entry.mappingId === mapping.id);
    const article = el('article', { className: 'checkpoint-callout' }, [
      el('strong', { text: `Fixed product-path mapping · ${mapping.subcaseId}` }),
      el('p', { text: `Mapping SHA-256 ${mapping.mappingHash} · parent plan SHA-256 ${mapping.planHash} · definition SHA-256 ${mapping.parentDefinitionHash}` }),
      el('p', { text: `Dataset SHA-256 ${mapping.datasetHash} · oracle SHA-256 ${mapping.oracleHash} · harness ${mapping.harnessId} v${mapping.harnessVersion} · assertion ${mapping.assertionId}` }),
      ...(mapping.subcaseId === 'N2.MISSING_ASSERTION' ? [el('p', { text: `Required plan assertion ${mapping.requiredPlanAssertionId}: “${mapping.requiredPlanAssertionName}” · SHA-256 ${mapping.requiredPlanAssertionHash}. Expected real link attempt: 409 BEHAVIOR_CANDIDATE_REJECTED with UNKNOWN / ASSERTION_RESULT_NOT_FOUND and no saved link or case mutation.` })] : []),
      ...(mapping.subcaseId === 'R1' ? [el('p', { text: `R1 historical v1 pins · plan ${mapping.oldPlanId} SHA-256 ${mapping.oldPlanHash} · passing link ${mapping.oldLinkId} SHA-256 ${mapping.oldLinkHash} · prior run ${mapping.oldRunId}. Expected recovery: criterion v2 makes this plan REGENERATION_REQUIRED and its link STALE; old execution returns 409 BEHAVIOR_TEST_PLAN_STALE without mutation; a distinct v2 plan, run, and link preserve the old plan hash.${execution ? ` Separate recovery receipt ${execution.id} is ${execution.status}.` : ' The separate recovery check is NOT_EXECUTED.'}` })] : []),
      ...(mapping.subcaseId === 'R2' ? [el('p', { text: `R2 pins selected requirement ${mapping.requirementId} hash ${mapping.selectedRequirementHash} and unrelated requirement ${mapping.otherRequirementId} hash ${mapping.otherRequirementHash}; old plan ${mapping.oldPlanId} hash ${mapping.oldPlanHash}, link ${mapping.oldLinkId} hash ${mapping.oldLinkHash}. Expected edit changes only the unrelated rationale, preserving selected requirement A while its plan becomes REGENERATION_REQUIRED / SHARED_REQUIREMENTS_DRAFT_CHANGED. Old execution returns 409 BEHAVIOR_TEST_PLAN_STALE without mutation; a distinct fresh plan, run, and link are required.${execution ? ` Separate recovery receipt ${execution.id} is ${execution.status}.` : ' The separate recovery check is NOT_EXECUTED.'}` })] : []),
      el('p', { attrs: { role: 'status' }, text: `${review?.status ?? 'AWAITING_INDEPENDENT_REVIEW'} · ${mapping.subcaseId} ${execution?.status ?? 'NOT_EXECUTED'} · other negative/recovery cases NOT_EXECUTED · business truth UNVERIFIED` }),
    ]);
    if (mapping.subcaseId === 'R1' && execution) {
      article.append(el('p', { attrs: { role: 'status' }, text: execution.statement ?? `R1 ${execution.status}; business truth remains UNVERIFIED.` }));
      if (execution.status === 'PASS') article.append(el('p', { attrs: { role: 'note' }, text:
        `R1 receipt · old v1 plan ${execution.oldPlanId} ${execution.oldPlanHash}; old link ${execution.oldLinkId} ${execution.oldLinkHash}; new v2 plan ${execution.recovery?.fresh?.planId} ${execution.recovery?.fresh?.planHash}; new run ${execution.recovery?.fresh?.runId}; new link ${execution.recovery?.fresh?.linkId} ${execution.recovery?.fresh?.linkHash}.` }));
    }
    if (mapping.subcaseId === 'R2' && execution) {
      article.append(el('p', { attrs: { role: 'status' }, text: execution.statement ?? `R2 ${execution.status}; business truth remains UNVERIFIED.` }));
      if (execution.status === 'PASS') article.append(el('p', { attrs: { role: 'note' }, text:
        `R2 receipt · old plan ${execution.oldPlanId} ${execution.oldPlanHash}; old link ${execution.oldLinkId} ${execution.oldLinkHash}; selected requirement SHA-256 ${execution.selectedRequirementHash}; new plan ${execution.recovery?.fresh?.planHash}; new run ${execution.recovery?.fresh?.runId}; new link ${execution.recovery?.fresh?.linkHash}.` }));
    }
    const subcaseStatus = mapping.subcaseId === 'R2' ? r2RecoveryFixtureStatus
      : mapping.subcaseId === 'R1' ? r1RecoveryFixtureStatus
      : mapping.subcaseId === 'N1' ? orphanPathFixtureStatus
      : mapping.subcaseId === 'N2.MISSING_ASSERTION' ? missingAssertionFixtureStatus
      : mapping.subcaseId === 'N3' ? deletedFailingTestFixtureStatus : fixtureStatus;
    if (subcaseStatus !== 'AVAILABLE') {
      article.append(el('p', { attrs: { role: 'status' }, text: `${mapping.subcaseId} fixture status: ${subcaseStatus}. Execution is disabled and no reservation will be created.` }));
    }
    if (mapping.subcaseId === 'N2.AUTHORIZATION' && owner && current.productHarnessCapabilities?.n2AuthorizationFixture === 'AVAILABLE'
      && review?.integrityStatus === 'VALID' && review.decision === 'APPROVE_FOR_TEST_EXECUTION' && !execution) {
      const run = el('button', { className: 'button secondary', text: 'Run fixed N2.AUTHORIZATION product-path check', attrs: { type: 'button' } });
      run.addEventListener('click', async () => {
        try {
          run.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-executions`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            subcaseId: 'N2.AUTHORIZATION', idempotencyKey: uid('n2-product-harness-execute'),
          }) });
          await refreshCases(); renderCase(); notify('N2.AUTHORIZATION product-path result saved; remaining cases and business truth stay unverified.');
        } catch (error) { run.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(run);
    }
    if (mapping.subcaseId === 'R1' && owner && subcaseStatus === 'AVAILABLE'
      && review?.integrityStatus === 'VALID' && review.decision === 'APPROVE_FOR_TEST_EXECUTION' && !execution) {
      const run = el('button', { className: 'button secondary', text: 'Run R1 v1-to-v2 recovery check', attrs: { type: 'button' } });
      run.addEventListener('click', async () => {
        try {
          run.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-executions`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            subcaseId: 'R1', idempotencyKey: uid('r1-recovery-execute'),
          }) });
          const receipt = state.changeCase.productBehaviorHarnessExecution;
          await refreshCases(); renderCase();
          notify(receipt?.statement ?? `R1 ${receipt?.status ?? 'INCONCLUSIVE'}; inspect the immutable recovery receipt.`);
        } catch (error) { run.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(run);
    }
    if (mapping.subcaseId === 'R2' && owner && subcaseStatus === 'AVAILABLE'
      && review?.integrityStatus === 'VALID' && review.decision === 'APPROVE_FOR_TEST_EXECUTION' && !execution) {
      const run = el('button', { className: 'button secondary', text: 'Run R2 shared-draft recovery check', attrs: { type: 'button' } });
      run.addEventListener('click', async () => {
        try {
          run.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-executions`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            subcaseId: 'R2', idempotencyKey: uid('r2-shared-draft-execute'),
          }) });
          const receipt = state.changeCase.productBehaviorHarnessExecution;
          await refreshCases(); renderCase(); notify(receipt?.statement ?? `R2 ${receipt?.status ?? 'INCONCLUSIVE'}; inspect the immutable recovery receipt.`);
        } catch (error) { run.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(run);
    }
    if (mapping.subcaseId === 'N1') article.append(el('p', { attrs: { role: 'note' }, text: `Fixed candidate mutation: add exactly ${mapping.candidatePath ?? 'src/unmapped.mjs'}. Mapping hash ${mapping.mappingHash}; source tree ${mapping.repositoryTreeDigest}. Expected result: FAILED / BEHAVIOR_CANDIDATE_ORPHAN_PATH before verifier dispatch; the separate N1 receipt retains source and candidate tree hashes and the actual added-path metadata.` }));
    if (mapping.subcaseId === 'N3') article.append(el('p', { attrs: { role: 'note' }, text: n3StageStatusCopy(mapping, execution) }));
    if (mapping.subcaseId === 'N1' && owner && subcaseStatus === 'AVAILABLE'
      && review?.integrityStatus === 'VALID' && review.decision === 'APPROVE_FOR_TEST_EXECUTION' && !execution) {
      const run = el('button', { className: 'button secondary', text: 'Run N1 orphan-path rejection check', attrs: { type: 'button' } });
      run.addEventListener('click', async () => {
        try {
          run.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-executions`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            subcaseId: 'N1', idempotencyKey: uid('n1-product-harness-execute'),
          }) });
          const receipt = state.changeCase.productBehaviorHarnessExecution;
          await refreshCases(); renderCase();
          notify(receipt?.status === 'PASS'
            ? 'PASS — src/unmapped.mjs was rejected before verifier dispatch.'
            : `N1 ${receipt?.status ?? 'INCONCLUSIVE'}; no broader negative-suite or business-truth conclusion was established.`);
        } catch (error) { run.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(run);
    }
    if (mapping.subcaseId === 'N3' && owner && subcaseStatus === 'AVAILABLE'
      && review?.integrityStatus === 'VALID' && review.decision === 'APPROVE_FOR_TEST_EXECUTION' && !execution) {
      const run = el('button', { className: 'button secondary', text: 'Run N3 failing-source/deletion safeguard check', attrs: { type: 'button' } });
      run.addEventListener('click', async () => {
        try {
          run.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-executions`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            subcaseId: 'N3', idempotencyKey: uid('n3-deleted-test-execute'),
          }) });
          const receipt = state.changeCase.productBehaviorHarnessExecution;
          await refreshCases(); renderCase();
          notify(receipt?.status === 'PASS'
            ? 'PASS — the pinned source test failed as expected, and deletion of tests/learning.test.js was rejected.'
            : `N3 ${receipt?.status ?? 'INCONCLUSIVE'}; inspect both source and deletion evidence. No broader suite or business-truth conclusion was established.`);
        } catch (error) { run.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(run);
    }
    if (mapping.subcaseId === 'N2.MISSING_ASSERTION' && owner && subcaseStatus === 'AVAILABLE'
      && review?.integrityStatus === 'VALID' && review.decision === 'APPROVE_FOR_TEST_EXECUTION' && !execution) {
      const run = el('button', { className: 'button secondary', text: 'Run missing-assertion safeguard check', attrs: { type: 'button' } });
      run.addEventListener('click', async () => {
        try {
          run.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-executions`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            subcaseId: 'N2.MISSING_ASSERTION', idempotencyKey: uid('n2-missing-assertion-execute'),
          }) });
          const receipt = state.changeCase.productBehaviorHarnessExecution;
          await refreshCases(); renderCase();
          notify(receipt?.status === 'PASS'
            ? 'PASS — the required assertion was absent, and no evidence link was saved.'
            : `N2.MISSING_ASSERTION ${receipt?.status ?? 'INCONCLUSIVE'}; no broader negative-suite or business-truth conclusion was established.`);
        } catch (error) { run.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(run);
    }
    if (!review && state.authenticated && state.principal !== mapping.requestedBy && mapping.integrityStatus === 'VALID') {
      const decision = el('select', { attrs: { required: 'required', 'aria-label': mapping.subcaseId === 'R2'
        ? 'R2 product mapping review decision' : mapping.subcaseId === 'R1'
        ? 'R1 product mapping review decision' : mapping.subcaseId === 'N1'
        ? 'N1 product mapping review decision' : mapping.subcaseId === 'N3'
        ? 'N3 product mapping review decision' : 'N2 product mapping review decision' } }, [
        el('option', { text: 'Choose mapping review decision', attrs: { value: '' } }),
        el('option', { text: 'Approve fixed mapping for harness execution', attrs: { value: 'APPROVE_FOR_TEST_EXECUTION' } }),
        el('option', { text: 'Request changes to fixed mapping', attrs: { value: 'REQUEST_CHANGES' } }),
      ]);
      const submit = el('button', { className: 'button secondary', text: 'Record independent mapping review', attrs: { type: 'button' } });
      submit.addEventListener('click', async () => {
        try {
          submit.disabled = true;
          state.changeCase = await api(`/api/sdlc/cases/${current.id}/product-behavior-harness-mapping-reviews`, { method: 'POST', body: JSON.stringify({
            version: state.changeCase.version, mappingId: mapping.id, mappingHash: mapping.mappingHash,
            decision: decision.value, idempotencyKey: uid('n2-product-harness-review'),
          }) });
          await refreshCases(); renderCase(); notify(`Independent ${mapping.subcaseId} mapping review recorded; stages remain NOT EXECUTED.`);
        } catch (error) { submit.disabled = false; notify(error.message); await loadCase(current.id); }
      });
      article.append(el('label', { text: 'Independent decision' }, decision), submit);
    }
    return article;
  });
  if (controls.length || saved.length) card.append(section('Fixed product-path harness mappings', [
    el('p', { text: `N1 orphan-path fixture status: ${orphanPathFixtureStatus}; N2.AUTHORIZATION fixture status: ${fixtureStatus}; N2.MISSING_ASSERTION fixture status: ${missingAssertionFixtureStatus}; N3 deleted-test fixture status: ${deletedFailingTestFixtureStatus}; R1 criterion-recovery fixture status: ${r1RecoveryFixtureStatus}; R2 shared-draft recovery fixture status: ${r2RecoveryFixtureStatus}. Each registered mapping has a separate review and receipt.` }),
    ...controls, ...saved,
  ]));
}

function renderRequirements(content) {
  const artifact = state.changeCase.artifacts.requirements;
  if (!artifact) return content.append(empty('Requirements are generated only after context, impact, and governance gates pass.'));
  const baseline = artifact.acceptedBaseline;
  content.append(section(baseline ? `Accepted baseline v${baseline.version}` : `Requirement draft · revision ${artifact.draftRevision ?? 1}`, el('p', { text: baseline
    ? `Accepted by ${baseline.acceptedBy} · SHA-256 ${baseline.contentHash} · linked intent/source hashes are frozen.`
    : 'Edit the proposed statements and criteria, then the case owner can accept a validated version to pass G4.' })));
  if (artifact.validationFindings?.length) content.append(section('Validation findings', el('ul', {}, artifact.validationFindings.map((entry) => el('li', { text: `${entry.code}: ${entry.message}` })))));
  const draft = el('div', { className: 'requirement-draft-list' });
  for (const requirement of artifact.requirements) {
    const card = el('article', { className: 'requirement-draft-card' }, [
      el('strong', { text: `${requirement.id} · ${requirement.kind}` }),
      el('p', { text: requirement.statement }),
      el('small', { text: `Owner ${requirement.owner} · ${requirement.priority} · ${requirement.status} · Links: ${(requirement.sourceLinks ?? []).map((link) => link.ref).join(' · ') || requirement.derivedFrom.join(' · ')}` }),
    ]);
    card.dataset.requirementId = requirement.id;
    if (requirement.processTrace && requirement.verificationContract) {
      const trace = requirement.processTrace;
      const contract = requirement.verificationContract;
      card.append(el('section', { className: 'process-requirement-trace' }, [
        el('strong', { text: 'Pinned process requirement trace · DRAFT · NOT EXECUTED' }),
        el('p', { text: `Source project ${trace.source.projectId} v${trace.source.projectVersion} · blueprint ${trace.source.blueprintId} v${trace.source.blueprintVersion} · snapshot SHA-256 ${trace.source.blueprintSnapshotHash}` }),
        el('p', { text: `Process ${trace.process.id} · full process SHA-256 ${trace.source.processSnapshotHash} · compact source SHA-256 ${trace.source.sourceHash} · binding SHA-256 ${trace.source.bindingHash}` }),
        el('p', { text: `Process detail: ${trace.process.detail || 'UNKNOWN'} · trigger: ${trace.process.trigger || 'UNKNOWN'} · owner reference: ${trace.process.ownerRef || 'UNKNOWN'}` }),
        el('p', { text: `Inputs: ${trace.process.inputs.map((entry) => `${entry.type}: ${entry.name} (${entry.id})`).join(', ') || 'UNKNOWN'} · Outputs: ${trace.outcome.outputRefs.map((entry) => `${entry.type}: ${entry.name} (${entry.id})`).join(', ') || 'UNKNOWN'}` }),
        el('p', { text: `Scope: capabilities ${trace.scope.capabilityRefs.map((entry) => entry.id).join(', ') || 'UNKNOWN'}; systems ${trace.scope.systemRefs.map((entry) => entry.id).join(', ') || 'UNKNOWN'}; resources ${trace.scope.resourceRefs.map((entry) => entry.id).join(', ') || 'UNKNOWN'}` }),
        el('p', { text: `Risk: ${trace.risk.status}${trace.risk.refs.length ? ` · ${trace.risk.refs.map((entry) => `${entry.id} (${entry.snapshotHash})`).join(', ')}` : ''} · outcome: ${trace.outcome.type} · metrics: ${trace.outcome.metricRefs.map((entry) => entry.id).join(', ') || 'UNKNOWN'}` }),
        el('p', { text: `Verification: ${contract.type} · ${contract.evidenceKind} · ${contract.status}. ${contract.reason} Simulation results and caller-supplied records do not count as verified execution.` }),
      ]));
      const links = requirement.processRunEvidenceLinks ?? [];
      const reviews = requirement.processRunEvidenceReviews ?? [];
      card.append(section('Persisted process runs', [
        el('p', { text: 'Linked runtime records preserve exact task and source identity. A link is provenance only; it does not verify outputs, approve this draft, or authorize effects.' }),
        ...(links.length ? links.map((link) => {
          const view = processRunEvidencePresentation(link);
          const behaviorPlan = (state.changeCase.artifacts.processBehaviorTestPlans ?? [])
            .find((entry) => entry.id === link.behaviorEvaluation?.planId);
          const behaviorPlanStatus = (requirement.processBehaviorTestPlans ?? [])
            .find((entry) => entry.id === behaviorPlan?.id);
          const savedScenarioExecutions = (state.changeCase.artifacts.processBehaviorScenarioExecutions ?? [])
            .filter((entry) => entry.linkId === link.id);
          const scenarioTypes = ['POSITIVE', 'NEGATIVE', 'RECOVERY'];
          const currentPlan = behaviorPlanStatus?.regenerationStatus === 'CURRENT'
            && behaviorPlanStatus?.draftRevision === state.changeCase.artifacts.requirements.draftRevision;
          const currentIndependentReviews = reviews.filter((review) => review.schemaVersion === 4
            && review.linkId === link.id && review.behaviorPlanId === behaviorPlan?.id
            && review.behaviorPlanHash === link.behaviorEvaluation?.planHash
            && review.integrityStatus === 'VALID' && review.applicability === 'CURRENT'
            && review.reviewerPrincipal !== state.changeCase.accountableOwner)
            .sort((left, right) => Number(left.recordedVersion ?? 0) - Number(right.recordedVersion ?? 0)
              || String(left.reviewedAt ?? '').localeCompare(String(right.reviewedAt ?? ''))
              || String(left.id).localeCompare(String(right.id)));
          const scenarioActions = scenarioTypes.map((caseType) => {
            const definition = behaviorPlan?.caseDefinitions?.cases?.find((entry) => entry.type === caseType);
            const latestReview = currentIndependentReviews.at(-1);
            const caseReview = latestReview?.scenarioCases?.find((entry) => entry.type === caseType);
            const approvedReview = caseReview?.executionReviewStatus === 'REVIEWED_FOR_TEST_EXECUTION'
              && caseReview.executionDecision === 'APPROVE_FOR_TEST_EXECUTION';
            const alreadyExecuted = savedScenarioExecutions.some((entry) => entry.caseType === caseType);
            const canExecute = !baseline && state.authenticated && state.principal === state.changeCase.accountableOwner
              && link.applicability === 'CURRENT' && currentPlan && definition?.executionMapping?.status === 'OWNER_PROPOSED_UNVERIFIED'
              && approvedReview && !alreadyExecuted;
            if (!canExecute) return null;
            const button = el('button', { className: 'button secondary', text: `Run reviewed ${caseType.toLowerCase()} case`, attrs: { type: 'button' } });
            button.addEventListener('click', async () => {
              const current = state.changeCase;
              try {
                button.disabled = true;
                const result = await api(`/api/sdlc/cases/${current.id}/process-behavior-scenario-executions`, { method: 'POST', body: JSON.stringify({
                  version: current.version, draftRevision: current.artifacts.requirements.draftRevision,
                  requirementId: requirement.id, linkId: link.id, planId: behaviorPlan.id,
                  caseType, idempotencyKey: uid('scenario-execution'),
                }) });
                state.changeCase = result;
                await refreshCases(); renderCase();
                notify(`${caseType} saved assertion ${result.processBehaviorScenarioExecution.result} against its pinned dataset and oracle; this one case does not establish suite or business PASS.`);
              } catch (error) { button.disabled = false; notify(error.message); await loadCase(current.id); }
            });
            return button;
          }).filter(Boolean);
          const scenarioReviewNotes = currentPlan && link.applicability === 'CURRENT'
            ? scenarioTypes.flatMap((caseType) => {
              const definition = behaviorPlan?.caseDefinitions?.cases?.find((entry) => entry.type === caseType);
              const latestReview = currentIndependentReviews.at(-1);
              const decision = latestReview?.scenarioCases?.find((entry) => entry.type === caseType);
              if (!definition || definition.executionMapping?.status !== 'OWNER_PROPOSED_UNVERIFIED'
                || savedScenarioExecutions.some((entry) => entry.caseType === caseType)
                || (decision?.executionDecision === 'APPROVE_FOR_TEST_EXECUTION'
                  && decision.executionReviewStatus === 'REVIEWED_FOR_TEST_EXECUTION')) return [];
              const reason = decision?.executionDecision === 'REQUEST_CHANGES'
                ? `The latest independent review requests changes for ${caseType.toLowerCase()}. Submit a new independent review of this saved case before execution.`
                : `No current independent approval covers the ${caseType.toLowerCase()} case. Submit an independent review of this saved case before execution.`;
              return [reason];
            }) : [];
          const currentRevision = state.changeCase.artifacts.requirements.draftRevision;
          const executionViews = savedScenarioExecutions.map((entry) => processBehaviorScenarioExecutionPresentation(entry, {
            current: link.applicability === 'CURRENT' && behaviorPlan?.planHash === entry.planHash
              && behaviorPlanStatus?.draftRevision === currentRevision && behaviorPlanStatus?.regenerationStatus === 'CURRENT',
          })).filter(Boolean);
          const observeButton = !baseline && state.authenticated && link.applicability === 'CURRENT' && link.repositoryCheckEvidenceStatus === 'AVAILABLE'
            ? el('button', { className: 'button secondary', text: 'Record code-check observation and proposal', attrs: { type: 'button' } }) : null;
          observeButton?.addEventListener('click', async () => {
            const current = state.changeCase;
            try {
              observeButton.disabled = true;
              state.changeCase = await api(`/api/sdlc/cases/${current.id}/repository-check-observations`, { method: 'POST', body: JSON.stringify({
                version: current.version, draftRevision: current.artifacts.requirements.draftRevision,
                requirementId: requirement.id, linkId: link.id, idempotencyKey: uid('repository-check-observation'),
              }) });
              await refreshCases(); renderCase(); notify('Code-check observation and non-authorizing proposal recorded; business truth remains UNVERIFIED and behavior NOT EXECUTED.');
            } catch (error) { observeButton.disabled = false; notify(error.message); await loadCase(current.id); }
          });
          return view ? el('article', { className: 'checkpoint-callout' }, [
            el('strong', { text: view.heading }), el('p', { text: view.identity }), el('p', { text: view.hashes }),
            el('p', { text: `${link.reason} ${view.applicability}` }),
            el('p', { text: `Repository-check evidence state: ${view.repositoryCheckStatus}. Checks are separate repository evidence and do not verify process business behavior; verification remains ${link.verificationStatus}.` }),
            ...(view.outputs ?? []).map((output) => el('p', { text: output })),
            ...(view.repositoryChecks ?? []).map((receipt) => el('p', { text: `Repository-check receipt · ${receipt}` })),
            ...(view.behaviorEvaluation ? [el('p', { attrs: { role: 'status' }, text: view.behaviorEvaluation.status }),
              el('ul', {}, view.behaviorEvaluation.assertions.map((assertion) => el('li', { text: assertion })))] : []),
            ...scenarioReviewNotes.map((note) => el('p', { attrs: { role: 'status' }, text: note })),
            ...scenarioActions,
            ...(executionViews.length ? [el('section', { className: 'scenario-execution-receipts' }, executionViews.flatMap((entry) => [
              el('strong', { text: entry.heading }), el('p', { text: entry.pins }), el('p', { text: entry.assertion }),
              el('p', { text: entry.tap }), el('p', { attrs: { role: 'status' }, text: entry.status }),
            ]))] : []),
            ...(observeButton ? [observeButton] : []),
          ]) : empty('A linked process run has incomplete displayable identity.');
        }) : [empty('No persisted process run is linked to this draft.')]),
      ]));
      const codeObservations = (state.changeCase.artifacts.repositoryCheckObservations ?? [])
        .filter((entry) => entry.requirementId === requirement.id);
      const codeProposals = state.changeCase.artifacts.repositoryCheckProposals ?? [];
      if (codeObservations.length) card.append(section('Repository-check observations and proposals', codeObservations.map((entry) => {
        const proposal = codeProposals.find((candidate) => candidate.evidence?.observationId === entry.id);
        const view = repositoryCheckObservationPresentation(entry, proposal);
        return view ? el('article', { className: 'checkpoint-callout' }, [el('strong', { text: view.heading }),
          el('p', { text: view.pins }), el('p', { text: view.outcome }), el('p', { text: view.status }), el('ul', {}, view.checks.map((text) => el('li', { text }))),
          el('p', { text: view.proposal })]) : empty('A repository-check observation has invalid display identity.');
      })));
      card.append(section('Independent evidence reviews', [
        el('p', { text: 'A reviewer records an attestation against each declared criterion and the exact linked evidence. HUMAN_REVIEWED is a human judgment, not external truth or executed behavior; verification remains NOT EXECUTED.' }),
        ...(reviews.length ? reviews.map((review) => {
          const view = processEvidenceReviewPresentation(review);
          return view ? el('article', { className: 'checkpoint-callout' }, [
            el('strong', { text: view.heading }), el('p', { text: view.identity }), el('p', { text: view.status }),
            el('ul', {}, view.criteria.map((entry) => el('li', { text: entry }))),
            ...(view.scenarios?.length ? [el('strong', { text: `Independent scenario-definition review · plan ${review.behaviorPlanHash} · NOT EXECUTED` }),
              el('ul', {}, view.scenarios.map((entry) => el('li', { text: entry })))] : []),
            ...(view.resolution ? [el('p', { attrs: { role: 'status' }, text: view.resolution })] : []),
          ]) : empty('A saved review record has incomplete or invalid display identity.');
        }) : [empty('No independent evidence review is recorded for this requirement.')]),
      ]));
      const acceptances = requirement.processIntentEvaluationAcceptances ?? [];
      if (acceptances.length) card.append(section('Intent evaluation acceptance', acceptances.map((acceptance) => {
        const view = intentEvaluationAcceptancePresentation(acceptance);
        return view ? el('article', { className: 'checkpoint-callout' }, [el('strong', { text: view.heading }),
          el('p', { text: view.pins }), el('p', { attrs: { role: 'status' }, text: view.status }), el('p', { text: `Reason: ${view.reason}` })])
          : empty('A saved intent evaluation acceptance has incomplete or invalid display identity.');
      })));
      if (!baseline && state.authenticated) {
        for (const link of links.filter((entry) => canAcceptIntentEvaluation({ authenticated: state.authenticated,
          principal: state.principal, accountableOwner: state.changeCase.accountableOwner, baseline,
          requirement, draftRevision: state.changeCase.artifacts.requirements.draftRevision, link: entry, reviews,
          acceptances }))) {
          const latestReview = reviews.filter((review) => review.linkId === link.id
            && review.behaviorPlanId === link.behaviorEvaluation.planId
            && review.behaviorPlanHash === link.behaviorEvaluation.planHash
            && review.integrityStatus === 'VALID' && review.applicability === 'CURRENT'
            && review.reviewerPrincipal !== state.principal)
            .sort((left, right) => Number(left.recordedVersion ?? 0) - Number(right.recordedVersion ?? 0)
              || String(left.reviewedAt ?? '').localeCompare(String(right.reviewedAt ?? ''))
              || String(left.id).localeCompare(String(right.id))).at(-1);
          const supportedReview = latestReview?.acceptanceStatus === 'REVIEW_ONLY_NOT_ACCEPTED'
            && !latestReview.conflictResolution
            && latestReview.criteria?.length === (requirement.reviewCriteria ?? []).length
            && latestReview.criteria.every((entry) => entry.disposition === 'SUPPORTED') ? latestReview : null;
          if (!supportedReview) continue;
          const form = el('form', { className: 'intent-evaluation-acceptance-form' }, [
            el('p', { text: `Accept the scoped evaluation for link ${link.id} after review ${supportedReview.id}. This does not verify external business truth or runtime behavior.` }),
            el('label', {}, [el('span', { text: 'Acceptance reason' }), el('textarea', { attrs: { name: 'reason', required: 'required', maxlength: '1000' } })]),
            el('button', { className: 'button', text: 'Accept intent evaluation', attrs: { type: 'submit' } }),
          ]);
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const reason = form.elements.reason.value.trim();
            if (!reason) { notify('Enter a reason for accepting this scoped evaluation.'); return; }
            const current = state.changeCase;
            const submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            try {
              state.changeCase = await api(`/api/sdlc/cases/${current.id}/intent-evaluation-acceptances`, { method: 'POST', body: JSON.stringify({
                version: current.version, draftRevision: current.artifacts.requirements.draftRevision,
                requirementId: requirement.id, linkId: link.id, reviewId: supportedReview.id,
                reason, idempotencyKey: uid('accept-intent-evaluation'),
              }) });
              await refreshCases(); renderCase();
              notify('Scoped intent evaluation accepted. Business truth remains UNVERIFIED and runtime verification remains NOT EXECUTED.');
            } catch (error) { submit.disabled = false; notify(error.message); await loadCase(state.changeCase.id); }
          });
          card.append(form);
        }
      }
      if (!baseline && state.authenticated) {
        for (const link of links.filter((entry) => entry.applicability === 'CURRENT' && entry.status === 'UNVERIFIED'
          && entry.verificationStatus === 'NOT_EXECUTED')) {
          const reviewForm = el('form', { className: 'process-evidence-review-form' }, [
            el('p', { text: `Review exact link ${link.id}. Select a decision and record a reason for every acceptance criterion.` }),
          ]);
          const conflictStatus = el('p', { attrs: { role: 'status', 'data-review-conflict': 'true' },
            text: 'If business and technical judgments conflict, an explicit resolution is required. It preserves every criterion result and cannot override a failed mandatory criterion.' });
          const conflictRationale = el('textarea', { attrs: { maxlength: '1000', 'data-review-conflict-rationale': 'true',
            'aria-label': 'Conflict resolution rationale' } });
          reviewForm.append(el('fieldset', { className: 'review-conflict-resolution' }, [
            el('legend', { text: 'Explicit reviewer resolution when required' }), conflictStatus,
            el('label', {}, [el('span', { text: 'Rationale (required when the review conflicts or a mandatory criterion fails)' }), conflictRationale]),
          ]));
          for (const criterion of requirement.reviewCriteria ?? []) {
            const decision = el('select', { attrs: { 'data-criterion-hash': criterion.criterionHash, 'aria-label': `Decision for criterion ${criterion.index + 1}` } }, [
              el('option', { text: 'Choose a review decision', attrs: { value: '' } }),
              el('option', { text: 'Evidence supports criterion', attrs: { value: 'SUPPORTED' } }),
              el('option', { text: 'Evidence contradicts criterion', attrs: { value: 'CONTRADICTED' } }),
              el('option', { text: 'Evidence is inconclusive', attrs: { value: 'INCONCLUSIVE' } }),
            ]);
            const note = el('textarea', { attrs: { required: 'required', maxlength: '1000', 'data-criterion-note': criterion.criterionHash,
              'aria-label': `Reason for criterion ${criterion.index + 1}` } });
            reviewForm.append(el('fieldset', {}, [el('legend', { text: `Criterion ${criterion.index + 1}: ${criterion.criterion}` }),
              el('label', {}, [el('span', { text: 'Decision' }), decision]),
              el('label', {}, [el('span', { text: 'Review note' }), note]) ]));
            decision.addEventListener('change', () => {
              const declarations = requirement.reviewCriteria ?? [];
              const decisions = [...reviewForm.querySelectorAll('select[data-criterion-hash]')];
              const rows = declarations.map((decl, index) => ({ ...decl, disposition: decisions[index]?.value ?? '' }));
              const businessSupported = rows.some((row) => row.type === 'BUSINESS' && row.disposition === 'SUPPORTED');
              const businessContradicted = rows.some((row) => row.type === 'BUSINESS' && row.disposition === 'CONTRADICTED');
              const technicalSupported = rows.some((row) => row.type === 'TECHNICAL' && row.disposition === 'SUPPORTED');
              const technicalContradicted = rows.some((row) => row.type === 'TECHNICAL' && row.disposition === 'CONTRADICTED');
              const mandatoryFailure = rows.some((row) => row.mandatory && row.disposition === 'CONTRADICTED');
              const conflict = (businessSupported && technicalContradicted) || (businessContradicted && technicalSupported);
              conflictStatus.textContent = conflict
                ? 'Conflict detected between typed business and technical criteria. Record a rationale to preserve these exact outcomes; this does not accept or verify the requirement.'
                : mandatoryFailure
                  ? 'A mandatory criterion is failed. Record a rationale; the failure remains failed and acceptance stays blocked.'
                  : 'If business and technical judgments conflict, an explicit resolution is required. It preserves every criterion result and cannot override a failed mandatory criterion.';
              conflictRationale.required = conflict || mandatoryFailure;
            });
          }
          const behaviorPlan = (requirement.processBehaviorTestPlans ?? []).find((entry) => entry.id === link.behaviorEvaluation?.planId);
          const scenarioInputs = [];
          for (const definition of behaviorPlan?.caseDefinitions?.cases ?? []) {
            const decision = el('select', { attrs: { 'data-scenario-type': definition.type, required: 'required', 'aria-label': `Decision for ${definition.type.toLowerCase()} scenario` } }, [
              el('option', { text: 'Choose a review decision', attrs: { value: '' } }),
              el('option', { text: 'Definition is supported', attrs: { value: 'SUPPORTED' } }),
              el('option', { text: 'Definition is contradicted', attrs: { value: 'CONTRADICTED' } }),
              el('option', { text: 'Definition is inconclusive', attrs: { value: 'INCONCLUSIVE' } }),
            ]);
            const executionDecision = el('select', { attrs: { 'data-execution-decision': definition.type, required: 'required',
              'aria-label': `Test execution review decision for ${definition.type.toLowerCase()} scenario` } }, [
              el('option', { text: 'Choose test execution review decision', attrs: { value: '' } }),
              el('option', { text: 'Approve for test execution', attrs: { value: 'APPROVE_FOR_TEST_EXECUTION' } }),
              el('option', { text: 'Request changes', attrs: { value: 'REQUEST_CHANGES' } }),
            ]);
            const note = el('textarea', { attrs: { required: 'required', maxlength: '1000', 'data-scenario-note': definition.type,
              'aria-label': `Review note for ${definition.type.toLowerCase()} scenario` } });
            scenarioInputs.push({ definition, decision, executionDecision, note });
            reviewForm.append(el('fieldset', {}, [el('legend', { text: `Captured ${definition.type.toLowerCase()} scenario · NOT EXECUTED` }),
              el('p', { text: `${definition.definition} · source ${definition.sourceRef.id} · criterion ${definition.criterionId} · dataset ${JSON.stringify(definition.dataset ?? 'INCOMPLETE')} · expected output ${JSON.stringify(definition.expectedOutput ?? 'INCOMPLETE')} · assertion ${definition.executionMapping?.assertionId ?? 'INCOMPLETE'} / ${definition.executionMapping?.testName ?? 'INCOMPLETE'} · test file ${definition.executionMapping?.testPath ?? 'INCOMPLETE'} · mapping ${definition.executionMapping?.status ?? 'INCOMPLETE'}` }),
              el('label', {}, [el('span', { text: 'Independent definition review' }), decision]),
              el('label', {}, [el('span', { text: 'Test execution review · does not execute behavior' }), executionDecision]),
              el('label', {}, [el('span', { text: 'Review note' }), note])]));
          }
          const submit = el('button', { className: 'button secondary', text: 'Record independent review', attrs: { type: 'submit' } });
          reviewForm.append(submit);
          reviewForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const current = state.changeCase;
            const criteria = [...reviewForm.querySelectorAll('select[data-criterion-hash]')].map((decision) => ({
              criterionHash: decision.getAttribute('data-criterion-hash'), disposition: decision.value,
              note: reviewForm.querySelector(`[data-criterion-note="${decision.getAttribute('data-criterion-hash')}"]`)?.value ?? '',
            }));
            if (criteria.some((entry) => !entry.disposition || !entry.note.trim())) { notify('Choose a decision and enter a note for every criterion.'); return; }
            const scenarioCases = scenarioInputs.map(({ definition, decision, executionDecision, note }) => ({ type: definition.type,
              definition: Object.fromEntries(Object.entries(definition).filter(([key]) => key !== 'definitionHash')),
              disposition: decision.value, executionDecision: executionDecision.value, note: note.value.trim() }));
            if (scenarioCases.some((entry) => !entry.disposition || !entry.executionDecision || !entry.note)) { notify('Review each captured positive, negative, and recovery definition and its test-execution decision.'); return; }
            const declarations = requirement.reviewCriteria ?? [];
            const rows = declarations.map((decl, index) => ({ ...decl, disposition: criteria[index]?.disposition ?? '' }));
            const businessSupported = rows.some((row) => row.type === 'BUSINESS' && row.disposition === 'SUPPORTED');
            const businessContradicted = rows.some((row) => row.type === 'BUSINESS' && row.disposition === 'CONTRADICTED');
            const technicalSupported = rows.some((row) => row.type === 'TECHNICAL' && row.disposition === 'SUPPORTED');
            const technicalContradicted = rows.some((row) => row.type === 'TECHNICAL' && row.disposition === 'CONTRADICTED');
            const mandatoryFailure = rows.some((row) => row.mandatory && row.disposition === 'CONTRADICTED');
            const resolutionRequired = (businessSupported && technicalContradicted)
              || (businessContradicted && technicalSupported) || mandatoryFailure;
            const rationale = conflictRationale.value.trim();
            if (resolutionRequired && !rationale) { notify('Record a rationale for the conflict or mandatory failure.'); return; }
            submit.disabled = true;
            try {
              state.changeCase = await api(`/api/sdlc/cases/${current.id}/process-run-evidence-reviews`, { method: 'POST', body: JSON.stringify({
                version: current.version, draftRevision: current.artifacts.requirements.draftRevision,
                requirementId: requirement.id, linkId: link.id, criteria, idempotencyKey: uid('process-evidence-review'),
                ...(scenarioCases.length ? { scenarioCases } : {}),
                ...(resolutionRequired ? { conflictResolution: { decision: 'PRESERVE_CRITERION_OUTCOMES', rationale } } : {}),
              }) });
              await refreshCases(); renderCase();
              notify('Human review recorded. This does not verify truth or execute behavior; status remains NOT EXECUTED.');
            } catch (error) { submit.disabled = false; notify(error.message); await loadCase(state.changeCase.id); }
          });
          card.append(reviewForm);
        }
      }
      if (!baseline && state.authenticated) {
        const form = el('form', { className: 'requirement-edit-form process-run-evidence-link-form' }, [
          el('label', {}, [el('span', { text: 'Persisted execution run ID (workload)' }), el('input', { attrs: { name: 'runId', placeholder: 'execution-run-…' } })]),
          el('p', { text: 'Or select a completed human task; reported values remain HUMAN_REPORTED and NOT EXECUTED.' }),
          el('label', {}, [el('span', { text: 'Human task instance ID' }), el('input', { attrs: { name: 'planInstanceId', placeholder: 'UUID' } })]),
          el('label', {}, [el('span', { text: 'Human task ID' }), el('input', { attrs: { name: 'taskId', placeholder: 'task-…' } })]),
          el('button', { className: 'button secondary', text: 'Link runtime provenance', attrs: { type: 'submit' } }),
        ]);
        const linkFeedback = el('p', { className: 'process-run-evidence-feedback', attrs: {
          role: 'status', 'aria-live': 'polite', hidden: 'hidden',
        } });
        form.append(linkFeedback);
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          try {
            const current = state.changeCase;
            const runId = form.elements.runId.value.trim();
            const planInstanceId = form.elements.planInstanceId.value.trim();
            const taskId = form.elements.taskId.value.trim();
            const runMode = Boolean(runId) && !planInstanceId && !taskId;
            const humanMode = !runId && Boolean(planInstanceId) && Boolean(taskId);
            if (!runMode && !humanMode) throw new Error('Choose one workload run or one human task instance and task ID.');
            state.changeCase = await api(`/api/sdlc/cases/${current.id}/process-run-evidence`, { method: 'POST', body: JSON.stringify({
              version: current.version, draftRevision: current.artifacts.requirements.draftRevision, requirementId: requirement.id,
              ...(runMode ? { runId } : { planInstanceId, taskId }), idempotencyKey: uid('process-run-evidence'),
            }) });
            await refreshCases(); renderCase(); notify('Run provenance linked. Verification remains NOT EXECUTED.');
          } catch (error) {
            if (error.code === 'BEHAVIOR_CANDIDATE_REJECTED') {
              linkFeedback.textContent = `${error.message} Update the exact test so the named assertion passes, rerun the check, then link the new run.`;
              linkFeedback.hidden = false;
            } else {
              notify(error.message); await loadCase(state.changeCase.id);
            }
          }
        });
        card.append(form);
      }
      renderCriterionContractEditor(card, requirement);
      renderBehaviorTestPlanForm(card, requirement, artifact);
      renderProductHarnessMappings(card, requirement);
    }
    if (!baseline) {
      const disclosure = el('details', { className: 'requirement-edit-disclosure' });
      disclosure.append(el('summary', { text: `Edit ${requirement.id}` }));
      const form = el('form', { className: 'requirement-edit-form' });
      const statement = el('textarea', { attrs: { name: 'statement', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} statement` } }); statement.value = requirement.statement;
      const rationale = el('textarea', { attrs: { name: 'rationale', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} rationale` } }); rationale.value = requirement.rationale;
      const criteria = el('textarea', { attrs: { name: 'acceptanceCriteria', required: 'required', maxlength: '4000', 'aria-label': `${requirement.id} acceptance criteria` } }); criteria.value = requirement.acceptanceCriteria.join('\n');
      const actor = el('textarea', { attrs: { name: 'actor', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} actor` } }); actor.value = requirement.actor ?? '';
      const precondition = el('textarea', { attrs: { name: 'precondition', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} precondition` } }); precondition.value = requirement.precondition ?? '';
      const observableResult = el('textarea', { attrs: { name: 'observableResult', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} observable result` } }); observableResult.value = requirement.observableResult ?? '';
      const independentVerification = el('textarea', { attrs: { name: 'independentVerification', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} independent verification` } }); independentVerification.value = requirement.independentVerification ?? '';
      const owner = el('textarea', { attrs: { name: 'owner', required: 'required', maxlength: '500', 'aria-label': `${requirement.id} owner` } }); owner.value = requirement.owner ?? '';
      const priority = el('select', { attrs: { name: 'priority', 'aria-label': `${requirement.id} priority` } }, ['MUST', 'SHOULD'].map((value) => el('option', { text: value, attrs: { value } }))); priority.value = requirement.priority;
      const verificationMethod = el('select', { attrs: { name: 'verificationMethod', 'aria-label': `${requirement.id} verification method` } }, ['SCENARIO_AND_OUTCOME', 'AUTOMATED_TEST'].map((value) => el('option', { text: value, attrs: { value } }))); verificationMethod.value = requirement.verificationMethod;
      const save = el('button', { className: 'button', attrs: { type: 'submit' }, text: 'Save draft requirement' });
      form.append(
        el('label', {}, [el('span', { text: 'Statement' }), statement]),
        el('label', {}, [el('span', { text: requirement.processTrace ? 'Rationale · derived from the pinned saved process' : 'Rationale · synthetic template, review against pinned sources' }), rationale]),
        el('label', {}, [el('span', { text: 'Actor' }), actor]),
        el('label', {}, [el('span', { text: 'Precondition' }), precondition]),
        el('label', {}, [el('span', { text: 'Observable result' }), observableResult]),
        el('label', {}, [el('span', { text: 'Acceptance criteria, one per line' }), criteria]),
        el('label', {}, [el('span', { text: 'Independent verification' }), independentVerification]),
        el('label', {}, [el('span', { text: 'Requirement owner' }), owner]),
        el('label', {}, [el('span', { text: 'Priority' }), priority]),
        el('label', {}, [el('span', { text: 'Verification method' }), verificationMethod]), save);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        command('edit-requirements', { expectedDraftRevision: state.changeCase.artifacts.requirements.draftRevision, requirementId: requirement.id, changes: {
          statement: statement.value, rationale: rationale.value, actor: actor.value, precondition: precondition.value,
          observableResult: observableResult.value, independentVerification: independentVerification.value,
          owner: owner.value, priority: priority.value, verificationMethod: verificationMethod.value,
          acceptanceCriteria: criteria.value.split('\n').map((value) => value.trim()).filter(Boolean),
        } });
      });
      disclosure.append(form); card.append(disclosure);
    } else {
      card.append(el('p', { text: `Why: ${requirement.rationale}` }), el('p', { text: `Actor: ${requirement.actor} · Precondition: ${requirement.precondition}` }), el('p', { text: `Observable result: ${requirement.observableResult}` }), el('p', { text: `Verify: ${requirement.acceptanceCriteria.join(' · ')} · ${requirement.verificationMethod}` }), el('p', { text: `Independent verification: ${requirement.independentVerification}` }));
    }
    draft.append(card);
  }
  content.append(section('Traced requirements', draft));
  if (state.changeCase.sourceBinding && state.changeCase.processRequirementTrace && !baseline
    && state.changeCase.currentStage === 'S4' && state.authenticated
    && state.principal === state.changeCase.accountableOwner) {
    const trace = state.changeCase.processRequirementTrace;
    const traceReferences = [
      { id: trace.process.id, name: trace.process.name, kind: 'Process' },
      ...trace.process.inputs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'Input' })),
      ...trace.process.outputs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'Output' })),
      ...trace.scope.capabilityRefs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'Capability' })),
      ...trace.scope.systemRefs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'System' })),
      ...trace.scope.resourceRefs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'Resource' })),
      ...trace.risk.refs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'Risk' })),
      ...trace.outcome.metricRefs.map((entry) => ({ id: entry.id, name: entry.name, kind: 'Outcome metric' })),
    ].filter((entry, index, rows) => entry.id && rows.findIndex((candidate) => candidate.id === entry.id) === index);
    const defaultTraceRefIds = new Set([trace.process.id, ...trace.process.outputs.map((entry) => entry.id)]);
    const traceRefControls = traceReferences.map((entry) => el('label', { className: 'trace-reference-choice' }, [
      el('input', { attrs: { type: 'checkbox', name: 'traceRefIds', value: entry.id,
        checked: defaultTraceRefIds.has(entry.id) ? 'checked' : undefined } }),
      document.createTextNode(`${entry.kind}: ${entry.name} (${entry.id})`),
    ]));
    const addRequirementStatus = el('p', { attrs: { role: 'status', 'aria-live': 'polite', class: 'form-status' }, text: '' });
    const form = el('form', { className: 'add-saved-process-requirement-form' }, [
      el('p', { text: `Add another requirement from the pinned process ${trace.process.name} (${trace.source.processId}) at blueprint ${trace.source.blueprintId} v${trace.source.blueprintVersion}, source hash ${trace.source.processSnapshotHash}. Select relevant references from its saved trace. The server supplies the trace, source links, and verification contract; this owner-authored requirement starts DRAFT. Adding it advances the shared draft and makes existing plans require regeneration.` }),
      el('label', { text: 'Distinct requirement statement' }, el('textarea', { attrs: { name: 'statement', required: 'required', maxlength: '500' } })),
      el('label', { text: 'Rationale' }, el('textarea', { attrs: { name: 'rationale', required: 'required', maxlength: '500' } })),
      el('label', { text: 'Acceptance criteria, one per line' }, el('textarea', { attrs: { name: 'acceptanceCriteria', required: 'required', maxlength: '4000' } })),
      el('fieldset', { className: 'saved-process-trace-reference-list' }, [el('legend', { text: 'Relevant saved-process references' }), ...traceRefControls]),
      addRequirementStatus,
      el('button', { className: 'button secondary', text: 'Add requirement from this saved process', attrs: { type: 'submit' } }),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const current = state.changeCase;
      const formData = new FormData(form);
      const statement = String(formData.get('statement') ?? '').trim();
      const rationale = String(formData.get('rationale') ?? '').trim();
      const acceptanceCriteria = String(formData.get('acceptanceCriteria') ?? '').split('\n')
        .map((value) => value.trim()).filter(Boolean);
      const traceRefIds = formData.getAll('traceRefIds').map((value) => String(value));
      if (!statement || !rationale || !acceptanceCriteria.length || !traceRefIds.length) {
        addRequirementStatus.textContent = 'Enter a statement, rationale, one or more acceptance criteria, and select at least one saved-process reference.';
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const result = await api(`/api/sdlc/cases/${current.id}/add-requirement`, { method: 'POST', body: JSON.stringify({
          version: current.version, expectedDraftRevision: artifact.draftRevision,
          statement, rationale, acceptanceCriteria, traceRefIds, idempotencyKey: uid('add-saved-process-requirement'),
        }) });
        state.changeCase = result;
        await refreshCases(); renderCase();
        document.querySelector(`[data-requirement-id="${CSS.escape(result.command?.requirementId ?? result.events?.at(-1)?.data?.requirementId ?? '')}"]`)
          ?.scrollIntoView({ block: 'center' });
        notify('Requirement added from the pinned process trace as DRAFT. The shared draft advanced; older plans need regeneration.');
      } catch (error) {
        submit.disabled = false;
        addRequirementStatus.textContent = `${error.message} Your entries and selected references remain in the form. If the draft version changed, reload the case to review the new draft before retrying.`;
        notify(error.message);
      }
    });
    content.append(section('Add a requirement', form));
  }
  if (state.changeCase.sourceBinding && !baseline && state.changeCase.currentStage === 'S4') {
    const accept = el('button', { className: 'button button-primary', text: 'Accept requirements and pass G4', attrs: { type: 'button' } });
    accept.addEventListener('click', () => command('accept-requirements', { expectedDraftRevision: artifact.draftRevision, actor: state.authenticated ? undefined : state.changeCase.accountableOwner }));
    content.append(section('Owner decision', el('div', {}, [el('p', { text: 'Acceptance freezes the current requirements, intent and saved-design source hashes. Architecture and planning use this accepted baseline.' }), accept])));
  }
}

function renderProofs(content) {
  const c = state.changeCase;
  const proofs = caseUiModel(c, state.meta).proofs;
  const assessment = c.proofs.assessments.findLast((entry) => entry.intentRevision === c.intent.revision);
  if (assessment) {
    content.append(section('Current acceptance', el('div', { className: `acceptance-card phase-${assessment.phase}` }, [
      el('strong', { text: assessment.phase }),
      el('p', { text: assessment.explanation }),
      el('span', { text: `${assessment.coverage.passed}/${assessment.coverage.required} required proofs passing` }),
    ])));
  }
  const cards = el('div', { className: 'proof-list' });
  for (const proof of proofs) {
    const result = proof.result;
    const card = el('article', { className: 'proof-card' }, [
      el('header', {}, [el('strong', { text: proof.criterion }), el('span', { text: proof.resultStatus })]),
      el('p', { text: `${proof.required ? 'Required' : 'Optional'} · ${proof.evaluatorType} · intent v${proof.intentRevision}` }),
      el('p', { className: 'proof-loop-counter', text: `${proof.attempts}/${proof.attemptLimit} bounded actions started` }),
    ]);
    if (result) {
      card.append(el('blockquote', { text: result.summary }));
      if (result.observations.length) card.append(el('ul', {}, result.observations.map((value) => el('li', { text: value }))));
      const proofAction = proof.action;
      if (proofAction) {
        const actionPanel = el('div', { className: 'proof-action' }, [
          el('strong', { text: `${proofAction.action} · ${proofAction.status}` }),
          el('p', { text: `${proofAction.reason} Destination: ${proofAction.destination}; owner: ${proofAction.owner}.` }),
          el('small', { text: 'The source result remains in proof history.' }),
        ]);
        if (proof.control === 'RESUME') {
          const resumeButton = el('button', { className: 'button primary', text: 'Resume pending action', attrs: { type: 'button' } });
          resumeButton.addEventListener('click', () => command('resume-proof-action', { actor: proofAction.owner, actionRef: proofAction.id }));
          actionPanel.append(resumeButton);
        } else if (proof.control === 'COMPLETE') {
          const completionForm = el('form', { className: 'proof-completion-form' }, [
            el('select', { attrs: { name: 'outcome', 'aria-label': 'Action outcome' } }, [
              el('option', { text: 'Succeeded', attrs: { value: 'SUCCEEDED' } }),
              el('option', { text: 'Failed', attrs: { value: 'FAILED' } }),
            ]),
            el('input', { attrs: { name: 'summary', required: '', placeholder: 'What did this action produce?' } }),
            el('button', { className: 'button primary', text: 'Complete action', attrs: { type: 'submit' } }),
          ]);
          completionForm.addEventListener('submit', (event) => {
            event.preventDefault();
            command('complete-proof-action', {
              actor: proofAction.owner, actionRef: proofAction.id,
              outcome: event.currentTarget.elements.outcome.value,
              summary: event.currentTarget.elements.summary.value,
            });
          });
          actionPanel.append(completionForm);
        } else if (proofAction.completionSummary) {
          actionPanel.append(el('p', { text: proofAction.completionSummary }));
        }
        card.append(actionPanel);
      } else if (proof.control === 'ROUTE') {
        const routeForm = el('form', { className: 'proof-route-form' }, [
          el('select', { attrs: { name: 'action', 'aria-label': 'Next bounded action' } }, [
            ...proof.routeChoices.map(([value, label]) => el('option', { text: label, attrs: { value } })),
          ]),
          el('input', { attrs: { name: 'reason', required: '', placeholder: 'Why is this the safe next action?' } }),
          el('button', { className: 'button ghost', text: 'Route result', attrs: { type: 'submit' } }),
        ]);
        routeForm.addEventListener('submit', (event) => {
          event.preventDefault();
          const action = event.currentTarget.elements.action.value;
          command('route-proof', {
            actor: action === 'STOP' ? c.accountableOwner : 'studio-operator',
            proofRef: proof.id, resultRef: result.id, action,
            reason: event.currentTarget.elements.reason.value,
          });
        });
        card.append(routeForm);
      }
      if (proof.history.length) {
        const history = el('div', { className: 'proof-history' }, [el('h4', { text: 'Prior results' })]);
        for (const priorResult of proof.history) {
          const priorAction = priorResult.action;
          history.append(el('article', { className: 'proof-history-entry' }, [
            el('header', {}, [el('strong', { text: priorResult.status }), el('span', { text: new Date(priorResult.recordedAt).toLocaleString() })]),
            el('p', { text: priorResult.summary }),
            priorAction ? el('small', { text: `${priorAction.action} → ${priorAction.destination} · ${priorAction.status}` }) : null,
          ]));
        }
        card.append(history);
      }
    }
    if (proof.control === 'RECORD_RESULT') {
      const resultForm = el('form', { className: 'proof-result-form' }, [
        el('select', { attrs: { name: 'status' } }, ['PASS', 'FAIL', 'INDETERMINATE', 'ERROR'].map((value) => el('option', { text: value, attrs: { value } }))),
        el('input', { attrs: { name: 'summary', required: '', placeholder: 'What actually happened?' } }),
        el('input', { attrs: { name: 'observation', placeholder: 'Concrete observation (required for pass)' } }),
        el('button', { className: 'button ghost', text: 'Record result', attrs: { type: 'submit' } }),
      ]);
      resultForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const observation = event.currentTarget.elements.observation.value.trim();
        command('record-proof', {
          proofRef: proof.id,
          status: event.currentTarget.elements.status.value,
          summary: event.currentTarget.elements.summary.value,
          observations: observation ? [observation] : [],
          evaluator: 'studio-operator',
        });
      });
      card.append(resultForm);
    }
    cards.append(card);
  }
  content.append(section('Proof obligations', cards.childNodes.length ? cards : empty('No proof obligations exist for the current intent revision.')));

  const registerForm = el('form', { className: 'proof-register-form' }, [
    el('input', { attrs: { name: 'criterion', required: '', placeholder: 'Observable criterion' } }),
    el('select', { attrs: { name: 'evaluatorType' } }, ['DETERMINISTIC', 'HUMAN', 'OBSERVATION'].map((value) => el('option', { text: value, attrs: { value } }))),
    el('button', { className: 'button ghost', text: 'Add required proof', attrs: { type: 'submit' } }),
  ]);
  registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    command('register-proof', { targetRef: c.intent.id, criterion: event.currentTarget.elements.criterion.value, evaluatorType: event.currentTarget.elements.evaluatorType.value, required: true });
  });
  const assessButton = el('button', { className: 'button primary', text: 'Assess current intent', attrs: { type: 'button' } });
  assessButton.addEventListener('click', () => command('assess-proofs'));
  content.append(section('Add and assess', [registerForm, assessButton]));
}

function renderArchitecture(content) {
  const artifact = state.changeCase.artifacts.architecture;
  if (!artifact) return content.append(empty('Architecture is created after requirements quality passes.'));
  if (state.changeCase.sourceBinding && artifact.options?.length) {
    const accepted = artifact.acceptedBaseline;
    const review = el('div', { className: 'architecture-options' });
    for (const option of artifact.options) {
      const disclosure = el('details', { className: 'architecture-option' });
      disclosure.append(el('summary', { text: `${option.id} · ${option.name}${option.id === artifact.selectedOptionId ? ' · selected' : ''}` }));
      disclosure.append(el('p', { text: option.summary }));
      disclosure.append(el('p', { text: `Tradeoffs: ${option.tradeoffs.join(' · ')}` }));
      disclosure.append(el('p', { text: `Interfaces: ${option.interfaces.join(' · ')}` }));
      disclosure.append(el('p', { text: `Data ownership: ${option.dataOwnership}` }));
      disclosure.append(el('p', { text: `Dependencies: ${option.dependencies.join(' · ')}` }));
      disclosure.append(el('ol', {}, option.migration.map((step) => el('li', { text: `${step.step}. ${step.action} Health: ${step.healthCheck}` }))));
      disclosure.append(el('p', { text: `Health criteria: ${option.healthCriteria.join(' · ')}` }));
      disclosure.append(el('p', { text: `Rollback / forward recovery: ${option.rollbackForwardRecovery}` }));
      if (!accepted && state.changeCase.currentStage === 'S5') {
        const form = el('form', { className: 'architecture-option-form' });
        const summary = el('textarea', { attrs: { required: 'required', maxlength: '1000', 'aria-label': `${option.id} summary` } }); summary.value = option.summary;
        const tradeoffs = el('textarea', { attrs: { required: 'required', 'aria-label': `${option.id} tradeoffs, one per line` } }); tradeoffs.value = option.tradeoffs.join('\n');
        const interfaces = el('textarea', { attrs: { required: 'required', 'aria-label': `${option.id} interfaces, one per line` } }); interfaces.value = option.interfaces.join('\n');
        const ownership = el('textarea', { attrs: { required: 'required', maxlength: '1000', 'aria-label': `${option.id} data ownership` } }); ownership.value = option.dataOwnership;
        const dependencies = el('textarea', { attrs: { required: 'required', 'aria-label': `${option.id} dependencies, one per line` } }); dependencies.value = option.dependencies.join('\n');
        const migration = el('textarea', { attrs: { required: 'required', 'aria-label': `${option.id} ordered migration steps; use step | action | health check per line` } }); migration.value = option.migration.map((step) => `${step.step} | ${step.action} | ${step.healthCheck}`).join('\n');
        const health = el('textarea', { attrs: { required: 'required', 'aria-label': `${option.id} health criteria, one per line` } }); health.value = option.healthCriteria.join('\n');
        const recovery = el('textarea', { attrs: { required: 'required', maxlength: '1000', 'aria-label': `${option.id} rollback and forward recovery` } }); recovery.value = option.rollbackForwardRecovery;
        const field = (label, control) => el('label', {}, [el('span', { text: label }), control]);
        form.append(field('Summary', summary), field('Tradeoffs', tradeoffs), field('Interfaces', interfaces), field('Data ownership', ownership), field('Dependencies', dependencies), field('Ordered migration (step | action | health check)', migration), field('Health criteria', health), field('Rollback / forward recovery', recovery));
        form.append(el('button', { className: 'button', attrs: { type: 'submit' }, text: `Save ${option.id}` }));
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const rows = (value) => value.split('\n').map((entry) => entry.trim()).filter(Boolean);
          const migrationRows = rows(migration.value).map((line) => { const [step, action, healthCheck] = line.split('|').map((entry) => entry.trim()); return { step: Number(step), action, healthCheck }; });
          command('edit-architecture', { expectedDraftRevision: state.changeCase.artifacts.architecture.draftRevision, optionId: option.id, changes: {
            summary: summary.value, tradeoffs: rows(tradeoffs.value), interfaces: rows(interfaces.value), dataOwnership: ownership.value,
            dependencies: rows(dependencies.value), migration: migrationRows, healthCriteria: rows(health.value), rollbackForwardRecovery: recovery.value,
          } });
        });
        disclosure.append(form);
      }
      review.append(disclosure);
    }
    content.append(section('Comparable target architecture alternatives', [
      el('p', { text: 'These are draft options for the accepted requirements and pinned saved design. Review interfaces, ownership, dependencies, migration health checks and recovery before choosing.' }), review,
    ]));
    if (!accepted && state.changeCase.currentStage === 'S5') {
      const form = el('form', { className: 'architecture-selection-form' });
      const selected = el('select', { attrs: { 'aria-label': 'Selected architecture option' } }, artifact.options.map((option) => el('option', { text: `${option.id} · ${option.name}`, attrs: { value: option.id } }))); selected.value = artifact.selectedOptionId;
      const rationale = el('textarea', { attrs: { required: 'required', maxlength: '1000', 'aria-label': 'Architecture selection rationale' } }); rationale.value = artifact.selectionRationale;
      form.append(el('label', {}, [el('span', { text: 'Selected option' }), selected]), el('label', {}, [el('span', { text: 'Why this option fits' }), rationale]));
      form.append(el('button', { className: 'button', attrs: { type: 'submit' }, text: 'Save selection and rationale' }));
      form.addEventListener('submit', (event) => { event.preventDefault(); command('edit-architecture', { expectedDraftRevision: state.changeCase.artifacts.architecture.draftRevision, changes: { selectedOptionId: selected.value, selectionRationale: rationale.value } }); });
      const ownerDecision = el('div', {}, [form, el('p', { text: `Draft revision ${artifact.draftRevision} · structural findings ${artifact.validationFindings?.length ?? 0} · canonical draft hash ${artifact.draftHash}` }), el('p', { text: 'G5 remains pending until the case owner explicitly accepts this exact validated architecture baseline.' })]);
      const accept = el('button', { className: 'button button-primary', attrs: { type: 'button' }, text: 'Accept architecture and pass G5' });
      accept.addEventListener('click', () => command('accept-architecture', { expectedDraftRevision: artifact.draftRevision, actor: state.authenticated ? undefined : state.changeCase.accountableOwner }));
      ownerDecision.append(accept);
      if (artifact.validationFindings?.length) ownerDecision.append(el('ul', { className: 'architecture-findings' }, artifact.validationFindings.map((entry) => el('li', { text: `${entry.code}: ${entry.message}` }))));
      content.append(section('Owner review and acceptance', ownerDecision));
    } else if (accepted) {
      content.append(section('Accepted architecture baseline', el('p', { text: `Version ${accepted.version} · revision ${accepted.draftRevision} · selected ${accepted.selectedOptionId} · hash ${accepted.draftHash} · requirements ${accepted.requirementsBaselineHash} · saved source ${accepted.sourceHash}` })));
    }
    if (!accepted) return;
  }
  const flows = artifact.change.dataFlows.map((flow) => el('div', { className: 'flow-row' }, [el('b', { text: flow.mechanism }), el('span', { text: `${flow.from} → ${flow.to} · ${flow.data}` })]));
  content.append(section('Baseline → target data flows', flows));
  content.append(section('Architecture fitness', el('div', { className: 'fitness-list' }, artifact.fitnessResults.map((entry) => el('span', { className: `fitness ${entry.status}`, text: `${entry.status} · ${entry.name}` })))));
  const migration = Array.isArray(artifact.change.migration)
    ? el('ol', {}, artifact.change.migration.map((step) => el('li', { text: `${step.step}. ${step.action} Health: ${step.healthCheck}` })))
    : el('p', { text: artifact.change.migration });
  content.append(section('Migration and rollback', [migration, el('p', { text: artifact.change.rollback })]));
}

function renderDelivery(content) {
  const plan = state.changeCase.artifacts.plan;
  if (!plan) return content.append(empty('Delivery planning starts after architecture conformance.'));
  content.append(section('Proposed work order', [el('p', { text: 'Proposal from the accepted G6 graph. This view does not authorize execution.' }), ...plan.workItems.map((work) => el('div', { className: 'work-row' }, [el('b', { text: work.id }), el('span', { text: `${work.objective} · depends on ${work.dependencies.join(', ') || 'nothing'} · ${work.requirementRefs.length} requirements` })]))]));
  const changeCase = state.changeCase;
  const project = state.projects.find((entry) => entry.id === changeCase.projectId);
  const draftEntry = state.softwareDeliveryPlans.find((entry) => entry.valid && entry.plan.compilerVersion === 't28-g6-software-delivery-v2');
  const currentDraft = draftEntry?.plan;
  if (changeCase.sourceBinding && state.authenticated && state.principal === changeCase.accountableOwner) {
    if (currentDraft) {
      const sourceIsCurrent = draftEntry.sourceCurrentness?.status === 'CURRENT';
      const review = draftEntry.assignmentReview;
      const humanAssignments = Boolean(review?.assignments?.length === currentDraft.tasks.length
        && review.assignments.every((item) => item.assignee?.actorType === 'human' && item.assignee?.principal
          && Number.isSafeInteger(item.assignee.membershipGeneration) && Number.isSafeInteger(item.assignee.authzGeneration)));
      const promotedCurrentReview = draftEntry.promotion?.reviewRevision === review?.revision;
      content.append(section('Owner review of software delivery draft', [
      ...(!sourceIsCurrent ? [el('p', { className: 'draft-state source-stale', attrs: { role: 'status', 'data-source-currentness': draftEntry.sourceCurrentness?.status ?? 'UNKNOWN' },
        text: draftEntry.sourceCurrentness?.status === 'STALE'
          ? `SOURCE STALE · This saved draft remains available as history, pinned to project v${draftEntry.sourceCurrentness.pinnedProjectVersion} and blueprint ${draftEntry.sourceCurrentness.pinnedBlueprintId} v${draftEntry.sourceCurrentness.pinnedBlueprintVersion}; current project v${draftEntry.sourceCurrentness.currentProjectVersion}, blueprint ${draftEntry.sourceCurrentness.currentBlueprintId ?? 'unavailable'} v${draftEntry.sourceCurrentness.currentBlueprintVersion ?? 'unavailable'}. Create a new governed case from the current design before assigning or promoting work.`
          : 'SOURCE CURRENTNESS UNKNOWN · This saved draft is read-only until its exact saved-design source can be verified.' })] : []),
      el('p', { className: 'draft-state', text: draftEntry.promotion
        ? `OWNER PROMOTED · Immutable human checkpoint revision ${draftEntry.promotion.runtimeRevision} · snapshot ${draftEntry.promotion.snapshotHash}. Starting a separate instance creates planned checkpoints only.`
        : review
          ? `OWNER REVIEWED · Revision ${review.revision} · Snapshot only; not executable until promoted.`
        : 'PROPOSED DRAFT · No owner-reviewed assignment snapshot yet. This work is not executable; no plan promotion, approval, runtime, or dispatch.' }),
      el('p', { text: `Plan ${currentDraft.id} · compiler ${currentDraft.compilerVersion} · source ${currentDraft.binding.sourceHash} · G4 ${currentDraft.binding.requirementsBaselineHash} · G5 ${currentDraft.binding.architectureBaselineHash} · G6 ${currentDraft.binding.g6PlanHash}` }),
      ...(sourceIsCurrent ? [(() => {
        const form = el('form', { className: 'assignment-review-form' });
        const hasHumanBinding = state.actorBindings.some((binding) => binding.targetType === 'human');
        form.append(el('p', { text: draftEntry.assignmentReview
          ? 'Revise the proposed assignment snapshot. Previous owner review revisions remain saved; this review does not start work.'
          : 'Assign every proposed task to an existing enabled human or agent binding. Saving records an owner review snapshot only.' }));
        const taskById = new Map(currentDraft.tasks.map((task) => [task.id, task]));
        for (const task of currentDraft.tasks) {
          const dependencies = task.dependencies.map((dependencyId) => taskById.get(dependencyId)?.g6WorkItemId ?? 'unresolved dependency');
          const select = el('select', { attrs: { name: `task:${task.id}`, required: 'required' } });
          select.append(el('option', { text: 'Choose an enabled binding', attrs: { value: '' } }));
          const priorAssignment = draftEntry.assignmentReview?.assignments?.find((item) => item.taskId === task.id)?.assignee;
          for (const binding of state.actorBindings) {
            const type = binding.targetType === 'human' ? 'Human' : 'Agent';
            const label = `${binding.actorName} (${type}) · ${binding.roleName} · ${binding.targetName}`;
            const attrs = { value: JSON.stringify({ actorId: binding.actorId, roleId: binding.roleId, targetPrincipal: binding.targetPrincipal }) };
            if (priorAssignment?.actorId === binding.actorId && priorAssignment?.roleId === binding.roleId
              && priorAssignment?.principal === binding.targetPrincipal) attrs.selected = 'selected';
            select.append(el('option', { text: label, attrs }));
          }
          form.append(el('label', { className: 'work-row' }, [el('span', {}, [el('b', { text: task.g6WorkItemId }), el('small', { text: `${task.title} · depends on ${dependencies.join(', ') || 'nothing'}` })]), select]));
        }
        const submitAttrs = { type: 'submit' };
        if (!state.actorBindings.length) submitAttrs.disabled = 'disabled';
        const submit = el('button', { className: 'button primary', text: draftEntry.assignmentReview ? 'Save revised owner review snapshot' : 'Save owner review snapshot', attrs: submitAttrs });
        form.append(submit);
        form.addEventListener('submit', (event) => { event.preventDefault(); saveSoftwarePlanAssignments(form, currentDraft, draftEntry); });
        if (!hasHumanBinding) form.append(el('p', { className: 'muted assignment-enrollment-guidance' }, [
          el('span', { text: 'No eligible human actor binding is enabled for this blueprint. Have the colleague sign in if needed and add their verified identity to this project’s membership. In the map, choose the correct human actor and role, then propose and enable its binding. Enabling or revising a binding changes the project revision; create a new governed change case from the updated design before compiling.' }),
          el('a', { text: 'Open this project’s Enterprise design map', attrs: { href: encodeStudioRoute({ projectId: changeCase.projectId, view: 'map' }) } }),
          el('a', { text: 'Open Administration: Identity access and Project access', attrs: { href: '/platform.html#administration' } }),
        ]));
        return form;
      })()] : []),
      ...(review && !humanAssignments ? [el('p', { className: 'muted', text: 'Promotion is unavailable: every task must have an exact, current human assignee. Agent tasks need the separate PR-08 software output contract.' })] : []),
      ...(sourceIsCurrent && review && humanAssignments && !promotedCurrentReview ? [(() => {
        const button = el('button', { className: 'button primary', text: draftEntry.promotion ? 'Promote revised human plan' : 'Promote human checkpoint plan', attrs: { type: 'button' } });
        button.addEventListener('click', () => promoteSoftwarePlan(button, draftEntry)); return button;
      })()] : []),
      ...(sourceIsCurrent && draftEntry.promotion ? [(() => {
        const button = el('button', { className: 'button', text: `Start human checkpoint instance · revision ${draftEntry.promotion.runtimeRevision}`, attrs: { type: 'button' } });
        button.addEventListener('click', () => startSoftwarePlanInstance(button, draftEntry)); return button;
      })()] : []),
      ...(() => {
        const taskById = new Map(currentDraft.tasks.map((task) => [task.id, task]));
        return currentDraft.tasks.map((task) => {
          const dependencies = task.dependencies.map((dependencyId) => taskById.get(dependencyId)?.g6WorkItemId ?? 'unresolved dependency');
          const assignment = draftEntry.assignmentReview?.assignments?.find((item) => item.taskId === task.id);
          const assignee = assignment ? `${assignment.assignee.actorName} (${assignment.assignee.actorType === 'human' ? 'Human' : 'Agent'}) · ${assignment.assignee.roleName} · ${assignment.assignee.assigneeName}` : 'No owner-reviewed assignment';
          return el('div', { className: 'work-row' }, [
            el('b', { text: task.g6WorkItemId, attrs: { title: `Engine task ID ${task.id}`, 'aria-label': `${task.g6WorkItemId}; engine task ID ${task.id}` } }),
            el('span', { text: `${task.title} · ${assignee} · depends on ${dependencies.join(', ') || 'nothing'}` }),
          ]);
        });
      })(),
    ]));
    }
    else if (project && changeCase.gateHistory.some((gate) => gate.gate === 'G6' && gate.status === 'PASSED')) {
      const button = el('button', { className: 'button primary', text: 'Compile software delivery draft', attrs: { type: 'button' } });
      button.addEventListener('click', () => compileSoftwarePlan(button));
      content.append(section('Compile shared engine plan', [el('p', { text: 'Creates a saved, reviewable DRAFT from the accepted G6 work graph. It will not run tasks.' }), button]));
    }
  }
  const implementation = state.changeCase.artifacts.implementation;
  if (implementation) content.append(section('Reference coding adapter', [el('p', { text: `${implementation.artifact.adapter.implementation} produced ${implementation.artifact.files.length} versioned files on ${implementation.artifact.branch}.` }), el('p', { text: `Artifact ${implementation.artifact.contentHash.slice(0, 20)}… · ${implementation.checks.filter((entry) => entry.status === 'PASS').length}/${implementation.checks.length} checks passed.` })]));
}

function renderAssurance(content) {
  const assurance = state.changeCase.artifacts.assurance;
  if (!assurance) return content.append(empty('Multidimensional assurance runs after implementation verification.'));
  content.append(section('Assurance matrix', table(['Dimension', 'Status', 'Rationale'], assurance.matrix.map((entry) => [entry.dimension, [el('span', { className: `status-${entry.status}`, text: entry.status.replace('_', ' ') })], entry.rationale]))));
  const authority = state.changeCase.artifacts.authority;
  if (authority) content.append(section('Authority decision', el('div', { className: `gate-card ${authority.decision === 'ALLOW' ? 'PASSED' : 'NEEDS_HUMAN'}` }, [el('header', {}, [el('h4', { text: 'principal × action × asset × risk × environment' }), el('span', { text: authority.decision.replaceAll('_', ' ') })]), el('p', { text: `${authority.request.principal} requests ${authority.request.action} on ${authority.request.asset} in ${authority.request.environment} at ${authority.request.risk} risk.` })])));
  if (state.changeCase.artifacts.outcome) {
    const outcome = state.changeCase.artifacts.outcome;
    content.append(section('Outcome evaluation', el('div', { className: 'metric-grid' }, [metric(outcome.technicalOutcome, 'Technical'), metric(outcome.controlOutcome, 'Control'), metric(outcome.businessOutcome, 'Business'), metric(outcome.observedMeasures.manualWorkReduction + '%', 'Manual-work reduction')])));
  }
}

function renderEvidence(content) {
  const c = state.changeCase;
  content.append(section('Evidence integrity', el('p', { text: `${c.evidenceIntegrity.filter((entry) => entry.valid).length}/${c.evidenceIntegrity.length} evidence hashes verified. No hidden chat history is required to reconstruct the case.` })));
  content.append(section('Append-oriented event ledger', c.events.slice().reverse().map((event) => el('div', { className: 'timeline-row' }, [el('b', { text: event.type }), el('span', { text: `${new Date(event.timestamp).toLocaleString()} · ${event.actor} · ${event.contentHash.slice(0, 14)}…` })]))));
}

function renderCheckpoint() {
  const panel = document.querySelector('#checkpoint-panel'); const c = state.changeCase;
  const checkpoint = caseUiModel(c, state.meta).checkpoint;
  panel.replaceChildren(el('h3', { text: 'Control point' }));
  if (c.status === 'STOPPED') {
    panel.append(el('div', { className: 'checkpoint-callout' }, [
      el('b', { text: checkpoint.title }),
      el('p', { text: checkpoint.body }),
      el('p', { text: 'No further changes can run. The proof result and stop decision remain saved for review.' }),
    ])); return;
  }
  if (c.status === 'BLOCKED' || c.status === 'FAILED') {
    panel.append(el('div', { className: 'checkpoint-callout' }, [el('b', { text: checkpoint.title }), el('p', { text: checkpoint.body }), el('p', { text: checkpoint.remediation })])); return;
  }
  panel.append(el('div', { className: 'checkpoint-callout' }, [el('b', { text: checkpoint.title }), el('p', { text: checkpoint.body })]));
  if (checkpoint.control === 'APPROVE_RELEASE') {
    const button = el('button', { className: 'button primary', text: 'Approve as human governor', attrs: { type: 'button' } });
    button.addEventListener('click', () => command('approve', state.authenticated ? {} : { principal: 'actor-accountable-owner', roles: ['release-approver', 'control-owner'] })); panel.append(button); return;
  }
  if (checkpoint.control === 'RECORD_OBSERVATION') {
    const form = el('form', { className: 'observation-form' }, [
      el('label', { text: 'Manual-work reduction (%)' }, el('input', { attrs: { name: 'manual', type: 'number', value: '35', min: '0', max: '100' } })),
      el('label', { text: 'Control exceptions' }, el('input', { attrs: { name: 'control', type: 'number', value: '0', min: '0' } })),
      el('button', { className: 'button primary', text: 'Record outcome', attrs: { type: 'submit' } }),
    ]);
    form.addEventListener('submit', (event) => { event.preventDefault(); command('observe', { signals: { technicalHealthy: true, manualWorkReduction: Number(event.currentTarget.elements.manual.value), controlExceptions: Number(event.currentTarget.elements.control.value) } }); }); panel.append(form); return;
  }
  if (checkpoint.control === 'NONE') return;
  panel.append(el('p', { text: `Mutation: ${c.mutationLabel}. Version ${c.version}; every command is idempotent and concurrency checked.` }));
}

document.querySelector('#new-case').addEventListener('click', showWelcome);

try {
  const [meta, projectResult, session] = await Promise.all([api('/api/sdlc/meta'), api('/api/v1/projects'), api('/auth/session')]);
  state.meta = meta; state.projects = projectResult.data; state.authenticated = session.authenticated; state.principal = session.principal ?? null;
  state.tenantId = session.tenantId ?? session.tenant ?? ''; state.sessionId = session.sessionId ?? '';
  await refreshCases();
  await openInitialCase({ search: window.location.search, cases: state.cases, projects: state.projects, loadCase, showWelcome, notify });
} catch (error) { notify(error.message); }
