import { encodeStudioRoute } from './shared-interactions.mjs';

const PROJECT_ID = /^project-[0-9a-f-]{36}$/i;
const PROCESS_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/i;
const BLUEPRINT_ID = /^blueprint-[0-9a-f-]{36}$/i;

export function processTaskRepositoryReference(run) {
  const repository = run?.processTaskRef?.repository;
  if (!repository || typeof repository.id !== 'string' || !repository.id) return null;
  const source = repository.source;
  const sourceType = source?.type === 'git' ? 'Git'
    : source?.type === 'github-app' ? 'GitHub App'
      : typeof source?.type === 'string' ? `${source.type} source` : 'configured local directory';
  const fields = [`Pinned repository ${repository.id}`, sourceType];
  if (source?.type === 'git') {
    if (typeof source.identity === 'string' && source.identity) fields.push(source.identity);
    if (typeof source.ref === 'string' && source.ref) fields.push(`ref ${source.ref}`);
    if (typeof source.commitOid === 'string' && /^[a-f0-9]{40,64}$/.test(source.commitOid)) fields.push(`commit ${source.commitOid}`);
  } else if (source?.type === 'github-app') {
    if (typeof source.repositoryId === 'string' && source.repositoryId) fields.push(`repository ${source.repositoryId}`);
    if (typeof source.branchRef === 'string' && source.branchRef) fields.push(source.branchRef);
    if (typeof source.commitOid === 'string' && /^[a-f0-9]{40,64}$/.test(source.commitOid)) fields.push(`commit ${source.commitOid}`);
  }
  fields.push(`tree ${/^[a-f0-9]{64}$/.test(repository.treeDigest ?? '') ? repository.treeDigest : 'digest unavailable'}`);
  return fields.join(' · ');
}

export function processTaskPinnedDesignRoute(run, project) {
  const ref = run?.processTaskRef;
  if (!pinnedProcessBlueprint(run, project)) return null;
  return encodeStudioRoute({ projectId: run.projectId, view: 'map', selectedId: ref.processId,
    blueprintVersion: ref.blueprintVersion });
}

function pinnedProcessBlueprint(run, project) {
  const ref = run?.processTaskRef;
  if (!PROJECT_ID.test(run?.projectId ?? '') || !BLUEPRINT_ID.test(ref?.blueprintId ?? '')
    || !Number.isSafeInteger(ref?.blueprintVersion) || ref.blueprintVersion < 1 || !PROCESS_ID.test(ref?.processId ?? '')
    || project?.id !== run.projectId || !Array.isArray(project.blueprintVersions)) return null;
  const blueprint = project.blueprintVersions.find((entry) => entry?.id === ref.blueprintId
    && entry.version === ref.blueprintVersion);
  return blueprint && Object.values(blueprint.areas ?? {}).some((area) => Array.isArray(area?.items)
    && area.items.some((item) => item?.id === ref.processId && item.type === 'process')) ? blueprint : null;
}

export function processTaskDesignFreshness(run, project) {
  const pinned = pinnedProcessBlueprint(run, project);
  const latest = project?.latestBlueprint;
  if (!pinned || !BLUEPRINT_ID.test(latest?.id ?? '') || !Number.isSafeInteger(latest.version) || latest.version < 1) {
    return { kind: 'unavailable' };
  }
  const ref = run.processTaskRef;
  if (latest.id === ref.blueprintId && latest.version === ref.blueprintVersion) {
    return { kind: 'current', blueprintVersion: ref.blueprintVersion };
  }
  return { kind: 'historical', blueprintVersion: ref.blueprintVersion, currentBlueprintVersion: latest.version };
}
