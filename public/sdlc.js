import { caseUiModel, createSourceSelectionGuard } from './sdlc-view.mjs';
import { encodeExecutionRoute } from './shared-interactions.mjs';
import { clearPendingSoftwareStart, createSoftwareStartFlightGuard, pendingSoftwareStartKey } from './software-runtime-start.mjs';

const state = { meta: null, projects: [], sourceProject: null, activeSourceProject: null, sourceSelectionGuard: createSourceSelectionGuard(), cases: [], changeCase: null, softwareDeliveryPlans: [], actorBindings: [], tab: 'overview', authenticated: false, principal: null, tenantId: '', sessionId: '' };
const softwareStartFlights = createSoftwareStartFlightGuard();
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
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Request failed.');
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

function showWelcome() {
  state.changeCase = null; state.tab = 'overview';
  app.replaceChildren(document.querySelector('#sdlc-welcome').content.cloneNode(true));
  const select = document.querySelector('#mutation-select');
  for (const [value, entry] of Object.entries(state.meta.mutations)) select.append(el('option', { text: entry.label, attrs: { value } }));
  const projectSelect = document.querySelector('#case-project');
  for (const project of state.projects) projectSelect.append(el('option', { text: project.name, attrs: { value: project.id } }));
  if (!state.projects.length) document.querySelector('#case-form button[type="submit"]').disabled = true;
  projectSelect.addEventListener('change', () => loadSourceProject(projectSelect.value));
  select.addEventListener('change', renderMutationExpectation);
  document.querySelector('#case-form').addEventListener('submit', createCase);
  if (state.projects.length) loadSourceProject(projectSelect.value);
  renderMutationExpectation(); renderCaseList();
}

async function loadSourceProject(projectId) {
  const ticket = state.sourceSelectionGuard.begin(projectId);
  const objectSelect = document.querySelector('#case-source-object');
  const preview = document.querySelector('#source-preview');
  const submitButton = document.querySelector('#case-form button[type="submit"]');
  submitButton.disabled = true;
  preview.textContent = 'Loading the selected project’s current saved design…';
  objectSelect.replaceChildren(); state.sourceProject = null;
  try {
    const projectResult = await api(`/api/v1/projects/${encodeURIComponent(projectId)}`);
    const project = projectResult.data;
    if (!state.sourceSelectionGuard.isCurrent(ticket, document.querySelector('#case-project')?.value ?? null)) return;
    state.sourceProject = project;
    const objects = Object.values(project.latestBlueprint?.areas ?? {}).flatMap((area) => area.items ?? []);
    for (const object of objects) objectSelect.append(el('option', { text: `${object.name} · ${object.type}`, attrs: { value: object.id } }));
    if (!objects.length) {
      objectSelect.append(el('option', { text: 'No saved blueprint objects', attrs: { value: '' } }));
      submitButton.disabled = true;
      preview.textContent = 'This project has no saved blueprint objects yet.';
    } else {
      submitButton.disabled = false;
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
  document.querySelector('#source-preview').textContent = item
    ? `Current saved source · ${item.name} (${item.type}) · project v${project.version} · blueprint ${project.latestBlueprint.id} v${project.latestBlueprint.version}. ${item.detail}`
    : 'Select a project object from its current saved blueprint.';
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
  try {
    const project = state.sourceProject;
    if (!project?.latestBlueprint) throw new Error('Choose a project with a saved blueprint before creating a change case.');
    const selectedObjectId = form.elements.sourceObjectId.value;
    const sourceExists = Object.values(project.latestBlueprint.areas ?? {}).flatMap((area) => area.items ?? []).some((item) => item.id === selectedObjectId);
    if (project.id !== form.elements.projectId.value || !sourceExists) {
      throw new Error('The selected project or design object changed while loading. Select the source again.');
    }
    state.changeCase = await api('/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
      mode: 'golden', projectId: project.id, sourceObjectId: selectedObjectId,
      expectedProjectVersion: project.version, expectedBlueprintId: project.latestBlueprint.id,
      expectedBlueprintVersion: project.latestBlueprint.version, rawIntent: form.elements.rawIntent.value,
      mutation: form.elements.mutation.value,
    }) });
    state.activeSourceProject = project;
    await refreshCases(); renderCase(); notify('Governed change case created.');
  } catch (error) {
    notify(error.message);
    form.elements.projectId.disabled = false;
    form.elements.sourceObjectId.disabled = false;
    button.disabled = !(state.sourceProject?.id === submittedProjectId && form.elements.projectId.value === submittedProjectId);
  }
}

