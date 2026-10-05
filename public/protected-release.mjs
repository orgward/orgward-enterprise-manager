// Protected release commands retain their exact payload until the server answers.
export function renderProtectedRelease({ run, principal, el, api, readOnly = false }) {
  const root = el('section', { className: 'panel protected-release', attrs: { 'aria-label': 'Protected release and rollback' } });
  root.style.overflowWrap = 'anywhere';
  root.style.minWidth = '0';
  const status = el('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const body = el('div');
  const base = `/api/v1/projects/${encodeURIComponent(run.projectId)}`;
  const key = `orgward:protected-release:${encodeURIComponent(principal ?? '')}:${encodeURIComponent(run.projectId)}`;
  let pending = null;
  let busy = false;
  try { pending = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* storage unavailable */ }
  const save = (value) => {
    pending = value;
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* exact retry remains in memory */ }
  };
  const paragraph = (text) => el('p', { className: 'muted', text });
  const button = (text, handler, disabled = false) => {
    const node = el('button', { className: 'button', text, attrs: { type: 'button' } });
    node.disabled = disabled;
    node.addEventListener('click', handler);
    return node;
  };
  const identity = (label, candidate) => {
    const node = el('details', {}, [el('summary', { text: label })]);
    if (!candidate) { node.append(paragraph('No successful candidate recorded.')); return node; }
    node.append(paragraph(`Run ${candidate.runId} · candidate ${candidate.candidateEvidenceHash} · tree ${candidate.candidateTreeDigest} · output manifest ${candidate.outputManifestHash}`));
    const outputs = el('ul');
    for (const output of candidate.outputManifest ?? []) outputs.append(el('li', { text: `${output.path} · ${output.sha256 ?? 'hash unavailable'} · ${output.size ?? 'unknown'} bytes` }));
    node.append(outputs);
    return node;
  };
  async function submit(route, payload, label) {
    if (busy) return;
    if (!pending) save({ route, payload: { ...payload, commandId: `protected-release:${crypto.randomUUID()}` }, label });
    busy = true;
    for (const control of body.querySelectorAll('button, textarea')) control.disabled = true;
    status.textContent = `${pending.label}…`;
    try {
      await api(pending.route, { method: 'POST', body: JSON.stringify(pending.payload) });
      save(null);
      status.textContent = 'Action saved. Reviewing the current environment state.';
    } catch (error) {
      const definitive = error.status >= 400 && error.status < 500 && error.status !== 408;
      if (definitive) save(null);
      status.textContent = definitive
        ? `${error.message} Refresh the environment, review its current generation and authority, then request a fresh action if needed.`
        : `${error.message} The response is uncertain. Retry the saved command to recover its result; its identity and payload are preserved.`;
    } finally { busy = false; await refresh(); }
  }
  async function refresh() {
    if (busy) return;
    try {
      const result = await api(`${base}/release-environments`);
      body.replaceChildren();
      if (readOnly) body.append(paragraph('Archived workspace: release requests, approvals and evidence are read-only. Restore the workspace before making changes.'));
      if (pending && !readOnly) body.append(paragraph('A command has an uncertain response. Recover its saved result before starting another action.'),
        button(`Retry saved command: ${pending.label}`, () => submit(pending.route, pending.payload, pending.label)));
      if (!result.available || !result.environments?.length) {
        body.append(paragraph('Protected release is unavailable. Ask a workspace operator to configure an environment, permitted assets, human authority and a release destination.'), button('Request release', () => {}, true));
        return;
      }
      const candidate = run.execution?.repositoryCandidate;
      body.append(paragraph(`Selected candidate ${candidate?.candidateEvidence?.hash ?? 'unavailable'} · tree ${candidate?.treeDigest ?? 'unavailable'} · build ${candidate?.buildReceipt?.status ?? 'unavailable'} · output manifest ${candidate?.buildReceipt?.runs?.[0]?.outputManifestHash ?? 'unavailable'}`));
      if (candidate && result.environments.length > 1) {
        const progress = el('section', { className: 'promotion-progress', attrs: { 'aria-label': 'Selected candidate promotion status' } });
        progress.append(el('h4', { text: 'Selected candidate promotion status' }),
          paragraph('Read-only status from saved environment history. Use each environment’s existing request and approval controls to continue.'));
        const stages = el('ul', { attrs: { 'aria-label': 'Candidate status by configured environment' } });
        for (const environment of result.environments) {
          const pendingAction = (environment.actions ?? []).find((action) => action.id === environment.state.pendingActionId);
          let statusText;
          if (environment.state.current?.runId === run.id) statusText = 'Selected candidate is currently deployed';
          else if (pendingAction?.request?.candidate?.runId === run.id) {
            statusText = `Action for this candidate: ${pendingAction.status.replaceAll('_', ' ').toLowerCase()}`;
          } else if (pendingAction) statusText = 'Another environment action is unresolved';
          else if (environment.state.previous?.runId === run.id
            || (environment.actions ?? []).some((action) => action.request?.kind === 'release'
              && action.request.candidate?.runId === run.id && ['SUCCEEDED', 'UNHEALTHY'].includes(action.status))) {
            statusText = environment.state.current?.runId
              ? 'Selected candidate was previously deployed; another candidate is current'
              : 'Selected candidate was previously deployed; no candidate is currently deployed';
          } else statusText = 'Selected candidate has not been promoted here';
          stages.append(el('li', { text: `${environment.label} · ${environment.riskClass} risk · ${statusText}` }));
        }
        progress.append(stages);
        body.append(progress);
      }
      for (const environment of result.environments) {
        const state = environment.state;
        const permissions = readOnly ? {} : environment.permissions ?? {};
        const unresolved = (environment.actions ?? []).find((action) => action.id === state.pendingActionId);
        const unhealthy = unresolved?.status === 'UNHEALTHY' && unresolved.observations?.at(-1)?.health === 'unhealthy';
        const rollbackTarget = unhealthy ? state.current : state.previous;
        const panel = el('article', {}, [el('h4', { text: environment.label }),
          paragraph(`Risk ${environment.riskClass} · assets ${(environment.assetIds ?? []).join(', ')} · generation ${state.generation}`),
          identity('Current successful candidate', state.current), identity(unhealthy ? 'Last healthy candidate · recovery rollback target' : 'Previous successful candidate · rollback target', rollbackTarget)]);
        if (unhealthy) panel.append(paragraph('The destination confirmed this release was applied and is unhealthy. Request an independently approved rollback to the last healthy candidate, or check its health again.'));
        else if (state.pendingActionId) panel.append(paragraph(`An outcome is unresolved for ${state.pendingActionId}. Check the saved outcome before requesting release or rollback.`));
        const form = el('form');
        const reason = el('textarea', { attrs: { required: 'required', maxlength: '500', rows: '3', 'aria-label': `Reason for release or rollback to ${environment.label}` } });
        reason.disabled = readOnly;
        form.append(el('label', { text: 'Reason for this environment action' }, [reason]));
        for (const kind of ['release', 'rollback']) {
          const allowedKinds = environment.actionsAllowed ?? ['release', 'rollback'];
          const ready = kind === 'rollback' ? Boolean(rollbackTarget) : run.status === 'SUCCEEDED' && candidate?.requiredChecksStatus === 'PASSED' && candidate?.buildReceipt?.status === 'REPRODUCIBLE';
          form.append(button(kind === 'release' ? 'Request release of selected candidate' : 'Request rollback to previous candidate', () => {
            if (!form.reportValidity()) return;
            submit(`${base}/release-actions`, { environmentId: environment.id, kind, ...(kind === 'release' ? { runId: run.id } : {}), reason: reason.value.trim(), expectedGeneration: state.generation }, `Request ${kind}`);
          }, Boolean(pending || (state.pendingActionId && !(kind === 'rollback' && unhealthy)) || !permissions.request || !allowedKinds.includes(kind) || !ready)));
        }
        form.addEventListener('submit', (event) => event.preventDefault());
        panel.append(form);
        if (!permissions.request) panel.append(paragraph('Your current identity cannot request an action in this environment.'));
        for (const action of environment.actions ?? []) {
          const request = action.request;
          const row = el('details', { attrs: { ...(state.pendingActionId === action.id ? { open: 'open' } : {}) } }, [
            el('summary', { text: `${request.kind} · ${action.status.replaceAll('_', ' ')} · ${action.id}` }),
            paragraph(`Reason: ${request.reason} · requested by ${request.requestedBy} · generation ${request.expectedGeneration}`),
            paragraph(`Request ${action.requestHash} · configuration ${request.environment.configurationHash}`),
            identity('Exact requested candidate and output manifest', request.candidate),
            paragraph(action.approval ? `Approved independently by ${action.approval.principal}` : 'Independent human approval is required before execution.')]);
          if (request.recoveryOfActionId) row.append(paragraph(`Recovery rollback for ${request.recoveryOfActionId}`));
          const pendingBlocks = state.pendingActionId && request.recoveryOfActionId !== state.pendingActionId;
          const command = (verb) => submit(`${base}/release-actions/${encodeURIComponent(action.id)}/${verb}`, { expectedVersion: action.version, requestHash: action.requestHash }, `${verb === 'reconcile' ? 'Check saved outcome' : verb === 'approve' ? 'Approve exact request' : 'Execute approved action'}`);
          if (action.status === 'AWAITING_APPROVAL') row.append(button('Approve exact request', () => command('approve'), Boolean(pending || !permissions.approve || request.requestedBy === principal || pendingBlocks || state.generation !== request.expectedGeneration)));
          if (action.status === 'APPROVED') row.append(button('Execute approved action', () => command('execute'), Boolean(pending || !permissions.execute || pendingBlocks || state.generation !== request.expectedGeneration)));
          if (['DISPATCHED', 'OUTCOME_UNKNOWN', 'UNHEALTHY'].includes(action.status)) row.append(paragraph('Execution has already been dispatched. Checking the saved outcome does not send another release. An unknown outcome must be resolved before another release. A confirmed unhealthy release can recover through an independently approved rollback.'), button('Check saved outcome', () => command('reconcile'), Boolean(pending || !permissions.execute)));
          if (action.status === 'FAILED') row.append(paragraph('The destination confirmed rejection without an effect. Review the reason and request a new action after repair.'));
          for (const observation of action.observations ?? []) row.append(paragraph(`Observed ${observation.status} · health ${observation.health ?? 'unavailable'} · ${observation.reason ?? observation.healthCheckId ?? ''} · ${observation.recordedAt}`));
          const history = el('ul', { attrs: { 'aria-label': 'Release activity history' } });
          for (const event of action.events ?? []) history.append(el('li', { text: `${event.type} · ${event.occurredAt ?? event.at ?? ''}` }));
          row.append(history);
          panel.append(row);
        }
        body.append(panel);
      }
    } catch (error) {
      body.replaceChildren(paragraph(`${error.message} Environment state could not be loaded.`));
      if (pending && !readOnly) body.append(button(`Retry saved command: ${pending.label}`, () => submit(pending.route, pending.payload, pending.label)));
    }
  }
  root.append(el('h3', { text: 'Protected release and rollback' }), status,
    button('Refresh environment state', refresh), body);
  refresh();
  return root;
}
