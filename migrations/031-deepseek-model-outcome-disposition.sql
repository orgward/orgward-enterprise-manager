do $$
declare
  definition text;
begin
  select pg_get_functiondef('orgward.protect_process_task_instance_control_history()'::regprocedure) into definition;
  definition := replace(definition,
    $a$a.state #>> '{profile,kind}' is distinct from 'provider-openai'$a$,
    $b$coalesce(a.state #>> '{profile,kind}', '') not in ('provider-openai', 'provider-deepseek')$b$);
  definition := replace(definition,
    'Only unresolved outcomes from built-in OpenAI model tasks may be abandoned as unverified.',
    'Only unresolved outcomes from read-only OpenAI or DeepSeek model proposals may be abandoned as unverified.');
  if definition not like '%provider-deepseek%'
    or definition not like '%read-only OpenAI or DeepSeek model proposals%'
    or definition like '%is distinct from ''provider-openai''%' then
    raise exception 'The process-instance unknown-outcome guard could not be extended for DeepSeek proposals.';
  end if;
  execute definition;
end;
$$;
