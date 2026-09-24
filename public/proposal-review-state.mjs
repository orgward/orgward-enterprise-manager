import { encodeStudioRoute } from './shared-interactions.mjs';

export function deriveBlueprintProposalReviewState({ proposal, project, membershipAccess = null, appliedEvent = null }) {
  if (!project) {
    return {
      status: 'project-unavailable', canApply: false,
      message: 'The current project version could not be loaded. This proposal remains review-only.',
    };
  }
  if (appliedEvent) {
    return {
      status: 'applied', canApply: false,
      blueprintVersion: appliedEvent.data?.appliedBlueprintVersion ?? null,
      eventId: appliedEvent.eventId ?? null,
      message: 'Applied to a new proposed blueprint version.',
    };
  }
  const latest = project.latestBlueprint;
  if (!proposal || latest?.id !== proposal.blueprintId || latest?.version !== proposal.blueprintVersion) {
    return {
      status: 'stale', canApply: false,
      currentBlueprintVersion: latest?.version ?? null,
      message: 'Stale proposal: the current blueprint changed after this proposal was generated. Review a proposal from the current version.',
    };
  }
  if (membershipAccess === 'owner') {
    return { status: 'owner-can-apply', canApply: true, currentBlueprintVersion: latest.version };
  }
  return {
    status: 'owner-required', canApply: false,
    currentBlueprintVersion: latest.version,
    message: 'A workspace owner can apply this proposal as a new immutable proposed version. Other project members can review it here.',
  };
}

export function proposalApplyFailureDisposition(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429
    ? 'reconcile' : 'retry';
}

export function proposalDesignLink(project, application) {
  if (!project?.id) return null;
  const href = encodeStudioRoute({ projectId: project.id });
  if (href === '/') return null;
  return {
    href,
    label: application?.status === 'applied' ? 'Open updated design' : 'Open current design',
  };
}
