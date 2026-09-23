create table orgward.execution_worker_leases (
  tenant_id text not null,
  run_kind text not null default 'execution_run' check (run_kind = 'execution_run'),
  run_id text not null,
  project_kind text not null default 'project' check (project_kind = 'project'),
  project_id text not null,
  principal text not null,
  worker_id text not null check (worker_id ~ '^[a-f0-9-]{36}$'),
  lease_until timestamptz not null,
  cancel_requested_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, run_id),
  foreign key (tenant_id, run_kind, run_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id)
    on delete restrict,
  foreign key (tenant_id, project_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id)
    on delete restrict,
  foreign key (principal, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict,
  check (run_id ~ '^execution-run-[0-9a-f-]{36}$'),
  check (project_id ~ '^project-[0-9a-f-]{36}$'),
  check ((cancel_requested_at is null and cancel_reason is null)
    or (cancel_requested_at is not null and cancel_reason is not null
      and length(trim(cancel_reason)) between 1 and 120))
);

create index execution_worker_leases_expiry_idx
  on orgward.execution_worker_leases (lease_until);
create index execution_worker_leases_project_principal_idx
  on orgward.execution_worker_leases (tenant_id, project_id, principal, lease_until);

create function orgward.validate_execution_worker_lease_scope() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from orgward.aggregates
    where tenant_id = new.tenant_id and aggregate_kind = 'execution_run'
      and aggregate_id = new.run_id
  ) then
    raise exception 'Execution worker lease must reference an execution run.';
  end if;
  if not exists (
    select 1 from orgward.aggregates
    where tenant_id = new.tenant_id and aggregate_kind = 'project'
      and aggregate_id = new.project_id
  ) then
    raise exception 'Execution worker lease must reference a project.';
  end if;
  return new;
end;
$$;

create trigger execution_worker_leases_validate_scope
  before insert or update on orgward.execution_worker_leases
  for each row execute function orgward.validate_execution_worker_lease_scope();
