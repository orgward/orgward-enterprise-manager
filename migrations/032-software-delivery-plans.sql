create table orgward.software_delivery_plans (
  tenant_id text not null,
  project_id text not null,
  case_id text not null,
  g6_plan_hash text not null check (g6_plan_hash ~ '^[a-f0-9]{64}$'),
  compiler_version text not null,
  plan_id text not null,
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, project_id, case_id, g6_plan_hash, compiler_version),
  unique (tenant_id, plan_id)
);

create index software_delivery_plans_case_idx
  on orgward.software_delivery_plans (tenant_id, case_id, created_at desc);
