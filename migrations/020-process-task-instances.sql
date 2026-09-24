create table orgward.process_task_instances (
  tenant_id text not null,
  project_id text not null,
  project_aggregate_kind text generated always as ('project') stored,
  process_plan_id text not null,
  plan_revision integer not null check (plan_revision > 0),
  plan_instance_id uuid not null,
  task_id text not null,
  blueprint_id text not null,
  blueprint_version integer not null check (blueprint_version > 0),
  process_id text not null,
  actor_id text,
  role_id text,
  actor_type text check (actor_type is null or actor_type in ('human', 'workload')),
  assigned_principal text,
  assigned_membership_generation bigint,
  assigned_authz_generation bigint,
  status text not null check (status in ('PLANNED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'APPROVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED')),
  execution_run_id text,
  run_aggregate_kind text generated always as ('execution_run') stored,
  version bigint not null default 0 check (version >= 0),
  outcome jsonb not null default '{}'::jsonb check (jsonb_typeof(outcome) = 'object'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, plan_instance_id, task_id),
  unique (tenant_id, execution_run_id),
  foreign key (tenant_id, project_aggregate_kind, project_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id) on delete restrict,
  foreign key (tenant_id, run_aggregate_kind, execution_run_id)
    references orgward.aggregates (tenant_id, aggregate_kind, aggregate_id) on delete restrict,
  check ((assigned_principal is null and assigned_membership_generation is null and assigned_authz_generation is null)
      or (assigned_principal is not null and assigned_membership_generation > 0 and assigned_authz_generation > 0)),
  check ((status = 'IN_PROGRESS' and started_at is not null and completed_at is null)
      or (status in ('SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is not null)
      or (status not in ('IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'INTERRUPTED') and completed_at is null))
);

create index process_task_instances_project_idx
  on orgward.process_task_instances (tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id);
create index process_task_instances_run_idx
  on orgward.process_task_instances (tenant_id, execution_run_id)
  where execution_run_id is not null;

insert into orgward.process_task_instances (
  tenant_id, project_id, process_plan_id, plan_revision, plan_instance_id, task_id,
  blueprint_id, blueprint_version, process_id, actor_id, role_id, actor_type, status,
  execution_run_id, version, events, started_at, completed_at, created_at, updated_at
)
select a.tenant_id,
  s.project_id,
  a.state->'processTaskRef'->>'processPlanId',
  (a.state->'processTaskRef'->>'revision')::integer,
  (a.state->'processTaskRef'->>'planInstanceId')::uuid,
  a.state->'processTaskRef'->>'taskId',
  a.state->'processTaskRef'->>'blueprintId',
  (a.state->'processTaskRef'->>'blueprintVersion')::integer,
  a.state->'processTaskRef'->>'processId',
  a.state->'processTaskRef'->>'actorId',
  a.state->'processTaskRef'->>'roleId',
  'workload',
  a.state->>'status',
  a.aggregate_id,
  a.version,
  '[]'::jsonb,
  case when a.state->>'status' in ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED') then a.created_at else null end,
  case when a.state->>'status' in ('SUCCEEDED', 'FAILED', 'INTERRUPTED') then a.updated_at else null end,
  a.created_at,
  a.updated_at
from orgward.aggregates a
join orgward.aggregate_project_scopes s
  on s.tenant_id = a.tenant_id and s.aggregate_kind = a.aggregate_kind and s.aggregate_id = a.aggregate_id
where a.aggregate_kind = 'execution_run' and a.state ? 'processTaskRef';

create function orgward.protect_process_task_instance_history() returns trigger
language plpgsql as $$
declare
  item integer;
  old_event_count integer;
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
  if old.actor_type = 'human' and old.status = 'PLANNED' and new.status <> 'IN_PROGRESS'
    or old.actor_type = 'human' and old.status = 'IN_PROGRESS' and new.status not in ('SUCCEEDED', 'FAILED')
    or old.actor_type = 'human' and old.status in ('SUCCEEDED', 'FAILED')
      and (old.status is distinct from new.status or old.outcome is distinct from new.outcome
        or old.evidence is distinct from new.evidence or old.completed_at is distinct from new.completed_at) then
    raise exception 'Human task runtimes allow only planned→in-progress→terminal transitions with immutable outcomes.';
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

create trigger process_task_instance_history_immutable
  before update on orgward.process_task_instances
  for each row execute function orgward.protect_process_task_instance_history();

create function orgward.prevent_process_task_instance_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Process task instances are durable and cannot be deleted.';
end;
$$;

create trigger process_task_instance_no_delete
  before delete on orgward.process_task_instances
  for each row execute function orgward.prevent_process_task_instance_delete();

create function orgward.pin_process_task_instance_revision() returns trigger
language plpgsql as $$
declare
  pinned record;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id || ':process-plan-instance:' || new.plan_instance_id::text, 0));
  select project_id, process_plan_id, plan_revision, blueprint_id, blueprint_version
    into pinned from orgward.process_task_instances
    where tenant_id = new.tenant_id and plan_instance_id = new.plan_instance_id
    limit 1 for update;
  if found and (pinned.project_id is distinct from new.project_id
    or pinned.process_plan_id is distinct from new.process_plan_id
    or pinned.plan_revision is distinct from new.plan_revision
    or pinned.blueprint_id is distinct from new.blueprint_id
    or pinned.blueprint_version is distinct from new.blueprint_version) then
    raise exception 'A process task instance cannot mix project, plan, or blueprint revisions.';
  end if;
  return new;
end;
$$;

create trigger process_task_instance_revision_pinned
  before insert on orgward.process_task_instances
  for each row execute function orgward.pin_process_task_instance_revision();
