import assert from 'node:assert/strict';
import test from 'node:test';
import { ENTERPRISE_LENSES, enterpriseScopeErrors, scopeState } from '../../src/enterprise/types.mjs';
import { normalizeEnterpriseCommand } from '../../src/enterprise/commands.mjs';
import { normalizeEnterpriseQuery, projectEnterprise } from '../../src/enterprise/projections.mjs';
import { effectiveStatus, enterpriseInstant, enterpriseInterval, objectBasisHash, objectStates } from '../../src/enterprise/state.mjs';
import { normalizeDecisionTable, normalizeProcessFlow } from '../../src/enterprise/process-model.mjs';
import { evaluateDecisionTable, simulateProcessFlow } from '../../src/enterprise/process-simulation.mjs';
import { normalizeHumanDecisionChoice, planManualProcessFlow, projectManualFlowActivation } from '../../src/enterprise/process-runtime.mjs';
import { applyEnterpriseIntegrityCommand, applyEnterpriseIntegrityException, evaluateEnterpriseIntegrity,
  normalizeEnterpriseIntegrityCommand, projectEnterpriseIntegrity } from '../../src/enterprise/integrity.mjs';
import { applyEnterpriseGovernanceCommand, normalizeEnterpriseGovernanceCommand,
  projectEnterpriseGovernance } from '../../src/enterprise/governance.mjs';
import { addConversationTurn, createProject } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';

test('enterprise perspectives keep their sixteen stable IDs and distinguish unknown from explicitly unscoped records', () => {
  assert.deepEqual(ENTERPRISE_LENSES.map(({ id }) => id), Array.from({ length: 16 }, (_, index) => `L-${String(index + 1).padStart(2, '0')}`));
  assert.equal(scopeState({ id: 'legacy-process' }), 'UNKNOWN');
  assert.equal(scopeState({ id: 'unscoped-process', enterpriseScope: { organizationId: null, legalEntityId: null, unitId: null } }), 'UNSCOPED');
});

test('enterprise hierarchy validation rejects cyclic organizational-unit parents', () => {
  const organization = { id: 'organization-example', type: 'organization', enterpriseScope: {
    organizationId: 'organization-example', legalEntityId: null, unitId: null,
  } };
  const unitA = { id: 'unit-a', type: 'unit', parentUnitId: 'unit-b', enterpriseScope: {
    organizationId: organization.id, legalEntityId: null, unitId: 'unit-a',
  } };
  const unitB = { id: 'unit-b', type: 'unit', parentUnitId: 'unit-a', enterpriseScope: {
    organizationId: organization.id, legalEntityId: null, unitId: 'unit-b',
  } };

  const errors = enterpriseScopeErrors([organization, unitA, unitB]);
  assert.ok(errors.some(({ code, path, message }) => code === 'INVALID_ENTERPRISE_SCOPE'
    && ['unit-a', 'unit-b'].includes(path) && /cycle/i.test(message)));
});

test('enterprise query and command references accept existing Studio IDs containing underscores', () => {
  assert.equal(normalizeEnterpriseQuery({ lensId: 'all', scopeId: 'org_north_1', selectedId: 'process_existing_7' }).selectedId,
    'process_existing_7');
  const command = normalizeEnterpriseCommand({ kind: 'assign-object-scope', blueprintId: 'blueprint-00000000-0000-4000-8000-000000000001',
    blueprintVersion: 1, objectId: 'process_existing_7', organizationId: 'org_north_1', legalEntityId: null, unitId: null, reason: 'Preserve the existing design identifier.' });
  assert.equal(command.objectId, 'process_existing_7');
  assert.equal(command.enterpriseScope.organizationId, 'org_north_1');
});

