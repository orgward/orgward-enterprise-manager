alter table orgward.project_actor_binding_proposals
  drop constraint project_actor_binding_proposals_status_check;

alter table orgward.project_actor_binding_proposals
  add constraint project_actor_binding_proposals_status_check
    check (status in ('proposed', 'enabled')),
  add column enabled_by text,
  add column enabled_at timestamptz,
  add constraint project_actor_binding_proposals_enabled_by_fk
    foreign key (tenant_id, enabled_by) references orgward.oidc_principals (tenant_id, principal),
  add constraint project_actor_binding_proposals_enabled_metadata_check
    check ((status = 'enabled') = (enabled_by is not null and enabled_at is not null));
