export function resolveProjectAccessSelection(projects, requestedProjectId) {
  if (!requestedProjectId) return { projectId: '', status: 'unavailable' };
  const project = projects.find((entry) => entry.id === requestedProjectId);
  if (!project) return { projectId: '', status: 'unavailable' };
  if (project.workspaceAccess !== 'owner') return { projectId: requestedProjectId, status: 'denied' };
  return { projectId: requestedProjectId, status: 'owner' };
}

export function createProjectAccessController({ getProjects, fetchMembers, onState }) {
  let generation = 0;
  return async function selectProjectAccess(requestedProjectId, {
    updateUrl = false, search = '', view = 'enterprise', onUrlUpdate,
  } = {}) {
    const request = ++generation;
    const selection = resolveProjectAccessSelection(getProjects(), requestedProjectId);
    if (updateUrl && selection.status !== 'unavailable') {
      onUrlUpdate?.(projectAccessViewUrl(selection.projectId, { search, view }));
    }
    const apply = (result) => {
      const stale = request !== generation;
      if (!stale) onState?.(result);
      return { ...result, stale };
    };
    if (selection.status !== 'owner') {
      return apply({ ...selection, members: [], loading: false, error: null });
    }
    apply({ ...selection, members: [], loading: true, error: null });
    try {
      const members = await fetchMembers(selection.projectId);
      return apply({ ...selection, members, loading: false, error: null });
    } catch (error) {
      return apply({ ...selection, members: [], loading: false, error });
    }
  };
}

export function projectAccessIdFromSearch(search = '') {
  return new URLSearchParams(search).get('projectId');
}

export function projectAccessSelectionMessage(status) {
  if (status === 'unavailable') return 'The requested workspace is not available to your account. No other workspace was selected.';
  if (status === 'denied') return 'Access management is available only to the owner of the requested workspace. No other workspace was selected.';
  return null;
}

export function platformViewUrl(view, search = '') {
  return `/platform.html${search}#${view}`;
}

export function projectAccessViewUrl(projectId, { search = '', view = 'enterprise' } = {}) {
  const query = new URLSearchParams(search);
  query.set('projectId', projectId);
  return `/platform.html?${query.toString()}#${view}`;
}

export function createProjectMemberActions({ getSharing, api, reloadMembers, render }) {
  async function update(action) {
    const sharing = getSharing();
    if (sharing.busy || !sharing.projectId || sharing.deepLinkStatus === 'denied'
      || sharing.deepLinkStatus === 'unavailable') return;
    const projectId = sharing.projectId;
    sharing.busy = true;
    sharing.error = null;
    sharing.message = '';
    render();
    try {
      const message = await action(projectId);
      if (getSharing().projectId === projectId) {
        await reloadMembers(projectId);
        if (getSharing().projectId === projectId) getSharing().message = message;
      }
    } catch (error) {
      if (getSharing().projectId === projectId) getSharing().error = error.message;
    } finally {
      sharing.busy = false;
      render();
    }
  }

  return {
    submit(event) {
      event.preventDefault();
      const form = event.target;
      const principal = form.elements.principal.value.trim();
      const access = form.elements.access.value;
      return update((projectId) => api(`/api/v1/projects/${encodeURIComponent(projectId)}/members`, {
        method: 'POST', body: JSON.stringify({ principal, access }),
      }).then(() => 'Project access updated.'));
    },
    revoke(principal) {
      return update((projectId) => api(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${principal}/revoke`, {
        method: 'POST', body: JSON.stringify({}),
      }).then(() => 'Project access removed.'));
    },
  };
}
