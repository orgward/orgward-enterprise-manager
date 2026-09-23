create table orgward.provider_dispatch_attempts (
  tenant_id text not null,
  run_kind text not null default 'execution_run' check (run_kind = 'execution_run'),
  run_id text not null,
  project_kind text not null default 'project' check (project_kind = 'project'),
  project_id text not null,
  principal text not null,
  worker_id text not null check (worker_id ~ '^[a-f0-9-]{36}$'),
  attempt_id text not null check (attempt_id ~ '^[a-f0-9-]{36}$'),
  credential_reference text not null check (credential_reference ~ '^secret-[a-z0-9][a-z0-9._-]{0,79}$'),
  credential_version integer not null check (credential_version > 0),
  status text not null check (status in ('reserved', 'handed_off', 'completed', 'cancelled', 'outcome_unknown')),
  reserved_at timestamptz not null default now(),
  handed_off_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, run_id),
  unique (attempt_id),
  foreign key (tenant_id, run_kind, run_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id) on delete restrict,
  foreign key (tenant_id, project_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id) on delete restrict,
  check (run_id ~ '^execution-run-[0-9a-f-]{36}$'),
  check (project_id ~ '^project-[0-9a-f-]{36}$'),
  check ((status in ('handed_off', 'completed', 'outcome_unknown') and handed_off_at is not null)
    or (status in ('reserved', 'cancelled') and handed_off_at is null)),
  check ((status in ('completed', 'cancelled', 'outcome_unknown') and finished_at is not null)
    or (status in ('reserved', 'handed_off') and finished_at is null))
);

create index provider_dispatch_attempts_status_idx
  on orgward.provider_dispatch_attempts (status, updated_at);

create function orgward.cancel_unstarted_provider_dispatch() returns trigger
language plpgsql as $$
begin
  if old.cancel_requested_at is null and new.cancel_requested_at is not null then
    update orgward.provider_dispatch_attempts
    set status = 'cancelled', finished_at = now(), updated_at = now()
    where tenant_id = new.tenant_id and run_id = new.run_id and status = 'reserved';
  end if;
  return new;
end;
$$;

create trigger execution_lease_cancel_unstarted_provider_dispatch
  after update of cancel_requested_at on orgward.execution_worker_leases
  for each row execute function orgward.cancel_unstarted_provider_dispatch();
