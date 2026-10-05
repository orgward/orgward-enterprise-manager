import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../../server.mjs';
import { addConversationTurn, createProject, editBlueprintObject, latestBlueprint } from '../../src/model.mjs';
import { digest } from '../../src/sdlc/contracts.mjs';
import { applyEnterpriseIntegrityCommand } from '../../src/enterprise/integrity.mjs';
import { eligibleActorBindings } from '../../public/sdlc-view.mjs';

async function start(root) {
  const app = createApp({ dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

async function close(server) { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

async function request(base, route, options = {}, expected = 200) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}

test('SDLC client selects and renders eligible actor bindings from the API data envelope', () => {
  const response = { schemaVersion: '1.0', data: { proposals: [
    { id: 'human-current', targetType: 'human', status: 'enabled', eligibilityStatus: 'eligible', blueprintVersion: 7 },
    { id: 'agent-current', targetType: 'agent', status: 'enabled', eligibilityStatus: 'eligible', blueprintVersion: 7 },
    { id: 'human-pending', targetType: 'human', status: 'proposed', eligibilityStatus: 'eligible', blueprintVersion: 7 },
    { id: 'human-stale', targetType: 'human', status: 'enabled', eligibilityStatus: 'eligible', blueprintVersion: 6 },
    { id: 'human-ineligible', targetType: 'human', status: 'enabled', eligibilityStatus: 'membership-missing', blueprintVersion: 7 },
  ] }, meta: { correlationId: 'test' } };
  const renderedBindings = eligibleActorBindings(response, 7);
  assert.deepEqual(renderedBindings.map((binding) => binding.id), ['human-current', 'agent-current']);
});

test('SDLC API persists and resumes a golden case across process restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'api-run-1' }) });
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.currentStage, 'S9');
  const id = changeCase.id;
  const version = changeCase.version;
  await close(app.server);

  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.currentStage, 'S9');
  assert.ok(changeCase.traceability.nodes.some((node) => node.type === 'ChangeSet'));
  assert.ok(changeCase.evidenceIntegrity.every((entry) => entry.valid));
});

