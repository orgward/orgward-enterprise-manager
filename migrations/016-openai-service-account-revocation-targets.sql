alter table orgward.secret_upstream_revocation_obligations
  add column provider_organization_id text,
  add column provider_project_id text,
  add column provider_service_account_id text,
  add column provider_api_key_id text,
  add column target_provenance text;

alter table orgward.secret_upstream_revocation_obligations
  add constraint secret_revocation_target_provenance_check
    check (target_provenance is null or target_provenance = 'orgward_created_exclusive_service_account'),
  add constraint secret_revocation_target_complete_check
    check (
      (provider_organization_id is null and provider_project_id is null
        and provider_service_account_id is null and provider_api_key_id is null
        and target_provenance is null)
      or
      (provider_organization_id is not null and provider_project_id is not null
        and provider_service_account_id is not null and provider_api_key_id is not null
        and provider_organization_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
        and provider_project_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
        and provider_service_account_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
        and provider_api_key_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
        and target_provenance = 'orgward_created_exclusive_service_account')
    );

create index secret_revocation_eligible_idx
  on orgward.secret_upstream_revocation_obligations (created_at)
  where status = 'unconfirmed' and target_provenance = 'orgward_created_exclusive_service_account';
