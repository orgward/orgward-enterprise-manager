create unique index aggregates_execution_process_task_once_idx
  on orgward.aggregates (
    tenant_id,
    (state->'processTaskRef'->>'planInstanceId'),
    (state->'processTaskRef'->>'taskId')
  )
  where aggregate_kind = 'execution_run' and state ? 'processTaskRef';

create function orgward.prevent_execution_process_task_ref_change() returns trigger
language plpgsql as $$
begin
  if old.aggregate_kind = 'execution_run'
    and old.state->'processTaskRef' is distinct from new.state->'processTaskRef' then
    raise exception 'Execution process task references are immutable.';
  end if;
  return new;
end;
$$;

create trigger execution_process_task_ref_immutable
  before update on orgward.aggregates
  for each row execute function orgward.prevent_execution_process_task_ref_change();
