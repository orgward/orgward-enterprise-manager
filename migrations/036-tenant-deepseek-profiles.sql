create table orgward.tenant_deepseek_profiles (
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  profile_id text not null check (profile_id ~ '^[a-z0-9][a-z0-9_-]{1,79}$'),
  revision integer not null check (revision >= 1),
  label text not null check (length(btrim(label)) between 1 and 120),
  model_id text not null check (model_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  credential_reference text not null check (credential_reference ~ '^secret-[a-z0-9][a-z0-9._-]{0,79}$'),
  max_output_tokens integer not null check (max_output_tokens between 64 and 512),
  enabled boolean not null,
  created_by text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, profile_id)
);

create index tenant_deepseek_profiles_enabled_idx
  on orgward.tenant_deepseek_profiles (tenant_id, profile_id) where enabled;
