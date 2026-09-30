import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedProcessTaskResult, modelAttemptEvidencePresentation, modelUsagePresentation } from '../../public/linked-process-task-result.mjs';

const projectId = 'project-01234567-89ab-cdef-0123-456789abcdef';
const runtime = {
  projectId, processPlanId: 'process-plan-one', revision: 4,
  planInstanceId: 'instance-one', taskId: 'task-one', executionRunId: 'run-one',
};
const proposalProject = (events = [], overrides = {}) => ({ id: projectId, events, ...overrides });

function modelProposalRun(overrides = {}) {
  const ref = { ...linkedRun().processTaskRef, blueprintId: 'blueprint-one', blueprintVersion: 3 };
  const source = { id: 'source-one', type: 'information', name: 'Customer signal', detail: 'Useful input', provenance: [], hash: 'a'.repeat(64) };
  const context = {
    sourceEnvelope: { blueprintId: 'blueprint-one', blueprintVersion: 3, sources: [source] },
    sourceEnvelopeHash: 'b'.repeat(64),
    target: { id: 'target-one', type: 'information', name: 'Prioritised need', field: 'detail', before: 'Before' },
  };
  const proposal = {
    id: 'proposal-one', runId: 'run-one', projectId, blueprintId: 'blueprint-one', blueprintVersion: 3,
    processTaskRef: ref, target: context.target, proposedDetail: 'After', rationale: 'é'.repeat(200),
    citations: [{ id: source.id, type: source.type, name: source.name, hash: source.hash }],
    sourceEnvelope: context.sourceEnvelope, sourceEnvelopeHash: context.sourceEnvelopeHash,
    provider: { provider: 'openai', model: 'fixture' },
    evaluation: { evaluatorVersion: 1, rubricVersion: 1, meaning: 'structural-checks-only', status: 'passed',
      runId: 'run-one', blueprintId: 'blueprint-one', blueprintVersion: 3, sourceEnvelopeHash: context.sourceEnvelopeHash,
      targetHash: 'c'.repeat(64), provider: { provider: 'openai', model: 'fixture' }, proposalCoreHash: 'd'.repeat(64),
      checks: ['proposed-detail-changes-target', 'rationale-bounded-and-nonempty', 'citations-resolve-to-pinned-source-hashes']
        .map((id) => ({ id, status: 'passed', message: 'Structural check passed.' })) },
    proposalHash: 'e'.repeat(64), status: 'proposed',
  };
  return linkedRun({ profile: { kind: 'provider-openai' }, processTaskRef: ref,
    workItem: { proposalContext: context }, execution: { stdout: JSON.stringify({ private: 'provider-json-canary' }), generatedProposal: proposal }, ...overrides });
}

const linkedRun = (overrides = {}) => ({
  id: 'run-one', projectId, status: 'SUCCEEDED',
  processTaskRef: {
    processPlanId: 'process-plan-one', revision: 4,
    planInstanceId: 'instance-one', taskId: 'task-one',
  },
  execution: { stdout: 'Saved result', changedArtifacts: [{}], evidenceHash: 'a'.repeat(64) },
  ...overrides,
});

test('linked process task result requires exact project, run and process-task linkage', () => {
  assert.equal(linkedProcessTaskResult(runtime, null), null);
  assert.equal(linkedProcessTaskResult(runtime, []), null);
  assert.equal(linkedProcessTaskResult(null, linkedRun()), null);
  assert.equal(linkedProcessTaskResult(runtime, linkedRun({ projectId: 'project-two' })), null);
  assert.equal(linkedProcessTaskResult(runtime, linkedRun({ id: 'run-two' })), null);
  assert.equal(linkedProcessTaskResult({ ...runtime, executionRunId: 'run-two' }, linkedRun()), null);

  for (const [key, value] of [
    ['processPlanId', 'process-plan-two'], ['revision', 5],
    ['planInstanceId', 'instance-two'], ['taskId', 'task-two'],
  ]) {
    assert.equal(linkedProcessTaskResult(runtime, linkedRun({ processTaskRef: {
      ...linkedRun().processTaskRef, [key]: value,
    } })), null, `${key} mismatch is rejected`);
  }
  assert.equal(linkedProcessTaskResult(runtime, linkedRun({ processTaskRef: null })), null);
  assert.equal(linkedProcessTaskResult(runtime, linkedRun({ status: 'RUNNING' })), null);
  const missingBoth = { ...runtime, processPlanId: undefined };
  assert.equal(linkedProcessTaskResult(missingBoth, linkedRun({ processTaskRef: {
    ...linkedRun().processTaskRef, processPlanId: undefined,
  } })), null);
  assert.equal(linkedProcessTaskResult({ ...runtime, revision: '4' }, linkedRun()), null);
});

