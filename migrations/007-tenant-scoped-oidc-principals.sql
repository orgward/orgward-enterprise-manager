alter table orgward.oidc_principals
  drop constraint oidc_principals_pkey;

alter table orgward.oidc_principals
  add constraint oidc_principals_pkey primary key (tenant_id, principal);
