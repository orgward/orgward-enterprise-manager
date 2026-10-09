import assert from 'node:assert/strict';
import test from 'node:test';
import { MUTATIONS, STAGES, digest } from '../../src/sdlc/contracts.mjs';
import { advanceCase, approveRelease, createChangeCase, recordObservation, runToCheckpoint, traceability, verifyContextManifest, verifyEvidenceLedger } from '../../src/sdlc/engine.mjs';

test('golden case runs to protected approval, resumes, observes, and learns', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  const first = runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'golden-run-1' });
  assert.equal(first.steps, 10);
  assert.equal(changeCase.currentStage, 'S9');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.gateHistory.at(-1).gate, 'G9');
  assert.equal(changeCase.gateHistory.at(-1).status, 'NEEDS_HUMAN');

  approveRelease(changeCase, { principal: 'actor-accountable-owner', roles: ['release-approver', 'control-owner'], idempotencyKey: 'approve-1' });
  advanceCase(changeCase, { actor: 'actor-accountable-owner', idempotencyKey: 'release-1' });
  assert.equal(changeCase.artifacts.release.status, 'RELEASED');
  assert.equal(changeCase.artifacts.release.externalEffect, false);
  assert.equal(changeCase.artifacts.assurance.releaseEvidenceBundle.contentHash, digest(Object.fromEntries(Object.entries(changeCase.artifacts.assurance.releaseEvidenceBundle).filter(([key]) => key !== 'contentHash'))));
  assert.ok(changeCase.artifacts.assurance.draftReleaseEvidenceBundle);
  assert.equal(changeCase.currentStage, 'S10');

  advanceCase(changeCase, { actor: 'operations', idempotencyKey: 'observe-missing' });
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  recordObservation(changeCase, { actor: 'operations', signals: { technicalHealthy: true, controlExceptions: 0, manualWorkReduction: 35 }, idempotencyKey: 'observation-1' });
  advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'outcome-1' });
  advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'learning-1' });
  assert.equal(changeCase.status, 'PASSED');
  assert.equal(changeCase.currentStage, null);
  assert.equal(changeCase.artifacts.outcome.technicalOutcome, 'PASS');
  assert.equal(changeCase.artifacts.outcome.controlOutcome, 'PASS');
  assert.equal(changeCase.artifacts.outcome.businessOutcome, 'FAIL');
  assert.equal(changeCase.artifacts.learning.proposals.length, 1);
  assert.equal(changeCase.artifacts.learning.proposals[0].status, 'PROPOSED_NOT_APPLIED');

  const lineage = traceability(changeCase);
  assert.ok(lineage.nodes.some((node) => node.type === 'Intent'));
  assert.ok(lineage.nodes.some((node) => node.type === 'Requirement'));
  assert.ok(lineage.nodes.some((node) => node.type === 'ArchitectureDecision'));
  assert.ok(lineage.nodes.some((node) => node.type === 'ChangeSet'));
  assert.ok(lineage.nodes.some((node) => node.type === 'Release'));
  assert.ok(lineage.nodes.some((node) => node.type === 'Outcome'));
  assert.ok(lineage.nodes.some((node) => node.type === 'FollowUp'));
});

test('runtime and control findings propose an evidence-linked design correction without applying it', () => {
  const sourceBinding = { projectId: 'project-runtime', blueprintId: 'blueprint-runtime',
    blueprintVersion: 2, objectId: 'system-runtime', sourceHash: 'a'.repeat(64) };
  const changeCase = createChangeCase({ mode: 'custom', createdBy: 'runtime-owner', accountableOwner: 'runtime-owner' }, { sourceBinding });
  changeCase.currentStageIndex = 11;
  changeCase.currentStage = 'S11';
  changeCase.status = 'RUNNING';
  changeCase.artifacts.release = { id: 'release-runtime-observed', status: 'RELEASED', authorizedBy: 'existing-approval' };
  const signals = { technicalHealthy: false, controlExceptions: 2, manualWorkReduction: 60, errorRate: 0.04, cost: 42 };
  changeCase.artifacts.observation = { id: 'observation-runtime-evidence', releaseRef: changeCase.artifacts.release.id,
    window: 'synthetic:runtime-window', signals, contentHash: digest(signals) };
  changeCase.artifacts.outcome = { id: 'outcome-runtime-evidence', businessOutcome: 'PASS', findings: [], followUpProposalRefs: [] };
  const savedSource = structuredClone(changeCase.sourceBinding);
  const savedRelease = structuredClone(changeCase.artifacts.release);

  advanceCase(changeCase, { actor: 'learning-stage', idempotencyKey: 'runtime-design-proposal' });

  const proposal = changeCase.artifacts.learning.proposals.find((entry) => entry.type === 'DESIGN_CORRECTION_CLAIM');
  assert.ok(proposal);
  assert.equal(proposal.status, 'PROPOSED_NOT_APPLIED');
  assert.equal(proposal.authorityRequired, true);
  assert.match(proposal.proposedClaim, /technical health failure and 2 control exception/);
  assert.deepEqual(proposal.derivedFrom, [changeCase.artifacts.observation.id,
    changeCase.artifacts.observation.contentHash, changeCase.artifacts.observation.releaseRef,
    changeCase.artifacts.outcome.id]);
  assert.deepEqual(proposal.evidence.signals, signals);
  assert.equal(proposal.evidence.observationHash, digest(proposal.evidence.signals));
  assert.deepEqual(changeCase.sourceBinding, savedSource);
  assert.deepEqual(changeCase.artifacts.release, savedRelease);
  assert.equal(changeCase.artifacts.learning.authoritativeModelMutated, false);
  assert.ok(changeCase.artifacts.outcome.followUpProposalRefs.includes(proposal.id));
});