test('saved result disclosure label reports the validated status and bounded artifact count', () => {
  const summary = (count) => linkedProcessTaskResult(runtime, linkedRun({ execution: {
    changedArtifacts: Array.from({ length: count }, () => ({})),
  } })).summaryLabel;
  assert.equal(summary(0), 'Saved result: Succeeded · 0 artifacts');
  assert.equal(summary(1), 'Saved result: Succeeded · 1 artifact');
  assert.equal(summary(3), 'Saved result: Succeeded · 3 artifacts');
  assert.equal(summary(101), 'Saved result: Succeeded · 100+ artifacts');
});

test('model usage presentation shows validated counts and truthful missing, invalid, and reserved states', () => {
  assert.deepEqual(modelUsagePresentation({
    status: 'reported', inputTokens: 128, outputTokens: 64, totalTokens: 192,
  }), {
    status: 'reported',
    label: 'Reported model usage: 128 input tokens, 64 output tokens, 192 total tokens. Cost is unknown; no tenant-budget compliance claim is made.',
  });
  assert.equal(modelUsagePresentation({ status: 'unreported', reason: 'usage_missing' }).label,
    'The provider did not report token usage; input, output, and total counts are unavailable. Cost is unknown; no tenant-budget compliance claim is made.');
  assert.equal(modelUsagePresentation({ status: 'unreported', reason: 'usage_invalid' }).label,
    'The provider returned invalid usage metadata; token counts are unavailable. Cost is unknown; no tenant-budget compliance claim is made.');
  assert.equal(modelUsagePresentation({ status: 'unreported', reason: 'dispatch_not_started' }).label,
    'Provider dispatch did not start; no model usage was reported. Cost is unknown; no tenant-budget compliance claim is made.');
  assert.equal(modelUsagePresentation({ status: 'reserved' }).label,
    'Provider dispatch outcome is uncertain; token usage remains unreported and cost is unknown. This attempt remains recorded; no tenant-budget compliance claim is made.');
  for (const invalid of [
    { status: 'reported', inputTokens: 128, outputTokens: 64, totalTokens: 193 },
    { status: 'reported', inputTokens: -1, outputTokens: 64, totalTokens: 63 },
    { status: 'reported', inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, totalTokens: Number.MAX_SAFE_INTEGER },
    { status: 'unreported', reason: 'provider-secret-detail' },
  ]) {
    assert.equal(modelUsagePresentation(invalid).status, 'unavailable');
    assert.doesNotMatch(modelUsagePresentation(invalid).label, /provider-secret-detail/);
  }
  assert.equal(modelUsagePresentation(null), null);
});

test('model attempt evidence presentation exposes bounded secret-free limits and outcome', () => {
  const evidence = {
    provider: 'deepseek', model: 'fixture-model', profileRevision: 'tenant-deepseek-r2',
    promptBytes: 1200, promptByteCeiling: 16_384, requestedOutputTokens: 128,
    timeoutMs: 20_000, toolCount: 0, usageStatus: 'reported', costStatus: 'unknown',
  };
  assert.deepEqual(modelAttemptEvidencePresentation(evidence), {
    status: 'reported',
    label: 'Model request: deepseek/fixture-model · profile tenant-deepseek-r2 · prompt 1200/16384 bytes · output cap 128 tokens · timeout 20000 ms · tools 0 · token usage reported · cost unknown.',
  });
  assert.match(modelAttemptEvidencePresentation({ ...evidence, usageStatus: 'outcome_unknown' }).label,
    /provider outcome unknown; usage unresolved/);
  assert.match(modelAttemptEvidencePresentation({ ...evidence, usageStatus: 'unreported', usageReason: 'usage_missing' }).label,
    /token usage unreported \(usage_missing\)/);
  const openAiEvidence = { ...evidence, provider: 'openai', model: 'gpt-fixture', requestedOutputTokens: 2_000 };
  assert.match(modelAttemptEvidencePresentation(openAiEvidence).label, /output cap 2000 tokens/);
  for (const invalid of [
    { ...evidence, promptBytes: 16_385 }, { ...evidence, toolCount: 1 },
    { ...evidence, model: 'fixture-model', credential: 'secret-canary' },
    { ...evidence, usageStatus: 'unreported', usageReason: 'secret-canary' },
  ]) {
    assert.equal(modelAttemptEvidencePresentation(invalid).status, 'unavailable');
    assert.doesNotMatch(modelAttemptEvidencePresentation(invalid).label, /secret-canary/);
  }
  assert.equal(modelAttemptEvidencePresentation(null), null);
});

