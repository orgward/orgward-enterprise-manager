alter table orgward.process_task_instances
  drop constraint process_task_instances_status_check;

alter table orgward.process_task_instances
  add constraint process_task_instances_status_check
  check (status in ('PLANNED', 'IN_PROGRESS', 'ESCALATED', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED'));

do $$
declare
  time_constraint text;
begin
  select conname into time_constraint
  from pg_constraint
  where conrelid = 'orgward.process_task_instances'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%started_at%'
    and pg_get_constraintdef(oid) like '%completed_at%';
  if time_constraint is null then
    raise exception 'Process task runtime timestamp constraint was not found.';
  end if;
  execute format('alter table orgward.process_task_instances drop constraint %I', time_constraint);
end;
$$;

alter table orgward.process_task_instances
  add constraint process_task_instances_runtime_time_check
  check ((status in ('IN_PROGRESS', 'ESCALATED') and started_at is not null and completed_at is null)
      or (status in ('SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is not null)
      or (status not in ('IN_PROGRESS', 'ESCALATED', 'SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is null));

create or replace function orgward.protect_process_task_instance_history() returns trigger
language plpgsql as $$
declare
  item integer;
  old_event_count integer;
  last_event jsonb;
  last_event_data jsonb;
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.project_id is distinct from new.project_id
    or old.process_plan_id is distinct from new.process_plan_id
    or old.plan_revision is distinct from new.plan_revision
    or old.plan_instance_id is distinct from new.plan_instance_id
    or old.task_id is distinct from new.task_id
    or old.blueprint_id is distinct from new.blueprint_id
    or old.blueprint_version is distinct from new.blueprint_version
    or old.process_id is distinct from new.process_id
    or old.actor_id is distinct from new.actor_id
    or old.role_id is distinct from new.role_id
    or old.actor_type is distinct from new.actor_type
    or old.assigned_principal is distinct from new.assigned_principal
    or old.assigned_membership_generation is distinct from new.assigned_membership_generation
    or old.assigned_authz_generation is distinct from new.assigned_authz_generation then
    raise exception 'Process task instance references and assignment snapshots are immutable.';
  end if;
  if old.execution_run_id is distinct from new.execution_run_id
    and (old.execution_run_id is not null or new.execution_run_id is null
      or old.status <> 'PLANNED' or old.version <> 0 or jsonb_array_length(old.events) <> 0
      or old.actor_type is distinct from 'workload' or new.status <> 'AWAITING_APPROVAL' or new.version <> old.version + 1) then
    raise exception 'A process task runtime may acquire its initial execution run link only while its root request is created.';
  end if;

  if old.actor_type = 'human' then
    if old.started_at is not null and new.started_at is distinct from old.started_at then
      raise exception 'A started human task timestamp is immutable.';
    end if;
    if new.status in ('IN_PROGRESS', 'ESCALATED')
      and (old.outcome is distinct from new.outcome or old.evidence is distinct from new.evidence
        or old.completed_at is distinct from new.completed_at) then
      raise exception 'A nonterminal human task cannot change outcome, evidence, or completion time.';
    end if;
    if old.status = 'PLANNED' and new.status <> 'IN_PROGRESS' then
      raise exception 'A planned human task can only be started.';
    elsif old.status = 'IN_PROGRESS' and new.status not in ('ESCALATED', 'SUCCEEDED', 'FAILED') then
      raise exception 'An in-progress human task can only be escalated or completed.';
    elsif old.status = 'ESCALATED' and new.status not in ('IN_PROGRESS', 'SUCCEEDED', 'FAILED') then
      raise exception 'An escalated human task can only be resumed or resolved.';
    elsif old.status in ('SUCCEEDED', 'FAILED')
      and (old.status is distinct from new.status or old.outcome is distinct from new.outcome
        or old.evidence is distinct from new.evidence or old.completed_at is distinct from new.completed_at) then
      raise exception 'Human task outcomes are immutable after completion.';
    end if;

    if new.status is distinct from old.status then
      old_event_count := jsonb_array_length(old.events);
      if jsonb_array_length(new.events) <> old_event_count + 1 then
        raise exception 'Every human task state transition requires exactly one append-only event.';
      end if;
      last_event := new.events->old_event_count;
      last_event_data := last_event->'data';
      if last_event_data->>'taskId' is distinct from new.task_id
        or last_event_data->>'processPlanId' is distinct from new.process_plan_id
        or last_event_data->>'revision' is distinct from new.plan_revision::text
        or last_event_data->>'planInstanceId' is distinct from new.plan_instance_id::text then
        raise exception 'Human task transition history must reference the exact immutable task instance.';
      end if;
      if old.status = 'IN_PROGRESS' and new.status = 'ESCALATED' then
        if last_event->>'type' is distinct from 'HumanTaskEscalated'
          or length(trim(coalesce(last_event_data->>'reason', ''))) = 0
          or jsonb_typeof(last_event_data->'evidence') is distinct from 'array' then
          raise exception 'Escalation requires a reason and a recorded evidence array.';
        end if;
      elsif old.status = 'PLANNED' and new.status = 'IN_PROGRESS' then
        if last_event->>'type' is distinct from 'HumanTaskStarted' then
          raise exception 'Starting a human task requires a start event.';
        end if;
      elsif old.status = 'IN_PROGRESS' and new.status in ('SUCCEEDED', 'FAILED') then
        if last_event->>'type' is distinct from 'HumanTaskCompleted'
          or last_event_data->>'result' is distinct from lower(new.status)
          or jsonb_typeof(last_event_data->'evidence') is distinct from 'array'
          or last_event_data->'evidence' is distinct from new.evidence
          or new.outcome->>'result' is distinct from lower(new.status) then
          raise exception 'Completing a human task requires matching outcome and evidence history.';
        end if;
      elsif old.status = 'ESCALATED' then
        if last_event->>'type' is distinct from 'HumanTaskEscalationResolved'
          or length(trim(coalesce(last_event_data->>'reason', ''))) = 0
          or jsonb_typeof(last_event_data->'evidence') is distinct from 'array'
          or (new.status = 'IN_PROGRESS' and last_event_data->>'disposition' is distinct from 'resume')
          or (new.status = 'SUCCEEDED' and (last_event_data->>'disposition' is distinct from 'succeeded'
            or jsonb_array_length(last_event_data->'evidence') = 0
            or last_event_data->'evidence' is distinct from new.evidence
            or new.outcome->>'result' is distinct from 'succeeded'))
          or (new.status = 'FAILED' and (last_event_data->>'disposition' is distinct from 'failed'
            or last_event_data->'evidence' is distinct from new.evidence
            or new.outcome->>'result' is distinct from 'failed')) then
          raise exception 'Escalation resolution requires a reason and matching disposition evidence.';
        end if;
      end if;
    elsif jsonb_array_length(new.events) <> jsonb_array_length(old.events) then
      raise exception 'Human task events can only be appended with a state transition.';
    end if;
  end if;

  old_event_count := jsonb_array_length(old.events);
  if jsonb_array_length(new.events) < old_event_count then
    raise exception 'Process task instance history cannot be removed.';
  end if;
  if old_event_count > 0 then
    for item in 0..old_event_count - 1 loop
      if old.events->item is distinct from new.events->item then
        raise exception 'Process task instance history cannot be rewritten.';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
