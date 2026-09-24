alter table orgward.secret_references
  add column active_provider_organization_id text,
  add column active_provider_project_id text,
  add column active_provider_service_account_id text,
  add column active_provider_api_key_id text,
  add column active_provider_target_provenance text,
  add column candidate_provider_organization_id text,
  add column candidate_provider_project_id text,
  add column candidate_provider_service_account_id text,
  add column candidate_provider_api_key_id text,
  add column candidate_provider_target_provenance text;

alter table orgward.secret_references
  add constraint secret_active_provider_target_check check (
    (active_provider_organization_id is null and active_provider_project_id is null
      and active_provider_service_account_id is null and active_provider_api_key_id is null
      and active_provider_target_provenance is null)
    or
    (active_provider = 'openai' and active_provider_organization_id is not null
      and active_provider_project_id is not null and active_provider_service_account_id is not null
      and active_provider_api_key_id is not null
      and active_provider_target_provenance = 'orgward_created_exclusive_service_account')
  ),
  add constraint secret_candidate_provider_target_check check (
    (candidate_provider_organization_id is null and candidate_provider_project_id is null
      and candidate_provider_service_account_id is null and candidate_provider_api_key_id is null
      and candidate_provider_target_provenance is null)
    or
    (candidate_provider_organization_id is not null and candidate_provider_project_id is not null
      and candidate_provider_service_account_id is not null and candidate_provider_api_key_id is not null
      and candidate_provider_target_provenance = 'orgward_created_exclusive_service_account')
  );

create table orgward.secret_openai_provisioning_commands (
  tenant_id text not null,
  reference text not null,
  command_id text not null check (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  candidate_version integer not null check (candidate_version > 0),
  organization_id text not null,
  project_id text not null,
  model text not null,
  expires_at timestamptz not null,
  provider_resource_name text not null check (provider_resource_name ~ '^orgward-[a-f0-9-]{36}$'),
  reason text not null check (length(trim(reason)) between 1 and 500),
  actor text not null,
  status text not null check (status in (
    'intent_recorded', 'service_account_create_sent', 'service_account_created',
    'role_update_sent', 'service_account_ready', 'api_key_create_sent',
    'candidate_staged', 'candidate_activated', 'candidate_abandoned', 'unresolved'
  )),
  service_account_id text,
  api_key_id text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, command_id),
  unique (tenant_id, reference, candidate_version),
  foreign key (tenant_id, reference) references orgward.secret_references (tenant_id, reference) on delete restrict,
  foreign key (tenant_id, actor) references orgward.oidc_principals (tenant_id, principal) on delete restrict,
  check ((service_account_id is null) or (service_account_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')),
  check ((api_key_id is null) or (api_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')),
  check (failure_code is null or failure_code in ('provider_unavailable', 'provider_response_ambiguous', 'provider_response_invalid', 'persistence_failed')),
  check (status not in ('candidate_staged','candidate_activated','candidate_abandoned')
    or (service_account_id is not null and api_key_id is not null))
);

create index secret_openai_provisioning_unresolved_idx
  on orgward.secret_openai_provisioning_commands (tenant_id, updated_at)
  where status not in ('candidate_staged','candidate_activated','candidate_abandoned');