test('successful saved outputs are previewed within a bound and expose only artifact/evidence metadata', () => {
  const output = `local result ${'x'.repeat(350)}`;
  const result = linkedProcessTaskResult(runtime, linkedRun({
    execution: { stdout: output, changedArtifacts: Array.from({ length: 105 }, (_, index) => ({
      path: `nested/artifact_${index}.txt`, contentHash: 'b'.repeat(64),
    })), evidenceHash: 'b'.repeat(64) },
  }));
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.statusLabel, 'Succeeded');
  assert.equal(result.summaryLabel, 'Saved result: Succeeded · 100+ artifacts');
  assert.equal(result.outputPreview.length, 281);
  assert.equal(result.outputPreview.endsWith('…'), true);
  assert.equal(result.artifactCount, 100);
  assert.equal(result.artifactsCapped, true);
  assert.equal(result.artifacts.length, 10);
  assert.deepEqual(result.artifacts[0], {
    relativePath: 'nested/artifact_0.txt', displayName: 'artifact_0.txt', hashPrefix: 'b'.repeat(18),
  });
  assert.equal(result.artifactLinksCapped, true);
  assert.equal(result.evidenceHash, 'b'.repeat(18));
  assert.equal(Object.hasOwn(result, 'error'), false);
});

test('saved model proposal is projected only when its pinned context and structure match', () => {
  const valid = linkedProcessTaskResult(runtime, modelProposalRun(), proposalProject());
  assert.equal(valid.outputPreview, null, 'raw provider JSON is suppressed for model proposals');
  assert.deepEqual(valid.proposalPreview, {
    kind: 'proposal', label: 'Review-only proposed update. Applying it is a separate versioned owner action.',
    applicationStatus: 'review-only',
    target: 'Prioritised need · detail', proposedDetail: 'After', rationale: 'é'.repeat(200),
    citations: [{ name: 'Customer signal', type: 'information' }], evaluation: 'passed',
  });
  const withUsage = modelProposalRun();
  withUsage.execution.generatedProposal.modelUsage = {
    status: 'reported', inputTokens: 100, outputTokens: 40, totalTokens: 140,
  };
  assert.equal(linkedProcessTaskResult(runtime, withUsage, proposalProject()).proposalPreview.kind, 'proposal');
  withUsage.execution.generatedProposal.modelUsage.totalTokens = 141;
  assert.equal(linkedProcessTaskResult(runtime, withUsage, proposalProject()).proposalPreview.kind, 'unavailable',
    'malformed usage does not make an invalid persisted proposal look reviewable');
  for (const invalidUsage of [
    { status: 'reserved' },
    { status: 'unreported', reason: 'dispatch_not_started' },
  ]) {
    withUsage.execution.generatedProposal.modelUsage = invalidUsage;
    assert.equal(linkedProcessTaskResult(runtime, withUsage, proposalProject()).proposalPreview.kind, 'unavailable');
  }
  const blocked = modelProposalRun();
  blocked.execution.generatedProposal.evaluation.status = 'blocked';
  blocked.execution.generatedProposal.evaluation.checks[0].status = 'blocked';
  const blockedResult = linkedProcessTaskResult(runtime, blocked);
  assert.equal(blockedResult.proposalPreview.kind, 'proposal');
  assert.equal(blockedResult.proposalPreview.evaluation, 'blocked');
  for (const invalidRun of [
    modelProposalRun({ execution: { stdout: 'private-provider-json-canary' } }),
    modelProposalRun({ execution: { stdout: 'private-provider-json-canary', generatedProposal: { status: 'proposed', proposalHash: 'CANARY' } } }),
    modelProposalRun({ execution: { stdout: 'private-provider-json-canary', generatedProposal: {
      ...modelProposalRun().execution.generatedProposal, target: { ...modelProposalRun().execution.generatedProposal.target, before: 'forged' },
    } } }),
    modelProposalRun({ execution: { stdout: 'private-provider-json-canary', generatedProposal: {
      ...modelProposalRun().execution.generatedProposal, citations: [{ id: 'source-one', name: 'private-citation-canary', type: 'information', hash: 'f'.repeat(64) }],
    } } }),
    modelProposalRun({ execution: { stdout: 'private-provider-json-canary', generatedProposal: {
      ...modelProposalRun().execution.generatedProposal,
      citations: [...modelProposalRun().execution.generatedProposal.citations, ...modelProposalRun().execution.generatedProposal.citations],
    } } }),
    modelProposalRun({ workItem: { proposalContext: {
      ...modelProposalRun().workItem.proposalContext,
      sourceEnvelope: { ...modelProposalRun().workItem.proposalContext.sourceEnvelope, sources: [{
        ...modelProposalRun().workItem.proposalContext.sourceEnvelope.sources[0], detail: 'x'.repeat(4097),
      }] },
    } } }),
  ]) {
    const result = linkedProcessTaskResult(runtime, invalidRun);
    assert.equal(result.proposalPreview.kind, 'unavailable');
    assert.equal(result.outputPreview, null);
    assert.equal(JSON.stringify(result).includes('canary'), false);
  }
  const ordinary = linkedProcessTaskResult(runtime, linkedRun({ status: 'SUCCEEDED', execution: { stdout: 'ordinary output' } }));
  assert.equal(ordinary.proposalPreview, null);
  assert.equal(ordinary.outputPreview, 'ordinary output');
});

