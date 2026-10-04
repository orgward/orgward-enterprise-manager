alter table orgward.project_actor_binding_proposals
  add column execution_profile_ids jsonb not null default '[]'::jsonb
  check (jsonb_typeof(execution_profile_ids) = 'array' and jsonb_array_length(execution_profile_ids) <= 8);
