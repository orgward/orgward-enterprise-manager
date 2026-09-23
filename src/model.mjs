import { randomUUID } from 'node:crypto';

export const AREA_DEFINITIONS = [
  ['purposeStrategy', 'Purpose & strategy'],
  ['customersOfferingsValueEconomics', 'Customers, offerings, value & economics'],
  ['capabilitiesProcesses', 'Capabilities & processes'],
  ['peopleAgents', 'People & agents'],
  ['responsibilityAuthority', 'Responsibility & authority'],
  ['resources', 'Resources'],
  ['informationTechnology', 'Information & technology'],
  ['governanceRiskControls', 'Governance, risk & controls'],
  ['metricsFeedback', 'Metrics & feedback'],
  ['lifecycle', 'Lifecycle'],
];

const VALID_STATUSES = new Set(['designed', 'unknown', 'out_of_scope']);
const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);

function compact(value, max = 220) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function titleFromDescription(description) {
  const words = compact(description, 80).split(' ').filter(Boolean).slice(0, 6);
  if (!words.length) return 'New enterprise';
  return words.join(' ').replace(/[.,;:!?]+$/g, '');
}

function item(id, type, name, detail, source, extra = {}) {
  return {
    id,
    type,
    name,
    detail,
    status: 'designed',
    confidence: 'medium',
    provenance: [{ source, note: 'Founder-provided chat answer' }],
    ...extra,
  };
}

function area(label, items, status = 'designed') {
  return { label, status, items };
}

export function createProject(name) {
  const now = new Date().toISOString();
  const id = `project-${randomUUID()}`;
  return {
    id,
    name: compact(name, 80) || 'Untitled enterprise',
    createdAt: now,
    updatedAt: now,
    phase: 'discovery',
    questionIndex: 0,
    answers: {},
    brief: null,
    blueprintVersions: [],
    conversation: [
      {
        id: randomUUID(),
        role: 'assistant',
        createdAt: now,
        content: 'What business do you want to create, and what outcome should it produce for customers?',
      },
    ],
    audit: [{ at: now, action: 'project.created', detail: 'Private project created' }],
  };
}

const QUESTIONS = [
  {
    key: 'description',
    next: 'Who are the primary customers, what will you offer them, and why should they choose it?',
  },
  {
    key: 'commercial',
    next: 'How will the business earn or receive money, and which costs or constraints matter most at launch?',
  },
  {
    key: 'economics',
    next: 'Which decisions must remain human-led, and which data, tools, or automation do you expect the operation to use?',
  },
  { key: 'operatingModel', next: null },
];

export function addConversationTurn(project, rawContent) {
  const content = compact(rawContent, 2_000);
  if (!content) throw new Error('Message content is required.');
  if (project.phase !== 'discovery') {
    throw new Error('This first increment has finished discovery. Start a new project for another business.');
  }

  const now = new Date().toISOString();
  const question = QUESTIONS[project.questionIndex];
  if (!question) throw new Error('Discovery is already complete.');

  project.conversation.push({ id: randomUUID(), role: 'user', createdAt: now, content });
  project.answers[question.key] = content;
  project.questionIndex += 1;

  if (question.next) {
    project.conversation.push({
      id: randomUUID(),
      role: 'assistant',
      createdAt: now,
      content: question.next,
    });
  } else {
    project.brief = createBrief(project.answers);
    const blueprint = createBlueprint(project);
    project.blueprintVersions.push(blueprint);
    project.phase = 'blueprint_ready';
    project.conversation.push({
      id: randomUUID(),
      role: 'assistant',
      createdAt: now,
      content: `I saved blueprint v${blueprint.version}. It contains ${blueprint.summary.objectCount} linked objects across ${AREA_DEFINITIONS.length} design areas, with ${blueprint.integrity.gaps.length} explicit gaps to resolve. Open the map to explore it.`,
    });
    project.audit.push({
      at: now,
      action: 'blueprint.generated',
      detail: `Version ${blueprint.version} generated from four founder answers`,
    });
  }
  project.updatedAt = now;
  return project;
}

export function createBrief(answers) {
  return {
    savedAt: new Date().toISOString(),
    title: titleFromDescription(answers.description),
    scope: compact(answers.description, 500),
    customerValue: compact(answers.commercial, 500),
    economicsAndConstraints: compact(answers.economics, 500),
    operatingIntent: compact(answers.operatingModel, 500),
    assumptions: [
      'The founder answers describe the intended launch scope rather than verified operating evidence.',
      'The initial operating model is deliberately small and can be specialised in later versions.',
      'All generated assignments are proposals; none authorise external action.',
    ],
    unknowns: [
      'Jurisdiction, legal form, and required registrations are not yet confirmed.',
      'Customer demand, pricing, and unit economics have not yet been evidenced.',
      'Named people, production systems, credentials, and external integrations are not yet configured.',
    ],
  };
}

