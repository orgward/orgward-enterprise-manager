// Each uncertain command remains an exact, recoverable request after reload.
export function renderOutcomeInbox({ projectId, principal, el, api, preferredSource = null }) {
  const base = `/api/v1/projects/${encodeURIComponent(projectId)}/outcomes`;
  const storageKey = `orgward:outcome-command:${encodeURIComponent(principal ?? '')}:${encodeURIComponent(projectId)}`;
  const root = el('section', { className: 'panel content-section outcome-inbox', attrs: { 'aria-label': 'Project outcome inbox' } });
  root.style.overflowWrap = 'anywhere'; root.style.minWidth = '0';
  const status = el('p', { attrs: { role: 'status', 'aria-live': 'polite' } });
  const body = el('div');
  let pending = null;
  let busy = false;
  let loadId = 0;
  let expandedId = null;
  let importDraft = null;
  let retainedOnDisk = true;
  try { pending = JSON.parse(localStorage.getItem(storageKey) ?? 'null'); } catch { /* storage unavailable */ }
  function retain(value) {
    pending = value;
    try { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); retainedOnDisk = true; } catch { retainedOnDisk = false; }
  }
  const text = (value) => el('p', { text: value });
  function input(name, label, attrs = {}) {
    const control = el('input', { attrs: { name, ...attrs } });
    control.style.maxWidth = '100%'; control.style.minWidth = '0';
    if (attrs.type !== 'checkbox') control.style.width = '100%';
    return { control, node: el('label', { text: label }, [control]) };
  }
  function area(name, label, required = true, maximum = 1000) {
    const control = el('textarea', { attrs: { name, rows: '3', maxlength: String(maximum), ...(required ? { required: 'required' } : {}) } });
    control.style.maxWidth = '100%'; control.style.minWidth = '0'; control.style.width = '100%';
    return { control, node: el('label', { text: label }, [control]) };
  }
  function select(name, label, entries) {
    const control = el('select', { attrs: { name } }, entries.map(([value, title]) => el('option', { text: title, attrs: { value } })));
    control.style.width = '100%'; control.style.minWidth = '0';
    return { control, node: el('label', { text: label }, [control]) };
  }
  function button(label, action, disabled = false) {
    const node = el('button', { className: 'button', text: label, attrs: { type: 'button' } });
    node.style.whiteSpace = 'normal'; node.style.maxWidth = '100%';
    node.disabled = disabled; node.addEventListener('click', action); return node;
  }
  function form(label, controls, action, disabled = false) {
    const node = el('form', { attrs: { 'aria-label': label } }, controls);
    node.style.display = 'grid'; node.style.gap = '0.6rem'; node.style.minWidth = '0';
    const submit = el('button', { className: 'button', text: label, attrs: { type: 'submit' } });
    submit.disabled = Boolean(disabled || pending || busy);
    submit.style.whiteSpace = 'normal'; submit.style.maxWidth = '100%';
    node.append(submit);
    if (disabled || pending || busy) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true;
    node.addEventListener('submit', (event) => { event.preventDefault(); if (!disabled && !pending && !busy && node.reportValidity()) action(node); });
    return node;
  }
  async function command(route, payload, label) {
    if (busy) return;
    if (!pending) retain({ route, payload: { ...payload, commandId: `outcome:${crypto.randomUUID()}` }, label });
    busy = true; ++loadId;
    for (const control of body.querySelectorAll('button,input,select,textarea')) control.disabled = true;
    status.textContent = `${pending.label}…`;
    try {
      const result = await api(pending.route, { method: 'POST', body: JSON.stringify(pending.payload) });
      expandedId = result.outcome?.id ?? expandedId;
      if (pending.route === `${base}/import`) importDraft = null;
      retain(null);
      status.textContent = 'Saved. The current outcome and activity are shown below.';
    } catch (error) {
      const httpStatus = error.status ?? error.statusCode;
      const definitive = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408;
      if (definitive) retain(null);
      status.textContent = definitive
        ? `${error.message} Review the refreshed outcome, current design and permissions before trying a new command.`
        : `${error.message} The response is uncertain. Retry the saved command to recover its result before starting another action.${retainedOnDisk ? '' : ' Browser storage is unavailable; keep this page open until recovery completes.'}`;
    } finally { busy = false; await refresh(); }
  }
  function sourceLabel(source) {
    if (source.kind === 'manual') return `Human reported context: ${source.summary}`;
    return source.kind === 'release' ? `Protected release ${source.actionId}` : `Task result ${source.runId}`;
  }
  function createForm(result) {
    const sources = result.sources ?? {};
    const choices = [['manual', 'Human reported context']];
    const sourceMap = new Map([['manual', { kind: 'manual' }]]);
    for (const release of sources.releases ?? []) {
      const value = `release:${release.actionId}`;
      choices.push([value, `Release ${release.environmentId} · ${release.status} · ${release.actionId}`]);
      sourceMap.set(value, { kind: 'release', actionId: release.actionId });
    }
    for (const task of sources.tasks ?? []) {
      const value = `task:${task.runId}`;
      choices.push([value, `Task ${task.title} · ${task.status}`]); sourceMap.set(value, { kind: 'task', runId: task.runId });
    }
    const source = select('source', 'Saved result or human reported context', choices);
    if (preferredSource) {
      const preferred = `${preferredSource.kind}:${preferredSource.actionId ?? preferredSource.runId}`;
      if (sourceMap.has(preferred)) source.control.value = preferred;
    }
    const title = input('title', 'Outcome or issue title', { required: 'required', maxlength: '160' });
    const category = select('category', 'Inbox category', [['improvement', 'Improvement'], ['incident', 'Incident'], ['support', 'Support']]);
    const owner = memberSelect('ownerPrincipal', 'Responsible person', sources.members ?? []);
    const summary = area('summary', 'Human reported context (required for a manual source)', false, 800);
    const updateSummary = () => { summary.control.required = source.control.value === 'manual'; summary.node.hidden = source.control.value !== 'manual'; };
    source.control.addEventListener('change', updateSummary); updateSummary();
    return form('Add outcome to inbox', [title.node, category.node, source.node, summary.node, owner.node], () => {
      const selected = sourceMap.get(source.control.value);
      command(base, { title: title.control.value.trim(), category: category.control.value, source: selected.kind === 'manual' ? { ...selected, summary: summary.control.value.trim() } : selected, ownerPrincipal: owner.control.value }, 'Add outcome');
    }, !result.permissions?.write);
  }
  function memberSelect(name, label, members, selected = principal) {
    const field = select(name, label, [['', 'Choose a responsible project member'], ...members.map((member) => [member.principal, `${member.displayName ?? member.principal} · ${member.access}`])]);
    field.control.required = true;
    if (members.some((member) => member.principal === selected)) field.control.value = selected;
    return field;
  }
  async function previewImport(file) {
    if (busy || pending || !file) return;
    busy = true; ++loadId;
    for (const control of body.querySelectorAll('button,input,select,textarea')) control.disabled = true;
    status.textContent = 'Verifying the outcome export and its hash…';
    try {
      if (file.size > 1_000_000) throw new Error('Choose an outcome JSON export no larger than 1 MB.');
      const bundle = JSON.parse(await file.text());
      const { preview } = await api(`${base}/import-preview`, { method: 'POST', body: JSON.stringify({ bundle }) });
      importDraft = { bundle, preview, fileName: file.name };
      status.textContent = 'Export verified. Review its origin and reported observations, then choose responsibility for the new item.';
    } catch (error) {
      importDraft = null;
      status.textContent = `Import preview failed: ${error.message}. Choose a valid outcome export and verify it again.`;
    } finally { busy = false; await refresh(); }
  }
  function importForm(result) {
    const allowed = Boolean(result.permissions?.assign);
    const file = input('bundle', 'Outcome JSON export (maximum 1 MB)', { type: 'file', accept: '.json,application/json', required: 'required' });
    const panel = el('details', { attrs: importDraft ? { open: 'open' } : {} }, [
      el('summary', { text: 'Import an outcome export' }),
      text('A project owner can verify an export and import its latest human reported observations into a new open item. Learning approvals and change-case authority are not copied.'),
      form('Verify outcome import', [file.node], () => previewImport(file.control.files?.[0]), !allowed),
    ]);
    if (!allowed) panel.append(text('A project owner must verify and import outcome exports.'));
    if (!importDraft) return panel;
    const { preview, bundle, fileName } = importDraft;
    const origin = preview.origin;
    const evaluation = preview.latestEvaluation;
    panel.append(text(`Verified file: ${fileName} · ${preview.title} · ${preview.category}`),
      text(`Origin: tenant ${origin.tenantId} · project ${origin.projectId} · outcome ${origin.outcomeId} · version ${origin.version}`),
      text(`Export hash: ${preview.exportHash} · import hash: ${preview.importHash}`),
      text(`Reported observations to import: ${preview.observationCount}. Technical: ${evaluation?.technical ?? 'UNKNOWN'} · control: ${evaluation?.control ?? 'UNKNOWN'} · business: ${evaluation?.business ?? 'UNKNOWN'}.`));
    const latest = bundle.outcome?.observations?.at(-1);
    if (latest) {
      panel.append(text(`Latest observation window: ${latest.window}`));
      for (const measure of latest.measures ?? []) panel.append(text(`${measure.dimension} · ${measure.name}: ${measure.actual ?? 'unknown'} ${measure.unit ?? ''} · target ${measure.target ?? 'unknown'} · ${measure.evidenceSummary || 'Evidence unknown'} · ${measure.observedAt ?? 'Time unknown'}`));
    }
    const owner = memberSelect('ownerPrincipal', 'Responsible person for the imported item', result.sources?.members ?? []);
    const reviewed = input('reviewed', 'I reviewed the origin and latest reported observations', { type: 'checkbox', required: 'required' });
    panel.append(form('Import as new open item', [owner.node, reviewed.node], () => command(`${base}/import`, { bundle, ownerPrincipal: owner.control.value, expectedImportHash: preview.importHash }, 'Import outcome'), !allowed));
    return panel;
  }
  async function downloadOutcome(outcome, control) {
    if (busy) return;
    control.disabled = true;
    let objectUrl = null;
    try {
      const bundle = await api(`${base}/${encodeURIComponent(outcome.id)}/export`);
      objectUrl = URL.createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }));
      const download = el('a', { attrs: { href: objectUrl, download: `orgward-outcome-${outcome.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-v${bundle.outcome?.version ?? outcome.version}.json` } });
      root.append(download); download.click(); download.remove();
      status.textContent = `Downloaded outcome version ${bundle.outcome?.version ?? outcome.version}. Export hash: ${bundle.exportHash}.`;
    } catch (error) { status.textContent = `Outcome export failed: ${error.message}. Try downloading again.`; }
    finally { if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); control.disabled = busy; }
  }
  function observationForm(outcome, permissions) {
    const window = input('window', 'Observation window', { required: 'required', maxlength: '200', placeholder: 'For example: 1–7 October' });
    const measurements = el('div');
    const rows = [];
    function addMeasure(dimension = 'business') {
      if (rows.length >= 24) { status.textContent = 'Each observation can contain at most 24 measures.'; return; }
      const fieldset = el('fieldset', {}, [el('legend', { text: 'Reported measure' })]);
      const fields = {
        dimension: select('dimension', 'Dimension', [['technical', 'Technical'], ['control', 'Control'], ['business', 'Business']]),
        name: input('name', 'Measure name', { required: 'required', maxlength: '120' }),
        actual: input('actual', 'Observed value (blank means unknown)', { type: 'number', step: 'any' }),
        target: input('target', 'Target (blank means unknown)', { type: 'number', step: 'any' }),
        comparison: select('comparison', 'Target comparison', [['gte', 'At least'], ['lte', 'At most'], ['eq', 'Equal to']]),
        unit: input('unit', 'Unit', { maxlength: '80', placeholder: '%, seconds, count' }),
        evidenceSummary: area('evidenceSummary', 'Evidence or source summary (blank means unknown)', false, 800),
        observedAt: input('observedAt', 'Time observed (blank means unknown)', { type: 'datetime-local' }),
      };
      fields.dimension.control.value = dimension;
      fieldset.style.display = 'grid'; fieldset.style.gap = '0.5rem'; fieldset.style.minWidth = '0';
      for (const field of Object.values(fields)) fieldset.append(field.node);
      const row = { id: `measure-${crypto.randomUUID()}`, fields }; rows.push(row);
      fieldset.append(button('Remove measure', () => { rows.splice(rows.indexOf(row), 1); fieldset.remove(); }, !permissions.write || Boolean(pending)));
      measurements.append(fieldset);
    }
    addMeasure('technical'); addMeasure('control'); addMeasure('business');
    const add = button('Add another measure', () => addMeasure(), !permissions.write || Boolean(pending));
    return form('Save reported observations', [text('Values are reported by a person. Saved source evidence does not verify these business facts. Missing values, targets, evidence or observation time remain unknown.'), window.node, measurements, add], () => {
      if (!rows.length) { status.textContent = 'Add at least one measure.'; return; }
      const measures = rows.map(({ id, fields }) => ({ id,
        ...Object.fromEntries(['name', 'dimension', 'comparison', 'unit', 'evidenceSummary'].map((name) => [name, fields[name].control.value.trim()])),
        actual: fields.actual.control.value === '' ? null : Number(fields.actual.control.value),
        target: fields.target.control.value === '' ? null : Number(fields.target.control.value),
        observedAt: fields.observedAt.control.value ? new Date(fields.observedAt.control.value).toISOString() : null,
      }));
      command(`${base}/${encodeURIComponent(outcome.id)}/observe`, { expectedVersion: outcome.version, window: window.control.value.trim(), measures }, 'Save observations');
    }, !permissions.write);
  }
  function renderOutcome(outcome, result) {
    const permissions = result.permissions ?? {};
    const route = `${base}/${encodeURIComponent(outcome.id)}`;
    const row = el('details', { attrs: { 'data-outcome-id': outcome.id, ...(expandedId === outcome.id ? { open: 'open' } : {}) } }, [
      el('summary', { text: `${outcome.category} · ${outcome.status.replaceAll('_', ' ')} · ${outcome.title}` }),
      text(`${sourceLabel(outcome.source)} · responsible person ${outcome.ownerPrincipal}`),
    ]);
    row.addEventListener('toggle', () => { if (row.open) expandedId = outcome.id; });
    const download = button('Download outcome JSON export', () => downloadOutcome(outcome, download));
    row.append(download);
    if (outcome.importedFrom) {
      const origin = outcome.importedFrom;
      row.append(text(`Imported context: tenant ${origin.tenantId} · project ${origin.projectId} · outcome ${origin.outcomeId} · version ${origin.version} · export hash ${origin.exportHash}. Approvals and change-case authority were not imported.`));
    }
    const evaluation = outcome.latestEvaluation;
    row.append(text(`Technical: ${evaluation?.technical ?? 'UNKNOWN'} · control: ${evaluation?.control ?? 'UNKNOWN'} · business: ${evaluation?.business ?? 'UNKNOWN'}`));
    for (const observation of outcome.observations ?? []) {
      const receipt = el('details', {}, [el('summary', { text: `Reported observation · ${observation.window} · ${observation.recordedAt ?? ''}` })]);
      if (observation.importedOrigin) receipt.append(text(`Original report: ${observation.importedOrigin.reportedBy} · ${observation.importedOrigin.recordedAt} · observation hash ${observation.importedOrigin.observationHash}`));
      for (const measure of observation.measures ?? []) receipt.append(text(`${measure.dimension} · ${measure.name}: ${measure.actual ?? 'unknown'} ${measure.unit} · target ${({ gte: 'at least', lte: 'at most', eq: 'equal to' })[measure.comparison] ?? measure.comparison} ${measure.target ?? 'unknown'} · ${measure.evidenceSummary || 'Evidence unknown'} · ${measure.observedAt ?? 'Time unknown'}`));
      row.append(receipt);
    }
    row.append(el('details', {}, [el('summary', { text: 'Record new observations' }), observationForm(outcome, permissions)]));
    if (evaluation?.observationHash) {
      const title = input('title', 'Learning proposal title', { required: 'required', maxlength: '160' });
      const recommendation = area('recommendation', 'Recommended next action');
      const rationale = area('rationale', 'Reason supported by these observations');
      row.append(el('details', {}, [el('summary', { text: 'Propose learning from latest observations' }), form('Propose learning', [title.node, recommendation.node, rationale.node], () => command(`${route}/propose`, { expectedVersion: outcome.version, title: title.control.value.trim(), recommendation: recommendation.control.value.trim(), rationale: rationale.control.value.trim(), observationHash: evaluation.observationHash }, 'Propose learning'), !permissions.write)]));
    }
    for (const proposal of outcome.proposals ?? []) {
      const latestObservation = Boolean(evaluation?.observationHash && proposal.observationHash === evaluation.observationHash);
      const panel = el('article', {}, [el('h4', { text: `${proposal.title} · ${proposal.status}` }), text(proposal.recommendation), text(proposal.rationale), text(`Based on observation ${proposal.observationHash}`)]);
      if (!latestObservation) panel.append(text('Historical learning: this proposal is not bound to the latest observation. Propose learning from the latest observations before owner review or creating another follow-up. Existing reviews and linked cases remain in the history.'));
      if (proposal.status === 'PROPOSED') {
        const decision = select('decision', 'Owner review decision', [['accept', 'Accept'], ['reject', 'Reject']]);
        const reason = area('reason', 'Reason for review', true, 500);
        panel.append(form('Save owner review', [decision.node, reason.node], () => command(`${route}/review`, { expectedVersion: outcome.version, proposalHash: proposal.proposalHash, decision: decision.control.value, reason: reason.control.value.trim() }, 'Save owner review'), !permissions.review || !latestObservation));
      }
      if (proposal.review) panel.append(text(`Review: ${proposal.review.decision ?? proposal.status} · ${proposal.review.principal ?? proposal.review.reviewedBy ?? ''} · ${proposal.review.reason}`));
      if (proposal.followUpCaseId) panel.append(el('a', { text: 'Open linked change case', attrs: { href: `/sdlc.html?case=${encodeURIComponent(proposal.followUpCaseId)}` } }));
      else if (proposal.status === 'ACCEPTED') {
        const design = result.sources?.design;
        const source = select('sourceObjectId', 'Choose a current saved design object for the follow-up', [['', 'Choose a design object'], ...(design?.objects ?? []).map((object) => [object.id, `${object.type} · ${object.name}`])]);
        source.control.required = true;
        panel.append(form('Create linked change case', [text(`The follow-up uses the current saved blueprint ${design?.blueprintVersion ?? 'unavailable'}. Review its source before creating the case.`), source.node], () => command(`${route}/follow-up`, { expectedVersion: outcome.version, proposalHash: proposal.proposalHash, expectedProjectVersion: design.projectVersion, expectedBlueprintId: design.blueprintId, expectedBlueprintVersion: design.blueprintVersion, sourceObjectId: source.control.value }, 'Create linked change case'), !permissions.followUp || !latestObservation || !design?.objects?.length));
      }
      row.append(panel);
    }
    const owner = memberSelect('ownerPrincipal', 'Responsible project member', result.sources?.members ?? [], outcome.ownerPrincipal);
    const assignmentReason = area('reason', 'Reason for assignment', true, 500);
    row.append(el('details', {}, [el('summary', { text: 'Assign responsibility' }), form('Save assignment', [owner.node, assignmentReason.node], () => command(`${route}/assign`, { expectedVersion: outcome.version, ownerPrincipal: owner.control.value, reason: assignmentReason.control.value.trim() }, 'Save assignment'), !permissions.assign)]));
    const disposition = select('status', 'Inbox status', [['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']]);
    disposition.control.value = outcome.status;
    const statusReason = area('reason', 'Reason for status change', true, 500);
    row.append(el('details', {}, [el('summary', { text: 'Update inbox status' }), form('Save inbox status', [disposition.node, statusReason.node], () => command(`${route}/status`, { expectedVersion: outcome.version, status: disposition.control.value, reason: statusReason.control.value.trim() }, 'Save inbox status'), !permissions.assign && !(permissions.write && outcome.ownerPrincipal === principal))]));
    const history = el('ul', { attrs: { 'aria-label': 'Outcome activity history' } });
    for (const event of outcome.events ?? []) history.append(el('li', { text: `${event.type} · ${event.principal ?? event.actor ?? ''} · ${event.at ?? event.occurredAt ?? ''}${event.reason ?? event.data?.reason ? ` · ${event.reason ?? event.data.reason}` : ''}` }));
    row.append(el('details', {}, [el('summary', { text: 'Activity history' }), history]));
    return row;
  }
  async function refresh() {
    if (busy) return;
    const requestId = ++loadId;
    try {
      const result = await api(base);
      if (requestId !== loadId) return;
      body.replaceChildren();
      if (pending) body.append(text('An earlier command has an uncertain response. Recover its saved result before starting another action.'), button(`Retry saved command: ${pending.label}`, () => command(pending.route, pending.payload, pending.label)));
      if (pending && !retainedOnDisk) body.append(text('Browser storage is unavailable. Keep this page open until the saved command is recovered.'));
      if (result.available === false) { body.append(text('The outcome inbox requires the configured durable project store. Ask the workspace operator to enable it.')); return; }
      body.append(el('details', {}, [el('summary', { text: 'Add an outcome, incident or support item' }), createForm(result)]));
      body.append(importForm(result));
      if (!result.outcomes?.length) body.append(text('No outcomes recorded. Add a saved release, task result or human reported context to begin.'));
      for (const outcome of result.outcomes ?? []) body.append(renderOutcome(outcome, result));
    } catch (error) {
      if (requestId !== loadId) return;
      body.replaceChildren(text(`${error.message} The inbox could not be loaded. Refresh to review its current state.`));
      if (pending) body.append(button(`Retry saved command: ${pending.label}`, () => command(pending.route, pending.payload, pending.label)));
    }
  }
  root.append(el('h3', { text: 'Outcome and next-action inbox' }), text('Record observations, review learning and assign the next action. Acceptance creates a proposal for follow-up; creating its change case is a separate action.'), status, button('Refresh outcome inbox', refresh), body);
  refresh();
  return root;
}
