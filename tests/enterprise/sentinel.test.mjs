import assert from 'node:assert/strict';
import test from 'node:test';
import { addConversationTurn, createProject } from '../../src/model.mjs';
import { applyEnterpriseSentinelCommand, ENTERPRISE_SENTINEL_PROFILE, evaluateEnterpriseSentinel,
  ENTERPRISE_SENTINEL_LIMITS, isValidEnterpriseSentinelAssessment, projectEnterpriseSentinel } from '../../src/enterprise/sentinel.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { createChangeCase, pinProjectSourceObject, runToCheckpoint, verifyContextManifest, verifySourceBinding } from '../../src/sdlc/engine.mjs';

function projectFixture() {
  const project = createProject('Sentinel source fixture');
  for (const answer of ['A repair service.', 'Small businesses.', 'A transparent subscription.', 'Human approval remains required.']) addConversationTurn(project, answer);
  project.version = 7;
  return project;
}

function command(project, reason = 'Review process accountability.') {
  const blueprint = project.blueprintVersions.at(-1);
  return { kind: 'run-sentinel-assessment', blueprintId: blueprint.id, blueprintVersion: blueprint.version,
    snapshotHash: digest(blueprint), reason };
}

test('Sentinel profile digest commits to executable rule semantics and evaluates supported process-owner coverage', () => {
  const project = projectFixture();
  const blueprint = structuredClone(project.blueprintVersions.at(-1));
  const processes = Object.values(blueprint.areas).flatMap((area) => area.items).filter((item) => item.type === 'process');
  const process = processes[0];
  assert.ok(process);
  for (const entry of processes) entry.ownerRoleName = 'Operations owner';
  assert.equal(evaluateEnterpriseSentinel(blueprint).status, 'PASS');
  delete process.ownerRoleName;
  const failed = evaluateEnterpriseSentinel(blueprint);
  assert.equal(failed.status, 'FAIL');
  assert.ok(failed.findings.some((finding) => finding.objectId === process.id));
  assert.match(ENTERPRISE_SENTINEL_PROFILE.hash, /^[a-f0-9]{64}$/);
  const { hash, ...profileCore } = ENTERPRISE_SENTINEL_PROFILE;
  assert.equal(hash, digest(profileCore));
  assert.notEqual(digest({ ...profileCore, evaluatorRevision: 'sentinel-evaluator-altered' }), hash,
    'changing executable evaluator semantics changes the profile digest');
  assert.equal(failed.coverage.applicable, processes.length);
});

