const SCOPE_TYPES = new Set(['organization', 'legal-entity', 'unit']);

export function enterpriseQuery(route = {}) {
  return { lensId: route.lensId ?? 'all', scopeId: route.scopeId ?? null, blueprintVersion: route.blueprintVersion ?? null };
}

export function hasEnterpriseContext(route = {}) {
  return ['lensId', 'scopeId', 'blueprintVersion'].some((field) => Object.hasOwn(route, field));
}

export function enterpriseContextFailure(explicit, message) {
  return explicit ? { error: message, unavailable: null } : { error: null, unavailable: message };
}

export function enterpriseSourceAligned(project, model) {
  return Boolean(project && model?.context) && project.version === model.context.projectVersion && (!model.context.isCurrent
    || (project.latestBlueprint?.id === model.context.blueprintId
      && project.latestBlueprint?.version === model.context.blueprintVersion
      && model.blueprint?.id === model.context.blueprintId));
}

export function enterpriseRequestPath(projectId, query, selectedId = null) {
  const params = new URLSearchParams({ lensId: query.lensId ?? 'all' });
  if (query.scopeId !== null && query.scopeId !== undefined) params.set('scopeId', query.scopeId);
  if (query.blueprintVersion !== null && query.blueprintVersion !== undefined) params.set('blueprintVersion', String(query.blueprintVersion));
  if (selectedId) params.set('selectedId', selectedId);
  return `/api/v1/projects/${encodeURIComponent(projectId)}/enterprise?${params}`;
}

export function enterpriseCommandStorageKey(principal, projectId) {
  return `orgward:enterprise-command:${encodeURIComponent(principal ?? '')}:${encodeURIComponent(projectId)}`;
}

export function restoreEnterpriseCommand(storage, principal, projectId) {
  const saved = JSON.parse(storage.getItem(enterpriseCommandStorageKey(principal, projectId)) ?? 'null');
  if (!saved) return null;
  if (saved.projectId !== projectId || saved.envelope?.schemaVersion !== '1.0'
    || typeof saved.envelope.commandId !== 'string' || !Number.isSafeInteger(saved.envelope.expectedVersion)
    || !['create-scope', 'rename-scope', 'assign-object-scope'].includes(saved.envelope.payload?.kind)) throw new Error('Saved enterprise command is unreadable.');
  return saved;
}

export function persistEnterpriseCommand(storage, principal, projectId, saved) {
  const key = enterpriseCommandStorageKey(principal, projectId);
  if (saved) storage.setItem(key, JSON.stringify(saved)); else storage.removeItem(key);
}

