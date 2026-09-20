import { MUTATIONS, STAGES, digest, evaluation, eventEnvelope, evidence, finding, id, now, safeText, stageAt } from './contracts.mjs';
import { EXPECTED_IMPACTS, referenceOrganization } from './fixture.mjs';

const REQUIRED_CONTEXT_DOMAINS = ['strategy', 'business', 'process', 'ownership', 'information', 'application', 'integration', 'security', 'regulation', 'control', 'operations', 'code/runtime'];
const ASSURANCE_DIMENSIONS = ['FUNCTIONAL', 'REQUIREMENTS', 'SECURITY', 'PRIVACY', 'DATA', 'ARCHITECTURE', 'REGULATORY_CONTROL', 'OPERATIONAL', 'PERFORMANCE', 'RESILIENCE', 'MAINTAINABILITY', 'AI_BEHAVIOR'];

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

export function createChangeCase(input = {}) {
  const createdAt = now();
  const mutation = MUTATIONS[input.mutation] ? input.mutation : 'none';
  const tenantId = safeText(input.tenantId, 80) || 'tenant-reference-bank';
  const caseId = id('change-case');
  const rawIntent = safeText(input.rawIntent) || 'Allow corporate customers to update beneficial-owner information digitally while preserving KYC/AML controls, data integrity, authorization, auditability, and downstream consistency.';
  const golden = input.mode !== 'custom';
  const changeCase = {
    id: caseId,
    tenantId,
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
      proposedSolution: 'Add a governed digital change flow through owned APIs and control services.',
      openQuestions: [], confidence: golden ? 'HIGH' : 'LOW', sourceRefs: ['request:raw-intent'],
    },
    enterpriseSnapshot: referenceOrganization(mutation),
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
  changeCase.events.push(eventEnvelope(changeCase, 'ChangeCaseCreated', changeCase.createdBy, { mutation, intentId: changeCase.intent.id }));
  return changeCase;
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
  changeCase.artifacts.context = { plan, coverage, evidenceRefs, provenanceManifestHash: digest(evidenceRefs) };
  return findings.some((entry) => entry.severity === 'CRITICAL') ? fail('context-sufficiency', [plan.id], findings, 'FAILED', coverage.reduce((sum, entry) => sum + entry.score, 0) / coverage.length) : pass('context-sufficiency', [plan.id], 1, findings);
}

function impactAnalysis(changeCase) {
  const selected = [...EXPECTED_IMPACTS];
  if (changeCase.mutation === 'omitted_reporting') selected.splice(selected.indexOf('system-reporting'), 1);
  const objectMap = new Map(changeCase.enterpriseSnapshot.objects.map((object) => [object.id, object]));
  const impacts = selected.filter((objectRef) => objectMap.has(objectRef)).map((objectRef, index) => ({
    id: id('impact'), objectRef, objectType: objectMap.get(objectRef).type, impactType: index < 10 ? 'DIRECT' : 'INDIRECT',
    confidence: 1, reason: 'Reachable from the intent through the reference enterprise dependency neighborhood.',
    evidenceRefs: changeCase.artifacts.context.evidenceRefs.filter((ref) => changeCase.evidenceLedger.find((entry) => entry.id === ref)?.objectRef === objectRef),
    dependencyPath: ['goal-digital-owner-update', objectRef], ownerRef: objectMap.get(objectRef).owner ?? null,
  }));
  const actual = new Set(impacts.map((impact) => impact.objectRef));
  const missing = [...EXPECTED_IMPACTS].filter((objectRef) => objectMap.has(objectRef) && !actual.has(objectRef));
  const findings = missing.map((objectRef) => finding('IMPACT_OMISSION', 'HIGH', `Independent critic found omitted impacted object ${objectRef}.`, objectRef, 'Add the downstream dependency and re-run impact analysis.'));
  const recall = EXPECTED_IMPACTS.size ? (EXPECTED_IMPACTS.size - missing.length) / EXPECTED_IMPACTS.size : 1;
  changeCase.artifacts.impact = { impacts, critic: { expected: [...EXPECTED_IMPACTS], missing, precision: 1, recall } };
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
  const requirements = REQUIREMENT_SEED.map(([idValue, kind, statement, derivedFrom, criterion], index) => ({
    id: idValue, kind, statement, rationale: 'Derived from approved intent and authoritative synthetic enterprise evidence.', derivedFrom,
    affectedObjects: derivedFrom, priority: index < 7 ? 'MUST' : 'SHOULD', acceptanceCriteria: [criterion], verificationMethod: kind === 'BUSINESS' ? 'SCENARIO_AND_OUTCOME' : 'AUTOMATED_TEST', owner: changeCase.accountableOwner, risk: ['SECURITY', 'REGULATORY_CONTROL'].includes(kind) ? 'HIGH' : 'MEDIUM', status: 'PROPOSED',
  }));
  if (changeCase.mutation === 'contradictory_requirement') {
    requirements.push({ id: 'REQ-BAD-1', kind: 'DATA', statement: 'Delete all audit evidence immediately after each request.', rationale: 'Injected mutation', derivedFrom: ['control-audit'], affectedObjects: ['control-audit'], priority: 'MUST', acceptanceCriteria: [], verificationMethod: null, owner: null, risk: 'HIGH', status: 'PROPOSED' });
  }
  const findings = [];
  for (const requirement of requirements) {
    if (!requirement.derivedFrom.length) findings.push(finding('ORPHAN_REQUIREMENT', 'HIGH', `${requirement.id} has no upstream source.`, requirement.id, 'Add an authoritative derivedFrom reference.'));
    if (!requirement.acceptanceCriteria.length || !requirement.verificationMethod) findings.push(finding('UNTESTABLE_REQUIREMENT', 'HIGH', `${requirement.id} is not verifiable.`, requirement.id, 'Add acceptance criteria and verification method.'));
    if (/delete all audit evidence/i.test(requirement.statement)) findings.push(finding('REQUIREMENT_CONTRADICTION', 'CRITICAL', `${requirement.id} contradicts immutable audit control.`, requirement.id, 'Remove or explicitly resolve the contradiction with the control owner.'));
  }
  changeCase.artifacts.requirements = { requirements, mutationCoverage: { checked: ['missing', 'ambiguous', 'contradictory', 'untestable'], detected: findings.map((entry) => entry.code) } };
  return findings.length ? fail('requirements-quality', requirements.map((entry) => entry.id), findings) : pass('requirements-quality', requirements.map((entry) => entry.id));
}

