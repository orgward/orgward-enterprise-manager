import { digest } from '../sdlc/contracts.mjs';

export function releaseFailure(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode, retryable: false });
}
const identifier = /^[a-z0-9][a-z0-9_.:-]{0,159}$/i;
const hash = /^[a-f0-9]{64}$/;
const principal = /^oidc:[a-f0-9]{64}$/;
export const validReleaseCommandId = (value) => typeof value === 'string' && identifier.test(value);

export function parseReleaseEnvironments(value) {
  let rows = value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try { rows = JSON.parse(value); } catch { throw new Error('ORGWARD_RELEASE_ENVIRONMENTS must be a JSON array.'); }
  }
  const keys = new Set(['id', 'tenantId', 'projectId', 'label', 'assetIds', 'riskClass', 'actions', 'authority', 'adapter']);
  if (!Array.isArray(rows) || rows.length > 32) throw new Error('Configure at most 32 protected release environments.');
  const result = rows.map((row) => {
    const authority = row?.authority;
    const adapter = row?.adapter;
    let endpoint;
    try { endpoint = new URL(adapter?.endpoint); } catch { /* report the fixed configuration error below */ }
    const lists = ['requesters', 'approvers', 'executors'];
    if (!row || typeof row !== 'object' || Object.keys(row).some((key) => !keys.has(key))
      || typeof row.id !== 'string' || !identifier.test(row.id) || typeof row.tenantId !== 'string'
      || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(row.tenantId)
      || !/^project-[0-9a-f-]{36}$/.test(row.projectId ?? '')
      || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 120
      || !Array.isArray(row.assetIds) || !row.assetIds.length || row.assetIds.length > 16
      || row.assetIds.some((asset) => typeof asset !== 'string' || !identifier.test(asset)) || new Set(row.assetIds).size !== row.assetIds.length
      || !['low', 'moderate', 'high'].includes(row.riskClass)
      || !Array.isArray(row.actions) || !row.actions.length || row.actions.some((action) => !['release', 'rollback'].includes(action))
      || new Set(row.actions).size !== row.actions.length || !authority || Object.keys(authority).some((key) => !lists.includes(key))
      || lists.some((key) => !Array.isArray(authority[key]) || !authority[key].length || authority[key].length > 32
        || authority[key].some((actor) => typeof actor !== 'string' || !principal.test(actor)))
      || !adapter || Object.keys(adapter).some((key) => !['kind', 'endpoint', 'authorizationToken', 'timeoutMs'].includes(key))
      || adapter.kind !== 'http-release-v1' || !endpoint || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))
      || (adapter.authorizationToken !== undefined && (typeof adapter.authorizationToken !== 'string'
        || !adapter.authorizationToken || adapter.authorizationToken.length > 4096 || /[\r\n]/.test(adapter.authorizationToken)))
      || (endpoint.protocol === 'https:' && !adapter.authorizationToken)
      || (adapter.timeoutMs !== undefined && (!Number.isSafeInteger(adapter.timeoutMs) || adapter.timeoutMs < 100 || adapter.timeoutMs > 120_000))) {
      throw new Error('Protected release environments require exact scope, assets, risk, allowed actions, principal authority and a fixed authenticated HTTP adapter.');
    }
    const snapshot = { id: row.id, tenantId: row.tenantId, projectId: row.projectId, label: row.label.trim(),
      assetIds: [...row.assetIds].sort(), riskClass: row.riskClass, actions: [...row.actions].sort(),
      authority: Object.fromEntries(lists.map((key) => [key, [...new Set(authority[key])].sort()])),
      adapter: { kind: adapter.kind, endpoint: endpoint.href.replace(/\/$/, ''), timeoutMs: adapter.timeoutMs ?? 30_000 } };
    return { ...snapshot, configurationHash: digest(snapshot),
      adapter: { ...snapshot.adapter, authorizationToken: adapter.authorizationToken ?? null } };
  });
  if (new Set(result.map((row) => `${row.tenantId}:${row.projectId}:${row.id}`)).size !== result.length) {
    throw new Error('Protected release environment identities must be unique within their project.');
  }
  return result;
}

