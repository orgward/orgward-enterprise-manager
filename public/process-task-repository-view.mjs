import { encodeStudioRoute } from './shared-interactions.mjs';

const PROJECT_ID = /^project-[0-9a-f-]{36}$/i;
const PROCESS_ID = /^[a-z0-9][a-z0-9_-]{0,119}$/i;

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
  if (!PROJECT_ID.test(run?.projectId ?? '') || !Number.isSafeInteger(ref?.blueprintVersion) || ref.blueprintVersion < 1
    || !/^blueprint-[0-9a-f-]{36}$/i.test(ref?.blueprintId ?? '') || !PROCESS_ID.test(ref?.processId ?? '')
    || project?.id !== run.projectId || !Array.isArray(project.blueprintVersions)) return null;
  const blueprint = project.blueprintVersions.find((entry) => entry?.id === ref.blueprintId
    && entry.version === ref.blueprintVersion);
  if (!blueprint || !Object.values(blueprint.areas ?? {}).some((area) => Array.isArray(area?.items)
    && area.items.some((item) => item?.id === ref.processId && item.type === 'process'))) return null;
  return encodeStudioRoute({ projectId: run.projectId, view: 'map', selectedId: ref.processId,
    blueprintVersion: ref.blueprintVersion });
}