test('SDLC case pins a saved design source, rejects stale or unresolved selections, and retains provenance after project edits and restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-source-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  const project = createProject('Saved source binding');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  delete project.version;
  project.tenantId = 'tenant-reference-bank';
  await app.store.save(project);
  const normalizedLegacyProject = await request(app.base, `/api/v1/projects/${project.id}`);
  assert.equal(normalizedLegacyProject.data.version, 1);
  const blueprint = latestBlueprint(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'information');
  assert.ok(source);
  const selection = {
    mode: 'golden', projectId: project.id, sourceObjectId: source.id,
    expectedProjectVersion: 1, expectedBlueprintId: blueprint.id,
    expectedBlueprintVersion: blueprint.version,
    // This client snapshot is deliberately false; the server must resolve saved state.
    sourceBinding: { snapshot: { id: source.id, name: 'forged client snapshot' }, sourceHash: 'forged' },
    rawIntent: 'Change the saved information object while preserving its current meaning.',
  };
  const before = (await request(app.base, '/api/sdlc/cases')).cases.length;
  const nullBody = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: 'null' }, 400);
  const arrayBody = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: '[]' }, 400);
  assert.match(nullBody.error, /JSON object/);
  assert.match(arrayBody.error, /JSON object/);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ ...selection, sourceObjectId: 'missing-object' }) }, 404);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ ...selection, expectedProjectVersion: 0 }) }, 409);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ ...selection, expectedBlueprintVersion: blueprint.version - 1 }) }, 409);
  await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ projectId: project.id, mode: 'golden' }) }, 400);
  assert.equal((await request(app.base, '/api/sdlc/cases')).cases.length, before);

  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify(selection) }, 201);
  assert.equal(changeCase.sourceBinding.snapshot.name, source.name);
  assert.notEqual(changeCase.sourceBinding.snapshot.name, 'forged client snapshot');
  assert.equal(changeCase.sourceBinding.sourceHash.length, 64);
  assert.equal(changeCase.sourceBinding.blueprintSchemaVersion, 1);
  assert.equal(changeCase.sourceBindingIntegrity.valid, true);
  assert.equal(changeCase.contextManifestIntegrity, null, 'the context manifest is reported after context discovery runs');
  assert.equal(changeCase.sourceBinding.integrityContext.state, 'NOT_ASSESSED');
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'source-pin-run' }) });
  assert.ok(changeCase.artifacts.context.sourceBindingEvidenceRef);
  assert.ok(changeCase.artifacts.context.evidenceRefs.includes(changeCase.artifacts.context.sourceBindingEvidenceRef));
  assert.equal(changeCase.evidenceLedger.find((entry) => entry.id === changeCase.artifacts.context.sourceBindingEvidenceRef).authority, 'SAVED_PROJECT_DESIGN');
  assert.equal(changeCase.artifacts.context.integrityContext.state, 'NOT_ASSESSED');
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  const requestedImpact = changeCase.artifacts.impact.impacts.find((entry) => entry.isRequestedSource);
  assert.equal(requestedImpact.objectRef, source.id);
  assert.equal(requestedImpact.sourceHash, changeCase.sourceBinding.sourceHash);
  assert.match(requestedImpact.reason, /saved-design/);
  assert.equal(changeCase.enterpriseSnapshot.sourceKind, 'synthetic-reference-model');
  const originalPin = structuredClone(changeCase.sourceBinding);

  const editedProject = await app.store.get(project.id, project.tenantId);
  const target = Object.values(latestBlueprint(editedProject).areas).flatMap((area) => area.items).find((item) => item.id === source.id);
  editBlueprintObject(editedProject, { objectId: target.id, name: target.name, detail: `${target.detail} Updated after case creation.` }, 'test-owner');
  assert.equal(latestBlueprint(editedProject).blueprintSchemaVersion, 1);
  editedProject.version = (editedProject.version ?? 1) + 1;
  await app.store.save(editedProject);
  const caseId = changeCase.id;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  const latestProject = await request(app.base, `/api/projects/${project.id}`);
  assert.equal(latestProject.version, 2);
  assert.match(Object.values(latestBlueprint(latestProject).areas).flatMap((area) => area.items).find((item) => item.id === source.id).detail, /Updated after case creation/);
  assert.deepEqual(changeCase.sourceBinding, originalPin);
  assert.equal(changeCase.sourceBindingIntegrity.valid, true);
  assert.equal(changeCase.artifacts.context.sourceBindingHash, originalPin.sourceHash);
  assert.deepEqual(changeCase.artifacts.context.integrityContext, originalPin.integrityContext);
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.ok(changeCase.artifacts.context.evidenceRefs.includes(changeCase.artifacts.context.sourceBindingEvidenceRef));
  assert.equal(changeCase.artifacts.impact.impacts.find((entry) => entry.isRequestedSource).sourceHash, originalPin.sourceHash);

  const beforeStaleAction = { version: changeCase.version, events: structuredClone(changeCase.events), artifacts: structuredClone(changeCase.artifacts) };
  const staleAction = await request(app.base, `/api/sdlc/cases/${caseId}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'stale-pin-run' }),
  }, 409);
  assert.match(staleAction.error, /older saved design/);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(changeCase.version, beforeStaleAction.version);
  assert.deepEqual(changeCase.events, beforeStaleAction.events);
  assert.deepEqual(changeCase.artifacts, beforeStaleAction.artifacts);

  const tampered = await app.sdlcStore.get(caseId);
  tampered.sourceBinding.snapshot.detail = 'Tampered persisted source';
  await app.sdlcStore.save(tampered);
  changeCase = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(changeCase.sourceBindingIntegrity.valid, false);
  const invalidAction = await request(app.base, `/api/sdlc/cases/${caseId}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'invalid-pin-advance' }),
  }, 409);
  assert.match(invalidAction.error, /integrity check/);
  const unchangedTampered = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(unchangedTampered.version, changeCase.version);
  assert.deepEqual(unchangedTampered.events, changeCase.events);
});

test('SDLC source binding freezes the exact matching integrity report through restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-integrity-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const project = createProject('Design with integrity assessment');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  const blueprint = latestBlueprint(project);
  const snapshotHash = digest(blueprint);
  applyEnterpriseIntegrityCommand(project, { kind: 'run-integrity-checks', blueprintId: blueprint.id,
    blueprintVersion: blueprint.version, snapshotHash, reason: 'Pin the reviewed saved design.' }, 'test-owner');
  project.version = 1;
  await app.store.save(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'information');
  const changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: source.id,
    expectedProjectVersion: project.version, expectedBlueprintId: blueprint.id,
    expectedBlueprintVersion: blueprint.version,
  }) }, 201);
  const report = project.enterpriseIntegrityAssessments[0];
  assert.deepEqual(changeCase.sourceBinding.integrityContext, {
    state: 'ASSESSED', blueprintSnapshotHash: snapshotHash,
    assessment: { id: report.id, reportHash: report.reportHash, status: report.status, createdAt: report.createdAt },
  });
  const runCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, { method: 'POST', body: JSON.stringify({
    version: changeCase.version, actor: 'orchestrator', idempotencyKey: 'integrity-pin-run',
  }) });
  assert.deepEqual(runCase.artifacts.context.integrityContext, changeCase.sourceBinding.integrityContext);
  assert.ok(runCase.artifacts.context.evidenceRefs.includes(runCase.artifacts.context.integrityAssessmentEvidenceRef));
  const pinnedReport = runCase.evidenceLedger.find((entry) => entry.id === runCase.artifacts.context.integrityAssessmentEvidenceRef);
  assert.equal(pinnedReport.content.assessment.reportHash, report.reportHash);
  const caseId = changeCase.id;
  await close(app.server);
  app = await start(root);
  const reloaded = await request(app.base, `/api/sdlc/cases/${caseId}`);
  assert.equal(reloaded.sourceBindingIntegrity.valid, true);
  assert.deepEqual(reloaded.sourceBinding.integrityContext, changeCase.sourceBinding.integrityContext);
  assert.deepEqual(reloaded.artifacts.context.integrityContext, changeCase.sourceBinding.integrityContext);
});