test('context manifest seals coverage, unknowns, exclusions, guardrails and evidence references', () => {
  const changeCase = createChangeCase({ mutation: 'missing_aml' });
  const external = { id: 'external-unknown', type: 'external-document', name: 'Untrusted attachment',
    detail: 'This attachment is excluded from authoritative context.', authority: 'UNTRUSTED',
    freshness: 'CURRENT', classification: 'UNTRUSTED', source: 'external:untrusted-upload' };
  external.contentHash = digest(external);
  changeCase.enterpriseSnapshot.objects.push(external);
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'context-manifest-seal' });

  const context = changeCase.artifacts.context;
  assert.equal(context.manifestVersion, 4);
  assert.equal(Object.hasOwn(context, 'savedProjectPin'), true);
  assert.equal(context.savedProjectPin, null, 'synthetic-only cases explicitly carry a null saved-project pin');
  assert.equal(context.savedProjectCoverage, null, 'synthetic-only cases do not claim saved-project coverage');
  const creationEvidence = changeCase.evidenceLedger.find((entry) => entry.id === context.contextCreationEvidenceRef);
  assert.equal(creationEvidence.sourceType, 'sdlc-context-manifest-created');
  assert.deepEqual(creationEvidence.content, { manifestVersion: 4, sourceBindingHash: null,
    savedProjectPinHash: digest(null), savedProjectCoverageHash: digest(null), classificationHash: null,
    candidateUniverseHash: null, sourcePinsHash: null });
  assert.equal(context.enterpriseContext.version, 1);
  assert.equal(context.guardrails.intentRef, changeCase.intent.id);
  assert.ok(context.guardrails.constraints.length);
  assert.ok(context.unknownDependencies.some((entry) => entry.domain === 'regulation'));
  assert.deepEqual(context.excludedDependencies, [{ objectRef: external.id, sourceId: external.source,
    status: 'EXCLUDED', reason: 'UNTRUSTED_SOURCE_NOT_USED_FOR_AUTHORITATIVE_COVERAGE' }]);
  assert.equal(context.evidenceManifest.length, context.evidenceRefs.length);
  assert.equal(verifyContextManifest(changeCase).valid, true);

  const originalRationale = context.coverage[0].rationale;
  context.coverage[0].rationale = 'Changed after context was pinned.';
  assert.equal(verifyContextManifest(changeCase).valid, false);
  context.coverage[0].rationale = originalRationale;
  assert.equal(verifyContextManifest(changeCase).valid, true);
  changeCase.evidenceLedger[0].contentHash = '0'.repeat(64);
  assert.equal(verifyContextManifest(changeCase).valid, false);
});

