import { MUTATIONS, STAGES, digest, evaluation, eventEnvelope, evidence, finding, id, now, safeText, stageAt } from './contracts.mjs';
import { EXPECTED_IMPACTS, referenceOrganization } from './fixture.mjs';

const REQUIRED_CONTEXT_DOMAINS = ['strategy', 'business', 'process', 'ownership', 'information', 'application', 'integration', 'security', 'regulation', 'control', 'operations', 'code/runtime'];
const ASSURANCE_DIMENSIONS = ['FUNCTIONAL', 'REQUIREMENTS', 'SECURITY', 'PRIVACY', 'DATA', 'ARCHITECTURE', 'REGULATORY_CONTROL', 'OPERATIONAL', 'PERFORMANCE', 'RESILIENCE', 'MAINTAINABILITY', 'AI_BEHAVIOR'];
const CLARIFICATION_TARGETS = new Set(['desiredOutcomes', 'constraints', 'assumptions', 'nonGoals']);
const PROOF_RESULT_STATUSES = new Set(['PASS', 'FAIL', 'INDETERMINATE', 'ERROR']);
const PROOF_EVALUATOR_TYPES = new Set(['DETERMINISTIC', 'HUMAN', 'OBSERVATION']);
export const PROOF_ACTION_ATTEMPT_LIMIT = 2;
const PROOF_ACTION_DESTINATIONS = Object.freeze({
  REPAIR: 'implementation',
  CLARIFY: 'clarification',
  REPLAN: 'planning',
  REARCHITECT: 'architecture',
  STOP: 'stopped',
});

const REQUIREMENT_SEED = [
  ['REQ-BUS-1', 'BUSINESS', 'Corporate customers can submit beneficial-owner changes digitally.', ['goal-digital-owner-update'], 'End-to-end submission succeeds for an authorized corporate representative.'],
  ['REQ-FUN-1', 'FUNCTIONAL', 'The service validates required identity, ownership percentage, and effective-date data before acceptance.', ['info-beneficial-owner'], 'Invalid or incomplete ownership records are rejected with typed errors.'],
  ['REQ-SEC-1', 'SECURITY', 'Every submission is authenticated and authorized against the corporate mandate before processing.', ['system-iam', 'principle-authority'], 'Unauthorized representatives receive a deny decision and no write occurs.'],
  ['REQ-CTL-1', 'REGULATORY_CONTROL', 'Every submitted beneficial owner is screened before authoritative activation.', ['policy-aml', 'control-screening'], 'Activation evidence contains a passed screening result for every owner.'],
  ['REQ-CTL-2', 'REGULATORY_CONTROL', 'High-risk or ambiguous submissions require durable control-owner review.', ['control-manual-review', 'process-manual-review'], 'The supported workflow cannot activate a flagged change without an approved review.'],
  ['REQ-DATA-1', 'DATA', 'Party MDM remains the authoritative beneficial-owner system of record and is changed only through the Customer / Party API.', ['system-party-mdm', 'system-customer-api', 'principle-api'], 'Architecture fitness rejects direct portal-to-database access.'],
  ['REQ-INT-1', 'FUNCTIONAL', 'Accepted ownership changes publish a versioned event to CRM, reporting, and warehouse consumers.', ['system-events', 'system-crm', 'system-reporting', 'system-warehouse'], 'Contract tests prove all three consumers receive a compatible event.'],
  ['REQ-PRV-1', 'PRIVACY', 'The flow minimizes beneficial-owner information and prevents disclosure outside authorized roles.', ['policy-privacy', 'info-beneficial-owner'], 'Privacy tests show role-scoped fields and no sensitive data in logs.'],
  ['REQ-OPS-1', 'OPERATIONAL', 'The change is observable, idempotent, resumable, and correlated from submission through propagation.', ['control-audit', 'process-owner-change'], 'Duplicate submission is safe and evidence carries one correlation chain.'],
  ['REQ-RES-1', 'RESILIENCE', 'A failed downstream propagation can retry or reconcile without duplicating the authoritative change.', ['system-events', 'system-party-mdm'], 'Failure test proves retry and reconciliation preserve one logical update.'],
  ['REQ-OUT-1', 'BUSINESS', 'The process reduces manual handling by at least 50% without degrading control outcomes.', ['measure-manual-work', 'goal-digital-owner-update'], 'Observed manual-work reduction is at least 50% and control outcome is PASS.'],
];

function stageRun(changeCase, stage, status, startedAt, outputRefs = []) {
  return { id: id('stage-run'), stage: stage.id, gate: stage.gate, status, startedAt, completedAt: now(), outputRefs, attempt: changeCase.stageRuns.filter((run) => run.stage === stage.id).length + 1 };
}

function gateDecision(stage, result, evaluatorRef) {
  return { id: id('gate'), gate: stage.gate, stage: stage.id, status: result.status, evaluatorRef, findings: result.findings, decidedAt: now() };
}

function pass(definition, subjects, score = 1, findings = []) {
  return evaluation(definition, subjects, 'PASSED', findings, score);
}

function fail(definition, subjects, findings, status = 'FAILED', score = 0) {
  return evaluation(definition, subjects, status, findings, score);
}

function sourceBindingError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function verifySourceBinding(binding) {
  const snapshot = binding?.snapshot;
  const snapshotKeys = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? Object.keys(snapshot).sort() : [];
  const validShape = binding && typeof binding === 'object'
    && typeof binding.projectId === 'string' && /^project-[0-9a-f-]{36}$/i.test(binding.projectId)
    && Number.isInteger(binding.projectVersion) && binding.projectVersion > 0
    && typeof binding.blueprintId === 'string' && /^blueprint-[0-9a-f-]{36}$/i.test(binding.blueprintId)
    && Number.isInteger(binding.blueprintVersion) && binding.blueprintVersion > 0
    && (typeof binding.blueprintSchemaVersion === 'string' || Number.isInteger(binding.blueprintSchemaVersion))
    && typeof binding.objectId === 'string' && typeof binding.objectType === 'string'
    && typeof binding.sourceHash === 'string' && /^[a-f0-9]{64}$/i.test(binding.sourceHash)
    && typeof binding.bindingHash === 'string' && /^[a-f0-9]{64}$/i.test(binding.bindingHash)
    && snapshotKeys.join(',') === 'detail,id,name,type'
    && snapshot.id === binding.objectId && snapshot.type === binding.objectType
    && typeof snapshot.name === 'string' && typeof snapshot.detail === 'string';
  const actualHash = validShape ? digest(snapshot) : null;
  const actualBindingHash = validShape ? digest({
    projectId: binding.projectId, projectVersion: binding.projectVersion,
    blueprintId: binding.blueprintId, blueprintVersion: binding.blueprintVersion,
    blueprintSchemaVersion: binding.blueprintSchemaVersion,
    objectId: binding.objectId, objectType: binding.objectType, sourceHash: binding.sourceHash,
  }) : null;
  const valid = validShape && actualHash === binding.sourceHash && actualBindingHash === binding.bindingHash;
  return {
    valid,
    expectedHash: validShape ? binding.sourceHash : null,
    actualHash,
    expectedBindingHash: validShape ? binding.bindingHash : null,
    actualBindingHash,
    reason: valid ? null : 'The pinned saved-design source failed its integrity check.',
  };
}

export function pinProjectSourceObject(project, selection = {}) {
  if (!project || typeof project.id !== 'string' || !Array.isArray(project.blueprintVersions)) {
    throw sourceBindingError(404, 'SOURCE_PROJECT_NOT_FOUND', 'The saved project source was not found.');
  }
  if (!Number.isInteger(selection.expectedProjectVersion) || !selection.expectedBlueprintId
    || !Number.isInteger(selection.expectedBlueprintVersion) || !selection.sourceObjectId) {
    throw sourceBindingError(400, 'SOURCE_REFERENCE_REQUIRED', 'Choose a saved design object and submit its project and blueprint versions.');
  }
  if (project.version !== selection.expectedProjectVersion) {
    throw sourceBindingError(409, 'SOURCE_PROJECT_VERSION_STALE', 'The saved project changed. Reload its current design and select the source again.');
  }
  const blueprint = project.blueprintVersions.at(-1);
  if (!blueprint || blueprint.id !== selection.expectedBlueprintId || blueprint.version !== selection.expectedBlueprintVersion) {
    throw sourceBindingError(409, 'SOURCE_BLUEPRINT_VERSION_STALE', 'The saved blueprint changed. Reload its current design and select the source again.');
  }
  const source = Object.values(blueprint.areas ?? {}).flatMap((area) => area.items ?? [])
    .find((item) => item.id === selection.sourceObjectId);
  if (!source) {
    throw sourceBindingError(404, 'SOURCE_OBJECT_NOT_FOUND', 'The selected object is not present in the current saved blueprint.');
  }
  if (typeof source.type !== 'string' || typeof source.name !== 'string' || typeof source.detail !== 'string') {
    throw sourceBindingError(409, 'SOURCE_OBJECT_INVALID', 'The selected saved design object is missing required source fields.');
  }
  const snapshot = { id: source.id, type: source.type, name: source.name, detail: source.detail };
  const sourceHash = digest(snapshot);
  const binding = {
    projectId: project.id, projectVersion: project.version, blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, blueprintSchemaVersion: blueprint.blueprintSchemaVersion ?? 1,
    objectId: source.id, objectType: source.type, sourceHash, snapshot,
  };
  binding.bindingHash = digest({
    projectId: binding.projectId, projectVersion: binding.projectVersion,
    blueprintId: binding.blueprintId, blueprintVersion: binding.blueprintVersion,
    blueprintSchemaVersion: binding.blueprintSchemaVersion,
    objectId: binding.objectId, objectType: binding.objectType, sourceHash: binding.sourceHash,
  });
  const verified = verifySourceBinding(binding);
  if (!verified.valid) {
    throw sourceBindingError(409, 'SOURCE_HASH_INVALID', 'The selected saved design source could not be verified.');
  }
  return binding;
}

export function createChangeCase(input = {}, { sourceBinding = null } = {}) {
  const createdAt = now();
  const mutation = MUTATIONS[input.mutation] ? input.mutation : 'none';
  const tenantId = safeText(input.tenantId, 80) || 'tenant-reference-bank';
  const pinnedSource = sourceBinding ? structuredClone(sourceBinding) : null;
  const projectId = pinnedSource?.projectId ?? (safeText(input.projectId, 80) || null);
  const caseId = id('change-case');
  const rawIntent = safeText(input.rawIntent) || 'Allow corporate customers to update beneficial-owner information digitally while preserving KYC/AML controls, data integrity, authorization, auditability, and downstream consistency.';
  const golden = input.mode !== 'custom';
  const changeCase = {
    id: caseId,
    tenantId,
    projectId,
    title: safeText(input.title, 160) || 'Digital beneficial-owner maintenance',
    status: 'DRAFT',
    currentStageIndex: 0,
    currentStage: 'S0',
    riskClass: 'HIGH',
    autonomyLevel: 'L2',
    createdBy: safeText(input.createdBy, 100) || 'requester',
    accountableOwner: safeText(input.accountableOwner, 120) || (golden ? 'actor-accountable-owner' : null),
    createdAt,
    updatedAt: createdAt,
    version: 0,
    correlationId: id('correlation'),
    mutation,
    mutationLabel: MUTATIONS[mutation].label,
    intent: {
      id: id('intent'), statement: rawIntent,
      problem: safeText(input.problem) || (golden ? 'Beneficial-owner maintenance relies on manual handling, delaying customer service and creating inconsistent propagation.' : ''),
      motivation: safeText(input.motivation) || (golden ? 'Reduce manual work while preserving regulated control outcomes.' : ''),
      targetPopulation: safeText(input.targetPopulation) || (golden ? 'Authorized representatives of corporate customers' : ''),
      desiredOutcomes: input.desiredOutcomes?.map((value) => safeText(value)).filter(Boolean) ?? (golden ? ['Digital self-service ownership update', 'No control degradation', 'Consistent downstream records'] : []),
      successMeasures: input.successMeasures ?? (golden ? [{ id: 'measure-manual-work', name: 'Manual-work reduction', target: 50, unit: 'percent' }, { id: 'measure-control', name: 'Control outcome', target: 'PASS' }] : []),
      constraints: ['Synthetic data only', 'Production-like release requires human approval', 'No direct database access across system boundaries'],
      assumptions: ['Corporate representatives are already enrolled in the synthetic IAM service'],
      nonGoals: [],
      proposedSolution: 'Add a governed digital change flow through owned APIs and control services.',
      openQuestions: [], confidence: golden ? 'HIGH' : 'LOW',
      sourceRefs: [pinnedSource ? `blueprint:${pinnedSource.blueprintId}:v${pinnedSource.blueprintVersion}:${pinnedSource.objectId}` : 'request:raw-intent'], revision: 1,
    },
    ...(pinnedSource ? { sourceBinding: pinnedSource } : {}),
    intentHistory: [],
    clarifications: [],
    proofs: { obligations: [], results: [], assessments: [], actions: [], loopCounters: {} },
    enterpriseSnapshot: { ...referenceOrganization(mutation), sourceKind: 'synthetic-reference-model', sourceLabel: 'Synthetic reference organization' },
    artifacts: {},
    evidenceLedger: [],
    evaluations: [],
    gateHistory: [],
    stageRuns: [],
    events: [],
    approvals: [],
    idempotency: {},
    metrics: { tokens: 0, cost: 0, humanInterventions: 0, stagePasses: 0, stageFailures: 0 },
  };
  changeCase.intent.contentHash = digest(Object.fromEntries(Object.entries(changeCase.intent).filter(([key]) => key !== 'contentHash')));
  changeCase.intentHistory.push(structuredClone(changeCase.intent));
  changeCase.events.push(eventEnvelope(changeCase, 'ChangeCaseCreated', changeCase.createdBy, { mutation, intentId: changeCase.intent.id }));
  return changeCase;
}

export function commandRequestHash(command) {
  return digest(Object.fromEntries(Object.entries(command).filter(([name]) => !['idempotencyKey', 'version'].includes(name))));
}

function commandKey(changeCase, command, action) {
  const key = safeText(command.idempotencyKey, 160) || id(`${action}-key`);
  const requestHash = commandRequestHash(command);
  const prior = changeCase.idempotency[key];
  if (prior && (prior.action !== action || prior.requestHash !== requestHash)) {
    const error = new Error('Idempotency key was already used with a different command.');
    error.statusCode = 409;
    throw error;
  }
  return { key, requestHash, replayed: Boolean(prior) };
}

function finishCommand(changeCase, key, requestHash, action, actor, eventType, data) {
  changeCase.version += 1;
  changeCase.updatedAt = now();
  changeCase.idempotency[key] = { action, requestHash, version: changeCase.version, at: changeCase.updatedAt };
  changeCase.events.push(eventEnvelope(changeCase, eventType, actor, data, changeCase.events.at(-1)?.id));
  return { changeCase, replayed: false };
}

