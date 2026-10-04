export function resolveProjectAccessSelection(projects, requestedProjectId) {
  if (!requestedProjectId) return { projectId: projects[0]?.id ?? '', status: 'default' };
  const project = projects.find((entry) => entry.id === requestedProjectId);
  if (!project) return { projectId: '', status: 'unavailable' };
  if (project.workspaceAccess !== 'owner') return { projectId: requestedProjectId, status: 'denied' };
  return { projectId: requestedProjectId, status: 'owner' };
}

export function projectAccessSelectionMessage(status) {
  if (status === 'unavailable') return 'The requested workspace is not available to your account. No other workspace was selected.';
  if (status === 'denied') return 'Access management is available only to the owner of the requested workspace. No other workspace was selected.';
  return null;
}

export function platformViewUrl(view, search = '') {
  return `/platform.html${search}#${view}`;
}
