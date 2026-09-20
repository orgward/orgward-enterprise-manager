const state = { meta: null, cases: [], changeCase: null, tab: 'overview' };
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
  if (!response.ok) throw new Error(result.error || 'Request failed.');
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
  select.addEventListener('change', renderMutationExpectation);
  document.querySelector('#case-form').addEventListener('submit', createCase);
  renderMutationExpectation(); renderCaseList();
}

function renderMutationExpectation() {
  const value = document.querySelector('#mutation-select').value;
  const mutation = state.meta.mutations[value];
  document.querySelector('#mutation-expectation').textContent = mutation.expectedGate ? `Expected proof: ${mutation.expectedGate} blocks this fault.` : 'Expected proof: the case reaches protected human release approval.';
}

async function createCase(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    state.changeCase = await api('/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden', rawIntent: event.currentTarget.elements.rawIntent.value, mutation: event.currentTarget.elements.mutation.value }) });
    await refreshCases(); renderCase(); notify('Governed change case created.');
  } catch (error) { notify(error.message); button.disabled = false; }
}

async function loadCase(id) {
  try { state.changeCase = await api(`/api/sdlc/cases/${id}`); state.tab = 'overview'; renderCase(); renderCaseList(); }
  catch (error) { notify(error.message); }
}

async function command(action, payload = {}) {
  const current = state.changeCase;
  try {
    state.changeCase = await api(`/api/sdlc/cases/${current.id}/${action}`, {
      method: 'POST', body: JSON.stringify({ version: current.version, idempotencyKey: uid(action), actor: 'studio-operator', ...payload }),
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
  const status = document.querySelector('#case-status'); status.textContent = changeCase.status.replace('_', ' '); status.className = `status-pill status-${changeCase.status}`;
  document.querySelector('#step-case').addEventListener('click', () => command('advance'));
  document.querySelector('#run-case').addEventListener('click', () => command('run'));
  const canRun = !['BLOCKED', 'FAILED', 'NEEDS_HUMAN', 'PASSED'].includes(changeCase.status);
  document.querySelector('#step-case').disabled = !canRun; document.querySelector('#run-case').disabled = !canRun;
  renderStages(); renderTabs(); renderContent(); renderCheckpoint(); renderCaseList();
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
  const renderers = { overview: renderOverview, context: renderContext, impact: renderImpact, requirements: renderRequirements, architecture: renderArchitecture, delivery: renderDelivery, assurance: renderAssurance, evidence: renderEvidence };
  renderers[state.tab](content);
}

function metric(value, label) { return el('div', { className: 'metric-card' }, [el('b', { text: value }), el('span', { text: label })]); }
function section(title, children = []) { return el('section', { className: 'content-section' }, [el('h3', { text: title }), ...(Array.isArray(children) ? children : [children])]); }
function empty(message) { return el('div', { className: 'empty-artifact', text: message }); }

function renderOverview(content) {
  const c = state.changeCase;
  content.append(el('div', { className: 'metric-grid' }, [metric(`${c.metrics.stagePasses}/${state.meta.stages.length}`, 'Stages passed'), metric(c.evidenceLedger.length, 'Evidence records'), metric(c.evaluations.length, 'Evaluations'), metric(c.metrics.humanInterventions, 'Human interventions')]));
  const tags = el('div', { className: 'tag-list' });
  for (const value of [...c.intent.desiredOutcomes, ...c.intent.constraints]) tags.append(el('span', { className: 'tag', text: value }));
  content.append(section('Business intent', el('div', { className: 'intent-panel' }, [el('blockquote', { text: c.intent.statement }), tags])));
  const gates = el('div');
  for (const decision of c.gateHistory.slice(-5).reverse()) gates.append(gateCard(decision));
  content.append(section('Latest gate decisions', gates.childNodes.length ? gates : empty('No gate has run yet. Run the first stage to evaluate intent quality.')));
  content.append(section('Machine-queryable lineage', lineageView(c.traceability)));
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
}

function renderImpact(content) {
  const artifact = state.changeCase.artifacts.impact;
  if (!artifact) return content.append(empty('Impact analysis has not run yet.'));
  const grid = el('div', { className: 'impact-grid' });
  for (const impact of artifact.impacts) grid.append(el('article', { className: 'impact-card' }, [el('b', { text: impact.objectRef }), el('span', { text: `${impact.objectType} · ${impact.impactType}` }), el('p', { text: impact.reason })]));
  content.append(section('Enterprise impact set', grid));
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
  content.append(section('Traced requirements', table(['ID / kind', 'Requirement', 'Verification'], artifact.requirements.map((entry) => [[el('strong', { text: entry.id }), el('br'), el('span', { text: entry.kind })], entry.statement, entry.acceptanceCriteria[0] ?? 'Missing']))));
}

function renderArchitecture(content) {
  const artifact = state.changeCase.artifacts.architecture;
  if (!artifact) return content.append(empty('Architecture is created after requirements quality passes.'));
  const flows = artifact.change.dataFlows.map((flow) => el('div', { className: 'flow-row' }, [el('b', { text: flow.mechanism }), el('span', { text: `${flow.from} → ${flow.to} · ${flow.data}` })]));
  content.append(section('Baseline → target data flows', flows));
  content.append(section('Architecture fitness', el('div', { className: 'fitness-list' }, artifact.fitnessResults.map((entry) => el('span', { className: `fitness ${entry.status}`, text: `${entry.status} · ${entry.name}` })))));
  content.append(section('Migration and rollback', [el('p', { text: artifact.change.migration }), el('p', { text: artifact.change.rollback })]));
}

function renderDelivery(content) {
  const plan = state.changeCase.artifacts.plan;
  if (!plan) return content.append(empty('Delivery planning starts after architecture conformance.'));
  content.append(section('Executable work DAG', plan.workItems.map((work) => el('div', { className: 'work-row' }, [el('b', { text: work.id }), el('span', { text: `${work.objective} · depends on ${work.dependencies.join(', ') || 'nothing'} · ${work.requirementRefs.length} requirements` })]))));
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
  panel.replaceChildren(el('h3', { text: 'Control point' }));
  const last = c.gateHistory.at(-1);
  if (c.status === 'PASSED') {
    panel.append(el('div', { className: 'checkpoint-callout' }, [el('b', { text: 'Reference loop complete' }), el('p', { text: 'The full lineage is saved. Learning proposed a follow-up but did not silently rewrite enterprise truth.' })])); return;
  }
  if (c.status === 'BLOCKED' || c.status === 'FAILED') {
    panel.append(el('div', { className: 'checkpoint-callout' }, [el('b', { text: `${last?.gate ?? 'Gate'} blocked safely` }), el('p', { text: last?.findings?.[0]?.message ?? 'A blocking invariant failed.' }), el('p', { text: last?.findings?.[0]?.remediation ?? 'Repair the evidence or design before retrying.' })])); return;
  }
  if (c.status === 'NEEDS_HUMAN' && c.currentStage === 'S9') {
    panel.append(el('div', { className: 'checkpoint-callout' }, [el('b', { text: 'Independent release approval' }), el('p', { text: 'A HIGH-risk production-like release cannot be self-approved by the implementation principal.' })]));
    const button = el('button', { className: 'button primary', text: 'Approve as human governor', attrs: { type: 'button' } });
    button.addEventListener('click', () => command('approve', { principal: 'actor-accountable-owner', roles: ['release-approver', 'control-owner'] })); panel.append(button); return;
  }
  if (c.status === 'NEEDS_HUMAN' && c.currentStage === 'S10') {
    panel.append(el('p', { text: 'Record a synthetic observation. The default proves technical success can coexist with a failed business outcome.' }));
    const form = el('form', { className: 'observation-form' }, [
      el('label', { text: 'Manual-work reduction (%)' }, el('input', { attrs: { name: 'manual', type: 'number', value: '35', min: '0', max: '100' } })),
      el('label', { text: 'Control exceptions' }, el('input', { attrs: { name: 'control', type: 'number', value: '0', min: '0' } })),
      el('button', { className: 'button primary', text: 'Record outcome', attrs: { type: 'submit' } }),
    ]);
    form.addEventListener('submit', (event) => { event.preventDefault(); command('observe', { signals: { technicalHealthy: true, manualWorkReduction: Number(event.currentTarget.elements.manual.value), controlExceptions: Number(event.currentTarget.elements.control.value) } }); }); panel.append(form); return;
  }
  const stage = state.meta.stages[c.currentStageIndex];
  panel.append(el('div', { className: 'checkpoint-callout' }, [el('b', { text: stage ? `${stage.id} · ${stage.label}` : 'Ready' }), el('p', { text: stage ? `Next: execute the stage and evaluate ${stage.gate} — ${stage.gateLabel}.` : 'No stage remains.' })]));
  panel.append(el('p', { text: `Mutation: ${c.mutationLabel}. Version ${c.version}; every command is idempotent and concurrency checked.` }));
}

document.querySelector('#new-case').addEventListener('click', showWelcome);

try {
  const [meta] = await Promise.all([api('/api/sdlc/meta'), refreshCases()]); state.meta = meta;
  if (state.cases.length) await loadCase(state.cases[0].id); else showWelcome();
} catch (error) { notify(error.message); }