export function createBlueprint(project) {
  const a = project.answers;
  const source = 'chat:founder-discovery';
  const businessName = project.brief?.title || project.name;

  const areas = {
    purposeStrategy: area('Purpose & strategy', [
      item('goal-customer-outcome', 'goal', 'Deliver the promised customer outcome', compact(a.description), source, {
        owner: 'role-founder', metric: 'metric-outcome', horizon: 'Launch and first operating cycle',
      }),
      item('strategy-focused-launch', 'strategy', 'Focused launch strategy', `Validate a narrow version of ${businessName} before scaling scope.`, source, {
        owner: 'role-founder',
      }),
    ]),
    customersOfferingsValueEconomics: area('Customers, offerings, value & economics', [
      item('customer-primary', 'customer', 'Primary customer', compact(a.commercial), source),
      item('offering-core', 'offering', 'Core offering', compact(a.commercial), source, {
        serves: ['customer-primary'], enabledBy: ['capability-customer-discovery', 'capability-delivery'],
      }),
      item('economics-launch', 'economics', 'Launch economics', compact(a.economics), source, {
        owner: 'role-founder', metric: 'metric-sustainability',
      }),
    ]),
    capabilitiesProcesses: area('Capabilities & processes', [
      item('capability-customer-discovery', 'capability', 'Customer discovery', 'Turn customer signals into a prioritised offer and evidence.', source, {
        owner: 'role-founder', realisers: ['process-learn'], metrics: ['metric-demand'],
      }),
      item('capability-delivery', 'capability', 'Offer delivery', 'Reliably create and deliver the promised customer result.', source, {
        owner: 'role-operations', realisers: ['process-deliver'], metrics: ['metric-outcome'],
      }),
      item('capability-steering', 'capability', 'Enterprise steering', 'Review evidence, risk, and economics and adapt the design.', source, {
        owner: 'role-founder', realisers: ['process-review'], metrics: ['metric-sustainability'],
      }),
      item('process-learn', 'process', 'Discover and qualify demand', 'Capture a signal, test the need, and update priorities.', source, {
        owner: 'role-founder', capability: 'capability-customer-discovery', trigger: 'New customer signal',
        inputs: ['information-customer-signal'], outputs: ['information-prioritised-need'],
        resources: ['resource-founder-time'], systems: ['system-studio'],
      }),
      item('process-deliver', 'process', 'Deliver the core offering', 'Accept a qualified request, perform the work, and record the outcome.', source, {
        owner: 'role-operations', capability: 'capability-delivery', trigger: 'Qualified customer request',
        inputs: ['information-prioritised-need'], outputs: ['information-delivery-result'],
        resources: ['resource-operating-capacity'], systems: ['system-studio'],
      }),
      item('process-review', 'process', 'Review and steer the enterprise', 'Compare results with goals and approve corrective action.', source, {
        owner: 'role-founder', capability: 'capability-steering', trigger: 'Weekly review cadence',
        inputs: ['information-delivery-result'], outputs: ['decision-priority'],
        resources: ['resource-founder-time'], systems: ['system-studio'],
      }),
    ]),
    peopleAgents: area('People & agents', [
      item('actor-founder', 'actor-human', 'Founder', 'Human accountable for scope, authority, and launch decisions.', source, {
        assignedRoles: ['role-founder'],
      }),
      item('actor-design-assistant', 'actor-agent', 'Org design assistant', 'Proposes structures and gaps; has no external-action authority.', source, {
        assignedRoles: ['role-design-assistant'],
      }),
    ]),
    responsibilityAuthority: area('Responsibility & authority', [
      item('role-founder', 'role', 'Founder / enterprise owner', 'Owns purpose, economics, risk acceptance, and delegation.', source, {
        responsibilities: ['goal-customer-outcome', 'capability-customer-discovery', 'capability-steering'],
        proposedScopeStatements: ['Approve blueprint changes', 'Accept risk', 'Authorise assignments'],
        proposedToolStatements: ['Blueprint editor', 'Coverage and version history'],
        proposedEscalationRules: ['Escalate unowned critical risks for human review'],
      }),
      item('role-operations', 'role', 'Operations owner', 'Owns repeatable delivery and service evidence.', source, {
        responsibilities: ['capability-delivery', 'process-deliver'],
        proposedScopeStatements: ['Sequence internal delivery work', 'Escalate blocked delivery'],
        proposedToolStatements: ['Delivery plan', 'Service outcome record'],
        proposedEscalationRules: ['Escalate blocked delivery or safety concerns to the founder'],
      }),
      item('role-design-assistant', 'role', 'Design assistant', 'Drafts proposed structures and highlights integrity gaps.', source, {
        responsibilities: ['system-studio'],
        proposedScopeStatements: ['Propose only; no enabled external actions'],
        proposedToolStatements: ['Blueprint draft and gap summary'],
        proposedEscalationRules: ['Send uncertain or consequential proposals to a workspace owner'],
      }),
    ]),
    resources: area('Resources', [
      item('resource-founder-time', 'resource', 'Founder attention', 'Decision and learning capacity available during launch.', source, { owner: 'role-founder' }),
      item('resource-operating-capacity', 'resource', 'Delivery capacity', compact(a.economics), source, { owner: 'role-operations' }),
    ]),
    informationTechnology: area('Information & technology', [
      item('information-customer-signal', 'information', 'Customer signal', 'Need, context, provenance, and strength of evidence.', source, { owner: 'role-founder' }),
      item('information-prioritised-need', 'information', 'Prioritised customer need', 'A qualified need ready for delivery.', source, { owner: 'role-founder' }),
      item('information-delivery-result', 'information', 'Delivery result', 'Recorded output, customer outcome, and exceptions.', source, { owner: 'role-operations' }),
      item('system-studio', 'system', 'OrgWard Enterprise Studio', `Private design workspace. Intended tools and automation: ${compact(a.operatingModel)}`, source, {
        owner: 'role-founder', supports: ['process-learn', 'process-deliver', 'process-review'],
      }),
    ]),
    governanceRiskControls: area('Governance, risk & controls', [
      item('decision-priority', 'decision', 'Operating priority decision', 'Choose the next corrective or investment action from review evidence.', source, {
        by: 'role-founder', scope: ['goal-customer-outcome', 'capability-steering'],
      }),
      item('risk-unvalidated-demand', 'risk', 'Unvalidated demand', 'The intended offer may not solve a sufficiently valuable customer need.', source, {
        owner: 'role-founder', control: 'control-evidence-review',
      }),
      item('risk-unsafe-automation', 'risk', 'Unapproved automated action', 'Automation could exceed the authority intended by the founder.', source, {
        owner: 'role-founder', control: 'control-human-authority',
      }),
      item('control-evidence-review', 'control', 'Evidence review before scaling', 'Review demand and outcome evidence before adding capacity.', source, {
        owner: 'role-founder', mitigates: ['risk-unvalidated-demand'],
      }),
      item('control-human-authority', 'control', 'Human authority boundary', compact(a.operatingModel), source, {
        owner: 'role-founder', mitigates: ['risk-unsafe-automation'],
      }),
    ]),
    metricsFeedback: area('Metrics & feedback', [
      item('metric-demand', 'metric', 'Qualified demand', 'Count and quality of validated customer needs.', source, {
        owner: 'role-founder', reads: 'information-customer-signal', consumerLoop: 'loop-weekly-steering',
      }),
      item('metric-outcome', 'metric', 'Customer outcome achieved', 'Share of deliveries that achieve the promised result.', source, {
        owner: 'role-operations', reads: 'information-delivery-result', consumerLoop: 'loop-weekly-steering',
      }),
      item('metric-sustainability', 'metric', 'Operating sustainability', 'Revenue or funding relative to delivery cost and constraints.', source, {
        owner: 'role-founder', reads: 'economics-launch', consumerLoop: 'loop-weekly-steering',
      }),
      item('loop-weekly-steering', 'feedback-loop', 'Weekly enterprise steering', 'Sense results, compare with goals, decide, act, and measure again.', source, {
        goal: 'goal-customer-outcome', owner: 'role-founder', cadence: 'Weekly',
        threshold: 'Any material miss or unowned critical risk', decisionIds: ['decision-priority'],
        evidence: ['metric-demand', 'metric-outcome', 'metric-sustainability'],
      }),
    ]),
    lifecycle: area('Lifecycle', [
      item('lifecycle-enterprise', 'lifecycle', 'Enterprise lifecycle', 'The designed enterprise moves through explicit evidence states.', source, {
        owner: 'role-founder', stages: ['Proposed', 'Tested', 'Enabled', 'Operating', 'Reviewed', 'Retired'],
      }),
    ]),
  };

  const relations = buildRelations(areas);
  const blueprint = {
    id: `blueprint-${randomUUID()}`,
    version: project.blueprintVersions.length + 1,
    createdAt: new Date().toISOString(),
    title: `${businessName} organisational blueprint`,
    epistemicStatus: 'proposed-design',
    areas,
    relations,
    assumptions: project.brief.assumptions,
    unknowns: project.brief.unknowns,
    gaps: [
      { id: 'gap-legal-form', severity: 'medium', area: 'governanceRiskControls', action: 'Confirm jurisdiction, legal form, registrations, and applicable obligations.' },
      { id: 'gap-market-evidence', severity: 'high', area: 'customersOfferingsValueEconomics', action: 'Attach evidence for demand, pricing, and unit economics before enabling scale decisions.' },
      { id: 'gap-assignments', severity: 'medium', area: 'peopleAgents', action: 'Name and enable the people or agents responsible for operations before running processes.' },
    ],
  };
  const integrity = validateBlueprint(blueprint);
  blueprint.integrity = integrity;
  blueprint.summary = {
    areaCount: Object.keys(areas).length,
    objectCount: Object.values(areas).reduce((sum, entry) => sum + entry.items.length, 0),
    relationCount: relations.length,
    designedAreas: Object.values(areas).filter((entry) => entry.status === 'designed').length,
  };
  return blueprint;
}