export function releaseEnvironmentSnapshot(environment) {
  const { authorizationToken, ...adapter } = environment.adapter;
  return { id: environment.id, tenantId: environment.tenantId, projectId: environment.projectId,
    label: environment.label, assetIds: environment.assetIds, riskClass: environment.riskClass,
    actions: environment.actions, authority: environment.authority, adapter,
    configurationHash: environment.configurationHash };
}

// Approval consumes the existing candidate receipt. It never promotes legacy,
// missing-build, failed-check or mismatched-build evidence into readiness.
export function releaseCandidateBinding(run) {
  const invalid = () => { throw releaseFailure('RELEASE_CANDIDATE_NOT_READY',
    'Release requires a successful exact GitHub candidate, a complete passed required-check plan and matching durable build outputs.'); };
  const candidate = run?.execution?.repositoryCandidate;
  const selection = run?.githubPatchSelection;
  const evidence = candidate?.candidateEvidence;
  const checks = candidate?.checkPlan;
  const build = candidate?.buildReceipt;
  const buildPlan = candidate?.buildPlan;
  const terminal = run?.events?.findLast((event) => ['ExecutionSucceeded', 'ExecutionFailed'].includes(event.type));
  if (run?.status !== 'SUCCEEDED' || !selection || candidate?.source?.type !== 'github-app'
    || typeof candidate.repositoryId !== 'string' || !candidate.repositoryId
    || !hash.test(candidate.treeDigest ?? '') || !hash.test(candidate.sourceTreeDigest ?? '')
    || !hash.test(selection.sourceSnapshot?.snapshotId ?? '') || typeof selection.sourceSnapshot?.commitOid !== 'string'
    || !selection.sourceSnapshot.commitOid || !Array.isArray(selection.selectedFiles) || !selection.selectedFiles.length
    || !Array.isArray(candidate.changes) || !selection.verifier || !run.processTaskRef?.repository?.source
    || evidence?.version !== 'github-candidate-evidence-v1' || !hash.test(evidence.hash ?? '')
    || evidence.hash !== run.execution.evidenceHash || terminal?.type !== 'ExecutionSucceeded'
    || terminal.data?.candidateEvidenceHash !== evidence.hash || terminal.data?.evidenceHash !== evidence.hash
    || candidate.source.snapshotId !== selection.sourceSnapshot?.snapshotId
    || !checks || checks.legacySingleCheck !== false || candidate.requiredChecksStatus !== 'PASSED'
    || !Array.isArray(checks.requiredChecks) || !checks.requiredChecks.length
    || !Array.isArray(candidate.checkReceipts) || candidate.checkReceipts.length !== checks.requiredChecks.length
    || digest(selection.checkPlan) !== digest(checks) || !buildPlan || digest(selection.buildPlan) !== digest(buildPlan)
    || !Array.isArray(buildPlan?.requiredOutputs) || !buildPlan.requiredOutputs.length
    || build?.status !== 'REPRODUCIBLE' || build.outputBytesEqual !== true || build.candidateTreeDigest !== candidate.treeDigest
    || !Array.isArray(build.runs) || build.runs.length !== 2) invalid();
  const { planHash: checkPlanHash, ...checkCore } = checks;
  const { planHash: buildPlanHash, ...buildCore } = buildPlan;
  const { receiptHash, ...receiptCore } = build;
  if (digest(checkCore) !== checkPlanHash || digest(buildCore) !== buildPlanHash
    || build.planHash !== buildPlanHash || digest(receiptCore) !== receiptHash) invalid();
  for (let index = 0; index < checks.requiredChecks.length; index += 1) {
    const check = checks.requiredChecks[index]; const receipt = candidate.checkReceipts[index];
    if (receipt.status !== 'PASSED' || receipt.exitCode !== 0 || receipt.checkId !== check.id
      || receipt.checkVersion !== check.version || receipt.commandHash !== check.commandHash
      || receipt.planHash !== checkPlanHash || receipt.candidateTreeDigest !== candidate.treeDigest
      || receipt.candidateTreeDigestAfter !== candidate.treeDigest) invalid();
  }
  const [first, second] = build.runs;
  for (const built of build.runs) {
    if (built.status !== 'BUILT' || built.exitCode !== 0 || !identifier.test(built.artifactSetId ?? '')
      || built.candidateTreeDigestBefore !== candidate.treeDigest || built.candidateTreeDigestAfter !== candidate.treeDigest
      || !Array.isArray(built.outputManifest) || !built.outputManifest.length
      || digest(built.outputManifest) !== built.outputManifestHash
      || digest(built.outputManifest.map((output) => output.path).sort()) !== digest([...buildPlan.requiredOutputs].sort())) invalid();
  }
  if (first.artifactSetId === second.artifactSetId || digest(first.outputManifest) !== digest(second.outputManifest)) invalid();
  const verification = candidate.verification;
  if (!verification || verification.status !== 'COMPLETED' || verification.exitCode !== 0) invalid();
  const canonicalEvidence = { version: evidence.version, sourceSnapshot: run.processTaskRef?.repository?.source,
    sourceTreeDigest: candidate.sourceTreeDigest,
    selectedFileHashes: selection.selectedFiles.map(({ path, mode, size, contentHash }) => ({ path, mode, size, contentHash })),
    candidateTreeDigest: candidate.treeDigest,
    diffMetadata: candidate.changes.map(({ path, change, beforeMode, afterMode, beforeHash, afterHash }) => ({
      path, change, beforeMode, afterMode, beforeHash, afterHash })),
    verifierReceipt: { id: verification.id, version: verification.version, profileHash: selection.verifier.profileHash,
      commandHash: verification.commandHash, treeDigest: verification.treeDigest, status: verification.status,
      exitCode: verification.exitCode, outputHash: verification.outputHash,
      stdoutTruncated: verification.stdoutTruncated, stderrTruncated: verification.stderrTruncated },
    checkPlan: checks, checkReceipts: candidate.checkReceipts.map(({ stdout, stderr, ...receipt }) => receipt), buildPlan, buildReceipt: build };
  if (digest(canonicalEvidence) !== evidence.hash) invalid();
  return { runId: run.id, repositoryId: candidate.repositoryId, sourceSnapshotId: selection.sourceSnapshot.snapshotId,
    sourceCommitOid: selection.sourceSnapshot.commitOid, candidateEvidenceHash: evidence.hash,
    candidateTreeDigest: candidate.treeDigest, checkPlanHash, buildPlanHash, buildReceiptHash: receiptHash,
    artifactSetIds: build.runs.map((built) => built.artifactSetId), outputManifest: structuredClone(first.outputManifest),
    outputManifestHash: first.outputManifestHash };
}

