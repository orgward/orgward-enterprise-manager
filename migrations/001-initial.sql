create table orgward.aggregates (
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  aggregate_kind text not null check (aggregate_kind in ('project', 'change_case', 'execution_run')),
  aggregate_id text not null,
  version bigint not null check (version >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null,
  primary key (tenant_id, aggregate_kind, aggregate_id)
);

create index aggregates_tenant_kind_updated_idx on orgward.aggregates (tenant_id, aggregate_kind, updated_at desc, aggregate_id);

create table orgward.command_results (
  tenant_id text not null,
  operation text not null,
  command_id text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  aggregate_kind text,
  aggregate_id text,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_hash text not null check (result_hash ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '90 days'),
  primary key (tenant_id, operation, command_id)
);
create index command_results_aggregate_idx on orgward.command_results (tenant_id, aggregate_kind, aggregate_id, committed_at desc);

create table orgward.audit_log (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  aggregate_kind text not null,
  aggregate_id text not null,
  aggregate_version bigint not null,
  command_id text,
  event_type text not null,
  actor text not null,
  event jsonb not null check (jsonb_typeof(event) = 'object'),
  event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now(),
  retain_until timestamptz not null default (now() + interval '2555 days')
);
create index audit_log_tenant_aggregate_idx on orgward.audit_log (tenant_id, aggregate_kind, aggregate_id, aggregate_version, id);

create table orgward.outbox (
  id bigint generated always as identity primary key,
  event_id text not null unique,
  tenant_id text not null,
  aggregate_kind text not null,
  aggregate_id text not null,
  aggregate_version bigint not null,
  event jsonb not null check (jsonb_typeof(event) = 'object'),
  event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retain_until timestamptz not null default (now() + interval '30 days')
);
create index outbox_pending_idx on orgward.outbox (created_at, id) where published_at is null;
create index outbox_tenant_aggregate_idx on orgward.outbox (tenant_id, aggregate_kind, aggregate_id, aggregate_version);

create table orgward.legacy_imports (
  tenant_id text not null,
  import_id text not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('completed')),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  completed_at timestamptz not null default now(),
  primary key (tenant_id, import_id)
);

create table orgward.legacy_import_items (
  tenant_id text not null,
  import_id text not null,
  source_kind text not null,
  source_path text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  aggregate_id text,
  state_hash text,
  status text not null check (status in ('imported', 'unchanged', 'quarantined')),
  error_code text,
  imported_at timestamptz not null default now(),
  primary key (tenant_id, import_id, source_kind, source_path),
  foreign key (tenant_id, import_id) references orgward.legacy_imports (tenant_id, import_id) on delete restrict
);
create index legacy_import_items_aggregate_idx on orgward.legacy_import_items (tenant_id, aggregate_id, imported_at desc);
