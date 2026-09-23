create table orgward.secret_upstream_revocation_obligations (
  tenant_id text not null,
  reference text not null,
  credential_version integer not null check (credential_version > 0),
  provider text not null check (provider in ('openai', 'unspecified')),
  status text not null default 'unconfirmed' check (status in ('unconfirmed', 'confirmed')),
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_by text not null,
  created_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  confirmation_evidence text,
  primary key (tenant_id, reference, credential_version),
  foreign key (tenant_id, reference) references orgward.secret_references (tenant_id, reference) on delete restrict,
  foreign key (tenant_id, created_by) references orgward.oidc_principals (tenant_id, principal) on delete restrict,
  foreign key (tenant_id, confirmed_by) references orgward.oidc_principals (tenant_id, principal) on delete restrict,
  check ((status = 'unconfirmed' and confirmed_by is null and confirmed_at is null and confirmation_evidence is null)
    or (status = 'confirmed' and confirmed_by is not null and confirmed_at is not null and confirmation_evidence is not null))
);

create index secret_upstream_revocation_obligations_status_idx
  on orgward.secret_upstream_revocation_obligations (tenant_id, status, reference, credential_version);

-- Preserve the latest unresolved predecessor summarized by migration 011.
-- Earlier generations lost by the old single-field summary cannot be reconstructed.
insert into orgward.secret_upstream_revocation_obligations
  (tenant_id, reference, credential_version, provider, status, reason, created_by, created_at)
select tenant_id, reference, version - 1,
  case when active_provider = 'openai' then 'openai' else 'unspecified' end,
  'unconfirmed', 'Upstream credential revocation was not confirmed before this migration.', updated_by, updated_at
from orgward.secret_references
where upstream_revocation_status = 'unconfirmed' and version > 1
on conflict (tenant_id, reference, credential_version) do nothing;