test('enterprise lifecycle, review, implementation and observation remain independent honest evidence dimensions', () => {
  const object = { id: 'process-deliver', type: 'process', name: 'Deliver a transfer', detail: 'Complete work.' };
  const empty = objectStates(object);
  assert.equal(empty.lifecycle.value, 'UNKNOWN');
  assert.equal(empty.review.value, 'UNREVIEWED');
  assert.equal(empty.implementation.value, 'UNKNOWN');
  assert.equal(empty.observation.value, 'UNKNOWN');

  const basisHash = objectBasisHash(object);
  const reported = { ...object, enterpriseStates: {
    lifecycle: { value: 'ACTIVE', basisHash, evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:00:00.000Z', reason: 'Record the current report.', evidenceSummary: 'Owner reported active work.' },
    review: { value: 'ACCEPTED', basisHash, evidenceKind: 'HUMAN_REVIEW', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:01:00.000Z', reason: 'Accept the design review.', evidenceSummary: '' },
    implementation: { value: 'NOT_IMPLEMENTED', basisHash, evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:02:00.000Z', reason: 'Record implementation status.', evidenceSummary: '' },
    observation: { value: 'OBSERVED_UNVERIFIED', basisHash, evidenceKind: 'HUMAN_REPORTED', recordedBy: 'oidc:owner', recordedAt: '2026-10-03T10:03:00.000Z', reason: 'Record the observation.', evidenceSummary: 'Owner reported one observed handoff.' },
  } };
  const states = objectStates(reported);
  assert.deepEqual(Object.fromEntries(['lifecycle', 'review', 'implementation', 'observation'].map((dimension) => [dimension, states[dimension].value])), {
    lifecycle: 'ACTIVE', review: 'ACCEPTED', implementation: 'NOT_IMPLEMENTED', observation: 'OBSERVED_UNVERIFIED',
  });
  assert.equal(states.lifecycle.evidenceKind, 'HUMAN_REPORTED');
  assert.equal(states.review.evidenceKind, 'HUMAN_REVIEW');
  assert.equal(states.observation.evidenceKind, 'HUMAN_REPORTED');
  const changedMeaning = objectStates({ ...reported, name: 'Different transfer process' });
  assert.equal(changedMeaning.lifecycle.value, 'UNKNOWN');
  assert.equal(changedMeaning.lifecycle.priorValue, 'ACTIVE');
  assert.equal(changedMeaning.lifecycle.stale, true);
  assert.equal(changedMeaning.review.value, 'UNREVIEWED');
});

test('enterprise validity intervals accept UTC instants and return UNKNOWN, IN_RANGE or OUT_OF_RANGE without guessing', () => {
  const interval = enterpriseInterval('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
  assert.equal(effectiveStatus({}, '2026-10-15T00:00:00.000Z'), 'UNKNOWN');
  assert.equal(effectiveStatus({ enterpriseValidity: interval }, '2026-09-30T23:59:59.999Z'), 'OUT_OF_RANGE');
  assert.equal(effectiveStatus({ enterpriseValidity: interval }, '2026-10-15T00:00:00.000Z'), 'IN_RANGE');
  assert.equal(effectiveStatus({ enterpriseValidity: interval }, '2026-11-01T00:00:00.000Z'), 'OUT_OF_RANGE', 'the end is exclusive');
  assert.throws(() => enterpriseInstant('2026-02-30T12:00:00.000Z', 'Effective start'), { code: 'INVALID_ENTERPRISE_TIME' });
  assert.throws(() => enterpriseInterval('2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z'), { code: 'INVALID_ENTERPRISE_INTERVAL' });
  assert.throws(() => enterpriseInterval(null, '2026-10-01T00:00:00.000Z'), { code: 'INVALID_ENTERPRISE_INTERVAL' });
  assert.throws(() => normalizeEnterpriseQuery({ effectiveAt: '' }), { code: 'INVALID_ENTERPRISE_TIME' });
  assert.throws(() => normalizeEnterpriseQuery({ recordedAt: '2026-03-08T02:30:00-05:00' }), { code: 'INVALID_ENTERPRISE_TIME' });
});

test('typed integrity assessment detects canonical relation drift and keeps design gaps separate', () => {
  const project = createProject('Integrity rule fixture');
  for (const answer of ['A safe service.', 'Small businesses.', 'Clear status and fees.', 'Humans handle exceptions.']) addConversationTurn(project, answer);
  const blueprint = project.blueprintVersions.at(-1);
  const exact = evaluateEnterpriseIntegrity(blueprint);
  assert.equal(exact.rules.find((rule) => rule.id === 'design.typed-structure').status, 'PASS');
  assert.equal(exact.rules.find((rule) => rule.id === 'lineage.canonical-relations').status, 'PASS');
  assert.equal(exact.rules.find((rule) => rule.id === 'design.completeness').status, 'REVIEW');
  assert.equal(exact.status, 'REVIEW');
  assert.ok(exact.findings.some((entry) => entry.ruleId === 'design.completeness' && entry.severity === 'high'));
  assert.equal(exact.rules.find((rule) => rule.id === 'lineage.typed-references').findingCount, 0);

  const drifted = structuredClone(blueprint);
  drifted.relations.pop();
  const driftReport = evaluateEnterpriseIntegrity(drifted);
  assert.equal(driftReport.status, 'FAIL');
  assert.ok(driftReport.findings.some((entry) => entry.ruleId === 'lineage.canonical-relations'
    && entry.code === 'RELATION_MISSING_OR_MISMATCHED'));
  const dangling = structuredClone(blueprint);
  dangling.relations[0].target = 'missing-target';
  const danglingReport = evaluateEnterpriseIntegrity(dangling);
  assert.equal(danglingReport.rules.find((rule) => rule.id === 'lineage.typed-references').status, 'FAIL');
  assert.ok(danglingReport.findings.some((entry) => entry.ruleId === 'lineage.typed-references'
    && entry.code === 'DANGLING_REFERENCE'));
  assert.throws(() => evaluateEnterpriseIntegrity({ ...blueprint, relations: [null] }), { code: 'INTEGRITY_BLUEPRINT_INVALID', statusCode: 409 });
  assert.throws(() => evaluateEnterpriseIntegrity({ ...blueprint, areas: { ...blueprint.areas,
    purposeStrategy: { ...blueprint.areas.purposeStrategy, items: [null] } } }),
  { code: 'INTEGRITY_BLUEPRINT_INVALID', statusCode: 409 });

  const command = normalizeEnterpriseIntegrityCommand({ kind: 'run-integrity-checks', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, snapshotHash: digest(blueprint), reason: 'Check exact saved design.' });
  assert.equal(command.snapshotHash, digest(blueprint));
  assert.throws(() => normalizeEnterpriseIntegrityCommand({ ...command, extra: true }), { code: 'INVALID_INTEGRITY_COMMAND' });
});

test('governance decision requests, owner decisions, appeals and ledger integrity are source-bound', () => {
  const project = createProject('Governance decision fixture');
  for (const answer of ['A safe service.', 'Small businesses.', 'Clear status and fees.', 'Humans review exceptions.']) addConversationTurn(project, answer);
  const blueprint = project.blueprintVersions.at(-1);
  const source = { blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint) };
  const auditStart = project.audit?.length ?? 0;
  const eventTime = (offset) => new Date(Date.parse(blueprint.createdAt) + 60_000 + offset * 1000);
  const requested = applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'request-governance-decision',
    ...source, objectId: 'decision-priority', title: 'Exception review authority', question: 'Who may approve exceptions?',
    proposedOption: 'Require an owner review.', reason: 'Clarify the decision right before process use.' }), 'oidc:editor', eventTime(0));
  assert.equal(requested.governanceStatus, 'REQUESTED');
  assert.equal(project.blueprintVersions.length, 1, 'a governance request does not edit the design');
  const request = projectEnterpriseGovernance(project, blueprint).cases[0];
  assert.equal(request.requestedBy, 'oidc:editor');
  assert.equal(request.objectId, 'decision-priority');
  assert.equal(request.appliesToContext, true);
  assert.equal(request.sourceDrift, false);

  const decide = (revision, outcome, reason) => normalizeEnterpriseGovernanceCommand({ kind: 'decide-governance-decision',
    ...source, caseId: request.id, caseRevision: revision, outcome, reason });
  const declined = applyEnterpriseGovernanceCommand(project, decide(1, 'DECLINE', 'Keep the current owner-only rule.'), 'oidc:owner', eventTime(1));
  assert.equal(declined.governanceStatus, 'DECIDED');
  const requestTime = project.enterpriseGovernanceLedger[0].at;
  const historical = projectEnterprise(project, { recordedAt: requestTime }, { write: true, human: true, actor: 'oidc:editor' });
  assert.equal(historical.governance.ledgerLength, 1);
  assert.equal(historical.governance.ledgerHead, project.enterpriseGovernanceLedger[0].hash);
  assert.equal(historical.governance.cases[0].status, 'REQUESTED');
  assert.equal(historical.governance.cases[0].history.length, 1, 'future decisions are hidden by the recorded-time prefix');
  assert.equal(project.enterpriseGovernanceLedger.length, 2, 'temporal projection still validates but does not truncate the saved hash chain');
  const tamperedFuture = structuredClone(project); tamperedFuture.enterpriseGovernanceLedger[1].reason = 'tampered future event';
  assert.throws(() => projectEnterprise(tamperedFuture, { recordedAt: requestTime }),
    { code: 'GOVERNANCE_LEDGER_CORRUPT', statusCode: 409 }, 'future entries remain integrity-checked even when hidden from the requested time');
  const rehashedInvalidTransition = structuredClone(project);
  const invalidFutureTransition = rehashedInvalidTransition.enterpriseGovernanceLedger[1];
  invalidFutureTransition.action = 'review-governance-appeal'; invalidFutureTransition.outcome = 'UPHOLD';
  const { hash: _oldTransitionHash, ...invalidTransitionCore } = invalidFutureTransition;
  invalidFutureTransition.hash = digest(invalidTransitionCore);
  assert.throws(() => projectEnterprise(rehashedInvalidTransition, { recordedAt: requestTime }),
    { code: 'GOVERNANCE_LEDGER_CORRUPT', statusCode: 409 }, 'hidden future transitions are validated after their hashes are recomputed');
  const rehashedInvalidOutcome = structuredClone(project);
  const invalidFutureOutcome = rehashedInvalidOutcome.enterpriseGovernanceLedger[1];
  invalidFutureOutcome.outcome = 'MAYBE';
  const { hash: _oldOutcomeHash, ...invalidOutcomeCore } = invalidFutureOutcome;
  invalidFutureOutcome.hash = digest(invalidOutcomeCore);
  assert.throws(() => projectEnterprise(rehashedInvalidOutcome, { recordedAt: requestTime }),
    { code: 'GOVERNANCE_LEDGER_CORRUPT', statusCode: 409 }, 'hidden future outcomes are validated after their hashes are recomputed');
  assert.throws(() => applyEnterpriseGovernanceCommand(project,
    normalizeEnterpriseGovernanceCommand({ kind: 'appeal-governance-decision', ...source, caseId: request.id, caseRevision: 2,
      reason: 'A different member cannot appeal for the requester.' }), 'oidc:other', eventTime(2)), { code: 'GOVERNANCE_APPEAL_NOT_ALLOWED', statusCode: 403 });
  const appeal = applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'appeal-governance-decision',
    ...source, caseId: request.id, caseRevision: 2, reason: 'The proposed option would separate review from exception handling.' }), 'oidc:editor', eventTime(2));
  assert.equal(appeal.governanceStatus, 'APPEALED');
  const reopened = applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'review-governance-appeal',
    ...source, caseId: request.id, caseRevision: 3, outcome: 'REOPEN', reason: 'Reconsider with the affected process owner.' }), 'oidc:owner', eventTime(3));
  assert.equal(reopened.governanceStatus, 'REQUESTED');
  const approved = applyEnterpriseGovernanceCommand(project, decide(4, 'APPROVE', 'Owner review is mandatory for exceptions.'), 'oidc:owner', eventTime(4));
  const finalCase = projectEnterpriseGovernance(project, blueprint).cases[0];
  assert.equal(approved.governanceStatus, 'DECIDED');
  assert.deepEqual(finalCase.decisions.map((entry) => entry.outcome), ['DECLINE', 'APPROVE']);
  assert.equal(finalCase.appeals[0].review.outcome, 'REOPEN');
  assert.equal(finalCase.history.length, 5);
  assert.equal(finalCase.history.at(-1).hash, project.enterpriseGovernanceLedger.at(-1).hash);
  assert.equal(project.audit.length - auditStart, 5);
  assert.equal(project.blueprintVersions.length, 1);

  const declinedAgain = applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'request-governance-decision',
    ...source, objectId: 'decision-priority', title: 'Second review', question: 'Should the decision remain?',
    proposedOption: 'Keep owner review.', reason: 'Exercise an upheld appeal.' }), 'oidc:editor', eventTime(5));
  const secondId = declinedAgain.governanceCaseId;
  applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'decide-governance-decision',
    ...source, caseId: secondId, caseRevision: 1, outcome: 'DECLINE', reason: 'Keep the existing decision.' }), 'oidc:owner', eventTime(6));
  applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'appeal-governance-decision',
    ...source, caseId: secondId, caseRevision: 2, reason: 'Request a review of the decision.' }), 'oidc:editor', eventTime(7));
  const upheldResult = applyEnterpriseGovernanceCommand(project, normalizeEnterpriseGovernanceCommand({ kind: 'review-governance-appeal',
    ...source, caseId: secondId, caseRevision: 3, outcome: 'UPHOLD', reason: 'The original decision remains appropriate.' }), 'oidc:owner', eventTime(8));
  assert.equal(upheldResult.governanceStatus, 'DECISION_UPHELD');
  assert.equal(projectEnterpriseGovernance(project, blueprint).cases.find((entry) => entry.id === secondId).status, 'DECISION_UPHELD');

  const next = structuredClone(blueprint); next.id = 'blueprint-00000000-0000-4000-8000-000000000099'; next.version += 1;
  next.createdAt = '2026-10-04T12:01:00.000Z'; project.blueprintVersions.push(next);
  assert.equal(projectEnterpriseGovernance(project, next).cases[0].sourceDrift, true);
  assert.throws(() => applyEnterpriseGovernanceCommand(project, decide(finalCase.revision, 'DECLINE', 'Stale source action.'), 'oidc:owner'),
    { code: 'GOVERNANCE_SOURCE_STALE', statusCode: 409 });
  const corrupt = structuredClone(project); corrupt.enterpriseGovernanceLedger[0].reason = 'tampered';
  assert.throws(() => projectEnterpriseGovernance(corrupt, next), { code: 'GOVERNANCE_LEDGER_CORRUPT', statusCode: 409 });
});

