create table orgward.project_actor_binding_proposals (
  tenant_id text not null,
  project_kind text not null default 'project' check (project_kind = 'project'),
  project_id text not null,
  blueprint_version integer not null check (blueprint_version > 0),
  actor_id text not null check (actor_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$'),
  role_id text not null check (role_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$'),
  target_principal text not null,
  target_membership_generation bigint not null check (target_membership_generation > 0),
  target_authz_generation bigint not null check (target_authz_generation > 0),
  status text not null default 'proposed' check (status = 'proposed'),
  proposed_by text not null,
  proposed_at timestamptz not null default now(),
  primary key (tenant_id, project_id, blueprint_version, actor_id, role_id),
  foreign key (tenant_id, project_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id) on delete restrict,
  foreign key (tenant_id, target_principal)
    references orgward.oidc_principals (tenant_id, principal) on delete restrict,
  foreign key (tenant_id, proposed_by)
    references orgward.oidc_principals (tenant_id, principal) on delete restrict
);

create index project_actor_binding_proposals_project_idx
  on orgward.project_actor_binding_proposals (tenant_id, project_id, blueprint_version, proposed_at desc);