export function submitEnterpriseCommand(api, projectId, saved) {
  if (saved.projectId !== projectId) throw new Error('The saved enterprise command belongs to another project.');
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/enterprise/commands`, { method: 'POST', body: JSON.stringify(saved.envelope) });
}

function fields(el) {
  function field(name, label, { entries = null, value = '', required = true, multiline = false, maximum = 700 } = {}) {
    const control = entries ? el('select', { attrs: { name } }, entries.map(([value, text]) => el('option', { text, attrs: { value } })))
      : el(multiline ? 'textarea' : 'input', { attrs: { name, maxlength: String(maximum), ...(multiline ? { rows: '3' } : {}) } });
    control.required = required; control.value = value ?? '';
    return { control, node: el('label', { text: label }, [control]) };
  }
  function form(kind, label, controls, submit, disabled) {
    const node = el('form', { className: 'enterprise-form', attrs: { 'aria-label': label, 'data-enterprise-action': kind } }, controls);
    const save = el('button', { className: 'button', text: label, attrs: { type: 'submit' } });
    node.append(save);
    if (disabled) for (const control of node.querySelectorAll('input,select,textarea,button')) control.disabled = true;
    node.addEventListener('submit', (event) => { event.preventDefault(); if (!disabled && node.reportValidity()) submit(); });
    return node;
  }
  return { field, form };
}

function scopeOptions(scopes, type, predicate = () => true) {
  return [['', 'None'], ...scopes.filter((scope) => scope.type === type && predicate(scope)).map((scope) => [scope.id, scope.name])];
}

function refill(el, field, entries) {
  const previous = field.control.value;
  field.control.replaceChildren(...entries.map(([value, text]) => el('option', { text, attrs: { value } })));
  field.control.value = entries.some(([value]) => value === previous) ? previous : '';
}

function scopeFields(el, scopes, values = {}) {
  const { field } = fields(el);
  const organization = field('organizationId', 'Organization', { entries: scopeOptions(scopes, 'organization'), required: false, value: values.organizationId });
  const legalEntity = field('legalEntityId', 'Legal entity', { entries: scopeOptions(scopes, 'legal-entity', (scope) => scope.organizationId === organization.control.value), required: false, value: values.legalEntityId });
  const unit = field('unitId', 'Organizational unit', { entries: scopeOptions(scopes, 'unit', (scope) => scope.organizationId === organization.control.value && (!legalEntity.control.value || scope.legalEntityId === legalEntity.control.value)), required: false, value: values.unitId });
  const updateUnits = () => refill(el, unit, scopeOptions(scopes, 'unit', (scope) => scope.organizationId === organization.control.value && (!legalEntity.control.value || scope.legalEntityId === legalEntity.control.value)));
  organization.control.addEventListener('change', () => { refill(el, legalEntity, scopeOptions(scopes, 'legal-entity', (scope) => scope.organizationId === organization.control.value)); updateUnits(); });
  legalEntity.control.addEventListener('change', updateUnits);
  unit.control.addEventListener('change', () => {
    const selected = scopes.find((scope) => scope.id === unit.control.value);
    if (selected) legalEntity.control.value = selected.legalEntityId ?? '';
  });
  return { organization, legalEntity, unit };
}

export function renderEnterpriseContext({ model, query, loading = false, error = null, unavailable = null, pending = null, status = '', storageAvailable = true, el, onContext, onCommand, onRetry, onReload }) {
  const { field, form } = fields(el);
  const root = el('section', { className: 'enterprise-context', attrs: { 'data-enterprise-context': '', 'aria-label': 'Enterprise perspectives and design scopes' } }, [
    el('h3', { text: 'Enterprise perspectives and design scopes' }),
    el('p', { text: 'Lenses share the same saved design records. Scope describes proposed organizational structure and grants no access, legal formation or operating authority.' }),
  ]);
  if (status) root.append(el('p', { text: status, attrs: { role: 'status', 'aria-live': 'polite' } }));
  if (pending) {
    root.append(el('p', { text: 'An enterprise command has an uncertain response. Recover its exact saved result before making another change.' }));
    if (!storageAvailable) root.append(el('p', { text: 'Browser storage is unavailable. Keep this page open until recovery completes.' }));
    const retry = el('button', { className: 'button', text: 'Recover saved enterprise command', attrs: { type: 'button', 'data-enterprise-retry': '' } });
    retry.disabled = loading; retry.addEventListener('click', onRetry); root.append(retry);
  }
  if (loading) root.append(el('p', { text: 'Loading the requested saved perspective…', attrs: { role: 'status' } }));
  if (unavailable) {
    root.append(el('p', { text: `Enterprise perspectives are unavailable: ${unavailable}. The existing saved blueprint and map remain available.`, attrs: { role: 'status' } }));
    if (onReload) {
      const reload = el('button', { className: 'button ghost', text: 'Retry enterprise perspectives', attrs: { type: 'button', 'data-enterprise-reload': '' } });
      reload.addEventListener('click', onReload); root.append(reload);
    }
    return root;
  }
  if (error) {
    root.append(el('p', { text: `Requested enterprise context unavailable: ${error}. The requested lens, scope or version has not been replaced with another context.`, attrs: { role: 'alert' } }));
    const reset = el('button', { className: 'button', text: 'Open current design with all objects', attrs: { type: 'button' } });
    reset.addEventListener('click', () => onContext({ lensId: 'all', scopeId: null, blueprintVersion: null })); root.append(reset);
    return root;
  }
  if (!model) return root;
  const lenses = [['all', 'All design objects'], ...(model.lenses ?? []).filter((lens) => lens.id !== 'all').map((lens) => [lens.id, lens.label])];
  const lens = field('lensId', 'Perspective', { entries: lenses, value: query.lensId });
  const scope = field('scopeId', 'Design scope', { entries: [['', 'All design scopes'], ...(model.scopes ?? []).map((scope) => [scope.id, `${scope.name} · ${scope.type.replaceAll('-', ' ')}`])], required: false, value: query.scopeId });
  const version = field('blueprintVersion', 'Saved design version', { entries: [['', 'Current saved design'], ...(model.versions ?? []).map((version) => [String(version.version), `Saved version ${version.version}`])], required: false, value: query.blueprintVersion });
  const controls = el('div', { className: 'enterprise-context-controls' }, [lens.node, scope.node, version.node]);
  for (const control of [lens, scope, version]) {
    control.control.disabled = loading;
    control.control.addEventListener('change', () => onContext({ lensId: lens.control.value, scopeId: scope.control.value || null, blueprintVersion: version.control.value ? Number(version.control.value) : null }));
  }
  root.append(controls, el('p', { text: model.blueprint ? `Saved version ${model.context.blueprintVersion} · ${model.context.isCurrent ? 'current design' : 'historical snapshot · read only'} · main branch.` : 'No saved design version yet.' }));
  if (!model.context.isCurrent && model.blueprint) {
    const current = el('button', { className: 'button ghost', text: 'Return to the current saved design', attrs: { type: 'button' } });
    current.addEventListener('click', () => onContext({ ...query, blueprintVersion: null })); root.append(current);
  }
  if (model.gaps?.length) root.append(el('details', {}, [el('summary', { text: 'Perspective gaps and unavailable capabilities' }), el('ul', {}, model.gaps.map((gap) => el('li', { text: gap.message })))]));
  if (!model.blueprint) {
    root.append(el('p', { text: 'Save the initial blueprint before creating or assigning design scopes.' }));
    return root;
  }
  const disabled = loading || Boolean(pending) || !model.permissions?.scopeAdmin;
  const scopeType = field('scopeType', 'Scope type', { entries: [['organization', 'Organization'], ['legal-entity', 'Legal entity'], ['unit', 'Organizational unit']] });
  const name = field('name', 'Scope name', { maximum: 120 });
  const detail = field('detail', 'Design purpose and description', { multiline: true });
  const reason = field('reason', 'Reason for this design change', { multiline: true, maximum: 500 });
  const roles = Object.values(model.blueprint.areas ?? {}).flatMap((area) => area.items ?? []).filter((object) => object.type === 'role');
  const owner = field('ownerRoleId', 'Proposed owner role', { entries: [['', 'None specified'], ...roles.map((role) => [role.id, role.name])], required: false });
  const scopes = scopeFields(el, model.scopes ?? []);
  const jurisdiction = field('jurisdiction', 'Jurisdiction (reported design context)', { maximum: 120 });
  const hierarchy = el('div', { className: 'enterprise-hierarchy' }, [scopes.organization.node, jurisdiction.node, scopes.legalEntity.node, scopes.unit.node]);
  scopes.unit.node.firstChild.textContent = 'Parent organizational unit';
  scopes.unit.control.name = 'parentUnitId';
  const updateType = () => {
    const type = scopeType.control.value;
    scopes.organization.node.hidden = type === 'organization'; scopes.organization.control.required = type !== 'organization';
    jurisdiction.node.hidden = type !== 'legal-entity'; jurisdiction.control.required = type === 'legal-entity';
    scopes.legalEntity.node.hidden = type !== 'unit'; scopes.unit.node.hidden = type !== 'unit';
  };
  scopeType.control.addEventListener('change', updateType); updateType();
  const create = form('create-scope', 'Create proposed design scope', [scopeType.node, name.node, detail.node, owner.node, hierarchy, reason.node], () => {
    const type = scopeType.control.value;
    onCommand({ kind: 'create-scope', scopeType: type, name: name.control.value.trim(), detail: detail.control.value.trim(), ownerRoleId: owner.control.value || null, reason: reason.control.value.trim(),
      ...(type === 'organization' ? {} : { organizationId: scopes.organization.control.value }),
      ...(type === 'legal-entity' ? { jurisdiction: jurisdiction.control.value.trim() } : {}),
      ...(type === 'unit' ? { legalEntityId: scopes.legalEntity.control.value || null, parentUnitId: scopes.unit.control.value || null } : {}) });
  }, disabled);
  root.append(el('details', {}, [el('summary', { text: 'Create an organization, legal entity or unit' }), create]));
  if (!model.permissions?.scopeAdmin && model.context.isCurrent) root.append(el('p', { text: 'A project owner can create or rename proposed design scopes.' }));
  return root;
}

export function renderEnterpriseObject({ model, object, pending = null, loading = false, el, onCommand }) {
  const { field, form } = fields(el);
  const root = el('section', { className: 'enterprise-object', attrs: { 'aria-label': 'Selected object design scope' } });
  const scope = object.enterpriseScope;
  const assigned = scope ? Object.values(scope).some(Boolean) : false;
  const scopes = model.scopes ?? [];
  root.append(el('h4', { text: 'Proposed organizational scope' }), el('p', { text: scope ? (assigned ? 'Assigned to a design scope.' : 'Explicitly unscoped.') : 'Organizational scope is unknown; no assignment has been recorded.' }));
  if (assigned) for (const id of Object.values(scope).filter(Boolean)) root.append(el('p', { text: scopes.find((entry) => entry.id === id)?.name ?? id }));
  if (model.selection?.object?.id === object.id && !model.selection.visible) root.append(el('p', { text: `The selected record is outside this perspective: ${(model.selection.hiddenBy ?? []).map((reason) => ({ lens: 'perspective filter', scope: 'design scope filter' })[reason] ?? reason).join(', ') || 'perspective or design scope filter'}. Its saved identity and inspector remain selected.`, attrs: { 'data-enterprise-selection': '', role: 'status' } }));
  const disabled = loading || Boolean(pending) || !model.context.isCurrent;
  if (SCOPE_TYPES.has(object.type)) {
    if (object.type === 'legal-entity') root.append(el('p', { text: `Reported jurisdiction: ${object.jurisdiction || 'unknown'}` }));
    if (object.type === 'unit') root.append(el('p', { text: `Parent unit: ${scopes.find((entry) => entry.id === object.parentUnitId)?.name ?? 'None specified'}` }));
    const name = field('name', 'Scope name', { value: object.name, maximum: 120 });
    const detail = field('detail', 'Design purpose and description', { value: object.detail, multiline: true });
    const reason = field('reason', 'Reason for renaming this design scope', { multiline: true, maximum: 500 });
    root.append(form('rename-scope', 'Rename proposed design scope', [name.node, detail.node, reason.node], () => onCommand({ kind: 'rename-scope', objectId: object.id, name: name.control.value.trim(), detail: detail.control.value.trim(), reason: reason.control.value.trim() }), disabled || !model.permissions?.scopeAdmin));
  } else {
    const fields = scopeFields(el, scopes, scope ?? {});
    const reason = field('reason', 'Reason for this scope assignment', { multiline: true, maximum: 500 });
    root.append(form('assign-object-scope', 'Save proposed scope assignment', [fields.organization.node, fields.legalEntity.node, fields.unit.node, reason.node], () => onCommand({ kind: 'assign-object-scope', objectId: object.id, organizationId: fields.organization.control.value || null, legalEntityId: fields.legalEntity.control.value || null, unitId: fields.unit.control.value || null, reason: reason.control.value.trim() }), disabled || !model.permissions?.write));
  }
  return root;
}
