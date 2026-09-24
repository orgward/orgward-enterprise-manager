alter table orgward.secret_upstream_revocation_obligations
  add column claim_token uuid,
  add column claim_until timestamptz,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz not null default now(),
  add column last_attempt_at timestamptz;

alter table orgward.secret_upstream_revocation_obligations
  add constraint secret_revocation_claim_pair_check
    check ((claim_token is null and claim_until is null) or (claim_token is not null and claim_until is not null));

create index secret_revocation_due_idx
  on orgward.secret_upstream_revocation_obligations (next_attempt_at, created_at)
  where status = 'unconfirmed' and provider = 'openai'
    and target_provenance = 'orgward_created_exclusive_service_account';
