create table orgward.software_delivery_runtime_plans (
  tenant_id text not null,
  project_id text not null,
  case_id text not null,
  plan_id text not null,
  runtime_revision integer not null check (runtime_revision > 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  review_revision integer not null check (review_revision > 0),
  review_hash text not null check (review_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, plan_id, runtime_revision),
  unique (tenant_id, project_id, case_id, plan_id, runtime_revision),
  foreign key (tenant_id, plan_id)
    references orgward.software_delivery_plans (tenant_id, plan_id),
  foreign key (tenant_id, plan_id, review_revision)
    references orgward.software_delivery_assignment_reviews (tenant_id, plan_id, review_revision)
);

create table orgward.software_delivery_runtime_commands (
  tenant_id text not null,
  project_id text not null,
  case_id text not null,
  plan_id text not null,
  runtime_revision integer not null check (runtime_revision > 0),
  command_kind text not null check (command_kind in ('promote', 'start-instance')),
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_hash text not null check (result_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, project_id, case_id, plan_id, runtime_revision, command_kind, idempotency_key),
  foreign key (tenant_id, plan_id)
    references orgward.software_delivery_plans (tenant_id, plan_id),
  foreign key (tenant_id, plan_id, runtime_revision)
    references orgward.software_delivery_runtime_plans (tenant_id, plan_id, runtime_revision)
);

create function orgward.prevent_software_delivery_runtime_plan_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Software delivery runtime plan snapshots are immutable.';
end;
$$;

create trigger software_delivery_runtime_plan_immutable
  before update or delete on orgward.software_delivery_runtime_plans
  for each row execute function orgward.prevent_software_delivery_runtime_plan_change();
