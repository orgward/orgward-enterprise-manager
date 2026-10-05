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
