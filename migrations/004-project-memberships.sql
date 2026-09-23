create table orgward.project_memberships (
  tenant_id text not null,
  project_kind text not null default 'project' check (project_kind = 'project'),
  project_id text not null check (project_id ~ '^project-[0-9a-f-]{36}$'),
  principal text not null,
  access text not null check (access in ('owner', 'editor', 'reader')),
  generation bigint not null default 1 check (generation > 0),
  granted_by text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  primary key (tenant_id, project_id, principal),
  foreign key (tenant_id, project_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id)
    on delete restrict,
  foreign key (principal, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict,
  foreign key (granted_by, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict,
  foreign key (revoked_by, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict,
  check ((revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null))
);

create unique index project_memberships_single_owner_idx
  on orgward.project_memberships (tenant_id, project_id)
  where access = 'owner' and revoked_at is null;
create index project_memberships_principal_idx
  on orgward.project_memberships (tenant_id, principal, project_id)
  where revoked_at is null;

create table orgward.project_membership_events (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  project_kind text not null default 'project' check (project_kind = 'project'),
  project_id text not null,
  principal text not null,
  event_type text not null check (event_type in ('MembershipGranted', 'MembershipRevoked')),
  access text not null check (access in ('owner', 'editor', 'reader')),
  actor text not null,
  generation bigint not null check (generation > 0),
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id, project_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id)
    on delete restrict,
  foreign key (principal, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict,
  foreign key (actor, tenant_id)
    references orgward.oidc_principals (principal, tenant_id)
    on delete restrict
);
create index project_membership_events_project_idx
  on orgward.project_membership_events (tenant_id, project_id, id);

insert into orgward.project_memberships
  (tenant_id, project_id, principal, access, granted_by)
select a.tenant_id, a.aggregate_id, a.state->>'createdBy', 'owner', a.state->>'createdBy'
from orgward.aggregates a
join orgward.oidc_principals p
  on p.principal = a.state->>'createdBy' and p.tenant_id = a.tenant_id and p.status = 'active'
where a.aggregate_kind = 'project'
  and a.state->>'createdBy' ~ '^oidc:[a-f0-9]{64}$'
on conflict (tenant_id, project_id, principal) do nothing;