function commandError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function intentHash(intent) {
  return digest(Object.fromEntries(Object.entries(intent).filter(([key]) => key !== 'contentHash')));
}

export function normalizeChangeCase(changeCase) {
  changeCase.clarifications ??= [];
  changeCase.proofs ??= { obligations: [], results: [], assessments: [], actions: [], loopCounters: {} };
  changeCase.proofs.obligations ??= [];
  changeCase.proofs.results ??= [];
  changeCase.proofs.assessments ??= [];
  changeCase.proofs.actions ??= [];
  changeCase.proofs.loopCounters ??= {};
  changeCase.intent.nonGoals ??= [];
  changeCase.intent.openQuestions ??= [];
  changeCase.intent.revision ??= 1;
  changeCase.intent.contentHash ??= intentHash(changeCase.intent);
  changeCase.intentHistory ??= [structuredClone(changeCase.intent)];
  if (changeCase.artifacts?.requirements) {
    changeCase.artifacts.requirements.draftRevision ??= 1;
    changeCase.artifacts.requirements.draftHistory ??= [];
  }
  return changeCase;
}

function requirementDraftHash(requirements) {
  return digest(requirements.map(({ id: requirementId, kind, statement, rationale, actor, precondition, observableResult, independentVerification, derivedFrom, affectedObjects, priority, acceptanceCriteria, verificationMethod, owner, risk, sourceLinks }) => ({
    id: requirementId, kind, statement, rationale, actor, precondition, observableResult, independentVerification,
    derivedFrom, affectedObjects, priority, acceptanceCriteria, verificationMethod, owner, risk, sourceLinks,
  })));
}

function validateRequirementDraft(requirements, changeCase = null) {
  const findings = [];
  const seen = new Set();
  for (const requirement of requirements) {
    if (!requirement.id || seen.has(requirement.id)) findings.push(finding('REQUIREMENT_ID_INVALID', 'HIGH', 'Requirement IDs must be present and unique.', requirement.id ?? 'requirements', 'Keep each stable requirement ID unique.'));
    seen.add(requirement.id);
    if (typeof requirement.statement !== 'string' || !requirement.statement.trim() || requirement.statement.trim().length > 500) findings.push(finding('REQUIREMENT_STATEMENT_INVALID', 'HIGH', `${requirement.id} needs a statement of 1–500 characters.`, requirement.id, 'Provide a concise requirement statement.'));
    if (typeof requirement.rationale !== 'string' || !requirement.rationale.trim() || requirement.rationale.trim().length > 500) findings.push(finding('REQUIREMENT_RATIONALE_INVALID', 'HIGH', `${requirement.id} needs a rationale of 1–500 characters.`, requirement.id, 'Explain why this requirement follows from the linked intent/source.'));
    for (const field of ['actor', 'precondition', 'observableResult', 'independentVerification', 'owner']) {
      if (typeof requirement[field] !== 'string' || !requirement[field].trim() || requirement[field].trim().length > 500) findings.push(finding('REQUIREMENT_FIELD_INVALID', 'HIGH', `${requirement.id} needs a valid ${field}.`, requirement.id, `Provide a concise ${field}.`));
    }
    if (!['MUST', 'SHOULD'].includes(requirement.priority)) findings.push(finding('REQUIREMENT_PRIORITY_INVALID', 'HIGH', `${requirement.id} has an invalid priority.`, requirement.id, 'Choose MUST or SHOULD.'));
    if (!['SCENARIO_AND_OUTCOME', 'AUTOMATED_TEST'].includes(requirement.verificationMethod)) findings.push(finding('REQUIREMENT_METHOD_INVALID', 'HIGH', `${requirement.id} has an unsupported verification method.`, requirement.id, 'Choose a supported verification method.'));
    if (!Array.isArray(requirement.derivedFrom) || !requirement.derivedFrom.length) findings.push(finding('ORPHAN_REQUIREMENT', 'HIGH', `${requirement.id} has no upstream source.`, requirement.id, 'Retain at least one source-intent link.'));
    if (changeCase?.sourceBinding) {
      const links = requirement.sourceLinks ?? [];
      const validLinks = links.length === 2
        && links.some((entry) => entry.type === 'INTENT' && entry.ref === changeCase.intent.id)
        && links.some((entry) => entry.type === 'SAVED_DESIGN_OBJECT' && entry.ref === changeCase.sourceBinding.objectId && entry.hash === changeCase.sourceBinding.sourceHash);
      if (!validLinks) findings.push(finding('REQUIREMENT_SOURCE_LINK_INVALID', 'HIGH', `${requirement.id} is missing its pinned intent/source link.`, requirement.id, 'Restore the stable links to the case intent and pinned saved-design object.'));
    }
    if (!Array.isArray(requirement.acceptanceCriteria) || !requirement.acceptanceCriteria.length || requirement.acceptanceCriteria.some((value) => typeof value !== 'string' || !value.trim() || value.length > 500)) findings.push(finding('UNTESTABLE_REQUIREMENT', 'HIGH', `${requirement.id} needs one or more valid acceptance criteria.`, requirement.id, 'Add verifiable acceptance criteria.'));
    if (!requirement.verificationMethod) findings.push(finding('UNTESTABLE_REQUIREMENT', 'HIGH', `${requirement.id} has no verification method.`, requirement.id, 'Select a verification method.'));
    if (/delete all audit evidence/i.test(requirement.statement)) findings.push(finding('REQUIREMENT_CONTRADICTION', 'CRITICAL', `${requirement.id} contradicts immutable audit control.`, requirement.id, 'Remove or resolve the contradiction with the control owner.'));
  }
  return findings;
}

function requirementBaselineValid(changeCase) {
  const artifact = changeCase.artifacts.requirements;
  const baseline = artifact?.acceptedBaseline;
  return Boolean(changeCase.sourceBinding && baseline
    && baseline.version === 1 && baseline.draftRevision === artifact.draftRevision
    && baseline.contentHash === requirementDraftHash(baseline.requirements)
    && baseline.contentHash === requirementDraftHash(artifact.requirements)
    && baseline.intentHash === intentHash(changeCase.intent)
    && baseline.sourceHash === changeCase.sourceBinding.sourceHash
    && validateRequirementDraft(baseline.requirements, changeCase).length === 0);
}

function requirementsForDesign(changeCase) {
  return changeCase.sourceBinding
    ? changeCase.artifacts.requirements.acceptedBaseline.requirements
    : changeCase.artifacts.requirements.requirements;
}

export function editRequirementDraft(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'edit-requirements');
  if (replayed) return { changeCase, replayed: true };
  const artifact = changeCase.artifacts.requirements;
  if (!changeCase.sourceBinding || changeCase.currentStage !== 'S4' || !artifact || artifact.acceptedBaseline) throw commandError('Requirements are not open for editing.', 409);
  if (command.expectedDraftRevision !== artifact.draftRevision) throw commandError(`Requirement draft revision conflict: current revision is ${artifact.draftRevision}.`, 409);
  const requirement = artifact.requirements.find((entry) => entry.id === command.requirementId);
  if (!requirement) throw commandError('Requirement not found.', 404);
  const changes = command.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw commandError('Requirement changes must be an object.');
  const allowed = ['statement', 'rationale', 'actor', 'precondition', 'observableResult', 'independentVerification', 'owner', 'priority', 'verificationMethod', 'acceptanceCriteria'];
  if (Object.keys(changes).some((keyName) => !allowed.includes(keyName)) || !Object.keys(changes).length) throw commandError('Only requirement content and verification fields can be edited.');
  for (const field of ['statement', 'rationale', 'actor', 'precondition', 'observableResult', 'independentVerification', 'owner', 'priority', 'verificationMethod']) {
    if (Object.hasOwn(changes, field) && typeof changes[field] !== 'string') throw commandError(`Requirement ${field} must be text.`);
  }
  for (const field of ['statement', 'rationale', 'actor', 'precondition', 'observableResult', 'independentVerification', 'owner', 'priority', 'verificationMethod']) {
    if (Object.hasOwn(changes, field)) requirement[field] = safeText(changes[field], 500);
  }
  if (Object.hasOwn(changes, 'acceptanceCriteria')) {
    if (!Array.isArray(changes.acceptanceCriteria) || changes.acceptanceCriteria.length > 8 || changes.acceptanceCriteria.some((value) => typeof value !== 'string')) throw commandError('Provide up to eight text acceptance criteria.');
    requirement.acceptanceCriteria = changes.acceptanceCriteria.map((value) => safeText(value, 500));
  }
  artifact.draftRevision += 1;
  artifact.validationFindings = validateRequirementDraft(artifact.requirements, changeCase);
  const actor = safeText(command.actor, 120) || changeCase.accountableOwner;
  artifact.draftHistory.push({ revision: artifact.draftRevision, requirementId: requirement.id, changes: structuredClone(changes), actor, at: now() });
  return finishCommand(changeCase, key, requestHash, 'edit-requirements', actor, 'RequirementDraftEdited', { draftRevision: artifact.draftRevision, requirementId: requirement.id, changedFields: Object.keys(changes).sort() });
}

export function acceptRequirementDraft(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'accept-requirements');
  if (replayed) return { changeCase, replayed: true };
  const artifact = changeCase.artifacts.requirements;
  if (!changeCase.sourceBinding || changeCase.currentStage !== 'S4' || !artifact) throw commandError('The source-bound requirements gate is not awaiting acceptance.', 409);
  if (artifact.acceptedBaseline) throw commandError('An accepted requirements baseline is already frozen.', 409);
  if (command.expectedDraftRevision !== artifact.draftRevision) throw commandError(`Requirement draft revision conflict: current revision is ${artifact.draftRevision}.`, 409);
  const actor = safeText(command.actor, 120);
  if (!actor || actor !== changeCase.accountableOwner || actor !== changeCase.createdBy) {
    const error = new Error('Only the case owner can accept the requirements baseline.');
    error.statusCode = 403;
    throw error;
  }
  const findings = validateRequirementDraft(artifact.requirements, changeCase);
  artifact.validationFindings = findings;
  if (findings.length) throw commandError('Requirements must pass validation before the owner can accept them.', 409);
  const contentHash = requirementDraftHash(artifact.requirements);
  artifact.acceptedBaseline = {
    version: 1, draftRevision: artifact.draftRevision, contentHash,
    intentHash: intentHash(changeCase.intent), sourceHash: changeCase.sourceBinding.sourceHash,
    acceptedBy: actor, acceptedAt: now(), requirements: structuredClone(artifact.requirements),
  };
  artifact.acceptedBaseline.requirements.forEach((entry) => { entry.status = 'ACCEPTED'; });
  const stage = stageAt(changeCase.currentStageIndex);
  const startedAt = now();
  const result = requirementsEngineering(changeCase);
  if (result.status !== 'PASSED') throw commandError('Accepted requirements did not satisfy the G4 quality gate.', 409);
  changeCase.evaluations.push(result);
  changeCase.gateHistory.push(gateDecision(stage, result, result.id));
  changeCase.stageRuns.push(stageRun(changeCase, stage, 'PASSED', startedAt, result.subjectRefs));
  changeCase.metrics.stagePasses += 1;
  changeCase.events.push(eventEnvelope(changeCase, 'GatePassed', actor, { stage: stage.id, gate: stage.gate, evaluationRef: result.id, status: result.status }, changeCase.events.at(-1)?.id));
  changeCase.currentStageIndex += 1;
  const next = stageAt(changeCase.currentStageIndex);
  changeCase.currentStage = next?.id ?? null;
  changeCase.status = next ? 'RUNNING' : 'PASSED';
  return finishCommand(changeCase, key, requestHash, 'accept-requirements', actor, 'RequirementBaselineAccepted', {
    draftRevision: artifact.draftRevision, baselineVersion: 1, contentHash, intentHash: artifact.acceptedBaseline.intentHash,
    sourceHash: artifact.acceptedBaseline.sourceHash, gate: stage.gate,
  });
}

function proofFor(changeCase, proofRef) {
  const proof = changeCase.proofs.obligations.find((entry) => entry.id === proofRef);
  if (!proof) throw commandError('Proof obligation not found.', 404);
  return proof;
}

function latestProofResult(changeCase, proofRef, intentRevision = changeCase.intent.revision) {
  return changeCase.proofs.results.findLast((entry) => entry.proofRef === proofRef && entry.intentRevision === intentRevision) ?? null;
}

function proofResultIsIntact(result) {
  if (!result?.contentHash) return false;
  const { contentHash, ...payload } = result;
  return contentHash === digest(payload);
}

function requireActiveProofWork(changeCase) {
  if (changeCase.status === 'STOPPED') throw commandError('Case is STOPPED; no further proof work is allowed.', 409);
}

function proofActionFor(changeCase, actionRef) {
  const action = changeCase.proofs.actions.find((entry) => entry.id === actionRef);
  if (!action) throw commandError('Proof action not found.', 404);
  return action;
}

function requireActionOwner(action, actor) {
  if (!actor || actor !== action.owner) {
    const error = new Error('Only the action owner can resume or complete this work.');
    error.statusCode = 403;
    throw error;
  }
}

export function registerProofObligation(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'register-proof');
  if (replayed) return { changeCase, replayed: true };
  requireActiveProofWork(changeCase);
  const targetRef = safeText(command.targetRef, 160) || changeCase.intent.id;
  const knownTargets = new Set([changeCase.intent.id, ...(changeCase.artifacts.requirements?.requirements ?? []).map((entry) => entry.id)]);
  if (!knownTargets.has(targetRef)) throw commandError('Proof target is not part of this change case.');
  const criterion = safeText(command.criterion, 1_200);
  if (!criterion) throw commandError('Proof criterion is required.');
  const evaluatorType = safeText(command.evaluatorType, 40) || 'DETERMINISTIC';
  if (!PROOF_EVALUATOR_TYPES.has(evaluatorType)) throw commandError('Proof evaluator type is invalid.');
  const actor = safeText(command.actor, 120) || 'studio-operator';
  const proof = {
    id: id('proof'), targetRef, criterion, evaluatorType,
    required: command.required !== false,
    intentRevision: changeCase.intent.revision,
    createdBy: actor, createdAt: now(),
  };
  changeCase.proofs.obligations.push(proof);
  return finishCommand(changeCase, key, requestHash, 'register-proof', actor, 'ProofObligationRegistered', { proofRef: proof.id, targetRef, intentRevision: proof.intentRevision, required: proof.required });
}