test('saved task proposal shows applied state only for an exact project, run, proposal hash and version event', () => {
  const run = modelProposalRun();
  const proposalHash = run.execution.generatedProposal.proposalHash;
  const event = { type: 'BlueprintProposalApplied', data: {
    runId: run.id, proposalHash, appliedBlueprintVersion: 7, objectId: run.execution.generatedProposal.target.id,
  } };
  const designProject = proposalProject([event], {
    latestBlueprint: { version: 7 }, graph: { nodes: [{ id: run.execution.generatedProposal.target.id }] },
  });
  const applied = linkedProcessTaskResult(runtime, run, designProject);
  assert.equal(applied.proposalPreview.applicationStatus, 'applied');
  assert.equal(applied.proposalPreview.appliedBlueprintVersion, 7);
  assert.equal(applied.proposalPreview.label,
    'Applied to proposed blueprint v7. This created a proposed design version; it did not execute work.');
  assert.deepEqual(applied.proposalPreview.designLink, {
    href: `/?project=${projectId}&view=map&selected=target-one`, label: 'Open updated design',
  });

  for (const mismatchedEvent of [
    { ...event, data: { ...event.data, runId: 'another-run' } },
    { ...event, data: { ...event.data, proposalHash: 'f'.repeat(64) } },
    { ...event, data: { ...event.data, appliedBlueprintVersion: 0 } },
    { ...event, data: { ...event.data, appliedBlueprintVersion: '7' } },
  ]) {
    const result = linkedProcessTaskResult(runtime, run, proposalProject([mismatchedEvent]));
    assert.equal(result.proposalPreview.applicationStatus, 'review-only');
    assert.match(result.proposalPreview.label, /Review-only proposed update/);
    assert.equal(Object.hasOwn(result.proposalPreview, 'appliedBlueprintVersion'), false);
  }
  const wrongProject = linkedProcessTaskResult(runtime, run, proposalProject([event], { id: 'project-two' }));
  assert.equal(wrongProject.proposalPreview.applicationStatus, 'unavailable');
  assert.match(wrongProject.proposalPreview.label, /Application status unavailable/);
  assert.equal(Object.hasOwn(wrongProject.proposalPreview, 'designLink'), false);
  const noProject = linkedProcessTaskResult(runtime, run);
  assert.equal(noProject.proposalPreview.applicationStatus, 'unavailable');
});