test('Sentinel assessment is immutable, bounded, source pinned, and projection marks later design drift', () => {
  const project = projectFixture();
  const savedVersion = project.version;
  const result = applyEnterpriseSentinelCommand(project, command(project), 'owner', new Date('2026-10-06T12:00:00.000Z'));
  const report = result.sentinelAssessment;
  assert.equal(report.source.assessedAggregateVersion, savedVersion);
  assert.equal(project.version, savedVersion, 'the aggregate store owns the separate N to N+1 optimistic version advance');
  assert.equal(isValidEnterpriseSentinelAssessment(report, project.id), true);
  assert.equal(projectEnterpriseSentinel(project, project.blueprintVersions.at(-1)).current.id, report.id);
  const tampered = structuredClone(report); tampered.profile.rules[0].severity = 'low';
  assert.equal(isValidEnterpriseSentinelAssessment(tampered, project.id), false);
  const wrongProfileHash = structuredClone(report); wrongProfileHash.profile.hash = '0'.repeat(64);
  wrongProfileHash.reportHash = digest(Object.fromEntries(Object.entries(wrongProfileHash).filter(([key]) => key !== 'reportHash')));
  assert.equal(isValidEnterpriseSentinelAssessment(wrongProfileHash, project.id), false, 'a correctly resealed report with a perturbed profile hash is rejected');
  const unknownProfile = structuredClone(report); unknownProfile.profile.id = 'orgward-sentinel-unknown';
  unknownProfile.reportHash = digest(Object.fromEntries(Object.entries(unknownProfile).filter(([key]) => key !== 'reportHash')));
  assert.equal(isValidEnterpriseSentinelAssessment(unknownProfile, project.id), false);
  const next = structuredClone(project.blueprintVersions.at(-1)); next.version += 1; next.id = `blueprint-${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
  assert.equal(projectEnterpriseSentinel(project, next).current, null);
  assert.equal(projectEnterpriseSentinel(project, next).assessments[0].appliesToContext, false);
});

test('Sentinel assessment returns UNKNOWN when no supported process rule applies', () => {
  const blueprint = { id: 'blueprint-example', version: 1, areas: { empty: { items: [] } } };
  const result = evaluateEnterpriseSentinel(blueprint);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.coverage.applicable, 0);
});

test('Sentinel assessment bounds report count, applicable findings, and serialized report bytes', () => {
  const capped = projectFixture();
  capped.enterpriseSentinelAssessments = Array.from({ length: ENTERPRISE_SENTINEL_LIMITS.assessments }, (_, index) => ({ id: `prior-${index}` }));
  assert.throws(() => applyEnterpriseSentinelCommand(capped, command(capped), 'owner'), /50-report Sentinel assessment history limit/);

  const tooMany = projectFixture();
  const blueprint = tooMany.blueprintVersions.at(-1);
  const items = Object.values(blueprint.areas)[0].items;
  for (let index = 0; index <= ENTERPRISE_SENTINEL_LIMITS.findings; index++) items.push({ id: `process-${index}`, type: 'process', name: `Process ${index}`, detail: '' });
  assert.throws(() => applyEnterpriseSentinelCommand(tooMany, command(tooMany), 'owner'), /more applicable processes/);

  const tooLarge = projectFixture();
  const largeBlueprint = tooLarge.blueprintVersions.at(-1);
  const largeItems = Object.values(largeBlueprint.areas)[0].items;
  for (let index = 0; index < 270; index++) largeItems.push({ id: `process-long-${index}`, type: 'process', name: `Process ${index} ${'x'.repeat(500)}`, detail: '' });
  assert.throws(() => applyEnterpriseSentinelCommand(tooLarge, command(tooLarge), 'owner'), /128 KiB storage limit/);
});

test('SDLC pins exact Sentinel report, seals required scope, and keeps unsupported coverage visibly unknown', () => {
  const project = projectFixture();
  const blueprint = project.blueprintVersions.at(-1);
  const process = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'process');
  for (const item of Object.values(blueprint.areas).flatMap((area) => area.items).filter((entry) => entry.type === 'process')) item.ownerRoleName = 'Operations owner';
  const assessment = applyEnterpriseSentinelCommand(project, command(project), 'owner', new Date('2026-10-06T12:00:00.000Z')).sentinelAssessment;
  project.version += 1;
  const selection = { sourceObjectId: process.id, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
    sentinelRequiredScope: 'PROCESS_ACCOUNTABILITY',
    sentinelAssessmentId: assessment.id, sentinelReportHash: assessment.reportHash };
  const binding = pinProjectSourceObject(project, selection);
  assert.equal(binding.bindingSchemaVersion, 2);
  assert.equal(binding.sentinelContext.assessment.reportHash, assessment.reportHash);
  assert.equal(verifySourceBinding(binding).valid, true);
  const selectedCase = createChangeCase({ mode: 'golden', projectId: project.id }, { sourceBinding: binding });
  runToCheckpoint(selectedCase, { actor: 'owner', idempotencyKey: 'sentinel-selected-context' });
  const sealed = selectedCase.artifacts.context;
  assert.equal(sealed.sentinelContext.assessment.id, assessment.id);
  assert.equal(sealed.sentinelContext.assessment.profileHash, assessment.profile.hash);
  assert.deepEqual(sealed.savedProjectPin, { schemaVersion: 1, bindingSchemaVersion: 2,
    projectId: project.id, projectVersion: project.version, blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, blueprintSchemaVersion: binding.blueprintSchemaVersion,
    blueprintSnapshotHash: digest(blueprint), blueprintSnapshotStatus: 'PINNED',
    sourceObjectId: process.id, sourceObjectType: process.type, sourceHash: binding.sourceHash, bindingHash: binding.bindingHash });
  assert.equal(sealed.savedProjectPin.projectVersion, assessment.source.assessedAggregateVersion + 1,
    'current selected aggregate N+1 remains separate from the Sentinel assessed source aggregate N');
  assert.equal(sealed.coverage.find((entry) => entry.domain === 'sentinel').status, 'PASSED', 'the explicitly required supported scope passes');
  assert.match(sealed.coverage.find((entry) => entry.domain === 'sentinel').unknowns.join(' '), /outside Sentinel v1 coverage/);
  assert.equal(verifyContextManifest(selectedCase).valid, true);
  const tampered = structuredClone(selectedCase);
  tampered.artifacts.context.sentinelContext.assessment.reportHash = '0'.repeat(64);
  tampered.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(tampered.artifacts.context).filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifyContextManifest(tampered).valid, false, 're-sealing a substituted report cannot change the pinned binding');

  const changedPin = structuredClone(selectedCase);
  changedPin.artifacts.context.savedProjectPin.projectVersion++;
  changedPin.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(changedPin.artifacts.context).filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifyContextManifest(changedPin).valid, false, 'changing a source pin and resealing cannot diverge from sourceBinding');
  const removedPin = structuredClone(selectedCase);
  delete removedPin.artifacts.context.savedProjectPin;
  removedPin.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(removedPin.artifacts.context).filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifyContextManifest(removedPin).valid, false, 'new manifest v2 requires savedProjectPin even after resealing');
  const downgradedManifest = structuredClone(selectedCase);
  downgradedManifest.artifacts.context.manifestVersion = 1;
  delete downgradedManifest.artifacts.context.savedProjectPin;
  downgradedManifest.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(downgradedManifest.artifacts.context).filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifyContextManifest(downgradedManifest).valid, false,
    'a v2 creation evidence marker prevents relabeling and resealing the manifest as historical v1');

  const inconsistentHashes = structuredClone(selectedCase);
  const inconsistentBinding = inconsistentHashes.sourceBinding;
  inconsistentBinding.integrityContext.blueprintSnapshotHash = 'f'.repeat(64);
  inconsistentBinding.bindingHash = digest({ bindingSchemaVersion: 2, projectId: inconsistentBinding.projectId,
    projectVersion: inconsistentBinding.projectVersion, blueprintId: inconsistentBinding.blueprintId,
    blueprintVersion: inconsistentBinding.blueprintVersion, blueprintSchemaVersion: inconsistentBinding.blueprintSchemaVersion,
    objectId: inconsistentBinding.objectId, objectType: inconsistentBinding.objectType, sourceHash: inconsistentBinding.sourceHash,
    integrityContext: inconsistentBinding.integrityContext, sentinelContext: inconsistentBinding.sentinelContext });
  inconsistentHashes.artifacts.context.sourceBindingIntegrityHash = inconsistentBinding.bindingHash;
  inconsistentHashes.artifacts.context.savedProjectPin.bindingHash = inconsistentBinding.bindingHash;
  inconsistentHashes.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(inconsistentHashes.artifacts.context).filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifySourceBinding(inconsistentBinding).valid, false);
  assert.equal(verifyContextManifest(inconsistentHashes).valid, false, 'inconsistent retained blueprint hashes fail even when binding and manifest hashes are recomputed');

  const missingBinding = pinProjectSourceObject(project, { ...selection, sentinelAssessmentId: null, sentinelReportHash: null });
  assert.equal(missingBinding.sentinelContext.state, 'NOT_ASSESSED', 'latest report is not silently selected');
  const missingCase = createChangeCase({ mode: 'golden', projectId: project.id }, { sourceBinding: missingBinding });
  runToCheckpoint(missingCase, { actor: 'owner', idempotencyKey: 'sentinel-missing-context' });
  assert.equal(missingCase.artifacts.context.coverage.find((entry) => entry.domain === 'sentinel').status, 'BLOCKED', 'an explicitly required scope with no report blocks');
  assert.ok(missingCase.artifacts.context.unknownDependencies.some((entry) => entry.domain === 'sentinel'));
  const optionalBinding = pinProjectSourceObject(project, { ...selection, sentinelRequiredScope: 'NONE', sentinelAssessmentId: null, sentinelReportHash: null });
  const optionalCase = createChangeCase({ mode: 'golden', projectId: project.id }, { sourceBinding: optionalBinding });
  runToCheckpoint(optionalCase, { actor: 'owner', idempotencyKey: 'sentinel-optional-context' });
  assert.equal(optionalCase.artifacts.context.coverage.find((entry) => entry.domain === 'sentinel').status, 'UNKNOWN', 'unrequired scope remains visible without blocking');
});

test('required Sentinel scope blocks missing, unknown, and cross-project or drifted reports', () => {
  const project = projectFixture(); const blueprint = project.blueprintVersions.at(-1);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'process');
  const assessment = applyEnterpriseSentinelCommand(project, command(project), 'owner').sentinelAssessment;
  project.version++;
  const base = { sourceObjectId: source.id, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
    sentinelRequiredScope: 'PROCESS_ACCOUNTABILITY' };
  const missing = pinProjectSourceObject(project, { ...base, sentinelAssessmentId: null, sentinelReportHash: null });
  const missingCase = createChangeCase({ mode: 'golden' }, { sourceBinding: missing });
  runToCheckpoint(missingCase, { actor: 'owner', idempotencyKey: 'required-sentinel-missing' });
  assert.equal(missingCase.artifacts.context.coverage.find((entry) => entry.domain === 'sentinel').status, 'BLOCKED');

  const foreignProject = projectFixture(); foreignProject.id = `project-${'f'.repeat(8)}-${'f'.repeat(4)}-${'f'.repeat(4)}-${'f'.repeat(4)}-${'f'.repeat(12)}`;
  foreignProject.blueprintVersions = structuredClone(project.blueprintVersions); foreignProject.version = project.version;
  assert.throws(() => pinProjectSourceObject(foreignProject, { ...base, sentinelAssessmentId: assessment.id, sentinelReportHash: assessment.reportHash }), /integrity check/);
  const drifted = structuredClone(project); const driftItem = Object.values(drifted.blueprintVersions.at(-1).areas)[0].items[0]; driftItem.detail += ' drift';
  assert.throws(() => pinProjectSourceObject(drifted, { ...base, sentinelAssessmentId: assessment.id, sentinelReportHash: assessment.reportHash }), /another design snapshot/);

  const unknownBlueprint = { id: `blueprint-${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`, version: 1, areas: { empty: { items: [{ id: 'service', type: 'application', name: 'Service', detail: 'No process rules apply.' }] } } };
  const unknownProject = projectFixture(); unknownProject.blueprintVersions = [unknownBlueprint];
  const unknownAssessment = applyEnterpriseSentinelCommand(unknownProject, command(unknownProject), 'owner').sentinelAssessment;
  unknownProject.version++;
  const unknownBinding = pinProjectSourceObject(unknownProject, { sourceObjectId: 'service', expectedProjectVersion: unknownProject.version,
    expectedBlueprintId: unknownBlueprint.id, expectedBlueprintVersion: 1, sentinelRequiredScope: 'PROCESS_ACCOUNTABILITY',
    sentinelAssessmentId: unknownAssessment.id, sentinelReportHash: unknownAssessment.reportHash });
  const unknownCase = createChangeCase({ mode: 'golden' }, { sourceBinding: unknownBinding });
  runToCheckpoint(unknownCase, { actor: 'owner', idempotencyKey: 'required-sentinel-unknown' });
  assert.equal(unknownCase.artifacts.context.coverage.find((entry) => entry.domain === 'sentinel').status, 'BLOCKED');
});

test('legacy source-binding hash recipe remains valid and reports Sentinel as unassessed', () => {
  const project = projectFixture();
  const blueprint = project.blueprintVersions.at(-1);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items)[0];
  const binding = pinProjectSourceObject(project, { sourceObjectId: source.id, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version, bindingSchemaVersion: 1 });
  assert.equal(Object.hasOwn(binding, 'bindingSchemaVersion'), false);
  assert.equal(Object.hasOwn(binding, 'sentinelContext'), false);
  const retainedLegacyCase = createChangeCase({ mode: 'golden', projectId: project.id }, { sourceBinding: structuredClone(binding) });
  runToCheckpoint(retainedLegacyCase, { actor: 'owner', idempotencyKey: 'sentinel-legacy-retained-context' });
  assert.equal(retainedLegacyCase.artifacts.context.sentinelContext.blueprintSnapshotHash, binding.integrityContext.blueprintSnapshotHash,
    'a genuine retained historical snapshot hash is reused without changing the v1 seal');
  const retainedSentinelEvidence = retainedLegacyCase.evidenceLedger.find((entry) => entry.id === retainedLegacyCase.artifacts.context.sentinelAssessmentEvidenceRef);
  assert.ok(retainedSentinelEvidence.provenanceChain.includes(`blueprint-snapshot:sha256:${binding.integrityContext.blueprintSnapshotHash}`));
  delete binding.integrityContext;
  binding.bindingHash = digest({ projectId: binding.projectId, projectVersion: binding.projectVersion,
    blueprintId: binding.blueprintId, blueprintVersion: binding.blueprintVersion,
    blueprintSchemaVersion: binding.blueprintSchemaVersion, objectId: binding.objectId,
    objectType: binding.objectType, sourceHash: binding.sourceHash });
  assert.equal(verifySourceBinding(binding).valid, true);
  const legacyCase = createChangeCase({ mode: 'golden', projectId: project.id }, { sourceBinding: binding });
  runToCheckpoint(legacyCase, { actor: 'owner', idempotencyKey: 'sentinel-legacy-context' });
  assert.equal(legacyCase.artifacts.context.sentinelContext.state, 'NOT_ASSESSED_LEGACY');
  assert.equal(legacyCase.artifacts.context.sentinelContext.blueprintSnapshotHash, null, 'no source snapshot hash is invented when historical binding omitted it');
  assert.equal(legacyCase.artifacts.context.sentinelContext.legacyBindingHash, binding.bindingHash);
  const sentinelEvidence = legacyCase.evidenceLedger.find((entry) => entry.id === legacyCase.artifacts.context.sentinelAssessmentEvidenceRef);
  assert.ok(sentinelEvidence.provenanceChain.includes('blueprint-snapshot:unavailable:legacy-binding-has-no-retained-blueprint-hash'));
  assert.ok(sentinelEvidence.provenanceChain.includes(`legacy-binding:sha256:${binding.bindingHash}`));
  assert.equal(sentinelEvidence.provenanceChain.some((entry) => entry.startsWith('blueprint-snapshot:sha256:')), false);
  assert.equal(verifyContextManifest(legacyCase).valid, true);
  const historicalManifest = structuredClone(legacyCase);
  historicalManifest.artifacts.context.manifestVersion = 1;
  delete historicalManifest.artifacts.context.savedProjectPin;
  delete historicalManifest.artifacts.context.savedProjectCoverage;
  const creationRef = historicalManifest.artifacts.context.contextCreationEvidenceRef;
  delete historicalManifest.artifacts.context.contextCreationEvidenceRef;
  historicalManifest.artifacts.context.evidenceRefs = historicalManifest.artifacts.context.evidenceRefs.filter((ref) => ref !== creationRef);
  historicalManifest.artifacts.context.evidenceManifest = historicalManifest.artifacts.context.evidenceManifest.filter((entry) => entry.evidenceRef !== creationRef);
  historicalManifest.evidenceLedger = historicalManifest.evidenceLedger.filter((entry) => entry.id !== creationRef);
  historicalManifest.artifacts.context.provenanceManifestHash = digest(Object.fromEntries(Object.entries(historicalManifest.artifacts.context)
    .filter(([key]) => key !== 'provenanceManifestHash')));
  assert.equal(verifyContextManifest(historicalManifest).valid, true, 'historical source-bound manifest v1 without the new pin remains verifiable');
});
