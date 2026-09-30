create table orgward.github_candidate_verification_repeats (
  tenant_id text not null,
  project_id text not null,
  run_id text not null,
  attempt_id text not null,
  command_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  candidate_evidence_version text not null check (candidate_evidence_version = 'github-candidate-evidence-v1'),
  candidate_evidence_hash text not null check (candidate_evidence_hash ~ '^[a-f0-9]{64}$'),
  source_snapshot_id text not null check (source_snapshot_id ~ '^[a-f0-9]{64}$'),
  source_tree_digest text not null check (source_tree_digest ~ '^[a-f0-9]{64}$'),
  candidate_tree_digest text not null check (candidate_tree_digest ~ '^[a-f0-9]{64}$'),
  verifier_id text not null,
  verifier_version text not null,
  verifier_profile_hash text not null check (verifier_profile_hash ~ '^[a-f0-9]{64}$'),
  verifier_command_hash text not null check (verifier_command_hash ~ '^[a-f0-9]{64}$'),
  comparison text not null check (comparison in ('matched', 'mismatch', 'inconclusive')),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  attempt_hash text not null check (attempt_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, run_id, attempt_id),
  unique (tenant_id, run_id, command_id)
);

create index github_candidate_verification_repeats_run
  on orgward.github_candidate_verification_repeats (tenant_id, project_id, run_id, created_at, attempt_id);

create function orgward.reject_github_candidate_verification_repeat_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'GitHub candidate verification attempts are append-only';
end;
$$;

create trigger github_candidate_verification_repeats_append_only
  before update or delete on orgward.github_candidate_verification_repeats
  for each row execute function orgward.reject_github_candidate_verification_repeat_mutation();