test('integrity exceptions remain unresolved, expire, and become stale without carrying to a new report', () => {
  const project = createProject('Integrity exception fixture');
  for (const answer of ['A safe service.', 'Small businesses.', 'Clear status and fees.', 'Humans handle exceptions.']) addConversationTurn(project, answer);
  const blueprint = project.blueprintVersions.at(-1);
  const checkedAt = new Date('2026-10-04T12:00:00.000Z');
  const assessment = applyEnterpriseIntegrityCommand(project, normalizeEnterpriseIntegrityCommand({ kind: 'run-integrity-checks',
    blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint), reason: 'Review current findings.' }), 'human:owner').integrityAssessment;
  const finding = structuredClone(assessment.findings[0]);
  const command = normalizeEnterpriseIntegrityCommand({ kind: 'accept-integrity-exception', findingId: finding.id,
    reportId: assessment.id, reportHash: assessment.reportHash, blueprintId: blueprint.id, blueprintVersion: blueprint.version,
    snapshotHash: digest(blueprint), reason: 'Temporary owner-approved exception while the gap is scheduled.', expiresAt: '2026-10-05T12:00:00.000Z' });
  const saved = applyEnterpriseIntegrityException(project, command, 'human:owner', checkedAt).integrityException;
  assert.equal(saved.actor, 'human:owner');
  assert.equal(saved.acceptedAt, checkedAt.toISOString());
  assert.equal(saved.expiresAt, '2026-10-05T12:00:00.000Z');
  assert.equal(assessment.status, 'REVIEW');
  assert.deepEqual(assessment.findings[0], finding, 'the immutable report finding is not rewritten or suppressed');
  assert.equal(project.audit.at(-1).action, 'enterprise.accept-integrity-exception');
  const expired = projectEnterpriseIntegrity(project, blueprint, () => true, new Date('2026-10-06T12:00:00.000Z'));
  assert.equal(expired.current.status, assessment.status);
  assert.deepEqual(expired.current.findings[0], finding);
  assert.equal(expired.current.exceptions[0].status, 'EXPIRED');
  assert.equal(expired.current.exceptions[0].findingRemainsUnresolved, true);
  assert.equal(expired.remediationInbox.unresolvedFindings, expired.current.counts.findings);
  assert.equal(expired.remediationInbox.exceptionCoverage.EXPIRED, 1);
  assert.equal(expired.remediationInbox.items[0].status, 'UNRESOLVED');
  assert.equal(expired.remediationInbox.bySeverity[finding.severity], expired.current.findings
    .filter((entry) => entry.severity === finding.severity).length);
  assert.equal(expired.remediationInbox.byRule.find((rule) => rule.ruleId === finding.ruleId).findings,
    expired.current.findings.filter((entry) => entry.ruleId === finding.ruleId).length);

  const sameSourceRerun = applyEnterpriseIntegrityCommand(project, normalizeEnterpriseIntegrityCommand({ kind: 'run-integrity-checks',
    blueprintId: blueprint.id, blueprintVersion: blueprint.version, snapshotHash: digest(blueprint), reason: 'Compare same-source findings.' }), 'human:owner').integrityAssessment;
  sameSourceRerun.findings = sameSourceRerun.findings.filter((entry) => entry.id !== finding.id);
  sameSourceRerun.counts.findings -= 1;
  sameSourceRerun.counts[finding.severity] -= 1;
  const sameRule = sameSourceRerun.rules.find((rule) => rule.id === finding.ruleId);
  sameRule.findingCount -= 1;
  if (!sameRule.findingCount) sameRule.status = 'PASS';
  const { reportHash: _sameSourceReportHash, ...sameSourceCore } = sameSourceRerun;
  sameSourceRerun.reportHash = digest(sameSourceCore);
  const compared = projectEnterpriseIntegrity(project, blueprint, () => true, checkedAt).remediationInbox.items
    .find((item) => item.reportId === assessment.id && item.finding.id === finding.id);
  assert.equal(compared.status, 'UNRESOLVED');
  assert.equal(compared.notReturnedInLatest, true);
  assert.equal(compared.latestSameSourceReportId, sameSourceRerun.id);

  const next = structuredClone(blueprint);
  next.id = 'blueprint-00000000-0000-4000-8000-000000000099'; next.version += 1;
  next.createdAt = '2026-10-04T12:01:00.000Z'; project.blueprintVersions.push(next);
  assert.throws(() => applyEnterpriseIntegrityException(project, command, 'human:owner', checkedAt),
    { code: 'INTEGRITY_EXCEPTION_SOURCE_STALE', statusCode: 409 });
  const drifted = projectEnterpriseIntegrity(project, next, () => true, new Date('2026-10-06T12:00:00.000Z'));
  assert.equal(drifted.exceptions.find((entry) => entry.id === saved.id).status, 'STALE');
  const staleQueueItem = drifted.remediationInbox.items.find((item) => item.reportId === assessment.id && item.finding.id === finding.id);
  assert.equal(staleQueueItem.status, 'UNRESOLVED');
  assert.equal(staleQueueItem.reportDrift, true);
  assert.equal(staleQueueItem.exception.status, 'STALE');
  const rerun = applyEnterpriseIntegrityCommand(project, normalizeEnterpriseIntegrityCommand({ kind: 'run-integrity-checks',
    blueprintId: next.id, blueprintVersion: next.version, snapshotHash: digest(next), reason: 'Reassess the changed source.' }), 'human:owner').integrityAssessment;
  const reviewed = projectEnterpriseIntegrity(project, next, () => true, new Date('2026-10-06T12:00:00.000Z'));
  assert.equal(reviewed.current.id, rerun.id);
  assert.deepEqual(reviewed.current.exceptions, [], 'exceptions do not carry to a report for a new exact source');
  assert.equal(reviewed.exceptions.find((entry) => entry.id === saved.id).status, 'STALE');
});

