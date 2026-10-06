export function renderEnterpriseConceptSchemas({ model, loading = false, pending = null, el, onCommand }) {
  const root = el('section', { className: 'panel panel-spaced', attrs: { 'data-concept-schemas': '', 'aria-label': 'Customer concept schemas' } }, [
    el('header', { className: 'panel-head' }, [el('h4', { text: 'Customer concept schemas' }), el('span', { text: 'Project-private · declarative only' })]),
    el('p', { text: 'Register versioned concept shapes for this project. These declarations do not add actions, run code, migrate existing objects, or grant permissions.' }),
    el('p', { text: 'Supported fields: text, number, boolean, enum, quantity with explicit units, and reference to an exact registered schema. ONE/MANY cardinality and bounded predicates only; no scripts or arbitrary expressions.' }),
  ]);
  const schemas = model.conceptSchemas ?? [];
  if (!schemas.length) root.append(el('p', { text: 'No customer concept schemas are registered in this project.' }));
  for (const schema of schemas) root.append(el('article', { attrs: { 'data-concept-schema': `${schema.namespace}/${schema.conceptId}@${schema.version}` } }, [
    el('h5', { text: `${schema.namespace}/${schema.conceptId} · version ${schema.version}` }),
    el('p', { text: `${schema.fields.length} fields · ${schema.predicates.length} predicates · schema hash ${schema.schemaHash}` }),
    el('p', { text: `Created by ${schema.createdBy} at ${schema.createdAt} · predecessor ${schema.predecessorHash ?? 'none'}` }),
    el('pre', { text: JSON.stringify({ fields: schema.fields, predicates: schema.predicates }, null, 2) }),
  ]));
  const writable = !loading && !pending && model.context?.isCurrent && model.permissions?.scopeAdmin;
  if (!writable) {
    root.append(el('p', { text: 'Schema registration is available to a human project owner on the current saved design.' }));
    return root;
  }
  const field = (name, label, multiline = false) => {
    const input = el(multiline ? 'textarea' : 'input', { attrs: { name, ...(multiline ? { rows: '5', maxlength: '12000' } : { maxlength: '100' }) } });
    input.required = true;
    return { input, node: el('label', { text: label }, [input]) };
  };
  const namespace = field('namespace', 'Customer namespace, for example customer.quality');
  const conceptId = field('conceptId', 'Concept ID, for example inspection');
  const fields = field('fields', 'Fields as JSON array', true);
  const predicates = field('predicates', 'Predicates as JSON array (optional)', true);
  const reason = field('reason', 'Reason for defining this schema'); reason.input.required = true;
  fields.input.value = JSON.stringify([{ id: 'sample', label: 'Sample reference', type: 'text', required: true, cardinality: 'ONE' }], null, 2);
  predicates.input.value = '[]'; predicates.input.required = false;
  reason.input.value = 'Define a project-specific concept schema.';
  const form = el('form', { className: 'enterprise-form', attrs: { 'aria-label': 'Register customer concept schema', 'data-enterprise-action': 'define-concept-schema' } },
    [namespace.node, conceptId.node, fields.node, predicates.node, reason.node]);
  const submit = el('button', { className: 'button', text: 'Register immutable schema version', attrs: { type: 'submit' } });
  const error = el('p', { attrs: { role: 'alert' } }); error.hidden = true; form.append(submit, error);
  form.addEventListener('submit', (event) => {
    event.preventDefault(); error.hidden = true;
    try {
      const parsedFields = JSON.parse(fields.input.value);
      const parsedPredicates = JSON.parse(predicates.input.value || '[]');
      if (!Array.isArray(parsedFields) || !Array.isArray(parsedPredicates)) throw new Error('Fields and predicates must be JSON arrays.');
      onCommand({ kind: 'define-concept-schema', definition: { formatVersion: 1,
        namespace: namespace.input.value.trim(), conceptId: conceptId.input.value.trim(), fields: parsedFields, predicates: parsedPredicates },
      reason: reason.input.value.trim() });
    } catch (failure) { error.textContent = failure.message; error.hidden = false; }
  });
  root.append(form);
  return root;
}
