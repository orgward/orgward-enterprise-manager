alter table orgward.process_task_instances
  add column effective_assigned_principal text,
  add column effective_assigned_membership_generation bigint,
  add column effective_assigned_authz_generation bigint,
  add constraint process_task_effective_assignment_all_or_none
    check ((effective_assigned_principal is null
        and effective_assigned_membership_generation is null
        and effective_assigned_authz_generation is null)
      or (effective_assigned_principal is not null
        and effective_assigned_membership_generation is not null
        and effective_assigned_authz_generation is not null
        and effective_assigned_membership_generation > 0
        and effective_assigned_authz_generation > 0
        and assigned_principal is not null
        and actor_type is not null and actor_type = 'human'));

create or replace function orgward.require_human_success_checkpoint_evidence() returns trigger
language plpgsql as $$
declare
  prior_event_count integer;
  completion_event jsonb;
begin
  if old.actor_type = 'human' and old.status = 'IN_PROGRESS' and new.status = 'SUCCEEDED' then
    if jsonb_typeof(new.evidence) is distinct from 'array' or jsonb_array_length(new.evidence) = 0 then
      raise exception 'A succeeded human checkpoint requires at least one evidence note.';
    end if;
    prior_event_count := jsonb_array_length(old.events);
    if jsonb_array_length(new.events) <> prior_event_count + 1 then
      raise exception 'A succeeded human checkpoint requires exactly one completion event.';
    end if;
    completion_event := new.events->prior_event_count;
    if completion_event->>'type' is distinct from 'HumanTaskCompleted'
      or completion_event->>'actor' is distinct from coalesce(old.effective_assigned_principal, old.assigned_principal)
      or completion_event->'data'->>'result' is distinct from 'succeeded'
      or completion_event->'data'->'evidence' is distinct from new.evidence then
      raise exception 'A successful human checkpoint must record matching evidence from its effective assignee.';
    end if;
  end if;
  return new;
end;
$$;

create function orgward.protect_process_task_effective_assignment() returns trigger
language plpgsql as $$
declare
  event_count integer;
  resolution_event jsonb;
  resolution_data jsonb;
begin
  if old.effective_assigned_principal is distinct from new.effective_assigned_principal
    or old.effective_assigned_membership_generation is distinct from new.effective_assigned_membership_generation
    or old.effective_assigned_authz_generation is distinct from new.effective_assigned_authz_generation then
    event_count := jsonb_array_length(old.events);
    if old.actor_type is distinct from 'human'
      or old.status is distinct from 'ESCALATED'
      or new.status is distinct from 'IN_PROGRESS'
      or jsonb_array_length(new.events) <> event_count + 1 then
      raise exception 'Effective human task assignment can change only in an escalated owner reassignment transition.';
    end if;
    resolution_event := new.events->event_count;
    resolution_data := resolution_event->'data';
    if resolution_event->>'type' is distinct from 'HumanTaskEscalationResolved'
      or resolution_data->>'disposition' is distinct from 'resume'
      or resolution_data->>'reassigned' is distinct from 'true'
      or resolution_data->>'fromPrincipal' is distinct from coalesce(old.effective_assigned_principal, old.assigned_principal)
      or (resolution_data->>'fromMembershipGeneration')::bigint is distinct from coalesce(old.effective_assigned_membership_generation, old.assigned_membership_generation)
      or (resolution_data->>'fromAuthzGeneration')::bigint is distinct from coalesce(old.effective_assigned_authz_generation, old.assigned_authz_generation)
      or resolution_data->>'toPrincipal' is distinct from new.effective_assigned_principal
      or resolution_data->>'toPrincipal' is not distinct from resolution_data->>'fromPrincipal'
      or (resolution_data->>'toMembershipGeneration')::bigint is distinct from new.effective_assigned_membership_generation
      or (resolution_data->>'toAuthzGeneration')::bigint is distinct from new.effective_assigned_authz_generation
      or length(trim(coalesce(resolution_data->>'reason', ''))) = 0
      or jsonb_typeof(resolution_data->'evidence') is distinct from 'array'
      or jsonb_array_length(resolution_data->'evidence') = 0 then
      raise exception 'Effective assignment changes require a distinct assignee and a recorded owner reassignment with verification evidence.';
    end if;
  end if;
  return new;
end;
$$;

create trigger process_task_effective_assignment_guard
  before update on orgward.process_task_instances
  for each row execute function orgward.protect_process_task_effective_assignment();