function editFailure(message, code = 'INVALID_BLUEPRINT_EDIT', statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}

function displayObjectForEdit(blueprint, object) {
  const roles = Object.values(blueprint.areas).flatMap((entry) => entry.items).filter((candidate) => candidate.type === 'role');
  const legacy = Array.isArray(object.authority) ? object.authority : [];
  return {
    name: object.name,
    detail: object.detail,
    ...(object.owner ? { ownerRoleName: roles.find((role) => role.id === object.owner)?.name ?? null } : {}),
    ...(object.type === 'process' ? { trigger: object.trigger ?? '' } : {}),
    ...(object.type === 'role' ? { proposedInstructions: object.proposedInstructions ?? '', proposedScopeStatements: object.proposedScopeStatements ?? legacy.filter((value) => !(typeof value === 'string' && value.startsWith('decision-'))) } : {}),
    ...(object.type === 'role' ? {
      proposedToolStatements: object.proposedToolStatements ?? [],
      proposedEscalationRules: object.proposedEscalationRules ?? [],
    } : {}),
  };
}

function displayRelations(blueprint, objectId) {
  const objects = new Map(Object.values(blueprint.areas).flatMap((entry) => entry.items).map((object) => [object.id, object.name]));
  return blueprint.relations.filter((relation) => relation.source === objectId || relation.target === objectId)
    .map((relation) => ({ type: relation.type, source: objects.get(relation.source), target: objects.get(relation.target) }));
}