export function recordProofResult(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'record-proof');
  if (replayed) return { changeCase, replayed: true };
  requireActiveProofWork(changeCase);
  const proof = proofFor(changeCase, safeText(command.proofRef, 160));
  if (changeCase.proofs.actions.some((entry) => entry.proofRef === proof.id && ['READY', 'IN_PROGRESS'].includes(entry.status))) {
    throw commandError('Complete the pending proof action before recording another result.', 409);
  }
  if (proof.intentRevision !== changeCase.intent.revision) {
    throw commandError(`Proof obligation targets intent revision ${proof.intentRevision}; current revision is ${changeCase.intent.revision}.`, 409);
  }
  const status = safeText(command.status, 40).toUpperCase();
  if (!PROOF_RESULT_STATUSES.has(status)) throw commandError('Proof result status is invalid.');
  const summary = safeText(command.summary, 1_200);
  if (!summary) throw commandError('Proof result summary is required.');
  const observations = Array.isArray(command.observations) ? command.observations.map((value) => safeText(value, 800)).filter(Boolean).slice(0, 50) : [];
  if (status === 'PASS' && !observations.length) throw commandError('Passing proof requires at least one actual observation.');
  const actor = safeText(command.actor, 120) || 'proof-runner';
  const prior = latestProofResult(changeCase, proof.id);
  const result = {
    id: id('proof-result'), proofRef: proof.id, targetRef: proof.targetRef,
    intentRevision: changeCase.intent.revision, status, summary, observations,
    evaluator: safeText(command.evaluator, 160) || actor,
    priorResultRef: prior?.id ?? null, recordedBy: actor, recordedAt: now(),
  };
  result.contentHash = digest(result);
  changeCase.proofs.results.push(result);
  return finishCommand(changeCase, key, requestHash, 'record-proof', actor, 'ProofResultRecorded', { proofRef: proof.id, resultRef: result.id, status, intentRevision: result.intentRevision });
}

export function assessProofs(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'assess-proofs');
  if (replayed) return { changeCase, replayed: true };
  requireActiveProofWork(changeCase);
  const actor = safeText(command.actor, 120) || 'acceptance-controller';
  const obligations = changeCase.proofs.obligations.filter((entry) => entry.intentRevision === changeCase.intent.revision);
  const required = obligations.filter((entry) => entry.required);
  const rows = obligations.map((proof) => ({ proof, result: latestProofResult(changeCase, proof.id) }));
  const blockers = [];
  if (!required.length) blockers.push({ code: 'NO_REQUIRED_PROOFS', proofRef: null, status: 'NOT_RUN' });
  for (const clarification of changeCase.clarifications.filter((entry) => entry.intentRevision === changeCase.intent.revision && entry.status !== 'RECONCILED')) {
    blockers.push({ code: 'UNRESOLVED_CLARIFICATION', clarificationRef: clarification.id, status: clarification.status });
  }
  for (const { proof, result } of rows.filter((entry) => entry.proof.required)) {
    if (!result) blockers.push({ code: 'PROOF_NOT_RUN', proofRef: proof.id, status: 'NOT_RUN' });
    else if (!proofResultIsIntact(result)) blockers.push({ code: 'PROOF_INTEGRITY_INVALID', proofRef: proof.id, resultRef: result.id, status: 'ERROR' });
    else if (result.status !== 'PASS') blockers.push({ code: `PROOF_${result.status}`, proofRef: proof.id, resultRef: result.id, status: result.status });
  }
  const hasFailure = blockers.some((entry) => entry.status === 'FAIL');
  const phase = !blockers.length ? 'ACCEPTED' : hasFailure ? 'REJECTED' : 'INCOMPLETE';
  const assessment = {
    id: id('acceptance'), intentRef: changeCase.intent.id, intentRevision: changeCase.intent.revision,
    phase, accepted: phase === 'ACCEPTED',
    requiredProofRefs: required.map((entry) => entry.id),
    resultRefs: rows.flatMap(({ result }) => result ? [result.id] : []),
    blockers,
    coverage: { required: required.length, passed: rows.filter(({ proof, result }) => proof.required && result?.status === 'PASS' && proofResultIsIntact(result)).length, optional: obligations.length - required.length },
    explanation: phase === 'ACCEPTED' ? 'Every required proof has a current passing result.' : phase === 'REJECTED' ? 'At least one required proof failed.' : 'Required proof evidence is missing, indeterminate or errored.',
    assessedBy: actor, assessedAt: now(),
  };
  assessment.contentHash = digest(assessment);
  changeCase.proofs.assessments.push(assessment);
  return finishCommand(changeCase, key, requestHash, 'assess-proofs', actor, 'AcceptanceAssessed', { assessmentRef: assessment.id, phase, intentRevision: assessment.intentRevision });
}

export function routeProofResult(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'route-proof');
  if (replayed) return { changeCase, replayed: true };
  requireActiveProofWork(changeCase);
  const proof = proofFor(changeCase, safeText(command.proofRef, 160));
  const resultRef = safeText(command.resultRef, 160);
  const result = changeCase.proofs.results.find((entry) => entry.id === resultRef);
  if (!result || result.proofRef !== proof.id) throw commandError('Proof result not found.', 404);
  if (proof.intentRevision !== changeCase.intent.revision || result.intentRevision !== changeCase.intent.revision) {
    throw commandError('Only a result for the current intent revision can be routed.', 409);
  }
  if (latestProofResult(changeCase, proof.id)?.id !== result.id) {
    throw commandError('Only the latest result for a proof can be routed.', 409);
  }
  if (!['FAIL', 'INDETERMINATE'].includes(result.status)) {
    throw commandError('Only a failed or indeterminate proof result can be routed.', 409);
  }
  if (!proofResultIsIntact(result)) throw commandError('A proof result with invalid integrity cannot be routed.', 409);
  const action = safeText(command.action, 40).toUpperCase();
  const destination = PROOF_ACTION_DESTINATIONS[action];
  if (!destination) throw commandError('Proof action is invalid.');
  if (changeCase.proofs.actions.some((entry) => entry.resultRef === result.id)) {
    throw commandError('This proof result already has a route.', 409);
  }
  if (changeCase.proofs.actions.some((entry) => entry.proofRef === proof.id && ['READY', 'IN_PROGRESS'].includes(entry.status))) {
    throw commandError('This proof already has a pending action.', 409);
  }
  const attempts = changeCase.proofs.loopCounters[proof.id] ?? 0;
  if (action !== 'STOP' && attempts >= PROOF_ACTION_ATTEMPT_LIMIT) {
    throw commandError(`Proof loop limit ${PROOF_ACTION_ATTEMPT_LIMIT} is exhausted; an accountable owner may stop the work.`, 409);
  }
  const reason = safeText(command.reason, 1_200);
  if (!reason) throw commandError('A routing reason is required.');
  const actor = safeText(command.actor, 120) || 'studio-operator';
  if (action === 'STOP' && actor !== changeCase.accountableOwner) {
    const error = new Error('Only the accountable owner can stop work for a proof result.');
    error.statusCode = 403;
    throw error;
  }
  const routedAt = now();
  const proofAction = {
    id: id('proof-action'), proofRef: proof.id, resultRef: result.id,
    intentRevision: changeCase.intent.revision, action, destination, reason,
    status: action === 'STOP' ? 'COMPLETED' : 'READY',
    owner: safeText(command.owner, 120) || changeCase.accountableOwner || actor,
    routedBy: actor, routedAt, completedAt: action === 'STOP' ? routedAt : null,
    attempt: null, startedAt: null, outcome: action === 'STOP' ? 'STOPPED' : null, completionSummary: null,
    bound: 'ONE_ROUTE_PER_RESULT',
  };
  changeCase.proofs.actions.push(proofAction);
  if (action === 'STOP') changeCase.status = 'STOPPED';
  return finishCommand(changeCase, key, requestHash, 'route-proof', actor, 'ProofActionRouted', {
    proofRef: proof.id, resultRef: result.id, actionRef: proofAction.id, action, destination,
  });
}

export function resumeProofAction(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'resume-proof-action');
  if (replayed) return { changeCase, replayed: true };
  requireActiveProofWork(changeCase);
  const action = proofActionFor(changeCase, safeText(command.actionRef, 160));
  const actor = safeText(command.actor, 120);
  requireActionOwner(action, actor);
  if (action.action === 'STOP') throw commandError('A terminal stop action cannot be resumed.', 409);
  if (['IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(action.status)) return { changeCase, replayed: true };
  if (action.status !== 'READY') throw commandError('Proof action is not ready to resume.', 409);
  if (action.intentRevision !== changeCase.intent.revision) throw commandError('A proof action from a superseded intent cannot be resumed.', 409);
  const attempts = changeCase.proofs.loopCounters[action.proofRef] ?? 0;
  if (attempts >= PROOF_ACTION_ATTEMPT_LIMIT) throw commandError(`Proof loop limit ${PROOF_ACTION_ATTEMPT_LIMIT} is exhausted.`, 409);
  action.status = 'IN_PROGRESS';
  action.attempt = attempts + 1;
  action.startedAt = now();
  action.startedBy = actor;
  changeCase.proofs.loopCounters[action.proofRef] = action.attempt;
  return finishCommand(changeCase, key, requestHash, 'resume-proof-action', actor, 'ProofActionResumed', {
    actionRef: action.id, proofRef: action.proofRef, resultRef: action.resultRef, attempt: action.attempt,
  });
}

export function completeProofAction(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'complete-proof-action');
  if (replayed) return { changeCase, replayed: true };
  requireActiveProofWork(changeCase);
  const action = proofActionFor(changeCase, safeText(command.actionRef, 160));
  const actor = safeText(command.actor, 120);
  requireActionOwner(action, actor);
  if (['COMPLETED', 'FAILED'].includes(action.status)) return { changeCase, replayed: true };
  if (action.status !== 'IN_PROGRESS') throw commandError('Proof action must be in progress before completion.', 409);
  const outcome = safeText(command.outcome, 40).toUpperCase();
  if (!['SUCCEEDED', 'FAILED'].includes(outcome)) throw commandError('Proof action outcome is invalid.');
  const summary = safeText(command.summary, 1_200);
  if (!summary) throw commandError('Proof action completion summary is required.');
  action.status = outcome === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED';
  action.outcome = outcome;
  action.completionSummary = summary;
  action.completedAt = now();
  action.completedBy = actor;
  return finishCommand(changeCase, key, requestHash, 'complete-proof-action', actor, 'ProofActionCompleted', {
    actionRef: action.id, proofRef: action.proofRef, resultRef: action.resultRef, attempt: action.attempt, outcome,
  });
}

function workspaceAction(type, label, reason, references = {}) {
  return { type, label, reason, ...references };
}

export function workspaceStatus(changeCase) {
  normalizeChangeCase(changeCase);
  const revision = changeCase.intent.revision;
  const questions = changeCase.clarifications
    .filter((entry) => entry.intentRevision === revision && entry.status !== 'RECONCILED')
    .map((entry) => ({
      id: entry.id, status: entry.status, question: entry.question, targetField: entry.targetField,
      eligibleRespondent: entry.eligibleRespondent, answer: entry.answer?.value ?? null,
    }));
  const obligations = changeCase.proofs.obligations.filter((entry) => entry.intentRevision === revision);
  const required = obligations.filter((entry) => entry.required);
  const resultFor = (proofRef) => latestProofResult(changeCase, proofRef, revision);
  const actionFor = (resultRef) => changeCase.proofs.actions.find((entry) => entry.resultRef === resultRef) ?? null;
  const actionSummary = (entry) => entry ? {
    id: entry.id, action: entry.action, destination: entry.destination, status: entry.status,
    owner: entry.owner, attempt: entry.attempt, reason: entry.reason, outcome: entry.outcome,
  } : null;
  const proofGaps = required.flatMap((proof) => {
    const result = resultFor(proof.id);
    if (!result) return [{ proofRef: proof.id, criterion: proof.criterion, status: 'NOT_RUN', resultRef: null, summary: 'No result has been recorded.', action: null }];
    if (!proofResultIsIntact(result)) return [{ proofRef: proof.id, criterion: proof.criterion, status: 'ERROR', resultRef: result.id, summary: 'The latest result failed its integrity check.', action: null }];
    if (result.status === 'PASS') return [];
    return [{ proofRef: proof.id, criterion: proof.criterion, status: result.status, resultRef: result.id, summary: result.summary, action: actionSummary(actionFor(result.id)) }];
  });
  const failedResults = changeCase.proofs.results
    .filter((entry) => entry.intentRevision === revision && ['FAIL', 'INDETERMINATE', 'ERROR'].includes(entry.status))
    .map((entry) => ({
      id: entry.id, proofRef: entry.proofRef, status: entry.status, summary: entry.summary,
      recordedAt: entry.recordedAt, action: actionSummary(actionFor(entry.id)),
    }));

  let nextAllowedAction;
  if (changeCase.status === 'STOPPED') {
    nextAllowedAction = workspaceAction('NONE', 'Work stopped', 'The accountable owner stopped this case; no further mutation is allowed.');
  } else {
    const openQuestion = questions.find((entry) => entry.status === 'OPEN');
    const answeredQuestion = questions.find((entry) => entry.status === 'ANSWERED');
    const pendingAction = changeCase.proofs.actions.find((entry) => entry.intentRevision === revision && entry.status === 'READY');
    const runningAction = changeCase.proofs.actions.find((entry) => entry.intentRevision === revision && entry.status === 'IN_PROGRESS');
    if (openQuestion) {
      nextAllowedAction = workspaceAction('ANSWER_CLARIFICATION', 'Answer clarification', 'An eligible respondent must answer the open question.', { clarificationRef: openQuestion.id });
    } else if (answeredQuestion) {
      nextAllowedAction = workspaceAction('RECONCILE_CLARIFICATION', 'Reconcile clarification', 'The accountable owner must reconcile the saved answer into intent.', { clarificationRef: answeredQuestion.id });
    } else if (runningAction) {
      nextAllowedAction = workspaceAction('COMPLETE_PROOF_ACTION', 'Complete pending action', 'The claimed action needs a recorded outcome before reevaluation.', { actionRef: runningAction.id, proofRef: runningAction.proofRef });
    } else if (pendingAction) {
      nextAllowedAction = workspaceAction('RESUME_PROOF_ACTION', 'Resume pending action', 'A durable routed action is ready to be claimed exactly once.', { actionRef: pendingAction.id, proofRef: pendingAction.proofRef });
    } else if (!required.length) {
      nextAllowedAction = workspaceAction('REGISTER_PROOF', 'Add a required proof', 'Acceptance needs at least one required proof obligation.');
    } else {
      const gap = proofGaps[0];
      if (gap?.status === 'NOT_RUN' || gap?.status === 'ERROR' || gap?.action) {
        nextAllowedAction = workspaceAction('RECORD_PROOF_RESULT', 'Record proof result', gap?.action ? 'The routed action is complete; record fresh evaluation evidence.' : 'This required proof needs a current result.', { proofRef: gap.proofRef });
      } else if (gap) {
        const attempts = changeCase.proofs.loopCounters[gap.proofRef] ?? 0;
        const allowedActions = attempts >= PROOF_ACTION_ATTEMPT_LIMIT ? ['STOP'] : Object.keys(PROOF_ACTION_DESTINATIONS);
        nextAllowedAction = workspaceAction('ROUTE_PROOF_RESULT', 'Route failed proof', 'Choose one bounded response without changing the recorded result.', { proofRef: gap.proofRef, resultRef: gap.resultRef, allowedActions });
      } else {
        const currentResultRefs = obligations.flatMap((proof) => {
          const result = resultFor(proof.id);
          return result ? [result.id] : [];
        });
        const assessment = changeCase.proofs.assessments.findLast((entry) => entry.intentRevision === revision);
        const assessmentIsCurrent = assessment
          && assessment.resultRefs.length === currentResultRefs.length
          && currentResultRefs.every((resultRef) => assessment.resultRefs.includes(resultRef));
        if (!assessmentIsCurrent) {
          nextAllowedAction = workspaceAction('ASSESS_PROOFS', 'Assess current proofs', 'All required proofs pass; derive acceptance from the current results.');
        } else if (changeCase.status === 'PASSED') {
          nextAllowedAction = workspaceAction('NONE', 'Workflow complete', 'The case and its current proof assessment are complete.');
        } else if (changeCase.status === 'NEEDS_HUMAN') {
          nextAllowedAction = workspaceAction('HUMAN_DECISION', 'Record human decision', 'The current stage requires an authorized human decision.');
        } else if (['BLOCKED', 'FAILED'].includes(changeCase.status)) {
          nextAllowedAction = workspaceAction('RESOLVE_GATE_BLOCKER', 'Resolve gate blocker', 'The current stage blocker must be repaired before the workflow can advance.');
        } else {
          nextAllowedAction = workspaceAction('ADVANCE_CASE', 'Continue workflow', 'Current required proofs are accepted; the next SDLC stage may run.');
        }
      }
    }
  }
  return { questions, proofGaps, failedResults, nextAllowedAction };
}