function architectureDesign(changeCase) {
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
  const decision = { id: 'ADR-BO-001', problem: 'Introduce digital ownership maintenance without bypassing controls.', options: ['Owned API and governed events', 'Portal writes Party MDM database'], selectedOption: 'Owned API and governed events', rationale: 'Preserves data ownership, authority, and downstream consistency.', requirementsSatisfied: changeCase.artifacts.requirements.requirements.map((entry) => entry.id), principlesApplied: ['principle-api', 'principle-authority'], impactedObjects: change.baselineRefs, risks: ['risk-incorrect-owner'], assumptions: ['Synthetic integration contracts are available'], evidenceRefs: changeCase.artifacts.context.evidenceRefs, approvalRefs: [] };
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
  const requirementIds = changeCase.artifacts.requirements.requirements.map((entry) => entry.id);
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
      acceptanceCriteria: refs.flatMap((ref) => changeCase.artifacts.requirements.requirements.find((entry) => entry.id === ref)?.acceptanceCriteria ?? []),
      architecture: ['ADR-BO-001', changeCase.artifacts.architecture.change.id],
      enterpriseObjects: [...new Set(refs.flatMap((ref) => changeCase.artifacts.requirements.requirements.find((entry) => entry.id === ref)?.affectedObjects ?? []))],
      contracts: itemId === 'WORK-1' ? ['POST /beneficial-owner-changes', 'ownership-change.v1'] : [],
      constraints: changeCase.intent.constraints, tests: ['unit', 'contract', 'integration', 'security'],
      provenanceManifest: changeCase.artifacts.context.provenanceManifestHash,
      exclusions: ['Real customer data', 'Production credentials', 'Legal interpretation'], tokenBudget: 8_000,
    };
    contextPackage.contentHash = digest(contextPackage); packages.push(contextPackage);
    return { id: itemId, objective, requirementRefs: refs, decisionRefs: ['ADR-BO-001'], scope: 'beneficial-owner-reference-service', repository: 'synthetic/reference-service', component: itemId === 'WORK-5' ? 'event-consumers' : 'beneficial-owner-service', dependencies, acceptanceCriteria: contextPackage.acceptanceCriteria, contextPackageRef: contextPackage.id, risk: refs.some((ref) => ref.includes('SEC') || ref.includes('CTL')) ? 'HIGH' : 'MEDIUM', verificationRefs: [] };
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

