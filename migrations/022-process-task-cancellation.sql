alter table orgward.process_task_instances
  drop constraint process_task_instances_status_check;

alter table orgward.process_task_instances
  add constraint process_task_instances_status_check
  check (status in ('PLANNED', 'IN_PROGRESS', 'ESCALATED', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'));

alter table orgward.process_task_instances
  drop constraint process_task_instances_runtime_time_check;

alter table orgward.process_task_instances
  add constraint process_task_instances_runtime_time_check
  check ((status in ('IN_PROGRESS', 'ESCALATED') and started_at is not null and completed_at is null)
      or (status in ('SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is not null)
      or (status = 'CANCELLED' and completed_at is not null)
      or (status not in ('IN_PROGRESS', 'ESCALATED', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED') and completed_at is null));

create function orgward.guard_process_task_cancellation() returns trigger
language plpgsql as $$
declare
  prior_event_count integer;
  cancellation_event jsonb;
  run_state jsonb;
  matching_cancellation_events integer;
begin
  if old.status = 'CANCELLED' and (
    new.status is distinct from old.status
    or new.version is distinct from old.version
    or new.outcome is distinct from old.outcome
    or new.evidence is distinct from old.evidence
    or new.started_at is distinct from old.started_at
    or new.completed_at is distinct from old.completed_at
    or new.created_at is distinct from old.created_at
    or new.updated_at is distinct from old.updated_at
    or new.events is distinct from old.events
  ) then
    raise exception 'A cancelled process task runtime is terminal and immutable.';
  end if;

  if new.status is distinct from old.status and new.status = 'CANCELLED' then
    if old.actor_type is distinct from 'workload'
      or old.status not in ('AWAITING_APPROVAL', 'APPROVED')
      or old.execution_run_id is null
      or old.started_at is not null
      or new.started_at is distinct from old.started_at
      or new.completed_at is null
      or new.version <> old.version + 1 then
      raise exception 'Only an unstarted linked workload task can be cancelled from pending or approved.';
    end if;
    prior_event_count := jsonb_array_length(old.events);
    if jsonb_array_length(new.events) <> prior_event_count + 1 then
      raise exception 'Cancelling a process task requires exactly one appended runtime event.';
    end if;
    cancellation_event := new.events->prior_event_count;
    if cancellation_event->>'type' is distinct from 'ProcessTaskRunStatusChanged'
      or cancellation_event->'data'->>'runId' is distinct from old.execution_run_id
      or cancellation_event->'data'->>'status' is distinct from 'CANCELLED' then
      raise exception 'The cancellation runtime event must identify its linked cancelled run.';
    end if;
    select state into run_state from orgward.aggregates
    where tenant_id = old.tenant_id and aggregate_kind = 'execution_run'
      and aggregate_id = old.execution_run_id;
    if run_state is null
      or run_state->>'status' is distinct from 'CANCELLED'
      or run_state->'processTaskRef'->>'processPlanId' is distinct from old.process_plan_id
      or run_state->'processTaskRef'->>'revision' is distinct from old.plan_revision::text
      or run_state->'processTaskRef'->>'planInstanceId' is distinct from old.plan_instance_id::text
      or run_state->'processTaskRef'->>'taskId' is distinct from old.task_id
      or run_state->'processTaskRef'->>'blueprintId' is distinct from old.blueprint_id
      or run_state->'processTaskRef'->>'blueprintVersion' is distinct from old.blueprint_version::text
      or run_state->'processTaskRef'->>'actorId' is distinct from old.actor_id
      or run_state->'processTaskRef'->>'roleId' is distinct from old.role_id
      or cancellation_event->'data'->>'runVersion' is distinct from run_state->>'version' then
      raise exception 'The cancellation event does not match the linked run aggregate.';
    end if;
    if length(trim(coalesce(cancellation_event->>'causationId', ''))) = 0 then
      raise exception 'The cancellation runtime event requires its command causation ID.';
    end if;
    select count(*) into matching_cancellation_events
    from jsonb_array_elements(coalesce(run_state->'events', '[]'::jsonb)) as run_event(value)
    where run_event.value->>'type' = 'ExecutionCancelled'
      and run_event.value->>'causationId' = cancellation_event->>'causationId';
    if matching_cancellation_events <> 1 then
      raise exception 'The runtime cancellation command must match exactly one linked run cancellation event.';
    end if;
  end if;
  return new;
end;
$$;

create trigger process_task_cancellation_guard
  before update on orgward.process_task_instances
  for each row execute function orgward.guard_process_task_cancellation();

create function orgward.prevent_cancelled_process_task_insert() returns trigger
language plpgsql as $$
begin
  if new.status = 'CANCELLED' then
    raise exception 'A process task cannot be inserted in a cancelled state.';
  end if;
  return new;
end;
$$;

create trigger process_task_cancelled_insert_guard
  before insert on orgward.process_task_instances
  for each row execute function orgward.prevent_cancelled_process_task_insert();