test('enterprise decision tables preserve typed input identity and reject malformed or excessive rules', () => {
  const input = { id: 'information-score', type: 'information' };
  const decision = { id: 'decision-risk', type: 'decision' };
  const byId = new Map([[input.id, input], [decision.id, decision]]);
  const table = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: input.id, valueType: 'number' }],
    rules: [{ id: 'rule-high', conditions: [{ informationId: input.id, operator: 'gte', value: 5 }], outcome: 'APPROVE' },
      { id: 'rule-low', conditions: [{ informationId: input.id, operator: 'lt', value: 5 }], outcome: 'REVIEW' }], defaultOutcome: null };
  assert.deepEqual(normalizeDecisionTable(table, byId), table);
  assert.throws(() => normalizeDecisionTable({ ...table, inputs: [{ informationId: 'information-missing', valueType: 'number' }] }, byId),
    { code: 'INVALID_PROCESS_REFERENCE' });
  assert.throws(() => normalizeDecisionTable({ ...table, rules: Array.from({ length: 21 }, (_, index) => ({
    id: `rule-${index}`, conditions: [{ informationId: input.id, operator: 'gte', value: 0 }], outcome: `OUTCOME-${index}`,
  })) }, byId), { code: 'INVALID_DECISION_TABLE' });
  assert.throws(() => normalizeDecisionTable({ ...table, rules: [{ id: 'rule-typed', conditions: [
    { informationId: input.id, operator: 'gt', value: '5' }], outcome: 'APPROVE' }] }, byId), { code: 'INVALID_DECISION_TABLE' });
  assert.throws(() => normalizeDecisionTable({ ...table, decisionMode: 'AUTONOMOUS' }, byId), { code: 'INVALID_DECISION_TABLE' });
  const enforced = normalizeDecisionTable({ ...table, decisionMode: 'ENFORCED' }, byId);
  const enforcedTask = { flowRef: { decisionId: decision.id, decisionHash: digest(enforced), decisionTable: enforced,
    outcomes: ['APPROVE', 'REVIEW'], decisionInputs: [{ informationId: input.id, valueType: 'number' }] } };
  assert.equal(normalizeHumanDecisionChoice(enforcedTask, { outcome: 'APPROVE', observations: [{ informationId: input.id, value: 8 }], reason: 'Rules resolve approve.' }, 'succeeded').outcome, 'APPROVE');
  assert.throws(() => normalizeHumanDecisionChoice(enforcedTask, { outcome: 'REVIEW', observations: [{ informationId: input.id, value: 8 }], reason: 'Try to choose another route.' }, 'succeeded'),
    { code: 'PROCESS_DECISION_POLICY_BLOCKED', statusCode: 409 });
  assert.throws(() => normalizeHumanDecisionChoice(enforcedTask, { outcome: 'APPROVE', observations: [{ informationId: input.id, value: null }], reason: 'Input is unknown.' }, 'succeeded'),
    { code: 'PROCESS_DECISION_POLICY_BLOCKED', statusCode: 409 });
  assert.equal(decision.type, 'decision');
});

