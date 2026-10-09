import { deepSeekOutcomeDiagnostic, deepSeekOutcomeDiagnosticCopy } from './provider-outcome-diagnostic.mjs';
import { proposalDesignLink } from './proposal-review-state.mjs';

const terminalStatuses = Object.freeze({
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  INTERRUPTED: 'Interrupted',
  CANCELLED: 'Cancelled',
});

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasExactKeys = (value, keys) => isRecord(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const MAX_ARTIFACTS = 100;
const MAX_ARTIFACT_LINKS = 10;
const MAX_ARTIFACT_PATH_LENGTH = 500;
const MAX_ARTIFACT_NAME_LENGTH = 100;
const MAX_PROPOSAL_TEXT = 700;
const SHA256 = /^[a-f0-9]{64}$/i;
const failureGuidanceByCategory = Object.freeze({
  command_failed: 'The configured command did not produce a verified result. Review the linked run evidence before starting a new process instance.',
  verification_failed: 'Local verification did not pass or changed the candidate. Review the verification evidence before starting a new process instance.',
  provider_failed: 'The configured model request failed. Review the linked run and profile or credential configuration before requesting new work.',
  approval_stale: 'The approved request became stale before completion. Review the run history and obtain fresh independent approval before continuing.',
  source_stale: 'The saved design advanced after this run was approved, so dispatch was stopped. Keep this run as history and start from a current process plan.',
  credential_changed: 'The bound credential changed during execution. Ask an administrator to confirm the current binding before requesting a new run.',
  authorization_changed: 'Execution authorization changed while this work was running. Have an authorized project owner review access before continuing.',
  worker_recovery: 'The worker stopped before a verified result was saved. Review activity and artifacts before starting a distinct process instance.',
  outcome_unverified: 'Delivery could not be verified. Reconcile whether the work took effect before requesting another run.',
});

function failureGuidance(status, category) {
  if (!['FAILED', 'INTERRUPTED'].includes(status)) return null;
  const recognizedCategory = typeof category === 'string' && Object.hasOwn(failureGuidanceByCategory, category);
  const label = recognizedCategory ? failureGuidanceByCategory[category] : (status === 'FAILED'
    ? 'The run failed without a recognized failure category. Open the linked run for available evidence before deciding how to continue.'
    : 'The run was interrupted without a recognized reason. Review its activity and evidence before deciding whether to start new work.');
  return { category: recognizedCategory ? category : null, nextStep: label };
}
const isBoundedText = (value, limit = MAX_PROPOSAL_TEXT, required = false) => typeof value === 'string'
  && new TextEncoder().encode(value).byteLength <= limit && (!required || Boolean(value.trim()));
const hasKeys = (value, keys) => isRecord(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const validModelUsage = (usage) => usage?.status === 'reported'
  ? Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
    && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    && Number.isSafeInteger(usage.totalTokens) && usage.totalTokens === usage.inputTokens + usage.outputTokens
  : usage?.status === 'unreported'
    && ['usage_missing', 'usage_invalid'].includes(usage.reason);

export function modelUsagePresentation(usage) {
  if (usage == null) return null;
  if (hasExactKeys(usage, ['status', 'inputTokens', 'outputTokens', 'totalTokens'])
    && usage.status === 'reported'
    && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0
    && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0
    && Number.isSafeInteger(usage.totalTokens)
    && usage.totalTokens === usage.inputTokens + usage.outputTokens) {
    return {
      status: 'reported',
      label: `Reported model usage: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens, ${usage.totalTokens} total tokens. Cost is unknown; no tenant-budget compliance claim is made.`,
    };
  }
  if (hasExactKeys(usage, ['status', 'reason']) && usage.status === 'unreported') {
    const messages = {
      usage_missing: 'The provider did not report token usage; input, output, and total counts are unavailable. Cost is unknown; no tenant-budget compliance claim is made.',
      usage_invalid: 'The provider returned invalid usage metadata; token counts are unavailable. Cost is unknown; no tenant-budget compliance claim is made.',
      dispatch_not_started: 'Provider dispatch did not start; no model usage was reported. Cost is unknown; no tenant-budget compliance claim is made.',
    };
    if (Object.hasOwn(messages, usage.reason)) return { status: 'unreported', label: messages[usage.reason] };
  }
  if (hasExactKeys(usage, ['status']) && usage.status === 'reserved') {
    return {
      status: 'reserved',
      label: 'Provider dispatch outcome is uncertain; token usage remains unreported and cost is unknown. This attempt remains recorded; no tenant-budget compliance claim is made.',
    };
  }
  return { status: 'unavailable', label: 'Saved model usage metadata could not be validated; token counts are unavailable.' };
}

export function modelAttemptEvidencePresentation(evidence) {
  if (evidence == null) return null;
  const maximumOutputTokens = evidence?.provider === 'deepseek' ? 512 : 2_000;
  const common = ['provider', 'model', 'profileRevision', 'promptBytes', 'promptByteCeiling',
    'requestedOutputTokens', 'timeoutMs', 'toolCount', 'usageStatus', 'costStatus'];
  const keys = evidence?.usageStatus === 'unreported' ? [...common, 'usageReason'] : common;
  if (!hasExactKeys(evidence, keys)
    || !['openai', 'deepseek'].includes(evidence.provider)
    || !isBoundedText(evidence.model, 120, true)
    || !isBoundedText(evidence.profileRevision, 80, true)
    || !Number.isSafeInteger(evidence.promptBytes) || evidence.promptBytes < 1 || evidence.promptBytes > 16_384
    || evidence.promptByteCeiling !== 16_384
    || !Number.isSafeInteger(evidence.requestedOutputTokens) || evidence.requestedOutputTokens < (evidence.provider === 'deepseek' ? 64 : 1) || evidence.requestedOutputTokens > maximumOutputTokens
    || !Number.isSafeInteger(evidence.timeoutMs) || evidence.timeoutMs < 1 || evidence.timeoutMs > 20_000
    || evidence.toolCount !== 0 || evidence.costStatus !== 'unknown'
    || !['reported', 'unreported', 'outcome_unknown'].includes(evidence.usageStatus)
    || (evidence.usageStatus === 'unreported' && !['usage_missing', 'usage_invalid'].includes(evidence.usageReason))) {
    return { status: 'unavailable', label: 'Saved model request limits could not be validated.' };
  }
  const usage = evidence.usageStatus === 'reported' ? 'token usage reported'
    : evidence.usageStatus === 'outcome_unknown' ? 'provider outcome unknown; usage unresolved'
      : `token usage unreported (${evidence.usageReason})`;
  return {
    status: evidence.usageStatus,
    label: `Model request: ${evidence.provider}/${evidence.model} · profile ${evidence.profileRevision} · prompt ${evidence.promptBytes}/${evidence.promptByteCeiling} bytes · output cap ${evidence.requestedOutputTokens} tokens · timeout ${evidence.timeoutMs} ms · tools ${evidence.toolCount} · ${usage} · cost unknown.`,
  };
}

function proposalReview(run, project) {
  if (!['provider-openai', 'provider-deepseek'].includes(run.profile?.kind)) return null;
  if (run.status !== 'SUCCEEDED') return null;
  const context = run.workItem?.proposalContext;
  const proposal = run.execution?.generatedProposal;
  const unavailable = { kind: 'unavailable', label: 'Structured proposal unavailable. Open the linked run for details.' };
  if (!isRecord(context) || !isRecord(context.sourceEnvelope) || !isRecord(context.target) || !isRecord(proposal)) return unavailable;
  const ref = run.processTaskRef;
  const expectedRefKeys = Object.keys(ref).sort().join(',');
  const proposalKeys = ['id', 'runId', 'projectId', 'blueprintId', 'blueprintVersion', 'processTaskRef', 'target',
    'proposedDetail', 'rationale', 'citations', 'sourceEnvelope', 'sourceEnvelopeHash', 'provider', 'evaluation', 'proposalHash', 'status',
    ...(Object.hasOwn(proposal, 'modelUsage') ? ['modelUsage'] : [])];
  if (!hasKeys(proposal, proposalKeys)
    || (Object.hasOwn(proposal, 'modelUsage') && !validModelUsage(proposal.modelUsage))
    || proposal.status !== 'proposed' || proposal.runId !== run.id || proposal.projectId !== run.projectId
    || proposal.blueprintId !== ref.blueprintId || proposal.blueprintVersion !== ref.blueprintVersion
    || !Number.isSafeInteger(proposal.blueprintVersion) || proposal.blueprintVersion < 1
    || !isRecord(proposal.processTaskRef) || Object.keys(proposal.processTaskRef).sort().join(',') !== expectedRefKeys
    || Object.keys(ref).some((key) => proposal.processTaskRef[key] !== ref[key])
    || !SHA256.test(proposal.proposalHash ?? '') || !SHA256.test(proposal.sourceEnvelopeHash ?? '')
    || proposal.sourceEnvelopeHash !== context.sourceEnvelopeHash
    || !isRecord(proposal.provider)
    || proposal.provider.provider !== (run.profile.kind === 'provider-deepseek' ? 'deepseek' : 'openai')
    || !isBoundedText(proposal.proposedDetail, 2800, true) || proposal.proposedDetail.trim().length > MAX_PROPOSAL_TEXT
    || !isBoundedText(proposal.rationale, 1600, true) || proposal.rationale.trim().length > 400
    || !hasKeys(context.target, ['id', 'type', 'name', 'field', 'before'])
    || !hasKeys(proposal.target, ['id', 'type', 'name', 'field', 'before'])
    || Object.keys(context.target).some((key) => proposal.target[key] !== context.target[key])
    || !hasKeys(context.sourceEnvelope, ['blueprintId', 'blueprintVersion', 'sources'])
    || context.sourceEnvelope.blueprintId !== ref.blueprintId || context.sourceEnvelope.blueprintVersion !== ref.blueprintVersion
    || !Array.isArray(context.sourceEnvelope.sources) || context.sourceEnvelope.sources.length < 1 || context.sourceEnvelope.sources.length > 8
    || !Array.isArray(proposal.sourceEnvelope?.sources)
    || !Array.isArray(proposal.citations) || proposal.citations.length < 1 || proposal.citations.length > 8
    || !hasKeys(proposal.evaluation, ['evaluatorVersion', 'rubricVersion', 'meaning', 'status', 'runId', 'blueprintId',
      'blueprintVersion', 'sourceEnvelopeHash', 'targetHash', 'provider', 'proposalCoreHash', 'checks'])) return unavailable;
  const evaluation = proposal.evaluation;
  if (evaluation.evaluatorVersion !== 1 || evaluation.rubricVersion !== 1
    || evaluation.meaning !== 'structural-checks-only' || !['passed', 'blocked'].includes(evaluation.status)
    || evaluation.runId !== run.id || evaluation.blueprintId !== ref.blueprintId
    || evaluation.blueprintVersion !== ref.blueprintVersion || evaluation.sourceEnvelopeHash !== context.sourceEnvelopeHash
    || !SHA256.test(evaluation.targetHash ?? '') || !SHA256.test(evaluation.proposalCoreHash ?? '')
    || !Array.isArray(evaluation.checks) || evaluation.checks.length !== 3
    || evaluation.checks.some((check) => !hasKeys(check, ['id', 'status', 'message'])
      || !['passed', 'blocked'].includes(check.status) || !isBoundedText(check.message, 300, true))) return unavailable;
  const checkIds = ['proposed-detail-changes-target', 'rationale-bounded-and-nonempty', 'citations-resolve-to-pinned-source-hashes'];
  if (evaluation.checks.some((check, index) => check.id !== checkIds[index])
    || evaluation.status !== (evaluation.checks.every((check) => check.status === 'passed') ? 'passed' : 'blocked')
    || !isBoundedText(proposal.target.id, 200, true) || proposal.target.type !== 'information'
    || !isBoundedText(proposal.target.name, 512, true) || proposal.target.field !== 'detail'
    || !isBoundedText(proposal.target.before, 4096)
    || !SHA256.test(context.sourceEnvelopeHash ?? '')
    || context.sourceEnvelope.sources.some((source) => !hasKeys(source, ['id', 'type', 'name', 'detail', 'provenance', 'hash'])
      || !isBoundedText(source.id, 200, true) || !isBoundedText(source.type, 80, true)
      || !isBoundedText(source.name, 512, true) || !isBoundedText(source.detail, 4096)
      || !SHA256.test(source.hash ?? '') || !Array.isArray(source.provenance) || source.provenance.length > 12
      || source.provenance.some((entry) => !isRecord(entry)
        || Object.keys(entry).some((key) => !['source', 'note', 'fields'].includes(key))
        || !Object.hasOwn(entry, 'source') || !Object.hasOwn(entry, 'note')
        || !isBoundedText(entry.source, 256) || !isBoundedText(entry.note, 1024)
        || (Object.hasOwn(entry, 'fields') && (!Array.isArray(entry.fields) || entry.fields.length > 12
          || entry.fields.some((field) => !isBoundedText(field, 512))))))) return unavailable;
  let contextBytes;
  let envelopeMatches;
  try {
    contextBytes = new TextEncoder().encode(JSON.stringify(context)).byteLength;
    envelopeMatches = JSON.stringify(proposal.sourceEnvelope) === JSON.stringify(context.sourceEnvelope);
  } catch { return unavailable; }
  if (contextBytes > 16 * 1024 || !envelopeMatches) return unavailable;
  const sourceById = new Map(context.sourceEnvelope.sources.filter(isRecord).map((source) => [source.id, source]));
  if (new Set(proposal.citations.map((citation) => citation?.id)).size !== proposal.citations.length
    || proposal.citations.some((citation) => !hasKeys(citation, ['id', 'type', 'name', 'hash'])
    || !SHA256.test(citation.hash ?? '') || !sourceById.has(citation.id)
    || sourceById.get(citation.id).type !== citation.type || sourceById.get(citation.id).name !== citation.name
    || sourceById.get(citation.id).hash !== citation.hash)) return unavailable;
  const applyEvent = project?.id === run.projectId && Array.isArray(project.events)
    ? project.events.find((event) => event?.type === 'BlueprintProposalApplied'
      && event.data?.runId === run.id && event.data?.proposalHash === proposal.proposalHash
      && Number.isSafeInteger(event.data?.appliedBlueprintVersion) && event.data.appliedBlueprintVersion >= 1)
    : null;
  const applicationStatus = applyEvent ? 'applied' : (project?.id === run.projectId ? 'review-only' : 'unavailable');
  const designLink = applyEvent ? proposalDesignLink(project, {
    status: 'applied',
    blueprintVersion: applyEvent.data.appliedBlueprintVersion,
    objectId: applyEvent.data.objectId === proposal.target.id ? proposal.target.id : null,
  }) : null;
  const applicationLabel = applyEvent
    ? `Applied to proposed blueprint v${applyEvent.data.appliedBlueprintVersion}. This created a proposed design version; it did not execute work.`
    : applicationStatus === 'review-only'
      ? 'Review-only proposed update. Applying it is a separate versioned owner action.'
      : 'Application status unavailable. Treat this as review-only until the current project design confirms its status.';
  return {
    kind: 'proposal',
    label: applicationLabel,
    applicationStatus,
    ...(applyEvent ? { appliedBlueprintVersion: applyEvent.data.appliedBlueprintVersion } : {}),
    ...(designLink ? { designLink } : {}),
    target: `${proposal.target.name} · ${proposal.target.field}`.slice(0, 520),
    proposedDetail: proposal.proposedDetail.slice(0, MAX_PROPOSAL_TEXT),
    rationale: proposal.rationale.slice(0, 400),
    citations: proposal.citations.map(({ name, type }) => ({ name: name.slice(0, 512), type: type.slice(0, 80) })),
    evaluation: evaluation.status === 'passed' ? 'passed' : 'blocked',
  };
}

function safeArtifact(value) {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path.length > MAX_ARTIFACT_PATH_LENGTH
    || !value.path || value.path.startsWith('/') || value.path.includes('\\') || value.path.includes('\0')
    || /^[a-z]:/i.test(value.path)) return null;
  const segments = value.path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(segment))) return null;
  if (typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.contentHash)) return null;
  const rawName = segments.at(-1);
  const safeName = rawName.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim() || 'artifact';
  const nameTruncated = safeName.length > MAX_ARTIFACT_NAME_LENGTH;
  return {
    relativePath: value.path,
    displayName: `${safeName.slice(0, MAX_ARTIFACT_NAME_LENGTH)}${nameTruncated ? '…' : ''}`,
    hashPrefix: value.contentHash.slice(0, 18),
  };
}