test('source-bound requirements are revisioned, validated, owner-accepted and integrity-bound across restart', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-requirements-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  t.after(async () => { if (app.server.listening) await close(app.server); });
  const project = createProject('Requirements source');
  for (const answer of [
    'A membership that reduces restaurant equipment downtime.',
    'Independent restaurant owners need clear maintenance records.',
    'Monthly membership funds preventive service.',
    'Owners approve safety critical work.',
  ]) addConversationTurn(project, answer);
  project.version = 1;
  project.tenantId = 'tenant-reference-bank';
  await app.store.save(project);
  const blueprint = latestBlueprint(project);
  const source = Object.values(blueprint.areas).flatMap((area) => area.items).find((item) => item.type === 'information');
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({
    mode: 'golden', projectId: project.id, sourceObjectId: source.id, expectedProjectVersion: project.version,
    expectedBlueprintId: blueprint.id, expectedBlueprintVersion: blueprint.version,
  }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/run`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'requirements-to-g4' }),
  });
  assert.equal(changeCase.currentStage, 'S4');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  const artifact = changeCase.artifacts.requirements;
  assert.equal(artifact.draftRevision, 1);
  assert.equal(artifact.acceptedBaseline, undefined);
  assert.equal(artifact.requirements[0].rationale.startsWith('Synthetic reference template'), true);
  assert.deepEqual(artifact.requirements[0].sourceLinks, [
    { type: 'INTENT', ref: changeCase.intent.id },
    { type: 'SAVED_DESIGN_OBJECT', ref: source.id, hash: changeCase.sourceBinding.sourceHash },
  ]);
  const editable = artifact.requirements[0];
  const patch = { statement: 'Members submit an ownership update through the saved service.', actor: 'Member administrator' };
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 1, requirementId: editable.id, changes: patch, idempotencyKey: 'requirements-edit-1' }),
  });
  assert.equal(changeCase.artifacts.requirements.draftRevision, 2);
  assert.equal(changeCase.artifacts.requirements.draftHistory[0].actor, 'local-studio-user');
  assert.equal(changeCase.artifacts.requirements.requirements[0].statement, patch.statement);
  const replayedEdit = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 1, requirementId: editable.id, changes: patch, idempotencyKey: 'requirements-edit-1' }),
  });
  assert.equal(replayedEdit.command.replayed, true);
  assert.equal(replayedEdit.artifacts.requirements.draftRevision, 2);
  const beforeStaleEdit = structuredClone(changeCase);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 1, requirementId: editable.id, changes: { rationale: 'Stale edit.' }, idempotencyKey: 'requirements-edit-stale' }),
  }, 409);
  let unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.version, beforeStaleEdit.version);
  assert.deepEqual(unchanged.events, beforeStaleEdit.events);
  const denied = await request(app.base, `/api/sdlc/cases/${changeCase.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: unchanged.version, expectedDraftRevision: 2, actor: 'other-owner', idempotencyKey: 'requirements-accept-denied' }),
  }, 403);
  assert.match(denied.error, /Only the case owner/);
  unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.artifacts.requirements.acceptedBaseline, undefined);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: unchanged.version, expectedDraftRevision: 2, requirementId: editable.id, changes: { statement: '' }, idempotencyKey: 'requirements-edit-invalid' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 3, actor: changeCase.accountableOwner, idempotencyKey: 'requirements-accept-invalid' }),
  }, 409);
  unchanged = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(unchanged.artifacts.requirements.acceptedBaseline, undefined);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: unchanged.version, expectedDraftRevision: 3, requirementId: editable.id, changes: { statement: patch.statement }, idempotencyKey: 'requirements-edit-fix-invalid' }),
  });
  const accepted = await request(app.base, `/api/sdlc/cases/${changeCase.id}/accept-requirements`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: 4, actor: changeCase.accountableOwner, idempotencyKey: 'requirements-accept-1' }),
  });
  assert.equal(accepted.currentStage, 'S5');
  assert.equal(accepted.gateHistory.at(-1).gate, 'G4');
  const baseline = accepted.artifacts.requirements.acceptedBaseline;
  assert.equal(baseline.draftRevision, 4);
  assert.equal(baseline.intentHash.length, 64);
  assert.equal(baseline.sourceHash, accepted.sourceBinding.sourceHash);
  assert.equal(baseline.requirements[0].status, 'ACCEPTED');
  assert.equal(accepted.artifacts.requirements.requirements[0].status, 'ACCEPTED');
  assert.equal(accepted.contextManifestIntegrity.valid, true);
  assert.equal(accepted.artifacts.context.manifestRevision, 2);
  assert.equal(accepted.artifacts.context.relevantRequirements.contentHash, baseline.contentHash);
  assert.deepEqual(accepted.artifacts.context.relevantRequirements.requirements, baseline.requirements);
  assert.ok(accepted.artifacts.context.evidenceRefs.includes(accepted.artifacts.context.relevantRequirements.evidenceRef));
  await request(app.base, `/api/sdlc/cases/${accepted.id}/edit-requirements`, {
    method: 'POST', body: JSON.stringify({ version: accepted.version, expectedDraftRevision: 4, requirementId: editable.id, changes: { statement: 'Late edit.' }, idempotencyKey: 'requirements-edit-after-accept' }),
  }, 409);
  const acceptedId = accepted.id;
  await close(app.server);
  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  assert.deepEqual(changeCase.artifacts.requirements.acceptedBaseline, baseline);
  assert.equal(changeCase.contextManifestIntegrity.valid, true);
  assert.equal(changeCase.artifacts.context.relevantRequirements.contentHash, baseline.contentHash);
  assert.equal(changeCase.events.some((event) => event.type === 'RequirementBaselineAccepted'), true);
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'requirements-valid-g5' }),
  });
  assert.equal(changeCase.currentStage, 'S5');
  assert.equal(changeCase.status, 'NEEDS_HUMAN');
  assert.equal(changeCase.gateHistory.at(-1).status, 'NEEDS_HUMAN');
  const architecture = changeCase.artifacts.architecture;
  assert.equal(architecture.options.length, 2);
  assert.ok(architecture.options.every((option) => option.id && option.migration.length >= 2 && option.healthCriteria.length));
  assert.equal(architecture.requirementsBaselineHash, baseline.contentHash);
  assert.equal(architecture.sourceHash, changeCase.sourceBinding.sourceHash);
  assert.equal(architecture.intentHash.length, 64);
  assert.equal(architecture.draftHash.length, 64);
  const selectedOption = architecture.options[0];
  const fitnessCases = [
    [{ dataOwnership: 'The portal performs a direct database write into Party MDM.' }, 'ARCHITECTURE_CROSS_SYSTEM_WRITE', { dataOwnership: 'Party MDM remains authoritative; the portal writes through its owned API.' }],
    [{ dataOwnership: 'The request path skips authorization and approval.' }, 'ARCHITECTURE_AUTHORITY_BYPASS', { dataOwnership: 'Party MDM remains authoritative; IAM and owner approval authorize writes through its API.' }],
    [{ migration: [{ step: 1, action: 'Drop and replace the existing schema immediately.', healthCheck: 'Deployment completes.' }, { step: 2, action: 'Add backward compatibility and reconciliation after replacement.', healthCheck: 'Consumers now coexist.' }, ...selectedOption.migration.slice(2)] }, 'ARCHITECTURE_MIGRATION_INCOMPATIBLE', { migration: selectedOption.migration }],
  ];
  for (const [unsafeChanges, findingCode, repairChanges] of fitnessCases) {
    changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, optionId: selectedOption.id, changes: unsafeChanges, idempotencyKey: `architecture-${findingCode.toLowerCase()}-edit` }),
    });
    assert.ok(changeCase.artifacts.architecture.validationFindings.some((entry) => entry.code === findingCode), findingCode);
    await request(app.base, `/api/sdlc/cases/${acceptedId}/accept-architecture`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, actor: changeCase.accountableOwner, idempotencyKey: `architecture-${findingCode.toLowerCase()}-denied` }),
    }, 409);
    changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
      method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, optionId: selectedOption.id, changes: repairChanges, idempotencyKey: `architecture-${findingCode.toLowerCase()}-repair` }),
    });
    assert.equal(changeCase.artifacts.architecture.validationFindings.some((entry) => entry.code === findingCode), false);
  }
  const beforeOwnerDenial = structuredClone(changeCase);
  await request(app.base, `/api/sdlc/cases/${acceptedId}/accept-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, actor: 'not-the-owner', idempotencyKey: 'architecture-owner-denial' }),
  }, 403);
  let unchangedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  assert.equal(unchangedArchitecture.version, beforeOwnerDenial.version);
  assert.deepEqual(unchangedArchitecture.events, beforeOwnerDenial.events);
  const edit = { selectedOptionId: architecture.options[1].id, selectionRationale: 'The selected synchronous option fits the accepted latency requirement and has an explicit reconciliation path.' };
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: changeCase.artifacts.architecture.draftRevision, changes: edit, idempotencyKey: 'architecture-edit-1' }),
  });
  const selectedDraftRevision = changeCase.artifacts.architecture.draftRevision;
  const replayedArchitectureEdit = await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: selectedDraftRevision - 1, changes: edit, idempotencyKey: 'architecture-edit-1' }),
  });
  assert.equal(replayedArchitectureEdit.command.replayed, true);
  assert.equal(replayedArchitectureEdit.artifacts.architecture.draftRevision, selectedDraftRevision);
  await request(app.base, `/api/sdlc/cases/${acceptedId}/edit-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: selectedDraftRevision - 1, changes: { selectionRationale: 'stale edit' }, idempotencyKey: 'architecture-edit-stale' }),
  }, 409);
  changeCase = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  const acceptedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}/accept-architecture`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, expectedDraftRevision: selectedDraftRevision, actor: changeCase.accountableOwner, idempotencyKey: 'architecture-accept-1' }),
  });
  assert.equal(acceptedArchitecture.currentStage, 'S6');
  assert.equal(acceptedArchitecture.gateHistory.at(-1).gate, 'G5');
  assert.equal(acceptedArchitecture.gateHistory.at(-1).status, 'PASSED');
  const architectureBaseline = acceptedArchitecture.artifacts.architecture.acceptedBaseline;
  assert.equal(architectureBaseline.selectedOptionId, architecture.options[1].id);
  assert.equal(architectureBaseline.requirementsBaselineHash, baseline.contentHash);
  assert.equal(architectureBaseline.sourceHash, acceptedArchitecture.sourceBinding.sourceHash);
  assert.equal(architectureBaseline.intentHash.length, 64);
  assert.deepEqual(acceptedArchitecture.artifacts.architecture.decisions[0].requirementsSatisfied, baseline.requirements.map((entry) => entry.id));
  const persistedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}`);
  assert.deepEqual(persistedArchitecture.artifacts.architecture.acceptedBaseline, architectureBaseline);
  assert.equal(persistedArchitecture.events.some((event) => event.type === 'ArchitectureBaselineAccepted'), true);
  const tampered = await app.sdlcStore.get(acceptedId);
  tampered.artifacts.architecture.acceptedBaseline.draftHash = '0'.repeat(64);
  await app.sdlcStore.save(tampered);
  const blockedArchitecture = await request(app.base, `/api/sdlc/cases/${acceptedId}/advance`, {
    method: 'POST', body: JSON.stringify({ version: tampered.version, idempotencyKey: 'architecture-tamper-g6' }),
  });
  assert.equal(blockedArchitecture.currentStage, 'S6');
  assert.equal(blockedArchitecture.status, 'BLOCKED');
  assert.ok(blockedArchitecture.gateHistory.at(-1).findings.some((entry) => entry.code === 'ACCEPTED_ARCHITECTURE_INVALID'));
});

