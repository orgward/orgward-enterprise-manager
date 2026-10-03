create table orgward.protected_release_environments (
  tenant_id text not null,
  project_id text not null,
  environment_id text not null,
  state jsonb not null,
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  primary key (tenant_id,project_id,environment_id)
);

create table orgward.protected_release_actions (
  tenant_id text not null,
  project_id text not null,
  action_id text not null,
  environment_id text not null,
  state jsonb not null,
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id,project_id,action_id)
);
create index protected_release_actions_environment
  on orgward.protected_release_actions (tenant_id,project_id,environment_id,created_at,action_id);

create table orgward.protected_release_commands (
  tenant_id text not null,
  project_id text not null,
  operation text not null,
  command_id text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  action_id text not null,
  primary key (tenant_id,project_id,operation,command_id),
  foreign key (tenant_id,project_id,action_id)
    references orgward.protected_release_actions (tenant_id,project_id,action_id)
);
