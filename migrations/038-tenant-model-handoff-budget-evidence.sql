alter table orgward.provider_dispatch_attempts
  add column model_provider text,
  add column model_id text,
  add column profile_revision text,
  add column prompt_bytes integer,
  add column prompt_byte_ceiling integer,
  add column requested_output_tokens integer,
  add column timeout_ms integer,
  add column tool_count integer,
  add column usage_status text,
  add column usage_input_tokens integer,
  add column usage_output_tokens integer,
  add column usage_total_tokens integer,
  add column usage_reason text,
  add column cost_status text;

alter table orgward.provider_dispatch_attempts
  add constraint provider_dispatch_attempts_model_provider_check
    check (model_provider is null or model_provider in ('openai', 'deepseek')),
  add constraint provider_dispatch_attempts_model_envelope_check
    check (model_provider is null or (
      length(model_id) between 1 and 100
      and length(profile_revision) between 1 and 120
      and prompt_bytes between 1 and 16384
      and prompt_byte_ceiling = 16384
      and requested_output_tokens between 1 and 2000
      and timeout_ms between 1 and 20000
      and tool_count = 0
      and cost_status = 'unknown'
      and usage_status in ('reserved', 'reported', 'unreported', 'dispatch_not_started', 'outcome_unknown')
      and ((usage_status = 'reported'
          and usage_input_tokens >= 0 and usage_output_tokens >= 0
          and usage_total_tokens = usage_input_tokens + usage_output_tokens
          and usage_reason is null)
        or (usage_status <> 'reported'
          and usage_input_tokens is null and usage_output_tokens is null and usage_total_tokens is null
          and ((usage_status = 'unreported' and usage_reason in ('usage_missing', 'usage_invalid'))
            or (usage_status in ('reserved', 'dispatch_not_started', 'outcome_unknown') and usage_reason is null))))
    )),
  add constraint provider_dispatch_attempts_model_fields_absent_check
    check (model_provider is not null or (
      model_id is null and profile_revision is null and prompt_bytes is null
      and prompt_byte_ceiling is null and requested_output_tokens is null
      and timeout_ms is null and tool_count is null and usage_status is null
      and usage_input_tokens is null and usage_output_tokens is null
      and usage_total_tokens is null and usage_reason is null and cost_status is null
    ));

create table orgward.tenant_model_handoff_controls (
  tenant_id text primary key check (tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
  active_run_id text,
  active_attempt_id text,
  active_status text check (active_status in ('reserved', 'handed_off')),
  updated_at timestamptz not null default now(),
  check ((active_run_id is null and active_attempt_id is null and active_status is null)
    or (active_run_id is not null and active_attempt_id is not null and active_status is not null)),
  foreign key (tenant_id, active_run_id)
    references orgward.provider_dispatch_attempts (tenant_id, run_id) on delete restrict
);

do $$
begin
  if exists (
    select d.tenant_id
    from orgward.provider_dispatch_attempts d
    join orgward.aggregates a on a.tenant_id=d.tenant_id
      and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
    where d.status in ('reserved','handed_off')
      and a.state #>> '{profile,kind}' in ('provider-openai','provider-deepseek')
    group by d.tenant_id having count(*) > 1
  ) then
    raise exception 'cannot install tenant model single-flight while a tenant has multiple active model handoffs';
  end if;
end;
$$;

insert into orgward.tenant_model_handoff_controls
  (tenant_id,active_run_id,active_attempt_id,active_status)
select d.tenant_id,d.run_id,d.attempt_id,d.status
from orgward.provider_dispatch_attempts d
join orgward.aggregates a on a.tenant_id=d.tenant_id
  and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
where d.status in ('reserved','handed_off')
  and a.state #>> '{profile,kind}' in ('provider-openai','provider-deepseek');

create function orgward.sync_tenant_model_handoff_control() returns trigger
language plpgsql as $$
begin
  if new.status = 'handed_off' and old.status = 'reserved' then
    update orgward.tenant_model_handoff_controls
    set active_status='handed_off',updated_at=now()
    where tenant_id=new.tenant_id and active_run_id=new.run_id and active_attempt_id=new.attempt_id;
  elsif new.status in ('completed','cancelled','outcome_unknown') and old.status is distinct from new.status then
    if new.status = 'cancelled' and old.status = 'reserved' and new.model_provider is not null then
      new.usage_status := 'dispatch_not_started';
      new.usage_reason := null;
    elsif new.status = 'outcome_unknown' and new.model_provider is not null then
      new.usage_status := 'outcome_unknown';
      new.usage_input_tokens := null;
      new.usage_output_tokens := null;
      new.usage_total_tokens := null;
      new.usage_reason := null;
    end if;
    update orgward.tenant_model_handoff_controls
    set active_run_id=null,active_attempt_id=null,active_status=null,updated_at=now()
    where tenant_id=new.tenant_id and active_run_id=new.run_id and active_attempt_id=new.attempt_id;
  end if;
  return new;
end;
$$;

create trigger provider_dispatch_attempt_model_budget_control
  before update of status on orgward.provider_dispatch_attempts
  for each row execute function orgward.sync_tenant_model_handoff_control();
