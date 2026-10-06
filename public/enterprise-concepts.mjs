export function conceptRecordSuccessMessage(record) {
  return `Created ${record.namespace}/${record.conceptId} record ${record.id}. HUMAN_REPORTED / UNVERIFIED; its values have not been independently verified.`;
}

export function renderEnterpriseConceptSchemas({ model, loading = false, pending = null, el, onCommand }) {
  const root = el('section', { className: 'panel panel-spaced', attrs: { 'data-concept-schemas': '', 'aria-label': 'Customer concept schemas' } }, [
    el('header', { className: 'panel-head' }, [el('h4', { text: 'Customer concept schemas' }), el('span', { text: 'Project-private · declarative only' })]),
    el('p', { text: 'Register versioned concept shapes for this project. These declarations do not add actions, run code, migrate existing objects, or grant permissions.' }),
    el('p', { text: 'Supported fields: text, number, boolean, enum, quantity with explicit units, and reference to an exact registered schema. ONE/MANY cardinality and bounded predicates only; no scripts or arbitrary expressions.' }),
    el('p', { text: 'All declared predicates block record save unless they pass. For MANY fields, every item must pass and empty lists fail. Quantity comparisons require the exact predicate unit; no unit conversion is applied.' }),
    el('p', { text: 'A correction creates a new immutable report record; it does not verify whether either report is true.' }),
  ]);
  const schemas = model.conceptSchemas ?? [];
  const records = model.conceptRecords ?? [];
  if (!schemas.length) root.append(el('p', { text: 'No customer concept schemas are registered in this project.' }));
  for (const schema of schemas) root.append(el('article', { attrs: { 'data-concept-schema': `${schema.namespace}/${schema.conceptId}@${schema.version}` } }, [
    el('h5', { text: `${schema.namespace}/${schema.conceptId} · version ${schema.version}` }),
    el('p', { text: `${schema.fields.length} fields · ${schema.predicates.length} predicates · schema hash ${schema.schemaHash}` }),
    el('p', { text: `Created by ${schema.createdBy} at ${schema.createdAt} · predecessor ${schema.predecessorHash ?? 'none'}` }),
    el('pre', { text: JSON.stringify({ fields: schema.fields, predicates: schema.predicates }, null, 2) }),
  ]));
  for (const record of records) root.append(el('article', { attrs: { 'data-concept-record': record.id } }, [
    el('h5', { text: `${record.namespace}/${record.conceptId} · ${record.id}` }),
    el('p', { text: `${record.epistemicStatus} · ${record.verificationStatus} · ${record.predicateEvaluationStatus ?? 'PREDICATE_STATUS_UNAVAILABLE'} · schema ${record.schemaVersion} · ${record.schemaHash}` }),
    el('p', { text: `${record.supersedesRecordId ? `Corrects ${record.supersedesRecordId}` : 'Original report'} · ${record.supersededBy ? `superseded by ${record.supersededBy}` : record.supersedesRecordId ? 'current correction' : 'not superseded'} · HUMAN_REPORTED / UNVERIFIED` }),
    el('p', { text: `Record hash ${record.recordHash} · reported by ${record.createdBy} at ${record.createdAt}` }),
    el('pre', { text: JSON.stringify(record.values, null, 2) }),
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
  if (schemas.length) {
    const select = el('select', { attrs: { name: 'schemaHash', 'aria-label': 'Exact registered concept schema version' } });
    select.required = true;
    for (const schema of schemas) select.append(el('option', { text: `${schema.namespace}/${schema.conceptId}@${schema.version} · ${schema.schemaHash}`,
      attrs: { value: schema.schemaHash } }));
    const fieldsContainer = el('div', { attrs: { 'data-concept-record-fields': '' } });
    const supersedesSelect = el('select', { attrs: { name: 'supersedesRecordId', 'aria-label': 'Optional report to correct' } });
    supersedesSelect.append(el('option', { text: 'Create without correcting an earlier report', attrs: { value: '' } }));
    let controlBindings = [];
    const renderValueFields = () => {
      const schema = schemas.find((entry) => entry.schemaHash === select.value);
      controlBindings = [];
      fieldsContainer.replaceChildren();
      supersedesSelect.replaceChildren(el('option', { text: 'Create without correcting an earlier report', attrs: { value: '' } }));
      if (!schema) return;
      for (const record of records.filter((entry) => entry.schemaHash === schema.schemaHash && entry.schemaVersion === schema.version && !entry.supersededBy)) {
        supersedesSelect.append(el('option', { text: `${record.id} · ${record.epistemicStatus} / ${record.verificationStatus}`,
          attrs: { value: record.id } }));
      }
      for (const field of schema.fields) {
        const label = `${field.label} (${field.type}, ${field.cardinality}${field.required ? ', required' : ', optional'})`;
        const binding = { field, controls: [] };
        if (field.cardinality === 'MANY') {
          const input = el('textarea', { attrs: { name: `values.${field.id}`, rows: '3', maxlength: '12000',
            'data-concept-field': field.id } });
          input.required = field.required;
          input.value = '';
          binding.controls = [input]; binding.kind = 'many';
          fieldsContainer.append(el('label', { text: `${label} · JSON array, at most ${field.maxItems} items` }, [input]));
        } else if (field.type === 'text') {
          const input = el('input', { attrs: { name: `values.${field.id}`, type: 'text', maxlength: '2000',
            'data-concept-field': field.id } });
          input.required = field.required;
          binding.controls = [input]; binding.kind = 'text';
          fieldsContainer.append(el('label', { text: label }, [input]));
        } else if (field.type === 'number') {
          const input = el('input', { attrs: { name: `values.${field.id}`, type: 'number', step: 'any',
            'data-concept-field': field.id } });
          input.required = field.required;
          binding.controls = [input]; binding.kind = 'number';
          fieldsContainer.append(el('label', { text: label }, [input]));
        } else if (field.type === 'boolean' || field.type === 'enum') {
          const input = el('select', { attrs: { name: `values.${field.id}`, 'data-concept-field': field.id } });
          input.required = field.required;
          input.append(el('option', { text: 'Choose a value', attrs: { value: '' } }));
          const options = field.type === 'boolean' ? [['true', 'True'], ['false', 'False']]
            : field.enumValues.map((value) => [value, value]);
          for (const [value, optionLabel] of options) input.append(el('option', { text: optionLabel, attrs: { value } }));
          binding.controls = [input]; binding.kind = field.type;
          fieldsContainer.append(el('label', { text: label }, [input]));
        } else if (field.type === 'quantity') {
          const value = el('input', { attrs: { name: `values.${field.id}.value`, type: 'number', step: 'any',
            'data-concept-field': field.id } });
          const unit = el('select', { attrs: { name: `values.${field.id}.unit`, 'data-concept-field-unit': field.id } });
          unit.append(el('option', { text: 'Choose a unit', attrs: { value: '' } }));
          for (const entry of field.units) unit.append(el('option', { text: entry, attrs: { value: entry } }));
          value.required = field.required; unit.required = field.required;
          binding.controls = [value, unit]; binding.kind = 'quantity';
          fieldsContainer.append(el('div', { className: 'enterprise-form-field' }, [
            el('span', { text: label }), el('label', { text: `${field.label} value` }, [value]),
            el('label', { text: `${field.label} unit` }, [unit]),
          ]));
        } else {
          const target = field.referenceTarget;
          const matches = records.filter((record) => record.namespace === target.namespace && record.conceptId === target.conceptId
            && record.schemaVersion === target.version && record.schemaHash === target.schemaHash);
          const input = el('select', { attrs: { name: `values.${field.id}`, 'data-concept-field': field.id } });
          input.required = field.required;
          input.append(el('option', { text: 'Choose an exact project record', attrs: { value: '' } }));
          for (const record of matches) input.append(el('option', { text: `${record.id} · ${record.recordHash}`, attrs: { value: record.id } }));
          if (!matches.length) input.disabled = true;
          binding.controls = [input]; binding.kind = 'reference';
          fieldsContainer.append(el('label', { text: `${label} · exact target ${target.namespace}/${target.conceptId}@${target.version}` }, [input]));
          if (!matches.length) fieldsContainer.append(el('p', { text: 'No existing project record matches this exact schema pin. Create the target record first.' }));
        }
        controlBindings.push(binding);
      }
    };
    select.addEventListener('change', renderValueFields);
    renderValueFields();
    const reasonInput = el('input', { attrs: { name: 'reason', maxlength: '500', 'aria-label': 'Reason for reporting this record' } });
    reasonInput.required = true; reasonInput.value = 'Report a project-specific concept record.';
    const recordForm = el('form', { className: 'enterprise-form', attrs: { 'aria-label': 'Create project concept record', 'data-enterprise-action': 'create-concept-record' } }, [
      el('label', { text: 'Registered schema version' }, [select]),
      el('p', { text: 'Native controls follow the selected schema. MANY values use a bounded JSON array; references can select only existing records with the exact pinned schema.' }),
      el('label', { text: 'Correct an earlier report (optional)' }, [supersedesSelect]),
      fieldsContainer,
      el('label', { text: 'Reason for reporting this record' }, [reasonInput]),
    ]);
    const recordSubmit = el('button', { className: 'button', text: 'Create immutable reported record', attrs: { type: 'submit' } });
    const recordError = el('p', { attrs: { role: 'alert' } }); recordError.hidden = true; recordForm.append(recordSubmit, recordError);
    recordForm.addEventListener('submit', (event) => {
        event.preventDefault(); recordError.hidden = true;
      try {
        const schema = schemas.find((entry) => entry.schemaHash === select.value);
        if (!schema) throw new Error('Choose an exact registered schema version.');
        const parsedValues = {};
        for (const binding of controlBindings) {
          const { field, controls, kind } = binding;
          if (kind === 'many') {
            const raw = controls[0].value.trim();
            if (!raw) {
              if (field.required) parsedValues[field.id] = [];
              continue;
            }
            const value = JSON.parse(raw);
            if (!Array.isArray(value)) throw new Error(`${field.label} must be a JSON array.`);
            parsedValues[field.id] = value;
          } else if (kind === 'text') {
            const value = controls[0].value;
            if (field.required && !value.trim()) throw new Error(`${field.label} is required.`);
            if (value.trim() !== '') parsedValues[field.id] = value;
          } else if (kind === 'number') {
            const raw = controls[0].value;
            if (raw !== '') {
              const value = Number(raw);
              if (!Number.isFinite(value)) throw new Error(`${field.label} must be a finite number.`);
              parsedValues[field.id] = value;
            }
            else if (field.required) throw new Error(`${field.label} is required.`);
          } else if (kind === 'boolean') {
            const raw = controls[0].value;
            if (raw !== '') parsedValues[field.id] = raw === 'true';
            else if (field.required) throw new Error(`${field.label} is required.`);
          } else if (kind === 'enum') {
            const raw = controls[0].value;
            if (raw !== '') parsedValues[field.id] = raw;
            else if (field.required) throw new Error(`${field.label} is required.`);
          } else if (kind === 'quantity') {
            const rawValue = controls[0].value; const unit = controls[1].value;
            if (rawValue === '' && unit === '' && !field.required) continue;
            if (rawValue === '' || unit === '') throw new Error(`${field.label} needs both a value and a unit.`);
            const value = Number(rawValue);
            if (!Number.isFinite(value)) throw new Error(`${field.label} must use a finite number.`);
            parsedValues[field.id] = { value, unit };
          } else {
            const raw = controls[0].value;
            if (raw !== '') parsedValues[field.id] = { recordId: raw };
            else if (field.required) throw new Error(`${field.label} is required.`);
          }
        }
        onCommand({ kind: 'create-concept-record', blueprintId: model.context.blueprintId, blueprintVersion: model.context.blueprintVersion,
          namespace: schema.namespace, conceptId: schema.conceptId, schemaVersion: schema.version, schemaHash: schema.schemaHash,
          values: parsedValues, reason: reasonInput.value.trim(), ...(supersedesSelect.value ? { supersedesRecordId: supersedesSelect.value } : {}) });
      } catch (failure) { recordError.textContent = failure.message; recordError.hidden = false; }
    });
    root.append(recordForm);
  }
  return root;
}
