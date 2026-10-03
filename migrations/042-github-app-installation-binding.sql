create table if not exists orgward.github_app_installations (
  installation_id text primary key check (installation_id ~ '^[1-9][0-9]{0,15}$'),
  tenant_id text not null,
  app_id text not null check (app_id ~ '^[1-9][0-9]{0,19}$'),
  account_login text not null check (length(account_login) between 1 and 100),
  account_type text not null check (account_type in ('User','Organization','Enterprise')),
  connected_by text not null,
  connection_revision integer not null default 1 check (connection_revision > 0),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists github_app_installations_tenant
  on orgward.github_app_installations (tenant_id, account_login, installation_id);

create table if not exists orgward.github_app_installation_intents (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  tenant_id text not null,
  project_id text not null,
  principal text not null,
  authz_generation bigint not null check (authz_generation > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists github_app_installation_intents_expiry
  on orgward.github_app_installation_intents (expires_at);