async function loadCase(id) {
  try {
    const [changeCase, projectResult] = await Promise.all([api(`/api/sdlc/cases/${id}`), api('/api/v1/projects')]);
    state.changeCase = changeCase; state.projects = projectResult.data; state.activeSourceProject = null; state.softwareDeliveryPlans = []; state.actorBindings = []; state.tab = 'overview';
    if (changeCase.sourceBinding) {
      try {
        const detail = await api(`/api/v1/projects/${encodeURIComponent(changeCase.projectId)}`);
        if (detail.data?.id === changeCase.projectId) state.activeSourceProject = detail.data;
      } catch { state.activeSourceProject = null; }
    }
    if (state.authenticated && changeCase.sourceBinding && changeCase.artifacts.plan) {
      try { state.softwareDeliveryPlans = (await api(`/api/sdlc/cases/${id}/software-delivery-plans`)).plans; }
      catch { state.softwareDeliveryPlans = []; }
      try {
        const bindings = await api(`/api/v1/projects/${encodeURIComponent(changeCase.projectId)}/actor-bindings/proposals`);
        state.actorBindings = bindings.proposals.filter((entry) => entry.status === 'enabled' && entry.eligibilityStatus.includes('eligible') && entry.blueprintVersion === changeCase.sourceBinding.blueprintVersion);
      } catch { state.actorBindings = []; }
    }
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
    const result = await api(`/api/sdlc/cases/${changeCase.id}/compile-software-plan`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedProjectVersion: project.version, idempotencyKey: uid('compile-software-plan') }),
    });
    state.softwareDeliveryPlans = [{ plan: result.plan, valid: true, assignmentReview: null }];
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
  content.append(section('Context coverage matrix', context.coverage.map((entry) => el('div', { className: 'coverage-row' }, [el('b', { text: entry.domain }), el('div', { className: 'coverage-track' }, [el('i', { className: entry.score >= 1 ? 'coverage-full' : 'coverage-empty' })]), el('span', { className: entry.status === 'PASSED' ? 'status-PASS' : 'status-FAIL', text: `${Math.round(entry.score * 100)}%` })]))));
  content.append(section('Provenance manifest', [el('p', { text: `${context.evidenceRefs.length} evidence references · immutable manifest ${context.provenanceManifestHash.slice(0, 18)}…` }), el('p', { text: 'Authoritative, approved, informative, and untrusted sources remain distinguishable. Untrusted content never becomes instruction.' })]));
  const binding = caseUiModel(state.changeCase, state.meta, state.activeSourceProject).sourceBinding;
  if (binding) {
    if (!state.changeCase.sourceBindingIntegrity?.valid) {
      content.append(section('Saved-design source integrity failure', [
        el('p', { text: 'The stored pin does not match its recorded snapshot and cannot be trusted or used to continue this case.' }),
        el('p', { text: 'This case is read-only. Create a new case from a verified current saved design.' }),
      ]));
      return;
    }
    content.append(section('Pinned saved-design evidence', [
      el('p', { text: `${binding.snapshot.name} · ${binding.objectType} · ${binding.snapshot.detail}` }),
      el('p', { text: `Project ${binding.projectId} v${binding.projectVersion} · blueprint ${binding.blueprintId} v${binding.blueprintVersion} · schema v${binding.blueprintSchemaVersion}` }),
      el('p', { text: `Source SHA-256 ${binding.sourceHash} · binding integrity ${binding.bindingHash} · evidence ${context.sourceBindingEvidenceRef}` }),
      el('p', { text: binding.state === 'PINNED_OLDER_VERSION' ? 'Pinned version: this project has a newer saved design. The case still uses this original snapshot.' : binding.state === 'CURRENT' ? 'Pinned version: the case uses this exact current saved design snapshot.' : 'Pinned version: current project state is unavailable; the case retains this exact saved snapshot.' }),
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
        el('label', {}, [el('span', { text: 'Rationale · synthetic template, review against pinned sources' }), rationale]),
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
      const review = draftEntry.assignmentReview;
      const humanAssignments = Boolean(review?.assignments?.length === currentDraft.tasks.length
        && review.assignments.every((item) => item.assignee?.actorType === 'human' && item.assignee?.principal
          && Number.isSafeInteger(item.assignee.membershipGeneration) && Number.isSafeInteger(item.assignee.authzGeneration)));
      const promotedCurrentReview = draftEntry.promotion?.reviewRevision === review?.revision;
      content.append(section('Owner review of software delivery draft', [
      el('p', { className: 'draft-state', text: draftEntry.promotion
        ? `OWNER PROMOTED · Immutable human checkpoint revision ${draftEntry.promotion.runtimeRevision} · snapshot ${draftEntry.promotion.snapshotHash}. Starting a separate instance creates planned checkpoints only.`
        : review
          ? `OWNER REVIEWED · Revision ${review.revision} · Snapshot only; not executable until promoted.`
        : 'PROPOSED DRAFT · No owner-reviewed assignment snapshot yet. This work is not executable; no plan promotion, approval, runtime, or dispatch.' }),
      el('p', { text: `Plan ${currentDraft.id} · compiler ${currentDraft.compilerVersion} · source ${currentDraft.binding.sourceHash} · G4 ${currentDraft.binding.requirementsBaselineHash} · G5 ${currentDraft.binding.architectureBaselineHash} · G6 ${currentDraft.binding.g6PlanHash}` }),
      ...[(() => {
        const form = el('form', { className: 'assignment-review-form' });
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
        if (!state.actorBindings.length) form.append(el('p', { text: 'No current enabled actor bindings are available for this saved blueprint.' }));
        return form;
      })()],
      ...(review && !humanAssignments ? [el('p', { className: 'muted', text: 'Promotion is unavailable: every task must have an exact, current human assignee. Agent tasks need the separate PR-08 software output contract.' })] : []),
      ...(review && humanAssignments && !promotedCurrentReview ? [(() => {
        const button = el('button', { className: 'button primary', text: draftEntry.promotion ? 'Promote revised human plan' : 'Promote human checkpoint plan', attrs: { type: 'button' } });
        button.addEventListener('click', () => promoteSoftwarePlan(button, draftEntry)); return button;
      })()] : []),
      ...(draftEntry.promotion ? [(() => {
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
  if (state.cases.length) await loadCase(state.cases[0].id); else showWelcome();
} catch (error) { notify(error.message); }