function authorityAndRelease(changeCase) {
  const request = { principal: 'actor-implementation-agent', action: 'deploy', asset: 'beneficial-owner-reference-service', environment: 'production-like', risk: 'HIGH', autonomyLevel: 'L2' };
  const validApproval = changeCase.approvals.find((approval) => approval.action === 'release' && approval.status === 'APPROVED' && approval.principal !== request.principal && approval.roles.includes('release-approver') && approval.roles.includes('control-owner') && !approval.usedAt);
  if (!validApproval) {
    changeCase.artifacts.authority = { request, decision: 'REQUIRE_HUMAN_APPROVAL', requiredRoles: ['release-approver', 'control-owner'] };
    return fail('release-authority', [changeCase.artifacts.assurance.releaseEvidenceBundle.id], [finding('RELEASE_APPROVAL_REQUIRED', 'HIGH', 'Protected production-like release requires independent human approval.', request.asset, 'Approve as a distinct release approver and control owner.')], 'NEEDS_HUMAN');
  }
  validApproval.usedAt = now();
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
  const idempotencyKey = safeText(command.idempotencyKey, 160) || id('idempotency');
  if (changeCase.idempotency[idempotencyKey]) return { changeCase, replayed: true };
  if (changeCase.status === 'PASSED') return { changeCase, replayed: false };
  if (['BLOCKED', 'FAILED'].includes(changeCase.status)) throw new Error(`Case is ${changeCase.status}; create a repaired case or resolve the blocking fixture.`);
  if (changeCase.status === 'NEEDS_HUMAN' && changeCase.currentStage !== 'S9' && changeCase.currentStage !== 'S10') throw new Error('Case requires an authorized human decision before it can advance.');
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
  changeCase.idempotency[idempotencyKey] = { action: 'advance', version: changeCase.version, at: changeCase.updatedAt };
  return { changeCase, replayed: false };
}

export function runToCheckpoint(changeCase, command = {}) {
  const startVersion = changeCase.version;
  let steps = 0;
  while (!['BLOCKED', 'NEEDS_HUMAN', 'PASSED', 'FAILED'].includes(changeCase.status) && steps < 20 || (changeCase.status === 'DRAFT' && steps < 20)) {
    advanceCase(changeCase, { actor: command.actor, idempotencyKey: `${command.idempotencyKey ?? id('run')}:${steps}` });
    steps += 1;
  }
  return { changeCase, steps, startVersion, endVersion: changeCase.version };
}

export function approveRelease(changeCase, command = {}) {
  if (changeCase.currentStage !== 'S9') throw new Error('Release approval is available only at S9.');
  const principal = safeText(command.principal, 120);
  const roles = Array.isArray(command.roles) ? command.roles.map((role) => safeText(role, 80)) : [];
  const key = safeText(command.idempotencyKey, 160) || id('approval-key');
  if (changeCase.idempotency[key]) return { changeCase, replayed: true };
  if (!principal) throw new Error('Approval principal is required.');
  if (principal === 'actor-implementation-agent') throw new Error('The implementation principal cannot approve its own protected release.');
  if (!roles.includes('release-approver') || !roles.includes('control-owner')) throw new Error('Release approver and control owner roles are required.');
  const approval = { id: id('approval'), action: 'release', principal, roles, status: 'APPROVED', evidenceBundleRef: changeCase.artifacts.assurance.releaseEvidenceBundle.id, approvedAt: now(), usedAt: null };
  approval.contentHash = digest(approval); changeCase.approvals.push(approval);
  changeCase.metrics.humanInterventions += 1; changeCase.status = 'RUNNING'; changeCase.version += 1; changeCase.updatedAt = now();
  changeCase.idempotency[key] = { action: 'approve', version: changeCase.version, at: changeCase.updatedAt };
  changeCase.events.push(eventEnvelope(changeCase, 'ReleaseApprovalRecorded', principal, { approvalRef: approval.id }, changeCase.events.at(-1)?.id));
  return { changeCase, replayed: false };
}

export function recordObservation(changeCase, command = {}) {
  if (changeCase.currentStage !== 'S10') throw new Error('Outcome observation is available only at S10.');
  const key = safeText(command.idempotencyKey, 160) || id('observation-key');
  if (changeCase.idempotency[key]) return { changeCase, replayed: true };
  const signals = {
    technicalHealthy: command.signals?.technicalHealthy !== false,
    controlExceptions: Number.isFinite(Number(command.signals?.controlExceptions)) ? Number(command.signals.controlExceptions) : 0,
    manualWorkReduction: Number.isFinite(Number(command.signals?.manualWorkReduction)) ? Number(command.signals.manualWorkReduction) : 35,
    errorRate: Number(command.signals?.errorRate ?? 0.002), cost: Number(command.signals?.cost ?? 42),
  };
  changeCase.artifacts.observation = { id: id('observation'), releaseRef: changeCase.artifacts.release.id, window: 'synthetic:first-30-days', signals, recordedAt: now(), contentHash: digest(signals) };
  changeCase.metrics.humanInterventions += 1; changeCase.status = 'RUNNING'; changeCase.version += 1; changeCase.updatedAt = now();
  changeCase.idempotency[key] = { action: 'observe', version: changeCase.version, at: changeCase.updatedAt };
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
