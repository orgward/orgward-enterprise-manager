create table if not exists orgward.github_repository_sources (
  tenant_id text not null,
  project_id text not null,
  repository_id bigint not null check (repository_id > 0),
  installation_id bigint not null check (installation_id > 0),
  branch_ref text not null check (branch_ref like 'refs/heads/%'),
  binding jsonb not null,
  snapshots jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, project_id, repository_id, branch_ref)
);

create index if not exists github_repository_sources_project
  on orgward.github_repository_sources (tenant_id, project_id, updated_at desc);
