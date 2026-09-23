alter table orgward.secret_references
  add column expires_at timestamptz;

create index secret_references_expiry_idx
  on orgward.secret_references (tenant_id, expires_at)
  where status = 'active';