function clarificationFor(changeCase, questionRef) {
  const clarification = changeCase.clarifications.find((entry) => entry.id === questionRef);
  if (!clarification) throw commandError('Clarification not found.', 404);
  return clarification;
}

export function openClarification(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'clarify');
  if (replayed) return { changeCase, replayed: true };
  if (changeCase.artifacts.requirements) throw commandError('Intent clarification must be reconciled before requirements are generated.');
  const question = safeText(command.question, 600);
  const targetField = safeText(command.targetField, 80);
  if (!question) throw commandError('Clarification question is required.');
  if (!CLARIFICATION_TARGETS.has(targetField)) throw commandError('Clarification target field is invalid.');
  const actor = safeText(command.actor, 120) || 'studio-operator';
  const entry = {
    id: id('clarification'), status: 'OPEN', question,
    rationale: safeText(command.rationale, 600) || 'The answer changes the intended outcome or delivery boundary.',
    targetField, intentRevision: changeCase.intent.revision,
    eligibleRespondent: safeText(command.eligibleRespondent, 120) || changeCase.accountableOwner,
    options: Array.isArray(command.options) ? command.options.map((value) => safeText(value, 240)).filter(Boolean).slice(0, 8) : [],
    createdBy: actor, createdAt: now(), answer: null, reconciledAt: null,
  };
  changeCase.clarifications.push(entry);
  return finishCommand(changeCase, key, requestHash, 'clarify', actor, 'ClarificationOpened', { clarificationRef: entry.id, intentRevision: entry.intentRevision, targetField });
}

export function answerClarification(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'answer-clarification');
  if (replayed) return { changeCase, replayed: true };
  const entry = clarificationFor(changeCase, safeText(command.questionRef, 120));
  if (entry.status !== 'OPEN') throw commandError('Clarification is not open.');
  const actor = safeText(command.actor, 120);
  if (!actor || actor !== entry.eligibleRespondent) {
    const error = new Error('Only the eligible respondent can answer this clarification.');
    error.statusCode = 403;
    throw error;
  }
  const value = safeText(command.answer, 1_200);
  if (!value) throw commandError('Clarification answer is required.');
  entry.status = 'ANSWERED';
  entry.answer = { value, answeredBy: actor, answeredAt: now() };
  return finishCommand(changeCase, key, requestHash, 'answer-clarification', actor, 'ClarificationAnswered', { clarificationRef: entry.id, intentRevision: entry.intentRevision });
}

export function reconcileClarification(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'reconcile-clarification');
  if (replayed) return { changeCase, replayed: true };
  if (changeCase.artifacts.requirements) throw commandError('Intent clarification must be reconciled before requirements are generated.');
  const entry = clarificationFor(changeCase, safeText(command.questionRef, 120));
  if (entry.status !== 'ANSWERED') throw commandError('Clarification must be answered before reconciliation.');
  const actor = safeText(command.actor, 120);
  if (!actor || actor !== changeCase.accountableOwner) {
    const error = new Error('Only the accountable owner can reconcile intent.');
    error.statusCode = 403;
    throw error;
  }
  if (entry.intentRevision !== changeCase.intent.revision) {
    const error = new Error(`Intent revision conflict: question targets ${entry.intentRevision}, current revision is ${changeCase.intent.revision}.`);
    error.statusCode = 409;
    throw error;
  }
  const resolution = safeText(command.resolution, 1_200) || entry.answer.value;
  const values = changeCase.intent[entry.targetField];
  if (!Array.isArray(values)) throw commandError('Clarification target is not editable.');
  if (!values.includes(resolution)) values.push(resolution);
  changeCase.intent.revision += 1;
  entry.status = 'RECONCILED';
  entry.reconciledAt = now();
  entry.reconciledBy = actor;
  entry.intentRevisionAfter = changeCase.intent.revision;
  entry.resolution = resolution;
  changeCase.intent.contentHash = intentHash(changeCase.intent);
  changeCase.intentHistory.push(structuredClone(changeCase.intent));
  return finishCommand(changeCase, key, requestHash, 'reconcile-clarification', actor, 'ClarificationReconciled', { clarificationRef: entry.id, priorIntentRevision: entry.intentRevision, intentRevision: changeCase.intent.revision, targetField: entry.targetField });
}

function intake(changeCase) {
  const missing = [];
  if (!changeCase.intent.problem) missing.push('problem');
  if (!changeCase.intent.targetPopulation) missing.push('target population');
  if (!changeCase.intent.desiredOutcomes.length) missing.push('desired outcome');
  if (!changeCase.intent.successMeasures.length) missing.push('measurable success criterion');
  if (!changeCase.accountableOwner) missing.push('accountable owner');
  const findings = missing.map((entry) => finding('INTENT_FIELD_MISSING', 'HIGH', `Intent is missing ${entry}.`, changeCase.intent.id, `Clarify and record ${entry} before context discovery.`));
  changeCase.artifacts.intent = { ...changeCase.intent, clarifiedAt: now(), contentHash: digest(changeCase.intent) };
  return findings.length ? fail('intent-quality', [changeCase.intent.id], findings) : pass('intent-quality', [changeCase.intent.id]);
}

function contextDiscovery(changeCase) {
  const plan = {
    id: id('context-plan'), intentRef: changeCase.intent.id, riskClass: changeCase.riskClass,
    requirements: REQUIRED_CONTEXT_DOMAINS.map((domain) => ({ domain, criticality: ['regulation', 'control', 'security', 'ownership'].includes(domain) ? 'CRITICAL' : 'REQUIRED', authorityRequirement: 'AUTHORITATIVE', freshnessRequirement: 'CURRENT', expectedSourceTypes: ['orgward-object'] })),
    contentHash: null,
  };
  plan.contentHash = digest(plan);
  const evidenceRefs = [];
  for (const object of changeCase.enterpriseSnapshot.objects) {
    const record = evidence(changeCase, {
      sourceId: object.source, sourceType: 'orgward-object', objectRef: object.id, authority: object.authority,
      freshness: object.freshness, classification: object.classification, content: object,
      relevance: EXPECTED_IMPACTS.has(object.id) ? 1 : .5, provenanceChain: [object.source, object.id],
    });
    changeCase.evidenceLedger.push(record); evidenceRefs.push(record.id);
  }
  let sourceBindingEvidenceRef = null;
  if (changeCase.sourceBinding) {
    const binding = changeCase.sourceBinding;
    const record = evidence(changeCase, {
      sourceId: `orgward:project:${binding.projectId}:blueprint:${binding.blueprintId}:v${binding.blueprintVersion}`,
      sourceType: 'saved-design-object', objectRef: binding.objectId,
      authority: 'SAVED_PROJECT_DESIGN', freshness: 'PINNED', classification: 'INTERNAL',
      content: { ...binding.snapshot, sourceHash: binding.sourceHash, bindingHash: binding.bindingHash },
      relevance: 1,
      provenanceChain: [`project:${binding.projectId}`, `blueprint:${binding.blueprintId}:v${binding.blueprintVersion}`, `object:${binding.objectId}`, `sha256:${binding.sourceHash}`, `binding:${binding.bindingHash}`],
    });
    changeCase.evidenceLedger.push(record);
    evidenceRefs.push(record.id);
    sourceBindingEvidenceRef = record.id;
  }
  const has = (objectId) => changeCase.enterpriseSnapshot.objects.some((object) => object.id === objectId && object.authority === 'AUTHORITATIVE');
  const coverage = REQUIRED_CONTEXT_DOMAINS.map((domain) => {
    const criticalMissing = (domain === 'regulation' && !has('obligation-kyc')) || (domain === 'control' && !has('control-screening'));
    return { domain, required: true, discovered: !criticalMissing, authoritativeCoverage: criticalMissing ? 0 : 1, conflicts: [], staleEvidence: [], unknowns: criticalMissing ? [`Missing ${domain} evidence`] : [], score: criticalMissing ? 0 : 1, status: criticalMissing ? 'BLOCKED' : 'PASSED', rationale: criticalMissing ? 'Critical authoritative evidence is absent.' : 'Required synthetic authoritative context discovered.' };
  });
  const untrusted = changeCase.enterpriseSnapshot.objects.filter((object) => object.authority === 'UNTRUSTED');
  const findings = coverage.filter((entry) => entry.status === 'BLOCKED').map((entry) => finding('CRITICAL_CONTEXT_MISSING', 'CRITICAL', `Critical ${entry.domain} context is missing.`, plan.id, `Provide current authoritative ${entry.domain} evidence.`, evidenceRefs));
  const staleCritical = changeCase.enterpriseSnapshot.objects.filter((object) => object.freshness === 'STALE' && ['architecture-principle', 'policy', 'control'].includes(object.type));
  for (const entry of staleCritical) findings.push(finding('CRITICAL_CONTEXT_STALE', 'CRITICAL', `${entry.name} is stale beyond the reference policy threshold.`, entry.id, 'Retrieve and approve a current authoritative version before proceeding.'));
  const forged = changeCase.enterpriseSnapshot.objects.filter((object) => {
    const { contentHash, ...payload } = object;
    return contentHash !== digest(payload);
  });
  for (const entry of forged) findings.push(finding('PROVENANCE_HASH_INVALID', 'CRITICAL', `${entry.name} does not match its recorded source hash.`, entry.id, 'Reject the source and retrieve evidence from an authoritative adapter.'));
  for (const entry of untrusted) findings.push(finding('UNTRUSTED_CONTENT_ISOLATED', 'INFO', `${entry.name} was retained as data and excluded from authoritative coverage.`, entry.id, 'No action required unless an authorized owner promotes the source.', evidenceRefs));
  changeCase.artifacts.context = {
    plan, coverage, evidenceRefs,
    ...(changeCase.sourceBinding ? { sourceBindingHash: changeCase.sourceBinding.sourceHash, sourceBindingIntegrityHash: changeCase.sourceBinding.bindingHash, sourceBindingEvidenceRef } : {}),
    provenanceManifestHash: changeCase.sourceBinding
      ? digest({ evidenceRefs, sourceBindingHash: changeCase.sourceBinding.sourceHash, sourceBindingIntegrityHash: changeCase.sourceBinding.bindingHash })
      : digest(evidenceRefs),
    sourceModel: 'synthetic-reference-model',
  };
  return findings.some((entry) => entry.severity === 'CRITICAL') ? fail('context-sufficiency', [plan.id], findings, 'FAILED', coverage.reduce((sum, entry) => sum + entry.score, 0) / coverage.length) : pass('context-sufficiency', [plan.id], 1, findings);
}

function impactAnalysis(changeCase) {
  const selected = [...EXPECTED_IMPACTS];
  if (changeCase.mutation === 'omitted_reporting') selected.splice(selected.indexOf('system-reporting'), 1);
  const objectMap = new Map(changeCase.enterpriseSnapshot.objects.map((object) => [object.id, object]));
  const impacts = selected.filter((objectRef) => objectMap.has(objectRef)).map((objectRef, index) => ({
    id: id('impact'), objectRef, objectType: objectMap.get(objectRef).type, impactType: index < 10 ? 'DIRECT' : 'INDIRECT',
    confidence: 1, reason: 'Synthetic reference-model impact; not derived from the selected saved design.',
    evidenceRefs: changeCase.artifacts.context.evidenceRefs.filter((ref) => changeCase.evidenceLedger.find((entry) => entry.id === ref)?.objectRef === objectRef),
    dependencyPath: ['goal-digital-owner-update', objectRef], ownerRef: objectMap.get(objectRef).owner ?? null,
  }));
  if (changeCase.sourceBinding) {
    const binding = changeCase.sourceBinding;
    const existing = impacts.find((entry) => entry.objectRef === binding.objectId);
    if (existing) {
      existing.isRequestedSource = true;
      existing.reason = 'Selected saved-design source for this change; adjacent relationships below are synthetic reference-model analysis.';
      existing.evidenceRefs = [...new Set([...existing.evidenceRefs, changeCase.artifacts.context.sourceBindingEvidenceRef])];
      existing.sourceHash = binding.sourceHash;
    } else {
      impacts.unshift({
        id: id('impact'), objectRef: binding.objectId, objectType: binding.objectType, impactType: 'DIRECT',
        confidence: 1, reason: 'Selected saved-design source for this change; downstream impact has not yet been derived from project relationships.',
        evidenceRefs: [changeCase.artifacts.context.sourceBindingEvidenceRef], dependencyPath: [], ownerRef: null,
        isRequestedSource: true, sourceHash: binding.sourceHash,
      });
    }
  }
  const actual = new Set(impacts.map((impact) => impact.objectRef));
  const missing = [...EXPECTED_IMPACTS].filter((objectRef) => objectMap.has(objectRef) && !actual.has(objectRef));
  const findings = missing.map((objectRef) => finding('IMPACT_OMISSION', 'HIGH', `Independent critic found omitted impacted object ${objectRef}.`, objectRef, 'Add the downstream dependency and re-run impact analysis.'));
  const recall = EXPECTED_IMPACTS.size ? (EXPECTED_IMPACTS.size - missing.length) / EXPECTED_IMPACTS.size : 1;
  changeCase.artifacts.impact = {
    impacts, sourceModel: 'synthetic-reference-model',
    critic: { expected: [...EXPECTED_IMPACTS], missing, precision: 1, recall },
  };
  return findings.length ? fail('impact-completeness', impacts.map((entry) => entry.id), findings, 'FAILED', recall) : pass('impact-completeness', impacts.map((entry) => entry.id), recall);
}

