const providerProfileKinds = new Set(['provider-deepseek', 'provider-openai', 'provider-http']);
const knownInterruptions = new Set([
  'authorization_revoked',
  'credential_generation_changed',
  'control_plane_restarted',
  'control_plane_shutdown',
  'dispatch_commit_unknown',
  'execution_approval_stale',
  'process_plan_blueprint_stale',
  'worker_lease_unavailable',
]);

/** Returns a fixed category for a linked process-task terminal outcome. */
export function linkedRunOutcomeCategory(run, { status, errorCode = null, reason = null } = {}) {
  if (!run?.processTaskRef || !['FAILED', 'INTERRUPTED'].includes(status)) return null;
  if (status === 'INTERRUPTED') {
    if (reason === 'control_plane_restarted' && providerProfileKinds.has(run.profile?.kind)) return 'outcome_unverified';
    if (reason === 'execution_approval_stale') return 'approval_stale';
    if (reason === 'process_plan_blueprint_stale') return 'source_stale';
    if (reason === 'credential_generation_changed') return 'credential_changed';
    if (reason === 'authorization_revoked') return 'authorization_changed';
    if (reason === 'dispatch_commit_unknown' || reason === 'worker_lease_unavailable') return 'outcome_unverified';
    if (knownInterruptions.has(reason)) return 'worker_recovery';
    return null;
  }
  if (errorCode === 'PROVIDER_OUTCOME_UNKNOWN') return 'outcome_unverified';
  if (errorCode === 'LOCAL_REPOSITORY_VERIFICATION_STALE'
    || run.execution?.repositoryCandidate?.verification?.status === 'FAILED') return 'verification_failed';
  if (providerProfileKinds.has(run.profile?.kind)) return 'provider_failed';
  if (run.profile?.kind === 'command') return 'command_failed';
  return null;
}