test('SDLC API enforces optimistic concurrency, authority, isolation, and immutable action replay', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const tenantA = { 'x-orgward-tenant': 'tenant-a' }; const tenantB = { 'x-orgward-tenant': 'tenant-b' };
  let first = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantA, body: JSON.stringify({ mode: 'golden', tenantId: 'attempted-body-override' }) }, 201);
  const second = await request(app.base, '/api/sdlc/cases', { method: 'POST', headers: tenantB, body: JSON.stringify({ mode: 'golden' }) }, 201);
  assert.notEqual(first.id, second.id);
  assert.equal(first.tenantId, 'tenant-a');
  first = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: 0, idempotencyKey: 'stale' }) }, 409);
  const replay = await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once' }) });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, first.version);
  await request(app.base, `/api/sdlc/cases/${first.id}/advance`, { method: 'POST', headers: tenantA, body: JSON.stringify({ version: first.version, idempotencyKey: 'advance-once', actor: 'different-actor' }) }, 409);
  const listingA = await request(app.base, '/api/sdlc/cases', { headers: tenantA });
  const listingB = await request(app.base, '/api/sdlc/cases', { headers: tenantB });
  assert.deepEqual(listingA.cases.map((entry) => entry.tenantId), ['tenant-a']);
  assert.deepEqual(listingB.cases.map((entry) => entry.tenantId), ['tenant-b']);
  await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantA }, 404);
  assert.equal((await request(app.base, `/api/sdlc/cases/${second.id}`, { headers: tenantB })).tenantId, 'tenant-b');
});