export function editBlueprintObject(project, payload, actor) {
  const previous = latestBlueprint(project);
  if (!previous) editFailure('A saved blueprint is required before editing.', 'BLUEPRINT_NOT_FOUND', 409);
  let original = null;
  let areaKey = null;
  for (const [key, entry] of Object.entries(previous.areas)) {
    const candidate = entry.items.find((itemValue) => itemValue.id === payload.objectId);
    if (candidate) { original = candidate; areaKey = key; break; }
  }
  if (!original) editFailure('Blueprint object not found.', 'BLUEPRINT_OBJECT_NOT_FOUND', 404);
  if (!['capability', 'process', 'role'].includes(original.type)) editFailure('Only capabilities, processes and roles can be edited in this workspace.', 'BLUEPRINT_OBJECT_NOT_EDITABLE', 400);

  const fields = {
    capability: ['objectId', 'name', 'detail', 'ownerRoleName'],
    process: ['objectId', 'name', 'detail', 'ownerRoleName', 'trigger'],
    role: ['objectId', 'name', 'detail', 'proposedInstructions', 'proposedScopeStatements', 'proposedToolStatements', 'proposedEscalationRules'],
  }[original.type];
  if (Object.keys(payload).some((field) => !fields.includes(field))) editFailure('The edit contains fields that do not apply to this object type.');
  if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 120
    || typeof payload.detail !== 'string' || !payload.detail.trim() || payload.detail.length > 700) {
    editFailure('Provide a name of 1–120 characters and detail of 1–700 characters.');
  }
  if (original.type === 'process' && (typeof payload.trigger !== 'string' || !payload.trigger.trim() || payload.trigger.length > 240)) {
    editFailure('Provide a process trigger of 1–240 characters.');
  }
  if (original.type === 'role' && (typeof payload.proposedInstructions !== 'string' || !payload.proposedInstructions.trim() || payload.proposedInstructions.length > 700)) {
    editFailure('Provide proposed instructions of 1–700 characters.');
  }
  if (original.type === 'role' && (!Array.isArray(payload.proposedScopeStatements) || !payload.proposedScopeStatements.length
    || payload.proposedScopeStatements.length > 12 || payload.proposedScopeStatements.some((statement) => typeof statement !== 'string' || !statement.trim() || statement.trim().length > 240))) {
    editFailure('Provide 1–12 proposed scope statements of 1–240 characters each.');
  }
  for (const field of ['proposedToolStatements', 'proposedEscalationRules']) {
    if (original.type === 'role' && payload[field] !== undefined && (!Array.isArray(payload[field]) || payload[field].length > 12
      || payload[field].some((statement) => typeof statement !== 'string' || !statement.trim() || statement.trim().length > 240))) {
      editFailure(`Provide up to 12 ${field === 'proposedToolStatements' ? 'proposed tool statements' : 'proposed escalation rules'} of 1–240 characters each.`);
    }
  }

  const next = structuredClone(previous);
  const itemValue = next.areas[areaKey].items.find((candidate) => candidate.id === payload.objectId);
  let role = null;
  if (original.type === 'capability' || original.type === 'process') {
    const roleName = String(payload.ownerRoleName ?? '').trim();
    const matches = Object.values(next.areas).flatMap((entry) => entry.items)
      .filter((candidate) => candidate.type === 'role' && candidate.name.toLocaleLowerCase() === roleName.toLocaleLowerCase());
    if (!roleName || matches.length !== 1) editFailure('Choose one existing role by its exact displayed name.', 'INVALID_BLUEPRINT_RELATION');
    [role] = matches;
  }
  if (original.type === 'role') {
    const duplicate = Object.values(next.areas).flatMap((entry) => entry.items)
      .some((candidate) => candidate.type === 'role' && candidate.id !== original.id
        && candidate.name.toLocaleLowerCase() === payload.name.toLocaleLowerCase());
    if (duplicate) editFailure('Role names must remain unique so owner relationships are unambiguous.', 'INVALID_BLUEPRINT_RELATION');
  }

  const before = displayObjectForEdit(previous, original);
  itemValue.name = payload.name;
  itemValue.detail = payload.detail;
  if (role) itemValue.owner = role.id;
  if (original.type === 'process') itemValue.trigger = payload.trigger;
  if (original.type === 'role') {
    const validDecisionIds = new Set(Object.values(next.areas).flatMap((entry) => entry.items).filter((candidate) => candidate.type === 'decision').map((candidate) => candidate.id));
    const legacyLinks = Array.isArray(itemValue.authority) ? itemValue.authority.filter((value) => typeof value === 'string' && validDecisionIds.has(value)) : [];
    itemValue.proposedInstructions = payload.proposedInstructions;
    itemValue.proposedScopeStatements = payload.proposedScopeStatements.map((statement) => statement.trim());
    itemValue.proposedToolStatements = (payload.proposedToolStatements ?? itemValue.proposedToolStatements ?? []).map((statement) => statement.trim());
    itemValue.proposedEscalationRules = (payload.proposedEscalationRules ?? itemValue.proposedEscalationRules ?? []).map((statement) => statement.trim());
    itemValue.decisionIds = [...new Set([...(itemValue.decisionIds ?? legacyLinks)].filter((value) => validDecisionIds.has(value)))];
    delete itemValue.authority;
  }

  const at = new Date().toISOString();
  const after = displayObjectForEdit(next, itemValue);
  const changedFields = Object.keys(after).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  if (!changedFields.length) editFailure('This edit does not change the selected object.', 'BLUEPRINT_EDIT_NO_CHANGE');
  itemValue.provenance ??= [];
  itemValue.provenance.push({ source: 'workspace:blueprint-edit', note: 'Edited by a verified workspace member', actor, at, fields: changedFields });
  next.id = `blueprint-${randomUUID()}`;
  next.version = Math.max(...project.blueprintVersions.map((entry) => entry.version), previous.version) + 1;
  next.createdAt = at;
  next.epistemicStatus = 'proposed-design';
  next.relations = buildRelations(next.areas);
  next.edit = {
    actor, at, objectId: itemValue.id, objectType: itemValue.type, changedFields,
    before, after,
    relationsBefore: displayRelations(previous, itemValue.id),
    relationsAfter: displayRelations(next, itemValue.id),
  };
  next.integrity = validateBlueprint(next);
  next.summary = {
    areaCount: Object.keys(next.areas).length,
    objectCount: Object.values(next.areas).reduce((sum, entry) => sum + entry.items.length, 0),
    relationCount: next.relations.length,
    designedAreas: Object.values(next.areas).filter((entry) => entry.status === 'designed').length,
  };
  project.blueprintVersions.push(next);
  project.audit ??= [];
  project.audit.push({ at, action: 'blueprint.object-edited', actor, detail: `Edited ${itemValue.type} “${itemValue.name}” in blueprint v${next.version}.` });
  return next;
}

