alter table orgward.github_repository_sources
  add constraint github_repository_sources_snapshot_history_bound
  check (jsonb_typeof(snapshots) = 'array' and jsonb_array_length(snapshots) <= 32);
