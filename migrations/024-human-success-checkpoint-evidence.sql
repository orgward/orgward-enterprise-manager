create function orgward.require_human_success_checkpoint_evidence() returns trigger
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
      or completion_event->>'actor' is distinct from old.assigned_principal
      or completion_event->'data'->>'result' is distinct from 'succeeded'
      or completion_event->'data'->'evidence' is distinct from new.evidence then
      raise exception 'A successful human checkpoint must record matching evidence from its assigned person.';
    end if;
  end if;
  return new;
end;
$$;

create trigger process_task_human_success_evidence_guard
  before update on orgward.process_task_instances
  for each row execute function orgward.require_human_success_checkpoint_evidence();
