create table orgward.tenant_deepseek_profile_verifications (
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  profile_id text not null check (profile_id ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  attempt_id uuid not null,
  profile_revision integer not null check (profile_revision >= 1),
  credential_version integer not null check (credential_version >= 1),
  status text not null check (status in ('checking', 'verified', 'auth_failed', 'unknown', 'stale')),
  requested_at timestamptz not null,
  checked_at timestamptz,
  cooldown_until timestamptz not null,
  primary key (tenant_id, profile_id),
  foreign key (tenant_id, profile_id)
    references orgward.tenant_deepseek_profiles (tenant_id, profile_id)
    on delete cascade
);