export function linkedProcessTaskResult(runtime, run, project = null) {
  if (!isRecord(runtime) || !isRecord(run) || !isRecord(run.processTaskRef)) return null;
  const reference = run.processTaskRef;
  const validId = (value) => typeof value === 'string' && value.trim().length > 0;
  if (typeof runtime.projectId !== 'string' || runtime.projectId.length === 0
    || typeof run.id !== 'string' || run.projectId !== runtime.projectId || run.id !== runtime.executionRunId
    || !validId(runtime.processPlanId) || !validId(reference.processPlanId)
    || runtime.processPlanId !== reference.processPlanId
    || !Number.isSafeInteger(runtime.revision) || runtime.revision < 1
    || runtime.revision !== reference.revision
    || !validId(runtime.planInstanceId) || !validId(reference.planInstanceId)
    || runtime.planInstanceId !== reference.planInstanceId
    || !validId(runtime.taskId) || !validId(reference.taskId)
    || runtime.taskId !== reference.taskId) return null;
  if (!Object.hasOwn(terminalStatuses, run.status)) return null;

  const execution = isRecord(run.execution) ? run.execution : {};
  const proposalPreview = proposalReview(run, project);
  const stdout = run.status === 'SUCCEEDED' && !proposalPreview && typeof execution.stdout === 'string' ? execution.stdout : '';
  const outputTruncated = stdout.length > 280;
  const previewText = stdout.slice(0, 280).trim();
  const outputPreview = previewText ? `${previewText}${outputTruncated ? '…' : ''}` : null;
  const changedArtifacts = Array.isArray(execution.changedArtifacts) ? execution.changedArtifacts : [];
  const artifacts = [];
  let validArtifactCount = 0;
  for (const candidate of changedArtifacts.slice(0, MAX_ARTIFACTS)) {
    const artifact = safeArtifact(candidate);
    if (!artifact) continue;
    validArtifactCount += 1;
    if (artifacts.length < MAX_ARTIFACT_LINKS) artifacts.push(artifact);
  }
  const evidenceHash = typeof execution.evidenceHash === 'string' && /^[a-f0-9]{64}$/i.test(execution.evidenceHash)
    ? execution.evidenceHash.slice(0, 18) : null;
  const guidance = failureGuidance(run.status, run.linkedOutcomeCategory);
  const artifactCount = Math.min(changedArtifacts.length, MAX_ARTIFACTS);
  const artifactCountLabel = changedArtifacts.length > MAX_ARTIFACTS ? '100+' : String(artifactCount);
  const summaryLabel = `Saved result: ${terminalStatuses[run.status]} · ${artifactCountLabel} artifact${artifactCount === 1 ? '' : 's'}`;
  const providerOutcomeUnknown = ['FAILED', 'INTERRUPTED'].includes(run.status)
    && execution.providerDiagnostic?.outcome === 'outcome_unknown';
  const safeProviderDetails = providerOutcomeUnknown ? deepSeekOutcomeDiagnostic(execution.providerDiagnostic) : null;

  return {
    status: run.status,
    statusLabel: terminalStatuses[run.status],
    summaryLabel,
    outputPreview,
    proposalPreview,
    outputTruncated,
    artifactCount,
    artifactsCapped: changedArtifacts.length > 100,
    artifacts,
    artifactLinksCapped: validArtifactCount > MAX_ARTIFACT_LINKS || changedArtifacts.length > MAX_ARTIFACTS,
    evidenceHash,
    providerDiagnostic: providerOutcomeUnknown
      ? { outcome: 'outcome_unknown', ...(safeProviderDetails ?? {}) } : null,
    diagnostic: ['FAILED', 'INTERRUPTED'].includes(run.status) ? deepSeekOutcomeDiagnosticCopy(execution.providerDiagnostic) : null,
    failureGuidance: guidance,
  };
}
