create table orgward.customer_outcomes (
  tenant_id text not null,
  project_id text not null,
  outcome_id text not null,
  state jsonb not null,
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,project_id,outcome_id)
);
create index customer_outcomes_project on orgward.customer_outcomes (tenant_id,project_id,updated_at,outcome_id);

create table orgward.customer_outcome_commands (
  tenant_id text not null,
  project_id text not null,
  operation text not null,
  command_id text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  outcome_id text not null,
  primary key (tenant_id,project_id,operation,command_id),
  foreign key (tenant_id,project_id,outcome_id) references orgward.customer_outcomes (tenant_id,project_id,outcome_id)
);