test('applied task-result link selects only its exact target in the current graph and otherwise opens current design', () => {
  const run = modelProposalRun();
  const proposalHash = run.execution.generatedProposal.proposalHash;
  const event = { type: 'BlueprintProposalApplied', data: {
    runId: run.id, proposalHash, appliedBlueprintVersion: 7, objectId: 'target-one',
  } };
  const currentRoute = `/?project=${projectId}`;
  const missingObject = linkedProcessTaskResult(runtime, run, proposalProject([event], {
    latestBlueprint: { version: 7 }, graph: { nodes: [{ id: 'another-node' }] },
  }));
  assert.equal(missingObject.proposalPreview.applicationStatus, 'applied');
  assert.deepEqual(missingObject.proposalPreview.designLink, { href: currentRoute, label: 'Open current design' });

  const forgedObject = linkedProcessTaskResult(runtime, run, proposalProject([{
    ...event, data: { ...event.data, objectId: 'another-node' },
  }], {
    latestBlueprint: { version: 7 }, graph: { nodes: [{ id: 'another-node' }] },
  }));
  assert.deepEqual(forgedObject.proposalPreview.designLink, { href: currentRoute, label: 'Open current design' },
    'an event object that differs from the generated proposal target cannot be selected');

  const laterCurrentDesign = linkedProcessTaskResult(runtime, run, proposalProject([event], {
    latestBlueprint: { version: 8 }, graph: { nodes: [{ id: 'target-one' }] },
  }));
  assert.deepEqual(laterCurrentDesign.proposalPreview.designLink, {
    href: `/?project=${projectId}&view=map&selected=target-one`, label: 'Open current design',
  }, 'a later current blueprint is never labeled as the older applied version');
});

test('linked artifact links reject unsafe paths and hashes and sanitize bounded display names', () => {
  const result = linkedProcessTaskResult(runtime, linkedRun({
    execution: {
      changedArtifacts: [
        { path: '/workspace/private.txt', contentHash: 'a'.repeat(64) },
        { path: '../private.txt', contentHash: 'a'.repeat(64) },
        { path: 'C:/workspace/private.txt', contentHash: 'a'.repeat(64) },
        { path: 'reports/bad\nname.txt', contentHash: 'a'.repeat(64) },
        { path: 'reports/no-hash.txt', contentHash: 'bad' },
        { path: `reports/${'<script>alert(1)</script>'.repeat(8)}.txt`, contentHash: 'c'.repeat(64) },
      ],
    },
  }));
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].relativePath.startsWith('/'), false);
  assert.equal(result.artifacts[0].displayName.includes('<'), false);
  assert.equal(result.artifacts[0].displayName.includes('>'), false);
  assert.ok(result.artifacts[0].displayName.length <= 101);
  assert.equal(result.artifacts[0].hashPrefix, 'c'.repeat(18));
  assert.equal(JSON.stringify(result).includes('/workspace/private.txt'), false);
});

test('failed and outcome-unknown runs never preview output or raw error and only show the safe DeepSeek diagnostic', () => {
  const bodyCanary = 'private-provider-body-canary';
  const errorCanary = 'private-raw-error-canary';
  const result = linkedProcessTaskResult(runtime, linkedRun({
    status: 'FAILED',
    execution: {
      stdout: bodyCanary, error: errorCanary, changedArtifacts: [], evidenceHash: null,
      providerDiagnostic: { provider: 'deepseek', httpStatus: 503, body: bodyCanary, requestId: errorCanary },
    },
  }));
  assert.deepEqual(result, {
    status: 'FAILED', statusLabel: 'Failed', summaryLabel: 'Saved result: Failed · 0 artifacts', outputPreview: null, proposalPreview: null, outputTruncated: false,
    artifactCount: 0, artifactsCapped: false, artifacts: [], artifactLinksCapped: false, evidenceHash: null,
    providerDiagnostic: null,
    diagnostic: 'DeepSeek returned HTTP 503. Delivery remains unverified; this run cannot be retried.',
    failureGuidance: { category: null, nextStep: 'The run failed without a recognized failure category. Open the linked run for available evidence before deciding how to continue.' },
  });
  assert.equal(JSON.stringify(result).includes(bodyCanary), false);
  assert.equal(JSON.stringify(result).includes(errorCanary), false);

  const unknownWithoutHttpResponse = linkedProcessTaskResult(runtime, linkedRun({
    status: 'FAILED', execution: { stdout: bodyCanary, error: errorCanary },
  }));
  assert.equal(unknownWithoutHttpResponse.outputPreview, null);
  assert.equal(unknownWithoutHttpResponse.diagnostic, null);
  assert.equal(JSON.stringify(unknownWithoutHttpResponse).includes(errorCanary), false);
});