export function planProcessTaskGraph(project, processId, actor) {
  const blueprint = latestBlueprint(project);
  if (!blueprint) throw Object.assign(new Error('A saved blueprint is required before planning a process.'), { code: 'BLUEPRINT_NOT_FOUND', statusCode: 409 });
  const allObjects = Object.values(blueprint.areas ?? {}).flatMap((entry) => entry.items ?? []);
  const byId = new Map(allObjects.map((itemValue) => [itemValue.id, itemValue]));
  const processes = allObjects.filter((itemValue) => itemValue.type === 'process');
  const root = byId.get(processId);
  if (!root || root.type !== 'process') throw Object.assign(new Error('Choose an existing process from the latest saved blueprint.'), { code: 'BLUEPRINT_PROCESS_NOT_FOUND', statusCode: 400 });
  const producers = new Map();
  for (const process of processes) for (const outputId of process.outputs ?? []) {
    if (!byId.has(outputId)) continue;
    if (!producers.has(outputId)) producers.set(outputId, []);
    producers.get(outputId).push(process);
  }
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  const dependencies = new Map();
  const visit = (process) => {
    if (visiting.has(process.id)) throw Object.assign(new Error('The process input/output relationships contain a cycle and cannot be planned.'), { code: 'PROCESS_GRAPH_CYCLE', statusCode: 409 });
    if (visited.has(process.id)) return;
    if (visited.size >= 32) throw Object.assign(new Error('The planned graph exceeds 32 process tasks.'), { code: 'PROCESS_GRAPH_TOO_LARGE', statusCode: 400 });
    visiting.add(process.id);
    const upstream = [...new Map((process.inputs ?? []).flatMap((inputId) => producers.get(inputId) ?? [])
      .filter((candidate) => candidate.id !== process.id).map((candidate) => [candidate.id, candidate])).values()];
    dependencies.set(process.id, upstream.map((candidate) => candidate.id));
    for (const candidate of upstream) visit(candidate);
    visiting.delete(process.id);
    visited.add(process.id);
    ordered.push(process);
  };
  visit(root);
  const planId = `process-plan-${randomUUID()}`;
  const tasks = ordered.map((process) => {
    const role = byId.get(process.owner);
    const reference = (id) => {
      const object = byId.get(id);
      if (!object) throw Object.assign(new Error('The process refers to an object missing from its saved blueprint.'), { code: 'INVALID_PROCESS_REFERENCE', statusCode: 409 });
      return { objectId: object.id, label: object.name, type: object.type };
    };
    return {
      id: `task-${process.id}`, sourceProcessId: process.id,
      title: process.name, detail: process.detail, trigger: process.trigger ?? '',
      status: 'planned', dependencies: (dependencies.get(process.id) ?? []).map((id) => `task-${id}`),
      inputs: (process.inputs ?? []).map(reference), outputs: (process.outputs ?? []).map(reference),
      assignee: role?.type === 'role'
        ? { kind: 'role-reference', roleId: role.id, roleName: role.name, state: 'unassigned' }
        : { kind: 'unassigned', state: 'unassigned' },
    };
  });
  const at = new Date().toISOString();
  return {
    id: planId, version: 1, revision: 1, state: 'planned', epistemicStatus: 'proposed-design',
    source: { projectId: project.id, blueprintId: blueprint.id, blueprintVersion: blueprint.version, processId: root.id, processName: root.name },
    createdAt: at, createdBy: actor, tasks,
  };
}