test('v4 saved-project classifications pin guardrails and scope exclusions without claiming project-wide exclusion', () => {
  const sourceBinding = { bindingSchemaVersion: 1, projectId: 'project-v4-test', projectVersion: 3,
    blueprintId: 'blueprint-v4-test', blueprintVersion: 2, blueprintSchemaVersion: 1,
    objectId: 'process-v4-test', objectType: 'process', sourceHash: 'a'.repeat(64), bindingHash: 'b'.repeat(64),
    snapshot: { id: 'process-v4-test', type: 'process', name: 'Selected process', detail: 'Test fixture' } };
  const changeCase = createChangeCase({ mode: 'golden', createdBy: 'owner', accountableOwner: 'owner' }, { sourceBinding });
  changeCase.intent.constraints = ['Require an authorized reviewer.'];
  changeCase.intent.nonGoals = ['No live financial effects.'];
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'v4-guardrail-classification' });
  const coverage = changeCase.artifacts.context.savedProjectCoverage;
  assert.ok(coverage.classifications.some((entry) => entry.status === 'REPRESENTED'
    && entry.domain === 'case-intent-guardrail' && entry.reason.includes('not as independently verified policy')));
  const exclusion = coverage.classifications.find((entry) => entry.status === 'EXCLUDED' && entry.domain === 'case-intent-non-goal');
  assert.ok(exclusion);
  assert.match(exclusion.reason, /does not exclude the item from the saved project or enterprise/);
  assert.equal(coverage.excludedDependencies.status, 'SCOPED_ONLY');
  assert.equal(verifyContextManifest(changeCase).valid, false, 'the incomplete test source binding is not promoted to verified evidence');
});

test('historical context manifest v2 retains its original source-pin digest recipe', () => {
  const changeCase = createChangeCase({ mutation: 'missing_aml' });
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'historical-context-v2-fixture' });
  const context = changeCase.artifacts.context;
  context.manifestVersion = 2;
  delete context.savedProjectCoverage;
  const creation = changeCase.evidenceLedger.find((entry) => entry.id === context.contextCreationEvidenceRef);
  creation.sourceId = `sdlc:case:${changeCase.id}:context-manifest-created:v2`;
  creation.content = { manifestVersion: 2, sourceBindingHash: null, savedProjectPinHash: digest(null) };
  creation.contentHash = digest(creation.content);
  creation.provenanceChain = [`case:${changeCase.id}`, 'context-manifest-version:2', `saved-project-pin:sha256:${digest(null)}`];
  context.evidenceManifest = changeCase.evidenceLedger.filter((entry) => context.evidenceRefs.includes(entry.id)).map((entry) => ({
    evidenceRef: entry.id, contentHash: entry.contentHash, sourceId: entry.sourceId, sourceType: entry.sourceType,
    objectRef: entry.objectRef, authority: entry.authority, freshness: entry.freshness,
  }));
  delete context.provenanceManifestHash;
  context.provenanceManifestHash = digest(context);
  assert.equal(verifyContextManifest(changeCase).valid, true, 'unmodified historical v2 verifies using its original recipe');
});

test('historical context manifest v3 retains its exact coverage and creation-evidence recipe', () => {
  const changeCase = createChangeCase({ mutation: 'missing_aml' });
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'historical-context-v3-fixture' });
  const context = changeCase.artifacts.context;
  context.manifestVersion = 3;
  const creation = changeCase.evidenceLedger.find((entry) => entry.id === context.contextCreationEvidenceRef);
  creation.sourceId = `sdlc:case:${changeCase.id}:context-manifest-created:v3`;
  creation.content = { manifestVersion: 3, sourceBindingHash: null, savedProjectPinHash: digest(null), savedProjectCoverageHash: digest(null) };
  creation.contentHash = digest(creation.content);
  creation.provenanceChain = [`case:${changeCase.id}`, 'context-manifest-version:3', `saved-project-pin:sha256:${digest(null)}`,
    `saved-project-coverage:sha256:${digest(null)}`];
  context.evidenceManifest = changeCase.evidenceLedger.filter((entry) => context.evidenceRefs.includes(entry.id)).map((entry) => ({
    evidenceRef: entry.id, contentHash: entry.contentHash, sourceId: entry.sourceId, sourceType: entry.sourceType,
    objectRef: entry.objectRef, authority: entry.authority, freshness: entry.freshness,
  }));
  delete context.provenanceManifestHash;
  context.provenanceManifestHash = digest(context);
  assert.equal(verifyContextManifest(changeCase).valid, true, 'v3 remains readable with its original coverage digest recipe');
  assert.equal(context.savedProjectCoverage, null);
});

