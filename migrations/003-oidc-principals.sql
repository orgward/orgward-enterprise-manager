create table orgward.oidc_principals (
  principal text primary key check (principal ~ '^oidc:[a-f0-9]{64}$'),
  issuer text not null check (length(issuer) between 1 and 2048),
  tenant_id text not null check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  actor_type text not null check (actor_type in ('human', 'workload')),
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  roles text[] not null default '{}' check (cardinality(roles) <= 64),
  status text not null default 'active' check (status in ('active', 'revoked')),
  authz_generation bigint not null default 1 check (authz_generation > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_authenticated_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  revocation_reason text,
  unique (principal, tenant_id),
  check (
    (status = 'active' and revoked_at is null and revoked_by is null and revocation_reason is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by is not null
      and revocation_reason is not null and length(trim(revocation_reason)) between 1 and 500)
  )
);

create index oidc_principals_tenant_status_idx on orgward.oidc_principals (tenant_id, status, principal);

insert into orgward.oidc_principals (principal, issuer, tenant_id, actor_type, display_name, roles)
select distinct on (principal) principal, issuer, tenant_id, actor_type, principal, roles
from orgward.oidc_sessions
order by principal, created_at desc;

alter table orgward.oidc_sessions
  add constraint oidc_sessions_principal_tenant_fk
  foreign key (principal, tenant_id)
  references orgward.oidc_principals (principal, tenant_id)
  on delete restrict;

create table orgward.oidc_principal_events (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  principal text not null,
  event_type text not null check (event_type in ('PrincipalAuthenticated', 'PrincipalClaimsUpdated', 'PrincipalRevoked')),
  actor text not null,
  authz_generation bigint not null check (authz_generation > 0),
  reason text,
  recorded_at timestamptz not null default now(),
  foreign key (principal, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict,
  check (
    (event_type in ('PrincipalAuthenticated', 'PrincipalClaimsUpdated') and reason is null)
    or (event_type = 'PrincipalRevoked' and reason is not null and length(trim(reason)) between 1 and 500)
  )
);

create index oidc_principal_events_subject_idx
  on orgward.oidc_principal_events (tenant_id, principal, id desc);