export function releaseAdapterObservation(raw, action) {
  const request = action.request;
  const matches = raw?.version === 'protected-release-result-v1' && raw.actionId === action.id
    && raw.requestHash === action.requestHash && raw.environmentId === request.environment.id
    && raw.configurationHash === request.environment.configurationHash
    && raw.candidateEvidenceHash === request.candidate.candidateEvidenceHash
    && raw.outputManifestHash === request.candidate.outputManifestHash;
  if (!matches) return { status: 'UNKNOWN', reason: 'adapter_receipt_identity_mismatch' };
  const receipt = { version: raw.version, actionId: raw.actionId, requestHash: raw.requestHash,
    environmentId: raw.environmentId, configurationHash: raw.configurationHash,
    candidateEvidenceHash: raw.candidateEvidenceHash, outputManifestHash: raw.outputManifestHash };
  if (raw.status === 'REJECTED' && raw.noEffect === true) return { ...receipt, status: 'REJECTED', noEffect: true };
  if (raw.status === 'APPLIED') {
    const validHealth = ['healthy', 'unhealthy'].includes(raw.health) && identifier.test(raw.healthCheckId ?? '')
      && typeof raw.observedAt === 'string' && Number.isFinite(Date.parse(raw.observedAt))
      && Date.parse(raw.observedAt) >= Date.parse(action.dispatch.dispatchedAt)
      && Date.parse(raw.observedAt) <= Date.now() + 60_000;
    return { ...receipt, status: 'APPLIED', health: validHealth ? raw.health : 'unknown',
      ...(validHealth ? { healthCheckId: raw.healthCheckId, observedAt: new Date(raw.observedAt).toISOString() } : {}) };
  }
  return { ...receipt, status: 'UNKNOWN', reason: 'adapter_outcome_unavailable' };
}