test('historical context manifest v1 keeps its original digest recipe without a saved-project pin', () => {
  const changeCase = createChangeCase({ mutation: 'missing_aml' });
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'historical-context-version-fixture' });
  const context = structuredClone(changeCase.artifacts.context);
  context.manifestVersion = 1;
  delete context.savedProjectPin;
  delete context.savedProjectCoverage;
  const creationRef = context.contextCreationEvidenceRef;
  delete context.contextCreationEvidenceRef;
  context.evidenceRefs = context.evidenceRefs.filter((ref) => ref !== creationRef);
  context.evidenceManifest = context.evidenceManifest.filter((entry) => entry.evidenceRef !== creationRef);
  changeCase.evidenceLedger = changeCase.evidenceLedger.filter((entry) => entry.id !== creationRef);
  delete context.provenanceManifestHash;
  context.provenanceManifestHash = digest(context);
  changeCase.artifacts.context = context;
  assert.equal(verifyContextManifest(changeCase).valid, true, 'historical v1 has no new pin field and verifies under its own digest');
  const unsupported = structuredClone(changeCase);
  unsupported.artifacts.context.manifestVersion = 77;
  unsupported.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(unsupported.artifacts.context)
    .filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifyContextManifest(unsupported).valid, false, 'an explicitly unsupported version is invalid, not historical legacy');
});

for (const [mutation, expectedGate] of Object.entries({
  missing_aml: 'G1', stale_architecture: 'G1', forged_provenance: 'G1', omitted_reporting: 'G2', unresolved_interpretation: 'G3', contradictory_requirement: 'G4',
  direct_database: 'G5', authority_bypass: 'G5', missing_rollback: 'G5', plan_cycle: 'G6', failing_ci: 'G7', artifact_tamper: 'G8', unauthorized_release: 'G9',
})) {
  test(`${mutation} mutation is blocked at ${expectedGate}`, () => {
    const changeCase = createChangeCase({ mode: 'golden', mutation });
    runToCheckpoint(changeCase, { actor: 'mutation-runner', idempotencyKey: `run-${mutation}` });
    assert.equal(changeCase.gateHistory.at(-1).gate, expectedGate);
    assert.ok(['BLOCKED', 'NEEDS_HUMAN'].includes(changeCase.status));
    assert.notEqual(changeCase.gateHistory.at(-1).status, 'PASSED');
    assert.equal(MUTATIONS[mutation].expectedGate, expectedGate);
  });
}

test('prompt injection remains untrusted data and cannot block or authorize the flow', () => {
  const changeCase = createChangeCase({ mode: 'golden', mutation: 'prompt_injection' });
  runToCheckpoint(changeCase, { actor: 'orchestrator', idempotencyKey: 'prompt-run' });
  assert.equal(changeCase.currentStage, 'S9');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.ok(changeCase.evaluations.find((entry) => entry.definitionRef === 'context-sufficiency').findings.some((entry) => entry.code === 'UNTRUSTED_CONTENT_ISOLATED'));
  assert.equal(changeCase.approvals.length, 0);
});

test('segregation of duties rejects self approval and missing roles', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  runToCheckpoint(changeCase, { idempotencyKey: 'sod-run' });
  assert.throws(() => approveRelease(changeCase, { principal: 'actor-implementation-agent', roles: ['release-approver', 'control-owner'] }), /cannot approve/i);
  assert.throws(() => approveRelease(changeCase, { principal: 'someone', roles: ['release-approver'] }), /control owner/i);
  assert.equal(changeCase.approvals.length, 0);
});

test('stage commands are idempotent and evidence tampering is detected', () => {
  const changeCase = createChangeCase({ mode: 'golden' });
  const first = advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'same-key' });
  const version = changeCase.version;
  const gates = changeCase.gateHistory.length;
  const second = advanceCase(changeCase, { actor: 'orchestrator', idempotencyKey: 'same-key' });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.gateHistory.length, gates);

  advanceCase(changeCase, { idempotencyKey: 'context-step' });
  assert.ok(verifyEvidenceLedger(changeCase).every((entry) => entry.valid));
  changeCase.evidenceLedger[0].content.name = 'tampered';
  assert.ok(verifyEvidenceLedger(changeCase).some((entry) => !entry.valid));
});

test('custom incomplete intent fails G0 rather than fabricating certainty', () => {
  const changeCase = createChangeCase({ mode: 'custom', rawIntent: 'Make customer maintenance better.' });
  advanceCase(changeCase, { idempotencyKey: 'incomplete-intent' });
  assert.equal(changeCase.status, 'BLOCKED');
  assert.equal(changeCase.gateHistory[0].gate, 'G0');
  assert.ok(changeCase.gateHistory[0].findings.length >= 4);
});

test('contracts expose the complete twelve-stage lifecycle and stable hashing', () => {
  assert.equal(STAGES.length, 12);
  assert.deepEqual(STAGES.map((stage) => stage.id), ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11']);
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
});
