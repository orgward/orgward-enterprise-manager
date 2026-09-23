create table orgward.oidc_sessions (
  session_hash text primary key check (session_hash ~ '^[a-f0-9]{64}$'),
  issuer text not null check (length(issuer) between 1 and 2048),
  principal text not null check (principal ~ '^oidc:[a-f0-9]{64}$'),
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  roles text[] not null default '{}' check (cardinality(roles) <= 64),
  actor_type text not null check (actor_type in ('human', 'workload')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index oidc_sessions_expiry_idx on orgward.oidc_sessions (expires_at);
create index oidc_sessions_tenant_principal_idx on orgward.oidc_sessions (tenant_id, principal, expires_at);
