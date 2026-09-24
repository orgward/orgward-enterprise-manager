create table orgward.process_task_instance_controls (
  tenant_id text not null,
  project_id text not null,
  project_aggregate_kind text generated always as ('project') stored,
  process_plan_id text not null,
  plan_revision integer not null check (plan_revision > 0),
  plan_instance_id uuid not null,
  status text not null check (status in ('ACTIVE', 'PAUSE_REQUESTED', 'PAUSED')),
  initiated_by text,
  pause_reason text,
  pause_boundary jsonb not null default '{}'::jsonb check (jsonb_typeof(pause_boundary) = 'object'),
  version bigint not null default 0 check (version >= 0),
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, plan_instance_id),
  foreign key (tenant_id, project_aggregate_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id) on delete restrict,
  check ((status = 'ACTIVE' and pause_reason is null)
      or (status in ('PAUSE_REQUESTED', 'PAUSED') and pause_reason is not null))
);

create index process_task_instance_controls_project_idx
  on orgward.process_task_instance_controls (tenant_id, project_id, process_plan_id, plan_revision, status);

insert into orgward.process_task_instance_controls (
  tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, status,
  initiated_by, version, events, created_at, updated_at
)
select tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, 'ACTIVE',
  null, 0, '[]'::jsonb, min(created_at), max(updated_at)
from orgward.process_task_instances
group by tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id;

create function orgward.protect_process_task_instance_control_history() returns trigger
language plpgsql as $$
declare
  item integer;
  old_event_count integer;
  transition_event jsonb;
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
  ) then
    raise exception 'Invalid process task instance control transition.';
  end if;
  return new;
end;
$$;

create trigger process_task_instance_control_history_immutable
  before insert or update on orgward.process_task_instance_controls
  for each row execute function orgward.protect_process_task_instance_control_history();

create trigger process_task_instance_control_no_delete
  before delete on orgward.process_task_instance_controls
  for each row execute function orgward.protect_process_task_instance_control_history();
