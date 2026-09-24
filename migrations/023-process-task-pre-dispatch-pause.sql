alter table orgward.process_task_instances
  drop constraint process_task_instances_status_check;

alter table orgward.process_task_instances
  add constraint process_task_instances_status_check
  check (status in ('PLANNED', 'IN_PROGRESS', 'ESCALATED', 'AWAITING_APPROVAL', 'APPROVED', 'PAUSED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED'));

alter table orgward.process_task_instances
  drop constraint process_task_instances_runtime_time_check;

alter table orgward.process_task_instances
  add constraint process_task_instances_runtime_time_check
  check ((status in ('IN_PROGRESS', 'ESCALATED') and started_at is not null and completed_at is null)
      or (status in ('SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is not null)
      or (status = 'CANCELLED' and completed_at is not null)
      or (status = 'PAUSED' and started_at is null and completed_at is null)
      or (status not in ('IN_PROGRESS', 'ESCALATED', 'SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED') and completed_at is null));

create or replace function orgward.guard_process_task_cancellation() returns trigger
language plpgsql as $$
declare
  prior_event_count integer;
  transition_event jsonb;
  run_state jsonb;
  expected_run_event_type text;
  matching_events integer;
begin
  if old.status = 'PAUSED' and (
    new.outcome is distinct from old.outcome
    or new.evidence is distinct from old.evidence
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
    or (new.status = 'PAUSED' and (
      new.version is distinct from old.version
      or new.updated_at is distinct from old.updated_at
      or new.completed_at is distinct from old.completed_at
      or new.events is distinct from old.events
    ))
  ) then
    raise exception 'A paused process task cannot change its outcome, evidence, or start snapshot.';
  end if;

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

  if old.actor_type = 'workload' and old.status = 'PAUSED'
    and new.status not in ('AWAITING_APPROVAL', 'CANCELLED') then
    raise exception 'A paused workload task can only resume for fresh approval or be cancelled.';
  end if;

  if new.status is distinct from old.status and new.status in ('PAUSED', 'AWAITING_APPROVAL')
    and (new.status = 'PAUSED' or old.status = 'PAUSED') then
    if old.actor_type is distinct from 'workload'
      or (new.status = 'PAUSED' and old.status not in ('AWAITING_APPROVAL', 'APPROVED'))
      or (new.status = 'AWAITING_APPROVAL' and old.status is distinct from 'PAUSED')
      or old.execution_run_id is null
      or old.started_at is not null
      or new.started_at is distinct from old.started_at
      or new.completed_at is not null
      or new.version <> old.version + 1 then
      raise exception 'Only an unstarted linked workload task may pause before dispatch or resume for fresh approval.';
    end if;
    prior_event_count := jsonb_array_length(old.events);
    if jsonb_array_length(new.events) <> prior_event_count + 1 then
      raise exception 'Pausing or resuming a process task requires exactly one appended runtime event.';
    end if;
    transition_event := new.events->prior_event_count;
    expected_run_event_type := case when new.status = 'PAUSED' then 'ExecutionPaused' else 'ExecutionResumed' end;
    if transition_event->>'type' is distinct from 'ProcessTaskRunStatusChanged'
      or transition_event->'data'->>'runId' is distinct from old.execution_run_id
      or transition_event->'data'->>'status' is distinct from new.status then
      raise exception 'The pause runtime event must identify its linked run and resulting status.';
    end if;
    select state into run_state from orgward.aggregates
    where tenant_id = old.tenant_id and aggregate_kind = 'execution_run'
      and aggregate_id = old.execution_run_id;
    if run_state is null
      or run_state->>'status' is distinct from new.status
      or run_state->'processTaskRef'->>'processPlanId' is distinct from old.process_plan_id
      or run_state->'processTaskRef'->>'revision' is distinct from old.plan_revision::text
      or run_state->'processTaskRef'->>'planInstanceId' is distinct from old.plan_instance_id::text
      or run_state->'processTaskRef'->>'taskId' is distinct from old.task_id
      or run_state->'processTaskRef'->>'blueprintId' is distinct from old.blueprint_id
      or run_state->'processTaskRef'->>'blueprintVersion' is distinct from old.blueprint_version::text
      or run_state->'processTaskRef'->>'actorId' is distinct from old.actor_id
      or run_state->'processTaskRef'->>'roleId' is distinct from old.role_id
      or transition_event->'data'->>'runVersion' is distinct from run_state->>'version' then
      raise exception 'The pause runtime event does not match the linked run aggregate.';
    end if;
    if length(trim(coalesce(transition_event->>'causationId', ''))) = 0 then
      raise exception 'The pause runtime event requires its command causation ID.';
    end if;
    select count(*) into matching_events
    from jsonb_array_elements(coalesce(run_state->'events', '[]'::jsonb)) as run_event(value)
    where run_event.value->>'type' = expected_run_event_type
      and run_event.value->>'causationId' = transition_event->>'causationId';
    if matching_events <> 1 then
      raise exception 'The task pause or resume must match exactly one linked run event.';
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'CANCELLED' then
    if old.actor_type is distinct from 'workload'
      or old.status not in ('AWAITING_APPROVAL', 'APPROVED', 'PAUSED')
      or old.execution_run_id is null
      or old.started_at is not null
      or new.started_at is distinct from old.started_at
      or new.completed_at is null
      or new.version <> old.version + 1 then
      raise exception 'Only an unstarted linked workload task can be cancelled from pending, approved, or paused.';
    end if;
    prior_event_count := jsonb_array_length(old.events);
    if jsonb_array_length(new.events) <> prior_event_count + 1 then
      raise exception 'Cancelling a process task requires exactly one appended runtime event.';
    end if;
    transition_event := new.events->prior_event_count;
    if transition_event->>'type' is distinct from 'ProcessTaskRunStatusChanged'
      or transition_event->'data'->>'runId' is distinct from old.execution_run_id
      or transition_event->'data'->>'status' is distinct from 'CANCELLED' then
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
      or transition_event->'data'->>'runVersion' is distinct from run_state->>'version' then
      raise exception 'The cancellation event does not match the linked run aggregate.';
    end if;
    if length(trim(coalesce(transition_event->>'causationId', ''))) = 0 then
      raise exception 'The cancellation runtime event requires its command causation ID.';
    end if;
    select count(*) into matching_events
    from jsonb_array_elements(coalesce(run_state->'events', '[]'::jsonb)) as run_event(value)
    where run_event.value->>'type' = 'ExecutionCancelled'
      and run_event.value->>'causationId' = transition_event->>'causationId';
    if matching_events <> 1 then
      raise exception 'The runtime cancellation command must match exactly one linked run cancellation event.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function orgward.prevent_cancelled_process_task_insert() returns trigger
language plpgsql as $$
begin
  if new.status in ('CANCELLED', 'PAUSED') then
    raise exception 'A process task cannot be inserted in a paused or cancelled state.';
  end if;
  return new;
end;
$$;
