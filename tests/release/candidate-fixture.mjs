import { createHash } from 'node:crypto';
import { digest } from '../../src/sdlc/contracts.mjs';

export const h = (value) => value.repeat(64);
export const releaseBuildBytes = Buffer.from('stable');

export function readyCandidate({ runId = 'execution-run-17', snapshotChar = '1', candidateTreeChar = '6' } = {}) {
  const source = { repositoryId: 'repo-17', snapshotId: h(snapshotChar), commitOid: h('2') };
  const selectedFiles = [{ path: 'src/index.mjs', mode: '100644', size: 5, contentHash: h('3') }];
  const checkCore = { version: 'required-check-plan-v1', legacySingleCheck: false, requiredChecks: [
    { id: 'unit', version: '1', commandHash: h('4') },
  ] };
  const checkPlan = { ...checkCore, planHash: digest(checkCore) };
  const buildCore = { version: 'reproducible-build-plan-v1', requiredOutputs: ['dist/app.js'] };
  const buildPlan = { ...buildCore, planHash: digest(buildCore) };
  const outputManifest = [{ path: 'dist/app.js', mode: '100644', size: releaseBuildBytes.length,
    sha256: createHash('sha256').update(releaseBuildBytes).digest('hex') }];
  const outputManifestHash = digest(outputManifest);
  const runs = ['build-one', 'build-two'].map((artifactSetId) => ({
    artifactSetId, status: 'BUILT', exitCode: 0,
    candidateTreeDigestBefore: h(candidateTreeChar), candidateTreeDigestAfter: h(candidateTreeChar),
    outputManifest, outputManifestHash,
  }));
  const buildReceiptCore = { status: 'REPRODUCIBLE', outputBytesEqual: true,
    candidateTreeDigest: h(candidateTreeChar), planHash: buildPlan.planHash, runs };
  const buildReceipt = { ...buildReceiptCore, receiptHash: digest(buildReceiptCore) };
  const verification = { id: 'verify-17', version: 'fixed-verifier-v1', status: 'COMPLETED',
    exitCode: 0, commandHash: h('7'), treeDigest: h(candidateTreeChar), outputHash: h('8'),
    stdoutTruncated: false, stderrTruncated: false };
  const changes = [{ path: 'src/index.mjs', change: 'modified', beforeMode: '100644', afterMode: '100644',
    beforeHash: h('3'), afterHash: h('9') }];
  const checkReceipts = [{ status: 'PASSED', exitCode: 0, checkId: 'unit', checkVersion: '1',
    commandHash: h('4'), planHash: checkPlan.planHash, candidateTreeDigest: h(candidateTreeChar),
    candidateTreeDigestAfter: h(candidateTreeChar), stdout: 'passed', stderr: '' }];
  const selection = { sourceSnapshot: { ...source }, selectedFiles,
    checkPlan, buildPlan, verifier: { profileHash: h('a') } };
  const evidence = { version: 'github-candidate-evidence-v1' };
  const run = { id: runId, status: 'SUCCEEDED', processTaskRef: { repository: { source } },
    githubPatchSelection: selection, events: [], execution: { repositoryCandidate: {
      source: { type: 'github-app', snapshotId: source.snapshotId }, repositoryId: source.repositoryId, sourceTreeDigest: h('b'),
      treeDigest: h(candidateTreeChar), changes, verification, checkPlan, checkReceipts,
      requiredChecksStatus: 'PASSED', buildPlan, buildReceipt, candidateEvidence: evidence,
    } } };
  const candidate = run.execution.repositoryCandidate;
  const canonicalEvidence = {
    version: evidence.version, sourceSnapshot: source, sourceTreeDigest: candidate.sourceTreeDigest,
    selectedFileHashes: selectedFiles.map(({ path, mode, size, contentHash }) => ({ path, mode, size, contentHash })),
    candidateTreeDigest: candidate.treeDigest,
    diffMetadata: changes.map(({ path, change, beforeMode, afterMode, beforeHash, afterHash }) =>
      ({ path, change, beforeMode, afterMode, beforeHash, afterHash })),
    verifierReceipt: { id: verification.id, version: verification.version, profileHash: selection.verifier.profileHash,
      commandHash: verification.commandHash, treeDigest: verification.treeDigest, status: verification.status,
      exitCode: verification.exitCode, outputHash: verification.outputHash,
      stdoutTruncated: verification.stdoutTruncated, stderrTruncated: verification.stderrTruncated },
    checkPlan, checkReceipts: checkReceipts.map(({ stdout, stderr, ...receipt }) => receipt), buildPlan, buildReceipt,
  };
  evidence.hash = digest(canonicalEvidence);
  run.execution.evidenceHash = evidence.hash;
  run.events.push({ type: 'ExecutionSucceeded', data: { evidenceHash: evidence.hash, candidateEvidenceHash: evidence.hash } });
  return run;
}