function governanceAnalysis(changeCase) {
  const obligation = changeCase.enterpriseSnapshot.objects.find((object) => object.id === 'obligation-kyc');
  const mappings = [
    { sourceRef: 'obligation-kyc', obligationRef: 'obligation-kyc', applicability: 'APPLIES', rationale: 'The change mutates beneficial-owner information.', affectedRequirementRefs: ['REQ-CTL-1', 'REQ-CTL-2'], controlRefs: ['control-screening', 'control-manual-review'], humanInterpretationRequired: Boolean(obligation?.humanInterpretationRequired) },
    { sourceRef: 'policy-privacy', obligationRef: 'policy-privacy', applicability: 'APPLIES', rationale: 'The flow processes synthetic confidential ownership data.', affectedRequirementRefs: ['REQ-PRV-1'], controlRefs: ['control-audit'], humanInterpretationRequired: false },
  ];
  const unresolved = mappings.filter((entry) => entry.humanInterpretationRequired);
  const findings = unresolved.map((entry) => finding('HUMAN_INTERPRETATION_REQUIRED', 'HIGH', 'Authorized control interpretation is unresolved.', entry.obligationRef, 'A control owner must record a scoped interpretation before requirements are finalized.'));
  changeCase.artifacts.governance = { riskAssessment: { class: 'HIGH', rationale: 'Regulated customer ownership data and control path are affected.' }, mappings, authorityPath: ['role-product-owner', 'role-control-reviewer', 'role-release-approver'], segregationOfDuties: true };
  return unresolved.length ? fail('governance-applicability', mappings.map((entry) => entry.obligationRef), findings, 'NEEDS_HUMAN') : pass('governance-applicability', mappings.map((entry) => entry.obligationRef));
}

function requirementsEngineering(changeCase) {
  let artifact = changeCase.artifacts.requirements;
  if (!artifact) {
    const sourceLinks = changeCase.sourceBinding ? [
      { type: 'INTENT', ref: changeCase.intent.id },
      { type: 'SAVED_DESIGN_OBJECT', ref: changeCase.sourceBinding.objectId, hash: changeCase.sourceBinding.sourceHash },
    ] : [];
    const requirements = REQUIREMENT_SEED.map(([idValue, kind, statement, derivedFrom, criterion], index) => ({
      id: idValue, kind, statement, rationale: 'Synthetic reference template for owner review; verify against the linked intent and pinned saved-design source.',
      actor: 'Authorized customer representative', precondition: 'The actor is authenticated and authorized for the requested change.',
      observableResult: 'The requested change is saved with a durable outcome record.', derivedFrom,
      sourceLinks: structuredClone(sourceLinks),
      affectedObjects: derivedFrom, priority: index < 7 ? 'MUST' : 'SHOULD', acceptanceCriteria: [criterion], verificationMethod: kind === 'BUSINESS' ? 'SCENARIO_AND_OUTCOME' : 'AUTOMATED_TEST', independentVerification: 'A reviewer other than the requirement owner checks the evidence.', owner: changeCase.accountableOwner, risk: ['SECURITY', 'REGULATORY_CONTROL'].includes(kind) ? 'HIGH' : 'MEDIUM', status: 'DRAFT',
    }));
    if (changeCase.mutation === 'contradictory_requirement') {
      requirements.push({ id: 'REQ-BAD-1', kind: 'DATA', statement: 'Delete all audit evidence immediately after each request.', rationale: 'Injected mutation', derivedFrom: ['control-audit'], sourceLinks: structuredClone(sourceLinks), affectedObjects: ['control-audit'], priority: 'MUST', acceptanceCriteria: [], verificationMethod: null, owner: null, risk: 'HIGH', status: 'DRAFT' });
    }
    artifact = changeCase.artifacts.requirements = { requirements, draftRevision: 1, draftHistory: [], mutationCoverage: { checked: ['missing', 'ambiguous', 'contradictory', 'untestable'], detected: [] } };
  }
  const findings = validateRequirementDraft(artifact.requirements, changeCase);
  artifact.validationFindings = findings;
  artifact.mutationCoverage.detected = findings.map((entry) => entry.code);
  if (findings.length) return fail('requirements-quality', artifact.requirements.map((entry) => entry.id), findings);
  if (changeCase.sourceBinding) {
    const baseline = artifact.acceptedBaseline;
    const matches = requirementBaselineValid(changeCase);
    if (!matches) return fail('requirements-quality', artifact.requirements.map((entry) => entry.id), [finding('OWNER_ACCEPTANCE_REQUIRED', 'HIGH', 'Requirements are valid but remain a draft until the case owner accepts them.', 'requirements', 'Review the revisioned draft and explicitly accept it to freeze the G4 baseline.')], 'NEEDS_HUMAN');
  }
  if (artifact.acceptedBaseline) {
    artifact.requirements = structuredClone(artifact.acceptedBaseline.requirements);
    artifact.requirements.forEach((entry) => { entry.status = 'ACCEPTED'; });
  }
  return pass('requirements-quality', artifact.requirements.map((entry) => entry.id));
}

function architectureDraftCore(changeCase, artifact) {
  const requirements = changeCase.artifacts.requirements.acceptedBaseline;
  return {
    architectureId: artifact.architectureId,
    revision: artifact.draftRevision,
    options: artifact.options,
    selectedOptionId: artifact.selectedOptionId,
    selectionRationale: artifact.selectionRationale,
    requirementsBaseline: { version: requirements.version, contentHash: requirements.contentHash },
    sourceHash: changeCase.sourceBinding.sourceHash,
    intentHash: intentHash(changeCase.intent),
  };
}

function architectureDraftHash(changeCase, artifact) {
  return digest(architectureDraftCore(changeCase, artifact));
}

function architectureValidation(changeCase, artifact) {
  const findings = [];
  if (!artifact?.draftHash || artifact.draftHash !== architectureDraftHash(changeCase, artifact)) {
    findings.push(finding('ARCHITECTURE_DRAFT_INTEGRITY_INVALID', 'CRITICAL', 'The saved architecture draft hash does not match its contents.', 'architecture', 'Discard the altered draft and reconstruct it from the accepted requirements and pinned source.'));
  }
  if (!Array.isArray(artifact?.options) || artifact.options.length < 2) findings.push(finding('ARCHITECTURE_ALTERNATIVES_REQUIRED', 'HIGH', 'At least two comparable architecture options are required.', 'architecture', 'Keep two or more stable-ID options with tradeoffs.'));
  const ids = new Set();
  for (const option of Array.isArray(artifact?.options) ? artifact.options : []) {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      findings.push(finding('ARCHITECTURE_OPTION_INVALID', 'HIGH', 'Each architecture option must be a structured record.', 'architecture', 'Restore a valid saved option.'));
      continue;
    }
    if (!option.id || ids.has(option.id)) findings.push(finding('ARCHITECTURE_OPTION_ID_INVALID', 'HIGH', 'Architecture option IDs must be present and unique.', option.id ?? 'architecture', 'Use stable distinct option IDs.'));
    ids.add(option.id);
    for (const field of ['name', 'summary', 'dataOwnership', 'rollbackForwardRecovery']) {
      if (typeof option[field] !== 'string' || !option[field].trim() || option[field].trim().length > 1_000) findings.push(finding('ARCHITECTURE_OPTION_FIELD_INVALID', 'HIGH', `${option.id} needs a valid ${field}.`, option.id, `Provide ${field} within 1,000 characters.`));
    }
    for (const field of ['tradeoffs', 'interfaces', 'dependencies', 'healthCriteria']) {
      if (!Array.isArray(option[field]) || option[field].length < 1 || option[field].some((value) => typeof value !== 'string' || !value.trim() || value.length > 500)) findings.push(finding('ARCHITECTURE_OPTION_LIST_INVALID', 'HIGH', `${option.id} needs nonempty ${field}.`, option.id, `Provide one or more ${field} entries.`));
    }
    if (!Array.isArray(option.migration) || option.migration.length < 2
      || option.migration.some((entry, index) => entry?.step !== index + 1 || typeof entry.action !== 'string' || !entry.action.trim() || typeof entry.healthCheck !== 'string' || !entry.healthCheck.trim())) {
      findings.push(finding('ARCHITECTURE_MIGRATION_INVALID', 'HIGH', `${option.id} needs ordered migration steps with health checks.`, option.id, 'Provide sequential migration steps and a health check for each.'));
    }
  }
  if (!ids.has(artifact.selectedOptionId)) findings.push(finding('ARCHITECTURE_SELECTION_INVALID', 'HIGH', 'The selected architecture option does not exist.', 'architecture', 'Select one of the saved alternatives.'));
  if (typeof artifact.selectionRationale !== 'string' || !artifact.selectionRationale.trim() || artifact.selectionRationale.trim().length > 1_000) findings.push(finding('ARCHITECTURE_RATIONALE_INVALID', 'HIGH', 'The selection needs a rationale of 1–1,000 characters.', 'architecture', 'Explain why this option best fits the accepted requirements and saved design.'));
  const selected = artifact.options?.find((option) => option?.id === artifact.selectedOptionId);
  if (selected) {
    const selectedText = JSON.stringify(selected).toLowerCase();
    if (/\bdirect(?:ly)?\s+(?:(?:database|db)\s+)?writ(?:e|es|ing)\b|\bwrit(?:e|es|ing)\b.{0,35}\bdirectly\b|cross[- ]system.{0,50}(?:database|db)\s+writ/i.test(selectedText)) {
      findings.push(finding('ARCHITECTURE_CROSS_SYSTEM_WRITE', 'CRITICAL', 'The selected option proposes a direct database write.', selected.id, 'Route writes through the authoritative system’s owned API.'));
    }
    if (/bypass.{0,40}(authori[sz]ation|approval|requester)|skip.{0,30}(authori[sz]ation|approval)|no authori[sz]ation/i.test(selectedText)) {
      findings.push(finding('ARCHITECTURE_AUTHORITY_BYPASS', 'CRITICAL', 'The selected option bypasses an authorization or approval boundary.', selected.id, 'Preserve the required authority and approval checks in every write path.'));
    }
    const migration = Array.isArray(selected.migration) ? selected.migration : [];
    for (const [index, step] of migration.entries()) {
      const action = step?.action?.toLowerCase() ?? '';
      const removesSchema = /\b(drop|remove|replace|delete|decommission)\b.{0,60}\b(schema|table|column|field|database|db|legacy store|old store)\b/.test(action);
      if (!removesSchema) continue;
      const compatibilityEstablishedEarlier = migration.slice(0, index).some((prior) => {
        const evidence = `${prior?.action ?? ''} ${prior?.healthCheck ?? ''}`.toLowerCase();
        return /\b(backward compatib\w*|compatib\w*|coexist\w*|reconcil\w*|expand\w*|shadow\w*|parity)\b/.test(evidence);
      });
      if (!compatibilityEstablishedEarlier) {
        findings.push(finding('ARCHITECTURE_MIGRATION_INCOMPATIBLE', 'CRITICAL', 'A migration removes or replaces existing schema before an earlier step establishes compatibility.', selected.id, 'Verify expand, coexistence or reconciliation health in an earlier migration step before removing old schema.'));
        break;
      }
    }
  }
  const requirementBaseline = changeCase.artifacts.requirements?.acceptedBaseline;
  if (!requirementBaselineValid(changeCase) || artifact.requirementsBaselineHash !== requirementBaseline?.contentHash || artifact.requirementsBaselineVersion !== requirementBaseline?.version) {
    findings.push(finding('ARCHITECTURE_REQUIREMENTS_BINDING_INVALID', 'CRITICAL', 'The architecture draft is not bound to the current accepted requirements baseline.', 'architecture', 'Rebuild the draft from the accepted G4 requirements baseline.'));
  }
  if (artifact.sourceHash !== changeCase.sourceBinding?.sourceHash || artifact.intentHash !== intentHash(changeCase.intent)) findings.push(finding('ARCHITECTURE_SOURCE_BINDING_INVALID', 'CRITICAL', 'The architecture draft is not bound to the pinned source and current intent.', 'architecture', 'Rebuild the draft from the current pinned source and intent.'));
  return findings;
}

function architectureBaselineValid(changeCase) {
  const artifact = changeCase.artifacts.architecture;
  const baseline = artifact?.acceptedBaseline;
  if (!changeCase.sourceBinding || !baseline || !requirementBaselineValid(changeCase)) return false;
  const core = {
    architectureId: baseline.architectureId, revision: baseline.draftRevision,
    options: baseline.options, selectedOptionId: baseline.selectedOptionId,
    selectionRationale: baseline.selectionRationale,
    requirementsBaseline: { version: baseline.requirementsBaselineVersion, contentHash: baseline.requirementsBaselineHash },
    sourceHash: baseline.sourceHash, intentHash: baseline.intentHash,
  };
  try {
    return baseline.version === 1
    && baseline.draftRevision === artifact.draftRevision
    && baseline.draftHash === digest(core)
    && baseline.draftHash === architectureDraftHash(changeCase, artifact)
    && baseline.requirementsBaselineHash === changeCase.artifacts.requirements.acceptedBaseline.contentHash
    && baseline.requirementsBaselineVersion === changeCase.artifacts.requirements.acceptedBaseline.version
    && baseline.sourceHash === changeCase.sourceBinding.sourceHash
    && baseline.intentHash === intentHash(changeCase.intent)
      && architectureValidation(changeCase, artifact).length === 0;
  } catch {
    return false;
  }
}