export function editProcessTaskGraph(project, planId, payload, actor) {
  const revisions = (project.processPlans ?? []).filter((plan) => plan.id === planId)
    .sort((left, right) => (left.revision ?? 1) - (right.revision ?? 1));
  const current = revisions.at(-1);
  if (!current) throw Object.assign(new Error('Planning graph not found.'), { code: 'PROCESS_PLAN_NOT_FOUND', statusCode: 404 });
  if (!Array.isArray(payload.tasks) || payload.tasks.length !== current.tasks.length || payload.tasks.length < 1 || payload.tasks.length > 32) {
    throw Object.assign(new Error('Provide one edit for every task in this graph (maximum 32).'), { code: 'INVALID_PROCESS_PLAN_EDIT', statusCode: 400 });
  }
  const blueprint = project.blueprintVersions?.find((candidate) => candidate.id === current.source.blueprintId
    && candidate.version === current.source.blueprintVersion);
  if (!blueprint) throw Object.assign(new Error('The pinned source blueprint is unavailable; this graph cannot be edited.'), { code: 'PROCESS_PLAN_SOURCE_UNAVAILABLE', statusCode: 409 });
  const blueprintObjects = Object.values(blueprint.areas ?? {}).flatMap((entry) => entry.items ?? []);
  const blueprintById = new Map(blueprintObjects.map((itemValue) => [itemValue.id, itemValue]));
  const roles = new Set(blueprintObjects.filter((itemValue) => itemValue.type === 'role').map((itemValue) => itemValue.id));
  const currentById = new Map(current.tasks.map((task) => [task.id, task]));
  const supplied = new Map();
  for (const edit of payload.tasks) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)
      || Object.keys(edit).some((key) => !['taskId', 'title', 'detail', 'dependencies', 'roleId', 'actorId'].includes(key))) {
      throw Object.assign(new Error('Task edits contain unsupported fields.'), { code: 'INVALID_PROCESS_PLAN_EDIT', statusCode: 400 });
    }
    if (typeof edit.taskId !== 'string' || !currentById.has(edit.taskId) || supplied.has(edit.taskId)) {
      throw Object.assign(new Error('Task edits must reference each task exactly once.'), { code: 'INVALID_PROCESS_PLAN_TASK', statusCode: 400 });
    }
    if (typeof edit.title !== 'string' || !edit.title.trim() || edit.title.trim().length > 120
      || typeof edit.detail !== 'string' || !edit.detail.trim() || edit.detail.trim().length > 700) {
      throw Object.assign(new Error('Task title must be 1–120 characters and detail 1–700 characters.'), { code: 'INVALID_PROCESS_PLAN_TEXT', statusCode: 400 });
    }
    if (!Array.isArray(edit.dependencies) || edit.dependencies.length > current.tasks.length - 1
      || edit.dependencies.some((dependency) => typeof dependency !== 'string' || !currentById.has(dependency) || dependency === edit.taskId)
      || new Set(edit.dependencies).size !== edit.dependencies.length) {
      throw Object.assign(new Error('Dependencies must be unique references to other tasks in this graph.'), { code: 'INVALID_PROCESS_PLAN_DEPENDENCY', statusCode: 400 });
    }
    if (!Object.hasOwn(edit, 'roleId') || (edit.roleId !== null && (typeof edit.roleId !== 'string' || !roles.has(edit.roleId)))) {
      throw Object.assign(new Error('Choose a role present in the graph’s pinned blueprint, or leave the task unassigned.'), { code: 'INVALID_PROCESS_PLAN_ROLE', statusCode: 400 });
    }
    if (!Object.hasOwn(edit, 'actorId') || (edit.actorId !== null && typeof edit.actorId !== 'string')) {
      throw Object.assign(new Error('Choose an eligible blueprint actor or leave the task without a person assignment.'), { code: 'INVALID_PROCESS_PLAN_ACTOR', statusCode: 400 });
    }
    if (edit.actorId !== null) {
      const actor = blueprintById.get(edit.actorId);
      const linked = actor && edit.roleId && ['actor-human', 'actor-agent'].includes(actor.type)
        && ((actor.assignedRoles ?? []).includes(edit.roleId)
          || (blueprint.relations ?? []).some((relation) => relation.source === edit.actorId
            && relation.target === edit.roleId && relation.type === 'assigned-to'));
      if (!linked) throw Object.assign(new Error('The blueprint actor must be linked to the selected role in the pinned blueprint.'), { code: 'INVALID_PROCESS_PLAN_ACTOR_ROLE', statusCode: 400 });
    }
    const old = currentById.get(edit.taskId);
    if (old.assignee?.roleId !== edit.roleId && edit.actorId
      && edit.actorId === old.assignee?.actorId) {
      throw Object.assign(new Error('Changing a task role clears its previous actor selection. Choose an eligible actor again for the new role.'), { code: 'PROCESS_PLAN_ACTOR_ROLE_CHANGED', statusCode: 400 });
    }
    const processId = old.sourceProcessId ?? old.id.replace(/^task-/, '');
    const sourceProcess = blueprintById.get(processId);
    if (!sourceProcess || sourceProcess.type !== 'process') {
      throw Object.assign(new Error('A task no longer resolves to a process in its pinned blueprint.'), { code: 'INVALID_PROCESS_PLAN_SOURCE', statusCode: 409 });
    }
    for (const kind of ['inputs', 'outputs']) {
      const ids = sourceProcess[kind] ?? [];
      const references = old[kind];
      if (!Array.isArray(references) || references.length !== ids.length
        || references.some((reference, index) => {
          const linked = blueprintById.get(ids[index]);
          return !linked || reference.objectId !== linked.id || reference.label !== linked.name || reference.type !== linked.type;
        })) {
        throw Object.assign(new Error('A saved input/output reference does not match the pinned blueprint.'), { code: 'INVALID_PROCESS_PLAN_REFERENCE', statusCode: 409 });
      }
    }
    supplied.set(edit.taskId, edit);
  }
  if (supplied.size !== currentById.size) throw Object.assign(new Error('Task edits must include each task exactly once.'), { code: 'INVALID_PROCESS_PLAN_TASK', statusCode: 400 });

  const visiting = new Set();
  const visited = new Set();
  const visit = (taskId) => {
    if (visiting.has(taskId)) throw Object.assign(new Error('Task dependencies must not contain a cycle.'), { code: 'PROCESS_GRAPH_CYCLE', statusCode: 409 });
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of supplied.get(taskId).dependencies) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const taskId of supplied.keys()) visit(taskId);

  const next = structuredClone(current);
  const changedTasks = [];
  next.tasks = next.tasks.map((task) => {
    const edit = supplied.get(task.id);
    const role = edit.roleId ? blueprintById.get(edit.roleId) : null;
    const updated = {
      ...task,
      title: edit.title.trim(), detail: edit.detail.trim(), dependencies: [...edit.dependencies],
      assignee: edit.actorId !== null ? { kind: 'blueprint-actor', actorId: edit.actorId, roleId: edit.roleId }
        : role ? { kind: 'role-reference', roleId: role.id, roleName: role.name, state: 'unassigned' }
        : { kind: 'unassigned', state: 'unassigned' },
      status: 'planned',
    };
    if (updated.title !== task.title || updated.detail !== task.detail
      || JSON.stringify(updated.dependencies) !== JSON.stringify(task.dependencies)
      || JSON.stringify(updated.assignee) !== JSON.stringify(task.assignee)) changedTasks.push(task.id);
    return updated;
  });
  if (!changedTasks.length) throw Object.assign(new Error('This edit does not change the planned graph.'), { code: 'PROCESS_PLAN_EDIT_NO_CHANGE', statusCode: 400 });
  next.revision = (current.revision ?? 1) + 1;
  next.createdAt = new Date().toISOString();
  next.createdBy = actor;
  next.changedTasks = changedTasks;
  project.processPlans.push(next);
  return next;
}

