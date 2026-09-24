alter table orgward.process_task_instance_controls
  drop constraint process_task_instance_controls_status_check,
  drop constraint process_task_instance_controls_check;

alter table orgward.process_task_instance_controls
  add constraint process_task_instance_controls_status_check
    check (status in ('ACTIVE', 'PAUSE_REQUESTED', 'PAUSED', 'ABANDONED_UNVERIFIED')),
  add constraint process_task_instance_controls_pause_reason_check
    check ((status = 'ACTIVE' and pause_reason is null)
        or (status in ('PAUSE_REQUESTED', 'PAUSED', 'ABANDONED_UNVERIFIED') and pause_reason is not null));

create or replace function orgward.protect_process_task_instance_control_history() returns trigger
language plpgsql as $$
declare
  item integer;
  old_event_count integer;
  transition_event jsonb;
  unresolved_count integer;
  actual_run_ids text[];
  actual_attempt_ids text[];
  event_run_ids text[];
  event_attempt_ids text[];
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ACTIVE' or new.version <> 0 or new.pause_reason is not null
      or new.pause_boundary <> '{}'::jsonb or jsonb_array_length(new.events) <> 0 then
      raise exception 'A process task instance control must be created active with empty history.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Process task instance controls are durable and cannot be deleted.';
  end if;
  if old.tenant_id is distinct from new.tenant_id
    or old.project_id is distinct from new.project_id
    or old.process_plan_id is distinct from new.process_plan_id
    or old.plan_revision is distinct from new.plan_revision
    or old.plan_instance_id is distinct from new.plan_instance_id
    or old.created_at is distinct from new.created_at
    or (old.initiated_by is not null and old.initiated_by is distinct from new.initiated_by) then
    raise exception 'Process task instance control references are immutable.';
  end if;
  if old.status = 'ABANDONED_UNVERIFIED' then
    raise exception 'An unverified process instance disposition is terminal.';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'A process task instance control update must advance exactly one version.';
  end if;
  old_event_count := jsonb_array_length(old.events);
  if jsonb_array_length(new.events) <> old_event_count + 1 then
    raise exception 'A process task instance control update requires exactly one appended event.';
  end if;
  if old_event_count > 0 then
    for item in 0..old_event_count - 1 loop
      if old.events->item is distinct from new.events->item then
        raise exception 'Process task instance control history cannot be rewritten.';
      end if;
    end loop;
  end if;
  transition_event := new.events->old_event_count;
  if length(trim(coalesce(transition_event->>'causationId', ''))) = 0
    or transition_event->'data'->>'planInstanceId' is distinct from new.plan_instance_id::text
    or transition_event->'data'->>'resultingStatus' is distinct from new.status then
    raise exception 'The control event must bind the command, instance, and resulting status.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'ACTIVE' and new.status = 'PAUSE_REQUESTED')
    or (old.status = 'PAUSE_REQUESTED' and new.status = 'PAUSED')
    or (old.status = 'PAUSED' and new.status = 'ACTIVE')
    or (old.status in ('PAUSE_REQUESTED', 'PAUSED') and new.status = 'ABANDONED_UNVERIFIED')
  ) then
    raise exception 'Invalid process task instance control transition.';
  end if;
  if new.status = 'ABANDONED_UNVERIFIED' and new.status is distinct from old.status then
    if transition_event->>'type' is distinct from 'ProcessTaskInstanceAbandonedUnverified'
      or transition_event->'data'->>'priorStatus' is distinct from old.status
      or length(trim(coalesce(transition_event->'data'->>'reason', ''))) not between 1 and 1000
      or (case when jsonb_typeof(transition_event->'data'->'evidence') = 'array' then
        jsonb_array_length(transition_event->'data'->'evidence') not between 1 and 20
        or exists (select 1 from jsonb_array_elements(transition_event->'data'->'evidence') as evidence_items(value)
          where jsonb_typeof(value) is distinct from 'string'
            or length(trim(value #>> '{}')) not between 1 and 1000)
        else true end)
      or transition_event->'data'->'acknowledgeDuplicateCostWork' is distinct from 'true'::jsonb
      or (case when jsonb_typeof(transition_event->'data'->'runIds') = 'array' then
        jsonb_array_length(transition_event->'data'->'runIds') not between 1 and 100
        or exists (select 1 from jsonb_array_elements(transition_event->'data'->'runIds') as run_items(value)
          where jsonb_typeof(value) is distinct from 'string' or length(trim(value #>> '{}')) = 0)
        else true end)
      or (case when jsonb_typeof(transition_event->'data'->'attemptIds') = 'array' then
        jsonb_array_length(transition_event->'data'->'attemptIds') not between 1 and 100
        or exists (select 1 from jsonb_array_elements(transition_event->'data'->'attemptIds') as attempt_items(value)
          where jsonb_typeof(value) is distinct from 'string' or length(trim(value #>> '{}')) = 0)
        else true end)
      or coalesce(transition_event->'data'->>'authzGeneration', '') !~ '^[0-9]+$'
      or not exists (
        select 1
        from orgward.oidc_principals p
        join orgward.project_memberships m on m.tenant_id=p.tenant_id and m.principal=p.principal
        where p.tenant_id=new.tenant_id and p.principal=transition_event->>'actor'
          and p.status='active' and p.actor_type='human'
          and p.roles @> array['workspace-write']::text[]
          and p.authz_generation::text=transition_event->'data'->>'authzGeneration'
          and m.project_id=new.project_id and m.access='owner' and m.revoked_at is null
      ) then
      raise exception 'Unverified abandonment requires a current project owner, reason, evidence and duplicate-cost acknowledgement.';
    end if;
    if exists (select 1 from orgward.process_task_instances r
      where r.tenant_id=new.tenant_id and r.plan_instance_id=new.plan_instance_id
        and r.status in ('IN_PROGRESS', 'ESCALATED', 'RUNNING')) then
      raise exception 'An active human or agent task prevents unverified abandonment.';
    end if;
    if exists (select 1 from orgward.execution_worker_leases l
      join orgward.aggregates a on a.tenant_id=l.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=l.run_id
      where l.tenant_id=new.tenant_id and l.lease_until>now()
        and a.state #>> '{processTaskRef,planInstanceId}'=new.plan_instance_id::text) then
      raise exception 'A live execution lease prevents unverified abandonment.';
    end if;
    select count(*) into unresolved_count
      from orgward.provider_dispatch_attempts d
      join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
      where d.tenant_id=new.tenant_id and a.state #>> '{processTaskRef,planInstanceId}'=new.plan_instance_id::text
        and d.status in ('reserved', 'handed_off', 'outcome_unknown');
    if unresolved_count = 0 or exists (
      select 1
      from orgward.provider_dispatch_attempts d
      join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
      where d.tenant_id=new.tenant_id and a.state #>> '{processTaskRef,planInstanceId}'=new.plan_instance_id::text
        and d.status in ('reserved', 'handed_off', 'outcome_unknown')
        and (d.status <> 'outcome_unknown' or a.state #>> '{profile,kind}' is distinct from 'provider-openai'
          or a.state #>> '{workItem,proposalContext,target,type}' is distinct from 'information'
          or case when jsonb_typeof(a.state #> '{workItem,proposalContext,sourceEnvelope,sources}') = 'array'
            then jsonb_array_length(a.state #> '{workItem,proposalContext,sourceEnvelope,sources}') not between 1 and 8
            else true end
          or a.state ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan']
          or (a.state->'workItem') ?| array['toolPlan','toolPlans','externalActions','capabilities','effects','effectPlan','tools'])
    ) then
      raise exception 'Only unresolved outcomes from built-in OpenAI model tasks may be abandoned as unverified.';
    end if;
    select array_agg(distinct d.run_id order by d.run_id), array_agg(d.attempt_id order by d.attempt_id)
      into actual_run_ids, actual_attempt_ids
      from orgward.provider_dispatch_attempts d
      join orgward.aggregates a on a.tenant_id=d.tenant_id and a.aggregate_kind='execution_run' and a.aggregate_id=d.run_id
      where d.tenant_id=new.tenant_id and a.state #>> '{processTaskRef,planInstanceId}'=new.plan_instance_id::text
        and d.status in ('reserved','handed_off','outcome_unknown');
    select array_agg(value order by value) into event_run_ids
      from jsonb_array_elements_text(transition_event->'data'->'runIds') as entries(value);
    select array_agg(value order by value) into event_attempt_ids
      from jsonb_array_elements_text(transition_event->'data'->'attemptIds') as entries(value);
    if event_run_ids is distinct from actual_run_ids or event_attempt_ids is distinct from actual_attempt_ids then
      raise exception 'The unverified abandonment event must bind every unresolved run and attempt exactly once.';
    end if;
  end if;
  return new;
end;
$$;