test('bounded process flow simulation is deterministic across routes, joins, loops, exceptions, unknowns and limits', () => {
  const infoScore = { id: 'information-score', type: 'information' };
  const infoAttempts = { id: 'information-attempts', type: 'information' };
  const process = { id: 'process-transfer', type: 'process' };
  const role = { id: 'role-operator', type: 'role' };
  const gateTable = { schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: infoScore.id, valueType: 'number' }],
    rules: [{ id: 'rule-approve', conditions: [{ informationId: infoScore.id, operator: 'gte', value: 5 }], outcome: 'APPROVE' },
      { id: 'rule-review', conditions: [{ informationId: infoScore.id, operator: 'lt', value: 5 }], outcome: 'REVIEW' }], defaultOutcome: null };
  const loopTable = { schemaVersion: '1.0', hitPolicy: 'FIRST_MATCH', inputs: [{ informationId: infoAttempts.id, valueType: 'number' }],
    rules: [{ id: 'rule-continue', conditions: [{ informationId: infoAttempts.id, operator: 'eq', value: 1 }], outcome: 'AGAIN' }], defaultOutcome: 'STOP' };
  const gate = { id: 'decision-gate', type: 'decision', decisionTable: gateTable };
  const loopDecision = { id: 'decision-loop', type: 'decision', decisionTable: loopTable };
  const byId = new Map([infoScore, infoAttempts, process, role, gate, loopDecision].map((object) => [object.id, object]));
  const manual = (id, kind, nextStepId, exceptionStepId = null) => ({ id, kind, title: id, processId: process.id, roleId: role.id,
    inputIds: [infoScore.id], outputIds: [], nextStepId, exceptionStepId });
  const flow = { schemaVersion: '1.0', startStepId: 'intake', steps: [
    manual('intake', 'manual', 'gate', 'exception'),
    { id: 'gate', kind: 'decision', title: 'Risk gate', decisionId: gate.id, routes: [
      { outcome: 'APPROVE', targetStepId: 'fork' }, { outcome: 'REVIEW', targetStepId: 'exception' }] },
    { id: 'fork', kind: 'fork', title: 'Parallel checks', branchStepIds: ['check-a', 'check-b'], joinStepId: 'join' },
    manual('check-a', 'manual', 'join'), manual('check-b', 'manual', 'join'),
    { id: 'join', kind: 'join', title: 'Join checks', forkStepId: 'fork', mode: 'ALL', nextStepId: 'loop' },
    { id: 'loop', kind: 'loop', title: 'Bounded retry', decisionId: loopDecision.id, continueOutcome: 'AGAIN',
      bodyStepId: 'loop-work', exitStepId: 'end', maxIterations: 2 },
    manual('loop-work', 'manual', 'return'), { id: 'return', kind: 'loop-return', title: 'Loop return', loopStepId: 'loop' },
    manual('exception', 'manual-exception', 'end'), { id: 'end', kind: 'end', title: 'End' },
  ] };
  assert.deepEqual(normalizeProcessFlow(flow, byId), flow);
  assert.throws(() => normalizeProcessFlow({ ...flow, steps: flow.steps.slice(0, -1) }, byId), { code: 'INVALID_PROCESS_FLOW' });
  assert.throws(() => normalizeProcessFlow({ ...flow, steps: flow.steps.map((step) => step.id === 'intake'
    ? { ...step, nextStepId: 'intake' } : step) }, byId), { code: 'PROCESS_FLOW_CYCLE' });

  const scenario = { inputs: [{ informationId: infoScore.id, value: 10 }, { informationId: infoAttempts.id, value: 1 }],
    activityOutcomes: ['intake', 'check-a', 'check-b'].map((stepId) => ({ stepId, iteration: 0, outcome: 'SUCCEEDED' }))
      .concat([{ stepId: 'loop-work', iteration: 1, outcome: 'SUCCEEDED' }]),
    decisionChoices: [{ stepId: 'loop', iteration: 0, outcome: 'AGAIN' }, { stepId: 'loop', iteration: 1, outcome: 'STOP' }], stepLimit: 80 };
  const first = simulateProcessFlow({ ...process, processFlow: flow }, scenario, byId);
  const second = simulateProcessFlow({ ...process, processFlow: flow }, scenario, byId);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(first.meaning, 'SIMULATION_ONLY');
  assert.ok(first.trace.some((entry) => entry.status === 'FORKED'));
  assert.ok(first.trace.some((entry) => entry.status === 'JOINED'));
  assert.ok(first.trace.some((entry) => entry.status === 'RETURNED'));
  assert.ok(first.trace.some((entry) => entry.status === 'ENDED'));
  const loopBound = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario,
    activityOutcomes: [...scenario.activityOutcomes, { stepId: 'loop-work', iteration: 2, outcome: 'SUCCEEDED' }],
    decisionChoices: [{ stepId: 'loop', iteration: 0, outcome: 'AGAIN' }, { stepId: 'loop', iteration: 1, outcome: 'AGAIN' },
      { stepId: 'loop', iteration: 2, outcome: 'AGAIN' }] }, byId);
  assert.equal(loopBound.status, 'LIMIT_REACHED', 'a declared loop stops at its saved maximum iteration count');

  const unknown = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario,
    inputs: [{ informationId: infoAttempts.id, value: 1 }] }, byId);
  assert.equal(unknown.status, 'BLOCKED');
  assert.equal(unknown.trace.find((entry) => entry.stepId === 'gate').status, 'UNKNOWN');
  const limited = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario, stepLimit: 1 }, byId);
  assert.equal(limited.status, 'LIMIT_REACHED');

  const overlappingTable = { ...gateTable, rules: [
    { id: 'rule-overlap-a', conditions: [{ informationId: infoScore.id, operator: 'gte', value: 1 }], outcome: 'APPROVE' },
    { id: 'rule-overlap-b', conditions: [{ informationId: infoScore.id, operator: 'lte', value: 20 }], outcome: 'REVIEW' },
  ] };
  const conflict = evaluateDecisionTable(overlappingTable, [{ informationId: infoScore.id, value: 10 }], byId);
  assert.equal(conflict.status, 'CONFLICTED');
  const conflictedFlow = { ...flow, steps: flow.steps.map((step) => step.id === 'gate' ? { ...step, decisionId: 'decision-overlap' } : step) };
  const conflictedObjects = new Map(byId); conflictedObjects.set('decision-overlap', { id: 'decision-overlap', type: 'decision', decisionTable: overlappingTable });
  const conflicted = simulateProcessFlow({ ...process, processFlow: conflictedFlow }, scenario, conflictedObjects);
  assert.equal(conflicted.status, 'CONFLICTED');
  assert.ok(conflicted.unresolved.some((entry) => entry.code === 'DECISION_UNRESOLVED' && entry.status === 'CONFLICTED'));

  const failedActivity = simulateProcessFlow({ ...process, processFlow: flow }, { ...scenario,
    activityOutcomes: [{ stepId: 'intake', iteration: 0, outcome: 'FAILED' }, { stepId: 'exception', iteration: 0, outcome: 'SUCCEEDED' }],
    decisionChoices: [], stepLimit: 20 }, byId);
  assert.equal(failedActivity.status, 'COMPLETED', 'a declared manual exception route is traceable without performing work');
  assert.ok(failedActivity.trace.some((entry) => entry.stepId === 'exception' && entry.kind === 'manual-exception'));
});