function buildRelations(areas) {
  const relations = [];
  const add = (source, target, type) => relations.push({ id: `${source}--${type}--${target}`, source, target, type });
  const decisions = new Set(Object.values(areas).flatMap((entry) => entry.items).filter((object) => object.type === 'decision').map((object) => object.id));
  for (const entry of Object.values(areas)) {
    for (const object of entry.items) {
      if (object.owner) add(object.owner, object.id, 'owns');
      if (object.metric) add(object.metric, object.id, 'measures');
      for (const target of object.metrics ?? []) add(target, object.id, 'measures');
      for (const target of object.realisers ?? []) add(target, object.id, 'realises');
      for (const target of object.serves ?? []) add(object.id, target, 'serves');
      for (const target of object.enabledBy ?? []) add(target, object.id, 'enables');
      for (const target of object.assignedRoles ?? []) add(object.id, target, 'assigned-to');
      for (const target of object.responsibilities ?? []) add(object.id, target, 'accountable-for');
      for (const target of object.inputs ?? []) add(target, object.id, 'input-to');
      for (const target of object.outputs ?? []) add(object.id, target, 'produces');
      for (const target of object.resources ?? []) add(target, object.id, 'resources');
      for (const target of object.systems ?? []) add(target, object.id, 'supports');
      for (const target of object.supports ?? []) add(object.id, target, 'supports');
      for (const target of object.scope ?? []) add(object.id, target, 'governs');
      for (const target of object.mitigates ?? []) add(object.id, target, 'mitigates');
      if (object.control) add(object.control, object.id, 'mitigates');
      if (object.reads) add(object.reads, object.id, 'read-by');
      if (object.consumerLoop) add(object.id, object.consumerLoop, 'feeds');
      if (object.goal) add(object.id, object.goal, 'steers');
      for (const target of object.evidence ?? []) add(target, object.id, 'evidences');
      const legacyDecisionIds = (object.authority ?? []).filter((target) => typeof target === 'string' && decisions.has(target));
      for (const target of object.decisionIds ?? legacyDecisionIds) if (decisions.has(target)) add(target, object.id, 'authorises');
      if (object.capability) add(object.id, object.capability, 'realises');
    }
  }
  return [...new Map(relations.map((relation) => [relation.id, relation])).values()];
}