export function verifyAcceptedG6Plan(changeCase) {
  normalizeChangeCase(changeCase);
  const plan = changeCase.artifacts?.plan;
  const architecture = changeCase.artifacts?.architecture?.acceptedBaseline;
  const g6Passed = changeCase.gateHistory?.some((entry) => entry.gate === 'G6' && entry.status === 'PASSED');
  const workItems = plan?.workItems;
  const workIds = Array.isArray(workItems) ? workItems.map((item) => item?.id) : [];
  const uniqueWorkIds = workIds.every((id) => typeof id === 'string' && id.length > 0) && new Set(workIds).size === workIds.length;
  const valid = Boolean(changeCase.sourceBinding && verifySourceBinding(changeCase.sourceBinding).valid
    && requirementBaselineValid(changeCase) && architectureBaselineValid(changeCase)
    && g6Passed && plan?.contentHash && Array.isArray(workItems) && workItems.length > 0
    && digest(workItems) === plan.contentHash
    && workItems.every((item) => item.architectureBaselineHash === architecture.draftHash)
    && uniqueWorkIds
    && workItems.every((item) => Array.isArray(item.dependencies) && item.dependencies.every((dependency) => workIds.includes(dependency) && dependency !== item.id)
      && Array.isArray(item.requirementRefs) && item.requirementRefs.every((ref) => typeof ref === 'string')
      && Array.isArray(item.decisionRefs) && item.decisionRefs.every((ref) => typeof ref === 'string')
      && typeof item.contextPackageRef === 'string' && item.contextPackageRef.length > 0));
  return { valid, planHash: valid ? plan.contentHash : null, reason: valid ? null : 'Accepted G4, G5, source, or G6 plan integrity/binding is invalid.' };
}

function initialArchitectureDraft(changeCase) {
  const requirementBaseline = changeCase.artifacts.requirements.acceptedBaseline;
  const options = [
    {
      id: 'ARCH-OPT-API-OUTBOX', name: 'Owned API with transactional outbox',
      summary: 'The Party API owns writes and publishes versioned changes through an outbox.',
      tradeoffs: ['Strong data ownership and durable publication.', 'Requires outbox operations and consumer reconciliation.'],
      interfaces: ['POST /beneficial-owner-changes', 'ownership-change.v1'],
      dataOwnership: 'Party MDM remains authoritative; only its owned API writes records.',
      dependencies: ['Corporate mandate and IAM check', 'Party MDM API', 'Transactional outbox', 'CRM/reporting consumers'],
      migration: [
        { step: 1, action: 'Add the versioned API and event contract in shadow mode.', healthCheck: 'Contract tests pass; no production traffic moves.' },
        { step: 2, action: 'Enable API writes and outbox publication for a limited cohort.', healthCheck: 'Write parity and event lag remain within agreed limits.' },
        { step: 3, action: 'Expand consumers and retire the legacy intake after reconciliation.', healthCheck: 'Reconciled counts and control outcomes match.' },
      ],
      healthCriteria: ['API availability ≥ 99.9% during the rollout window.', 'Outbox lag stays below 60 seconds.', 'Every active change has an authorization and screening record.'],
      rollbackForwardRecovery: 'Disable digital intake, retain accepted records and evidence, drain or reconcile the outbox, then restore traffic only after counts match.',
    },
    {
      id: 'ARCH-OPT-API-SYNC', name: 'Owned API with synchronous consumer updates',
      summary: 'The Party API remains the sole writer and synchronously coordinates downstream consumers.',
      tradeoffs: ['Simpler initial deployment and immediate downstream visibility.', 'Higher latency and a wider failure surface when any consumer is unavailable.'],
      interfaces: ['POST /beneficial-owner-changes', 'CRM/reporting owned APIs'],
      dataOwnership: 'Party MDM remains authoritative; downstream systems update only through their owned APIs.',
      dependencies: ['Corporate mandate and IAM check', 'Party MDM API', 'CRM API', 'Reporting API'],
      migration: [
        { step: 1, action: 'Add consumer API contracts and idempotent correlation keys.', healthCheck: 'All consumer contract and timeout tests pass.' },
        { step: 2, action: 'Run synchronous fan-out for a limited cohort.', healthCheck: 'Latency, retry and partial-failure metrics stay within limits.' },
        { step: 3, action: 'Expand only after reconciliation and recovery drills pass.', healthCheck: 'Repeated requests create one logical update per system.' },
      ],
      healthCriteria: ['End-to-end API availability ≥ 99.5% during rollout.', 'P95 completion stays below 5 seconds.', 'Partial consumer failure is surfaced and reconciled without duplicate updates.'],
      rollbackForwardRecovery: 'Stop new digital submissions, replay only idempotent incomplete consumer updates from the correlation ledger, reconcile each system, then resume the cohort.',
    },
  ];
  const artifact = {
    architectureId: id('architecture'), draftRevision: 1, options,
    selectedOptionId: options[0].id,
    selectionRationale: 'The outbox option preserves authoritative ownership and permits downstream recovery without holding the customer request open.',
    requirementsBaselineVersion: requirementBaseline.version,
    requirementsBaselineHash: requirementBaseline.contentHash,
    sourceHash: changeCase.sourceBinding.sourceHash, intentHash: intentHash(changeCase.intent),
    draftHistory: [], validationFindings: [], acceptedBaseline: null,
  };
  artifact.draftHash = architectureDraftHash(changeCase, artifact);
  return artifact;
}

export function editArchitectureDraft(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'edit-architecture');
  if (replayed) return { changeCase, replayed: true };
  const artifact = changeCase.artifacts.architecture;
  if (!changeCase.sourceBinding || changeCase.currentStage !== 'S5' || !artifact || artifact.acceptedBaseline) throw commandError('Architecture is not open for editing.', 409);
  if (!artifact.draftHash || artifact.draftHash !== architectureDraftHash(changeCase, artifact)) throw commandError('Architecture draft integrity failed; it cannot be edited or accepted.', 409);
  if (command.expectedDraftRevision !== artifact.draftRevision) throw commandError(`Architecture draft revision conflict: current revision is ${artifact.draftRevision}.`, 409);
  const changes = command.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw commandError('Architecture changes must be a nonempty object.');
  const optionFields = ['name', 'summary', 'tradeoffs', 'interfaces', 'dataOwnership', 'dependencies', 'migration', 'healthCriteria', 'rollbackForwardRecovery'];
  const draftFields = ['selectedOptionId', 'selectionRationale'];
  if (Object.keys(changes).some((field) => !optionFields.includes(field) && !draftFields.includes(field))) throw commandError('These architecture fields are not editable.');
  const optionId = safeText(command.optionId, 100) || null;
  if (optionFields.some((field) => Object.hasOwn(changes, field)) && !optionId) throw commandError('Select the architecture option being edited.');
  for (const [field, value] of Object.entries(changes)) {
    if (['selectedOptionId', 'selectionRationale', 'name', 'summary', 'dataOwnership', 'rollbackForwardRecovery'].includes(field)
      && typeof value !== 'string') throw commandError(`${field} must be text.`);
    if (['tradeoffs', 'interfaces', 'dependencies', 'healthCriteria'].includes(field)
      && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) throw commandError(`${field} must be a list of text entries.`);
    if (field === 'migration' && (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)))) throw commandError('migration must be a list of ordered steps.');
  }
  if (optionId) {
    const option = artifact.options.find((entry) => entry.id === optionId);
    if (!option) throw commandError('Architecture option not found.', 404);
    for (const field of optionFields) if (Object.hasOwn(changes, field)) option[field] = structuredClone(changes[field]);
  }
  if (Object.hasOwn(changes, 'selectedOptionId')) artifact.selectedOptionId = changes.selectedOptionId;
  if (Object.hasOwn(changes, 'selectionRationale')) artifact.selectionRationale = changes.selectionRationale;
  artifact.draftRevision += 1;
  artifact.draftHash = architectureDraftHash(changeCase, artifact);
  artifact.validationFindings = architectureValidation(changeCase, artifact);
  const actor = safeText(command.actor, 120) || changeCase.accountableOwner;
  artifact.draftHistory.push({ revision: artifact.draftRevision, optionId, changes: structuredClone(changes), actor, at: now() });
  return finishCommand(changeCase, key, requestHash, 'edit-architecture', actor, 'ArchitectureDraftEdited', { draftRevision: artifact.draftRevision, optionId, changedFields: Object.keys(changes).sort(), draftHash: artifact.draftHash });
}

function sourceBoundArchitectureDesign(changeCase) {
  let artifact = changeCase.artifacts.architecture;
  if (!artifact) artifact = changeCase.artifacts.architecture = initialArchitectureDraft(changeCase);
  artifact.validationFindings = architectureValidation(changeCase, artifact);
  if (artifact.validationFindings.length) return fail('architecture-conformance', [artifact.architectureId], artifact.validationFindings);
  if (!architectureBaselineValid(changeCase)) return fail('architecture-conformance', [artifact.architectureId], [finding('OWNER_ACCEPTANCE_REQUIRED', 'HIGH', 'Architecture alternatives are ready for owner review but have not been accepted.', artifact.architectureId, 'Compare the alternatives and explicitly accept the selected architecture to pass G5.')], 'NEEDS_HUMAN');
  const baseline = artifact.acceptedBaseline;
  const selected = baseline.options.find((entry) => entry.id === baseline.selectedOptionId);
  const change = {
    id: baseline.architectureId, baselineRefs: ['system-portal', 'system-customer-api', 'system-party-mdm', 'system-kyc', 'system-events'],
    targetRefs: ['service-repository'], additions: selected.interfaces, modifications: ['Corporate Portal submission journey', 'KYC screening orchestration'], removals: [],
    dataFlows: selected.interfaces.map((mechanism) => ({ from: 'system-portal', to: 'system-customer-api', mechanism, data: 'beneficial-owner change' })),
    trustBoundaries: ['Portal → IAM', 'API → synthetic Authlayer policy', 'KYC → human review'], interfaces: selected.interfaces,
    dataOwnership: selected.dataOwnership, dependencies: selected.dependencies, migration: selected.migration,
    rollback: selected.rollbackForwardRecovery, healthCriteria: selected.healthCriteria,
    fitnessFunctions: ['no-cross-system-db-write', 'required-authority-path', 'event-consumer-coverage', 'rollback-present'],
    requirementsBaselineHash: baseline.requirementsBaselineHash, sourceHash: baseline.sourceHash,
  };
  const decision = {
    id: 'ADR-ARCH-001', problem: 'Choose a recoverable architecture for the saved-design change.',
    alternatives: baseline.options.map(({ id: optionId, name, summary, tradeoffs }) => ({ id: optionId, name, summary, tradeoffs })),
    selectedOptionId: selected.id, selectedOption: selected.name, rationale: baseline.selectionRationale,
    requirementsSatisfied: requirementsForDesign(changeCase).map((entry) => entry.id),
    requirementsBaselineHash: baseline.requirementsBaselineHash, principlesApplied: ['data-ownership', 'recoverability'],
    impactedObjects: change.baselineRefs, risks: selected.tradeoffs, evidenceRefs: changeCase.artifacts.context.evidenceRefs,
  };
  change.contentHash = digest(change); decision.contentHash = digest(decision);
  artifact.change = change; artifact.decisions = [decision];
  artifact.fitnessResults = change.fitnessFunctions.map((name) => ({ name, status: 'PASS' }));
  artifact.sourceModel = 'owner-accepted-source-bound-draft';
  return pass('architecture-conformance', [change.id, decision.id]);
}

export function acceptArchitectureDraft(changeCase, command = {}) {
  normalizeChangeCase(changeCase);
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'accept-architecture');
  if (replayed) return { changeCase, replayed: true };
  const artifact = changeCase.artifacts.architecture;
  if (!changeCase.sourceBinding || changeCase.currentStage !== 'S5' || !artifact) throw commandError('The source-bound architecture gate is not awaiting acceptance.', 409);
  if (artifact.acceptedBaseline) throw commandError('An accepted architecture baseline is already frozen.', 409);
  if (command.expectedDraftRevision !== artifact.draftRevision) throw commandError(`Architecture draft revision conflict: current revision is ${artifact.draftRevision}.`, 409);
  const actor = safeText(command.actor, 120);
  if (!actor || actor !== changeCase.accountableOwner || actor !== changeCase.createdBy) {
    const error = new Error('Only the case owner can accept the architecture baseline.');
    error.statusCode = 403;
    throw error;
  }
  artifact.validationFindings = architectureValidation(changeCase, artifact);
  if (artifact.validationFindings.length) throw commandError('Architecture alternatives must pass validation before owner acceptance.', 409);
  artifact.draftHash = architectureDraftHash(changeCase, artifact);
  artifact.acceptedBaseline = {
    version: 1, draftRevision: artifact.draftRevision, architectureId: artifact.architectureId,
    options: structuredClone(artifact.options), selectedOptionId: artifact.selectedOptionId,
    selectionRationale: artifact.selectionRationale, requirementsBaselineVersion: artifact.requirementsBaselineVersion,
    requirementsBaselineHash: artifact.requirementsBaselineHash, sourceHash: artifact.sourceHash,
    intentHash: artifact.intentHash, draftHash: artifact.draftHash, acceptedBy: actor, acceptedAt: now(),
  };
  if (!architectureBaselineValid(changeCase)) throw commandError('Accepted architecture failed integrity verification.', 409);
  const stage = stageAt(changeCase.currentStageIndex);
  const startedAt = now();
  const result = sourceBoundArchitectureDesign(changeCase);
  if (result.status !== 'PASSED') throw commandError('Accepted architecture did not satisfy the G5 fitness gate.', 409);
  changeCase.evaluations.push(result);
  changeCase.gateHistory.push(gateDecision(stage, result, result.id));
  changeCase.stageRuns.push(stageRun(changeCase, stage, 'PASSED', startedAt, result.subjectRefs));
  changeCase.metrics.stagePasses += 1;
  changeCase.events.push(eventEnvelope(changeCase, 'GatePassed', actor, { stage: stage.id, gate: stage.gate, evaluationRef: result.id, status: result.status }, changeCase.events.at(-1)?.id));
  changeCase.currentStageIndex += 1;
  const next = stageAt(changeCase.currentStageIndex);
  changeCase.currentStage = next?.id ?? null;
  changeCase.status = next ? 'RUNNING' : 'PASSED';
  return finishCommand(changeCase, key, requestHash, 'accept-architecture', actor, 'ArchitectureBaselineAccepted', {
    draftRevision: artifact.draftRevision, baselineVersion: artifact.acceptedBaseline.version,
    draftHash: artifact.draftHash, requirementsBaselineHash: artifact.requirementsBaselineHash,
    sourceHash: artifact.sourceHash, intentHash: artifact.intentHash, gate: stage.gate,
  });
}