test('manual-flow activation waits for verified outcomes, joins branches, bounds loops and marks unselected work skipped', () => {
  const process = { id: 'process-live-flow', type: 'process', name: 'Live flow', detail: 'Bounded manual flow.', owner: 'role-operator' };
  const score = { id: 'information-score', type: 'information', name: 'Score' };
  const output = { id: 'information-result', type: 'information', name: 'Result' };
  const role = { id: 'role-operator', type: 'role', name: 'Operator' };
  const decision = { id: 'decision-route', type: 'decision', name: 'Route', by: role.id, decisionTable: {
    schemaVersion: '1.0', hitPolicy: 'UNIQUE', inputs: [{ informationId: score.id, valueType: 'number' }],
    rules: [{ id: 'route-high', conditions: [{ informationId: score.id, operator: 'gte', value: 5 }], outcome: 'HIGH' },
      { id: 'route-low', conditions: [{ informationId: score.id, operator: 'lt', value: 5 }], outcome: 'LOW' }], defaultOutcome: null,
  } };
  const loopDecision = { id: 'decision-loop', type: 'decision', name: 'Loop', by: role.id, decisionTable: {
    schemaVersion: '1.0', hitPolicy: 'FIRST_MATCH', inputs: [{ informationId: score.id, valueType: 'number' }],
    rules: [{ id: 'loop-continue', conditions: [{ informationId: score.id, operator: 'eq', value: 1 }], outcome: 'CONTINUE' }], defaultOutcome: 'STOP',
  } };
  const manual = (id, kind, nextStepId, exceptionStepId = null) => ({ id, kind, title: id, processId: process.id, roleId: role.id,
    inputIds: [score.id], outputIds: [output.id], nextStepId, exceptionStepId });
  process.processFlow = { schemaVersion: '1.0', startStepId: 'start', steps: [
    manual('start', 'manual', 'gate'),
    { id: 'gate', kind: 'decision', title: 'Route', decisionId: decision.id,
      routes: [{ outcome: 'HIGH', targetStepId: 'fork' }, { outcome: 'LOW', targetStepId: 'low-work' }] },
    { id: 'fork', kind: 'fork', title: 'Checks', branchStepIds: ['check-a', 'check-b'], joinStepId: 'join' },
    manual('check-a', 'manual', 'join', 'exception'),
    manual('check-b', 'manual', 'join'),
    manual('exception', 'manual-exception', 'join'),
    { id: 'join', kind: 'join', title: 'Join', forkStepId: 'fork', mode: 'ALL', nextStepId: 'loop' },
    { id: 'loop', kind: 'loop', title: 'Bounded correction', decisionId: loopDecision.id, continueOutcome: 'CONTINUE',
      bodyStepId: 'correction', exitStepId: 'end', maxIterations: 2 },
    manual('correction', 'manual', 'return'),
    { id: 'return', kind: 'loop-return', title: 'Return', loopStepId: 'loop' },
    manual('low-work', 'manual', 'low-end'),
    { id: 'low-end', kind: 'end', title: 'Low route ended' },
    { id: 'end', kind: 'end', title: 'Flow ended' },
  ] };
  const blueprint = { id: 'blueprint-manual-flow', version: 4, areas: { capabilitiesProcesses: { items: [process, score, output, role] },
    governanceRiskControls: { items: [decision, loopDecision] } } };
  const plan = planManualProcessFlow({ id: 'project-manual-flow', blueprintVersions: [blueprint] }, {
    processId: process.id, mode: 'manual-flow', blueprintId: blueprint.id, blueprintVersion: blueprint.version,
  }, 'oidc:operator');
  const task = (stepId, iteration = 0) => plan.tasks.find((entry) => entry.flowRef.stepId === stepId && entry.flowRef.iteration === iteration);
  assert.equal(task('gate').assignee.roleId, role.id, 'the decision maker role comes from the canonical decision.by field');
  assert.equal(task('loop').assignee.roleId, role.id);
  const outcomes = new Map();
  const complete = (stepId, iteration = 0, result = 'succeeded', decisionChoice = undefined) => {
    const entry = task(stepId, iteration);
    assert.ok(entry, `compiled occurrence ${stepId}#${iteration} exists`);
    outcomes.set(entry.id, { verified: true, result, ...(decisionChoice ? { decisionChoice } : {}) });
  };
  let activation = projectManualFlowActivation(plan);
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('start').id).state, 'READY');
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('gate').id).state, 'WAITING');
  const paused = projectManualFlowActivation(plan, outcomes, { planInstanceId: 'process-task-instance-paused', control: { status: 'PAUSED' } });
  assert.equal(paused.tasks.find((entry) => entry.taskId === task('start').id).state, 'WAITING');
  assert.match(paused.tasks.find((entry) => entry.taskId === task('start').id).reason, /paused/i);
  assert.notEqual(paused.identity, activation.identity);

  complete('start');
  activation = projectManualFlowActivation(plan, outcomes);
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('gate').id).state, 'READY');
  complete('gate', 0, 'succeeded', { outcome: 'HIGH' });
  activation = projectManualFlowActivation(plan, outcomes);
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('check-a').id).state, 'READY');
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('check-b').id).state, 'READY');
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('low-work').id).state, 'SKIPPED');

  complete('check-a', 0, 'failed');
  activation = projectManualFlowActivation(plan, outcomes);
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('exception').id).state, 'READY');
  assert.equal(activation.steps.find((entry) => entry.stepId === 'join' && entry.iteration === 0).state, 'WAITING');
  complete('exception');
  complete('check-b');
  activation = projectManualFlowActivation(plan, outcomes);
  assert.equal(activation.steps.find((entry) => entry.stepId === 'join' && entry.iteration === 0).state, 'SUCCEEDED');
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('loop', 0).id).state, 'READY');

  complete('loop', 0, 'succeeded', { outcome: 'CONTINUE' });
  assert.equal(projectManualFlowActivation(plan, outcomes).tasks.find((entry) => entry.taskId === task('correction', 1).id).state, 'READY');
  complete('correction', 1);
  complete('loop', 1, 'succeeded', { outcome: 'CONTINUE' });
  complete('correction', 2);
  complete('loop', 2, 'succeeded', { outcome: 'STOP' });
  activation = projectManualFlowActivation(plan, outcomes);
  assert.equal(activation.state, 'COMPLETED');
  assert.equal(activation.tasks.find((entry) => entry.taskId === task('low-work').id).state, 'SKIPPED');
  assert.equal(activation.steps.find((entry) => entry.stepId === 'join').state, 'SUCCEEDED', 'a prior WAITING arrival does not mask the completed ALL join');

  const overBound = new Map(outcomes);
  overBound.set(task('loop', 2).id, { verified: true, result: 'succeeded', decisionChoice: { outcome: 'CONTINUE' } });
  const bounded = projectManualFlowActivation(plan, overBound);
  assert.equal(bounded.state, 'BLOCKED');
  assert.equal(bounded.tasks.find((entry) => entry.taskId === task('loop', 2).id).state, 'WAITING');
  assert.match(bounded.tasks.find((entry) => entry.taskId === task('loop', 2).id).reason, /bound/i);

  const unverified = new Map([[task('start').id, { verified: false, result: 'succeeded' }]]);
  const pending = projectManualFlowActivation(plan, unverified);
  assert.equal(pending.tasks.find((entry) => entry.taskId === task('start').id).state, 'WAITING');
  assert.equal(pending.tasks.find((entry) => entry.taskId === task('gate').id).state, 'WAITING');
});
