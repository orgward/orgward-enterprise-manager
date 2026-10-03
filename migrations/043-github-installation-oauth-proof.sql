alter table orgward.github_app_installation_intents
  add column if not exists provisional_installation_id text,
  add column if not exists provisional_app_id text,
  add column if not exists provisional_account_id text,
  add column if not exists provisional_account_login text,
  add column if not exists provisional_account_type text;

alter table orgward.github_app_installations
  add column if not exists github_account_id text,
  add column if not exists github_user_id text,
  add column if not exists github_user_login text;

alter table orgward.github_app_installation_intents
  add constraint github_installation_intents_provisional_shape check (
    (provisional_installation_id is null and provisional_app_id is null and provisional_account_id is null
      and provisional_account_login is null and provisional_account_type is null)
    or (provisional_installation_id is not null and provisional_app_id is not null and provisional_account_id is not null
      and provisional_account_login is not null and provisional_account_type is not null
      and provisional_installation_id ~ '^[1-9][0-9]{0,15}$' and provisional_app_id ~ '^[1-9][0-9]{0,15}$'
      and provisional_account_id ~ '^[1-9][0-9]{0,15}$' and length(provisional_account_login) between 1 and 100
      and provisional_account_type in ('User','Organization','Enterprise'))
  );