function architectureDesign(changeCase) {
  if (changeCase.sourceBinding) return sourceBoundArchitectureDesign(changeCase);
  if (changeCase.sourceBinding && !requirementBaselineValid(changeCase)) {
    return fail('architecture-conformance', ['accepted-requirements'], [finding('ACCEPTED_REQUIREMENTS_INVALID', 'CRITICAL', 'The accepted G4 requirements baseline failed integrity verification.', 'requirements', 'Restore or re-accept a validated requirements baseline before architecture work.')]);
  }
  const change = {
    id: id('architecture-change'), baselineRefs: ['system-portal', 'system-customer-api', 'system-party-mdm', 'system-kyc', 'system-events'],
    targetRefs: ['service-repository'],
    additions: ['BeneficialOwnerChange endpoint', 'ownership-change.v1 event', 'idempotent reconciliation worker'],
    modifications: ['Corporate Portal submission journey', 'KYC screening orchestration'], removals: [],
    dataFlows: [
      { from: 'system-portal', to: 'system-customer-api', mechanism: 'versioned API', data: 'beneficial-owner change' },
      { from: 'system-customer-api', to: 'system-party-mdm', mechanism: changeCase.mutation === 'direct_database' ? 'direct database write' : 'owned repository adapter', data: 'validated beneficial-owner record' },
      { from: 'system-party-mdm', to: 'system-events', mechanism: 'transactional outbox', data: 'ownership-change.v1' },
    ],
    trustBoundaries: changeCase.mutation === 'authority_bypass' ? ['Portal directly marks change authorized'] : ['Portal → IAM', 'API → synthetic Authlayer policy', 'KYC → human review'],
    interfaces: ['POST /beneficial-owner-changes', 'ownership-change.v1'], migration: 'Additive schema and dual-read projection before cutover', rollback: changeCase.mutation === 'missing_rollback' ? '' : 'Disable digital intake and drain/reconcile outbox; retain evidence', observability: 'Correlation ID, screening/review counters, propagation lag, manual-work measure',
    fitnessFunctions: ['no-cross-system-db-write', 'required-authority-path', 'event-consumer-coverage', 'rollback-present'],
  };
  const decision = { id: 'ADR-BO-001', problem: 'Introduce digital ownership maintenance without bypassing controls.', options: ['Owned API and governed events', 'Portal writes Party MDM database'], selectedOption: 'Owned API and governed events', rationale: 'Preserves data ownership, authority, and downstream consistency.', requirementsSatisfied: requirementsForDesign(changeCase).map((entry) => entry.id), principlesApplied: ['principle-api', 'principle-authority'], impactedObjects: change.baselineRefs, risks: ['risk-incorrect-owner'], assumptions: ['Synthetic integration contracts are available'], evidenceRefs: changeCase.artifacts.context.evidenceRefs, approvalRefs: [] };
  const findings = [];
  if (change.dataFlows.some((flow) => /direct database/i.test(flow.mechanism))) findings.push(finding('CROSS_SYSTEM_DB_ACCESS', 'CRITICAL', 'Design bypasses the owning application service with direct database access.', change.id, 'Use the versioned Customer / Party API and owned repository boundary.'));
  if (change.trustBoundaries.some((entry) => /directly marks/i.test(entry))) findings.push(finding('AUTHORITY_PATH_BYPASS', 'CRITICAL', 'Design lets the requester assert protected authority.', change.id, 'Route authority through IAM/Authlayer policy and durable approvals.'));
  if (!change.rollback) findings.push(finding('ROLLBACK_MISSING', 'HIGH', 'Architecture change has no rollback or forward-fix design.', change.id, 'Define a tested rollback/reconciliation path before planning delivery.'));
  change.contentHash = digest(change); decision.contentHash = digest(decision);
  changeCase.artifacts.architecture = { change, decisions: [decision], fitnessResults: change.fitnessFunctions.map((name) => ({ name, status: findings.some((entry) => (name === 'no-cross-system-db-write' && entry.code === 'CROSS_SYSTEM_DB_ACCESS') || (name === 'required-authority-path' && entry.code === 'AUTHORITY_PATH_BYPASS') || (name === 'rollback-present' && entry.code === 'ROLLBACK_MISSING')) ? 'FAIL' : 'PASS' })) };
  return findings.length ? fail('architecture-conformance', [change.id, decision.id], findings) : pass('architecture-conformance', [change.id, decision.id]);
}

function hasCycle(workItems) {
  const byId = new Map(workItems.map((entry) => [entry.id, entry]));
  const visiting = new Set(); const visited = new Set();
  const visit = (itemId) => {
    if (visiting.has(itemId)) return true;
    if (visited.has(itemId)) return false;
    visiting.add(itemId);
    for (const dependency of byId.get(itemId)?.dependencies ?? []) if (visit(dependency)) return true;
    visiting.delete(itemId); visited.add(itemId); return false;
  };
  return workItems.some((entry) => visit(entry.id));
}

function deliveryPlanning(changeCase) {
  if (changeCase.sourceBinding && !requirementBaselineValid(changeCase)) {
    return fail('plan-executability', ['accepted-requirements'], [finding('ACCEPTED_REQUIREMENTS_INVALID', 'CRITICAL', 'The accepted G4 requirements baseline failed integrity verification.', 'requirements', 'Restore or re-accept a validated requirements baseline before planning.')]);
  }
  if (changeCase.sourceBinding && !architectureBaselineValid(changeCase)) {
    return fail('plan-executability', ['accepted-architecture'], [finding('ACCEPTED_ARCHITECTURE_INVALID', 'CRITICAL', 'The accepted G5 architecture baseline failed integrity verification.', 'architecture', 'Restore or re-accept a valid architecture baseline before planning.')]);
  }
  const requirements = requirementsForDesign(changeCase);
  const requirementIds = requirements.map((entry) => entry.id);
  const acceptedArchitecture = changeCase.sourceBinding ? changeCase.artifacts.architecture.acceptedBaseline : null;
  const architectureRefs = acceptedArchitecture
    ? [acceptedArchitecture.architectureId, acceptedArchitecture.selectedOptionId, acceptedArchitecture.draftHash]
    : ['ADR-BO-001', changeCase.artifacts.architecture.change.id];
  const definitions = [
    ['WORK-1', 'Define versioned API, event, and data contracts', ['REQ-FUN-1', 'REQ-DATA-1', 'REQ-INT-1'], []],
    ['WORK-2', 'Implement authorization and idempotent intake', ['REQ-BUS-1', 'REQ-SEC-1', 'REQ-OPS-1'], ['WORK-1']],
    ['WORK-3', 'Implement screening and manual-review control path', ['REQ-CTL-1', 'REQ-CTL-2'], ['WORK-1', 'WORK-2']],
    ['WORK-4', 'Implement authoritative persistence and outbox', ['REQ-DATA-1', 'REQ-RES-1'], ['WORK-1', 'WORK-3']],
    ['WORK-5', 'Implement downstream consumers and privacy controls', ['REQ-INT-1', 'REQ-PRV-1'], ['WORK-4']],
    ['WORK-6', 'Add telemetry, migration, rollback, and reconciliation', ['REQ-OPS-1', 'REQ-RES-1'], ['WORK-4', 'WORK-5']],
    ['WORK-7', 'Run multidimensional verification and produce release evidence', requirementIds, ['WORK-2', 'WORK-3', 'WORK-4', 'WORK-5', 'WORK-6']],
    ['WORK-8', 'Observe manual-work and control outcomes', ['REQ-OUT-1'], ['WORK-7']],
  ];
  if (changeCase.mutation === 'plan_cycle') definitions[0][3].push('WORK-7');
  const packages = [];
  const workItems = definitions.map(([itemId, objective, refs, dependencies]) => {
    const contextPackage = {
      id: id('context-package'), task: itemId, objective, requirements: refs,
      acceptanceCriteria: refs.flatMap((ref) => requirements.find((entry) => entry.id === ref)?.acceptanceCriteria ?? []),
      architecture: architectureRefs,
      enterpriseObjects: [...new Set(refs.flatMap((ref) => requirements.find((entry) => entry.id === ref)?.affectedObjects ?? []))],
      contracts: itemId === 'WORK-1' ? ['POST /beneficial-owner-changes', 'ownership-change.v1'] : [],
      constraints: changeCase.intent.constraints, tests: ['unit', 'contract', 'integration', 'security'],
      provenanceManifest: changeCase.artifacts.context.provenanceManifestHash,
      exclusions: ['Real customer data', 'Production credentials', 'Legal interpretation'], tokenBudget: 8_000,
    };
    contextPackage.contentHash = digest(contextPackage); packages.push(contextPackage);
    return { id: itemId, objective, requirementRefs: refs, decisionRefs: acceptedArchitecture ? ['ADR-ARCH-001', acceptedArchitecture.selectedOptionId] : ['ADR-BO-001'], architectureBaselineHash: acceptedArchitecture?.draftHash ?? null, scope: 'beneficial-owner-reference-service', repository: 'synthetic/reference-service', component: itemId === 'WORK-5' ? 'event-consumers' : 'beneficial-owner-service', dependencies, acceptanceCriteria: contextPackage.acceptanceCriteria, contextPackageRef: contextPackage.id, risk: refs.some((ref) => ref.includes('SEC') || ref.includes('CTL')) ? 'HIGH' : 'MEDIUM', verificationRefs: [] };
  });
  const covered = new Set(workItems.flatMap((entry) => entry.requirementRefs));
  const orphan = requirementIds.filter((ref) => !covered.has(ref));
  const findings = orphan.map((ref) => finding('UNCOVERED_REQUIREMENT', 'HIGH', `${ref} is not covered by delivery work.`, ref, 'Add an executable or explicit non-code work item.'));
  if (hasCycle(workItems)) findings.push(finding('PLAN_DEPENDENCY_CYCLE', 'CRITICAL', 'Delivery dependency graph contains a cycle.', 'delivery-plan', 'Remove the cyclic dependency and recompute the DAG.'));
  changeCase.artifacts.plan = { id: id('delivery-plan'), workItems, contextPackages: packages, dependencyOrder: workItems.map((entry) => entry.id), contentHash: digest(workItems) };
  return findings.length ? fail('plan-executability', [changeCase.artifacts.plan.id], findings) : pass('plan-executability', [changeCase.artifacts.plan.id]);
}

function implementation(changeCase) {
  const files = [
    { path: 'src/beneficial-owner-change.ts', content: 'export async function submitBeneficialOwnerChange(command: AuthorizedChangeCommand): Promise<ChangeReceipt> { return executeGovernedChange(command); }' },
    { path: 'src/contracts/ownership-change.v1.json', content: JSON.stringify({ type: 'object', required: ['changeId', 'partyId', 'ownerVersion', 'correlationId'] }) },
    { path: 'tests/beneficial-owner-change.test.ts', content: 'test("denies unauthorized change and preserves one idempotent update", verifyGovernedOwnerChange);' },
  ].map((file) => ({ ...file, contentHash: digest(file.content) }));
  const artifact = {
    id: id('change-set'), adapter: { port: 'ExecutionPort', implementation: 'DeterministicReferenceCodingAdapter', version: '1.0.0' },
    principal: 'actor-implementation-agent', repository: 'synthetic/reference-service', branch: `mvpx/${changeCase.id}`,
    contextPackageRefs: changeCase.artifacts.plan.contextPackages.map((entry) => entry.id), files,
    toolVersions: { runtime: process.version, adapter: '1.0.0' }, generatedAt: now(),
  };
  artifact.contentHash = digest(artifact.files);
  const checks = ['build', 'typecheck', 'unit', 'contract', 'security', 'tenant-isolation', 'architecture-fitness'].map((name) => ({ name, status: changeCase.mutation === 'failing_ci' && name === 'security' ? 'FAIL' : 'PASS', evidenceHash: digest(`${name}:${changeCase.id}`) }));
  const findings = checks.filter((entry) => entry.status === 'FAIL').map((entry) => finding('IMPLEMENTATION_CHECK_FAILED', 'CRITICAL', `${entry.name} check failed.`, artifact.id, 'Repair the bounded change and re-run all checks.'));
  changeCase.artifacts.implementation = { artifact, checks, executionResult: { status: findings.length ? 'FAILED' : 'COMPLETED', changedArtifacts: files.map((entry) => entry.path), model: null, tokens: 0, cost: 0, evidenceHash: digest({ artifact: artifact.contentHash, checks }) } };
  return findings.length ? fail('implementation-verification', [artifact.id], findings) : pass('implementation-verification', [artifact.id]);
}

function assurance(changeCase) {
  const artifact = changeCase.artifacts.implementation.artifact;
  const evaluatedHash = artifact.contentHash;
  const candidateHash = changeCase.mutation === 'artifact_tamper' ? digest(`${evaluatedHash}:tampered`) : evaluatedHash;
  const matrix = ASSURANCE_DIMENSIONS.map((dimension) => ({
    dimension, status: dimension === 'AI_BEHAVIOR' ? 'NOT_APPLICABLE' : 'PASS',
    rationale: dimension === 'AI_BEHAVIOR' ? 'The reference change has no runtime AI behavior.' : 'Reference deterministic evidence satisfies this dimension.',
    evidenceRefs: changeCase.artifacts.implementation.checks.map((entry) => entry.evidenceHash),
  }));
  const findings = [];
  if (candidateHash !== evaluatedHash) findings.push(finding('ARTIFACT_HASH_MISMATCH', 'CRITICAL', 'Candidate artifact differs from the evaluated artifact.', artifact.id, 'Re-evaluate the exact candidate hash before release.'));
  if (matrix.some((entry) => entry.status === 'FAIL')) findings.push(finding('ASSURANCE_DIMENSION_FAILED', 'CRITICAL', 'A blocking assurance dimension failed.', artifact.id, 'Repair and re-run assurance.'));
  const bundle = {
    id: id('release-evidence'), changeCaseRef: changeCase.id, artifactRefs: [artifact.id], artifactHash: candidateHash, evaluatedArtifactHash: evaluatedHash,
    requirementsCoverage: changeCase.artifacts.requirements.requirements.map((entry) => ({ requirementRef: entry.id, status: 'VERIFIED', evidenceRefs: changeCase.artifacts.implementation.checks.map((check) => check.evidenceHash) })),
    evaluationResults: changeCase.evaluations.map((entry) => entry.id), testResults: changeCase.artifacts.implementation.checks,
    securityResults: matrix.filter((entry) => entry.dimension === 'SECURITY'), architectureResults: changeCase.artifacts.architecture.fitnessResults,
    controlEvidence: changeCase.artifacts.governance.mappings, unresolvedRisks: [], approvals: [], rollbackEvidence: changeCase.artifacts.architecture.change.rollback,
    observabilityEvidence: changeCase.artifacts.architecture.change.observability,
    provenanceManifest: digest(changeCase.evidenceLedger.map((entry) => entry.contentHash)), createdAt: now(),
  };
  bundle.contentHash = digest(bundle);
  changeCase.artifacts.assurance = { matrix, releaseEvidenceBundle: bundle };
  return findings.length ? fail('release-readiness', [bundle.id], findings) : pass('release-readiness', [bundle.id]);
}

