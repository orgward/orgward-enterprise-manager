alter table orgward.tenant_model_handoff_controls
  add column daily_output_token_limit integer check (daily_output_token_limit is null or daily_output_token_limit between 1 and 10000000),
  add column budget_revision integer not null default 0 check (budget_revision >= 0),
  add column budget_updated_by text,
  add column budget_reason text,
  add column budget_updated_at timestamptz,
  add constraint tenant_model_handoff_controls_budget_metadata_check check (
    (budget_revision = 0 and budget_updated_by is null and budget_reason is null and budget_updated_at is null)
    or (budget_revision > 0 and daily_output_token_limit is not null and budget_updated_by is not null
      and budget_reason is not null and budget_updated_at is not null)
  ),
  add constraint tenant_model_handoff_controls_budget_updated_by_fk
    foreign key (tenant_id, budget_updated_by)
    references orgward.oidc_principals (tenant_id, principal) on delete restrict;