export function validateBlueprint(blueprint) {
  const errors = [];
  const gaps = [...(blueprint.gaps ?? [])];
  const objects = [];

  for (const [key, label] of AREA_DEFINITIONS) {
    const entry = blueprint.areas?.[key];
    if (!entry) {
      errors.push({ code: 'AREA_MISSING', path: `areas.${key}`, message: `${label} area is required.` });
      continue;
    }
    if (!VALID_STATUSES.has(entry.status)) {
      errors.push({ code: 'AREA_STATUS_INVALID', path: `areas.${key}.status`, message: 'Area status must be designed, unknown, or out_of_scope.' });
    }
    if (entry.status === 'designed' && (!Array.isArray(entry.items) || entry.items.length === 0)) {
      errors.push({ code: 'AREA_EMPTY', path: `areas.${key}.items`, message: 'A designed area must contain at least one object.' });
    }
    for (const object of entry.items ?? []) objects.push({ ...object, area: key });
  }

  const ids = new Set();
  for (const object of objects) {
    if (!object.id || ids.has(object.id)) errors.push({ code: 'OBJECT_ID_INVALID', path: object.area, message: `Object id is missing or duplicated: ${object.id ?? '(missing)'}.` });
    ids.add(object.id);
    if (!VALID_STATUSES.has(object.status)) errors.push({ code: 'OBJECT_STATUS_INVALID', path: object.id, message: 'Object status is invalid.' });
    if (!VALID_CONFIDENCE.has(object.confidence)) errors.push({ code: 'CONFIDENCE_INVALID', path: object.id, message: 'Confidence must be low, medium, or high.' });
    if (!Array.isArray(object.provenance) || object.provenance.length === 0) gaps.push({ id: `gap-provenance-${object.id}`, severity: 'medium', area: object.area, action: `Add provenance to ${object.name}.` });
    if (['goal', 'capability', 'process', 'risk', 'control', 'metric', 'lifecycle'].includes(object.type) && !object.owner) gaps.push({ id: `gap-owner-${object.id}`, severity: 'high', area: object.area, action: `Assign an accountable owner to ${object.name}.` });
    if (object.type === 'role' && (!(object.proposedScopeStatements?.length || object.authority?.length) || !object.responsibilities?.length)) gaps.push({ id: `gap-authority-${object.id}`, severity: 'high', area: object.area, action: `Define responsibility and proposed scope for ${object.name}.` });
    if (object.type === 'process' && (!object.trigger || !object.inputs?.length || !object.outputs?.length)) gaps.push({ id: `gap-flow-${object.id}`, severity: 'high', area: object.area, action: `Define trigger, inputs, and outputs for ${object.name}.` });
  }

  for (const relation of blueprint.relations ?? []) {
    if (!ids.has(relation.source)) errors.push({ code: 'DANGLING_REFERENCE', path: relation.id, message: `Missing relation source ${relation.source}.` });
    if (!ids.has(relation.target)) errors.push({ code: 'DANGLING_REFERENCE', path: relation.id, message: `Missing relation target ${relation.target}.` });
  }

  return {
    valid: errors.length === 0,
    checkedAt: new Date().toISOString(),
    errors,
    gaps: [...new Map(gaps.map((gap) => [gap.id, gap])).values()],
  };
}

export function latestBlueprint(project) {
  return project.blueprintVersions.at(-1) ?? null;
}

export function graphForBlueprint(blueprint) {
  if (!blueprint) return { nodes: [], links: [], types: [] };
  const nodes = [];
  for (const [areaKey, entry] of Object.entries(blueprint.areas)) {
    for (const object of entry.items) {
      nodes.push({
        id: object.id,
        type: object.type,
        name: object.name,
        detail: object.detail,
        area: areaKey,
        areaLabel: entry.label,
        status: object.status,
        confidence: object.confidence,
        provenance: object.provenance,
      });
    }
  }
  return {
    nodes,
    links: blueprint.relations,
    types: [...new Set(nodes.map((node) => node.type))].sort(),
  };
}
