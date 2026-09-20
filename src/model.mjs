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
        authority: ['Approve blueprint changes', 'Accept risk', 'Authorise assignments'],
      }),
      item('role-operations', 'role', 'Operations owner', 'Owns repeatable delivery and service evidence.', source, {
        responsibilities: ['capability-delivery', 'process-deliver'],
        authority: ['Sequence internal delivery work', 'Escalate blocked delivery'],
      }),
      item('role-design-assistant', 'role', 'Design assistant', 'Drafts proposed structures and highlights integrity gaps.', source, {
        responsibilities: ['system-studio'],
        authority: ['Propose only; no enabled external actions'],
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
        threshold: 'Any material miss or unowned critical risk', authority: ['decision-priority'],
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

function buildRelations(areas) {
  const relations = [];
  const add = (source, target, type) => relations.push({ id: `${source}--${type}--${target}`, source, target, type });
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
      for (const target of object.authority ?? []) {
        if (typeof target === 'string' && target.startsWith('decision-')) add(target, object.id, 'authorises');
      }
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
    if (object.type === 'role' && (!object.authority?.length || !object.responsibilities?.length)) gaps.push({ id: `gap-authority-${object.id}`, severity: 'high', area: object.area, action: `Define responsibility and authority for ${object.name}.` });
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