export function releaseApprovalCandidate(changeCase) {
  return (changeCase.approvals ?? []).findLast((approval) => approval.action === 'release'
    && approval.status === 'APPROVED' && approval.principal !== 'actor-implementation-agent'
    && Array.isArray(approval.roles) && approval.roles.includes('release-approver')
    && approval.roles.includes('control-owner') && !approval.usedAt) ?? null;
}

function authorityAndRelease(changeCase) {
  const request = { principal: 'actor-implementation-agent', action: 'deploy', asset: 'beneficial-owner-reference-service', environment: 'production-like', risk: 'HIGH', autonomyLevel: 'L2' };
  const validApproval = releaseApprovalCandidate(changeCase);
  if (!validApproval) {
    changeCase.artifacts.authority = { request, decision: 'REQUIRE_HUMAN_APPROVAL', requiredRoles: ['release-approver', 'control-owner'] };
    return fail('release-authority', [changeCase.artifacts.assurance.releaseEvidenceBundle.id], [finding('RELEASE_APPROVAL_REQUIRED', 'HIGH', 'Protected production-like release requires independent human approval.', request.asset, 'Approve as a distinct release approver and control owner.')], 'NEEDS_HUMAN');
  }
  validApproval.usedAt = now();
  const { contentHash: _oldApprovalHash, ...approvalPayload } = validApproval;
  validApproval.contentHash = digest(approvalPayload);
  const draftBundle = changeCase.artifacts.assurance.releaseEvidenceBundle;
  const { contentHash: _draftHash, ...bundlePayload } = draftBundle;
  const finalBundle = { ...bundlePayload, id: id('release-evidence'), priorBundleRef: draftBundle.id, approvals: [validApproval.id], finalizedAt: now() };
  finalBundle.contentHash = digest(finalBundle);
  changeCase.artifacts.assurance.draftReleaseEvidenceBundle = draftBundle;
  changeCase.artifacts.assurance.releaseEvidenceBundle = finalBundle;
  const release = { id: id('release'), changeCaseRef: changeCase.id, artifactHash: finalBundle.artifactHash, evidenceBundleRef: finalBundle.id, environment: 'synthetic-production-like', status: 'RELEASED', authorizedBy: validApproval.id, releasedAt: now(), externalEffect: false };
  release.contentHash = digest(release);
  changeCase.artifacts.authority = { request, decision: 'ALLOW', approvalRef: validApproval.id };
  changeCase.artifacts.release = release;
  return pass('release-authority', [release.id]);
}

function outcomeEvaluation(changeCase) {
  if (!changeCase.artifacts.observation?.signals) {
    return fail('outcome-achievement', [changeCase.intent.id], [finding('OBSERVATION_REQUIRED', 'MEDIUM', 'Runtime and business outcome signals have not been recorded.', changeCase.intent.id, 'Record the synthetic reference observation window.')], 'NEEDS_HUMAN');
  }
  const signals = changeCase.artifacts.observation.signals;
  const technicalOutcome = signals.technicalHealthy ? 'PASS' : 'FAIL';
  const controlOutcome = signals.controlExceptions === 0 ? 'PASS' : 'FAIL';
  const businessOutcome = Number(signals.manualWorkReduction) >= 50 ? 'PASS' : 'FAIL';
  const result = { id: id('outcome'), intendedMeasures: changeCase.intent.successMeasures, observedMeasures: signals, observationWindow: changeCase.artifacts.observation.window, confidence: 'HIGH', technicalOutcome, businessOutcome, controlOutcome, findings: [], followUpProposalRefs: [] };
  if (businessOutcome === 'FAIL') result.findings.push({ code: 'BUSINESS_TARGET_MISSED', message: `Manual-work reduction ${signals.manualWorkReduction}% is below the 50% target.` });
  result.contentHash = digest(result); changeCase.artifacts.outcome = result;
  return pass('outcome-achievement', [result.id], businessOutcome === 'PASS' && technicalOutcome === 'PASS' && controlOutcome === 'PASS' ? 1 : .67, businessOutcome === 'FAIL' ? [finding('BUSINESS_OUTCOME_FAILED', 'MEDIUM', 'Technical and control outcomes passed, but the business target was missed.', result.id, 'Create an evidenced follow-up change rather than declaring success.')] : []);
}

function learning(changeCase) {
  const outcome = changeCase.artifacts.outcome;
  const proposals = [];
  if (outcome.businessOutcome === 'FAIL') {
    const proposal = { id: id('follow-up'), type: 'CHANGE_CASE_PROPOSAL', title: 'Reduce residual manual review without weakening controls', derivedFrom: [outcome.id, changeCase.intent.id], rationale: outcome.findings[0]?.message, proposedMeasures: [{ name: 'Manual-work reduction', target: 50, unit: 'percent' }], status: 'PROPOSED_NOT_APPLIED', authorityRequired: true };
    proposal.contentHash = digest(proposal); proposals.push(proposal); outcome.followUpProposalRefs.push(proposal.id);
  }
  changeCase.artifacts.learning = { proposals, newEvaluationCases: outcome.businessOutcome === 'FAIL' ? ['manual-review-routing-efficiency'] : [], authoritativeModelMutated: false };
  return pass('learning-integrity', proposals.map((entry) => entry.id));
}

const STAGE_HANDLERS = [intake, contextDiscovery, impactAnalysis, governanceAnalysis, requirementsEngineering, architectureDesign, deliveryPlanning, implementation, assurance, authorityAndRelease, outcomeEvaluation, learning];

export function advanceCase(changeCase, command = {}) {
  const actor = safeText(command.actor, 120) || 'sdlc-orchestrator';
  const { key: idempotencyKey, requestHash, replayed } = commandKey(changeCase, command, 'advance');
  if (replayed) return { changeCase, replayed: true };
  if (changeCase.status === 'PASSED') return { changeCase, replayed: false };
  if (changeCase.status === 'STOPPED') throw commandError('Case is STOPPED; no further work can be scheduled.', 409);
  if (['BLOCKED', 'FAILED'].includes(changeCase.status)) throw new Error(`Case is ${changeCase.status}; create a repaired case or resolve the blocking fixture.`);
  if (changeCase.status === 'NEEDS_HUMAN' && changeCase.currentStage !== 'S9' && changeCase.currentStage !== 'S10') throw new Error('Case requires an authorized human decision before it can advance.');
  const currentRequiredProofs = changeCase.proofs.obligations.filter((entry) => entry.required && entry.intentRevision === changeCase.intent.revision);
  if (currentRequiredProofs.length && workspaceStatus(changeCase).nextAllowedAction.type !== 'ADVANCE_CASE') {
    throw commandError('Current required proof work must be accepted before the case can advance.', 409);
  }
  const stage = stageAt(changeCase.currentStageIndex);
  if (!stage) throw new Error('No current stage.');
  const startedAt = now();
  changeCase.status = 'RUNNING';
  const result = STAGE_HANDLERS[changeCase.currentStageIndex](changeCase);
  changeCase.evaluations.push(result);
  changeCase.gateHistory.push(gateDecision(stage, result, result.id));
  changeCase.stageRuns.push(stageRun(changeCase, stage, result.status, startedAt, result.subjectRefs));
  changeCase.events.push(eventEnvelope(changeCase, result.status === 'PASSED' ? 'GatePassed' : 'GateBlocked', actor, { stage: stage.id, gate: stage.gate, evaluationRef: result.id, status: result.status }, changeCase.events.at(-1)?.id));
  if (result.status === 'PASSED') {
    changeCase.metrics.stagePasses += 1;
    changeCase.currentStageIndex += 1;
    const next = stageAt(changeCase.currentStageIndex);
    if (next) { changeCase.currentStage = next.id; changeCase.status = 'RUNNING'; }
    else { changeCase.currentStage = null; changeCase.status = 'PASSED'; }
  } else {
    changeCase.metrics.stageFailures += 1;
    changeCase.status = result.status === 'NEEDS_HUMAN' ? 'NEEDS_HUMAN' : 'BLOCKED';
  }
  changeCase.version += 1; changeCase.updatedAt = now();
  changeCase.idempotency[idempotencyKey] = { action: 'advance', requestHash, version: changeCase.version, at: changeCase.updatedAt };
  return { changeCase, replayed: false };
}

export function runToCheckpoint(changeCase, command = {}) {
  const startVersion = changeCase.version;
  const { key: idempotencyKey, requestHash, replayed } = commandKey(changeCase, command, 'run');
  if (replayed) return { changeCase, replayed: true, steps: 0, startVersion, endVersion: changeCase.version };
  let steps = 0;
  while (!['BLOCKED', 'NEEDS_HUMAN', 'PASSED', 'FAILED'].includes(changeCase.status) && steps < 20 || (changeCase.status === 'DRAFT' && steps < 20)) {
    advanceCase(changeCase, { actor: command.actor, idempotencyKey: `${idempotencyKey}:${steps}` });
    steps += 1;
  }
  changeCase.idempotency[idempotencyKey] = { action: 'run', requestHash, version: changeCase.version, at: changeCase.updatedAt };
  return { changeCase, replayed: false, steps, startVersion, endVersion: changeCase.version };
}

export function approveRelease(changeCase, command = {}) {
  if (changeCase.currentStage !== 'S9') throw new Error('Release approval is available only at S9.');
  const principal = safeText(command.principal, 120);
  const roles = Array.isArray(command.roles) ? command.roles.map((role) => safeText(role, 80)) : [];
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'approve');
  if (replayed) return { changeCase, replayed: true };
  if (!principal) throw new Error('Approval principal is required.');
  if (principal === 'actor-implementation-agent') throw new Error('The implementation principal cannot approve its own protected release.');
  if (!roles.includes('release-approver') || !roles.includes('control-owner')) throw new Error('Release approver and control owner roles are required.');
  const authorityGeneration = Number.isSafeInteger(command.authorityGeneration) ? command.authorityGeneration : null;
  const approval = { id: id('approval'), action: 'release', principal, roles, authorityGeneration, status: 'APPROVED', evidenceBundleRef: changeCase.artifacts.assurance.releaseEvidenceBundle.id, approvedAt: now(), usedAt: null };
  approval.contentHash = digest(approval); changeCase.approvals.push(approval);
  changeCase.metrics.humanInterventions += 1; changeCase.status = 'RUNNING'; changeCase.version += 1; changeCase.updatedAt = now();
  changeCase.idempotency[key] = { action: 'approve', requestHash, version: changeCase.version, at: changeCase.updatedAt };
  changeCase.events.push(eventEnvelope(changeCase, 'ReleaseApprovalRecorded', principal, { approvalRef: approval.id }, changeCase.events.at(-1)?.id));
  return { changeCase, replayed: false };
}

export function recordObservation(changeCase, command = {}) {
  if (changeCase.currentStage !== 'S10') throw new Error('Outcome observation is available only at S10.');
  const { key, requestHash, replayed } = commandKey(changeCase, command, 'observe');
  if (replayed) return { changeCase, replayed: true };
  const signals = {
    technicalHealthy: command.signals?.technicalHealthy !== false,
    controlExceptions: Number.isFinite(Number(command.signals?.controlExceptions)) ? Number(command.signals.controlExceptions) : 0,
    manualWorkReduction: Number.isFinite(Number(command.signals?.manualWorkReduction)) ? Number(command.signals.manualWorkReduction) : 35,
    errorRate: Number(command.signals?.errorRate ?? 0.002), cost: Number(command.signals?.cost ?? 42),
  };
  changeCase.artifacts.observation = { id: id('observation'), releaseRef: changeCase.artifacts.release.id, window: 'synthetic:first-30-days', signals, recordedAt: now(), contentHash: digest(signals) };
  changeCase.metrics.humanInterventions += 1; changeCase.status = 'RUNNING'; changeCase.version += 1; changeCase.updatedAt = now();
  changeCase.idempotency[key] = { action: 'observe', requestHash, version: changeCase.version, at: changeCase.updatedAt };
  changeCase.events.push(eventEnvelope(changeCase, 'ReleaseObserved', safeText(command.actor, 120) || 'operations-observer', { observationRef: changeCase.artifacts.observation.id }, changeCase.events.at(-1)?.id));
  return { changeCase, replayed: false };
}

export function traceability(changeCase) {
  const nodes = [{ id: changeCase.intent.id, type: 'Intent', label: changeCase.title }];
  const links = [];
  const add = (node) => { if (node?.id && !nodes.some((entry) => entry.id === node.id)) nodes.push(node); };
  for (const requirement of changeCase.artifacts.requirements?.requirements ?? []) {
    add({ id: requirement.id, type: 'Requirement', label: requirement.statement });
    links.push({ source: changeCase.intent.id, target: requirement.id, type: 'derives' });
  }
  for (const decision of changeCase.artifacts.architecture?.decisions ?? []) {
    add({ id: decision.id, type: 'ArchitectureDecision', label: decision.problem });
    for (const ref of decision.requirementsSatisfied) links.push({ source: ref, target: decision.id, type: 'satisfied-by' });
  }
  for (const work of changeCase.artifacts.plan?.workItems ?? []) {
    add({ id: work.id, type: 'WorkItem', label: work.objective });
    for (const ref of work.requirementRefs) links.push({ source: ref, target: work.id, type: 'implemented-by' });
  }
  const artifact = changeCase.artifacts.implementation?.artifact;
  if (artifact) { add({ id: artifact.id, type: 'ChangeSet', label: 'Reference change artifact' }); for (const work of changeCase.artifacts.plan.workItems) links.push({ source: work.id, target: artifact.id, type: 'produces' }); }
  const bundle = changeCase.artifacts.assurance?.releaseEvidenceBundle;
  if (bundle) { add({ id: bundle.id, type: 'Verification', label: 'Release evidence bundle' }); links.push({ source: artifact.id, target: bundle.id, type: 'verified-by' }); }
  const release = changeCase.artifacts.release;
  if (release) { add({ id: release.id, type: 'Release', label: 'Synthetic release' }); links.push({ source: bundle.id, target: release.id, type: 'authorizes' }); }
  const outcome = changeCase.artifacts.outcome;
  if (outcome) { add({ id: outcome.id, type: 'Outcome', label: `Business ${outcome.businessOutcome}` }); links.push({ source: release.id, target: outcome.id, type: 'observed-as' }); }
  for (const proposal of changeCase.artifacts.learning?.proposals ?? []) { add({ id: proposal.id, type: 'FollowUp', label: proposal.title }); links.push({ source: outcome.id, target: proposal.id, type: 'learns' }); }
  return { nodes, links, completeness: nodes.length ? 1 : 0, contentHash: digest({ nodes, links }) };
}

export function verifyEvidenceLedger(changeCase) {
  return changeCase.evidenceLedger.map((entry) => ({ evidenceRef: entry.id, valid: entry.contentHash === digest(entry.content) }));
}