test('authenticated SDLC routes fail closed when principal-scoped store methods are unavailable', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-scope-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let unscopedCalls = 0;
  const changeCaseStore = {
    async init() {},
    async list() { unscopedCalls += 1; return []; },
    async listWithDiagnostics() { unscopedCalls += 1; return { records: [], corruptRecords: 0 }; },
    async get() { unscopedCalls += 1; return null; },
    async getForPrincipal() { unscopedCalls += 1; return null; },
    async save() { unscopedCalls += 1; },
  };
  const identity = { tenantId: 'tenant-a', principal: 'principal-a', roles: ['workspace-write'], actorType: 'human' };
  const app = createApp({
    dataDirectory: path.join(root, 'blueprints'), sdlcDirectory: path.join(root, 'sdlc'),
    changeCaseStore,
    oidcAuthenticator: { async authenticate() { return identity; } },
    oidcSessionStore: {
      async get() { return null; },
      async resolve() { return { ...identity, authzGeneration: 1 }; },
    },
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => close(app.server));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { authorization: 'Bearer signed-by-test', 'content-type': 'application/json' };
  const id = 'change-case-00000000-0000-4000-8000-000000000000';
  const assertDenied = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
    const body = await response.json();
    assert.equal(response.status, 503, JSON.stringify(body));
    assert.match(body.error, /cannot enforce principal-scoped access/i);
  };

  await assertDenied('/api/sdlc/cases');
  await assertDenied(`/api/sdlc/cases/${id}`);
  await assertDenied(`/api/sdlc/cases/${id}/traceability`);
  await assertDenied('/api/sdlc/cases', {
    method: 'POST', body: JSON.stringify({ projectId: 'project-00000000-0000-4000-8000-000000000000', mode: 'golden' }),
  });
  await assertDenied(`/api/sdlc/cases/${id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: 0 }),
  });
  const foundationResponse = await fetch(`${base}/api/v1/foundation`, { headers });
  const foundation = await foundationResponse.json();
  assert.equal(foundationResponse.status, 200);
  assert.equal(foundation.data.sources.changeCases.status, 'unavailable');
  assert.equal(unscopedCalls, 0);
});

test('served SDLC product surface and meta contract expose stages and mutation lab', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const meta = await request(app.base, '/api/sdlc/meta');
  assert.equal(meta.stages.length, 12);
  assert.equal(meta.mutations.missing_aml.expectedGate, 'G1');
  const response = await fetch(`${app.base}/sdlc.html`);
  assert.equal(response.status, 200);
  const markup = await response.text();
  assert.match(markup, /Synthetic SDLC reference/i);
  assert.match(markup, /Saved design object/);
  assert.match(markup, /Synthetic reference condition/);
  const [styles, script] = await Promise.all([
    fetch(`${app.base}/sdlc.css`).then((entry) => entry.text()),
    fetch(`${app.base}/sdlc.js`).then((entry) => entry.text()),
  ]);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /scroll-snap-type:\s*x proximity/);
  assert.match(script, /crypto\?\.randomUUID\?\.\(\)/);
  assert.match(script, /expectedProjectVersion/);
  assert.match(script, /if \(detail\.data\?\.id === changeCase\.projectId\) activeSourceProject = detail\.data/);
  assert.match(script, /if \(selectionId !== caseSelectionId\) return;[\s\S]*?state\.activeSourceProject = activeSourceProject/);
  assert.match(script, /api\(`\/api\/v1\/projects\/\$\{encodeURIComponent\(changeCase\.projectId\)\}`\)/);
  assert.match(script, /caseUiModel\(changeCase, state\.meta, state\.activeSourceProject\)/);
  assert.match(script, /Pinned saved-design evidence/);
  assert.match(script, /requirement-edit-disclosure/);
  assert.match(script, /text: `Edit \$\{requirement\.id\}`/);
  assert.match(script, /aria-label': `\$\{requirement\.id\} actor`/);
  assert.match(script, /Comparable target architecture alternatives/);
  assert.match(script, /Accept architecture and pass G5/);
  assert.match(script, /Rollback \/ forward recovery/);
  assert.match(script, /Compile software delivery draft/);
  assert.match(script, /text: task\.g6WorkItemId/);
  assert.match(script, /Engine task ID \$\{task\.id\}/);
  assert.match(script, /taskById\.get\(dependencyId\)\?\.g6WorkItemId/);
  assert.match(script, /PROPOSED DRAFT · No owner-reviewed assignment snapshot yet/);
  assert.match(script, /OWNER REVIEWED · Revision/);
  assert.match(script, /Save owner review snapshot/);
  assert.match(script, /assignment-review/);
  assert.match(script, /eligibleActorBindings\(bindings, changeCase\.sourceBinding\.blueprintVersion\)/,
    'the client parses enabled, eligible bindings from the API response envelope');
  assert.match(script, /state\.actorBindings\.some\(\(binding\) => binding\.targetType === 'human'\)/,
    'assignment guidance appears when eligible bindings do not include a human');
  assert.match(script, /No eligible human actor binding is enabled for this blueprint[\s\S]*?sign in if needed[\s\S]*?verified identity to this project’s membership[\s\S]*?In the map, choose the correct human actor and role[\s\S]*?propose and enable its binding[\s\S]*?changes the project revision[\s\S]*?create a new governed change case from the updated design before compiling/,
    'owner copy explains enrollment, map binding selection, and the new-case requirement after the source revision changes');
  assert.match(script, /encodeStudioRoute\(\{ projectId: changeCase\.projectId, view: 'map' \}\)/,
    'the contextual project map link selects no actor and only navigates to the existing map route');
  assert.match(script, /Open this project’s Enterprise design map/,
    'the owner is told to choose the correct actor and role in the linked project map');
  assert.match(script, /href: '\/platform\.html#administration'/,
    'the enrollment guidance links to the existing Administration view');
  assert.match(script, /Save revised owner review snapshot/);
  assert.match(script, /expectedReviewRevision/);
  assert.match(script, /not executable/);
  assert.match(script, /pendingSoftwareStartKey/);
  assert.match(script, /software-runtime-start\.mjs/);
  assert.match(script, /Promote human checkpoint plan/);
  assert.match(script, /Start human checkpoint instance/);
  assert.match(script, /Immutable human checkpoint revision/);
  assert.match(script, /Agent tasks need the separate PR-08 software output contract/);
  assert.match(script, /\/compile-software-plan/);
  assert.match(styles, /requirement-edit-disclosure > summary:focus-visible/);
  assert.match(styles, /architecture-option > summary:focus-visible/);
  const startHelper = await fetch(`${app.base}/software-runtime-start.mjs`);
  assert.equal(startHelper.status, 200);
  assert.match(await startHelper.text(), /createSoftwareStartFlightGuard/);
});

test('clarification survives restart and reconciles through the API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-clarification-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Is payment part of this release?', targetField: 'nonGoals' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: 0, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Is payment part of this release?', targetField: 'nonGoals' }),
  });
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: 0, idempotencyKey: 'open-api-question', actor: 'studio-operator', question: 'Different question', targetField: 'nonGoals' }),
  }, 409);
  const questionRef = changeCase.clarifications[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/answer-clarification`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'answer-api-question', actor: 'actor-accountable-owner', questionRef, answer: 'Payment is outside this release.' }),
  });
  const { id, version } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.equal(changeCase.clarifications[0].status, 'ANSWERED');
  assert.deepEqual(changeCase.intent.nonGoals, []);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/reconcile-clarification`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'reconcile-api-question', actor: 'actor-accountable-owner', questionRef }),
  });
  assert.equal(changeCase.clarifications[0].status, 'RECONCILED');
  assert.deepEqual(changeCase.intent.nonGoals, ['Payment is outside this release.']);
  assert.equal(changeCase.intent.revision, 2);
});

test('simultaneous clarification writes use persisted compare-and-swap', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  const changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  const submit = (key, question) => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: key, actor: 'studio-operator', question, targetField: 'nonGoals' }),
  });
  const responses = await Promise.all([submit('race-a', 'Is payment included?'), submit('race-b', 'Is invoicing included?')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.version, 1);
  assert.equal(saved.clarifications.length, 1);
});

test('proof results persist across restart and acceptance is derived by the API', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-proofs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-register-proof', actor: 'designer', criterion: 'The intent can be reconstructed after restart.', evaluatorType: 'DETERMINISTIC', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-invalid-proof', actor: 'test-runner', proofRef, status: 'GREEN', summary: 'Invalid client status.' }),
  }, 400);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-record-proof', actor: 'test-runner', proofRef, status: 'PASS', summary: 'Reloaded state matches the saved revision.', observations: ['Intent revision and content hash matched after restart.'] }),
  });
  const { id } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.proofs.results[0].status, 'PASS');
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/assess-proofs`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'api-assess-proofs', actor: 'controller', accepted: false }),
  });
  assert.equal(changeCase.proofs.assessments.at(-1).phase, 'ACCEPTED');
  assert.equal(changeCase.proofs.assessments.at(-1).accepted, true);
});

