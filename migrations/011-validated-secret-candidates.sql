alter table orgward.secret_references drop constraint secret_references_version_check;
alter table orgward.secret_references add constraint secret_references_version_check check (version >= 0);
alter table orgward.secret_references add constraint secret_references_zero_only_staged_check
  check (version > 0 or (status = 'revoked' and ciphertext is null and nonce is null and auth_tag is null));

alter table orgward.secret_references
  add column upstream_revocation_status text not null default 'not_applicable'
    check (upstream_revocation_status in ('unconfirmed', 'confirmed', 'not_applicable')),
  add column active_provider text check (active_provider in ('openai')),
  add column active_model text,
  add column candidate_version integer,
  add column candidate_generation integer not null default 0 check (candidate_generation >= 0),
  add column candidate_ciphertext bytea,
  add column candidate_nonce bytea,
  add column candidate_auth_tag bytea,
  add column candidate_model text,
  add column candidate_expires_at timestamptz,
  add column candidate_status text check (candidate_status in ('staged', 'validated', 'rejected')),
  add column candidate_validated_at timestamptz,
  add constraint secret_candidate_envelope_check check (
    (candidate_version is null and candidate_ciphertext is null and candidate_nonce is null
      and candidate_auth_tag is null and candidate_model is null and candidate_status is null
      and candidate_validated_at is null and candidate_expires_at is null)
    or (candidate_version is not null and candidate_version > 0 and candidate_ciphertext is not null
      and candidate_nonce is not null and candidate_auth_tag is not null and candidate_model is not null
      and candidate_status is not null and candidate_expires_at is not null)
  );

alter table orgward.secret_references add constraint secret_active_provider_check
  check ((active_provider is null and active_model is null) or (active_provider = 'openai' and active_model is not null));
