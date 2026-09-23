create table orgward.secret_references (
  tenant_id text not null,
  reference text not null check (reference ~ '^secret-[a-z0-9][a-z0-9._-]{0,79}$'),
  version integer not null check (version > 0),
  status text not null check (status in ('active', 'revoked')),
  ciphertext bytea,
  nonce bytea,
  auth_tag bytea,
  created_by text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, reference),
  check (
    (status = 'active' and ciphertext is not null and nonce is not null and auth_tag is not null)
    or (status = 'revoked' and ciphertext is null and nonce is null and auth_tag is null)
  ),
  foreign key (created_by, tenant_id)
    references orgward.oidc_principals (principal, tenant_id) on delete restrict,
  foreign key (updated_by, tenant_id)
    references orgward.oidc_principals (principal, tenant_id) on delete restrict
);

create table orgward.secret_reference_events (
  id bigint generated always as identity primary key,
  event_id text not null unique,
  tenant_id text not null,
  reference text not null,
  version integer not null check (version > 0),
  event_type text not null check (event_type in ('SecretReferenceCreated', 'SecretReferenceRotated', 'SecretReferenceRevoked')),
  actor text not null,
  reason text not null check (length(trim(reason)) between 1 and 500),
  event jsonb not null check (jsonb_typeof(event) = 'object'),
  event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, reference)
    references orgward.secret_references (tenant_id, reference) on delete restrict,
  foreign key (actor, tenant_id)
    references orgward.oidc_principals (principal, tenant_id) on delete restrict
);

create index secret_reference_events_tenant_idx
  on orgward.secret_reference_events (tenant_id, reference, id desc);
