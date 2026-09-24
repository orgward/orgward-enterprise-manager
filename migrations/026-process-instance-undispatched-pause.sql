alter table orgward.process_task_instances
  drop constraint process_task_instances_runtime_time_check;

alter table orgward.process_task_instances
  add constraint process_task_instances_runtime_time_check
  check ((status in ('IN_PROGRESS', 'ESCALATED') and started_at is not null and completed_at is null)
      or (status in ('SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is not null)
      or (status = 'CANCELLED' and completed_at is not null)
      or (status = 'PAUSED' and started_at is null and completed_at is null)
      or (status = 'RUNNING' and completed_at is null)
      or (status not in ('IN_PROGRESS', 'ESCALATED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED') and completed_at is null));

do $$
declare
  definition text;
begin
  select pg_get_functiondef('orgward.guard_process_task_cancellation()'::regprocedure) into definition;
  definition := replace(definition,
    $a$new.status = 'PAUSED' and old.status not in ('AWAITING_APPROVAL', 'APPROVED')$a$,
    $b$new.status = 'PAUSED' and old.status not in ('AWAITING_APPROVAL', 'APPROVED', 'RUNNING')$b$);
  definition := replace(definition,
    $a$or old.started_at is not null$a$,
    $b$or (old.started_at is not null and old.status <> 'RUNNING')$b$);
  definition := replace(definition,
    $a$or new.started_at is distinct from old.started_at$a$,
    $b$or (new.started_at is distinct from old.started_at and old.status <> 'RUNNING')$b$);
  if definition not like '%new.status = ''PAUSED'' and old.status not in (''AWAITING_APPROVAL'', ''APPROVED'', ''RUNNING'')%'
    or definition not like '%old.started_at is not null and old.status <> ''RUNNING''%'
    or definition not like '%new.started_at is distinct from old.started_at and old.status <> ''RUNNING''%' then
    raise exception 'The linked runtime guard does not expose the expected narrowly scoped undispatched pause transition.';
  end if;
  execute definition;
end;
$$;

create function orgward.guard_process_task_instance_undispatched_pause() returns trigger
language plpgsql as $$
declare
  control_status text;
begin
  if old.actor_type = 'workload' and old.status = 'RUNNING' and new.status = 'PAUSED' then
    select status into control_status from orgward.process_task_instance_controls
    where tenant_id = old.tenant_id and plan_instance_id = old.plan_instance_id;
    if control_status is distinct from 'PAUSE_REQUESTED' or new.started_at is not null
      or exists (select 1 from orgward.provider_dispatch_attempts
        where tenant_id = old.tenant_id and run_id = old.execution_run_id
          and status in ('reserved', 'handed_off', 'outcome_unknown', 'completed')) then
      raise exception 'Only work known not to have been handed to a provider may pause at an instance boundary.';
    end if;
  end if;
  return new;
end;
$$;

create trigger process_task_instance_undispatched_pause_guard
  before update on orgward.process_task_instances
  for each row execute function orgward.guard_process_task_instance_undispatched_pause();