test('restart-loaded API-shaped linked run produces the same saved result summary', () => {
  const restoredRuntime = JSON.parse(JSON.stringify(runtime));
  const restoredRun = JSON.parse(JSON.stringify(linkedRun()));
  assert.deepEqual(linkedProcessTaskResult(restoredRuntime, restoredRun), linkedProcessTaskResult(runtime, linkedRun()));
});

test('durable outcome-unknown marker is shown on linked failed task without exposing diagnostics', () => {
  const canary = 'secret-provider-request-body-or-id';
  const result = linkedProcessTaskResult(runtime, linkedRun({ status: 'FAILED', execution: {
    stdout: canary, error: canary, providerDiagnostic: { outcome: 'outcome_unknown', requestId: canary, body: canary },
  } }));
  assert.deepEqual(result.providerDiagnostic, { outcome: 'outcome_unknown' });
  assert.equal(result.diagnostic, 'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(JSON.stringify(result).includes(canary), false);
  const ordinaryFailure = linkedProcessTaskResult(runtime, linkedRun({ status: 'FAILED', execution: { error: canary } }));
  assert.equal(ordinaryFailure.providerDiagnostic, null);
  assert.equal(ordinaryFailure.diagnostic, null);

  const interrupted = linkedProcessTaskResult(runtime, linkedRun({ status: 'INTERRUPTED', execution: {
    error: canary, providerDiagnostic: { outcome: 'outcome_unknown', requestId: canary, body: canary },
  } }));
  assert.deepEqual(interrupted.providerDiagnostic, { outcome: 'outcome_unknown' });
  assert.match(interrupted.diagnostic, /^Outcome unknown\./);
  assert.equal(JSON.stringify(interrupted).includes(canary), false);
  const ordinaryInterruption = linkedProcessTaskResult(runtime, linkedRun({ status: 'INTERRUPTED', execution: { error: canary } }));
  assert.equal(ordinaryInterruption.providerDiagnostic, null);
  assert.equal(ordinaryInterruption.diagnostic, null);
  const successfulWithUntrustedMarker = linkedProcessTaskResult(runtime, linkedRun({ status: 'SUCCEEDED', execution: {
    providerDiagnostic: { outcome: 'outcome_unknown' }, stdout: 'success',
  } }));
  assert.equal(successfulWithUntrustedMarker.providerDiagnostic, null);
  assert.equal(successfulWithUntrustedMarker.diagnostic, null);
});

test('allowlisted failed and interrupted outcome guidance survives restart-shaped runs without exposing raw details', () => {
  const canary = 'private-error-stdout-stderr-provider-code-canary';
  const cases = [
    ['FAILED', 'command_failed', 'The configured command did not produce a verified result. Review the linked run evidence before starting a new process instance.'],
    ['FAILED', 'verification_failed', 'Local verification did not pass or changed the candidate. Review the verification evidence before starting a new process instance.'],
    ['FAILED', 'provider_failed', 'The configured model request failed. Review the linked run and profile or credential configuration before requesting new work.'],
    ['INTERRUPTED', 'authorization_changed', 'Execution authorization changed while this work was running. Have an authorized project owner review access before continuing.'],
    ['INTERRUPTED', 'credential_changed', 'The bound credential changed during execution. Ask an administrator to confirm the current binding before requesting a new run.'],
    ['INTERRUPTED', 'approval_stale', 'The approved request became stale before completion. Review the run history and obtain fresh independent approval before continuing.'],
    ['INTERRUPTED', 'worker_recovery', 'The worker stopped before a verified result was saved. Review activity and artifacts before starting a distinct process instance.'],
    ['INTERRUPTED', 'outcome_unverified', 'Delivery could not be verified. Reconcile whether the work took effect before requesting another run.'],
  ];
  for (const [status, category, nextStep] of cases) {
    const profile = category === 'provider_failed' ? { kind: 'provider-openai' } : { kind: 'command' };
    const restoredRun = JSON.parse(JSON.stringify(linkedRun({
      status, profile, linkedOutcomeCategory: category,
      execution: { error: canary, stdout: canary, stderr: canary, providerDiagnostic: { body: canary, requestId: canary } },
    })));
    const result = linkedProcessTaskResult(JSON.parse(JSON.stringify(runtime)), restoredRun);
    assert.deepEqual(result.failureGuidance, { category, nextStep });
    assert.equal(result.outputPreview, null);
    assert.equal(JSON.stringify(result).includes(canary), false);
  }
  const unknown = linkedProcessTaskResult(runtime, linkedRun({ status: 'FAILED', linkedOutcomeCategory: 'PRIVATE_UNKNOWN_CODE' }));
  assert.deepEqual(unknown.failureGuidance, {
    category: null,
    nextStep: 'The run failed without a recognized failure category. Open the linked run for available evidence before deciding how to continue.',
  });
  for (const category of ['toString', 'constructor', '__proto__']) {
    const unrecognizedPrototypeKey = linkedProcessTaskResult(runtime, linkedRun({
      status: 'FAILED', linkedOutcomeCategory: category,
    }));
    assert.deepEqual(unrecognizedPrototypeKey.failureGuidance, unknown.failureGuidance,
      `${category} cannot inherit a non-guidance property from the lookup map`);
  }
  const unlinked = linkedProcessTaskResult(runtime, linkedRun({ processTaskRef: null, linkedOutcomeCategory: 'command_failed' }));
  assert.equal(unlinked, null);
});

test('outcome-unknown provider diagnostic keeps precedence over generic next-step guidance', () => {
  const result = linkedProcessTaskResult(runtime, linkedRun({ status: 'FAILED', linkedOutcomeCategory: 'outcome_unverified', execution: {
    error: 'private canary', providerDiagnostic: { outcome: 'outcome_unknown', requestId: 'private canary', body: 'private canary' },
  } }));
  assert.equal(result.diagnostic, 'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(result.failureGuidance.category, 'outcome_unverified');
  assert.equal(JSON.stringify(result).includes('private canary'), false);
});

test('restart-loaded linked result retains only safe persisted DeepSeek outcome details', () => {
  const canary = 'raw-body-request-id-message-canary';
  const restoredRun = JSON.parse(JSON.stringify(linkedRun({ status: 'FAILED', execution: {
    providerDiagnostic: { outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 503,
      parserFailureClass: 'invalid_json', transportFailureClass: 'transport_timeout',
      body: canary, requestId: canary, message: canary, code: canary },
  } })));
  const result = linkedProcessTaskResult(JSON.parse(JSON.stringify(runtime)), restoredRun);
  assert.deepEqual(result.providerDiagnostic, { outcome: 'outcome_unknown', provider: 'deepseek',
    httpStatus: 503, parserFailureClass: 'invalid_json', transportFailureClass: 'transport_timeout' });
  assert.equal(result.diagnostic, 'Outcome unknown. DeepSeek returned HTTP 503; response parsing failed (invalid JSON); DeepSeek request timed out. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(JSON.stringify(result).includes(canary), false);

  const invalid = linkedProcessTaskResult(runtime, linkedRun({ status: 'FAILED', execution: {
    providerDiagnostic: { outcome: 'outcome_unknown', provider: 'openai', httpStatus: 503,
      parserFailureClass: 'invalid_json', body: canary, requestId: canary },
  } }));
  assert.deepEqual(invalid.providerDiagnostic, { outcome: 'outcome_unknown' });
  assert.equal(invalid.diagnostic, 'Outcome unknown. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(JSON.stringify(invalid).includes(canary), false);
});

test('restart-loaded linked task with HTTP 401 guides an admin without exposing provider response details', () => {
  const canary = 'private-401-body-request-id-canary';
  const restoredRun = JSON.parse(JSON.stringify(linkedRun({ status: 'FAILED', execution: {
    providerDiagnostic: { outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 401,
      body: canary, requestId: canary, message: canary },
  } })));
  const result = linkedProcessTaskResult(JSON.parse(JSON.stringify(runtime)), restoredRun);
  assert.deepEqual(result.providerDiagnostic, { outcome: 'outcome_unknown', provider: 'deepseek', httpStatus: 401 });
  assert.equal(result.diagnostic,
    'Outcome unknown. DeepSeek returned HTTP 401. An administrator should check and verify the saved provider credential; this status alone does not identify the cause. An external request may have been received. Delivery is unverified. Reconcile with the provider before retrying.');
  assert.equal(JSON.stringify(result).includes(canary), false);
});
