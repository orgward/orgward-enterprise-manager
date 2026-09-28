create table orgward.software_delivery_assignment_reviews (
  tenant_id text not null,
  project_id text not null,
  case_id text not null,
  plan_id text not null,
  review_revision integer not null check (review_revision > 0),
  draft_hash text not null check (draft_hash ~ '^[a-f0-9]{64}$'),
  review_hash text not null check (review_hash ~ '^[a-f0-9]{64}$'),
  review jsonb not null check (jsonb_typeof(review) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, plan_id, review_revision),
  foreign key (tenant_id, plan_id) references orgward.software_delivery_plans (tenant_id, plan_id)
);

create table orgward.software_delivery_assignment_commands (
  tenant_id text not null,
  plan_id text not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  review_revision integer not null check (review_revision > 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, plan_id, idempotency_key),
  foreign key (tenant_id, plan_id, review_revision)
    references orgward.software_delivery_assignment_reviews (tenant_id, plan_id, review_revision)
);

create index software_delivery_assignment_reviews_case_idx
  on orgward.software_delivery_assignment_reviews (tenant_id, case_id, created_at desc);
