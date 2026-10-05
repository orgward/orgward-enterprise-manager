const PROJECT_ID = /^project-[0-9a-f-]{36}$/i;
const BLUEPRINT_ID = /^blueprint-[0-9a-f-]{36}$/i;
const INTEGRITY_ID = /^enterprise-integrity-[0-9a-f-]{36}$/;
const HASH = /^[a-f0-9]{64}$/;

export function processTaskPinnedIntegrityContext(run, projection) {
  const ref = run?.processTaskRef;
  const context = projection?.context;
  if (!PROJECT_ID.test(run?.projectId ?? '') || !BLUEPRINT_ID.test(ref?.blueprintId ?? '')
    || !Number.isSafeInteger(ref?.blueprintVersion) || ref.blueprintVersion < 1
    || !context || !Number.isSafeInteger(context.projectVersion) || context.projectVersion < 1
    || context.blueprintId !== ref.blueprintId
    || context.blueprintVersion !== ref.blueprintVersion || !HASH.test(context.snapshotHash ?? '')) {
    return { kind: 'unavailable' };
  }
  const assessment = projection.integrity?.current;
  if (!assessment) return { kind: 'not-assessed', blueprintId: ref.blueprintId,
    blueprintVersion: ref.blueprintVersion, snapshotHash: context.snapshotHash };
  if (!INTEGRITY_ID.test(assessment.id ?? '') || !['PASS', 'REVIEW', 'FAIL'].includes(assessment.status)
    || assessment.appliesToContext !== true || assessment.source?.projectId !== run.projectId
    || assessment.source.blueprintId !== ref.blueprintId || assessment.source.blueprintVersion !== ref.blueprintVersion
    || assessment.source.snapshotHash !== context.snapshotHash || !HASH.test(assessment.reportHash ?? '')
    || !Number.isSafeInteger(assessment.counts?.findings) || assessment.counts.findings < 0) {
    return { kind: 'unavailable' };
  }
  return { kind: 'assessment', reportId: assessment.id, status: assessment.status,
    reportHash: assessment.reportHash, blueprintId: ref.blueprintId,
    blueprintVersion: ref.blueprintVersion, snapshotHash: context.snapshotHash,
    findingCount: assessment.counts.findings };
}