test('proof action routing persists across restart and preserves the failed result', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-proof', actor: 'designer', criterion: 'The bounded workflow succeeds.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-fail', actor: 'runner', proofRef, status: 'FAIL', summary: 'The implementation is incomplete.', observations: ['The expected response was absent.'] }),
  });
  const failedResult = structuredClone(changeCase.proofs.results[0]);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'route-api-replan', actor: 'studio-operator', proofRef, resultRef: failedResult.id, action: 'REPLAN', reason: 'Add the missing work to the plan.' }),
  });
  assert.deepEqual(changeCase.proofs.results, [failedResult]);
  assert.equal(changeCase.proofs.actions[0].action, 'REPLAN');
  const { id, version } = changeCase;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.version, version);
  assert.deepEqual(changeCase.proofs.results, [failedResult]);
  assert.equal(changeCase.proofs.actions[0].status, 'READY');
});

test('a terminal proof stop blocks later API mutations while replay remains safe', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'stop-api-proof', actor: 'designer', criterion: 'The outcome is feasible.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'stop-api-result', actor: 'runner', proofRef, status: 'INDETERMINATE', summary: 'Feasibility cannot be established.', observations: ['The required dependency is unavailable.'] }),
  });
  const stopCommand = { version: changeCase.version, idempotencyKey: 'stop-api-route', actor: changeCase.accountableOwner, proofRef, resultRef: changeCase.proofs.results[0].id, action: 'STOP', reason: 'The owner stopped infeasible work.' };
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, { method: 'POST', body: JSON.stringify(stopCommand) });
  assert.equal(changeCase.status, 'STOPPED');
  const replay = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, { method: 'POST', body: JSON.stringify(stopCommand) });
  assert.equal(replay.command.replayed, true);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/advance`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'advance-after-stop', actor: 'orchestrator' }),
  }, 409);
  await request(app.base, `/api/sdlc/cases/${changeCase.id}/clarify`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'clarify-after-stop', actor: 'studio-operator', question: 'Can scope change?', targetField: 'nonGoals' }),
  }, 409);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.version, changeCase.version);
  assert.equal(saved.events.at(-1).type, 'ProofActionRouted');
});

test('a pending proof action resumes once after restart without chat history', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await start(root);
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-proof', actor: 'designer', criterion: 'The queued repair resumes once.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-result', actor: 'runner', proofRef, status: 'FAIL', summary: 'Repair is required.', observations: ['The expected result is absent.'] }),
  });
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-api-route', actor: 'studio-operator', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'REPAIR', reason: 'Queue a bounded repair.' }),
  });
  const action = changeCase.proofs.actions[0];
  const id = changeCase.id;
  assert.equal(action.status, 'READY');
  await close(app.server);

  app = await start(root);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  assert.equal(changeCase.proofs.actions[0].status, 'READY');
  assert.equal(changeCase.workspace.nextAllowedAction.type, 'RESUME_PROOF_ACTION');
  assert.equal(changeCase.workspace.failedResults[0].id, changeCase.proofs.results[0].id);
  changeCase = await request(app.base, `/api/sdlc/cases/${id}/resume-proof-action`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'resume-after-restart', actor: action.owner, actionRef: action.id }),
  });
  assert.equal(changeCase.proofs.actions[0].status, 'IN_PROGRESS');
  assert.equal(changeCase.proofs.loopCounters[proofRef], 1);
  assert.equal(changeCase.workspace.nextAllowedAction.type, 'COMPLETE_PROOF_ACTION');
  const resumedVersion = changeCase.version;
  await close(app.server);

  app = await start(root); t.after(() => close(app.server));
  changeCase = await request(app.base, `/api/sdlc/cases/${id}`);
  const replay = await request(app.base, `/api/sdlc/cases/${id}/resume-proof-action`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'different-key-after-second-restart', actor: action.owner, actionRef: action.id }),
  });
  assert.equal(replay.command.replayed, true);
  assert.equal(replay.version, resumedVersion);
  assert.equal(replay.proofs.loopCounters[proofRef], 1);
  assert.equal(replay.events.filter((entry) => entry.type === 'ProofActionResumed').length, 1);
});

test('simultaneous pending-action claims persist exactly one attempt', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'orgward-sdlc-resume-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await start(root); t.after(() => close(app.server));
  let changeCase = await request(app.base, '/api/sdlc/cases', { method: 'POST', body: JSON.stringify({ mode: 'golden' }) }, 201);
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/register-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-proof', actor: 'designer', criterion: 'Only one worker claims the repair.', required: true }),
  });
  const proofRef = changeCase.proofs.obligations[0].id;
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/record-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-result', actor: 'runner', proofRef, status: 'FAIL', summary: 'A repair is pending.', observations: ['The result failed.'] }),
  });
  changeCase = await request(app.base, `/api/sdlc/cases/${changeCase.id}/route-proof`, {
    method: 'POST', body: JSON.stringify({ version: changeCase.version, idempotencyKey: 'race-resume-route', actor: 'studio-operator', proofRef, resultRef: changeCase.proofs.results[0].id, action: 'REPAIR', reason: 'Queue one repair.' }),
  });
  const action = changeCase.proofs.actions[0];
  const claim = (key) => fetch(`${app.base}/api/sdlc/cases/${changeCase.id}/resume-proof-action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: changeCase.version, idempotencyKey: key, actor: action.owner, actionRef: action.id }),
  });
  const responses = await Promise.all([claim('race-resume-a'), claim('race-resume-b')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const saved = await request(app.base, `/api/sdlc/cases/${changeCase.id}`);
  assert.equal(saved.proofs.actions[0].status, 'IN_PROGRESS');
  assert.equal(saved.proofs.loopCounters[proofRef], 1);
  assert.equal(saved.events.filter((entry) => entry.type === 'ProofActionResumed').length, 1);
});
