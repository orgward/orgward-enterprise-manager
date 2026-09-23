create table orgward.aggregate_project_scopes (
  tenant_id text not null,
  aggregate_kind text not null check (aggregate_kind in ('change_case', 'execution_run')),
  aggregate_id text not null,
  project_kind text not null default 'project' check (project_kind = 'project'),
  project_id text not null check (project_id ~ '^project-[0-9a-f-]{36}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, aggregate_kind, aggregate_id),
  foreign key (tenant_id, aggregate_kind, aggregate_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id)
    on delete restrict,
  foreign key (tenant_id, project_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id)
    on delete restrict
);

create index aggregate_project_scopes_project_idx
  on orgward.aggregate_project_scopes (tenant_id, project_id, aggregate_kind, aggregate_id);

create function orgward.prevent_aggregate_project_scope_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Aggregate project scope is immutable; create a reviewed remapping operation.';
end;
$$;

create trigger aggregate_project_scopes_no_update
  before update or delete on orgward.aggregate_project_scopes
  for each row execute function orgward.prevent_aggregate_project_scope_change();

-- Existing tenant-scoped cases and runs stay unassigned until a reviewed mapping exists.
