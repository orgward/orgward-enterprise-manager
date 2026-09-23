alter table orgward.oidc_principal_events
  drop constraint oidc_principal_events_event_type_check;
alter table orgward.oidc_principal_events
  drop constraint oidc_principal_events_check;
alter table orgward.oidc_principal_events
  add column roles text[] not null default '{}';
alter table orgward.oidc_principal_events
  add constraint oidc_principal_events_event_type_check
  check (event_type in (
    'PrincipalAuthenticated', 'PrincipalClaimsUpdated', 'PrincipalRevoked',
    'PrincipalBootstrapped', 'PrincipalRolesChanged'
  ));
alter table orgward.oidc_principal_events
  add constraint oidc_principal_events_check
  check (
    (event_type in ('PrincipalAuthenticated', 'PrincipalClaimsUpdated') and reason is null)
    or (event_type in ('PrincipalRevoked', 'PrincipalRolesChanged') and reason is not null and length(trim(reason)) between 1 and 500)
    or (event_type = 'PrincipalBootstrapped' and reason = 'operator_configured_bootstrap')
  );

create table orgward.oidc_bootstrap_grants (
  tenant_id text not null,
  principal text not null,
  issuer text not null,
  roles text[] not null check (roles = array['tenant-admin', 'workspace-read', 'workspace-write']::text[]),
  granted_at timestamptz not null default now(),
  primary key (tenant_id, principal),
  foreign key (principal, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict
);
