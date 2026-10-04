// A linked case selects that exact saved case or leaves the workspace unselected.
export function sourceObjectPreview(project, item) {
  return item
    ? `Current saved source · ${item.name} (${item.type}) · project v${project.version} · blueprint ${project.latestBlueprint.id} v${project.latestBlueprint.version}. ${item.detail}`
    : 'Select a project object from its current saved blueprint.';
}

export async function openInitialCase({ search, cases, projects = [], loadCase, showWelcome, notify }) {
  const requestedCase = new URLSearchParams(search).get('case');
  if (requestedCase !== null) {
    if (cases.some((entry) => entry.id === requestedCase)) {
      await loadCase(requestedCase);
      return { state: 'opened', caseId: requestedCase };
    }
    showWelcome();
    notify('The linked change case is unavailable to your current identity. Choose an available case.');
    return { state: 'unavailable', caseId: requestedCase };
  }
  const requestedProjectId = new URLSearchParams(search).get('projectId');
  if (requestedProjectId !== null) {
    const project = projects.find((entry) => entry.id === requestedProjectId);
    showWelcome({ requestedProjectId: project?.id ?? null, exactProjectRequested: true });
    if (!project) {
      notify('The requested workspace is unavailable to your current identity. Choose an available workspace.');
      return { state: 'project-unavailable', projectId: requestedProjectId };
    }
    return { state: 'welcome', projectId: project.id };
  }
  if (cases.length) {
    await loadCase(cases[0].id);
    return { state: 'opened', caseId: cases[0].id };
  }
  showWelcome();
  return { state: 'welcome', caseId: null };
}
