do $$
declare
  definition text;
begin
  select pg_get_functiondef('orgward.guard_process_task_cancellation()'::regprocedure) into definition;
  definition := replace(definition,
    $a$where run_event.value->>'type' = 'ExecutionCancelled'$a$,
    $b$where run_event.value->>'type' in ('ExecutionCancelled', 'ExecutionCancelledByProcessInstanceController')$b$);
  if definition not like '%ExecutionCancelledByProcessInstanceController%'
    or definition not like '%run_event.value->>''causationId'' = transition_event->>''causationId''%' then
    raise exception 'The runtime cancellation guard could not be extended for instance-controlled cancellation events.';
  end if;
  execute definition;
end;
$$;
